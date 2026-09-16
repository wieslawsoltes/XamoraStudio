/** Bounded, deterministic CSS environment and stylesheet handling. Never fetches a URL. */
import { walk } from './model.js';
import { parseCssAnimationStylesheet, splitCssList } from './html-animation.js';

const all = (items) => (items.includes(false) ? false : items.includes(null) ? null : true);
const any = (items) => (items.includes(true) ? true : items.includes(null) ? null : false);
const not = (value) => (value === null ? null : !value);
const own = (object, key) => object != null && Object.hasOwn(object, key);

/** Return the closing delimiter, respecting strings, comments and escaped characters. */
export function cssClosing(source, start) {
  const stack = [],
    pairs = { '(': ')', '[': ']', '{': '}' };
  let quote = '';
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (')]}'.includes(c)) {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

function logical(source, feature, depth = 0) {
  source = source.trim();
  if (!source || source.length > 4096 || depth > 32) return null;
  if (/^not\s+/i.test(source))
    return not(logical(source.replace(/^not\s+/i, ''), feature, depth + 1));
  const terms = [],
    operators = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '(') {
      i = cssClosing(source, i);
      if (i < 0) return null;
    } else {
      const op = source.slice(i).match(/^\s+(and|or)\s+/i);
      if (op) {
        terms.push(source.slice(start, i));
        operators.push(op[1].toLowerCase());
        i += op[0].length - 1;
        start = i + 1;
      }
    }
  }
  if (operators.length) {
    if (new Set(operators).size !== 1) return null;
    terms.push(source.slice(start));
    return (operators[0] === 'and' ? all : any)(
      terms.map((part) => logical(part, feature, depth + 1)),
    );
  }
  if (source[0] === '(' && cssClosing(source, 0) === source.length - 1) {
    const inner = source.slice(1, -1).trim();
    if (/^(?:\(|not\s)/i.test(inner)) return logical(inner, feature, depth + 1);
    return feature(inner);
  }
  return null;
}

function mediaNumber(value, feature, env) {
  value = value.trim().toLowerCase();
  if (feature === 'aspect-ratio') {
    const ratio = value.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (ratio && +ratio[2] !== 0) return +ratio[1] / +ratio[2];
  }
  const match = value.match(
    /^([-+]?(?:\d+(?:\.\d*)?|\.\d+))(px|em|rem|in|cm|mm|q|pt|pc|dpi|dpcm|dppx|x)?$/,
  );
  if (!match) return null;
  const unit = match[2] || '';
  if (feature === 'resolution') {
    const units = { dpi: 1 / 96, dpcm: 2.54 / 96, dppx: 1, x: 1 };
    return own(units, unit) ? +match[1] * units[unit] : null;
  }
  if (['width', 'height'].includes(feature)) {
    const units = {
      px: 1,
      em: env.fontSize ?? 16,
      rem: env.fontSize ?? 16,
      in: 96,
      cm: 96 / 2.54,
      mm: 96 / 25.4,
      q: 96 / 101.6,
      pt: 96 / 72,
      pc: 16,
    };
    return own(units, unit) ? +match[1] * units[unit] : !unit && +match[1] === 0 ? 0 : null;
  }
  return !unit ? +match[1] : null;
}
function mediaFeature(source, env) {
  const aliases = {
    'prefers-color-scheme': 'colorScheme',
    'prefers-reduced-motion': 'reducedMotion',
    'any-pointer': 'anyPointer',
    'any-hover': 'anyHover',
    'forced-colors': 'forcedColors',
  };
  const rangeNames = new Set([
    'width',
    'height',
    'aspect-ratio',
    'resolution',
    'color',
    'monochrome',
    'color-index',
  ]);
  const read = (name) => {
    if (name === 'aspect-ratio')
      return Number.isFinite(env.width) && Number.isFinite(env.height) && env.height > 0
        ? env.width / env.height
        : null;
    if (name === 'orientation')
      return Number.isFinite(env.width) && Number.isFinite(env.height)
        ? env.width > env.height
          ? 'landscape'
          : 'portrait'
        : null;
    const value = own(env, aliases[name] || name)
      ? env[aliases[name] || name]
      : own(env.features, name)
        ? env.features[name]
        : null;
    return value === undefined ? null : value;
  };
  const compare = (a, op, b) =>
    a === null || b === null
      ? null
      : ({ '<': a < b, '<=': a <= b, '=': a === b, '>=': a >= b, '>': a > b }[op] ?? null);
  const simple = source.match(/^([\w-]+)(?:\s*:\s*(.+))?$/);
  if (simple) {
    let name = simple[1].toLowerCase(),
      op = '=';
    if (/^(min|max)-/.test(name)) {
      op = name.startsWith('min-') ? '>=' : '<=';
      name = name.slice(4);
      if (!rangeNames.has(name) || !simple[2]) return null;
    }
    const actual = read(name);
    if (actual === null) return null;
    if (simple[2] === undefined) return ![0, false, 'none', 'no-preference'].includes(actual);
    if (rangeNames.has(name)) return compare(actual, op, mediaNumber(simple[2], name, env));
    const expected = simple[2].trim().toLowerCase();
    const choices = {
      orientation: ['portrait', 'landscape'],
      'prefers-color-scheme': ['light', 'dark'],
      'prefers-reduced-motion': ['reduce', 'no-preference'],
      pointer: ['none', 'fine', 'coarse'],
      'any-pointer': ['none', 'fine', 'coarse'],
      hover: ['none', 'hover'],
      'any-hover': ['none', 'hover'],
      'forced-colors': ['none', 'active'],
    };
    if (choices[name] && !choices[name].includes(expected)) return null;
    return String(actual).toLowerCase() === expected;
  }
  const parts = source.split(/\s*(<=|>=|<|>|=)\s*/);
  if (![3, 5].includes(parts.length)) return null;
  const featureIndex = parts.findIndex((p, i) => i % 2 === 0 && rangeNames.has(p));
  if (featureIndex < 0 || (parts.length === 5 && featureIndex !== 2)) return null;
  if (
    parts.length === 5 &&
    !(
      (parts[1].startsWith('<') && parts[3].startsWith('<')) ||
      (parts[1].startsWith('>') && parts[3].startsWith('>'))
    )
  )
    return null;
  const name = parts[featureIndex],
    numbers = parts.map((part, index) =>
      index % 2 ? part : index === featureIndex ? read(name) : mediaNumber(part, name, env),
    );
  return all([
    compare(numbers[0], numbers[1], numbers[2]),
    ...(numbers.length === 5 ? [compare(numbers[2], numbers[3], numbers[4])] : []),
  ]);
}

/** true/false for known conditions, null when the supplied environment is insufficient. */
export function evaluateMediaQuery(query, environment = {}) {
  if (
    typeof query !== 'string' ||
    query.length > 4096 ||
    !environment ||
    typeof environment !== 'object'
  )
    return null;
  if (
    ['width', 'height', 'fontSize', 'resolution'].some(
      (key) =>
        own(environment, key) && (!Number.isFinite(environment[key]) || environment[key] < 0),
    )
  )
    return null;
  if (environment.type && typeof environment.type !== 'string') return null;
  if (!query.trim()) return true;
  return any(
    splitCssList(query).map((part) => {
      part = part.trim();
      const typed = part.match(
        /^(?:(only|not)\s+)?(?!not\b|and\b|or\b)([a-z][\w-]*)(?:\s+and\s+([\s\S]+))?$/i,
      );
      if (!typed) return logical(part, (feature) => mediaFeature(feature, environment));
      const type = typed[2].toLowerCase();
      const match =
        type === 'all'
          ? true
          : !['screen', 'print', 'speech'].includes(type)
            ? false
            : environment.type
              ? environment.type.toLowerCase() === type
              : null;
      const result = all([
        match,
        ...(typed[3] ? [logical(typed[3], (feature) => mediaFeature(feature, environment))] : []),
      ]);
      return typed[1]?.toLowerCase() === 'not' ? not(result) : result;
    }),
  );
}

/** @supports uses an explicit capability callback/map, not the compiler host's browser. */
export function evaluateSupportsCondition(condition, supports) {
  if (typeof condition !== 'string' || condition.length > 4096) return null;
  if (typeof supports === 'function') {
    const result = supports(condition);
    return typeof result === 'boolean' ? result : null;
  }
  if (own(supports, condition))
    return typeof supports[condition] === 'boolean' ? supports[condition] : null;
  return logical(condition, (feature) =>
    own(supports, feature) && typeof supports[feature] === 'boolean' ? supports[feature] : null,
  );
}

export function stylesheetUrl(href, baseUrl = 'https://xamora.invalid/index.html') {
  const url = new URL(href, baseUrl);
  if (!['http:', 'https:', 'file:'].includes(url.protocol) || url.username || url.password)
    throw Error('Stylesheet URLs must be http, https or file without credentials.');
  url.hash = '';
  return url.href;
}

export function parseStylesheetImport(raw) {
  const match = raw.match(
    /^@import\s+(?:url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^\s)'"\\]+))\s*\)|"([^"\\]*)"|'([^'\\]*)')\s*([\s\S]*?);?$/i,
  );
  if (!match) return null;
  let rest = match[6].replace(/;\s*$/, '').trim(),
    layer = null,
    supports = null;
  const layerMatch = rest.match(/^layer(?:\(\s*([\w.-]+)\s*\))?(?=\s|$)/i);
  if (layerMatch) {
    layer = layerMatch[1] || '';
    rest = rest.slice(layerMatch[0].length).trim();
  }
  if (/^supports\(/i.test(rest)) {
    const end = cssClosing(rest, 8);
    if (end < 0) return null;
    supports = rest.slice(9, end).trim();
    if (!/^(?:\(|not\b|selector\()/i.test(supports)) supports = '(' + supports + ')';
    rest = rest.slice(end + 1).trim();
  }
  return {
    href: match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5],
    media: rest,
    layer,
    supports,
  };
}

/** Stylesheet order, nested conditions, cascade layers and explicit import graphs. */
export function collectCompilerCss(input, options, report) {
  const rules = [],
    rootLayer = { children: new Map() },
    dependencies = new Set();
  let anonymous = 0,
    bytes = 0,
    sheets = 0;
  let baseUrl = stylesheetUrl(options.baseUrl || options.sourceName || 'index.html');
  const base = input.root.children
    .find((n) => n.type === 'head')
    ?.children.find((n) => n.type === 'base' && n.props.href);
  if (base) baseUrl = stylesheetUrl(base.props.href, baseUrl);
  const problem = (code, message, node) => report('warning', code, message, node, true);
  const layerAt = (parent, name) => {
    let current = parent;
    for (const part of name ? name.split('.') : ['#' + ++anonymous]) {
      if (!/^(?:[\w-]+|#\d+)$/.test(part)) throw Error('Unsupported CSS layer name.');
      if (!current.children.has(part)) current.children.set(part, { children: new Map() });
      current = current.children.get(part);
    }
    return current;
  };
  const lookup = (href, url) => {
    const source = options.stylesheets;
    const get = (key) =>
      source instanceof Map ? source.get(key) : own(source, key) ? source[key] : undefined;
    return get(url) ?? get(href);
  };
  const load = (href, ownerUrl, conditions, layer, stack, node) => {
    let url;
    try {
      url = stylesheetUrl(href, ownerUrl);
    } catch (error) {
      problem('CSS_STYLESHEET_URL', error.message, node);
      return;
    }
    dependencies.add(url);
    if (stack.includes(url)) {
      problem('CSS_IMPORT_CYCLE', 'Cyclic stylesheet import was stopped: ' + url, node);
      return;
    }
    const text = lookup(href, url);
    if (typeof text !== 'string') {
      problem(
        'EXTERNAL_CSS',
        'Supply stylesheet text for ' + url + '; the compiler does not fetch resources.',
        node,
      );
      return;
    }
    parse(text, url, conditions, layer, [...stack, url], node);
  };
  const parse = (text, url, conditions, layer, stack, node) => {
    bytes += text.length;
    if (++sheets > 128 || stack.length > 16 || bytes > 2_000_000) {
      problem(
        'CSS_STYLESHEET_LIMIT',
        'Stylesheet graph exceeds the 128-sheet, 16-depth or 2 MB source budget.',
        node,
      );
      return;
    }
    const ast = parseCssAnimationStylesheet(text);
    for (const diagnostic of ast.diagnostics)
      problem('CSS_SYNTAX', diagnostic.message || 'Invalid stylesheet syntax.', node);
    const visit = (children, activeConditions, currentLayer, depth = 0) => {
      if (depth > 32) {
        problem('CSS_CONDITION_LIMIT', 'CSS grouping depth exceeds 32.', node);
        return;
      }
      let importsAllowed = depth === 0;
      for (const rule of children) {
        if (rule.kind === 'raw') {
          const raw = rule.raw.trim();
          if (/^@charset\b/i.test(raw)) continue;
          if (/^@layer\s/i.test(raw)) {
            const names = raw
              .replace(/^@layer\s+/i, '')
              .replace(/;\s*$/, '')
              .split(',')
              .map((s) => s.trim());
            try {
              names.forEach((name) => layerAt(currentLayer, name));
            } catch (error) {
              problem('CSS_LAYER', error.message, node);
            }
          } else if (/^@import\b/i.test(raw) && importsAllowed) {
            const value = parseStylesheetImport(raw);
            if (!value) {
              problem('CSS_IMPORT_SYNTAX', 'Unsupported @import syntax: ' + raw, node);
              continue;
            }
            const next = [...activeConditions];
            if (value.media) next.push({ kind: 'media', query: value.media });
            if (value.supports) next.push({ kind: 'supports', query: value.supports });
            load(
              value.href,
              url,
              next,
              value.layer === null ? currentLayer : layerAt(currentLayer, value.layer),
              stack,
              node,
            );
          }
          continue;
        }
        importsAllowed = false;
        if (rule.declarations && !rule.header.startsWith('@')) {
          rules.push({
            header: rule.header,
            values: rule.declarations
              .filter((d) => d.property)
              .map((d) => [
                d.property.startsWith('--') ? d.property : d.property.toLowerCase(),
                d.value,
              ]),
            conditions: activeConditions,
            layer: currentLayer,
            node,
          });
          continue;
        }
        const group = rule.header.match(/^@(media|supports|container|layer)\b\s*([\s\S]*)$/i);
        if (!group) {
          if (!/keyframes\b/i.test(rule.header))
            problem(
              'CONDITIONAL_CSS',
              'CSS group requires a browser adapter: ' + rule.header,
              node,
            );
          continue;
        }
        if (group[1].toLowerCase() === 'layer') {
          try {
            visit(
              rule.children || [],
              activeConditions,
              layerAt(currentLayer, group[2].trim()),
              depth + 1,
            );
          } catch (error) {
            problem('CSS_LAYER', error.message, node);
          }
        } else
          visit(
            rule.children || [],
            [...activeConditions, { kind: group[1].toLowerCase(), query: group[2].trim() }],
            currentLayer,
            depth + 1,
          );
      }
    };
    visit(ast.children, conditions, layer);
  };
  walk(input.root, (node) => {
    if (
      node.type !== 'style' &&
      !(
        node.type === 'link' &&
        String(node.props.rel || '')
          .toLowerCase()
          .split(/\s+/)
          .includes('stylesheet')
      )
    )
      return;
    if (
      own(node.props, 'disabled') ||
      (node.type === 'link' && /\balternate\b/i.test(node.props.rel))
    )
      return;
    if (node.props.type && node.props.type.toLowerCase() !== 'text/css') return;
    const conditions = node.props.media ? [{ kind: 'media', query: node.props.media }] : [];
    if (node.type === 'style')
      parse(
        node.children.map((n) => n.text || '').join(''),
        baseUrl,
        conditions,
        rootLayer,
        [],
        node,
      );
    else load(node.props.href || '', baseUrl, conditions, rootLayer, [], node);
  });
  let order = 0;
  const rank = (layer) => {
    for (const child of layer.children.values()) rank(child);
    layer.order = order++;
  };
  rank(rootLayer);
  return { rules, dependencies: [...dependencies], baseUrl };
}

export function matchesCssConditions(rule, options, node) {
  return all(
    rule.conditions.map(({ kind, query }) => {
      if (options.evaluateCondition) {
        const result = options.evaluateCondition(kind, query, node);
        if (typeof result === 'boolean') return result;
      }
      if (kind === 'media') return evaluateMediaQuery(query, options.environment);
      if (kind === 'supports') return evaluateSupportsCondition(query, options.supports);
      return null;
    }),
  );
}
