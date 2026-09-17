/** Bidirectional semantic lowering over the same DesignDocument tree used by the editor.
 * Unknown constructs are never executed. Portable metadata preserves authoring data,
 * while diagnostics describe where the target cannot reproduce source behavior.
 */
import {
  element,
  textNode,
  createDocument,
  clone,
  walk,
  localName,
  isProperty,
  validateDocument,
} from './model.js';
import { parseXaml, serializeXaml, namespaces } from './xaml.js';
import {
  parseHtml,
  serializeHtml,
  cssDeclarations,
  HTML_VOID,
  HTML_RAW,
  htmlBody,
} from './html.js';
import { buildSourceIndex } from './source-syntax.js';
import { listStoryboards, storyboardTracks, parseTime, formatTime } from './animation.js';
import { findResource, resolveStyle, selectStyles } from './styling.js';
import { ensureTransformPath } from './property-path.js';
import { parseCssAnimationStylesheet, splitCssList } from './html-animation.js';
import { collectCompilerCss } from './compiler-css.js';
import { resolveCssLength } from './compiler-environment.js';

export const SEMANTIC_COMPILER_VERSION = 1;
export const WEB_NAMESPACE = 'urn:xamora:web';
const XAML_NAMESPACE = 'http://schemas.microsoft.com/winfx/2006/xaml';
const XML_NAME = /^[A-Za-z_][\w.:-]*$/;
const META_HTML = 'data-xamora-xaml',
  META_XAML = 'web:Source.Metadata';
const ignoredVisual = new Set([
  'ResourceDictionary',
  'Style',
  'Setter',
  'ControlTheme',
  'ControlTemplate',
  'DataTemplate',
  'RowDefinition',
  'ColumnDefinition',
  'Storyboard',
  'ParallelTimeline',
  'VisualStateGroup',
  'VisualState',
  'EventTrigger',
  'Trigger',
  'BeginStoryboard',
  'SolidColorBrush',
  'Color',
  'Double',
  'String',
  'TransformGroup',
  'ScaleTransform',
  'TranslateTransform',
  'RotateTransform',
]);
const controls = {
  UserControl: 'div',
  Window: 'main',
  Page: 'main',
  ContentControl: 'div',
  ContentPresenter: 'div',
  Border: 'div',
  Grid: 'div',
  Canvas: 'div',
  StackPanel: 'div',
  DockPanel: 'div',
  WrapPanel: 'div',
  ScrollViewer: 'div',
  TextBlock: 'span',
  Run: 'span',
  Span: 'span',
  Bold: 'strong',
  Italic: 'em',
  Underline: 'u',
  LineBreak: 'br',
  Label: 'label',
  Button: 'button',
  RepeatButton: 'button',
  ToggleButton: 'button',
  TextBox: 'input',
  PasswordBox: 'input',
  CheckBox: 'input',
  RadioButton: 'input',
  ComboBox: 'select',
  ComboBoxItem: 'option',
  ListBox: 'ul',
  ListBoxItem: 'li',
  ItemsControl: 'div',
  Image: 'img',
  Slider: 'input',
  ProgressBar: 'progress',
  Separator: 'hr',
  Hyperlink: 'a',
  Expander: 'details',
  GroupBox: 'fieldset',
  Viewbox: 'div',
  Rectangle: 'div',
  Ellipse: 'div',
};
const cssProperties = {
  Width: 'width',
  Height: 'height',
  MinWidth: 'min-width',
  MinHeight: 'min-height',
  MaxWidth: 'max-width',
  MaxHeight: 'max-height',
  Background: 'background-color',
  Foreground: 'color',
  FontFamily: 'font-family',
  FontSize: 'font-size',
  FontWeight: 'font-weight',
  FontStyle: 'font-style',
  Opacity: 'opacity',
  Margin: 'margin',
  Padding: 'padding',
  BorderThickness: 'border-width',
  BorderBrush: 'border-color',
  CornerRadius: 'border-radius',
  'Canvas.Left': 'left',
  'Canvas.Top': 'top',
  'Canvas.Right': 'right',
  'Canvas.Bottom': 'bottom',
  'Panel.ZIndex': 'z-index',
  Spacing: 'gap',
  RowSpacing: 'row-gap',
  ColumnSpacing: 'column-gap',
  TextAlignment: 'text-align',
  FlowDirection: 'direction',
  HorizontalContentAlignment: 'justify-content',
  VerticalContentAlignment: 'align-items',
  HorizontalAlignment: 'justify-self',
  VerticalAlignment: 'align-self',
  TextWrapping: 'white-space',
  TextDecorations: 'text-decoration-line',
  Cursor: 'cursor',
  ClipToBounds: 'overflow',
  Fill: 'background-color',
  Stroke: 'border-color',
  StrokeThickness: 'border-width',
};
const attrProperties = {
  'x:Name': 'id',
  Name: 'id',
  AutomationId: 'id',
  'AutomationProperties.Name': 'aria-label',
  ToolTip: 'title',
  Tag: 'data-tag',
  Source: 'src',
  NavigateUri: 'href',
  IsEnabled: 'disabled',
  IsChecked: 'checked',
  IsSelected: 'selected',
  GroupName: 'name',
  IsReadOnly: 'readonly',
  MaxLength: 'maxlength',
  TabIndex: 'tabindex',
  Minimum: 'min',
  Maximum: 'max',
  Value: 'value',
  PlaceholderText: 'placeholder',
  Watermark: 'placeholder',
};
const lengths = new Set([
  'Width',
  'Height',
  'MinWidth',
  'MinHeight',
  'MaxWidth',
  'MaxHeight',
  'FontSize',
  'Canvas.Left',
  'Canvas.Top',
  'Canvas.Right',
  'Canvas.Bottom',
  'Spacing',
  'RowSpacing',
  'ColumnSpacing',
  'StrokeThickness',
]);
const thickness = new Set(['Margin', 'Padding', 'BorderThickness']);
const colors = new Set(['Background', 'Foreground', 'BorderBrush', 'Fill', 'Stroke']);
const eventNames = {
  Click: 'click',
  Tapped: 'click',
  DoubleTapped: 'dblclick',
  PointerPressed: 'pointerdown',
  PointerReleased: 'pointerup',
  PointerEntered: 'pointerenter',
  PointerExited: 'pointerleave',
  KeyDown: 'keydown',
  KeyUp: 'keyup',
  TextChanged: 'input',
  SelectionChanged: 'change',
  Checked: 'change',
  Unchecked: 'change',
  Loaded: 'load',
};
const reverseEvents = Object.fromEntries(
  Object.entries(eventNames)
    .reverse()
    .map(([a, b]) => [b, a]),
);
const align = {
  Left: 'start',
  Top: 'start',
  Right: 'end',
  Bottom: 'end',
  Center: 'center',
  Stretch: 'stretch',
};
const textContent = (n) =>
  (n.children || [])
    .filter((c) => ['text', 'cdata'].includes(c.kind))
    .map((c) => c.text)
    .join('');
const inlineXamlTypes = new Set([
  'Run',
  'Span',
  'Bold',
  'Italic',
  'Underline',
  'Hyperlink',
  'LineBreak',
]);
const inlineHtmlTypes = new Set(['span', 'strong', 'b', 'em', 'i', 'u', 'a', 'br']);
const isVisual = (n) =>
  n.kind !== 'element' || (!isProperty(n) && !ignoredVisual.has(localName(n.type)));
const safeName = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
const literal = (value) =>
  String(value).startsWith('{}') ? String(value).slice(2) : String(value);
const unit = (v) =>
  /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v) ? v + 'px' : /^Auto$/i.test(v) ? 'auto' : v;
