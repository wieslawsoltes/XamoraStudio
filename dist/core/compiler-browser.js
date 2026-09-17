/** Read-only bridge from a caller-owned, already-rendered DOM to native layout snapshots. */
import { element, textNode, createDocument } from './model.js';
import { compileDocument } from './semantic-compiler.js';

const nonvisual = new Set(['style', 'link', 'script', 'meta', 'title', 'head', 'base', 'template']);
const textTags = new Set('p pre span h1 h2 h3 h4 h5 h6 strong b em i u a br code'.split(' '));
const controlTags = new Set(
  'button input textarea select option img progress hr label details summary fieldset legend ul ol li'.split(
    ' ',
  ),
);
const cssNames = [
  'background-color',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'opacity',
  'text-align',
  'direction',
  'white-space',
];
function box(css, group, suffix = '') {
  return ['top', 'right', 'bottom', 'left']
    .map((side) => css.getPropertyValue(`${group}-${side}${suffix}`))
    .join(' ');
}
function computedValues(css, inline, container) {
  const values = Object.fromEntries(
    cssNames.map((name) => [name, css.getPropertyValue(name)]).filter(([, value]) => value),
  );
  // Geometry is taken from border boxes, not from unresolved computed size expressions.
  if (container)
    for (const name of [
      'color',
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'text-align',
      'white-space',
    ])
      delete values[name];
  if (inline) for (const name of ['opacity', 'text-align', 'white-space']) delete values[name];
  if (!inline) {
    values.padding = box(css, 'padding');
    values['border-width'] = box(css, 'border', '-width');
    // The scalar converter currently accepts a uniform native border brush.
    values['border-color'] = css.borderTopColor;
    if (css.display === 'none') values.display = 'none';
    if (css.visibility !== 'visible') values.visibility = css.visibility;
  }
  return values;
}

