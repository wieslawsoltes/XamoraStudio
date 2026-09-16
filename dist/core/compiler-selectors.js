/** Bounded, DOM-independent Selectors 4 matching over the shared document tree. */
import { splitCssList } from './html-animation.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const ascii = (value) => String(value).replace(/[A-Z]/g, (c) => c.toLowerCase());
const structural = new Set([
  'root',
  'scope',
  'empty',
  'first-child',
  'last-child',
  'only-child',
  'first-of-type',
  'last-of-type',
  'only-of-type',
]);
const forms = new Set([
  'enabled',
  'disabled',
  'checked',
  'default',
  'required',
  'optional',
  'read-only',
  'read-write',
  'placeholder-shown',
  'any-link',
  'link',
]);
const interactive = new Set([
  'hover',
  'active',
  'focus',
  'focus-visible',
  'focus-within',
  'target',
  'indeterminate',
  'valid',
  'invalid',
  'in-range',
  'out-of-range',
  'user-valid',
  'user-invalid',
  'autofill',
  'open',
  'fullscreen',
  'modal',
  'popover-open',
]);
const nthNames = new Set(['nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type']);

function identifier(source, start) {
  let at = start,
    value = '';
  while (at < source.length) {
    const c = source[at];
    if (/[\w-]/.test(c) || c.charCodeAt(0) >= 128) {
      value += c;
      at++;
    } else if (c === '\\' && at + 1 < source.length && !/[\r\n\f]/.test(source[at + 1])) {
      const hex = source.slice(at + 1).match(/^[\da-f]{1,6}/i)?.[0];
      if (hex) {
        const code = parseInt(hex, 16);
        value += String.fromCodePoint(
          !code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? 0xfffd : code,
        );
        at += hex.length + 1;
        if (/\s/.test(source[at] || '')) at++;
      } else {
        value += source[at + 1];
        at += 2;
      }
    } else break;
  }
  return value ? { value, end: at } : null;
}
function close(source, start, open, end) {
  let depth = 1,
    quote = '';
  for (let at = start; at < source.length; at++) {
    const c = source[at];
    if (c === '\\') {
      at++;
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
    if (c === open) depth++;
    if (c === end && --depth === 0) return at;
  }
  return -1;
}
function clean(source) {
  let out = '',
    quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      out += source.slice(i, i + 2);
      i++;
      continue;
    }
    if (quote) {
      out += c;
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) return '';
      i = end + 1;
    } else out += c;
  }
  return out;
}
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const maxSpecificity = (plans) =>
  plans.reduce((a, p) => (compare(a, p.specificity) < 0 ? p.specificity : a), [0, 0, 0]);
const decode = (s) =>
  s.replace(/\\([\da-f]{1,6}\s?|[^\r\n\f])/gi, (_, v) => {
    if (!/^[\da-f]/i.test(v)) return v;
    const n = parseInt(v.trim(), 16);
    return String.fromCodePoint(!n || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? 0xfffd : n);
  });
function nthArgument(source, compile) {
  const match = source.match(/^([\s\S]*?)(?:\s+of\s+([\s\S]+))?$/i);
  const raw = match[1].trim().toLowerCase();
  let a = 0,
    b;
  if (raw === 'odd') {
    a = 2;
    b = 1;
  } else if (raw === 'even') {
    a = 2;
    b = 0;
  } else if (/^[+-]?\d+$/.test(raw)) b = Number(raw);
  else {
    const n = raw.match(/^([+-]?(?:\d+)?)n(?:\s*([+-])\s*(\d+))?$/);
    if (!n) return null;
    a = n[1] === '' || n[1] === '+' ? 1 : n[1] === '-' ? -1 : Number(n[1]);
    b = n[2] ? Number(n[2] + n[3]) : 0;
  }
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return null;
  const of = match[2] ? splitCssList(match[2]).map(compile) : null;
  if (of && (!of.length || of.some((p) => !p))) return null;
  return { a, b, of };
}

