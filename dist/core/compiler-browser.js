/** Opt-in browser layout capture. Reads a connected tree; never inserts/evaluates source. */
import { createDocument, element, validateDocument } from './model.js';
import { serializeXaml, namespaces } from './xaml.js';
import { buildSourceIndex } from './source-syntax.js';
import { compileDocument } from './semantic-compiler.js';

const inlineTags = new Set('span strong b em i u s small mark code a br'.split(' '));
const ignored = new Set('script style link meta title base template noscript'.split(' '));
const num = (value) => Number.parseFloat(value) || 0;
const scalar = (value) => {
  if (!Number.isFinite(value) || Math.abs(value) > 10_000_000)
    throw Error('Captured geometry is not finite or exceeds 10,000,000 CSS pixels.');
  return String(Number(value.toFixed(5)));
};
const literal = (value) => (String(value).startsWith('{') ? '{}' + value : String(value));
const plainRect = (rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
const box = (css, prefix, suffix = '') =>
  ['Left', 'Top', 'Right', 'Bottom']
    .map((side) => scalar(num(css[prefix + side + suffix])))
    .join(',');

function captureElements(root, maxNodes) {
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 50000)
    throw Error('maxNodes must be an integer between 1 and 50,000.');
  const result = [],
    walker = root.ownerDocument.createTreeWalker(root, 1);
  let node = root;
  while (node) {
    if (result.length >= maxNodes) throw Error('Browser capture exceeds maxNodes.');
    result.push(node);
    node = walker.nextNode();
  }
  return result;
}

/** Capture real CSS layout, including media/container queries, pseudo states and loaded sheets.
 * Output is native elements with measured boxes at ONE current browser state, not a CSS engine.
 */