/** Capture synchronously. Never navigates, fetches, evaluates source, or changes the live tree. */
export function compileRenderedDocument(root, options = {}) {
  const document = root?.ownerDocument,
    window = document?.defaultView;
  if (!window || root.nodeType !== 1 || !root.isConnected)
    throw TypeError('A connected Element in a live Window is required.');
  if (nonvisual.has(root.localName) || root.localName === 'html')
    throw TypeError('Capture a body or visual subtree, not a document head/html wrapper.');
  if (
    options.includePasswordValues !== undefined &&
    typeof options.includePasswordValues !== 'boolean'
  )
    throw TypeError('includePasswordValues must be a boolean.');
  const maxNodes = options.maxRenderedNodes ?? 10000;
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 15000)
    throw RangeError('maxRenderedNodes must be between 1 and 15000.');
  const snapshot = new Map(),
    issues = [];
  let count = 0;
  const issue = (code, message, node, loss = true) =>
    issues.push({ severity: loss ? 'warning' : 'info', code, message, nodeId: node.id, loss });
  const rect = (r) => {
    const result = { x: r.x, y: r.y, width: r.width, height: r.height };
    if (!Object.values(result).every(Number.isFinite))
      throw RangeError('The browser returned nonfinite layout geometry.');
    return result;
  };
  const read = (native, inline = false, depth = 0) => {
    if (++count > maxNodes || depth > 128)
      throw RangeError('Rendered document exceeds its node/depth budget.');
    if (native.nodeType === 8) return { ...textNode(native.nodeValue || ''), kind: 'comment' };
    if (native.nodeType === 3) return textNode(native.nodeValue || '');
    if (native.nodeType !== 1) return null;
    const tag = native.localName,
      n = element(tag, Object.fromEntries([...native.attributes].map((a) => [a.name, a.value])));
    if (nonvisual.has(tag)) {
      n.children = [...native.childNodes]
        .map((child) => read(child, false, depth + 1))
        .filter(Boolean);
      return n;
    }
    const css = window.getComputedStyle(native),
      bounds = rect(native.getBoundingClientRect());
    const isInline = inline && textTags.has(tag),
      container = !textTags.has(tag) && !controlTags.has(tag);
    const record = {
      css: computedValues(css, isInline, container),
      bounds,
      container,
      inline: isInline,
      clip:
        /^(hidden|clip|scroll|auto)$/.test(css.overflowX) ||
        /^(hidden|clip|scroll|auto)$/.test(css.overflowY),
      zIndex: /^-?\d+$/.test(css.zIndex) ? Number(css.zIndex) : undefined,
      radius: css.borderTopLeftRadius,
      visible:
        css.display !== 'none' && css.visibility !== 'hidden' && css.visibility !== 'collapse',
    };
    snapshot.set(n.id, record);
    if (tag === 'input') {
      // Redact both authored and current values before semantic/round-trip metadata
      // is generated. Reading a live DOM must not export passwords by default.
      const redact = native.type === 'password' && options.includePasswordValues !== true;
      n.props.value = redact ? '' : native.value;
      if (redact)
        issue(
          'BROWSER_PASSWORD_REDACTED',
          'Password input values were omitted. Explicit includePasswordValues consent is required to export them.',
          n,
          false,
        );
      if (native.checked) n.props.checked = '';
      else delete n.props.checked;
    }
    if (tag === 'option') {
      if (native.selected) n.props.selected = '';
      else delete n.props.selected;
    }
    if ('disabled' in native && native.matches(':disabled')) n.props.disabled = '';
    if (native.shadowRoot || tag.includes('-'))
      issue(
        'BROWSER_SHADOW_TREE',
        'Shadow/custom-element behavior is not represented by a light-DOM native snapshot.',
        n,
      );
    if (['canvas', 'video', 'audio', 'iframe', 'svg'].includes(tag))
      issue(
        'BROWSER_REPLACED_CONTENT',
        `${tag} paint or embedded execution requires a target adapter.`,
        n,
      );
    if (
      css.transform !== 'none' ||
      (css.rotate && css.rotate !== 'none') ||
      (css.scale && css.scale !== 'none') ||
      (css.translate && css.translate !== 'none')
    )
      issue(
        'BROWSER_TRANSFORM',
        'Transformed border bounds were measured; transform paint and transformed descendants require a native transform adapter.',
        n,
      );
    for (const [name, baseline] of [
      ['backgroundImage', 'none'],
      ['boxShadow', 'none'],
      ['filter', 'none'],
      ['clipPath', 'none'],
      ['mixBlendMode', 'normal'],
    ])
      if (css[name] && css[name] !== baseline)
        issue(
          'BROWSER_PAINT',
          `${name} is retained in source metadata but is not reproduced by scalar native paint.`,
          n,
        );
    if (
      css.overflowX === 'scroll' ||
      css.overflowY === 'scroll' ||
      (native.scrollHeight > native.clientHeight + 1 && css.overflowY === 'auto') ||
      (native.scrollWidth > native.clientWidth + 1 && css.overflowX === 'auto')
    )
      issue(
        'BROWSER_SCROLL_STATE',
        'Current scrolled positions are captured; native scrolling behavior requires a ScrollViewer adapter.',
        n,
      );
    if (new Set(['Top', 'Right', 'Bottom', 'Left'].map((s) => css[`border${s}Color`])).size > 1)
      issue(
        'BROWSER_BORDER_BRUSH',
        'Different side border colors require a native border-paint adapter.',
        n,
      );
    if (
      ['Top', 'Right', 'Bottom', 'Left'].some(
        (s) => !['none', 'hidden', 'solid'].includes(css[`border${s}Style`]),
      )
    )
      issue(
        'BROWSER_BORDER_STYLE',
        'Non-solid side borders require a native border-paint adapter.',
        n,
      );
    for (const pseudo of ['::before', '::after']) {
      const generated = window.getComputedStyle(native, pseudo);
      if (generated.content && !['none', 'normal', '""'].includes(generated.content))
        issue(
          'BROWSER_GENERATED_CONTENT',
          `${pseudo} generated content is not a light-DOM node; provide an explicit native content adapter.`,
          n,
        );
    }
    if (css.animationName && css.animationName !== 'none')
      issue(
        'BROWSER_ANIMATION_SAMPLE',
        'Animated values are sampled at capture time, not translated into a continuous native animation.',
        n,
      );
    if (
      !container &&
      !isInline &&
      ['button', 'input', 'textarea', 'select', 'progress', 'details', 'fieldset'].includes(tag)
    )
      issue(
        'BROWSER_NATIVE_THEME',
        'Control state and outer bounds are captured; native control templates do not have browser-identical paint.',
        n,
      );
    const childInline = textTags.has(tag) || tag === 'button' || tag === 'label';
    n.children =
      tag === 'textarea'
        ? [textNode(native.value)]
        : [...native.childNodes]
            .map((child) => read(child, childInline, depth + 1))
            .filter(Boolean);
    // A Canvas cannot contain raw text. Measure each direct text run independently.
    if (container) {
      n.children = n.children.map((child, index) => {
        if (child.kind !== 'text') return child;
        const nativeChild = [...native.childNodes].filter((c) => [1, 3, 8].includes(c.nodeType))[
          index
        ];
        if (!child.text.trim()) return child; // collapsed whitespace never becomes a visible control
        const range = document.createRange();
        range.selectNodeContents(nativeChild);
        const textBounds = rect(range.getBoundingClientRect());
        const host = element('span', {}, [child]);
        const values = computedValues(css, false, false);
        delete values.padding;
        delete values['border-width'];
        delete values['border-color'];
        delete values['background-color'];
        snapshot.set(host.id, {
          css: values,
          bounds: textBounds,
          container: false,
          inline: false,
          visible: record.visible,
        });
        if (range.getClientRects().length > 1)
          issue(
            'BROWSER_FRAGMENTED_TEXT',
            'A direct text run spans multiple line fragments; native font shaping may differ.',
            host,
          );
        range.detach();
        return host;
      });
    }
    if (isInline && native.getClientRects().length > 1)
      issue(
        'BROWSER_FRAGMENTED_INLINE',
        'A fragmented inline retains semantic text; native glyph placement may differ.',
        n,
      );
    return n;
  };
  const captured = read(root);
  const head = element(
    'head',
    {},
    [...(document.head?.querySelectorAll('style,link[rel~="stylesheet"]') || [])]
      .map((native) => read(native))
      .filter(Boolean),
  );
  const body = root.localName === 'body' ? captured : element('body', {}, [captured]);
  const input = createDocument(
    element('html', {}, [head, body]),
    'HTML',
    options.sourceName || 'rendered.html',
  );
  const result = compileDocument(input, {
    ...options,
    from: 'html',
    to: 'xaml',
    renderSnapshot: snapshot,
    baseUrl: options.baseUrl || document.baseURI,
  });
  const diagnostic = {
    severity: 'info',
    code: 'BROWSER_LAYOUT_SNAPSHOT',
    message:
      'Native positions and sizes represent the current browser layout. Observe the live source to regenerate after responsive or state changes; this is not an autonomous CSS or JavaScript runtime.',
  };
  result.diagnostics.push(diagnostic, ...issues.map(({ loss, ...d }) => d));
  result.losses.push(...issues.filter((i) => i.loss).map(({ loss, ...d }) => d));
  result.metadata.rendered = {
    width: root.getBoundingClientRect().width,
    height: root.getBoundingClientRect().height,
    nodes: snapshot.size,
    mode: 'browser-snapshot',
  };
  if (options.strict && issues.some((i) => i.loss)) {
    result.success = false;
    if (!result.diagnostics.some((d) => d.code === 'STRICT_CONVERSION'))
      result.diagnostics.push({
        severity: 'error',
        code: 'STRICT_CONVERSION',
        message: 'Strict capture rejected unsupported native behavior or paint.',
      });
  }
  return result;
}