/** Invalid selectors return null. Forgiving :is/:where discard invalid arms. */
export function compileCssSelector(source, depth = 0, inHas = false) {
  if (typeof source !== 'string' || depth > 16 || source.length > 4096) return null;
  source = clean(source).trim();
  if (!source) return null;
  const parts = [],
    combinators = [],
    specificity = [0, 0, 0],
    states = new Set();
  const compile = (s) => compileCssSelector(s, depth + 1, inHas);
  let at = 0;
  while (at < source.length) {
    const tests = [];
    if (source[at] === '*') {
      at++;
      tests.push(['universal']);
    } else if (!'.#[:'.includes(source[at])) {
      const id = identifier(source, at);
      if (!id) return null;
      tests.push(['tag', ascii(id.value)]);
      specificity[2]++;
      at = id.end;
    }
    while (at < source.length && !/[\s>+~]/.test(source[at])) {
      const token = source[at++];
      if (token === '.' || token === '#') {
        const id = identifier(source, at);
        if (!id) return null;
        tests.push([token, id.value]);
        specificity[token === '#' ? 0 : 1]++;
        at = id.end;
      } else if (token === '[') {
        const end = close(source, at, '[', ']');
        if (end < 0) return null;
        const match = source
          .slice(at, end)
          .trim()
          .match(
            /^([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([\w-]+))\s*([is])?)?$/i,
          );
        if (!match) return null;
        tests.push([
          'attr',
          ascii(match[1]),
          match[2],
          decode(match[3] ?? match[4] ?? match[5] ?? ''),
          ascii(match[6] || ''),
        ]);
        specificity[1]++;
        at = end + 1;
      } else if (token === ':') {
        const id = identifier(source, at);
        if (!id) return null;
        const name = ascii(id.value);
        at = id.end;
        let arg = null;
        if (source[at] === '(') {
          const end = close(source, at + 1, '(', ')');
          if (end < 0) return null;
          arg = source.slice(at + 1, end).trim();
          at = end + 1;
        }
        let extra = [0, 1, 0];
        if (['is', 'where', 'not', 'has'].includes(name)) {
          if (arg == null || (name === 'has' && inHas)) return null;
          let plans = splitCssList(arg).map((s) =>
            name === 'has' ? compileCssSelector(':scope ' + s, depth + 1, true) : compile(s),
          );
          if (name === 'is' || name === 'where') plans = plans.filter(Boolean);
          else if (!plans.length || plans.some((p) => !p)) return null;
          extra = name === 'where' ? [0, 0, 0] : maxSpecificity(plans);
          // :scope is a matching anchor, not authored specificity in relative :has().
          if (name === 'has') extra = [extra[0], extra[1] - 1, extra[2]];
          tests.push(['list', name, plans]);
          for (const p of plans) for (const state of p.states) states.add(state);
        } else if (nthNames.has(name)) {
          if (arg == null) return null;
          const nth = nthArgument(arg, compile);
          if (!nth || (name.includes('of-type') && nth.of)) return null;
          const max = maxSpecificity(nth.of || []);
          extra = [max[0], max[1] + 1, max[2]];
          for (const p of nth.of || []) for (const state of p.states) states.add(state);
          tests.push(['nth', name, nth]);
        } else if (name === 'lang' || name === 'dir') {
          if (arg == null || !arg || (name === 'dir' && !/^(ltr|rtl)$/i.test(arg))) return null;
          const values = splitCssList(arg).map((s) =>
            ascii(decode(s.replace(/^(['"])(.*)\1$/, '$2'))),
          );
          if (values.some((s) => !/^[\w*-]+$/.test(s))) return null;
          tests.push(['language', name, values]);
        } else if (
          arg == null &&
          (structural.has(name) || forms.has(name) || interactive.has(name))
        ) {
          tests.push(['pseudo', name]);
          if (interactive.has(name)) states.add(name);
        } else return null;
        for (let i = 0; i < 3; i++) specificity[i] += extra[i];
      } else return null;
    }
    if (!tests.length) return null;
    parts.push(tests);
    if (parts.length > 128) return null;
    const before = at;
    while (/\s/.test(source[at] || '')) at++;
    if (at === source.length) break;
    let combinator = ' ';
    if (/[>+~]/.test(source[at])) {
      combinator = source[at++];
      while (/\s/.test(source[at] || '')) at++;
    } else if (before === at) return null;
    if (at === source.length) return null;
    combinators.push(combinator);
  }
  return { parts, combinators, specificity, states: [...states] };
}
const children = (node) => (node?.children || []).filter((n) => n.kind === 'element');
const parentOf = (node, ctx) => ctx.parents.get(node.id);
const siblings = (node, ctx) => children(parentOf(node, ctx) || { children: [node] });
const descendants = function* (node) {
  for (const child of children(node)) {
    yield child;
    yield* descendants(child);
  }
};
function state(node, name, ctx) {
  const states = ctx.options?.pseudoStates;
  const entry =
    states instanceof Map
      ? (states.get(node.id) ?? states.get(node.props.id))
      : states &&
        (own(states, node.id)
          ? states[node.id]
          : own(states, node.props.id)
            ? states[node.props.id]
            : undefined);
  return Array.isArray(entry)
    ? entry.includes(name)
    : !!entry && own(entry, name) && entry[name] === true;
}
function disabled(node, ctx) {
  if (
    !['button', 'input', 'select', 'textarea', 'option', 'optgroup', 'fieldset'].includes(node.type)
  )
    return false;
  if (own(node.props, 'disabled')) return true;
  if (node.type === 'option') {
    const parent = parentOf(node, ctx);
    return parent?.type === 'optgroup' && own(parent.props, 'disabled');
  }
  if (node.type === 'optgroup') return false;
  for (let p = parentOf(node, ctx); p; p = parentOf(p, ctx)) {
    if (p.type !== 'fieldset' || !own(p.props, 'disabled')) continue;
    const legend = children(p).find((c) => c.type === 'legend');
    let inside = false;
    for (let n = node; n && n !== p; n = parentOf(n, ctx)) if (n === legend) inside = true;
    if (!inside) return true;
  }
  return false;
}
function editable(node, ctx) {
  if (
    node.type === 'textarea' ||
    (node.type === 'input' &&
      ![
        'hidden',
        'checkbox',
        'radio',
        'range',
        'color',
        'button',
        'submit',
        'reset',
        'file',
        'image',
      ].includes(ascii(node.props.type || 'text')))
  )
    return !own(node.props, 'readonly') && !disabled(node, ctx);
  for (let p = node; p; p = parentOf(p, ctx))
    if (
      own(p.props, 'contenteditable') &&
      ['', 'true', 'false', 'plaintext-only'].includes(ascii(p.props.contenteditable))
    )
      return ascii(p.props.contenteditable) !== 'false';
  return false;
}
function pseudo(node, name, ctx, scope) {
  if (name === 'root') return !ctx.parents.has(node.id);
  if (name === 'scope') return node.id === (scope || ctx.input?.root)?.id;
  if (name === 'empty')
    return !(node.children || []).some(
      (c) => c.kind === 'element' || (['text', 'cdata'].includes(c.kind) && c.text.length),
    );
  if (name.includes('child') || name.includes('of-type')) {
    let list = siblings(node, ctx);
    if (name.includes('of-type')) list = list.filter((n) => n.type === node.type);
    return name.startsWith('first')
      ? list[0] === node
      : name.startsWith('last')
        ? list.at(-1) === node
        : list.length === 1;
  }
  if (name === 'disabled' || name === 'enabled') {
    const eligible = [
      'button',
      'input',
      'select',
      'textarea',
      'option',
      'optgroup',
      'fieldset',
    ].includes(node.type);
    return eligible && disabled(node, ctx) === (name === 'disabled');
  }
  if (name === 'required' || name === 'optional') {
    const eligible =
      ['select', 'textarea'].includes(node.type) ||
      (node.type === 'input' &&
        !['hidden', 'range', 'color', 'button', 'submit', 'reset', 'image'].includes(
          ascii(node.props.type || 'text'),
        ));
    const required = eligible && own(node.props, 'required');
    return (
      ['button', 'input', 'select', 'textarea'].includes(node.type) &&
      (name === 'required' ? required : !required)
    );
  }
  if (name === 'read-only' || name === 'read-write')
    return editable(node, ctx) === (name === 'read-write');
  if (name === 'link' || name === 'any-link')
    return ['a', 'area'].includes(node.type) && own(node.props, 'href');
  if (name === 'checked' || name === 'default') {
    if (
      name === 'default' &&
      ((node.type === 'button' && (!node.props.type || ascii(node.props.type) === 'submit')) ||
        (node.type === 'input' && ['submit', 'image'].includes(ascii(node.props.type || ''))))
    ) {
      let form = parentOf(node, ctx);
      while (form && form.type !== 'form') form = parentOf(form, ctx);
      return (
        !!form &&
        [...descendants(form)].find(
          (n) =>
            (n.type === 'button' && (!n.props.type || ascii(n.props.type) === 'submit')) ||
            (n.type === 'input' && ['submit', 'image'].includes(ascii(n.props.type || ''))),
        ) === node
      );
    }
    if (node.type === 'input')
      return (
        ['checkbox', 'radio'].includes(ascii(node.props.type || '')) && own(node.props, 'checked')
      );
    if (node.type === 'option') {
      if (name === 'default') return own(node.props, 'selected');
      let p = parentOf(node, ctx);
      while (p && p.type !== 'select') p = parentOf(p, ctx);
      if (!p || own(p.props, 'multiple')) return own(node.props, 'selected');
      const list = [...descendants(p)].filter((c) => c.type === 'option');
      const selected =
        list.findLast((c) => own(c.props, 'selected')) ||
        (Number(p.props.size || 1) <= 1 ? list.find((c) => !disabled(c, ctx)) : undefined);
      return selected === node;
    }
    return false;
  }
  if (name === 'placeholder-shown')
    return (
      (node.type === 'textarea' ||
        (node.type === 'input' &&
          ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(
            ascii(node.props.type || 'text'),
          ))) &&
      own(node.props, 'placeholder') &&
      !(node.type === 'input'
        ? node.props.value
        : (node.children || []).map((c) => c.text || '').join(''))
    );
  if (name === 'target') return !!node.props.id && node.props.id === ctx.options?.targetId;
  if (name === 'open' && ['details', 'dialog'].includes(node.type)) return own(node.props, 'open');
  if (name === 'focus-within' || name === 'hover')
    return (
      (name === 'focus-within' ? pseudo(node, 'focus', ctx, scope) : state(node, 'hover', ctx)) ||
      [...descendants(node)].some((c) =>
        name === 'focus-within' ? pseudo(c, 'focus', ctx, scope) : state(c, 'hover', ctx),
      )
    );
  if (name === 'focus') return state(node, 'focus', ctx) || state(node, 'focus-visible', ctx);
  return state(node, name, ctx);
}

/** ctx supplies parents, previousElements, input and optional pseudoStates/targetId. */
export function matchesCssSelector(node, plan, ctx, scope) {
  if (!plan) return false;
  const limit = ctx.options?.maxSelectorSteps ?? 2_000_000;
  const tick = () => {
    ctx.selectorSteps = (ctx.selectorSteps || 0) + 1;
    if (ctx.selectorSteps > limit)
      throw RangeError('CSS selector matching exceeded maxSelectorSteps.');
  };
  const part = (n, tests) => {
    if (n?.kind !== 'element') return false;
    for (const [kind, name, arg, expected, flag] of tests) {
      tick();
      if (kind === 'tag' && ascii(n.type) !== name) return false;
      if (kind === '#' && n.props.id !== name) return false;
      if (
        kind === '.' &&
        !String(n.props.class || '')
          .split(/\s+/)
          .includes(name)
      )
        return false;
      if (kind === 'attr') {
        if (!own(n.props, name)) return false;
        if (!arg) continue;
        const actual = flag === 'i' ? ascii(n.props[name]) : String(n.props[name]);
        const value = flag === 'i' ? ascii(expected) : expected;
        if (
          (arg === '=' && actual !== value) ||
          (arg === '~=' && (!value || /\s/.test(value) || !actual.split(/\s+/).includes(value))) ||
          (arg === '|=' && actual !== value && !actual.startsWith(value + '-')) ||
          (arg === '^=' && (!value || !actual.startsWith(value))) ||
          (arg === '$=' && (!value || !actual.endsWith(value))) ||
          (arg === '*=' && (!value || !actual.includes(value)))
        )
          return false;
      }
      if (kind === 'pseudo' && !pseudo(n, name, ctx, scope)) return false;
      if (kind === 'language') {
        let value = '';
        for (let p = n; p; p = parentOf(p, ctx))
          if (own(p.props, name === 'lang' ? 'lang' : 'dir')) {
            value = ascii(p.props[name === 'lang' ? 'lang' : 'dir']);
            break;
          }
        if (name === 'dir' && !value) value = 'ltr';
        if (
          !arg.some((v) =>
            name === 'dir'
              ? value === v
              : v === '*'
                ? !!value
                : value === v || value.startsWith(v + '-'),
          )
        )
          return false;
      }
      if (kind === 'nth') {
        let list = siblings(n, ctx);
        if (name.includes('of-type')) list = list.filter((c) => c.type === n.type);
        if (arg.of)
          list = list.filter((c) => arg.of.some((p) => matchesCssSelector(c, p, ctx, scope)));
        let index = list.indexOf(n);
        if (index < 0) return false;
        index = name.includes('last') ? list.length - index : index + 1;
        if (
          arg.a === 0
            ? index !== arg.b
            : (index - arg.b) / arg.a < 0 || !Number.isInteger((index - arg.b) / arg.a)
        )
          return false;
      }
      if (kind === 'list') {
        let found;
        if (name === 'has') {
          found = arg.some((p) => {
            const relation = p.combinators[0];
            const roots =
              relation === '+' || relation === '~'
                ? siblings(n, ctx).slice(siblings(n, ctx).indexOf(n) + 1)
                : children(n);
            for (const root of roots) {
              if (matchesCssSelector(root, p, ctx, n)) return true;
              for (const d of descendants(root)) if (matchesCssSelector(d, p, ctx, n)) return true;
            }
            return false;
          });
        } else found = arg.some((p) => matchesCssSelector(n, p, ctx, scope));
        if (name === 'not' ? found : !found) return false;
      }
    }
    return true;
  };
  const cache = new Map();
  const match = (current, index) => {
    if (!current) return false;
    tick();
    const key = current.id + ':' + index;
    if (cache.has(key)) return cache.get(key);
    let result = false;
    if (part(current, plan.parts[index])) {
      if (!index) result = true;
      else {
        const c = plan.combinators[index - 1],
          prev = (n) =>
            c === '+' || c === '~' ? ctx.previousElements.get(n.id) : ctx.parents.get(n.id);
        for (let n = prev(current); n; n = prev(n)) {
          if (match(n, index - 1)) {
            result = true;
            break;
          }
          if (c === '>' || c === '+') break;
        }
      }
    }
    cache.set(key, result);
    return result;
  };
  return match(node, plan.parts.length - 1);
}
