/** Explicit asynchronous resource preparation. No ambient fetch or filesystem access. */
import { parseHtml } from './html.js';
import { walk } from './model.js';
import { parseCssAnimationStylesheet } from './html-animation.js';
import { compilerStylesheetUrl, parseCompilerCssImport } from './compiler-css.js';
import { evaluateCssCondition } from './compiler-environment.js';
import { compileDocument } from './semantic-compiler.js';
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export async function preloadCompilerStylesheets(input, options = {}) {
  if (typeof options.loadStylesheet !== 'function')
    throw TypeError('An explicit loadStylesheet callback is required.');
  const doc =
    typeof input === 'string'
      ? parseHtml(input, { Parser: options.Parser, name: options.sourceName || 'index.html' })
      : input;
  if (doc?.framework !== 'HTML')
    throw TypeError('Stylesheet preparation requires an HTML document.');
  const settings = {
    maxStylesheets: 128,
    maxStylesheetDepth: 32,
    maxStylesheetBytes: 2_000_000,
    stylesheetTimeout: 15000,
    ...options,
  };
  for (const [key, max] of Object.entries({
    maxStylesheets: 4096,
    maxStylesheetDepth: 128,
    maxStylesheetBytes: 50_000_000,
    stylesheetTimeout: 120000,
  }))
    if (!Number.isSafeInteger(settings[key]) || settings[key] < 1 || settings[key] > max)
      throw RangeError(`${key} must be a positive integer no greater than ${max}.`);
  const registry = new Map(
    options.stylesheets instanceof Map
      ? options.stylesheets
      : Object.entries(options.stylesheets || {}),
  );
  const complete = new Set(),
    active = new Set(),
    sources = [];
  let bytes = 0,
    base = compilerStylesheetUrl(options.baseUrl || options.sourceName || 'index.html');
  const checkAbort = () => {
    if (options.signal?.aborted)
      throw options.signal.reason || new Error('Stylesheet loading aborted.');
  };
  walk(doc.root, (node) => {
    if (node.type === 'base' && node.props.href && !sources.base) {
      base = compilerStylesheetUrl(node.props.href, base);
      sources.base = true;
    }
    if (
      node.type === 'style' ||
      (node.type === 'link' &&
        String(node.props.rel || '')
          .toLowerCase()
          .split(/\s+/)
          .includes('stylesheet'))
    )
      sources.push(node);
  });
  const applies = (query, kind = 'media') =>
    !query || evaluateCssCondition(query, options.environment, kind) === true;
  const load = async (url, node) => {
    checkAbort();
    const supplied = registry.get(url) ?? registry.get(new URL(url).pathname.replace(/^\//, ''));
    if (typeof supplied === 'string') return supplied;
    const controller = new AbortController();
    let timer, onAbort;
    const cancelled = new Promise((_, reject) => {
      onAbort = () => {
        controller.abort(options.signal?.reason);
        reject(options.signal?.reason || new Error('Stylesheet loading aborted.'));
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        const error = new Error(`Stylesheet load timed out: ${url}`);
        controller.abort(error);
        reject(error);
      }, settings.stylesheetTimeout);
    });
    try {
      return await Promise.race([
        Promise.resolve().then(() =>
          options.loadStylesheet(url, { signal: controller.signal, nodeId: node.id }),
        ),
        cancelled,
      ]);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  };
  const external = async (href, owner, node, depth) => {
    checkAbort();
    const url = compilerStylesheetUrl(href, owner);
    if (active.has(url) || complete.has(url)) return;
    if (depth > settings.maxStylesheetDepth)
      throw RangeError('Stylesheet imports exceeded maxStylesheetDepth.');
    if (complete.size + active.size >= settings.maxStylesheets)
      throw RangeError('Stylesheet graph exceeded maxStylesheets.');
    active.add(url);
    try {
      const css = registry.get(url) ?? registry.get(href) ?? (await load(url, node));
      if (typeof css !== 'string') {
        if (options.allowMissingStylesheets && css == null) {
          complete.add(url);
          return;
        }
        throw TypeError(`No text stylesheet supplied for ${url}.`);
      }
      registry.set(url, css);
      await inspect(css, url, node, depth);
      complete.add(url);
    } finally {
      active.delete(url);
    }
  };
  const inspect = async (css, owner, node, depth = 0) => {
    checkAbort();
    bytes += new TextEncoder().encode(css).length;
    if (bytes > settings.maxStylesheetBytes)
      throw RangeError('Stylesheet graph exceeded maxStylesheetBytes.');
    let allowed = true;
    for (const rule of parseCssAnimationStylesheet(css).children) {
      if (rule.kind !== 'raw') {
        allowed = false;
        continue;
      }
      if (!/^\s*@import\s+/i.test(rule.raw) || !allowed) continue;
      const imported = parseCompilerCssImport(rule.raw);
      if (!imported) continue;
      if (!applies(imported.media) || !applies(imported.supports, 'supports')) continue;
      await external(imported.href, owner, node, depth + 1);
    }
  };
  for (const node of sources) {
    checkAbort();
    if (
      own(node.props, 'disabled') ||
      /\balternate\b/i.test(node.props.rel || '') ||
      (node.props.type && node.props.type.toLowerCase() !== 'text/css') ||
      !applies(node.props.media)
    )
      continue;
    if (node.type === 'style')
      await inspect(
        node.children
          .filter((c) => ['text', 'cdata'].includes(c.kind))
          .map((c) => c.text)
          .join(''),
        base,
        node,
      );
    else await external(node.props.href || '', base, node, 0);
  }
  checkAbort();
  return registry;
}

/** Explicitly prepare resources, then invoke the same deterministic synchronous compiler. */
export async function compileDocumentAsync(input, options = {}) {
  const { loadStylesheet, signal, stylesheetTimeout, ...compilerOptions } = options;
  const html = options.from === 'html' || (typeof input === 'object' && input.framework === 'HTML');
  if (!html || !loadStylesheet) return compileDocument(input, compilerOptions);
  const stylesheets = await preloadCompilerStylesheets(input, options);
  return compileDocument(input, { ...compilerOptions, stylesheets });
}