/** Coalesce live DOM/layout/state changes. The caller owns source execution and target updates. */
export function observeRenderedDocument(root, options = {}) {
  const window = root?.ownerDocument?.defaultView;
  if (!window || !root.isConnected || typeof options.onResult !== 'function')
    throw TypeError('A live root and onResult callback are required.');
  if (typeof window.ResizeObserver !== 'function' || typeof window.MutationObserver !== 'function')
    throw TypeError('Live observation requires ResizeObserver and MutationObserver.');
  if (options.onError !== undefined && typeof options.onError !== 'function')
    throw TypeError('onError must be a function.');
  if (
    options.observeMedia !== undefined &&
    (!Array.isArray(options.observeMedia) ||
      options.observeMedia.length > 256 ||
      options.observeMedia.some((q) => typeof q !== 'string'))
  )
    throw TypeError('observeMedia must be an array of at most 256 media queries.');
  const { onResult, onError, ...compilerOptions } = options;
  let disposed = false,
    frame = 0,
    capturing = false,
    revision = 0;
  const listeners = [];
  const refresh = () => {
    if (disposed || capturing) return null;
    if (frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
    capturing = true;
    try {
      const result = compileRenderedDocument(root, compilerOptions);
      if (!disposed) onResult(result, ++revision);
      return result;
    } catch (error) {
      if (!disposed && onError) onError(error);
      else throw error;
      return null;
    } finally {
      capturing = false;
    }
  };
  const schedule = () => {
    if (!disposed && !frame)
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        try {
          refresh();
        } catch (error) {
          window.reportError?.(error);
        }
      });
  };
  const listen = (target, name) => {
    target.addEventListener(name, schedule, true);
    listeners.push(() => target.removeEventListener(name, schedule, true));
  };
  let resize, mutation, ancestors;
  const observed = new Set();
  function observeChildren() {
    const live = new Set([root, ...root.querySelectorAll('*')]);
    for (const n of observed)
      if (!live.has(n)) {
        resize.unobserve(n);
        observed.delete(n);
      }
    for (const n of live)
      if (!observed.has(n)) {
        resize.observe(n);
        observed.add(n);
      }
  }
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    mutation?.disconnect();
    ancestors?.disconnect();
    resize?.disconnect();
    observed.clear();
    for (const stop of listeners.splice(0)) stop();
  };
  // Setup is transactional too: a failing observer/media adapter must not leave
  // resize observers or capturing event listeners attached to the caller's DOM.
  try {
    resize = new window.ResizeObserver(schedule);
    mutation = new window.MutationObserver(() => {
      observeChildren();
      schedule();
    });
    ancestors = new window.MutationObserver(schedule);
    observeChildren();
    mutation.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    for (let n = root.parentElement; n; n = n.parentElement)
      ancestors.observe(n, { attributes: true });
    if (root.ownerDocument.head)
      ancestors.observe(root.ownerDocument.head, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    for (const name of [
      'input',
      'change',
      'focusin',
      'focusout',
      'pointerover',
      'pointerout',
      'pointerdown',
      'pointerup',
      'scroll',
      'load',
      'animationend',
      'transitionend',
    ])
      listen(root, name);
    for (const name of ['resize', 'scroll', 'hashchange']) listen(window, name);
    // Linked stylesheets can finish loading outside the captured subtree.
    listen(root.ownerDocument, 'load');
    if (root.ownerDocument.fonts) {
      listen(root.ownerDocument.fonts, 'loadingdone');
      if (root.ownerDocument.fonts.status === 'loading')
        void root.ownerDocument.fonts.ready.then(schedule, schedule);
    }
    const queries = new Set([
      '(prefers-color-scheme: dark)',
      '(prefers-reduced-motion: reduce)',
      '(forced-colors: active)',
      ...(options.observeMedia || []),
    ]);
    for (const query of queries) listen(window.matchMedia(query), 'change');
    refresh();
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    refresh,
    schedule,
    dispose,
    get revision() {
      return revision;
    },
  };
}

