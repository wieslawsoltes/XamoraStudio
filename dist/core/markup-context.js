/** Tolerant lexical context for unfinished markup. Never parses or executes a document. */
const HTML = 'http://www.w3.org/1999/xhtml',
  SVG = 'http://www.w3.org/2000/svg',
  MATH = 'http://www.w3.org/1998/Math/MathML';
const voidTags = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' '),
);
const rawTags = new Set(
  'script style textarea title xmp iframe noembed noframes plaintext'.split(' '),
);
const htmlIntegration = (parent) =>
  (parent?.namespaceURI === SVG &&
    ['foreignobject', 'desc', 'title'].includes(parent.type.toLowerCase())) ||
  (parent?.namespaceURI === MATH &&
    parent.type.toLowerCase() === 'annotation-xml' &&
    ['text/html', 'application/xhtml+xml'].includes(
      (parent.attributes.get('encoding') || '').toLowerCase(),
    ));
const mathText = (parent) =>
  parent?.namespaceURI === MATH &&
  ['mi', 'mo', 'mn', 'ms', 'mtext'].includes(parent.type.toLowerCase());
const decode = (value) =>
  value.replace(/&(?:amp|quot|apos|lt|gt|#x[\da-f]+|#\d+);/gi, (entity) => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (Object.hasOwn(named, entity)) return named[entity];
    if (!entity.startsWith('&#')) return entity;
    const n = parseInt(
      entity.slice(entity[2].toLowerCase() === 'x' ? 3 : 2, -1),
      entity[2].toLowerCase() === 'x' ? 16 : 10,
    );
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
      ? String.fromCodePoint(n)
      : entity;
  });
