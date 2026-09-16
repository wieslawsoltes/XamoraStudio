/** Explicit CSS environment evaluation. Unknown inputs stay unknown, including under `not`. */
import { splitCssList } from './html-animation.js';

const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const units = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16 };
const finite = (n) => (Number.isFinite(n) ? n : null);

/** Evaluate dimensional math without eval. Percentages require a known percentBase. */
export function resolveCssLength(source, environment = {}) {
  if (typeof source !== 'string' || source.length > 8192) return null;
  source = source.trim().toLowerCase();
  const matches = [
    ...source.matchAll(/(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?(?:[a-z]+|%)?|[a-z-]+|[^\s]/g),
  ];
  const tokens = matches.map((m) => m[0]);
  if (!tokens.length || tokens.length > 512) return null;
  if (
    !/^(?:calc|min|max|clamp)\(/.test(source) &&
    !/^[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?(?:[a-z]+|%)?$/.test(source)
  )
    return null;
  let at = 0,
    depth = 0;
  const fail = () => {
    throw Error('Not a supported CSS length.');
  };
  const primary = () => {
    if (++depth > 32) fail();
    let result;
    const token = tokens[at++];
    if (token === '+' || token === '-') {
      result = primary();
      if (token === '-') result.value *= -1;
    } else if (token === '(') {
      result = sum();
      if (tokens[at++] !== ')') fail();
    } else if (['calc', 'min', 'max', 'clamp'].includes(token)) {
      if (tokens[at++] !== '(') fail();
      const values = [sum()];
      while (tokens[at] === ',') {
        at++;
        values.push(sum());
      }
      if (tokens[at++] !== ')' || values.some((v) => v.dimension !== values[0].dimension)) fail();
      if ((token === 'calc' && values.length !== 1) || (token === 'clamp' && values.length !== 3))
        fail();
      const nums = values.map((v) => v.value);
      result = {
        dimension: values[0].dimension,
        value:
          token === 'min'
            ? Math.min(...nums)
            : token === 'max'
              ? Math.max(...nums)
              : token === 'clamp'
                ? Math.max(nums[0], Math.min(nums[1], nums[2]))
                : nums[0],
      };
    } else {
      const m = token?.match(/^((?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?)([a-z]+|%)?$/);
      if (!m) fail();
      const n = Number(m[1]),
        unit = m[2];
      if (!unit) result = { value: n, dimension: 0 };
      else {
        let scale = units[unit];
        if (unit === 'em') scale = environment.fontSize;
        if (unit === 'rem') scale = environment.rootFontSize;
        if (unit === '%')
          scale = environment.percentBase == null ? null : environment.percentBase / 100;
        if (/^(?:s|l|d)?v(?:w|h|min|max)$/.test(unit)) {
          const prefix = /^[sld]/.test(unit) ? unit[0] : '';
          const viewport =
            environment[
              prefix === 's'
                ? 'smallViewport'
                : prefix === 'l'
                  ? 'largeViewport'
                  : prefix === 'd'
                    ? 'dynamicViewport'
                    : 'viewport'
            ] || (!prefix ? environment : {});
          const dimension = unit.replace(/^[sld]?v/, '');
          scale =
            dimension === 'w'
              ? viewport.width / 100
              : dimension === 'h'
                ? viewport.height / 100
                : dimension === 'min'
                  ? Math.min(viewport.width, viewport.height) / 100
                  : Math.max(viewport.width, viewport.height) / 100;
        }
        if (!Number.isFinite(scale)) fail();
        result = { value: n * scale, dimension: 1 };
      }
    }
    depth--;
    if (!Number.isFinite(result.value)) fail();
    return result;
  };
  const product = () => {
    let left = primary();
    while (tokens[at] === '*' || tokens[at] === '/') {
      const op = tokens[at++],
        right = primary();
      if (op === '*' ? left.dimension && right.dimension : right.dimension || right.value === 0)
        fail();
      left = {
        value: op === '*' ? left.value * right.value : left.value / right.value,
        dimension: op === '*' ? Math.max(left.dimension, right.dimension) : left.dimension,
      };
    }
    return left;
  };
  const sum = () => {
    let left = product();
    while (tokens[at] === '+' || tokens[at] === '-') {
      const position = matches[at].index;
      if (!/\s/.test(source[position - 1] || '') || !/\s/.test(source[position + 1] || '')) fail();
      const op = tokens[at++],
        right = product();
      if (left.dimension !== right.dimension) fail();
      left = {
        value: left.value + (op === '+' ? right.value : -right.value),
        dimension: left.dimension,
      };
    }
    return left;
  };
  try {
    const value = sum();
    if (at !== tokens.length || (!value.dimension && value.value !== 0)) return null;
    return finite(value.value);
  } catch {
    return null;
  }
}

function topParts(source, operator) {
  const pieces = [];
  let start = 0,
    depth = 0,
    quote = '';
  for (let i = 0; i < source.length; i++) {
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
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (depth < 0) return null;
    if (
      !depth &&
      source.slice(i).match(new RegExp('^' + operator + '(?=\\s|\\()', 'i')) &&
      (i === 0 || /\s|\)/.test(source[i - 1]))
    ) {
      pieces.push(source.slice(start, i).trim());
      start = i + operator.length;
      i = start - 1;
    }
  }
  if (depth || quote) return null;
  pieces.push(source.slice(start).trim());
  return pieces.every(Boolean) ? pieces : null;
}
const and = (values) => (values.includes(false) ? false : values.includes(null) ? null : true);
const or = (values) => (values.includes(true) ? true : values.includes(null) ? null : false);
const not = (value) => (value === null ? null : !value);
function unwrap(source) {
  if (!source.startsWith('(') || !source.endsWith(')')) return null;
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '(') depth++;
    if (source[i] === ')' && --depth === 0 && i !== source.length - 1) return null;
  }
  return source.slice(1, -1).trim();
}
function numericFeature(name, env) {
  if (['width', 'height', 'device-width', 'device-height'].includes(name))
    return env[name] ?? env[name.replace('device-', '')] ?? null;
  if (name === 'aspect-ratio')
    return env.width >= 0 && env.height > 0 ? env.width / env.height : null;
  if (['resolution', 'color', 'color-index', 'monochrome', 'grid'].includes(name))
    return env[name] ?? null;
  return null;
}
function numericValue(value, feature, env) {
  if (['width', 'height', 'device-width', 'device-height'].includes(feature))
    return resolveCssLength(value, {
      ...env,
      rootFontSize: env.initialFontSize ?? 16,
      fontSize: env.initialFontSize ?? 16,
    });
  if (feature === 'aspect-ratio') {
    const m = value.match(/^([\d.]+)\s*\/\s*([\d.]+)$/);
    return m && Number(m[2]) > 0
      ? finite(Number(m[1]) / Number(m[2]))
      : /^\d+(?:\.\d+)?$/.test(value)
        ? Number(value)
        : null;
  }
  if (feature === 'resolution') {
    const m = value.match(/^([\d.]+)(dppx|x|dpi|dpcm)$/i);
    return m
      ? finite(Number(m[1]) * { dppx: 1, x: 1, dpi: 1 / 96, dpcm: 2.54 / 96 }[m[2].toLowerCase()])
      : null;
  }
  return /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
}
const cmp = (a, op, b) =>
  a == null || b == null
    ? null
    : op === '='
      ? a === b
      : op === '<'
        ? a < b
        : op === '<='
          ? a <= b
          : op === '>'
            ? a > b
            : a >= b;
function mediaFeature(source, env) {
  const colon = source.match(/^([\w-]+)\s*:\s*(.+)$/);
  if (colon) {
    let name = colon[1].toLowerCase(),
      op = '=';
    if (name.startsWith('min-')) {
      name = name.slice(4);
      op = '>=';
    } else if (name.startsWith('max-')) {
      name = name.slice(4);
      op = '<=';
    }
    const value = colon[2].trim().toLowerCase();
    const actual = numericFeature(name, env);
    if (actual !== null) return cmp(actual, op, numericValue(value, name, env));
    if (op !== '=') return null;
    if (name === 'orientation')
      return env.width == null || env.height == null
        ? null
        : (env.width > env.height ? 'landscape' : 'portrait') === value;
    if (own(env, name))
      return Array.isArray(env[name])
        ? env[name].includes(value)
        : String(env[name]).toLowerCase() === value;
    return null;
  }
  if (/^[\w-]+$/.test(source)) {
    const name = source.toLowerCase(),
      actual = numericFeature(name, env);
    if (actual !== null) return actual !== 0;
    if (own(env, name)) return ![false, 0, '', 'none', 'no-preference'].includes(env[name]);
    return null;
  }
  const tokens = source.split(/\s*(<=|>=|<|>|=)\s*/);
  if (tokens.length !== 3 && tokens.length !== 5) return null;
  const featureAt = tokens.findIndex((v, i) => i % 2 === 0 && /^[a-z][\w-]*$/i.test(v));
  if (featureAt < 0 || (tokens.length === 5 && featureAt !== 2)) return null;
  const feature = tokens[featureAt].toLowerCase();
  const values = tokens.map((v, i) =>
    i % 2 ? v : i === featureAt ? numericFeature(feature, env) : numericValue(v, feature, env),
  );
  if (
    tokens.length === 5 &&
    (tokens[1].includes('<') !== tokens[3].includes('<') || tokens[1] === '=' || tokens[3] === '=')
  )
    return null;
  return and([
    cmp(values[0], values[1], values[2]),
    ...(tokens.length === 5 ? [cmp(values[2], values[3], values[4])] : []),
  ]);
}

/** A null result means the provided environment cannot decide the query. */
export function evaluateCssCondition(source, environment = {}, kind = 'media', depth = 0) {
  if (typeof source !== 'string' || source.length > 8192 || depth > 32) return null;
  source = source.trim();
  if (!source) return kind === 'media';
  const env = environment || {};
  if (kind === 'supports' && typeof env.supports === 'function') {
    const result = env.supports(source);
    return typeof result === 'boolean' ? result : null;
  }
  if (kind === 'supports' && own(env.supports, source)) return env.supports[source] === true;
  if (kind === 'media') {
    const list = splitCssList(source);
    if (list.length > 1) return or(list.map((s) => evaluateCssCondition(s, env, kind, depth + 1)));
    const typed = source.match(/^(?:(not|only)\s+)?([a-z][\w-]*)(?:\s+and\s+(.+))?$/i);
    if (typed && !['not', 'only'].includes(typed[2].toLowerCase())) {
      const type = typed[2].toLowerCase();
      const match = type === 'all' ? true : own(env, 'type') ? env.type === type : null;
      const result = and([
        match,
        typed[3] ? evaluateCssCondition(typed[3], env, kind, depth + 1) : true,
      ]);
      return typed[1]?.toLowerCase() === 'not' ? not(result) : result;
    }
  }
  if (/^not\s+/i.test(source))
    return not(evaluateCssCondition(source.replace(/^not\s+/i, ''), env, kind, depth + 1));
  const a = topParts(source, 'and'),
    o = topParts(source, 'or');
  if (!a || !o || (a.length > 1 && o.length > 1)) return null;
  if (a.length > 1) return and(a.map((s) => evaluateCssCondition(s, env, kind, depth + 1)));
  if (o.length > 1) return or(o.map((s) => evaluateCssCondition(s, env, kind, depth + 1)));
  const inner = unwrap(source);
  if (inner == null) return null;
  if (inner.startsWith('(') || /^not\s+/i.test(inner))
    return evaluateCssCondition(inner, env, kind, depth + 1);
  if (kind === 'supports') return own(env.supports, inner) ? env.supports[inner] === true : null;
  return mediaFeature(inner, env);
}