/** Compile named point-in-time profiles; the caller selects/apply results in its native host. */
export function compileResponsiveVariants(input, { variants, ...options } = {}) {
  if (!Array.isArray(variants) || !variants.length || variants.length > 32)
    throw RangeError('Provide between 1 and 32 explicit environment variants.');
  const names = new Set();
  // Validate the whole request before invoking any caller-provided compiler hooks.
  const profiles = variants.map((variant) => {
    if (
      !variant ||
      typeof variant.name !== 'string' ||
      !/^[a-zA-Z][\w-]{0,63}$/.test(variant.name) ||
      names.has(variant.name)
    )
      throw TypeError('Variant names must be unique portable identifiers.');
    names.add(variant.name);
    if (![variant.width, variant.height].every((v) => Number.isFinite(v) && v > 0 && v <= 100000))
      throw RangeError('Every variant needs a finite positive width and height, at most 100000.');
    const { name, ...values } = variant;
    const environment = {
      type: 'screen',
      ...options.environment,
      ...values,
      // A stale base viewport must not disagree with the named profile's media width.
      viewport: { width: variant.width, height: variant.height },
    };
    return { name, environment };
  });
  const results = profiles.map((profile) => ({
    ...profile,
    result: compileDocument(input, {
      ...options,
      from: 'html',
      to: 'xaml',
      environment: profile.environment,
    }),
  }));
  return {
    version: 1,
    success: results.every((profile) => profile.result.success),
    profiles: results,
  };
}