/** Namespace expected for a child start tag in this lexical HTML context. */
export function htmlChildNamespace(parent, name = '') {
  const tag = name.toLowerCase();
  let ns = parent?.namespaceURI || HTML;
  if (htmlIntegration(parent) || (mathText(parent) && !['mglyph', 'malignmark'].includes(tag)))
    ns = HTML;
  if (
    parent?.namespaceURI === MATH &&
    parent.type.toLowerCase() === 'annotation-xml' &&
    tag === 'svg'
  )
    ns = HTML;
  return ns === HTML ? (tag === 'svg' ? SVG : tag === 'math' ? MATH : HTML) : ns;
}
/** Completed attributes and the current value, including exact raw value coordinates. */
function readTag(source, start, end, inherited, html) {
  const match = /^<\/?([\w:.-]*)/.exec(source.slice(start, end));
  const type = match?.[1] || '',
    attributes = new Map(),
    namespaces = new Map(inherited);
  let i = start + (match?.[0].length || 1),
    attribute = null;
  while (i < end) {
    while (/\s/.test(source[i] || '') && i < end) i++;
    if (i >= end || source[i] === '/' || source[i] === '>') break;
    const at = i;
    while (i < end && !/[\s=/>]/.test(source[i])) i++;
    if (i === at) {
      i++;
      continue;
    }
    const name = source.slice(at, i),
      key = html ? name.toLowerCase() : name;
    while (i < end && /\s/.test(source[i])) i++;
    let value = '',
      specified = false;
    if (source[i] === '=') {
      specified = true;
      i++;
      while (i < end && /\s/.test(source[i])) i++;
      const quote = ['"', "'"].includes(source[i]) ? source[i++] : null,
        valueStart = i;
      while (i < end && (quote ? source[i] !== quote : !/[\s>]/.test(source[i]))) i++;
      value = source.slice(valueStart, i);
      if (i === end) attribute = { name, value, start: valueStart, quote };
      if (quote && source[i] === quote) i++;
    }
    // XML duplicates are invalid; HTML uses its first occurrence, matching parser recovery.
    if (!attribute && (specified || i < end) && !attributes.has(key))
      attributes.set(key, decode(value));
    if (!html && !attribute && (name === 'xmlns' || name.startsWith('xmlns:')))
      namespaces.set(name === 'xmlns' ? '' : name.slice(6), decode(value));
  }
  const prefix = type.includes(':') ? type.split(':')[0] : '';
  return {
    type,
    start,
    attributes,
    namespaces,
    namespaceURI: namespaces.get(prefix) || '',
    attribute,
  };
}
/** Bounded, quote/comment/raw-text-aware prefix scanner shared by both completion engines. */
export function markupCompletionContext(
  source,
  offset = source?.length ?? 0,
  { html = false } = {},
) {
  const stack = [],
    customElements = [],
    empty = {
      start: -1,
      quote: null,
      blocked: true,
      stack,
      customElements,
      tag: null,
      attribute: null,
      rawText: null,
    };
  if (
    typeof source !== 'string' ||
    source.length > 2_000_000 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > source.length
  )
    return empty;
  let i = 0,
    count = 0;
  const base = new Map([['xml', 'http://www.w3.org/XML/1998/namespace']]);
  while (i < offset) {
    let parent = stack.at(-1);
    if (
      html &&
      parent &&
      ((parent.namespaceURI === HTML && rawTags.has(parent.type.toLowerCase())) ||
        ['script', 'style'].includes(parent.type.toLowerCase()))
    ) {
      const tag = parent.type.toLowerCase(),
        close = new RegExp('</' + tag + '(?=[\\s/>])', 'ig');
      close.lastIndex = i;
      const next = tag === 'plaintext' ? null : close.exec(source);
      if (!next || next.index >= offset) {
        const partial = source.slice(i, offset).match(/<\/[\w:.-]*$/)?.[0];
        if (tag === 'plaintext' || !partial || !('</' + tag).startsWith(partial.toLowerCase()))
          return { ...empty, blocked: false, rawText: tag };
        i = offset - partial.length;
      } else i = next.index;
    }
    if (source[i] !== '<') {
      i++;
      continue;
    }
    const begin = i;
    if (
      source.startsWith('<!--', i) ||
      source.startsWith('<![CDATA[', i) ||
      source.startsWith('<?', i)
    ) {
      const stop = source.startsWith('<!--', i) ? '-->' : source.startsWith('<?', i) ? '?>' : ']]>',
        end = source.indexOf(stop, i + 2);
      if (end < 0 || end + stop.length > offset) return empty;
      i = end + stop.length;
      continue;
    }
    let quote = null,
      bracket = 0,
      j = i + 1;
    for (; j < offset; j++) {
      const c = source[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (source[i + 1] === '!' && c === '[') bracket++;
      else if (source[i + 1] === '!' && c === ']') bracket--;
      else if (c === '>' && bracket <= 0) break;
    }
    if (source[i + 1] === '!') {
      if (j === offset) return empty;
      i = j + 1;
      continue;
    }
    const closed = source[i + 1] === '/',
      tag = readTag(source, begin, j, parent?.namespaces || base, html);
    if (html) tag.namespaceURI = htmlChildNamespace(parent, tag.type);
    if (j === offset)
      return {
        start: begin,
        quote,
        blocked: false,
        stack,
        customElements,
        tag,
        attribute: tag.attribute,
        rawText: null,
      };
    if (++count > 15000 || stack.length > 150) return empty;
    if (closed) {
      const name = html ? tag.type.toLowerCase() : tag.type;
      for (let k = stack.length - 1; k >= 0; k--)
        if ((html ? stack[k].type.toLowerCase() : stack[k].type) === name) {
          stack.splice(k);
          break;
        }
    } else if (tag.type) {
      if (
        html &&
        tag.namespaceURI === HTML &&
        tag.type.includes('-') &&
        !customElements.includes(tag.type.toLowerCase())
      )
        customElements.push(tag.type.toLowerCase());
      if (html) {
        // Common optional-end contexts. Not an HTML tree builder: the shared AST remains authoritative.
        const name = tag.type.toLowerCase();
        const groups = {
          li: ['li'],
          option: ['option'],
          optgroup: ['option', 'optgroup'],
          tr: ['td', 'th', 'tr'],
          td: ['td', 'th'],
          th: ['td', 'th'],
        };
        if (parent?.namespaceURI === HTML && Object.hasOwn(groups, name))
          while (
            stack.at(-1)?.namespaceURI === HTML &&
            groups[name].includes(stack.at(-1).type.toLowerCase())
          )
            stack.pop();
      }
      if (
        !(html && tag.namespaceURI === HTML && voidTags.has(tag.type.toLowerCase())) &&
        !(source[j - 1] === '/' && (!html || tag.namespaceURI !== HTML))
      )
        stack.push(tag);
    }
    i = j + 1;
  }
  return { ...empty, blocked: false };
}