function number(value) {
  const v = String(value).trim();
  if (/^auto$/i.test(v)) return 'Auto';
  const match = v.match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)(px|in|cm|mm|q|pt|pc)?$/i);
  if (!match) return null;
  const units = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16 };
  const result = Number(match[1]) * (units[match[2]?.toLowerCase()] || 1);
  return Number.isFinite(result) ? String(Number(result.toPrecision(15))) : null;
}
const has = (o, k) => Object.hasOwn(o, k);
const put = (o, k, v) =>
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
// Keep declarations ordered: a later normal value must not erase an earlier !important one.
function stripCssComments(source) {
  let result = '',
    quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      result += c + (source[++i] || '');
      continue;
    }
    if (quote) {
      result += c;
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      result += c;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    result += c;
  }
  return result;
}
function styleEntries(source = '') {
  return cssDeclarations(source).flatMap((raw) => {
    const match = stripCssComments(raw).match(/^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*;?\s*$/);
    if (!match) return [];
    const key = match[1].startsWith('--') ? match[1] : match[1].toLowerCase();
    return [[key, match[2]]];
  });
}
function styleObject(source = '') {
  const result = {};
  for (const [key, value] of styleEntries(source)) {
    if (/!\s*important\s*$/i.test(result[key] || '') && !/!\s*important\s*$/i.test(value)) continue;
    put(result, key, value);
  }
  return result;
}
const inheritedCss = new Set(
  'color font-family font-size font-weight font-style line-height text-align white-space visibility cursor direction'.split(
    ' ',
  ),
);
const initialCss = {
  color: 'black',
  'font-weight': 'normal',
  'font-style': 'normal',
  'text-align': 'start',
  direction: 'ltr',
  'white-space': 'normal',
  visibility: 'visible',
  opacity: '1',
  width: 'auto',
  height: 'auto',
  'background-color': 'transparent',
  'min-width': '0',
  'min-height': '0',
};
const boxCss = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  'border-width': [
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
  ],
};
function cssBoxValues(value) {
  const parts = splitCssList(value, ' ');
  if (!parts.length || parts.length > 4) return null;
  const [a, b = a, c = a, d = b] = parts;
  return [a, b, c, d];
}
function compareCssPriority(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
// Balanced var() substitution, including nested fallback values and case-sensitive names.
function substituteCssVariables(source, lookup, depth = 0, inspectFallback = false) {
  if (depth > 64 || source.length > 65536) return null;
  let out = '',
    quote = '';
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (c === '\\') {
      out += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (quote) {
      out += c;
      i++;
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (source.slice(i, i + 4).toLowerCase() !== 'var(' || (i && /[\w-]/.test(source[i - 1]))) {
      out += c;
      i++;
      continue;
    }
    let end = i + 4,
      nesting = 1,
      comma = -1,
      innerQuote = '';
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === '\\') {
        end++;
        continue;
      }
      if (innerQuote) {
        if (ch === innerQuote) innerQuote = '';
        continue;
      }
      if (ch === '"' || ch === "'") {
        innerQuote = ch;
        continue;
      }
      if (ch === '(') nesting++;
      if (ch === ')') {
        nesting--;
        if (!nesting) break;
      }
      if (ch === ',' && nesting === 1 && comma < 0) comma = end;
    }
    if (nesting) return null;
    const name = source.slice(i + 4, comma < 0 ? end : comma).trim();
    if (!/^--[\w-]+$/.test(name)) return null;
    let value = lookup(name);
    if ((value == null || inspectFallback) && comma >= 0) {
      const fallback = substituteCssVariables(
        source.slice(comma + 1, end).trim(),
        lookup,
        depth + 1,
        inspectFallback,
      );
      if (value == null) value = fallback;
    }
    if (value == null) return null;
    // A substitution cannot merge number/identifier tokens into a new CSS dimension.
    const token = (c) => !!c && /[\w-]/.test(c);
    if (token(out.at(-1)) && token(value[0])) out += '/**/';
    out += value;
    if (token(value.at(-1)) && token(source[end + 1])) out += '/**/';
    if (out.length > 65536) return null;
    i = end + 1;
  }
  return out;
}
function computedCssVariables(values) {
  const dependencies = new Map(),
    cyclic = new Set(),
    active = [],
    visited = new Set(),
    resolved = new Map();
  for (const [name, value] of Object.entries(values)) {
    const refs = new Set();
    // Unused fallbacks also contribute edges to the custom-property dependency graph.
    substituteCssVariables(
      value,
      (ref) => {
        refs.add(ref);
        return '';
      },
      0,
      true,
    );
    dependencies.set(name, refs);
  }
  const visit = (name) => {
    const index = active.indexOf(name);
    if (index >= 0) {
      for (const key of active.slice(index)) cyclic.add(key);
      return;
    }
    if (visited.has(name) || !dependencies.has(name)) return;
    if (active.length >= 64) {
      cyclic.add(name);
      return;
    }
    active.push(name);
    for (const ref of dependencies.get(name)) visit(ref);
    active.pop();
    visited.add(name);
  };
  for (const name of dependencies.keys()) visit(name);
  const lookup = (name, depth = 0) => {
    if (resolved.has(name)) return resolved.get(name);
    if (cyclic.has(name) || !has(values, name) || depth > 64) return null;
    const result = substituteCssVariables(values[name], (ref) => lookup(ref, depth + 1));
    resolved.set(name, result);
    return result;
  };
  for (const name of dependencies.keys()) lookup(name);
  return lookup;
}
function styleText(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${value};`)
    .join(' ');
}
function rawNode(node) {
  if (node.kind !== 'element') return { kind: node.kind, text: node.text };
  return {
    kind: 'element',
    type: node.type,
    props: { ...node.props },
    children: node.children.map(rawNode),
  };
}
function restoreNode(node, depth = 0) {
  if (depth > 140 || !node || typeof node !== 'object')
    throw Error('Invalid portable metadata tree.');
  if (node.kind === 'element') {
    if (
      !XML_NAME.test(node.type) ||
      !node.props ||
      typeof node.props !== 'object' ||
      Array.isArray(node.props) ||
      !Array.isArray(node.children)
    )
      throw Error('Invalid portable metadata element.');
    return element(
      node.type,
      { ...node.props },
      node.children.map((n) => restoreNode(n, depth + 1)),
    );
  }
  if (!['text', 'cdata', 'comment', 'pi'].includes(node.kind) || typeof node.text !== 'string')
    throw Error('Invalid portable metadata leaf.');
  return { ...textNode(node.text), kind: node.kind };
}
function encodeMeta(value) {
  return JSON.stringify({ version: 1, ...value });
}
function webMetadata(node, ctx) {
  const props = node.props || {};
  for (const key of Object.keys(props)) {
    if (!key.endsWith(':Source.Metadata')) continue;
    const prefix = key.split(':')[0],
      namespace =
        node.scope?.[prefix] ||
        props['xmlns:' + prefix] ||
        ctx?.input?.root?.props?.['xmlns:' + prefix];
    if (namespace === WEB_NAMESPACE || (key === META_XAML && !namespace)) return props[key];
  }
  return undefined;
}
function declarePortableNamespace(root) {
  const choose = (preferred, uri) => {
    const existing = Object.keys(root.props).find(
      (key) => key.startsWith('xmlns:') && root.props[key] === uri,
    );
    if (existing) return existing.slice(6);
    let prefix = preferred,
      index = 1;
    while (root.props['xmlns:' + prefix] && root.props['xmlns:' + prefix] !== uri)
      prefix = preferred + index++;
    root.props['xmlns:' + prefix] = uri;
    return prefix;
  };
  const prefix = choose('web', WEB_NAMESPACE),
    mc = choose('mc', 'http://schemas.openxmlformats.org/markup-compatibility/2006');
  if (prefix !== 'web')
    walk(root, (node) => {
      if (node.props && has(node.props, META_XAML)) {
        node.props[prefix + ':Source.Metadata'] = node.props[META_XAML];
        delete node.props[META_XAML];
      }
    });
  root.props[mc + ':Ignorable'] = [
    ...new Set(
      String(root.props[mc + ':Ignorable'] || '')
        .split(/\s+/)
        .filter(Boolean)
        .concat(prefix),
    ),
  ].join(' ');
}
function decodeMeta(value, ctx, node) {
  if (!value) return null;
  try {
    if (value.length > 1_500_000) throw Error('Portable metadata exceeds 1.5 MB.');
    const result = JSON.parse(value);
    if (
      result.version !== 1 ||
      !XML_NAME.test(result.type) ||
      !result.props ||
      typeof result.props !== 'object' ||
      Array.isArray(result.props) ||
      !result.generated ||
      typeof result.generated !== 'object'
    )
      throw Error('Unknown portable metadata version or schema.');
    return result;
  } catch (error) {
    ctx.report('warning', 'INVALID_METADATA', error.message, node, true);
    return null;
  }
}
function toCssColor(value) {
  return /^#[\da-f]{8}$/i.test(value)
    ? '#' + value.slice(3) + value.slice(1, 3)
    : /^#[\da-f]{4}$/i.test(value)
      ? '#' + value[2] + value[3] + value[4] + value[1]
      : value;
}
function toXamlColor(value) {
  const rgb = value.match(/^rgba?\((.*)\)$/i);
  if (rgb) {
    const body = rgb[1].trim(),
      legacy = body.includes(','),
      parts = legacy ? splitCssList(body) : body.split(/\s*\/\s*|\s+/),
      component = (part, scale) => {
        const match = part?.match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+))(%?)$/);
        if (!match) return null;
        const v = match[2] ? Number(match[1]) / 100 : Number(match[1]) / scale;
        return Math.round(Math.max(0, Math.min(1, v)) * 255)
          .toString(16)
          .padStart(2, '0')
          .toUpperCase();
      };
    if (
      (!legacy &&
        ((parts.length === 4 && !body.includes('/')) || (body.match(/\//g) || []).length > 1)) ||
      ![3, 4].includes(parts.length) ||
      (legacy &&
        parts.slice(0, 3).some((p) => p.endsWith('%')) &&
        !parts.slice(0, 3).every((p) => p.endsWith('%')))
    )
      return null;
    const channels = parts.slice(0, 3).map((p) => component(p, 255)),
      alpha = component(parts[3] ?? '1', 1);
    return channels.includes(null) || alpha === null ? null : '#' + alpha + channels.join('');
  }
  if (/[()]/.test(value)) return null;
  return /^#[\da-f]{8}$/i.test(value)
    ? '#' + value.slice(7) + value.slice(1, 7)
    : /^#[\da-f]{4}$/i.test(value)
      ? '#' + value[4] + value[1] + value[2] + value[3]
      : value;
}
function xamlThickness(value) {
  const values = value.trim().split(/[,\s]+/);
  if (![1, 2, 4].includes(values.length) || values.some((v) => number(v) === null)) return null;
  return (
    values.length === 4
      ? [values[1], values[2], values[3], values[0]]
      : values.length === 2
        ? [values[1], values[0]]
        : values
  )
    .map(unit)
    .join(' ');
}
function cssThickness(value) {
  const values = value.trim().split(/\s+/).map(number);
  if (values.some((v) => v === null) || !values.length || values.length > 4) return null;
  const [top, right = top, bottom = top, left = right] = values;
  // Cascading expands shorthands to four sides. Preserve the established compact
  // XAML spelling for uniform boxes after unit conversion and longhand overrides.
  return [right, bottom, left].every((value) => value === top)
    ? top
    : [left, top, right, bottom].join(',');
}
function cssValue(key, value, ctx, node) {
  value = literal(value);
  if (lengths.has(key)) return unit(value);
  if (thickness.has(key)) return xamlThickness(value);
  if (colors.has(key)) return toCssColor(value);
  if (key === 'CornerRadius')
    return value
      .split(/[,\s]+/)
      .map(unit)
      .join(' ');
  if (/Alignment$/.test(key) && key !== 'TextAlignment') return align[value] || value.toLowerCase();
  if (key === 'TextAlignment' || key === 'FontStyle') return value.toLowerCase();
  if (key === 'FlowDirection') return value === 'RightToLeft' ? 'rtl' : 'ltr';
  if (key === 'TextWrapping') return value === 'NoWrap' ? 'nowrap' : 'normal';
  if (key === 'TextDecorations')
    return (
      { Underline: 'underline', Strikethrough: 'line-through', OverLine: 'overline', None: 'none' }[
        value
      ] ?? null
    );
  if (key === 'ClipToBounds') return /^true$/i.test(value) ? 'hidden' : 'visible';
  return value;
}
function xamlValue(key, value, css = {}) {
  value = String(value).replace(/\s*!important\s*$/i, '');
  if (lengths.has(key)) return number(value);
  if (thickness.has(key)) return cssThickness(value);
  if (colors.has(key)) return toXamlColor(value);
  if (key === 'CornerRadius') {
    const values = value.split(/\s+/).map(number);
    return values.every((v) => v !== null) && [1, 4].includes(values.length)
      ? values.join(',')
      : null;
  }
  if (/Alignment$/.test(key) && key !== 'TextAlignment')
    return (
      {
        start: key.startsWith('Vertical') ? 'Top' : 'Left',
        'flex-start': key.startsWith('Vertical') ? 'Top' : 'Left',
        end: key.startsWith('Vertical') ? 'Bottom' : 'Right',
        'flex-end': key.startsWith('Vertical') ? 'Bottom' : 'Right',
        center: 'Center',
        stretch: 'Stretch',
      }[value] || null
    );
  if (key === 'FontStyle')
    return { normal: 'Normal', italic: 'Italic', oblique: 'Oblique' }[value.toLowerCase()] ?? null;
  if (key === 'FlowDirection')
    return { ltr: 'LeftToRight', rtl: 'RightToLeft' }[value.toLowerCase()] ?? null;
  if (key === 'TextAlignment') {
    const rtl = css.direction === 'rtl';
    return (
      {
        left: 'Left',
        right: 'Right',
        center: 'Center',
        justify: 'Justify',
        start: rtl ? 'Right' : 'Left',
        end: rtl ? 'Left' : 'Right',
      }[value.toLowerCase()] ?? null
    );
  }
  if (key === 'TextWrapping')
    return ['nowrap', 'pre'].includes(value)
      ? 'NoWrap'
      : ['normal', 'pre-wrap', 'pre-line', 'break-spaces'].includes(value)
        ? 'Wrap'
        : null;
  if (key === 'TextDecorations')
    return (
      {
        underline: 'Underline',
        'line-through': 'Strikethrough',
        overline: 'OverLine',
        none: 'None',
      }[value] ?? null
    );
  if (key === 'ClipToBounds') return value === 'hidden' ? 'True' : 'False';
  return value;
}
function cssTrack(value) {
  const text = String(value).trim();
  return text === '*'
    ? 'minmax(0, 1fr)'
    : /^\d+(?:\.\d+)?\*$/.test(text)
      ? `minmax(0, ${text.slice(0, -1)}fr)`
      : /^Auto$/i.test(text)
        ? 'auto'
        : unit(text);
}
function splitTracks(value) {
  const list = [];
  let start = 0,
    depth = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    if (value[i] === ')') depth--;
    if (!depth && /\s/.test(value[i])) {
      if (value.slice(start, i).trim()) list.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (value.slice(start).trim()) list.push(value.slice(start).trim());
  return list;
}
function xamlTracks(value) {
  const expanded = value.replace(/repeat\(\s*(\d+)\s*,\s*([^()]+)\)/gi, (_, count, track) =>
    Number(count) <= 100 ? Array(Number(count)).fill(track.trim()).join(' ') : 'unsupported',
  );
  const tracks = splitTracks(expanded).map((track) => {
    const fr = track.match(/^(?:minmax\(\s*0(?:px)?\s*,\s*)?(\d*(?:\.\d+)?)fr\s*\)?$/);
    return fr ? (fr[1] === '1' || !fr[1] ? '*' : fr[1] + '*') : number(track);
  });
  return tracks.length && tracks.every((v) => v !== null) ? tracks : null;
}

function context(options, input, source) {
  const diagnostics = [],
    losses = [],
    pairs = [],
    resources = new Map();
  let sourceIndex;
  try {
    if (source) sourceIndex = buildSourceIndex(source, input);
  } catch {
    /* Browser-normalized HTML can lack an exact lexical counterpart. */
  }
  return {
    options,
    input,
    source,
    diagnostics,
    losses,
    pairs,
    resources,
    sourceIndex,
    htmlByXaml: new Map(),
    cssRules: [],
    report(severity, code, message, node, loss = false) {
      const range = sourceIndex?.byId.get(node?.id),
        entry = {
          severity,
          code,
          message,
          ...(node?.id ? { nodeId: node.id } : {}),
          ...(range
            ? {
                sourceRange: {
                  start: range.start,
                  end: range.end,
                  line: range.line,
                  column: range.column,
                },
              }
            : {}),
        };
      diagnostics.push(entry);
      if (loss) losses.push(entry);
      return entry;
    },
  };
}
function plugins(node, direction, ctx) {
  for (const plugin of ctx.options.plugins || []) {
    const result = plugin[direction]?.(node, {
      document: ctx.input,
      framework: ctx.options.framework,
      report: (severity, code, message, loss = false) =>
        ctx.report(severity, code, message, node, loss),
    });
    if (result) {
      if (!result.kind)
        throw Error(`Compiler plugin ${plugin.name || '(unnamed)'} must return a DesignNode.`);
      ctx.pairs.push([node.id, result.id]);
      return result;
    }
  }
  return null;
}
function sourceShape(node) {
  return {
    type: node.type,
    props: { ...node.props },
    children: node.children.filter((n) => !isVisual(n)).map(rawNode),
  };
}
function contentProperty(type) {
  return ['TextBlock', 'Run', 'TextBox'].includes(type)
    ? 'Text'
    : type === 'PasswordBox'
      ? 'Password'
      : [
            'Button',
            'RepeatButton',
            'ToggleButton',
            'Label',
            'CheckBox',
            'RadioButton',
            'ComboBoxItem',
            'ListBoxItem',
            'ContentControl',
          ].includes(type)
        ? 'Content'
        : null;
}
function resolveLiteral(value, key, node, ctx, depth = 0) {
  if (!/^\{(?!\})/.test(String(value))) return literal(value);
  const resource = String(value).match(
    /^\{(StaticResource|DynamicResource)\s+(?:ResourceKey\s*=\s*)?([^},]+)\s*\}$/,
  );
  if (resource && depth < 16) {
    const found = findResource(ctx.input, node, resource[2].trim(), ctx.options.resolveSource);
    if (
      found &&
      ['Color', 'SolidColorBrush', 'String', 'Double', 'Int32', 'Boolean', 'Thickness'].includes(
        localName(found.type),
      )
    ) {
      if (resource[1] === 'DynamicResource')
        ctx.report(
          'warning',
          'DYNAMIC_RESOURCE',
          `${resource[2].trim()} is a snapshot; runtime resource replacement requires an adapter.`,
          node,
          true,
        );
      return resolveLiteral(
        found.props.Color ?? found.props.Value ?? textContent(found),
        key,
        node,
        ctx,
        depth + 1,
      );
    }
  }
  const binding = String(value).match(/^\{Binding\s*(?:Path\s*=\s*)?([\w.[\]]*)\s*\}$/);
  if (binding) {
    ctx.report(
      'warning',
      'BINDING_RUNTIME',
      `${key} binding is preserved as an inert data binding; attach the exported binding runtime or a compiler plugin.`,
      node,
      true,
    );
    return null;
  }
  ctx.report(
    'warning',
    'MARKUP_EXTENSION',
    `${key}: ${value} needs a framework-specific resource, binding or markup-extension adapter.`,
    node,
    true,
  );
  return null;
}
function collectResources(ctx) {
  walk(ctx.input.root, (n) => {
    if (!n.props?.['x:Key']) return;
    const type = localName(n.type);
    if (
      ['Color', 'SolidColorBrush', 'String', 'Double', 'Int32', 'Boolean', 'Thickness'].includes(
        type,
      )
    ) {
      const value = n.props.Color ?? n.props.Value ?? textContent(n);
      ctx.resources.set(n.props['x:Key'], value);
    }
  });
}

function xamlToHtmlNode(node, ctx, parentType = '', preserveSpace = false) {
  if (node.kind !== 'element') {
    if (node.kind === 'pi') {
      ctx.report(
        'info',
        'PROCESSING_INSTRUCTION',
        'XML processing instruction retained in portable metadata only.',
        node,
        true,
      );
      return null;
    }
    return { ...textNode(node.text), kind: node.kind === 'cdata' ? 'text' : node.kind };
  }
  const custom = plugins(node, 'xamlToHtml', ctx);
  if (custom) return custom;
  preserveSpace =
    node.props['xml:space'] === 'preserve' ||
    (preserveSpace && node.props['xml:space'] !== 'default');
  const type = localName(node.type),
    htmlMeta = decodeMeta(webMetadata(node, ctx), ctx, node);
  let tag =
    htmlMeta?.type ||
    (type === 'TextBox' && /^true$/i.test(node.props.AcceptsReturn || '')
      ? 'textarea'
      : controls[type]) ||
    'div';
  if (!controls[type] && !htmlMeta)
    ctx.report(
      'warning',
      'UNKNOWN_CONTROL',
      `${node.type} is represented by a container; register a semantic compiler plugin for its behavior.`,
      node,
      true,
    );
  const props = {},
    css = { 'box-sizing': 'border-box' },
    n = element(tag, props);
  n.props = props;
  ctx.pairs.push([node.id, n.id]);
  ctx.htmlByXaml.set(node.id, n);
  const styled = resolveStyle(ctx.input, node, { resolveSource: ctx.options.resolveSource }),
    effective = styled.properties;
  for (const trigger of styled.triggers)
    ctx.report(
      'warning',
      'STYLE_TRIGGER',
      'Style trigger state is a snapshot; dynamic native triggers need an interaction adapter.',
      trigger,
      true,
    );
  for (const extra of styled.node.children.filter(
    (child) => !node.children.some((original) => original.id === child.id),
  ))
    if (isProperty(extra))
      ctx.report(
        'warning',
        'STYLE_OBJECT',
        `${extra.type} from a style requires a template or object compiler adapter.`,
        node,
        true,
      );
  const literalProps = {};
  for (const [key, value] of Object.entries(effective)) {
    if (
      key.endsWith(':Source.Metadata') ||
      key.endsWith(':Ignorable') ||
      key.startsWith('xmlns') ||
      ['Style', 'Theme'].includes(key)
    )
      continue;
    const resolved = resolveLiteral(value, key, node, ctx);
    if (resolved !== null) put(literalProps, key, resolved);
  }
  if (!htmlMeta && type === 'TextBox' && /^true$/i.test(literalProps.AcceptsReturn || ''))
    tag = n.type = 'textarea';
  if (type === 'Canvas') {
    css.position = 'relative';
    css.display = 'block';
  }
  if (type === 'Grid') {
    css.display = 'grid';
    for (const axis of ['Row', 'Column']) {
      const prop = axis + 'Definitions',
        child = node.children.find((c) => localName(c.type) === `Grid.${prop}`),
        values =
          literalProps[prop]?.split(',') ||
          child?.children
            .filter((c) => c.kind === 'element')
            .map((c) => c.props[axis === 'Row' ? 'Height' : 'Width'] ?? '*');
      if (values?.length)
        css[`grid-template-${axis === 'Row' ? 'rows' : 'columns'}`] = values
          .map(cssTrack)
          .join(' ');
    }
  }
  if (['StackPanel', 'WrapPanel'].includes(type)) {
    css.display = 'flex';
    css['flex-direction'] =
      (literalProps.Orientation || (type === 'WrapPanel' ? 'Horizontal' : 'Vertical')) ===
      'Horizontal'
        ? 'row'
        : 'column';
    if (type === 'WrapPanel') {
      css['flex-wrap'] = 'wrap';
      css['align-content'] = 'start';
    }
  }
  if (type === 'DockPanel') css.display = 'grid';
  if (type === 'Bold') css['font-weight'] = 'bold';
  if (type === 'Italic') css['font-style'] = 'italic';
  if (type === 'ScrollViewer') css.overflow = 'auto';
  if (type === 'Ellipse') css['border-radius'] = '50%';
  if (type === 'Border' || type === 'Rectangle' || type === 'Ellipse') {
    css['border-style'] = 'solid';
    css['border-width'] = '0';
  }
  if (parentType === 'Canvas') css.position = 'absolute';
  if (['StackPanel', 'WrapPanel'].includes(parentType)) css['flex-shrink'] = '0';
  if (parentType === 'Grid') {
    css['grid-row'] =
      String(Number(literalProps['Grid.Row'] || 0) + 1) +
      (literalProps['Grid.RowSpan'] ? ' / span ' + literalProps['Grid.RowSpan'] : '');
    css['grid-column'] =
      String(Number(literalProps['Grid.Column'] || 0) + 1) +
      (literalProps['Grid.ColumnSpan'] ? ' / span ' + literalProps['Grid.ColumnSpan'] : '');
  }
  for (const [key, value] of Object.entries(literalProps)) {
    if (has(cssProperties, key)) {
      const converted = cssValue(key, value, ctx, node);
      if (converted !== null) css[cssProperties[key]] = converted;
      else
        ctx.report(
          'warning',
          'PROPERTY_VALUE',
          `${key}=${value} has no equivalent CSS value.`,
          node,
          true,
        );
    } else if (has(attrProperties, key)) {
      const attr = attrProperties[key];
      if (key === 'IsEnabled') {
        if (/^false$/i.test(value)) props.disabled = '';
      } else if (['IsChecked', 'IsReadOnly', 'IsSelected'].includes(key)) {
        if (/^true$/i.test(value)) props[attr] = '';
      } else props[attr] = value;
    } else if (has(eventNames, key)) {
      props['data-xamora-on-' + eventNames[key]] = value;
      ctx.report(
        'warning',
        'EVENT_HANDLER',
        `${key} handler ${value} requires an application callback; code-behind is not compiled to JavaScript.`,
        node,
        true,
      );
    } else if (key === 'Visibility') {
      if (value === 'Collapsed') css.display = 'none';
      else if (value === 'Hidden') css.visibility = 'hidden';
    } else if (key === 'IsVisible') {
      if (/^false$/i.test(value)) css.display = 'none';
    } else if (
      ![
        'Orientation',
        'RowDefinitions',
        'ColumnDefinitions',
        'Grid.Row',
        'Grid.Column',
        'Grid.RowSpan',
        'Grid.ColumnSpan',
        'DockPanel.Dock',
        'LastChildFill',
        'Text',
        'Password',
        'PasswordChar',
        'Content',
        'Header',
        'IsExpanded',
        'AcceptsReturn',
        'SelectedIndex',
        'x:Class',
        'x:Key',
        'xml:space',
      ].includes(key) &&
      !key.startsWith('web:')
    )
      ctx.report(
        'warning',
        'UNKNOWN_PROPERTY',
        `${node.type}.${key} is preserved; no browser property mapping is registered.`,
        node,
        true,
      );
  }
  if (type === 'TextBox' && tag === 'input')
    props.type =
      literalProps.PasswordChar && literalProps.PasswordChar !== '\0' ? 'password' : 'text';
  if (
    preserveSpace &&
    ['TextBlock', 'Run', 'Span', 'Bold', 'Italic', 'Underline', 'Hyperlink'].includes(type)
  )
    css['white-space'] = literalProps.TextWrapping === 'NoWrap' ? 'pre' : 'pre-wrap';
  if (type === 'PasswordBox') props.type = 'password';
  if (type === 'CheckBox') props.type = 'checkbox';
  if (type === 'RadioButton') props.type = 'radio';
  if (type === 'Slider') props.type = 'range';
  const contentKey = contentProperty(type),
    content = contentKey ? literalProps[contentKey] : undefined;
  if (content !== undefined) {
    if (['input', 'progress'].includes(tag)) props.value = content;
    else n.children.push(textNode(content));
  }
  if (tag === 'img') props.alt = literalProps['AutomationProperties.Name'] || '';
  if (['Expander', 'GroupBox'].includes(type) && literalProps.Header !== undefined)
    n.children.push(
      element(type === 'Expander' ? 'summary' : 'legend', {}, [textNode(literalProps.Header)]),
    );
  if (type === 'Expander' && /^true$/i.test(literalProps.IsExpanded || '')) props.open = '';
  for (const [key, value] of Object.entries(effective)) {
    if (/^\{Binding\b/.test(String(value)))
      props['data-xamora-bind-' + safeName(key).toLowerCase()] = value;
  }
  const propertyChildren = node.children.filter((c) => !isVisual(c));
  for (const child of propertyChildren) {
    const childType = localName(child.type);
    if (
      childType.endsWith('.Content') ||
      childType.endsWith('.Child') ||
      childType.endsWith('.Children') ||
      childType.endsWith('.Inlines') ||
      childType.endsWith('.Items')
    ) {
      for (const inner of child.children) {
        const converted = xamlToHtmlNode(inner, ctx, type, preserveSpace);
        if (converted) appendConverted(n, converted, ctx);
      }
    } else if (childType.endsWith('.Header') && ['Expander', 'GroupBox'].includes(type)) {
      const header = element(type === 'Expander' ? 'summary' : 'legend');
      for (const inner of child.children) {
        const converted = xamlToHtmlNode(inner, ctx, type, preserveSpace);
        if (converted) header.children.push(converted);
      }
      if (header.children.length === 1 && header.children[0].type === header.type)
        n.children.unshift(header.children[0]);
      else n.children.unshift(header);
    } else if (
      !childType.endsWith('.RowDefinitions') &&
      !childType.endsWith('.ColumnDefinitions') &&
      !childType.endsWith('.Resources')
    )
      ctx.report(
        'warning',
        'PROPERTY_ELEMENT',
        `${child.type} is preserved; its native behavior needs a compiler plugin.`,
        child,
        true,
      );
  }
  for (const child of node.children.filter(isVisual)) {
    const converted = xamlToHtmlNode(child, ctx, type, preserveSpace);
    if (converted) appendConverted(n, converted, ctx);
  }
  if (type === 'ComboBox' && literalProps.SelectedIndex !== undefined) {
    const index = Number(literalProps.SelectedIndex),
      items = n.children.filter((c) => c.type === 'option');
    if (Number.isInteger(index) && index >= 0 && index < items.length) {
      items.forEach((item, i) => {
        if (i === index) item.props.selected = '';
        else delete item.props.selected;
      });
    } else
      ctx.report(
        'warning',
        'SELECTION_INDEX',
        'SelectedIndex cannot be represented by this HTML select; no-selection and out-of-range indices require an interaction adapter.',
        node,
        true,
      );
  }
  if (type === 'DockPanel') {
    n.props.style = styleText(css);
    layoutDock(node, n, ctx);
    Object.assign(css, styleObject(n.props.style));
  }
  if (['CheckBox', 'RadioButton'].includes(type) && content !== undefined) {
    props['aria-label'] = content;
    delete props.value;
  }
  if (HTML_VOID.has(tag) && n.children.length) {
    ctx.report(
      'warning',
      'VOID_CONTENT',
      `Content on ${node.type} cannot be placed inside the HTML ${tag} element; portable metadata retains it.`,
      node,
      true,
    );
    n.children = [];
  }
  if (parentType === 'Canvas') {
    if (css.left !== undefined) delete css.right;
    if (css.top !== undefined) delete css.bottom;
  }
  if (css['border-width'] && !css['border-style']) css['border-style'] = 'solid';
  props.style = styleText(css);
  if (htmlMeta) {
    restoreHtmlMetadata(n, node, htmlMeta, ctx);
    if (
      htmlMeta.syntheticInlineHost === true &&
      Object.keys(node.props).every(
        (key) =>
          key.endsWith(':Source.Metadata') ||
          key.startsWith('xmlns') ||
          node.props[key] === htmlMeta.generated[key],
      )
    )
      n.compilerTransparent = true;
  }
  if (['CheckBox', 'RadioButton'].includes(type) && !htmlMeta) {
    const inputProps = { type: props.type, 'data-xamora-control-part': 'input' };
    for (const key of Object.keys(props))
      if (key !== 'style') {
        inputProps[key] = props[key];
        delete props[key];
      }
    n.type = 'label';
    n.children = [
      element('input', inputProps),
      ...(content !== undefined ? [textNode(content)] : []),
    ];
    const labelCss = styleObject(props.style);
    labelCss.display = 'inline-flex';
    labelCss['align-items'] = 'center';
    labelCss.gap ??= '4px';
    props.style = styleText(labelCss);
  }
  if (ctx.options.preserveMetadata !== false) {
    const shape = sourceShape(node);
    if (htmlMeta)
      for (const key of Object.keys(shape.props))
        if (key.endsWith(':Source.Metadata')) delete shape.props[key];
    props[META_HTML] = encodeMeta({
      ...shape,
      generated: { ...props },
      contentKey,
      content: content ?? textContent(node),
    });
  }
  n.props = props;
  return n;
}
function appendConverted(parent, child, ctx) {
  if (child.compilerTransparent) {
    parent.children.push(...child.children);
    for (const pair of ctx.pairs) if (pair[1] === child.id) pair[1] = parent.id;
  } else parent.children.push(child);
}
function layoutDock(source, target, ctx) {
  const sourceChildren = source.children.filter((c) => c.kind === 'element' && isVisual(c)),
    top = [],
    bottom = [],
    left = [],
    right = [];
  let r0 = 1,
    c0 = 1,
    r1 = sourceChildren.length * 2 + 2,
    c1 = r1;
  const children = sourceChildren.map((n) => ctx.htmlByXaml.get(n.id)).filter(Boolean);
  sourceChildren.forEach((child, index) => {
    const n = children[index];
    if (!n) return;
    const css = styleObject(n.props.style),
      dock = child.props['DockPanel.Dock'] || 'Left',
      fill =
        index === sourceChildren.length - 1 &&
        !/^false$/i.test(source.props.LastChildFill || 'True');
    if (fill) {
      css['grid-area'] = `${r0} / ${c0} / ${r1} / ${c1}`;
      return void (n.props.style = styleText(css));
    }
    if (dock === 'Top') {
      css['grid-area'] = `${r0} / ${c0} / ${r0 + 1} / ${c1}`;
      top.push(r0++);
    } else if (dock === 'Bottom') {
      css['grid-area'] = `${r1 - 1} / ${c0} / ${r1} / ${c1}`;
      bottom.push(--r1);
    } else if (dock === 'Right') {
      css['grid-area'] = `${r0} / ${c1 - 1} / ${r1} / ${c1}`;
      right.push(--c1);
    } else {
      css['grid-area'] = `${r0} / ${c0} / ${r1} / ${c0 + 1}`;
      left.push(c0++);
    }
    n.props.style = styleText(css);
  });
  const max = sourceChildren.length * 2 + 1;
  target.props.style = styleText({
    ...styleObject(target.props.style),
    'grid-template-rows': Array.from({ length: max }, (_, i) =>
      i + 1 === r0 ? 'minmax(0, 1fr)' : 'auto',
    ).join(' '),
    'grid-template-columns': Array.from({ length: max }, (_, i) =>
      i + 1 === c0 ? 'minmax(0, 1fr)' : 'auto',
    ).join(' '),
  });
}

function patchInlineCss(source, before, after) {
  const changes = new Set(
    [...Object.keys(before), ...Object.keys(after)].filter((key) => before[key] !== after[key]),
  );
  if (!changes.size) return source;
  const declarations = cssDeclarations(source),
    replacement = [];
  for (const part of declarations) {
    const key = styleEntries(part)[0]?.[0];
    if (!changes.has(key)) replacement.push(part);
    else {
      // Preserve comments that were outside strings on a replaced declaration.
      const leading = part.match(/^\s*(?:\/\*[\s\S]*?\*\/\s*)+/)?.[0];
      if (leading) replacement.push(leading);
    }
  }
  let result = replacement.join('');
  for (const key of changes)
    if (after[key] !== undefined && after[key] !== null && after[key] !== '') {
      if (result.trim() && !result.trimEnd().endsWith(';')) result += ';';
      const important =
        /!\s*important\s*$/i.test(before[key] || '') && !/!\s*important\s*$/i.test(after[key]);
      result += `${result ? ' ' : ''}${key}: ${after[key]}${important ? ' !important' : ''};`;
    }
  return result;
}
function restoreHtmlMetadata(target, source, meta, ctx) {
  const original = { ...meta.props },
    originalCss = styleObject(original.style),
    beforeCss = { ...originalCss },
    freshCss = styleObject(target.props.style),
    generated = meta.generated;
  for (const [key, cssKey] of Object.entries(cssProperties)) {
    if (source.props[key] !== generated[key]) {
      delete originalCss[cssKey];
      if (has(freshCss, cssKey)) originalCss[cssKey] = freshCss[cssKey];
    }
  }
  for (const [key, attr] of Object.entries(attrProperties)) {
    if (source.props[key] !== generated[key]) {
      delete original[attr];
      if (has(target.props, attr)) original[attr] = target.props[attr];
    }
  }
  if (
    source.props.Visibility !== generated.Visibility ||
    source.props.IsVisible !== generated.IsVisible
  ) {
    for (const key of ['display', 'visibility']) {
      delete originalCss[key];
      if (has(freshCss, key)) originalCss[key] = freshCss[key];
    }
  }
  for (const key of ['Orientation', 'RowDefinitions', 'ColumnDefinitions'])
    if (source.props[key] !== generated[key]) {
      for (const cssKey of [
        'display',
        'flex-direction',
        'grid-template-columns',
        'grid-template-rows',
      ])
        if (has(freshCss, cssKey)) originalCss[cssKey] = freshCss[cssKey];
    }
  original.style = patchInlineCss(original.style || '', beforeCss, originalCss);
  if (!original.style) delete original.style;
  Object.assign(target.props, original);
  if (!original.style) delete target.props.style;
  const key = contentProperty(localName(source.type));
  if (key && source.props[key] !== generated[key] && HTML_VOID.has(target.type)) {
    if (has(source.props, key)) target.props.value = literal(source.props[key]);
    else delete target.props.value;
  }
  if (meta.children?.length) target.children.unshift(...meta.children.map((n) => restoreNode(n)));
  if (ctx.options.allowScripts !== true) {
    for (const key of Object.keys(target.props)) if (/^on/i.test(key)) delete target.props[key];
    target.children = target.children.filter((child) => child.type !== 'script');
  }
}

function resolvedCss(node, ctx) {
  if (ctx.options.renderSnapshot instanceof Map)
    return ctx.options.renderSnapshot.get(node.id)?.css || {};
  ctx.cssCache ??= new Map();
  if (ctx.cssCache.has(node.id)) return ctx.cssCache.get(node.id);
  const parent = ctx.parents?.get(node.id),
    inherited = parent ? resolvedCss(parent, ctx) : {},
    values = Object.fromEntries(
      Object.entries(inherited).filter(([key]) => key.startsWith('--') || inheritedCss.has(key)),
    ),
    winners = new Map(),
    candidates = new Map();
  const add = (entries, rank, layer = ctx.cssLayers) => {
    for (const [key, raw] of entries) {
      const important = /!\s*important\s*$/i.test(raw),
        priority = [
          important ? 1 : 0,
          rank[0],
          important ? -(layer?.rank ?? -1) : (layer?.rank ?? -1),
          ...rank.slice(1),
        ],
        value = String(raw).replace(/\s*!\s*important\s*$/i, '');
      const assign = (property, component) => {
        if (!candidates.has(property)) candidates.set(property, []);
        candidates.get(property).push({ value, priority, component, layer, inline: rank[0] === 1 });
      };
      if (has(boxCss, key)) boxCss[key].forEach((property, index) => assign(property, index));
      else assign(key);
    }
  };
  // HTML direction is a presentational hint and loses to author CSS.
  if (/^(ltr|rtl)$/i.test(node.props.dir || ''))
    add([['direction', node.props.dir.toLowerCase()]], [0, 0, 0, 0], { rank: -1 });
  // These semantic inline defaults precede all author declarations, including '*'.
  if (['strong', 'b'].includes(node.type))
    add([['font-weight', 'bolder']], [0, 0, 0, 0], { rank: -1 });
  if (['em', 'i'].includes(node.type)) add([['font-style', 'italic']], [0, 0, 0, 0], { rank: -1 });
  for (const rule of ctx.cssRules)
    if (ctx.matchCssRule(node, rule)) add(rule.values, [0, ...rule.plan.specificity], rule.layer);
  add(styleEntries(node.props.style), [1, 0, 0, 0]);
  for (const [property, entries] of candidates) {
    entries.reverse().sort((a, b) => compareCssPriority(b.priority, a.priority));
    let remaining = entries;
    while (remaining.length) {
      const entry = remaining[0],
        keyword = entry.value.trim().toLowerCase();
      if (keyword === 'revert-layer') {
        remaining = remaining.filter(
          (candidate) =>
            candidate.layer !== entry.layer ||
            candidate.inline !== entry.inline ||
            candidate.priority[0] !== entry.priority[0],
        );
      } else if (keyword === 'revert') {
        // Only the semantic inline user-agent defaults are modeled below author origin.
        remaining = remaining.filter((candidate) => candidate.layer?.rank === -1);
        if (entry.layer?.rank === -1) break;
      } else {
        winners.set(property, entry);
        break;
      }
    }
  }
  const custom = Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith('--')));
  for (const [key, { value }] of winners)
    if (key.startsWith('--')) {
      if (value === 'initial') delete custom[key];
      else if (value === 'inherit' || value === 'unset') {
        if (has(inherited, key)) put(custom, key, inherited[key]);
        else delete custom[key];
      } else put(custom, key, value);
    }
  const lookup = computedCssVariables(custom);
  for (const key of Object.keys(values)) if (key.startsWith('--')) delete values[key];
  for (const key of Object.keys(custom)) {
    const value = lookup(key);
    if (value != null) put(values, key, value);
    else delete values[key];
  }
  const inheritedValue = (key) => {
    if (has(inherited, key)) return inherited[key];
    for (const [group, sides] of Object.entries(boxCss))
      if (sides.includes(key) && inherited[group] !== undefined)
        return cssBoxValues(inherited[group])?.[sides.indexOf(key)];
    return undefined;
  };
  for (const [key, entry] of winners) {
    if (key.startsWith('--')) continue;
    let value = substituteCssVariables(entry.value, lookup);
    if (value == null) {
      ctx.report(
        'warning',
        'CSS_VARIABLE',
        `${key} contains an unresolved, cyclic or over-limit CSS variable; its computed value uses unset semantics.`,
        node,
        true,
      );
      value = 'unset';
    }
    if (entry.component !== undefined) {
      const components = cssBoxValues(value);
      value = components?.[entry.component] ?? 'unset';
    }
    if (value === 'inherit' && entry.component !== undefined) {
      const group = Object.entries(boxCss).find(([, sides]) => sides.includes(key));
      if (group && inherited[group[0]] !== undefined) {
        put(values, key, cssBoxValues(inherited[group[0]])?.[entry.component] ?? '0');
        continue;
      }
    }
    if (value === 'inherit' || (value === 'unset' && inheritedCss.has(key))) {
      if (inheritedValue(key) !== undefined) put(values, key, inheritedValue(key));
      else if (has(initialCss, key)) put(values, key, initialCss[key]);
      else delete values[key];
    } else if (value === 'initial' || value === 'unset') {
      if (has(initialCss, key)) put(values, key, initialCss[key]);
      else if (/^(?:margin|padding)-/.test(key)) put(values, key, '0');
      else delete values[key];
    } else put(values, key, value);
  }
  for (const [key, sides] of Object.entries(boxCss))
    if (sides.some((side) => has(values, side))) {
      put(values, key, sides.map((side) => values[side] ?? '0').join(' '));
      for (const side of sides) delete values[side];
    }
  if (['bolder', 'lighter'].includes(values['font-weight']?.toLowerCase())) {
    const base =
      { normal: 400, bold: 700 }[inherited['font-weight']?.toLowerCase()] ??
      Number(inherited['font-weight'] || 400);
    values['font-weight'] = String(
      values['font-weight'].toLowerCase() === 'bolder'
        ? base < 350
          ? 400
          : base < 550
            ? 700
            : Math.max(900, base)
        : base < 100
          ? base
          : base < 550
            ? 100
            : base < 750
              ? 400
              : 700,
    );
  }
  if (values.color?.toLowerCase() === 'currentcolor') values.color = inherited.color || 'black';
  for (const key of ['background-color', 'border-color'])
    if (values[key]?.toLowerCase() === 'currentcolor') values[key] = values.color || 'black';
  if (ctx.options.environment) {
    const env = ctx.options.environment;
    const rootFont = ctx.cssRootFont ?? env.rootFontSize ?? env.initialFontSize ?? 16;
    const inheritedFont = parseFloat(inherited['font-size']) || rootFont;
    if (values['font-size']) {
      const size = resolveCssLength(values['font-size'], {
        ...env,
        fontSize: inheritedFont,
        rootFontSize: rootFont,
        percentBase: inheritedFont,
      });
      if (size !== null && size >= 0) values['font-size'] = size + 'px';
    }
    if (node === ctx.input.root && /^[-+\d.]+px$/.test(values['font-size'] || ''))
      ctx.cssRootFont = parseFloat(values['font-size']);
    const parentWidth = /^[-+\d.]+px$/.test(inherited.width || '')
      ? parseFloat(inherited.width)
      : undefined;
    const parentHeight = /^[-+\d.]+px$/.test(inherited.height || '')
      ? parseFloat(inherited.height)
      : undefined;
    const lengthEnv = {
      ...env,
      rootFontSize: rootFont,
      fontSize: parseFloat(values['font-size']) || inheritedFont,
    };
    for (const property of [
      'width',
      'height',
      'min-width',
      'max-width',
      'min-height',
      'max-height',
      'left',
      'right',
      'top',
      'bottom',
      'gap',
      'row-gap',
      'column-gap',
      'border-radius',
    ]) {
      if (values[property] === undefined || !/[a-z%()]/i.test(values[property])) continue;
      const percentBase = /height|top|bottom/.test(property) ? parentHeight : parentWidth;
      const size = resolveCssLength(values[property], { ...lengthEnv, percentBase });
      if (size !== null) values[property] = size + 'px';
    }
    for (const property of ['margin', 'padding', 'border-width']) {
      if (values[property] === undefined) continue;
      const parts = splitCssList(values[property], ' ');
      const resolved = parts.map((part) =>
        resolveCssLength(part, {
          ...lengthEnv,
          percentBase: property === 'border-width' ? undefined : parentWidth,
        }),
      );
      if (resolved.every((v) => v !== null))
        values[property] = resolved.map((v) => v + 'px').join(' ');
    }
  }
  ctx.cssCache.set(node.id, values);
  return values;
}
function inferXamlType(node, css, inlineContext = false) {
  if (node.type === 'input')
    return (
      { password: 'PasswordBox', checkbox: 'CheckBox', radio: 'RadioButton', range: 'Slider' }[
        String(node.props.type || '').toLowerCase()
      ] || 'TextBox'
    );
  const map = {
    span: inlineContext ? 'Span' : 'TextBlock',
    strong: 'Bold',
    b: 'Bold',
    em: 'Italic',
    i: 'Italic',
    u: 'Underline',
    br: 'LineBreak',
    pre: 'TextBlock',
    summary: 'TextBlock',
    legend: 'TextBlock',
    p: 'TextBlock',
    h1: 'TextBlock',
    h2: 'TextBlock',
    h3: 'TextBlock',
    h4: 'TextBlock',
    h5: 'TextBlock',
    h6: 'TextBlock',
    label: 'Label',
    button: 'Button',
    textarea: 'TextBox',
    select: 'ComboBox',
    option: 'ComboBoxItem',
    ul: 'ListBox',
    ol: 'ListBox',
    li: 'ListBoxItem',
    img: 'Image',
    progress: 'ProgressBar',
    hr: 'Separator',
    a: 'Hyperlink',
    details: 'Expander',
    fieldset: 'GroupBox',
  };
  if (map[node.type]) return map[node.type];
  if (css.display === 'grid' || css.display === 'inline-grid') return 'Grid';
  if (['flex', 'inline-flex'].includes(css.display))
    return css['flex-wrap'] === 'wrap' ? 'WrapPanel' : 'StackPanel';
  if (
    css.position === 'relative' &&
    node.children.some(
      (c) => c.kind === 'element' && styleObject(c.props.style).position === 'absolute',
    )
  )
    return 'Canvas';
  return 'StackPanel';
}
function normalizeInlineWhitespace(root, ctx) {
  let pending = null,
    atStart = true;
  const flush = () => {
    if (pending) {
      pending.text += ' ';
      pending = null;
    }
  };
  const visit = (node, mode = 'normal') => {
    if (node.kind === 'element') {
      if (node.type === 'br') {
        pending = null;
        atStart = true;
        return;
      }
      if (['script', 'style', 'link', 'meta'].includes(node.type)) return;
      mode = resolvedCss(node, ctx)['white-space'] || (node.type === 'pre' ? 'pre' : mode);
      for (const child of node.children) visit(child, mode);
      return;
    }
    if (!['text', 'cdata'].includes(node.kind)) return;
    const source = mode === 'pre-line' ? node.text.replace(/\r\n?|\f/g, '\n') : node.text;
    node.text = '';
    for (const c of source) {
      if (mode === 'pre-line' && c === '\n') {
        pending = null;
        node.text += '\n';
        atStart = true;
      } else if (['normal', 'nowrap', 'pre-line'].includes(mode) && /[ \t\r\n\f]/.test(c)) {
        if (!atStart && !pending) pending = node;
      } else {
        flush();
        node.text += c;
        atStart = c === '\n' && !['normal', 'nowrap'].includes(mode);
      }
    }
  };
  visit(root);
  walk(root, (node) => {
    if (node.children) node.children = node.children.filter((c) => c.kind !== 'text' || c.text);
  });
}
function htmlToXamlNode(node, ctx, parentCss = {}, inlineContext = false) {
  if (node.kind !== 'element') {
    if (node.kind === 'comment' && (node.text.includes('--') || node.text.endsWith('-'))) {
      ctx.report(
        'warning',
        'HTML_COMMENT',
        'HTML comment cannot be represented as an XML comment; portable metadata retains it.',
        node,
        true,
      );
      return null;
    }
    return { ...textNode(node.text), kind: node.kind === 'cdata' ? 'text' : node.kind };
  }
  if (['script', 'style', 'link', 'meta', 'title', 'base', 'head'].includes(node.type)) return null;
  const custom = plugins(node, 'htmlToXaml', ctx);
  if (custom) return custom;
  const meta = decodeMeta(node.props[META_HTML], ctx, node);
  if (meta && ['CheckBox', 'RadioButton'].includes(localName(meta.type))) {
    const part = node.children.find(
      (child) => child.props?.['data-xamora-control-part'] === 'input',
    );
    if (part)
      node = {
        ...node,
        props: { ...node.props, ...part.props },
        children: node.children.filter((child) => child !== part),
      };
  }
  const css = resolvedCss(node, ctx),
    captured = ctx.options.renderSnapshot?.get(node.id),
    type =
      captured?.container && !inlineContext
        ? 'Canvas'
        : meta?.type || inferXamlType(node, css, inlineContext),
    local = localName(type),
    props = {},
    n = element(type, props);
  n.props = props;
  ctx.pairs.push([node.id, n.id]);
  const usedCss = new Set([
      'box-sizing',
      'display',
      'position',
      'flex-direction',
      'flex-wrap',
      'grid-template-columns',
      'grid-template-rows',
      'grid-row',
      'grid-column',
      'visibility',
      'flex-shrink',
      'animation',
      'animation-name',
      'animation-duration',
      'animation-delay',
      'animation-direction',
      'animation-fill-mode',
      'animation-play-state',
      'animation-iteration-count',
      'animation-timing-function',
    ]),
    usedAttrs = new Set(['style', 'id', 'class', 'type', META_HTML]);
  for (const [key, cssKey] of Object.entries(cssProperties)) {
    if (
      ['Fill', 'Stroke', 'StrokeThickness'].includes(key) &&
      !['Rectangle', 'Ellipse'].includes(local)
    )
      continue;
    if (
      ['Background', 'BorderBrush', 'BorderThickness'].includes(key) &&
      ['Rectangle', 'Ellipse'].includes(local)
    )
      continue;
    if (!has(css, cssKey)) continue;
    usedCss.add(cssKey);
    // Text layout inherited from the outer host is not a native Inline property.
    if (
      inlineXamlTypes.has(local) &&
      ['TextWrapping', 'TextAlignment'].includes(key) &&
      css[cssKey] === parentCss[cssKey]
    )
      continue;
    const value = xamlValue(key, css[cssKey], css);
    if (value !== null) props[key] = value;
    else
      ctx.report(
        'warning',
        'CSS_VALUE',
        `${cssKey}: ${css[cssKey]} has no equivalent ${key} value.`,
        node,
        true,
      );
  }
  for (const [key, attr] of Object.entries(attrProperties)) {
    if (
      key === 'Name' ||
      key === 'AutomationId' ||
      key === 'Watermark' ||
      (key === 'IsSelected' && local !== 'ComboBoxItem') ||
      (key === 'GroupName' && local !== 'RadioButton') ||
      (key === 'Value' && ['TextBox', 'PasswordBox'].includes(local))
    )
      continue;
    if (!has(node.props, attr)) continue;
    usedAttrs.add(attr);
    props[key] =
      key === 'IsEnabled'
        ? 'False'
        : ['IsChecked', 'IsReadOnly', 'IsSelected'].includes(key)
          ? 'True'
          : node.props[attr];
  }
  if (['StackPanel', 'WrapPanel'].includes(local))
    props.Orientation = css['flex-direction'] === 'row' ? 'Horizontal' : 'Vertical';
  for (const axis of ['Column', 'Row']) {
    const value = css[`grid-template-${axis === 'Column' ? 'columns' : 'rows'}`];
    if (local === 'Grid' && value) {
      const tracks = xamlTracks(value);
      if (tracks) {
        if (ctx.options.framework === 'Avalonia') props[axis + 'Definitions'] = tracks.join(',');
        else
          n.children.push(
            element(
              `Grid.${axis}Definitions`,
              {},
              tracks.map((track) =>
                element(axis + 'Definition', { [axis === 'Column' ? 'Width' : 'Height']: track }),
              ),
            ),
          );
      } else
        ctx.report(
          'warning',
          'GRID_TRACK',
          'Responsive, named or intrinsic CSS grid tracks remain in portable metadata.',
          node,
          true,
        );
    }
  }
  for (const axis of ['Row', 'Column']) {
    const value = css['grid-' + axis.toLowerCase()];
    if (value) {
      const match = value.match(/^([1-9]\d*)(?:\s*\/\s*(?:span\s+)?([1-9]\d*))?$/);
      if (match) {
        props['Grid.' + axis] = String(Number(match[1]) - 1);
        if (match[2])
          props['Grid.' + axis + 'Span'] = String(
            /span/.test(value)
              ? Number(match[2])
              : Math.max(1, Number(match[2]) - Number(match[1])),
          );
      } else
        ctx.report(
          'warning',
          'GRID_PLACEMENT',
          `grid-${axis.toLowerCase()}: ${value} needs a CSS grid placement adapter.`,
          node,
          true,
        );
    }
  }
  if (css.display === 'none')
    props[ctx.options.framework === 'Avalonia' ? 'IsVisible' : 'Visibility'] =
      ctx.options.framework === 'Avalonia' ? 'False' : 'Collapsed';
  else if (css.visibility === 'hidden') props.Visibility = 'Hidden';
  if (css['flex-direction']?.endsWith('reverse'))
    ctx.report(
      'warning',
      'REVERSED_FLOW',
      'Reversed CSS flex flow is preserved but needs a native layout adapter.',
      node,
      true,
    );
  if (
    css.position === 'absolute' &&
    parentCss.position !== 'relative' &&
    parentCss.position !== 'absolute'
  )
    ctx.report(
      'warning',
      'ABSOLUTE_CONTAINING_BLOCK',
      'CSS absolute positioning may use an ancestor containing block; Canvas placement is an approximation.',
      node,
      true,
    );
  if (node.type === 'img' && node.props.alt !== undefined)
    props['AutomationProperties.Name'] = node.props.alt;
  const isTextHost = [
    'TextBlock',
    'Run',
    'Span',
    'Bold',
    'Italic',
    'Underline',
    'Hyperlink',
  ].includes(local);
  if (
    !meta &&
    !inlineContext &&
    (isTextHost ||
      (!!contentProperty(local) && node.children.some((c) => inlineHtmlTypes.has(c.type))))
  )
    normalizeInlineWhitespace(node, ctx);
  const textHost = isTextHost,
    contentKey = contentProperty(local),
    mixed = node.children.some(
      (c) =>
        c.kind === 'element' &&
        !['script', 'style', 'link', 'meta', 'title', 'base'].includes(c.type),
    ),
    content = node.type === 'input' ? node.props.value : textContent(node),
    scalarContent = !!contentKey && !mixed,
    wrapInlineContent =
      mixed &&
      !!contentKey &&
      !textHost &&
      !['TextBox', 'PasswordBox'].includes(local) &&
      node.children.filter((c) => c.kind === 'element').every((c) => inlineHtmlTypes.has(c.type));
  if (node.type === 'textarea') props.AcceptsReturn = 'True';
  if (!meta && local === 'TextBlock' && props.TextWrapping === undefined)
    props.TextWrapping = 'Wrap';
  if (
    node.type === 'pre' ||
    ['pre', 'pre-wrap', 'pre-line', 'break-spaces'].includes(css['white-space'])
  ) {
    props['xml:space'] = 'preserve';
    if (local === 'TextBlock')
      props.TextWrapping = ['pre-wrap', 'pre-line', 'break-spaces'].includes(css['white-space'])
        ? 'Wrap'
        : 'NoWrap';
  }
  if (textHost && mixed) {
    n.space = 'preserve';
    props['xml:space'] = 'preserve';
  }

  if (node.type === 'input' && contentKey) usedAttrs.add('value');
  if (scalarContent && content !== undefined && content !== '')
    props[contentKey] = String(content).startsWith('{') ? '{}' + content : content;
  if (local === 'Expander') {
    props.IsExpanded = has(node.props, 'open') ? 'True' : 'False';
    usedAttrs.add('open');
  }
  const header = node.children.find((c) => ['summary', 'legend'].includes(c.type));
  if (header && ['Expander', 'GroupBox'].includes(local)) {
    if (header.children.some((c) => c.kind === 'element') || Object.keys(header.props).length) {
      const converted = htmlToXamlNode(header, ctx, css);
      if (converted) n.children.push(element(local + '.Header', {}, [converted]));
    } else {
      const value = textContent(header);
      props.Header = value.startsWith('{') ? '{}' + value : value;
    }
  }
  for (const [attr, value] of Object.entries(node.props)) {
    if (attr.startsWith('data-xamora-on-')) {
      const event = attr.slice(15),
        key = reverseEvents[event];
      if (key) {
        props[key] = value;
        usedAttrs.add(attr);
      }
    }
    if (/^on/i.test(attr))
      ctx.report(
        'warning',
        'JAVASCRIPT_HANDLER',
        `${attr} JavaScript remains portable metadata; it is not compiled into native code-behind.`,
        node,
        true,
      );
  }
  for (const child of node.children) {
    if (
      child === header ||
      (child.kind === 'text' &&
        !child.text.trim() &&
        (captured?.container ||
          [
            'Grid',
            'StackPanel',
            'WrapPanel',
            'Canvas',
            'DockPanel',
            'ListBox',
            'ComboBox',
          ].includes(local))) ||
      (scalarContent && ['text', 'cdata'].includes(child.kind)) ||
      (child.kind === 'text' && !child.text.trim() && !textHost && !mixed && node.type !== 'pre')
    )
      continue;
    const converted = htmlToXamlNode(child, ctx, css, textHost || wrapInlineContent);
    if (converted) {
      if (
        (textHost || wrapInlineContent) &&
        converted.kind === 'element' &&
        !inlineXamlTypes.has(localName(converted.type))
      )
        ctx.report(
          'warning',
          'INLINE_CONTENT',
          'Block or control content inside native text requires an inline UI adapter.',
          child,
          true,
        );
      n.children.push(converted);
    }
  }
  if (wrapInlineContent) {
    const host = element('TextBlock', { 'xml:space': 'preserve' }, n.children);
    host.space = 'preserve';
    if (ctx.options.preserveMetadata !== false)
      host.props[META_XAML] = encodeMeta({
        type: 'span',
        props: {},
        children: [],
        generated: { ...host.props },
        syntheticInlineHost: true,
      });
    n.children = [host];
  }
  if (local === 'ComboBox') {
    const options = n.children.filter((c) => localName(c.type) === 'ComboBoxItem');
    if (has(node.props, 'multiple'))
      ctx.report(
        'warning',
        'MULTIPLE_SELECTION',
        'HTML multiple selection requires a native multi-select control adapter.',
        node,
        true,
      );
    else if (options.length) {
      const selected = options.findLastIndex((c) => c.props.IsSelected === 'True');
      props.SelectedIndex = String(
        selected >= 0 ? selected : options.findIndex((c) => c.props.IsEnabled !== 'False'),
      );
    }
  }
  if (local === 'Grid') placeHtmlGrid(node, n, css, ctx);
  if (meta) restoreXamlMetadata(n, node, meta, css, ctx);
  if (captured) applyCapturedLayout(n, node, captured, ctx);
  adaptNativeTextLayout(n, node, ctx);
  // Avalonia masks its TextBox; it does not expose WPF's PasswordBox control.
  if (ctx.options.framework === 'Avalonia' && localName(n.type) === 'PasswordBox') {
    n.type = 'TextBox';
    props.PasswordChar = '*';
    if (has(props, 'Password')) {
      props.Text = props.Password;
      delete props.Password;
    }
  }
  diagnoseNativeProperties(n, ctx, node);
  for (const [key] of Object.entries(node.props))
    if (!usedAttrs.has(key) && !key.startsWith('data-xamora-') && !['open', 'alt'].includes(key))
      ctx.report(
        'warning',
        'HTML_ATTRIBUTE',
        `${key} is preserved as HTML metadata; it has no native XAML attribute mapping.`,
        node,
        true,
      );
  for (const key of Object.keys(css))
    if (!usedCss.has(key) && !key.startsWith('--'))
      ctx.report(
        'warning',
        'CSS_PROPERTY',
        `${key} remains portable metadata; no native property mapping is registered.`,
        node,
        true,
      );
  const structuralTags = new Set(
    'html body div main section article header footer nav aside form span strong b em i u br pre p h1 h2 h3 h4 h5 h6 label button input textarea select option ul ol li img progress hr a details fieldset'.split(
      ' ',
    ),
  );
  if (!structuralTags.has(node.type) && !meta)
    ctx.report(
      'warning',
      'HTML_ELEMENT',
      `${node.type} is represented by ${type}; register a compiler plugin for its native behavior.`,
      node,
      true,
    );
  if (ctx.options.preserveMetadata !== false) {
    const original = { ...node.props };
    delete original[META_HTML];
    const hidden = node.children.filter((c) =>
      ['script', 'style', 'link', 'meta', 'title', 'base'].includes(c.type),
    );
    props[META_XAML] = encodeMeta({
      type: node.type,
      props: original,
      children: hidden.map(rawNode),
      generated: { ...props },
    });
  }
  n.props = props;
  return n;
}
function applyCapturedLayout(target, source, record, ctx) {
  if (record.inline || inlineXamlTypes.has(localName(target.type))) return;
  const props = target.props,
    round = (v) => String(Math.round(v * 10000) / 10000);
  const parent = ctx.parents.get(source.id),
    parentRecord = ctx.options.renderSnapshot.get(parent?.id);
  if (parentRecord && !parentRecord.container) return;
  props.Width = round(record.bounds.width);
  props.Height = round(record.bounds.height);
  props.Margin = '0';
  delete props.MinWidth;
  delete props.MaxWidth;
  delete props.MinHeight;
  delete props.MaxHeight;
  props.HorizontalAlignment = 'Left';
  props.VerticalAlignment = 'Top';
  if (parentRecord?.container) {
    props['Canvas.Left'] = round(record.bounds.x - parentRecord.bounds.x);
    props['Canvas.Top'] = round(record.bounds.y - parentRecord.bounds.y);
    if (record.zIndex !== undefined) props['Panel.ZIndex'] = String(record.zIndex);
  }
  if (record.clip) props.ClipToBounds = 'True';
  if (!record.visible)
    props[ctx.options.framework === 'Avalonia' ? 'IsVisible' : 'Visibility'] =
      ctx.options.framework === 'Avalonia' ? 'False' : 'Hidden';
  if (ctx.options.framework === 'Avalonia') delete props.Visibility;
  if (record.container) {
    const decoration = { Width: props.Width, Height: props.Height, IsHitTestVisible: 'False' };
    for (const key of ['BorderBrush', 'BorderThickness', 'CornerRadius'])
      if (props[key] !== undefined) {
        decoration[key] = props[key];
        delete props[key];
      }
    const radius = resolveCssLength(record.radius || '0');
    if (radius !== null && radius > 0) decoration.CornerRadius = String(radius);
    for (const key of [
      'Padding',
      'Foreground',
      'FontFamily',
      'FontSize',
      'FontWeight',
      'FontStyle',
      'TextAlignment',
      'TextWrapping',
    ])
      delete props[key];
    if (decoration.BorderThickness && !/^(?:0[, ]*)+$/.test(decoration.BorderThickness))
      target.children.unshift(element('Border', decoration));
  } else if (localName(target.type) === 'TextBlock') {
    // Border paint is not a native TextBlock property. Keep a diagnostic instead of invalid XAML.
    if (props.BorderThickness && !/^(?:0[, ]*)+$/.test(props.BorderThickness))
      ctx.report(
        'warning',
        'BROWSER_TEXT_BORDER',
        'A text border requires a native Border wrapper.',
        source,
        true,
      );
    delete props.BorderThickness;
    delete props.BorderBrush;
  }
}
function adaptNativeTextLayout(target, source, ctx) {
  const type = localName(target.type);
  if (
    ![
      'Button',
      'RepeatButton',
      'ToggleButton',
      'Label',
      'CheckBox',
      'RadioButton',
      'ComboBoxItem',
      'ListBoxItem',
    ].includes(type)
  )
    return;
  const keys = ['TextAlignment', 'TextWrapping', 'TextDecorations'].filter((key) =>
    has(target.props, key),
  );
  if (!keys.length) return;
  // Content controls do not declare TextBlock layout properties. Use one actual
  // text host rather than invalid Button.TextWrapping / Button.TextAlignment.
  let host =
    target.children.length === 1 && localName(target.children[0].type) === 'TextBlock'
      ? target.children[0]
      : null;
  if (!host && !target.children.some((child) => child.kind === 'element')) {
    host = element('TextBlock', {}, target.children);
    if (has(target.props, 'Content')) {
      host.props.Text = target.props.Content;
      delete target.props.Content;
    }
    target.children = [host];
    if (ctx.options.preserveMetadata !== false)
      host.props[META_XAML] = encodeMeta({
        type: 'span',
        props: {},
        children: [],
        generated: {
          ...host.props,
          ...Object.fromEntries(keys.map((key) => [key, target.props[key]])),
        },
        syntheticInlineHost: true,
      });
  }
  for (const key of keys) {
    if (host) host.props[key] = target.props[key];
    else
      ctx.report(
        'warning',
        'NATIVE_TEXT_LAYOUT',
        `${type}.${key} requires a text-content template adapter.`,
        source,
        true,
      );
    delete target.props[key];
  }
}
function diagnoseNativeProperties(node, ctx, source) {
  const type = localName(node.type),
    control = new Set([
      'UserControl',
      'Window',
      'ContentControl',
      'ContentPresenter',
      'Button',
      'RepeatButton',
      'ToggleButton',
      'Label',
      'TextBox',
      'PasswordBox',
      'CheckBox',
      'RadioButton',
      'ComboBox',
      'ComboBoxItem',
      'ListBox',
      'ListBoxItem',
      'ProgressBar',
      'Slider',
      'Expander',
      'GroupBox',
    ]),
    text = ['TextBlock', 'Run', 'Span', 'Bold', 'Italic', 'Underline', 'Hyperlink'].includes(type);
  for (const key of Object.keys(node.props)) {
    const incompatible =
      (inlineXamlTypes.has(type) &&
        [
          'Width',
          'Height',
          'MinWidth',
          'MinHeight',
          'MaxWidth',
          'MaxHeight',
          'Margin',
          'Padding',
          'BorderThickness',
          'BorderBrush',
          'HorizontalAlignment',
          'VerticalAlignment',
          'TextWrapping',
          'TextAlignment',
        ].includes(key)) ||
      (ctx.options.framework === 'WPF' &&
        ['Spacing', 'RowSpacing', 'ColumnSpacing'].includes(key)) ||
      (['Foreground', 'FontFamily', 'FontSize', 'FontWeight', 'FontStyle'].includes(key) &&
        !control.has(type) &&
        !text) ||
      (['Padding', 'BorderThickness', 'BorderBrush', 'CornerRadius'].includes(key) &&
        !control.has(type) &&
        type !== 'Border' &&
        !(type === 'TextBlock' && key === 'Padding'));
    if (incompatible)
      ctx.report(
        'warning',
        'NATIVE_PROPERTY',
        `${type}.${key} is available to the browser projection but requires a wrapper or target property adapter for native ${ctx.options.framework}.`,
        source,
        true,
      );
  }
}
function placeHtmlGrid(source, target, css, ctx) {
  if (/column/.test(css['grid-auto-flow'] || '')) {
    ctx.report(
      'warning',
      'GRID_AUTO_FLOW',
      'Column-first CSS grid auto-placement needs a layout adapter.',
      source,
      true,
    );
    return;
  }
  const columns = xamlTracks(css['grid-template-columns'] || 'auto');
  if (!columns) return;
  if (columns.length > 1000) {
    ctx.report(
      'warning',
      'GRID_PLACEMENT_LIMIT',
      'Grid track count exceeds the static conversion limit.',
      source,
      true,
    );
    return;
  }
  const count = columns.length,
    occupied = new Set(),
    records = [];
  let cursor = 0,
    maxRow = 0;
  for (const child of source.children.filter((c) => c.kind === 'element')) {
    const pair = ctx.pairs.find(([id]) => id === child.id),
      node = pair && target.children.find((c) => c.id === pair[1]);
    if (!node) continue;
    const row = has(node.props, 'Grid.Row') ? Number(node.props['Grid.Row']) : null,
      col = has(node.props, 'Grid.Column') ? Number(node.props['Grid.Column']) : null,
      rows = Math.max(1, Number(node.props['Grid.RowSpan'] || 1)),
      cols = Math.min(count, Math.max(1, Number(node.props['Grid.ColumnSpan'] || 1)));
    if (rows > 150 || row > 15000 || col > 15000 || rows * cols > 100000) {
      ctx.report(
        'warning',
        'GRID_PLACEMENT_LIMIT',
        'Grid coordinates exceed bounded static layout conversion.',
        source,
        true,
      );
      return;
    }
    records.push({ node, row, col, rows, cols });
  }
  const occupy = (record) => {
    for (let r = record.row; r < record.row + record.rows; r++)
      for (let c = record.col; c < record.col + record.cols; c++) occupied.add(r + ':' + c);
    maxRow = Math.max(maxRow, record.row + record.rows);
  };
  for (const record of records) if (record.row !== null && record.col !== null) occupy(record);
  for (const record of records) {
    if (record.row !== null && record.col !== null) continue;
    let found = false;
    for (
      let position = /dense/.test(css['grid-auto-flow'] || '') ? 0 : cursor;
      position < 15000;
      position++
    ) {
      const row = record.row ?? Math.floor(position / count),
        col = record.col ?? position % count;
      if (col + record.cols > count) continue;
      let free = true;
      for (let r = row; r < row + record.rows; r++)
        for (let c = col; c < col + record.cols; c++) if (occupied.has(r + ':' + c)) free = false;
      if (!free) continue;
      record.row = row;
      record.col = col;
      record.node.props['Grid.Row'] = String(row);
      record.node.props['Grid.Column'] = String(col);
      occupy(record);
      cursor = row * count + col + record.cols;
      found = true;
      break;
    }
    if (!found)
      ctx.report(
        'warning',
        'GRID_PLACEMENT_LIMIT',
        'Grid auto-placement exceeded the bounded cell search.',
        source,
        true,
      );
  }
  const existing = target.children.find((c) => c.type === 'Grid.RowDefinitions'),
    authored =
      ctx.options.framework === 'Avalonia'
        ? (target.props.RowDefinitions || '').split(',').filter(Boolean).length
        : existing?.children.length || 0;
  if (maxRow > authored) {
    if (ctx.options.framework === 'Avalonia')
      target.props.RowDefinitions = [
        ...(target.props.RowDefinitions || '').split(',').filter(Boolean),
        ...Array(maxRow - authored).fill('Auto'),
      ].join(',');
    else {
      const definitions = existing || element('Grid.RowDefinitions');
      definitions.children.push(
        ...Array.from({ length: maxRow - authored }, () =>
          element('RowDefinition', { Height: 'Auto' }),
        ),
      );
      if (!existing) target.children.unshift(definitions);
    }
  }
}
function restoreXamlMetadata(target, source, meta, css, ctx) {
  const original = { ...meta.props },
    baseline = meta.generated || {},
    baselineCss = styleObject(baseline.style),
    fresh = { ...target.props };
  for (const key of Object.keys(boxCss))
    if (baselineCss[key])
      baselineCss[key] = cssBoxValues(baselineCss[key])?.join(' ') ?? baselineCss[key];
  delete original[META_XAML];
  for (const [key, cssKey] of Object.entries(cssProperties)) {
    if (css[cssKey] !== baselineCss[cssKey]) {
      delete original[key];
      if (has(fresh, key)) original[key] = fresh[key];
    }
  }
  for (const [key, attr] of Object.entries(attrProperties)) {
    if (source.props[attr] !== baseline[attr]) {
      delete original[key];
      if (has(fresh, key)) original[key] = fresh[key];
    }
  }
  if (css.display !== baselineCss.display || css.visibility !== baselineCss.visibility) {
    delete original.Visibility;
    delete original.IsVisible;
    if (fresh.Visibility) original.Visibility = fresh.Visibility;
    if (fresh.IsVisible) original.IsVisible = fresh.IsVisible;
  }
  for (const key of [
    'Orientation',
    'RowDefinitions',
    'ColumnDefinitions',
    'Grid.Row',
    'Grid.Column',
    'Grid.RowSpan',
    'Grid.ColumnSpan',
  ])
    if (has(fresh, key)) original[key] = fresh[key];
  const header = source.children.find((child) => ['summary', 'legend'].includes(child.type));
  if (header) {
    delete original.Header;
    if (fresh.Header !== undefined) original.Header = fresh.Header;
  }
  const content = meta.contentKey;
  if (content) {
    if (source.children.some((c) => c.kind === 'element' && !['script', 'style'].includes(c.type)))
      delete original[content];
    const value = source.type === 'input' ? (source.props.value ?? '') : textContent(source);
    if (
      !source.children.some((c) => c.kind === 'element' && !['script', 'style'].includes(c.type)) &&
      value !== String(meta.content ?? '')
    ) {
      if (value) original[content] = value.startsWith('{') ? '{}' + value : value;
      else delete original[content];
    }
  }
  for (const [key, value] of Object.entries(fresh))
    if (!has(original, key) && !has(meta.props, key)) original[key] = value;
  Object.assign(target.props, original);
  for (const key of Object.keys(target.props))
    if (has(meta.props, key) && !has(original, key)) delete target.props[key];
  const properties = (meta.children || [])
    .filter(
      (child) =>
        !['Content', 'Child', 'Children', 'Inlines', 'Items', 'Header'].some((name) =>
          child.type?.endsWith('.' + name),
        ),
    )
    .map((n) => restoreNode(n));
  for (const axis of ['Row', 'Column']) {
    const type = 'Grid.' + axis + 'Definitions',
      cssKey = 'grid-template-' + (axis === 'Row' ? 'rows' : 'columns'),
      original = properties.find((child) => child.type === type);
    if (!original) continue;
    if (css[cssKey] === baselineCss[cssKey])
      target.children = target.children.filter((child) => child.type !== type);
    else {
      const index = properties.indexOf(original);
      properties.splice(index, 1);
      const fresh = target.children.find((child) => child.type === type);
      if (fresh)
        fresh.children.forEach((child, index) => {
          child.props = { ...(original.children[index]?.props || {}), ...child.props };
        });
    }
  }
  const existingTypes = new Set(target.children.filter((c) => isProperty(c)).map((c) => c.type));
  target.children.unshift(...properties.filter((c) => !existingTypes.has(c.type)));
}

function animationProperty(path) {
  if (/RotateTransform\.Angle/.test(path))
    return { property: 'rotate', key: 'Angle', format: (v) => v + 'deg' };
  if (/TranslateTransform\.([XY])/.test(path)) {
    const axis = path.match(/TranslateTransform\.([XY])/)[1];
    return {
      property: 'transform',
      key: axis,
      format: (v) => 'translate' + axis + '(' + v + 'px)',
    };
  }
  if (/ScaleTransform\.Scale([XY])/.test(path)) {
    const axis = path.match(/ScaleTransform\.Scale([XY])/)[1];
    return {
      property: 'transform',
      key: 'Scale' + axis,
      format: (v) => 'scale' + axis + '(' + v + ')',
    };
  }
  const direct = cssProperties[path];
  if (direct) return { property: direct, key: path };
  const color = path.match(/\((?:\w+\.)?(Background|Foreground|BorderBrush|Fill|Stroke)\).*Color/);
  if (color) return { property: cssProperties[color[1]], key: color[1] };
  return null;
}
function emitAnimations(ctx, head) {
  const rules = [];
  let animationIndex = 0;
  for (const story of listStoryboards(ctx.input)) {
    const tracks = storyboardTracks(ctx.input, story.node);
    for (const track of tracks) {
      const mapping = animationProperty(track.property),
        target = ctx.htmlByXaml.get(track.targetId);
      if (!mapping || !target || !Number.isFinite(track.duration) || track.duration <= 0) {
        ctx.report(
          'warning',
          'ANIMATION_TRACK',
          `Animation ${story.name}/${track.property || '(no target)'} needs an animation compiler adapter.`,
          track.node,
          true,
        );
        continue;
      }
      const frames = track.frames.length
        ? track.frames
        : [
            { time: 0, value: track.node.props.From },
            { time: track.duration, value: track.node.props.To },
          ];
      if (
        frames.some(
          (f) =>
            f.value === undefined || !['Linear', 'Discrete', 'Spline', undefined].includes(f.mode),
        ) ||
        track.node.props.By !== undefined
      ) {
        ctx.report(
          'warning',
          'ANIMATION_VALUE',
          'Implicit-base, additive and easing-function animation tracks require a runtime adapter.',
          track.node,
          true,
        );
        continue;
      }
      const name = 'xamora_' + safeName(story.name) + '_' + ++animationIndex,
        body = frames
          .map((frame, index) => {
            const value = mapping.format
                ? mapping.format(frame.value)
                : cssValue(mapping.key, String(frame.value), ctx, track.node),
              next = frames[index + 1],
              timing =
                next?.mode === 'Discrete'
                  ? 'steps(1, end)'
                  : next?.mode === 'Spline'
                    ? 'cubic-bezier(' +
                      String(next.node?.props.KeySpline || '.25,.1,.25,1')
                        .split(/[,\s]+/)
                        .join(',') +
                      ')'
                    : 'linear';
            return `  ${Math.max(0, Math.min(100, (frame.time / track.duration) * 100))}% { ${mapping.property}: ${value}; animation-timing-function: ${timing}; }`;
          })
          .join('\n');
      rules.push(`@keyframes ${name} {\n${body}\n}`);
      const css = styleObject(target.props.style),
        repeat = track.node.props.RepeatBehavior || story.node.props.RepeatBehavior || '1x',
        iterations = /^Forever$/i.test(repeat)
          ? 'infinite'
          : /^\d+(?:\.\d+)?x$/.test(repeat)
            ? repeat.slice(0, -1)
            : '1',
        reverse = /^true$/i.test(
          track.node.props.AutoReverse || story.node.props.AutoReverse || '',
        ),
        delay = parseTime(track.node.props.BeginTime, 0) + parseTime(story.node.props.BeginTime, 0),
        speed = Number(track.node.props.SpeedRatio || story.node.props.SpeedRatio || 1),
        duration = track.duration / (speed > 0 ? speed : 1),
        value = `${name} ${duration}s linear ${delay}s ${reverse && iterations !== 'infinite' ? Number(iterations) * 2 : iterations} ${reverse ? 'alternate' : 'normal'} ${track.node.props.FillBehavior === 'Stop' ? 'none' : 'both'} paused`;
      css.animation = css.animation ? css.animation + ', ' + value : value;
      target.props.style = styleText(css);
      target.props['data-xamora-storyboard'] = story.name;
      ctx.report(
        'info',
        'ANIMATION_PAUSED',
        `Storyboard ${story.name} is emitted as paused CSS keyframes; start it explicitly through application interaction.`,
        track.node,
      );
    }
  }
  if (rules.length)
    head.children.push(
      element('style', { 'data-xamora-compiled-animations': '' }, [textNode(rules.join('\n\n'))]),
    );
}
function animationBindings(css) {
  const names = splitCssList(css['animation-name'] || '');
  const shorthand = splitCssList(css.animation || '').map((value) => {
    const tokens = splitCssList(value, ' '),
      times = tokens.filter((token) => /^-?[\d.]+m?s$/.test(token));
    const timing =
      tokens.find((token) =>
        /^(linear|ease(?:-in|-out|-in-out)?|step-start|step-end|cubic-bezier\(|steps\()/.test(
          token,
        ),
      ) || 'ease';
    const direction =
      tokens.find((token) => /^(normal|reverse|alternate|alternate-reverse)$/.test(token)) ||
      'normal';
    const fill = tokens.find((token) => /^(none|forwards|backwards|both)$/.test(token)) || 'none';
    const play = tokens.find((token) => /^(running|paused)$/.test(token)) || 'running';
    const iterations =
      tokens.find((token) => token === 'infinite' || /^\d+(?:\.\d+)?$/.test(token)) || '1';
    const known = new Set([...times, timing, direction, fill, play, iterations]);
    return {
      name: tokens.find((token) => !known.has(token)) || 'none',
      duration: times[0] || '0s',
      delay: times[1] || '0s',
      timing,
      direction,
      fill,
      play,
      iterations,
    };
  });
  const fields = {
    duration: 'animation-duration',
    delay: 'animation-delay',
    timing: 'animation-timing-function',
    direction: 'animation-direction',
    fill: 'animation-fill-mode',
    play: 'animation-play-state',
    iterations: 'animation-iteration-count',
  };
  const result = names.length
    ? names.map((name, index) => ({ ...shorthand[index], name }))
    : shorthand;
  for (const entry of result)
    for (const [key, property] of Object.entries(fields)) {
      const list = splitCssList(css[property] || '');
      if (list.length) entry[key] = list[result.indexOf(entry) % list.length];
    }
  return result;
}
function cssSeconds(value = '0s') {
  return /^-?[\d.]+m?s$/.test(value) ? parseFloat(value) * (value.endsWith('ms') ? 0.001 : 1) : NaN;
}
function importAnimations(ctx, root) {
  if (ctx.options.framework === 'Avalonia') {
    const found = ctx.cssKeyframes?.length > 0;
    if (found)
      ctx.report(
        'warning',
        'TARGET_ANIMATION_ADAPTER',
        'CSS keyframes remain portable metadata; Avalonia Animation lowering requires a target animation adapter.',
        ctx.input.root,
        true,
      );
    return;
  }
  const definitions = new Map(),
    resources = [],
    activation = [];
  let sequence = 0;
  let retainedStory = false;
  walk(root, (node) => {
    if (localName(node.type) === 'Storyboard') retainedStory = true;
  });
  for (const { rule, node } of ctx.cssKeyframes || []) {
    if (retainedStory && has(node.props, 'data-xamora-compiled-animations')) {
      ctx.report(
        'warning',
        'STORYBOARD_ROUNDTRIP',
        'Original native storyboard structure is retained. Edits to compiled CSS keyframes remain in HTML metadata and require explicit native track reconciliation.',
        node,
        true,
      );
      continue;
    }
    definitions.set(rule.name, rule);
  }
  walk(ctx.input.root, (target) => {
    if (target.kind !== 'element') return;
    const css = resolvedCss(target, ctx),
      bindings = animationBindings(css),
      pair = ctx.pairs.find(([id]) => id === target.id),
      xaml = pair && findNode(root, pair[1]);
    if (!xaml) return;
    for (const binding of bindings) {
      const def = definitions.get(binding.name);
      if (!def) {
        if (binding.name !== 'none')
          ctx.report(
            'warning',
            'CSS_ANIMATION_REFERENCE',
            `Animation ${binding.name} is external or has no local keyframe definition.`,
            target,
            true,
          );
        continue;
      }
      const duration = cssSeconds(binding.duration || '0s'),
        delay = cssSeconds(binding.delay || '0s');
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(delay) || delay < 0) {
        ctx.report(
          'warning',
          'CSS_ANIMATION_TIMING',
          'Zero duration, negative delay, and timeline-relative animations require a runtime adapter.',
          target,
          true,
        );
        continue;
      }
      const name = xaml.props['x:Name'] || 'motion_' + ++sequence;
      xaml.props['x:Name'] = name;
      const tracks = [],
        properties = new Set(
          def.frames
            .flatMap((frame) => Object.keys(frame.values))
            .filter((property) => property !== 'animation-timing-function'),
        );
      for (const property of properties) {
        let key = Object.keys(cssProperties).find((k) => cssProperties[k] === property),
          convert = (value) => xamlValue(key, value),
          path = key;
        if (property === 'rotate') {
          key = 'Angle';
          path = ensureTransformPath({ root }, xaml, 'Angle');
          convert = (value) => (/^[-\d.]+deg$/.test(value) ? String(parseFloat(value)) : null);
        }
        if (property === 'transform') {
          const samples = def.frames
            .filter((frame) => has(frame.values, property))
            .map((frame) =>
              frame.values[property].match(
                /^(translateX|translateY|scaleX|scaleY|rotate)\(([-\d.]+)(px|deg)?\)$/,
              ),
            );
          if (samples.length && samples.every((match) => match && match[1] === samples[0][1])) {
            key = {
              translateX: 'X',
              translateY: 'Y',
              scaleX: 'ScaleX',
              scaleY: 'ScaleY',
              rotate: 'Angle',
            }[samples[0][1]];
            path = ensureTransformPath({ root }, xaml, key);
            convert = (value) => value.match(/\(([-\d.]+)/)?.[1] ?? null;
          }
        }
        if (!key || !path) {
          ctx.report(
            'warning',
            'CSS_ANIMATION_PROPERTY',
            `CSS animation ${def.name}.${property} has no native animation mapping.`,
            target,
            true,
          );
          continue;
        }
        const type = colors.has(key) ? 'Color' : thickness.has(key) ? 'Thickness' : 'Double',
          points = def.frames
            .flatMap((frame) =>
              frame.offsets
                .filter(Number.isFinite)
                .filter(() => has(frame.values, property))
                .map((offset) => ({
                  offset,
                  value: convert(frame.values[property]),
                  easing: frame.values['animation-timing-function'] || binding.timing || 'ease',
                })),
            )
            .sort((a, b) => a.offset - b.offset);
        if (points.some((point) => point.value === null)) {
          ctx.report(
            'warning',
            'CSS_ANIMATION_VALUE',
            `CSS animation ${def.name}.${property} contains nonliteral values.`,
            target,
            true,
          );
          continue;
        }
        if (['reverse', 'alternate-reverse'].includes(binding.direction)) {
          points.reverse();
          for (const point of points) point.offset = 1 - point.offset;
        }
        const frames = points.map((point, index) => {
          const easing = points[index - 1]?.easing || binding.timing || 'ease',
            splines = {
              ease: '.25,.1,.25,1',
              'ease-in': '.42,0,1,1',
              'ease-out': '0,0,.58,1',
              'ease-in-out': '.42,0,.58,1',
            },
            spline = splines[easing] || easing.match(/^cubic-bezier\(([^)]+)\)$/)?.[1];
          const mode =
            easing === 'linear'
              ? 'Linear'
              : /^(step-end|steps\(1, ?end\))$/.test(easing)
                ? 'Discrete'
                : spline
                  ? 'Spline'
                  : 'Linear';
          if (mode === 'Linear' && easing !== 'linear')
            ctx.report(
              'warning',
              'CSS_ANIMATION_EASING',
              `Timing function ${easing} requires a native easing adapter.`,
              target,
              true,
            );
          return element(`${mode}${type}KeyFrame`, {
            KeyTime: formatTime(point.offset * duration),
            Value: point.value,
            ...(spline ? { KeySpline: spline } : {}),
          });
        });
        const alternate = /alternate/.test(binding.direction || ''),
          iterations = binding.iterations || '1';
        tracks.push(
          element(
            `${type}AnimationUsingKeyFrames`,
            {
              'Storyboard.TargetName': name,
              'Storyboard.TargetProperty': path,
              Duration: formatTime(duration),
              BeginTime: formatTime(delay),
              RepeatBehavior:
                iterations === 'infinite'
                  ? 'Forever'
                  : String(Number(iterations) / (alternate ? 2 : 1)) + 'x',
              AutoReverse: alternate ? 'True' : 'False',
              FillBehavior: ['forwards', 'both'].includes(binding.fill) ? 'HoldEnd' : 'Stop',
            },
            frames,
          ),
        );
        if (['backwards', 'both'].includes(binding.fill) && delay > 0)
          ctx.report(
            'warning',
            'CSS_ANIMATION_BACKWARDS',
            'CSS backwards fill before begin time needs an initial-state adapter.',
            target,
            true,
          );
      }
      if (tracks.length) {
        const resourceName = 'Imported_' + safeName(def.name) + '_' + resources.length,
          story = element('Storyboard', { 'x:Key': resourceName }, tracks);
        resources.push(story);
        if (binding.play !== 'paused')
          activation.push(
            element('EventTrigger', { RoutedEvent: 'Loaded' }, [
              element('BeginStoryboard', { Storyboard: '{StaticResource ' + resourceName + '}' }),
            ]),
          );
      }
    }
  });
  if (resources.length)
    root.children.unshift(element(localName(root.type) + '.Resources', {}, resources));
  if (activation.length)
    root.children.push(element(localName(root.type) + '.Triggers', {}, activation));
}
function findNode(root, id) {
  let found;
  walk(root, (n) => {
    if (n.id === id) found = n;
  });
  return found;
}

function finalizeHtmlMetadata(root) {
  walk(root, (node) => {
    if (!node.props?.[META_HTML]) return;
    const meta = JSON.parse(node.props[META_HTML]);
    const part = node.children.find(
      (child) => child.props?.['data-xamora-control-part'] === 'input',
    );
    meta.generated = { ...node.props, ...(part?.props || {}) };
    delete meta.generated[META_HTML];
    node.props[META_HTML] = encodeMeta(meta);
  });
}
function convertXaml(ctx) {
  collectResources(ctx);
  const bodyNode = xamlToHtmlNode(ctx.input.root, ctx),
    head = element('head', {}, [
      element('meta', { charset: 'utf-8' }),
      element('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      element('title', {}, [textNode(ctx.input.name.replace(/\.[^.]+$/, ''))]),
      element('style', { 'data-xamora-compiled-base': '' }, [
        textNode(
          'html, body { min-height: 100%; margin: 0; } body { font-family: system-ui, sans-serif; } button, input, select, textarea { font-family: inherit; }',
        ),
      ]),
    ]);
  emitAnimations(ctx, head);
  const root = element('html', { lang: 'en' }, [
      head,
      element('body', {}, bodyNode ? [bodyNode] : []),
    ]),
    doc = createDocument(
      root,
      'HTML',
      ctx.options.name || ctx.input.name.replace(/\.(?:xaml|axaml)$/i, '.html'),
    );
  const rootMeta = decodeMeta(webMetadata(ctx.input.root, ctx), ctx, ctx.input.root);
  if (rootMeta?.document && ctx.options.preserveMetadata !== false) {
    const saved = rootMeta.document;
    root.props = { ...(saved.props || { lang: 'en' }) };
    const savedHead = (saved.head || [])
      .filter((n) => ctx.options.allowScripts === true || n.type !== 'script')
      .map((n) => restoreNode(n));
    if (savedHead.length) head.children = savedHead;
    root.children[1].props = { ...(saved.bodyProps || {}) };
    if (ctx.options.allowScripts !== true)
      for (const key of Object.keys(root.children[1].props))
        if (/^on/i.test(key)) delete root.children[1].props[key];
    root.children[1].children.push(
      ...(saved.siblings || [])
        .filter(
          (n) => n.kind !== 'text' && (ctx.options.allowScripts === true || n.type !== 'script'),
        )
        .map((n) => restoreNode(n)),
    );
  }
  if (ctx.options.allowScripts !== true) sanitizeCompiledHtml(root, ctx);
  finalizeHtmlMetadata(root);
  doc.metadata.html = { doctype: '<!DOCTYPE html>' };
  doc.metadata.semanticCompiler = { version: 1, from: ctx.input.framework };
  return doc;
}
function sanitizeCompiledHtml(root, ctx) {
  walk(root, (node) => {
    if (node.kind !== 'element') return;
    node.children = node.children.filter(
      (child) =>
        child.type !== 'script' &&
        !(child.type === 'meta' && /^refresh$/i.test(child.props['http-equiv'] || '')),
    );
    for (const key of Object.keys(node.props))
      if (
        /^on/i.test(key) ||
        key === 'srcdoc' ||
        (['href', 'src', 'action', 'formaction', 'data', 'xlink:href'].includes(key) &&
          /^\s*(?:javascript:|vbscript:|data:\s*(?:text\/html|application\/xhtml\+xml))/i.test(
            String(node.props[key]).replace(/[\u0000-\u0020\u007f]/g, ''),
          ))
      )
        delete node.props[key];
    if (node.type === 'iframe') {
      node.props.sandbox = '';
      delete node.props.allow;
    }
    if (['object', 'embed'].includes(node.type)) {
      delete node.props.data;
      delete node.props.src;
    }
  });
}
function convertHtml(ctx) {
  collectCompilerCss(ctx);
  const body = htmlBody(ctx.input),
    visible = body.children.filter(
      (n) =>
        (n.kind === 'element' && !['script', 'style', 'link', 'meta'].includes(n.type)) ||
        (n.kind === 'text' && n.text.trim()),
    ),
    single =
      !ctx.options.renderSnapshot?.has(body.id) &&
      visible.length === 1 &&
      visible[0].kind === 'element',
    root = single
      ? htmlToXamlNode(visible[0], ctx)
      : element('UserControl', {}, [htmlToXamlNode(body, ctx)].filter(Boolean));
  if (!root) throw Error('The HTML document has no convertible visual root.');
  root.props.xmlns = namespaces[ctx.options.framework] || namespaces.WPF;
  root.props['xmlns:x'] = XAML_NAMESPACE;
  if (ctx.options.preserveMetadata !== false) {
    const meta = decodeMeta(root.props[META_XAML], ctx, root) || {
      type: single ? visible[0].type : 'body',
      props: {},
      generated: {},
    };
    meta.document = {
      props: { ...ctx.input.root.props },
      head: (ctx.input.root.children.find((n) => n.type === 'head')?.children || []).map(rawNode),
      bodyProps: { ...body.props },
      siblings: body.children.filter((n) => !visible.includes(n)).map(rawNode),
    };
    root.props[META_XAML] = encodeMeta(meta);
    declarePortableNamespace(root);
  }
  walk(ctx.input.root, (n) => {
    if (n.type === 'script')
      ctx.report(
        'warning',
        'SCRIPT_PRESERVED',
        'JavaScript is preserved as inert metadata; arbitrary JavaScript cannot be translated to native XAML behavior.',
        n,
        true,
      );
  });
  importAnimations(ctx, root);
  const doc = createDocument(
    root,
    ctx.options.framework,
    ctx.options.name ||
      ctx.input.name.replace(
        /\.html?$/i,
        ctx.options.framework === 'Avalonia' ? '.axaml' : '.xaml',
      ),
  );
  doc.metadata.semanticCompiler = { version: 1, from: 'HTML' };
  return doc;
}

/** Compile source text or an existing shared AST. No input object is mutated. */
export function compileDocument(input, options = {}) {
  const from = String(
      options.from || (typeof input === 'object' && input.framework === 'HTML' ? 'html' : 'xaml'),
    ).toLowerCase(),
    to = String(options.to || (from === 'xaml' ? 'html' : 'xaml')).toLowerCase(),
    settings = { preserveMetadata: true, strict: false, framework: 'WPF', ...options, from, to };
  let ctx;
  try {
    if (!['xaml', 'html'].includes(from) || !['xaml', 'html'].includes(to))
      throw Error('Compiler languages must be xaml or html.');
    for (const [key, maximum] of Object.entries({
      maxStylesheets: 4096,
      maxStylesheetDepth: 128,
      maxStylesheetBytes: 50_000_000,
      maxCssRules: 200000,
      maxSelectorSteps: 20_000_000,
    }))
      if (
        settings[key] !== undefined &&
        (!Number.isSafeInteger(settings[key]) || settings[key] < 1 || settings[key] > maximum)
      )
        throw RangeError(`${key} must be a positive integer no greater than ${maximum}.`);
    for (const key of ['resolveStylesheet', 'containerEnvironment'])
      if (settings[key] !== undefined && typeof settings[key] !== 'function')
        throw TypeError(`${key} must be a function.`);
    if (settings.environment != null) {
      if (typeof settings.environment !== 'object' || Array.isArray(settings.environment))
        throw TypeError('environment must be an object.');
      for (const key of [
        'width',
        'height',
        'fontSize',
        'rootFontSize',
        'initialFontSize',
        'resolution',
      ])
        if (
          settings.environment[key] !== undefined &&
          (!Number.isFinite(settings.environment[key]) || settings.environment[key] < 0)
        )
          throw RangeError(`environment.${key} must be a finite nonnegative number.`);
    }
    if (!['WPF', 'Avalonia'].includes(settings.framework))
      throw Error(
        'Semantic conversion currently targets WPF or Avalonia. Other frameworks require a target adapter.',
      );
    const source = typeof input === 'string' ? input : null,
      doc =
        source !== null
          ? from === 'html'
            ? parseHtml(source, {
                name: options.sourceName || 'index.html',
                Parser: options.Parser,
              })
            : parseXaml(source, { name: options.sourceName || 'MainView.xaml' })
          : clone(input);
    validateDocument(doc);
    if ((doc.framework === 'HTML') !== (from === 'html'))
      throw Error('Input AST framework does not match the requested source language.');
    ctx = context(settings, doc, source);
    const output = from === to ? clone(doc) : to === 'html' ? convertXaml(ctx) : convertHtml(ctx);
    validateDocument(output);
    const generated = to === 'html' ? prettyHtml(output) : serializeXaml(output),
      targetIndex = buildSourceIndex(generated, output),
      sourceMap = ctx.pairs.map(([sourceNodeId, targetNodeId]) => {
        const sourceRange = ctx.sourceIndex?.byId.get(sourceNodeId),
          targetRange = targetIndex.byId.get(targetNodeId),
          range = (v) => (v ? { start: v.start, end: v.end } : undefined);
        return {
          sourceNodeId,
          targetNodeId,
          sourceRange: range(sourceRange),
          targetRange: range(targetRange),
        };
      });
    const success =
      !ctx.diagnostics.some((d) => d.severity === 'error') &&
      (!settings.strict || ctx.losses.length === 0);
    if (settings.strict && ctx.losses.length)
      ctx.report(
        'error',
        'STRICT_CONVERSION',
        'Strict conversion rejected constructs without equivalent target behavior.',
        doc.root,
      );
    return {
      success,
      source: generated,
      document: output,
      diagnostics: ctx.diagnostics,
      sourceMap,
      losses: ctx.losses,
      metadata: {
        version: 1,
        from,
        to,
        preserved: settings.preserveMetadata !== false,
        sourceNodeCount: countNodes(doc.root),
        targetNodeCount: countNodes(output.root),
        ...(ctx.cssEnvironmentReport ? { css: ctx.cssEnvironmentReport } : {}),
      },
    };
  } catch (error) {
    const diagnostic = {
      severity: 'error',
      code: 'COMPILATION_ERROR',
      message: error.message,
      ...(error.line ? { line: error.line, column: error.column } : {}),
    };
    return {
      success: false,
      source: '',
      document: null,
      diagnostics: [...(ctx?.diagnostics || []), diagnostic],
      sourceMap: [],
      losses: ctx?.losses || [],
      metadata: { version: 1, from, to, preserved: settings.preserveMetadata !== false },
    };
  }
}
function countNodes(root) {
  let n = 0;
  walk(root, () => n++);
  return n;
}
function prettyHtml(doc) {
  const blocks = new Set([
      'html',
      'head',
      'body',
      'div',
      'main',
      'section',
      'article',
      'nav',
      'aside',
      'ul',
      'ol',
      'li',
      'fieldset',
      'details',
    ]),
    copy = clone(doc);
  const format = (n, depth) => {
    if (n.kind !== 'element' || HTML_RAW.has(n.type) || ['pre', 'textarea'].includes(n.type))
      return;
    for (const child of n.children) format(child, depth + 1);
    if (
      blocks.has(n.type) &&
      n.children.length &&
      n.children.every((c) => c.kind === 'element' || c.kind === 'comment')
    )
      n.children = [
        ...n.children.flatMap((c) => [textNode('\n' + '  '.repeat(depth + 1)), c]),
        textNode('\n' + '  '.repeat(depth)),
      ];
  };
  format(copy.root, 0);
  return serializeHtml(copy).replace(/^(<!DOCTYPE[^>]*>)(?=<html)/i, '$1\n') + '\n';
}

/** Runtime helper emitted handlers/bindings can use without eval or generated code. */
export function attachCompiledInteractions(root, { handlers = {}, data = {}, onChange } = {}) {
  const disposers = [];
  const read = (path) =>
    path
      .split('.')
      .filter(Boolean)
      .reduce(
        (value, key) =>
          ['__proto__', 'constructor', 'prototype'].includes(key) ? undefined : value?.[key],
        data,
      );
  const nodes = [root, ...root.querySelectorAll('*')];
  const refresh = () => {
    for (const node of nodes)
      for (const attr of node.attributes || []) {
        if (!attr.name.startsWith('data-xamora-bind-')) continue;
        const match = attr.value.match(/^\{Binding\s*(?:Path\s*=\s*)?([\w.]+)\s*\}$/);
        if (!match) continue;
        const value = read(match[1]),
          property = attr.name.slice(17);
        if (value === undefined) continue;
        if (['text', 'content'].includes(property)) {
          if (['INPUT', 'TEXTAREA'].includes(node.tagName)) node.value = String(value);
          else if (!node.children.length) node.textContent = String(value);
        } else if (property === 'ischecked') node.checked = Boolean(value);
        else if (property === 'isenabled') node.disabled = !value;
        else if (property === 'value') node.value = String(value);
        else {
          const key = Object.keys(cssProperties).find(
            (k) => safeName(k).toLowerCase() === property,
          );
          if (key) {
            const converted = cssValue(key, String(value));
            if (converted !== null) node.style.setProperty(cssProperties[key], converted);
          }
        }
      }
  };
  for (const node of nodes)
    for (const attr of node.attributes || []) {
      if (!attr.name.startsWith('data-xamora-on-')) continue;
      const name = attr.name.slice(15),
        handler = handlers[attr.value];
      if (typeof handler !== 'function') continue;
      const listener = (event) => {
        handler(event, { data, element: node, refresh });
        onChange?.(data);
        refresh();
      };
      node.addEventListener(name, listener);
      disposers.push(() => node.removeEventListener(name, listener));
    }
  refresh();
  return {
    refresh,
    dispose() {
      for (const dispose of disposers) dispose();
      disposers.length = 0;
    },
  };
}
