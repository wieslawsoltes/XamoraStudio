import {
  createDocument,
  element,
  textNode,
  uid,
  walk,
  validateDocument,
  find,
  parentOf,
  clone,
} from './model.js';
export const HTML_VOID = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
);
export const HTML_RAW = new Set([
  'script',
  'style',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
]);
export const HTML_TAGS =
  'div section article header footer main nav aside p h1 h2 h3 h4 h5 h6 span a button input textarea select option label form fieldset legend img picture source video audio canvas svg path circle rect ul ol li table thead tbody tr th td details summary dialog progress meter output pre code blockquote hr br style script link meta title template slot'.split(
    ' ',
  );
export const HTML_CSS =
  'display position left top right bottom width height min-width min-height max-width max-height box-sizing margin padding gap row-gap column-gap flex flex-direction flex-wrap justify-content align-items align-self order grid-template-columns grid-template-rows grid-column grid-row background background-color color font-family font-size font-weight line-height text-align border border-color border-width border-radius opacity transform rotate overflow box-shadow'.split(
    ' ',
  );
export const isHtml = (doc) => doc?.framework === 'HTML';
const escapeText = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;');
export function projectHtmlDocument(parsed, { name = 'index.html', source } = {}) {
  let count = 0;
  const convert = (native, depth = 0) => {
    if (depth > 150 || ++count > 15000) throw Error('HTML document exceeds the node/depth limit.');
    if (native.nodeType === 1) {
      const props = {};
      for (const a of native.attributes)
        Object.defineProperty(props, a.name, {
          value: a.value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      const n = element(native.localName || native.tagName.toLowerCase(), props);
      n.namespaceURI = native.namespaceURI;
      n.children = Array.from(
        native.localName === 'template' ? native.content.childNodes : native.childNodes,
      )
        .map((c) => convert(c, depth + 1))
        .filter(Boolean);
      return n;
    }
    if (native.nodeType === 3) return textNode(native.nodeValue || '');
    if (native.nodeType === 8) return { id: uid(), kind: 'comment', text: native.nodeValue || '' };
    return null;
  };
  const doc = createDocument(convert(parsed.documentElement), 'HTML', name);
  doc.metadata.html = {
    doctype: parsed.doctype
      ? `<!DOCTYPE ${parsed.doctype.name}${parsed.doctype.publicId ? ' PUBLIC "' + parsed.doctype.publicId + '"' : ''}${parsed.doctype.systemId ? (parsed.doctype.publicId ? ' "' : ' SYSTEM "') + parsed.doctype.systemId + '"' : ''}>`
      : '',
  };
  doc.preamble = [];
  doc.postamble = [];
  let after = false;
  for (const n of parsed.childNodes) {
    if (n === parsed.documentElement) {
      after = true;
      continue;
    }
    if (n.nodeType === 8) (after ? doc.postamble : doc.preamble).push(convert(n));
  }
  validateDocument(doc);
  if (source !== undefined) {
    doc.metadata.html.originalSource = source;
    doc.metadata.html.originalMarkup = canonicalHtml(doc);
  }
  return doc;
}
export function parseHtml(source, { name = 'index.html', Parser = globalThis.DOMParser } = {}) {
  if (typeof source !== 'string' || source.length > 2_000_000)
    throw Error('HTML must be text smaller than 2 MB.');
  if (!Parser) throw Error('HTML parsing requires the browser DOMParser.');
  return projectHtmlDocument(new Parser().parseFromString(source, 'text/html'), { name, source });
}
export function serializeHtmlNode(n, parent = '') {
  if (n.kind === 'comment') return '<!--' + n.text + '-->';
  if (n.kind !== 'element') return HTML_RAW.has(parent) ? n.text : escapeText(n.text || '');
  const tag = n.type,
    attrs = Object.entries(n.props)
      .map(([key, value]) => ' ' + key + '="' + escapeAttr(value) + '"')
      .join('');
  if (HTML_VOID.has(tag) && (!n.namespaceURI || n.namespaceURI === 'http://www.w3.org/1999/xhtml'))
    return '<' + tag + attrs + '>';
  const leading =
    ['pre', 'textarea', 'listing'].includes(tag) &&
    n.children[0]?.kind === 'text' &&
    n.children[0].text.startsWith('\n')
      ? '\n'
      : '';
  return (
    '<' +
    tag +
    attrs +
    '>' +
    leading +
    n.children.map((c) => serializeHtmlNode(c, tag)).join('') +
    '</' +
    tag +
    '>'
  );
}
export function canonicalHtml(doc) {
  return (
    (doc.metadata?.html?.doctype || '') +
    (doc.preamble || []).map((n) => serializeHtmlNode(n)).join('') +
    serializeHtmlNode(doc.root) +
    (doc.postamble || []).map((n) => serializeHtmlNode(n)).join('')
  );
}
export function serializeHtml(doc) {
  const current = canonicalHtml(doc),
    saved = doc.metadata?.html;
  return saved?.originalMarkup === current && typeof saved.originalSource === 'string'
    ? saved.originalSource
    : current;
}
export function htmlBody(doc) {
  return doc.root.children.find((n) => n.type === 'body') || doc.root;
}
export function htmlHead(doc) {
  return doc.root.children.find((n) => n.type === 'head') || doc.root;
}
export function htmlDiagnostics(doc) {
  const list = [],
    ids = new Set();
  walk(doc.root, (n) => {
    if (n.kind !== 'element') return;
    if (n.props.id) {
      if (ids.has(n.props.id))
        list.push({
          id: n.id,
          line: 1,
          severity: 'warning',
          message: 'Duplicate HTML id: ' + n.props.id,
        });
      ids.add(n.props.id);
    }
    if (n.type === 'img' && !Object.hasOwn(n.props, 'alt'))
      list.push({
        id: n.id,
        line: 1,
        severity: 'warning',
        message: 'Add alternative text for this image.',
      });
  });
  return list;
}
/** Split declarations without breaking quoted data URLs, functions, or comments. */
export function cssDeclarations(source) {
  const parts = [];
  let start = 0,
    quote = '',
    depth = 0,
    comment = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i],
      next = source[i + 1];
    if (comment) {
      if (c === '*' && next === '/') {
        comment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '*') {
      comment = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    if (c === ';' && !depth) {
      parts.push(source.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < source.length) parts.push(source.slice(start));
  return parts;
}
export function setHtmlStyle(node, key, value, documentRef = globalThis.document) {
  if (!/^--[\w-]+$|^[a-z][a-z-]*$/i.test(key)) throw Error('Enter a CSS property name.');
  const probe = documentRef.createElement('span');
  let next = '';
  if (value != null && value !== '') {
    const important = /\s*!important\s*$/i.test(value);
    probe.style.setProperty(
      key,
      String(value).replace(/\s*!important\s*$/i, ''),
      important ? 'important' : '',
    );
    if (!probe.style.getPropertyValue(key)) throw Error('Invalid CSS value for ' + key + '.');
    next = key + ': ' + String(value).trim() + ';';
  }
  const kept = cssDeclarations(node.props.style || '')
    .filter((part) => {
      const property = part.replace(/\/\*[^]*?\*\//g, '').match(/^\s*([\w-]+)\s*:/)?.[1];
      return key.startsWith('--')
        ? property !== key
        : property?.toLowerCase() !== key.toLowerCase();
    })
    .join('')
    .trim();
  const css = kept + (kept && !kept.endsWith(';') ? ';' : '') + (kept && next ? ' ' : '') + next;
  if (css) node.props.style = css;
  else delete node.props.style;
}
export function moveHtmlNode(doc, id, parentId, index) {
  const n = find(doc.root, id),
    p = find(doc.root, parentId),
    old = parentOf(doc.root, id);
  if (!n || !p || !old) throw Error('Choose an element and a container.');
  if (HTML_VOID.has(p.type) || ['script', 'style', 'title', 'textarea'].includes(p.type))
    throw Error('This element cannot contain child elements.');
  if (find(n, parentId)) throw Error('An element cannot contain itself.');
  old.children.splice(old.children.indexOf(n), 1);
  p.children.splice(index ?? p.children.length, 0, n);
}
export function completeHtml(source, caret) {
  const before = source.slice(0, caret),
    token = before.match(/[\w:-]*$/)?.[0] || '',
    start = caret - token.length;
  let values, detail;
  const styleOpen = before.toLowerCase().lastIndexOf('<style'),
    styleClose = before.toLowerCase().lastIndexOf('</style');
  if (styleOpen > styleClose || /style\s*=\s*["'][^"']*$/i.test(before)) {
    values = HTML_CSS;
    detail = 'CSS property';
  } else if (/<\/?[\w:-]*$/.test(before)) {
    values = [
      ...new Set([
        ...HTML_TAGS,
        ...Array.from(source.matchAll(/<([a-z][\w:-]*-[\w:-]+)/g), (m) => m[1]),
      ]),
    ];
    detail = 'HTML element';
  } else if (before.lastIndexOf('<') > before.lastIndexOf('>')) {
    values =
      'id class style title role aria-label aria-hidden data-name href target rel src alt width height type name value placeholder disabled checked selected required readonly multiple for action method tabindex contenteditable loading controls autoplay loop'.split(
        ' ',
      );
    detail = 'HTML attribute';
  } else return [];
  return values
    .filter((v) => v.startsWith(token))
    .map((v) => ({
      label: v,
      detail,
      start,
      end: caret,
      insertText:
        detail === 'CSS property' ? v + ': ' : detail === 'HTML attribute' ? v + '=""' : v,
      caretOffset: detail === 'HTML attribute' ? v.length + 2 : undefined,
    }));
}
export function newHtmlDocument(name = 'index.html') {
  return parseHtml(
    `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <title>New page</title>\n  <style>\n    * { box-sizing: border-box; }\n    body { margin: 0; padding: 40px; font: 16px/1.5 system-ui, sans-serif; color: #252332; background: #f4f3f8; }\n    main { max-width: 880px; margin: auto; padding: 32px; background: white; border-radius: 16px; }\n    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }\n    article { padding: 20px; background: #f2effb; border-radius: 10px; }\n    button { padding: 10px 18px; border: 0; border-radius: 6px; color: white; background: #7953e8; cursor: pointer; }\n    @media (max-width: 640px) { .cards { grid-template-columns: 1fr; } body { padding: 16px; } }\n  </style>\n</head>\n<body>\n  <main>\n    <h1>Make something useful</h1>\n    <p>Double-click text to edit it. Drag elements to rearrange the page.</p>\n    <section class="cards">\n      <article><h2>Design</h2><p>Edit real HTML and CSS.</p></article>\n      <article><h2>Build</h2><p>Use flex, grid, or absolute positioning.</p></article>\n      <article><h2>Preview</h2><p>Try your page at different widths.</p></article>\n    </section>\n    <p><button id="hello">Try preview</button></p>\n    <output id="result"></output>\n  </main>\n  <script>document.querySelector('#hello').onclick = () => { document.querySelector('#result').textContent = 'Your HTML is interactive.'; };</script>\n</body>\n</html>`,
    { name },
  );
}

/** Conservative markup formatting: preserve mixed inline content and raw CSS/JS bodies. */
export function formatHtml(source, options = {}) {
  const doc = parseHtml(source, options),
    blocks = new Set(
      'html head body main section article header footer nav aside div ul ol li table thead tbody tfoot tr form fieldset'.split(
        ' ',
      ),
    ),
    blockChildren = new Set([
      ...blocks,
      'title',
      'meta',
      'link',
      'style',
      'script',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'pre',
      'blockquote',
      'hr',
      'address',
      'figure',
      'figcaption',
      'dl',
      'dt',
      'dd',
    ]);
  const format = (n, depth) => {
    if (
      n.kind !== 'element' ||
      ['script', 'style', 'pre', 'textarea', 'listing', 'template'].includes(n.type)
    )
      return;
    n.children.forEach((c) => format(c, depth + 1));
    const children = n.children.filter((c) => !(c.kind === 'text' && !c.text.trim()));
    if (
      blocks.has(n.type) &&
      children.length &&
      children.every(
        (c) => c.kind === 'comment' || (c.kind === 'element' && blockChildren.has(c.type)),
      )
    ) {
      n.children = children.flatMap((c) => [textNode('\n' + '  '.repeat(depth + 1)), c]);
      n.children.push(textNode('\n' + '  '.repeat(depth)));
    }
  };
  format(doc.root, 0);
  return canonicalHtml(doc).replace(/^(<!DOCTYPE[^>]*>)(?=<html)/i, '$1\n') + '\n';
}
