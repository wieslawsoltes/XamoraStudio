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
export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML';
/** Missing namespace metadata remains HTML for existing programmatic documents. */
export const isHtmlElement = (node, tag) =>
  node?.kind === 'element' &&
  (!node.namespaceURI || node.namespaceURI === HTML_NAMESPACE) &&
  (tag === undefined || node.type === tag);
export const isHtmlVoid = (node) => isHtmlElement(node) && HTML_VOID.has(node.type);
export const canContainHtmlChildren = (node) =>
  node?.kind === 'element' &&
  !isHtmlVoid(node) &&
  !(isHtmlElement(node) && (HTML_RAW.has(node.type) || ['title', 'textarea'].includes(node.type)));

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
  'div section article header footer main nav aside p h1 h2 h3 h4 h5 h6 span a button input textarea select option label form fieldset legend img picture source video audio canvas svg g path circle rect ellipse line polyline polygon text foreignObject math mi mn mo mrow mfrac msup msqrt ul ol li table thead tbody tr th td details summary dialog progress meter output pre code blockquote hr br style script link meta title template slot'.split(
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
function htmlProjector() {
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
        native.namespaceURI === HTML_NAMESPACE && native.localName === 'template'
          ? native.content.childNodes
          : native.childNodes,
      )
        .map((c) => convert(c, depth + 1))
        .filter(Boolean);
      return n;
    }
    if (native.nodeType === 3 || native.nodeType === 4) return textNode(native.nodeValue || '');
    if (native.nodeType === 8) return { id: uid(), kind: 'comment', text: native.nodeValue || '' };
    return null;
  };
  return convert;
}
/** Project a DOM fragment without attaching its native nodes to a live document. */
export function projectHtmlNodes(nodes) {
  const convert = htmlProjector();
  return Array.from(nodes, (node) => convert(node)).filter(Boolean);
}
export function projectHtmlDocument(parsed, { name = 'index.html', source } = {}) {
  const convert = htmlProjector();
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
/** Contextual fragment parsing in a detached HTML document; never a sanitizer or script runner. */
export function parseHtmlFragment(
  source,
  { context = element('body'), ancestors = [], Parser = globalThis.DOMParser } = {},
) {
  if (typeof source !== 'string' || source.length > 2_000_000)
    throw Error('HTML fragment must be text smaller than 2 MB.');
  if (!Parser) throw Error('HTML parsing requires the browser DOMParser.');
  if (!Array.isArray(ancestors) || ancestors.length > 150)
    throw Error('Invalid HTML fragment ancestry.');
  const parsed = new Parser().parseFromString(
    '<!doctype html><html><head></head><body></body></html>',
    'text/html',
  );
  // The parser's document has no browsing context: imported scripts/custom elements stay inert.
  let parent = parsed.body,
    native;
  for (const node of [...ancestors, context]) {
    if (node?.kind !== 'element' || !/^[A-Za-z_][\w.:-]*$/.test(node.type))
      throw Error('Choose an element as the HTML fragment context.');
    const namespace = node.namespaceURI || HTML_NAMESPACE;
    if (![HTML_NAMESPACE, SVG_NAMESPACE, MATHML_NAMESPACE].includes(namespace))
      throw Error('Unsupported HTML fragment namespace.');
    native = parsed.createElementNS(namespace, node.type);
    // Only integration-point metadata matters for parsing. Do not copy URLs or event attributes.
    if (
      namespace === MATHML_NAMESPACE &&
      node.type === 'annotation-xml' &&
      node.props?.encoding != null
    )
      native.setAttribute('encoding', String(node.props.encoding));
    parent.append(native);
    parent = namespace === HTML_NAMESPACE && node.type === 'template' ? native.content : native;
  }
  native.innerHTML = source;
  const nodes =
    native.namespaceURI === HTML_NAMESPACE && native.localName === 'template'
      ? native.content.childNodes
      : native.childNodes;
  return projectHtmlNodes(nodes);
}
/** Validate a complete candidate first; failure leaves the caller-owned AST untouched. */
export function insertHtmlFragment(doc, parentId, source, { index, Parser } = {}) {
  if (!isHtml(doc)) throw Error('Open an HTML document.');
  const target = find(doc.root, parentId);
  if (!canContainHtmlChildren(target)) throw Error('This element cannot contain an HTML fragment.');
  if (
    index !== undefined &&
    (!Number.isInteger(index) || index < 0 || index > target.children.length)
  )
    throw RangeError('The insertion index is outside the container.');
  const ancestors = [];
  for (let node = parentOf(doc.root, parentId); node; node = parentOf(doc.root, node.id))
    ancestors.unshift(node);
  const nodes = parseHtmlFragment(source, { context: target, ancestors, Parser });
  if (!nodes.length) return [];
  if (
    target.namespaceURI === SVG_NAMESPACE &&
    !['foreignObject', 'desc', 'title'].includes(target.type) &&
    nodes.some((node) => node.kind === 'element' && node.namespaceURI !== SVG_NAMESPACE)
  )
    throw Error('Use an SVG foreignObject to contain HTML elements.');
  if (
    isHtmlElement(target) &&
    ['table', 'thead', 'tbody', 'tfoot', 'tr'].includes(target.type) &&
    nodes.some((node) => node.kind === 'text' && node.text.trim())
  )
    throw Error('Place table text inside a cell.');
  const candidate = clone(doc);
  find(candidate.root, parentId).children.splice(index ?? target.children.length, 0, ...nodes);
  validateDocument(candidate);
  target.children.splice(index ?? target.children.length, 0, ...nodes);
  return nodes;
}
export function serializeHtmlNode(n, parent = '') {
  if (n.kind === 'comment') return '<!--' + n.text + '-->';
  if (n.kind !== 'element') {
    // Preserve the legacy parent-tag API while internal calls retain namespace information.
    const raw =
      typeof parent === 'string'
        ? HTML_RAW.has(parent)
        : isHtmlElement(parent) && HTML_RAW.has(parent.type);
    return raw ? n.text || '' : escapeText(n.text || '');
  }
  const tag = n.type,
    attrs = Object.entries(n.props)
      .map(([key, value]) => ' ' + key + '="' + escapeAttr(value) + '"')
      .join('');
  if (isHtmlVoid(n)) return '<' + tag + attrs + '>';
  const leading =
    isHtmlElement(n) &&
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
    n.children.map((c) => serializeHtmlNode(c, n)).join('') +
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
  return doc.root.children.find((n) => isHtmlElement(n, 'body')) || doc.root;
}
export function htmlHead(doc) {
  return doc.root.children.find((n) => isHtmlElement(n, 'head')) || doc.root;
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
    if (isHtmlElement(n, 'img') && !Object.hasOwn(n.props, 'alt'))
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
  if (!canContainHtmlChildren(p)) throw Error('This element cannot contain child elements.');
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
      !isHtmlElement(n) ||
      ['script', 'style', 'pre', 'textarea', 'listing', 'template'].includes(n.type)
    )
      return;
    n.children.forEach((c) => format(c, depth + 1));
    const children = n.children.filter((c) => !(c.kind === 'text' && !c.text.trim()));
    if (
      blocks.has(n.type) &&
      children.length &&
      children.every((c) => c.kind === 'comment' || (isHtmlElement(c) && blockChildren.has(c.type)))
    ) {
      n.children = children.flatMap((c) => [textNode('\n' + '  '.repeat(depth + 1)), c]);
      n.children.push(textNode('\n' + '  '.repeat(depth)));
    }
  };
  format(doc.root, 0);
  return canonicalHtml(doc).replace(/^(<!DOCTYPE[^>]*>)(?=<html)/i, '$1\n') + '\n';
}