export function compileRenderedDocument(root, options = {}) {
  const diagnostics = [],
    losses = [],
    sourceMap = [],
    geometry = [];
  const framework = options.framework || 'WPF';
  const metadata = { version: 1, from: 'html', to: 'xaml', preserved: false };
  const report = (code, message, node, loss = true) => {
    const entry = {
      severity: loss ? 'warning' : 'info',
      code,
      message,
      ...(node?.id ? { nodeId: node.id } : {}),
    };
    diagnostics.push(entry);
    if (loss) losses.push(entry);
  };
  try {
    if (!['WPF', 'Avalonia'].includes(framework))
      throw Error('Browser capture targets WPF or Avalonia.');
    if (root?.nodeType === 9) root = root.body;
    const document = root?.ownerDocument,
      window = document?.defaultView;
    if (!root || root.nodeType !== 1 || !root.isConnected || !window?.getComputedStyle)
      throw Error('Browser capture requires a connected element in a live browser document.');
    const maxNodes = options.maxNodes ?? 10000;
    if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 50000)
      throw Error('maxNodes must be an integer between 1 and 50,000.');
    const sourceNodes = captureElements(root, maxNodes);
    if (sourceNodes.length > maxNodes) throw Error('Browser capture exceeds maxNodes.');
    const rootRect = root.getBoundingClientRect();
    if (!(rootRect.width > 0 && rootRect.height > 0))
      throw Error('The capture root must have a visible, nonempty layout box.');
    const cssCache = new Map(),
      names = new Set(),
      sourceOrdinals = new Map(sourceNodes.map((node, index) => [node, index]));
    const cssOf = (node) => {
      if (!cssCache.has(node)) cssCache.set(node, window.getComputedStyle(node));
      return cssCache.get(node);
    };
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const colorContext = canvas.getContext('2d', { willReadFrequently: true });
    const colorCache = new Map();
    const color = (value) => {
      if (colorCache.has(value)) return colorCache.get(value);
      if (!colorContext) throw Error('A browser Canvas2D color conversion context is required.');
      colorContext.clearRect(0, 0, 1, 1);
      colorContext.fillStyle = value;
      colorContext.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = colorContext.getImageData(0, 0, 1, 1).data;
      const result =
        '#' +
        [a, r, g, b]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase();
      colorCache.set(value, result);
      return result;
    };
    const typography = (css) => ({
      Foreground: color(css.color),
      FontFamily: literal(css.fontFamily.replace(/['"]/g, '')),
      FontSize: scalar(Math.max(0.01, num(css.fontSize))),
      FontWeight:
        css.fontWeight === 'normal' ? '400' : css.fontWeight === 'bold' ? '700' : css.fontWeight,
      FontStyle: /^(italic|oblique)/.test(css.fontStyle) ? 'Italic' : 'Normal',
    });
    const position = (node, rect, parentRect) => {
      const props = {
        Width: scalar(rect.width),
        Height: scalar(rect.height),
        MinWidth: '0',
        MinHeight: '0',
        Margin: '0',
        'Canvas.Left': scalar(rect.x - parentRect.x),
        'Canvas.Top': scalar(rect.y - parentRect.y),
        UseLayoutRounding: 'False',
      };
      if (node.id) {
        let name = node.id.replace(/[^a-zA-Z0-9_]/g, '_');
        if (!/^[a-zA-Z_]/.test(name)) name = '_' + name;
        const base = name;
        let suffix = 1;
        while (names.has(name)) name = base + '_' + suffix++;
        names.add(name);
        props['x:Name'] = name;
      }
      return props;
    };
    const map = (source, target, rect) => {
      const path = source === root ? 'root' : 'element:' + sourceOrdinals.get(source);
      sourceMap.push({ sourceNodeId: path, targetNodeId: target.id });
      geometry.push({
        sourceElementId: source.id || null,
        targetNodeId: target.id,
        targetName: target.props['x:Name'] || null,
        rect: plainRect(rect),
      });
    };
    const warnVisuals = (node, css) => {
      const unsupported = [
        ['transform', 'none'],
        ['filter', 'none'],
        ['backdropFilter', 'none'],
        ['clipPath', 'none'],
        ['maskImage', 'none'],
        ['backgroundImage', 'none'],
        ['boxShadow', 'none'],
        ['textShadow', 'none'],
        ['mixBlendMode', 'normal'],
        ['writingMode', 'horizontal-tb'],
      ];
      for (const [key, initial] of unsupported)
        if (css[key] && css[key] !== initial)
          report(
            'BROWSER_PAINT_ADAPTER',
            `${key}: ${css[key]} needs a native paint adapter; measured geometry alone does not reproduce this effect.`,
            node,
          );
      if (css.animationName && css.animationName !== 'none')
        report(
          'BROWSER_ANIMATION_SNAPSHOT',
          'The current animation frame is captured; native playback is not generated by measured capture.',
          node,
        );
      for (const pseudo of ['::before', '::after']) {
        const content = window.getComputedStyle(node, pseudo).content;
        if (content && !['none', 'normal', '""'].includes(content))
          report(
            'BROWSER_GENERATED_CONTENT',
            `${pseudo} content requires a generated-content paint adapter.`,
            node,
          );
      }
      if (node.localName.includes('-') && !node.shadowRoot)
        report(
          'BROWSER_CUSTOM_ELEMENT',
          'Custom elements may contain inaccessible closed shadow content or behavior; provide a component adapter.',
          node,
        );
      if (css.display === 'list-item' && css.listStyleType !== 'none')
        report(
          'BROWSER_GENERATED_CONTENT',
          'List markers require a native list/marker adapter.',
          node,
        );
      if (
        (css.textTransform && css.textTransform !== 'none') ||
        (css.letterSpacing && !['normal', '0px'].includes(css.letterSpacing)) ||
        (css.wordSpacing && !['normal', '0px'].includes(css.wordSpacing))
      )
        report(
          'BROWSER_TEXT_ADAPTER',
          'Text transformations or custom character/word spacing require native text adaptation.',
          node,
        );
      if (node.shadowRoot)
        report(
          'BROWSER_SHADOW_CONTENT',
          'Shadow-tree content needs an explicit component adapter.',
          node,
        );
    };
    const inlineContent = (node) => {
      const result = [];
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          const css = cssOf(node),
            value = /^(pre|pre-wrap|break-spaces)$/.test(css.whiteSpace)
              ? child.textContent
              : css.whiteSpace === 'pre-line'
                ? child.textContent.replace(/[\t\f ]+/g, ' ')
                : child.textContent.replace(/[\t\n\r\f ]+/g, ' ');
          if (value) result.push(element('Run', { ...typography(css), Text: literal(value) }));
        } else if (child.nodeType === 1 && child.localName === 'br')
          result.push(element('LineBreak'));
        else if (child.nodeType === 1 && !ignored.has(child.localName)) {
          if (cssOf(child).display === 'none') continue;
          const childCss = cssOf(child);
          warnVisuals(child, childCss);
          if (
            childCss.textDecorationLine !== 'none' ||
            childCss.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
            ['Left', 'Top', 'Right', 'Bottom'].some(
              (side) =>
                num(childCss['padding' + side]) ||
                num(childCss['margin' + side]) ||
                num(childCss['border' + side + 'Width']),
            )
          )
            report(
              'BROWSER_INLINE_BOX_ADAPTER',
              'Inline decoration, backgrounds and box spacing require a native inline paint/layout adapter.',
              child,
            );
          if (child.localName === 'a' && child.hasAttribute('href'))
            report(
              'BROWSER_LINK_SNAPSHOT',
              'Link text is retained without an executable navigation handler.',
              child,
            );
          result.push(...inlineContent(child));
        }
      }
      return result;
    };
    const isTextTree = (node) =>
      [...node.children].every(
        (child) =>
          ignored.has(child.localName) ||
          (inlineTags.has(child.localName) &&
            (child.localName === 'br' || cssOf(child).display === 'inline') &&
            isTextTree(child)),
      );
    const makeText = (node, rect, parentRect, name = true) => {
      const css = cssOf(node),
        props = {
          ...position(name ? node : { id: '' }, rect, parentRect),
          ...typography(css),
          Padding: box(css, 'padding'),
          TextWrapping: /^(pre|nowrap)$/.test(css.whiteSpace) ? 'NoWrap' : 'Wrap',
          'xml:space': 'preserve',
        };
      props.TextAlignment =
        css.textAlign === 'center'
          ? 'Center'
          : css.textAlign === 'right' || (css.textAlign === 'end' && css.direction !== 'rtl')
            ? 'Right'
            : css.textAlign === 'justify'
              ? 'Justify'
              : 'Left';
      props.FlowDirection = css.direction === 'rtl' ? 'RightToLeft' : 'LeftToRight';
      if (css.lineHeight !== 'normal') props.LineHeight = scalar(num(css.lineHeight));
      const value = element('TextBlock', props, inlineContent(node));
      value.space = 'preserve';
      return value;
    };
    const convert = (node, parentRect, depth = 0) => {
      if (depth > 128) throw Error('Browser capture exceeds 128 levels.');
      const tag = node.localName;
      if (ignored.has(tag)) return null;
      const css = cssOf(node);
      if (css.display === 'none') return null;
      const rect = node.getBoundingClientRect();
      warnVisuals(node, css);
      const props = position(node, rect, parentRect);
      if (css.opacity !== '1') props.Opacity = css.opacity;
      if (css.visibility !== 'visible') {
        props.Opacity = '0';
        report(
          'BROWSER_VISIBILITY',
          'Hidden parent boxes with descendant visibility overrides require a native visibility adapter.',
          node,
        );
      }
      if (/^-?\d+$/.test(css.zIndex))
        props[framework === 'WPF' ? 'Panel.ZIndex' : 'ZIndex'] = css.zIndex;
      if (node.getAttribute('aria-label'))
        props['AutomationProperties.Name'] = literal(node.getAttribute('aria-label'));
      if (node.hasAttribute('title'))
        props[framework === 'WPF' ? 'ToolTip' : 'ToolTip.Tip'] = literal(
          node.getAttribute('title'),
        );
      const decorate = (target) => {
        target.props.Background = color(css.backgroundColor);
        target.props.BorderThickness = box(css, 'border', 'Width');
        target.props.BorderBrush = color(css.borderTopColor);
        const sides = ['Top', 'Right', 'Bottom', 'Left'];
        if (
          sides.some(
            (side) => !['none', 'hidden', 'solid'].includes(css['border' + side + 'Style']),
          )
        )
          report(
            'BROWSER_BORDER_STYLE',
            'Non-solid browser borders need a native brush adapter.',
            node,
          );
        if (
          sides.some(
            (side) =>
              css['border' + side + 'Color'] !== css.borderTopColor &&
              num(css['border' + side + 'Width']) > 0,
          )
        )
          report(
            'BROWSER_BORDER_COLOR',
            'Distinct per-side border colors need a native brush adapter.',
            node,
          );
      };
      let output;
      if (['input', 'textarea', 'button', 'select', 'progress'].includes(tag)) {
        const type = tag === 'input' ? node.type : tag;
        const nativeType =
          {
            button: 'Button',
            submit: 'Button',
            reset: 'Button',
            checkbox: 'CheckBox',
            radio: 'RadioButton',
            range: 'Slider',
            progress: 'ProgressBar',
            select: 'ComboBox',
          }[type] || 'TextBox';
        output = element(nativeType, { ...props, ...typography(css) });
        if (node.matches(':disabled')) output.props.IsEnabled = 'False';
        if (!['Slider', 'ProgressBar'].includes(nativeType)) {
          decorate(output);
          output.props.Padding = box(css, 'padding');
        }
        if (nativeType === 'TextBox') {
          output.props.Text = literal(
            type === 'password' && options.includePasswordValues !== true ? '' : node.value,
          );
          if (type === 'password') {
            if (framework === 'WPF') {
              output.type = 'PasswordBox';
              output.props.Password = output.props.Text;
              delete output.props.Text;
            } else output.props.PasswordChar = '●';
          }
          if (tag === 'textarea') output.props.AcceptsReturn = 'True';
          if (node.readOnly && output.type === 'TextBox') output.props.IsReadOnly = 'True';
        } else if (nativeType === 'Button')
          output.props.Content = literal(tag === 'button' ? node.innerText : node.value);
        else if (['CheckBox', 'RadioButton'].includes(nativeType)) {
          output.props.IsChecked = node.indeterminate ? '{x:Null}' : String(node.checked);
          if (node.indeterminate) output.props.IsThreeState = 'True';
          if (nativeType === 'RadioButton' && node.name)
            output.props.GroupName = literal(node.name);
        } else if (nativeType === 'ComboBox') {
          output.props.SelectedIndex = String(node.selectedIndex);
          output.children = [...node.options].map((option) =>
            element('ComboBoxItem', {
              Content: literal(option.text),
              IsEnabled: String(!option.disabled),
            }),
          );
          if (node.multiple)
            report(
              'BROWSER_MULTIPLE_SELECTION',
              'Multiple selections require a native multi-select adapter.',
              node,
            );
        } else {
          output.props.Minimum = node.min || '0';
          output.props.Maximum = node.max || (tag === 'progress' ? '1' : '100');
          output.props.Value = String(node.value);
        }
        report(
          'BROWSER_CONTROL_THEME',
          'Native control state and bounds are captured; browser and native control themes are not pixel-identical.',
          node,
        );
      } else if (
        ['img', 'svg', 'canvas', 'video', 'audio', 'iframe', 'object', 'embed'].includes(tag)
      ) {
        output = element('Canvas', props);
        report(
          'BROWSER_REPLACED_CONTENT',
          `${tag} requires an explicit image/media/native component adapter. No network resource or embedded document is loaded by this compiler.`,
          node,
        );
      } else {
        output = element('Canvas', props);
        if (
          ['hidden', 'clip', 'scroll', 'auto'].includes(css.overflowX) ||
          ['hidden', 'clip', 'scroll', 'auto'].includes(css.overflowY)
        )
          output.props.ClipToBounds = 'True';
        const border = element('Border', {
          Width: scalar(rect.width),
          Height: scalar(rect.height),
          IsHitTestVisible: 'False',
        });
        decorate(border);
        const radii = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(
          (side) => css['border' + side + 'Radius'],
        );
        if (radii.every((value) => /^\d+(?:\.\d+)?px$/.test(value)))
          border.props.CornerRadius = radii.map((value) => scalar(num(value))).join(',');
        else
          report(
            'BROWSER_BORDER_RADIUS',
            'Percentage or elliptical corners require a native geometry adapter.',
            node,
          );
        output.children.push(border);
        if (isTextTree(node) && node.textContent.trim()) {
          const text = makeText(node, rect, rect, false);
          // Native text is inset from the border, while browser padding starts inside it.
          text.props['Canvas.Left'] = scalar(num(css.borderLeftWidth));
          text.props['Canvas.Top'] = scalar(num(css.borderTopWidth));
          text.props.Width = scalar(
            Math.max(0, rect.width - num(css.borderLeftWidth) - num(css.borderRightWidth)),
          );
          text.props.Height = scalar(
            Math.max(0, rect.height - num(css.borderTopWidth) - num(css.borderBottomWidth)),
          );
          output.children.push(text);
        } else
          for (const child of node.childNodes) {
            if (child.nodeType === 1) {
              const converted = convert(child, rect, depth + 1);
              if (converted) output.children.push(converted);
            } else if (child.nodeType === 3 && child.textContent.trim()) {
              const range = document.createRange();
              range.selectNodeContents(child);
              const textRect = range.getBoundingClientRect();
              const text = element('TextBlock', {
                ...position({ id: '' }, textRect, rect),
                ...typography(css),
                Text: literal(child.textContent.replace(/\s+/g, ' ')),
                TextWrapping: 'Wrap',
              });
              output.children.push(text);
              if (range.getClientRects().length > 1)
                report(
                  'BROWSER_FRAGMENTED_TEXT',
                  'Direct multi-line anonymous text may wrap differently with native font metrics.',
                  node,
                );
            }
          }
      }
      map(node, output, rect);
      return output;
    };
    const output = convert(root, rootRect);
    if (!output) throw Error('The capture root is not a visual element.');
    output.props.xmlns = namespaces[framework];
    output.props['xmlns:x'] = 'http://schemas.microsoft.com/winfx/2006/xaml';
    const resultDocument = createDocument(
      output,
      framework,
      options.name || (framework === 'Avalonia' ? 'CapturedView.axaml' : 'CapturedView.xaml'),
    );
    validateDocument(resultDocument);
    const source = serializeXaml(resultDocument),
      index = buildSourceIndex(source, resultDocument);
    for (const entry of sourceMap) {
      const range = index.byId.get(entry.targetNodeId);
      if (range) entry.targetRange = { start: range.start, end: range.end };
    }
    report(
      'BROWSER_LAYOUT_SNAPSHOT',
      'Native measured boxes capture the current viewport, loaded stylesheets, form state and CSS environment. Recompile for responsive changes; scripts are not translated.',
      root,
      false,
    );
    report(
      'BROWSER_FONT_METRICS',
      'Text remains editable native text. Font fallback, shaping and line wrapping require native typography qualification.',
      root,
    );
    if (document.fonts?.status === 'loading')
      report(
        'BROWSER_FONTS_PENDING',
        'Fonts are still loading. Await document.fonts.ready before final capture.',
        root,
      );
    Object.assign(metadata, {
      sourceNodeCount: sourceNodes.length,
      browserCapture: {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        root: plainRect(rootRect),
        mode: 'measured',
        live: false,
      },
      geometry,
    });
    resultDocument.metadata.browserCapture = metadata.browserCapture;
    const success = !options.strict || losses.length === 0;
    if (!success)
      diagnostics.push({
        severity: 'error',
        code: 'STRICT_CONVERSION',
        message: 'Strict conversion rejected browser/native fidelity losses.',
      });
    return { success, source, document: resultDocument, diagnostics, losses, sourceMap, metadata };
  } catch (error) {
    diagnostics.push({ severity: 'error', code: 'BROWSER_CAPTURE_ERROR', message: error.message });
    return {
      success: false,
      source: '',
      document: null,
      diagnostics,
      losses,
      sourceMap: [],
      metadata,
    };
  }
}

