/** Stylesheet graph, conditional rules and cascade layers. Loading is always host-controlled. */
import { walk } from './model.js';
import { parseCssAnimationStylesheet, splitCssList } from './html-animation.js';
import { compileCssSelector, matchesCssSelector } from './compiler-selectors.js';
import { evaluateCssCondition } from './compiler-environment.js';

const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const text = (n) =>
  (n.children || [])
    .filter((c) => c.kind === 'text' || c.kind === 'cdata')
    .map((c) => c.text)
    .join('');
const cssUnescape = (s) =>
  s.replace(/\\([\da-f]{1,6}\s?|[^\r\n\f])/gi, (_, v) =>
    /^[\da-f]/i.test(v) ? String.fromCodePoint(Math.min(0x10ffff, parseInt(v, 16)) || 0xfffd) : v,
  );
const commentFree = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
export function compilerStylesheetUrl(href, baseUrl = 'https://xamora.invalid/index.html') {
  const url = new URL(href, new URL(baseUrl, 'https://xamora.invalid/'));
  if (!['https:', 'http:', 'file:'].includes(url.protocol) || url.username || url.password)
    throw Error('Stylesheet URL must be HTTP(S), file, or a relative path without credentials.');
  url.hash = '';
  return url.href;
}
function balancedFunction(source, name) {
  if (!source.toLowerCase().startsWith(name + '(')) return null;
  let depth = 1,
    quote = '';
  for (let i = name.length + 1; i < source.length; i++) {
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
    if (c === ')' && --depth === 0)
      return { value: source.slice(name.length + 1, i).trim(), rest: source.slice(i + 1).trim() };
  }
  return null;
}
/** Parse the standard import header; caller enforces order and graph limits. */
export function parseCompilerCssImport(source) {
  source = source
    .trim()
    .replace(/^@import\s+/i, '')
    .replace(/;\s*$/, '')
    .trim();
  let href;
  const quoted = source.match(/^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/);
  if (quoted) {
    href = cssUnescape(quoted[0].slice(1, -1));
    source = source.slice(quoted[0].length).trim();
  } else {
    const fn = balancedFunction(source, 'url');
    if (!fn) return null;
    href = cssUnescape(fn.value.replace(/^(['"])([\s\S]*)\1$/, '$2'));
    if (!href || /[\r\n]/.test(href)) return null;
    source = fn.rest;
  }
  let layer = null,
    supports = null;
  if (/^layer\(/i.test(source)) {
    const fn = balancedFunction(source, 'layer');
    if (!fn || !/^[\w-]+(?:\.[\w-]+)*$/.test(fn.value)) return null;
    layer = fn.value;
    source = fn.rest;
  } else if (/^layer(?:\s|$)/i.test(source)) {
    layer = '';
    source = source.slice(5).trim();
  }
  if (/^supports\(/i.test(source)) {
    const fn = balancedFunction(source, 'supports');
    if (!fn) return null;
    supports = /^\w[\w-]*\s*:/.test(fn.value) ? '(' + fn.value + ')' : fn.value;
    source = fn.rest;
  }
  return { href, layer, supports, media: source };
}
/** Rewrite URL tokens, never string literals such as content:"url(...)". */
export function rebaseCompilerCssUrls(source, baseUrl) {
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
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) return out + source.slice(i);
      out += source.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    if (source.slice(i, i + 4).toLowerCase() === 'url(' && (!i || !/[\w-]/.test(source[i - 1]))) {
      const fn = balancedFunction(source.slice(i), 'url');
      if (fn) {
        const rawLength = source.slice(i).length - fn.rest.length;
        const href = cssUnescape(fn.value.replace(/^(['"])([\s\S]*)\1$/, '$2'));
        if (href && !/^(?:#|data:|blob:)/i.test(href)) {
          const url = new URL(href, baseUrl).href;
          out += 'url(' + JSON.stringify(url) + ')';
        } else out += source.slice(i, i + rawLength).trimEnd();
        // balancedFunction trims rest; preserve consumed whitespace explicitly.
        out += source.slice(i, i + rawLength).match(/\s*$/)[0];
        i += rawLength;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

/** Build only host-supplied CSS. No global fetch, file access or DOM execution. */
export function collectCompilerCss(ctx) {
  ctx.parents = new Map();
  ctx.previousElements = new Map();
  const sources = [];
  walk(ctx.input.root, (n, p) => {
    if (p) ctx.parents.set(n.id, p);
    let previous;
    for (const child of n.children || [])
      if (child.kind === 'element') {
        if (previous) ctx.previousElements.set(child.id, previous);
        previous = child;
      }
    if (
      n.type === 'style' ||
      (n.type === 'link' &&
        String(n.props.rel || '')
          .toLowerCase()
          .split(/\s+/)
          .includes('stylesheet'))
    )
      sources.push(n);
  });
  if (ctx.options.renderSnapshot instanceof Map) {
    ctx.cssLayers = { rank: 0 };
    ctx.cssKeyframes = [];
    ctx.cssEnvironmentReport = { mode: 'browser-snapshot', stylesheets: [], rules: 0, bytes: 0 };
    ctx.matchCssRule = () => false;
    return;
  }
  let base = compilerStylesheetUrl(ctx.options.baseUrl || ctx.options.sourceName || 'index.html'),
    baseFound = false;
  walk(ctx.input.root, (node) => {
    if (!baseFound && node.type === 'base' && node.props.href) {
      base = compilerStylesheetUrl(node.props.href, base);
      baseFound = true;
    }
  });
  const cache = new Map(),
    rootLayer = { children: new Map(), key: null },
    active = [],
    warned = new Set();
  let bytes = 0,
    rules = 0,
    sequence = 0,
    anonymous = 0;
  const report = (code, message, node, loss = true, severity = 'warning') => {
    const key = code + ':' + node.id + ':' + message;
    if (!warned.has(key)) {
      warned.add(key);
      ctx.report(severity, code, message, node, loss);
    }
  };
  const layerAt = (parent, name) => {
    let layer = parent;
    for (const part of name ? name.split('.') : ['#' + ++anonymous]) {
      if (!layer.children.has(part))
        layer.children.set(part, {
          children: new Map(),
          key: (layer.key ? layer.key + '.' : '') + part,
        });
      layer = layer.children.get(part);
    }
    return layer;
  };
  const condition = (kind, query, node) => ({ kind, query, node });
  const staticCondition = (item) => {
    if (item.kind === 'container') return true;
    const value = evaluateCssCondition(item.query, ctx.options.environment, item.kind);
    if (value === null)
      report(
        'CONDITIONAL_CSS',
        `Cannot evaluate @${item.kind} ${item.query} without its explicit environment.`,
        item.node,
      );
    return value === true;
  };
  const load = (href, owner, node) => {
    let url;
    try {
      url = compilerStylesheetUrl(href, owner);
    } catch (e) {
      report('EXTERNAL_CSS', e.message, node);
      return null;
    }
    if (active.includes(url)) {
      report('CSS_IMPORT_CYCLE', `Ignored cyclic stylesheet import ${url}.`, node, false, 'info');
      return null;
    }
    if (cache.has(url)) return { url, css: cache.get(url) };
    let css;
    const map = ctx.options.stylesheets;
    const path = new URL(url).pathname.replace(/^\//, '');
    if (map instanceof Map) css = map.get(url) ?? map.get(path) ?? map.get(href);
    else if (map)
      for (const key of [url, path, href])
        if (own(map, key)) {
          css = map[key];
          break;
        }
    if (css === undefined && ctx.options.resolveStylesheet)
      css = ctx.options.resolveStylesheet(url, { href, baseUrl: owner, nodeId: node.id });
    if (css && typeof css.then === 'function')
      throw Error(
        'resolveStylesheet must be synchronous; preload resources before compileDocument.',
      );
    if (typeof css !== 'string') {
      report('EXTERNAL_CSS', `No stylesheet source supplied for ${url}.`, node);
      return null;
    }
    if (cache.size >= (ctx.options.maxStylesheets ?? 128))
      throw RangeError('Stylesheet graph exceeded maxStylesheets.');
    cache.set(url, css);
    return { url, css };
  };
  ctx.cssKeyframes = [];
  const readSheet = (css, owner, node, layer = rootLayer, conditions = [], depth = 0) => {
    if (depth > (ctx.options.maxStylesheetDepth ?? 32))
      throw RangeError('Stylesheet imports exceeded maxStylesheetDepth.');
    bytes += new TextEncoder().encode(css).length;
    if (bytes > (ctx.options.maxStylesheetBytes ?? 2_000_000))
      throw RangeError('Stylesheet graph exceeded maxStylesheetBytes.');
    const ast = parseCssAnimationStylesheet(css);
    for (const d of ast.diagnostics)
      report('CSS_SYNTAX', `${owner}: ${d.message}`, node, true, d.severity);
    const visit = (list, currentLayer, inheritedConditions, allowImports) => {
      let importsAllowed = allowImports;
      for (const rule of list) {
        if (++rules > (ctx.options.maxCssRules ?? 20000))
          throw RangeError('CSS rule count exceeded maxCssRules.');
        const header = commentFree(rule.header || rule.raw || '').trim();
        if (rule.kind === 'raw') {
          if (/^@charset\s+/i.test(header)) continue;
          const order = header.match(/^@layer\s+([^;]+);$/i);
          if (order) {
            for (const name of splitCssList(order[1])) {
              if (!/^[\w-]+(?:\.[\w-]+)*$/.test(name))
                report('CSS_LAYER', `Unsupported layer name ${name}.`, node);
              else layerAt(currentLayer, name);
            }
            continue;
          }
          if (/^@import\s+/i.test(header)) {
            if (!importsAllowed) {
              report(
                'CSS_IMPORT_ORDER',
                'Ignored @import after style rules or inside a grouping rule.',
                node,
                false,
                'info',
              );
              continue;
            }
            const imported = parseCompilerCssImport(rule.raw);
            if (!imported) {
              report('CSS_IMPORT', `Unsupported import header ${header}.`, node);
              continue;
            }
            const importLayer =
              imported.layer === null ? currentLayer : layerAt(currentLayer, imported.layer);
            const extra = [
              ...inheritedConditions,
              ...(imported.supports ? [condition('supports', imported.supports, node)] : []),
              ...(imported.media ? [condition('media', imported.media, node)] : []),
            ];
            if (!extra.every(staticCondition)) continue;
            const loaded = load(imported.href, owner, node);
            if (loaded) {
              active.push(loaded.url);
              readSheet(loaded.css, loaded.url, node, importLayer, extra, depth + 1);
              active.pop();
            }
          } else if (header) report('CSS_AT_RULE', `Unsupported CSS statement ${header}.`, node);
          continue;
        }
        importsAllowed = false;
        const group = header.match(/^@(media|supports|container|layer)\b\s*([\s\S]*)$/i);
        if (group) {
          const kind = group[1].toLowerCase();
          if (kind === 'layer') {
            if (group[2] && !/^[\w-]+(?:\.[\w-]+)*$/.test(group[2])) {
              report('CSS_LAYER', `Unsupported layer name ${group[2]}.`, node);
              continue;
            }
            visit(rule.children || [], layerAt(currentLayer, group[2]), inheritedConditions, false);
          } else {
            const extra = [...inheritedConditions, condition(kind, group[2], node)];
            if (extra.every(staticCondition))
              visit(rule.children || [], currentLayer, extra, false);
          }
          continue;
        }
        if (rule.kind === 'keyframes') {
          if (inheritedConditions.some((c) => c.kind === 'container'))
            report(
              'CONTAINER_KEYFRAMES',
              'Container-conditioned keyframes need a runtime animation adapter.',
              node,
            );
          else ctx.cssKeyframes.push({ rule, node });
          continue;
        }
        if (header.startsWith('@') || rule.children) {
          report('CONDITIONAL_CSS', `Unsupported CSS group ${header}.`, node);
          continue;
        }
        const plans = splitCssList(rule.header).map((s) => compileCssSelector(s));
        if (!plans.length || plans.some((p) => !p)) {
          report(
            'DYNAMIC_SELECTOR',
            `Selector list ${rule.header.trim()} requires a browser selector/state adapter.`,
            node,
          );
          continue;
        }
        for (const plan of plans) {
          if (
            plan.states.length &&
            !ctx.options.pseudoStates &&
            !ctx.options.environment &&
            !ctx.options.targetId
          )
            report(
              'DYNAMIC_SELECTOR',
              `Selector ${rule.header} depends on interaction state; provide pseudoStates for a snapshot or use browser capture.`,
              node,
            );
          const values = (rule.declarations || [])
            .filter((d) => d.property)
            .map((d) => [
              d.property.startsWith('--') ? d.property : d.property.toLowerCase(),
              owner === base ? d.value : rebaseCompilerCssUrls(d.value, owner),
            ]);
          ctx.cssRules.push({
            plan,
            values,
            layer: currentLayer,
            conditions: inheritedConditions,
            order: sequence++,
          });
        }
      }
    };
    visit(ast.children, layer, conditions, true);
  };
  for (const node of sources) {
    if (own(node.props, 'disabled') || /\balternate\b/i.test(node.props.rel || '')) continue;
    if (node.props.type && node.props.type.toLowerCase() !== 'text/css') continue;
    const conditions = node.props.media ? [condition('media', node.props.media, node)] : [];
    if (!conditions.every(staticCondition)) continue;
    if (node.type === 'style') readSheet(text(node), base, node, rootLayer, conditions);
    else {
      const loaded = load(node.props.href || '', base, node);
      if (loaded) {
        active.push(loaded.url);
        readSheet(loaded.css, loaded.url, node, rootLayer, conditions);
        active.pop();
      }
    }
  }
  let rank = 0;
  const assignRank = (layer) => {
    for (const child of layer.children.values()) assignRank(child);
    layer.rank = rank++;
  };
  assignRank(rootLayer);
  ctx.cssLayers = rootLayer;
  ctx.cssEnvironmentReport = {
    baseUrl: base,
    stylesheets: [...cache.keys()],
    rules: ctx.cssRules.length,
    bytes,
  };
  ctx.matchCssRule = (node, rule) => {
    for (const c of rule.conditions)
      if (c.kind === 'container') {
        const match = c.query.match(/^(?:([\w-]+)\s+)?([\s\S]+)$/);
        const env = ctx.options.containerEnvironment?.(node, match[1] || '');
        const value = env ? evaluateCssCondition(match[2], env) : null;
        if (value === null)
          report(
            'CONDITIONAL_CSS',
            `Cannot evaluate @container ${c.query} for ${node.props.id || node.type} without a container environment.`,
            c.node,
          );
        if (value !== true) return false;
      }
    return matchesCssSelector(node, rule.plan, ctx);
  };
}
