/** Explicit, project-confined stylesheet reading for the Node CLI. No network access. */
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, sep, isAbsolute } from 'node:path';
import { walk } from '../core/model.js';
import { parseHtml } from '../core/html.js';
import { parseCssAnimationStylesheet } from '../core/html-animation.js';
import { parseStylesheetImport, stylesheetUrl } from '../core/compiler-css.js';
const origin = 'https://xamora.invalid/';
const within = (root, path) => {
  const part = relative(root, path);
  return part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part);
};

export async function loadLocalStylesheets(entries, root, Parser) {
  const canonicalRoot = await realpath(root),
    result = new Map();
  let characters = 0;
  const reference = (href, owner) => {
    if (typeof href !== 'string') throw Error('A stylesheet href is required.');
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(href) || href.startsWith('/') || href.includes('\\'))
      throw Error('CLI --load-css accepts only project-relative stylesheet paths: ' + href);
    let decoded;
    try {
      decoded = decodeURIComponent(href.split(/[?#]/)[0]);
    } catch {
      throw Error('Invalid stylesheet URL encoding: ' + href);
    }
    if (!decoded || decoded.includes('\\') || decoded.includes('\0') || decoded.startsWith('/'))
      throw Error('Invalid local stylesheet path: ' + href);
    const ownerPath = decodeURIComponent(new URL(owner).pathname).slice(1);
    const path = resolve(
      root,
      new URL(owner).pathname.endsWith('/') ? ownerPath : dirname(ownerPath),
      decoded,
    );
    if (!within(resolve(root), path)) throw Error('Stylesheet path escapes its project: ' + href);
    const url = stylesheetUrl(href, owner);
    return { path, url };
  };
  const load = async (href, owner, depth = 0) => {
    if (depth > 16) throw Error('CSS imports exceed 16 levels.');
    const { path, url } = reference(href, owner);
    if (result.has(url)) return;
    if (result.size >= 128) throw Error('CSS imports exceed 128 stylesheets.');
    let cursor = resolve(root);
    for (const part of relative(resolve(root), path).split(sep)) {
      cursor = resolve(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink())
        throw Error('Stylesheet paths must not contain symbolic links: ' + href);
    }
    if (!within(canonicalRoot, await realpath(path)))
      throw Error('Stylesheet path escapes its project: ' + href);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 8_000_000)
      throw Error('Stylesheet must be a bounded regular file: ' + href);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
    characters += text.length;
    if (characters > 2_000_000) throw Error('CSS imports exceed 2,000,000 characters.');
    result.set(url, text);
    await imports(text, url, depth + 1);
  };
  const imports = async (text, owner, depth) => {
    for (const rule of parseCssAnimationStylesheet(text).children) {
      if (rule.kind !== 'raw' || !/^@import\b/i.test(rule.raw)) continue;
      const parsed = parseStylesheetImport(rule.raw);
      if (!parsed) throw Error('Unsupported CSS import syntax in ' + owner);
      await load(parsed.href, owner, depth);
    }
  };
  for (const entry of entries) {
    if (entry.framework !== 'HTML') continue;
    const document = entry.document || parseHtml(entry.source, { Parser, name: entry.path });
    const tasks = [],
      base = stylesheetUrl(entry.path, origin);
    let documentBase = base,
      foundBase = false;
    walk(document.root, (node) => {
      if (!foundBase && node.type === 'base' && node.props.href) {
        const href = node.props.href;
        if (/^(?:[a-z][\w+.-]*:|\/)/i.test(href))
          throw Error('CLI --load-css requires a project-relative HTML base URL.');
        documentBase = reference(href, base).url;
        foundBase = true;
      }
    });
    walk(document.root, (node) => {
      if (
        node.type === 'link' &&
        String(node.props.rel || '')
          .toLowerCase()
          .split(/\s+/)
          .includes('stylesheet') &&
        !Object.hasOwn(node.props, 'disabled') &&
        !/\balternate\b/i.test(node.props.rel || '') &&
        (!node.props.type || /^text\/css$/i.test(node.props.type.trim()))
      )
        tasks.push(() => load(node.props.href, documentBase));
      if (
        node.type === 'style' &&
        (!node.props.type || /^text\/css$/i.test(node.props.type.trim()))
      )
        tasks.push(() =>
          imports(
            node.children
              .filter((child) => child.kind === 'text')
              .map((child) => child.text)
              .join(''),
            documentBase,
            0,
          ),
        );
    });
    for (const task of tasks) await task();
  }
  return result;
}