/** Recapture on layout, DOM, styles, fonts and interaction changes. No polling or source mutation. */
export function observeRenderedDocument(
  root,
  { onResult, onError, mediaQueries = [], ...options } = {},
) {
  if (typeof onResult !== 'function') throw Error('onResult is required.');
  if (root?.nodeType === 9) root = root.body;
  const document = root?.ownerDocument,
    window = document?.defaultView;
  if (!root?.isConnected || !window) throw Error('A connected capture root is required.');
  const maxNodes = options.maxNodes ?? 10000;
  captureElements(root, maxNodes);
  let disposed = false,
    frame = null;
  const cleanup = [];
  const refresh = () => {
    if (disposed) return null;
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
    const result = compileRenderedDocument(root, options);
    if (!disposed) {
      try {
        onResult(result);
      } catch (error) {
        if (onError) onError(error);
        else throw error;
      }
    }
    return result;
  };
  const schedule = () => {
    if (!disposed && frame === null) frame = window.requestAnimationFrame(refresh);
  };
  const listen = (target, type) => {
    target.addEventListener(type, schedule, true);
    cleanup.push(() => target.removeEventListener(type, schedule, true));
  };
  const resize = new window.ResizeObserver(schedule);
  const observeSizes = () => {
    resize.disconnect();
    try {
      captureElements(root, maxNodes).forEach((node) => resize.observe(node));
    } catch {
      /* The scheduled capture reports an over-limit tree without an observer exception. */
    }
  };
  const mutations = new window.MutationObserver(() => {
    observeSizes();
    schedule();
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    resize.disconnect();
    mutations.disconnect();
    cleanup.forEach((remove) => remove());
  };
  try {
    observeSizes();
    mutations.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    if (document.head && !root.contains(document.head))
      mutations.observe(document.head, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    for (const type of [
      'input',
      'change',
      'click',
      'pointerover',
      'pointerout',
      'pointerdown',
      'pointerup',
      'focusin',
      'focusout',
      'scroll',
      'transitionend',
      'animationend',
    ])
      listen(root, type);
    for (const type of ['resize', 'scroll', 'hashchange']) listen(window, type);
    listen(document, 'load');
    if (document.fonts) listen(document.fonts, 'loadingdone');
    for (const query of new Set([
      '(prefers-color-scheme: dark)',
      '(prefers-reduced-motion: reduce)',
      '(forced-colors: active)',
      ...mediaQueries,
    ]))
      listen(window.matchMedia(query), 'change');
    schedule();
    return { refresh, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Produce explicit semantic variants; native layout remains fluid inside each variant. */
export function compileResponsiveVariants(input, { variants, ...options } = {}) {
  if (!Array.isArray(variants) || !variants.length || variants.length > 32)
    throw Error('Provide between 1 and 32 explicit environment variants.');
  const names = new Set();
  const profiles = variants.map((variant) => {
    if (
      typeof variant.name !== 'string' ||
      !/^[a-zA-Z][\w-]{0,63}$/.test(variant.name) ||
      names.has(variant.name)
    )
      throw Error('Variant names must be unique portable identifiers.');
    names.add(variant.name);
    if (![variant.width, variant.height].every((v) => Number.isFinite(v) && v > 0 && v <= 100000))
      throw Error('Every variant needs a finite positive width and height.');
    const environment = { type: 'screen', ...options.environment, ...variant };
    delete environment.name;
    return {
      name: variant.name,
      environment,
      result: compileDocument(input, { ...options, from: 'html', to: 'xaml', environment }),
    };
  });
  return { version: 1, success: profiles.every((profile) => profile.result.success), profiles };
}
