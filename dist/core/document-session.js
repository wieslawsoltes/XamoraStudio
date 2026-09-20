/** Atomic source/model editing session. Framework adapters never execute markup. */
import { clone, find, walk, validateDocument } from './model.js';
import { parseXaml, serializeXaml, serializeNode, escapeXML } from './xaml.js';
import { parseHtml, serializeHtml, serializeHtmlNode, canonicalHtml, HTML_RAW } from './html.js';
import { scanSource, buildSourceIndex, updateSourceIndex } from './source-syntax.js';
import { SourceTextBuffer, computeSourceEdit } from './source-text-buffer.js';

export const sourceAdapters = {
  XAML: {
    parse: parseXaml,
    serialize: serializeXaml,
    serializeNode: (n) => serializeNode(n, 0, { lineWidth: Infinity }),
  },
  HTML: { parse: parseHtml, serialize: serializeHtml, serializeNode: serializeHtmlNode },
};
const shape = (n) =>
  n.kind === 'element'
    ? [
        'element',
        n.type,
        Object.entries(n.props || {}).sort(([a], [b]) => a.localeCompare(b)),
        (n.children || []).map(shape),
      ]
    : [n.kind, n.text];
const documentShape = (doc) =>
  JSON.stringify([
    doc.framework,
    (doc.preamble || []).map(shape),
    shape(doc.root),
    (doc.postamble || []).map(shape),
    doc.framework === 'HTML' ? doc.metadata?.html?.doctype || '' : null,
  ]);
const sameNode = (a, b) => !!a && JSON.stringify(shape(a)) === JSON.stringify(shape(b));
const nodes = (doc) => {
  const out = [];
  for (const n of doc.preamble || []) walk(n, (v) => out.push(v));
  walk(doc.root, (v) => out.push(v));
  for (const n of doc.postamble || []) walk(n, (v) => out.push(v));
  return out;
};
const nodeKey = (n) =>
  n.kind === 'element'
    ? n.props.id
      ? 'id:' + n.props.id
      : n.props['x:Name']
        ? 'name:' + n.props['x:Name']
        : n.props.Name
          ? 'name:' + n.props.Name
          : n.props['x:Key']
            ? 'resource:' + n.props['x:Key']
            : null
    : null;
const compatible = (a, b) => a?.kind === b?.kind && (a.kind !== 'element' || a.type === b.type);
/** Preserve identities through edits and moves. Duplicate names never become global keys. */
export function reconcileDocumentIds(previous, next) {
  const old = nodes(previous),
    fresh = nodes(next),
    used = new Set(),
    matched = new Map();
  const assign = (a, b) => {
    if (!a || !b || used.has(a.id) || matched.has(b) || !compatible(a, b)) return false;
    b.id = a.id;
    used.add(a.id);
    matched.set(b, a);
    return true;
  };
  const group = (list, key) => {
    const map = new Map();
    for (const n of list) {
      const k = key(n);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(n);
    }
    return map;
  };
  assign(previous.root, next.root);
  const aKeys = group(old, (n) => nodeKey(n)),
    bKeys = group(fresh, (n) => nodeKey(n));
  for (const [key, list] of bKeys)
    if (list.length === 1 && aKeys.get(key)?.length === 1) assign(aKeys.get(key)[0], list[0]);
  // Unique complete subtrees retain identity when unkeyed elements move or reorder.
  const signatures = new WeakMap();
  const signature = (n) => {
    if (!signatures.has(n)) signatures.set(n, JSON.stringify(shape(n)));
    return signatures.get(n);
  };
  const aExact = group(old, signature),
    bExact = group(fresh, signature);
  for (const [key, list] of bExact)
    if (list.length === 1 && aExact.get(key)?.length === 1) assign(aExact.get(key)[0], list[0]);
  const visited = new WeakSet();
  const reconcileSiblings = (a, b) => {
    if (visited.has(b)) return;
    visited.add(b);
    const aa = a.children || [],
      bb = b.children || [];
    const exact = group(
      aa.filter((n) => !used.has(n.id)),
      signature,
    );
    for (const n of bb)
      if (!matched.has(n)) {
        const q = exact.get(signature(n));
        while (q?.length && used.has(q[0].id)) q.shift();
        if (q?.length) assign(q.shift(), n);
      }
    // Scope-local keyed matching protects templates with repeated x:Name values.
    const scoped = group(
      aa.filter((n) => !used.has(n.id)),
      nodeKey,
    );
    for (const n of bb)
      if (!matched.has(n) && nodeKey(n)) {
        const q = scoped.get(nodeKey(n));
        if (q?.length === 1) assign(q[0], n);
      }
    const remaining = group(
      aa.filter((n) => !used.has(n.id)),
      (n) => n.kind + ':' + (n.type || ''),
    );
    for (const n of bb)
      if (!matched.has(n)) {
        const q = remaining.get(n.kind + ':' + (n.type || ''));
        while (q?.length && used.has(q[0].id)) q.shift();
        if (q?.length) assign(q.shift(), n);
      }
    for (const n of bb) {
      const oldNode = matched.get(n);
      if (oldNode) reconcileSiblings(oldNode, n);
    }
  };
  reconcileSiblings(previous.root, next.root);
  reconcileSiblings({ children: previous.preamble || [] }, { children: next.preamble || [] });
  reconcileSiblings({ children: previous.postamble || [] }, { children: next.postamble || [] });
  // A globally matched moved container still needs to reconcile edited descendants.
  for (const n of fresh) if (matched.has(n)) reconcileSiblings(matched.get(n), n);
  return next;
}

const escapeAttr = (value, quote, html) => {
  let out = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  out = out.replace(quote === "'" ? /'/g : /"/g, quote === "'" ? '&apos;' : '&quot;');
  return html ? out : out.replace(/\t/g, '&#9;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;');
};
function replaceRanges(source, edits, start = 0, end = source.length) {
  let text = '',
    cursor = start;
  for (const e of edits.sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (e.start < cursor || e.end > end) throw Error('Overlapping source edits.');
    text += source.slice(cursor, e.start) + e.text;
    cursor = e.end;
  }
  return text + source.slice(cursor, end);
}

/** Patch concrete source while reusing untouched attributes, comments and moved subtrees. */
export function patchDocumentSource(
  source,
  before,
  after,
  {
    adapter = sourceAdapters[after.framework === 'HTML' ? 'HTML' : 'XAML'],
    index = buildSourceIndex(source, before),
  } = {},
) {
  if (documentShape(before) === documentShape(after)) return source;
  const html = after.framework === 'HTML',
    oldById = new Map(nodes(before).map((n) => [n.id, n]));
  const render = (n, parentType = '') => {
    const old = oldById.get(n.id),
      span = index.byId.get(n.id);
    if (old && span && sameNode(old, n)) return source.slice(span.start, span.end);
    if (!old || !span) {
      const serialize = (node) =>
        adapter.serializeNode
          ? adapter.serializeNode(node, parentType)
          : html
            ? serializeHtmlNode(node, parentType)
            : serializeNode(node, 0, { lineWidth: Infinity });
      // A new wrapper can own existing source-backed children. Serialize only its
      // shell, not the moved subtrees: quotes, entities, comments and whitespace
      // inside those subtrees still belong to their original concrete ranges.
      const childSpans = (n.children || []).map((c) => index.byId.get(c.id));
      if (
        n.kind === 'element' &&
        childSpans.length &&
        childSpans.every(
          (s, i) =>
            s &&
            !s.synthetic &&
            (i === 0 ||
              (s.start >= childSpans[i - 1].end &&
                index.parentIds.get(s.nodeId) === index.parentIds.get(childSpans[0].nodeId))),
        )
      ) {
        const shell = serialize({ ...n, children: [] }),
          token = scanSource(shell, { html }).tokens.find((t) => t.kind === 'element');
        if (token && !token.void) {
          let body = '',
            cursor = childSpans[0].start;
          n.children.forEach((child, i) => {
            const s = childSpans[i];
            body += source.slice(cursor, s.start) + render(child, n.type);
            cursor = s.end;
          });
          return (
            shell.slice(0, token.openEnd).replace(/\s*\/\s*>$/, '>') + body + '</' + n.type + '>'
          );
        }
      }
      return serialize(n);
    }
    if (n.kind !== 'element') {
      if (n.kind === 'text')
        return html && HTML_RAW.has(parentType)
          ? n.text
          : html
            ? String(n.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            : escapeXML(n.text);
      return html ? serializeHtmlNode(n, parentType) : serializeNode(n, 0, { lineWidth: Infinity });
    }
    if (old.kind !== 'element')
      return html ? serializeHtmlNode(n, parentType) : serializeNode(n, 0, { lineWidth: Infinity });
    if (span.synthetic) {
      if (n.type !== old.type || JSON.stringify(n.props) !== JSON.stringify(old.props))
        return html
          ? serializeHtmlNode(n, parentType)
          : serializeNode(n, 0, { lineWidth: Infinity });
      return renderChildren(old, n, span.start, span.end);
    }
    const edits = [];
    if (n.type !== old.type) edits.push({ start: span.nameStart, end: span.nameEnd, text: n.type });
    const seen = new Set();
    for (const a of span.attrs) {
      seen.add(a.name);
      if (!Object.hasOwn(n.props, a.name)) {
        edits.push({ start: a.fullStart, end: a.end, text: '' });
        continue;
      }
      if (String(old.props[a.name]) === String(n.props[a.name])) continue;
      if (a.valueStart !== undefined && a.quote)
        edits.push({
          start: a.valueStart,
          end: a.valueEnd,
          text: escapeAttr(n.props[a.name], a.quote, html),
        });
      else
        edits.push({
          start: a.start,
          end: a.end,
          text: a.name + '="' + escapeAttr(n.props[a.name], '"', html) + '"',
        });
    }
    const additions = Object.keys(n.props)
      .filter((k) => !seen.has(k))
      .map((k) => ' ' + k + '="' + escapeAttr(n.props[k], '"', html) + '"')
      .join('');
    const rawOpening = source.slice(span.start, span.openEnd);
    const suffix = rawOpening.match(/\s*\/?\s*>$/)?.[0] || '>';
    const insertion = span.openEnd - suffix.length;
    if (additions) edits.push({ start: insertion, end: insertion, text: additions });
    let opening = replaceRanges(source, edits, span.start, span.openEnd);
    if (!n.children.length) {
      if (span.selfClosing || span.void) return opening;
      return opening + closing(n, span);
    }
    if (span.void) throw Error('Void HTML elements cannot contain children.');
    if (span.selfClosing) opening = opening.replace(/\/\s*>$/, '>');
    return (
      opening +
      renderChildren(old, n, span.openEnd, span.closeStart) +
      (span.selfClosing ? '</' + n.type + '>' : closing(n, span))
    );
  };
  const closing = (n, span) => {
    const raw = source.slice(span.closeStart, span.end);
    if (span.closeNameStart !== undefined && n.type !== oldById.get(n.id)?.type)
      return replaceRanges(
        source,
        [{ start: span.closeNameStart, end: span.closeNameEnd, text: n.type }],
        span.closeStart,
        span.end,
      );
    return raw;
  };
  const renderChildren = (old, n, start, end) => {
    const aa = old.children || [],
      bb = n.children || [],
      oldOrder = aa.map((c) => c.id).join('|'),
      newOrder = bb.map((c) => c.id).join('|');
    if (oldOrder === newOrder) {
      const edits = [];
      for (const c of bb) {
        const span = index.byId.get(c.id);
        if (span && span.start >= start && span.end <= end) {
          if (!sameNode(oldById.get(c.id), c))
            edits.push({ start: span.start, end: span.end, text: render(c, n.type) });
        } else if (!sameNode(oldById.get(c.id), c))
          throw Error(
            'This browser-repaired node has no unambiguous source range. Edit its code to make its container explicit.',
          );
      }
      return replaceRanges(source, edits, start, end);
    }
    const spans = aa
      .map((c) => index.byId.get(c.id))
      .filter((s) => s && s.start >= start && s.end <= end)
      .sort((a, b) => a.start - b.start);
    if (spans.length !== aa.length)
      throw Error(
        'This browser-repaired container has ambiguous source ranges. Make its HTML tags explicit before restructuring it.',
      );
    const leading = new Map();
    let cursor = start;
    for (const s of spans) {
      leading.set(s.nodeId, source.slice(cursor, s.start));
      cursor = s.end;
    }
    const trailing = source.slice(cursor, end);
    // A newly inserted wrapper inherits the whitespace preceding its first moved
    // child, rather than an unrelated separator elsewhere in the old container.
    for (const child of bb) {
      const first = child.children?.[0];
      if (
        !leading.has(child.id) &&
        first &&
        leading.has(first.id) &&
        index.parentIds.get(first.id) === old.id
      )
        leading.set(child.id, leading.get(first.id));
    }
    const separators = spans
      .map((s) => leading.get(s.nodeId))
      .filter((s) => /^\s*$/.test(s) && s.includes('\n'));
    if (
      !html &&
      !aa.length &&
      bb.length &&
      bb.every((c) => !['text', 'cdata'].includes(c.kind)) &&
      !trailing
    ) {
      const parentSpan = index.byId.get(n.id),
        at = parentSpan?.start ?? start,
        lineStart = source.lastIndexOf('\n', at - 1) + 1,
        pad = source.slice(lineStart, at).match(/^\s*/)?.[0] || '',
        unit = source.match(/\n([ \t]+)<[^/]/)?.[1] || '    ',
        eol = source.includes('\r\n') ? '\r\n' : '\n';
      return eol + bb.map((c) => pad + unit + render(c, n.type)).join(eol) + eol + pad;
    }
    const separator = html
      ? ''
      : separators[0] || (source.slice(start, end).includes('\n') ? '\n    ' : '');
    return (
      bb
        .map((c, i) => (leading.has(c.id) ? leading.get(c.id) : separator) + render(c, n.type))
        .join('') + trailing
    );
  };
  const oldTop = [...(before.preamble || []), before.root, ...(before.postamble || [])],
    newTop = [...(after.preamble || []), after.root, ...(after.postamble || [])];
  if (oldTop.map((n) => n.id).join('|') !== newTop.map((n) => n.id).join('|'))
    return renderChildren({ children: oldTop }, { children: newTop }, 0, source.length);
  const edits = [];
  for (const n of newTop) {
    const span = index.byId.get(n.id);
    if (!span) {
      if (!sameNode(oldById.get(n.id), n)) throw Error('The changed node has no source range.');
      continue;
    }
    if (!sameNode(oldById.get(n.id), n))
      edits.push({ start: span.start, end: span.end, text: render(n) });
  }
  if (html && before.metadata?.html?.doctype !== after.metadata?.html?.doctype) {
    const token = index.syntax.tokens.find((t) => t.kind === 'doctype');
    edits.push({
      start: token?.start || 0,
      end: token?.end || 0,
      text: after.metadata?.html?.doctype || '',
    });
  }
  return replaceRanges(source, edits);
}

export class DocumentSession extends EventTarget {
  constructor(store, { source, adapters = {}, incremental = true } = {}) {
    super();
    if (!store?.addCommitHook)
      throw Error('DocumentSession requires a DocumentStore with atomic commit hooks.');
    this.store = store;
    this.adapters = { ...sourceAdapters, ...adapters };
    this.origin = 'visual';
    this._applying = false;
    this._lastShape = '';
    this.incremental = incremental;
    this.processingStats = {
      fullParses: 0,
      localParses: 0,
      fullScans: 0,
      localScans: 0,
      charactersParsed: 0,
      charactersScanned: 0,
      incrementalUpdates: 0,
      fullUpdates: 0,
    };
    this.lastUpdate = { mode: 'initial', reason: 'session-created' };
    const existing = store.document.metadata?.source;
    if (source !== undefined && !existing) {
      store.document.metadata ??= {};
      store.document.metadata.source = {
        version: 1,
        language: this.language,
        text: String(source),
        validText: String(source),
        diagnostics: [],
      };
    }
    this.refresh({ emit: false });
    this._removeHook = store.addCommitHook((change) => this._beforeCommit(change));
    this._onStoreChange = () => {
      this.refresh({ emit: false });
      this._emit();
    };
    store.addEventListener('change', this._onStoreChange);
  }
  get language() {
    return this.store.document.framework === 'HTML' ? 'HTML' : 'XAML';
  }
  get adapter() {
    return this.adapters[this.store.document.framework] || this.adapters[this.language];
  }
  get source() {
    return this.store.document.metadata?.source?.text ?? '';
  }
  get validSource() {
    return this.store.document.metadata?.source?.validText ?? this.source;
  }
  get isValid() {
    return !(this.store.document.metadata?.source?.diagnostics || []).some(
      (d) => d.severity === 'error',
    );
  }
  get diagnostics() {
    return clone(this.store.document.metadata?.source?.diagnostics || []);
  }
  get revision() {
    return this.store.revision;
  }
  _parse(source) {
    if (typeof source !== 'string' || source.length > 2_000_000)
      throw Error('Source must be text smaller than 2 MB.');
    this.processingStats.fullScans++;
    this.processingStats.charactersScanned += source.length;
    const syntax = scanSource(source, { html: this.language === 'HTML' });
    this.processingStats.fullParses++;
    this.processingStats.charactersParsed += source.length;
    const doc = this.adapter.parse(source, {
      name: this.store.document.name,
      framework: this.store.document.framework,
    });
    validateDocument(doc);
    return { doc, syntax };
  }
  _parseLocal(fragment) {
    this.processingStats.localScans++;
    this.processingStats.charactersScanned += fragment.length;
    scanSource(fragment, { html: this.language === 'HTML' });
    this.processingStats.localParses++;
    this.processingStats.charactersParsed += fragment.length;
    const doc = this.adapter.parse(fragment, {
      name: this.store.document.name,
      framework: this.store.document.framework,
    });
    validateDocument(doc);
    return doc;
  }
  _sourcePreparation(text, base = this.store.document, knownEdit) {
    const start = { ...this.processingStats };
    this._fallbackReason = 'structural-edit';
    let result;
    try {
      result = this._tryIncremental(text, base, knownEdit);
      if (!result) result = { ...this._parse(text), mode: 'full', reason: this._fallbackReason };
      return result;
    } finally {
      const mode = result?.mode || this._localErrorMode || 'full';
      this.lastUpdate = {
        mode,
        reason: result?.reason || this._fallbackReason,
        input: knownEdit ? 'range' : 'snapshot',
        charactersParsed: this.processingStats.charactersParsed - start.charactersParsed,
        charactersScanned: this.processingStats.charactersScanned - start.charactersScanned,
        range: result?.edit
          ? {
              start: result.edit.start,
              oldEnd: result.edit.end,
              newEnd: result.edit.start + result.edit.text.length,
            }
          : null,
      };
      if (mode.startsWith('incremental')) this.processingStats.incrementalUpdates++;
      else this.processingStats.fullUpdates++;
      this._localErrorMode = null;
    }
  }
  _tryIncremental(text, base, knownEdit) {
    if (!this.incremental) {
      this._fallbackReason = 'incremental-disabled';
      return null;
    }
    const oldSource = base.metadata?.source?.validText;
    if (
      typeof oldSource !== 'string' ||
      this.index?.source !== oldSource ||
      text.length > 2_000_000 ||
      (base.metadata?.source?.diagnostics || []).some((d) => d.severity === 'error')
    ) {
      this._fallbackReason = 'unavailable-valid-base';
      return null;
    }
    if (this.adapter !== sourceAdapters[this.language]) {
      this._fallbackReason = 'custom-adapter';
      return null;
    }
    const edit = knownEdit || computeSourceEdit(oldSource, text);
    if (!edit) return null;
    const modelNodes =
      base === this.store.document && this._lastRoot === base.root
        ? this._modelNodes
        : new Map(nodes(base).map((n) => [n.id, n]));
    const namespaceContext = (node) =>
      Object.entries(node?.scope || {})
        .filter(([prefix]) => prefix !== 'xml')
        .map(
          ([prefix, value]) =>
            ' xmlns' + (prefix ? ':' + prefix : '') + '="' + escapeXML(value) + '"',
        )
        .join('');
    const htmlContextSafe = (id) => {
      const raw = this.index.tokenById.get(id);
      if (!raw) return false;
      let parentId = this.index.parentIds.get(id);
      while (parentId && this.index.byId.get(parentId)?.synthetic)
        parentId = this.index.parentIds.get(parentId);
      const expected = parentId ? this.index.tokenById.get(parentId) : this.index.syntax.root;
      return raw.parent === expected;
    };
    const spans = this.index.spans;
    for (const span of spans) {
      if (span.synthetic || span.start > edit.start || span.end < edit.end) continue;
      const node = modelNodes.get(span.nodeId);
      if (!node) continue;
      for (const attribute of span.attrs || []) {
        if (!attribute.quote || edit.start < attribute.valueStart || edit.end > attribute.valueEnd)
          continue;
        if (
          attribute.name === 'xmlns' ||
          attribute.name.startsWith('xmlns:') ||
          attribute.name.startsWith('xml:')
        ) {
          this._fallbackReason = 'namespace-or-inherited-context';
          return null;
        }
        if (
          this.language === 'HTML' &&
          ((node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml') ||
            !htmlContextSafe(node.id))
        ) {
          this._fallbackReason = 'foreign-or-repaired-html';
          return null;
        }
        if (span.attrs.filter((a) => a.name === attribute.name).length !== 1) {
          this._fallbackReason = 'duplicate-html-attribute';
          return null;
        }
        const value =
          oldSource.slice(attribute.valueStart, edit.start) +
          edit.text +
          oldSource.slice(edit.end, attribute.valueEnd);
        if (value.includes(attribute.quote) || value.includes('<') || value.includes('\u0000')) {
          this._fallbackReason = 'attribute-token-boundary';
          return null;
        }
        const raw =
          oldSource.slice(attribute.start, attribute.valueStart) +
          value +
          oldSource.slice(attribute.valueEnd, attribute.end);
        const fragment =
          this.language === 'HTML'
            ? '<html><head></head><body><div ' + raw + '></div></body></html>'
            : '<__xamora' + namespaceContext(node) + '><probe ' + raw + ' /></__xamora>';
        try {
          const parsed = this._parseLocal(fragment),
            probe =
              this.language === 'HTML'
                ? parsed.root.children
                    .find((n) => n.type === 'body')
                    ?.children.find((n) => n.type === 'div')
                : parsed.root.children.find((n) => n.kind === 'element');
          if (
            !probe ||
            Object.keys(probe.props).length !== 1 ||
            !Object.hasOwn(probe.props, attribute.name)
          ) {
            this._fallbackReason = 'attribute-projection-ambiguity';
            return null;
          }
          return {
            mode: 'incremental-attribute',
            reason: 'quoted-attribute-value',
            edit,
            nodeId: node.id,
            attributeName: attribute.name,
            value: probe.props[attribute.name],
          };
        } catch (error) {
          this._localErrorMode = 'incremental-invalid';
          error.start = edit.start;
          Object.assign(error, this.index.position(edit.start));
          throw error;
        }
      }
    }
    for (const span of spans) {
      if (span.kind !== 'text' || span.start > edit.start || span.end < edit.end) continue;
      const node = modelNodes.get(span.nodeId),
        parent = modelNodes.get(this.index.parentIds.get(span.nodeId));
      if (!node || !parent) continue;
      const raw =
        oldSource.slice(span.start, edit.start) + edit.text + oldSource.slice(edit.end, span.end);
      if (!raw || raw.includes('<') || raw.includes('\u0000')) {
        this._fallbackReason = 'text-token-boundary';
        return null;
      }
      if (this.language === 'HTML') {
        const contexts = new Set([
          ...HTML_RAW,
          'title',
          'textarea',
          'pre',
          'listing',
          'table',
          'thead',
          'tbody',
          'tfoot',
          'tr',
          'colgroup',
          'select',
          'option',
          'optgroup',
          'template',
          'svg',
          'math',
          'head',
          'html',
        ]);
        let p = parent;
        while (p) {
          if (
            (contexts.has(p.type) && !['html'].includes(p.type)) ||
            (p.namespaceURI && p.namespaceURI !== 'http://www.w3.org/1999/xhtml')
          ) {
            this._fallbackReason = 'contextual-html-text';
            return null;
          }
          p = modelNodes.get(this.index.parentIds.get(p.id));
        }
        if (!htmlContextSafe(node.id)) {
          this._fallbackReason = 'repaired-html-text';
          return null;
        }
      }
      const fragment =
        this.language === 'HTML'
          ? '<html><head></head><body><div>' + raw + '</div></body></html>'
          : '<__xamora' +
            namespaceContext(parent) +
            (parent.space === 'preserve' ? ' xml:space="preserve"' : '') +
            '>' +
            raw +
            '</__xamora>';
      try {
        const parsed = this._parseLocal(fragment),
          probe =
            this.language === 'HTML'
              ? parsed.root.children
                  .find((n) => n.type === 'body')
                  ?.children.find((n) => n.type === 'div')
              : parsed.root;
        if (probe?.children.length !== 1 || probe.children[0].kind !== 'text') {
          this._fallbackReason = 'text-node-topology';
          return null;
        }
        return {
          mode: 'incremental-text',
          reason: 'ordinary-text-token',
          edit,
          nodeId: node.id,
          value: probe.children[0].text,
        };
      } catch (error) {
        this._localErrorMode = 'incremental-invalid';
        error.start = edit.start;
        Object.assign(error, this.index.position(edit.start));
        throw error;
      }
    }
    return null;
  }
  _applyLocal(doc, prepared) {
    const node = find(doc.root, prepared.nodeId);
    if (!node) throw Error('The edited AST node no longer exists.');
    if (prepared.attributeName)
      Object.defineProperty(node.props, prepared.attributeName, {
        value: prepared.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    else node.text = prepared.value;
  }
  _record(doc, text, validText, diagnostics = []) {
    doc.metadata ??= {};
    doc.metadata.source = {
      version: 1,
      language: doc.framework === 'HTML' ? 'HTML' : 'XAML',
      text,
      validText,
      diagnostics,
    };
    if (doc.framework === 'HTML') {
      doc.metadata.html ??= {};
      doc.metadata.html.originalSource = validText;
      doc.metadata.html.originalMarkup = canonicalHtml(doc);
    }
  }
  _diagnostic(error, text) {
    const line = error.line || 1,
      column = error.column || 1;
    let start = error.start;
    if (start === undefined) {
      start = 0;
      for (let l = 1; l < line; l++) {
        const p = text.indexOf('\n', start);
        start = p < 0 ? text.length : p + 1;
      }
      start = Math.min(text.length, start + column - 1);
    }
    return {
      severity: 'error',
      message: error.message,
      line,
      column,
      start,
      end: Math.min(text.length, start + 1),
    };
  }
  _emit() {
    const event = new Event('change');
    event.detail = {
      origin: this.origin,
      revision: this.revision,
      source: this.source,
      valid: this.isValid,
      diagnostics: this.diagnostics,
    };
    this.dispatchEvent(event);
    this.origin = 'visual';
  }
  _beforeCommit({ before, document: after }) {
    if (this._applying) return;
    const changed = documentShape(before) !== documentShape(after);
    if (!changed) return;
    if ((before.metadata?.source?.diagnostics || []).some((d) => d.severity === 'error'))
      throw Error(
        'Fix the source errors or discard the source draft before editing the design. Your draft has been preserved.',
      );
    // Literal root dimensions drive the artboard across property panels and gestures.
    // An explicit artboard adjustment in the same transaction takes precedence.
    if (after.framework !== 'HTML')
      for (const [property, dimension] of [
        ['Width', 'width'],
        ['Height', 'height'],
      ]) {
        const value = after.root.props[property];
        if (
          value !== before.root.props[property] &&
          after.design[dimension] === before.design[dimension] &&
          value !== undefined &&
          String(value).trim() !== '' &&
          Number.isFinite(Number(value)) &&
          Number(value) > 0
        )
          after.design[dimension] = Number(value);
      }
    const oldSource = before.metadata?.source?.validText || this.adapter.serialize(before);
    let index = this.index;
    if (index?.source !== oldSource) {
      const parsedOld = this._parse(oldSource).doc;
      reconcileDocumentIds(before, parsedOld);
      index = buildSourceIndex(oldSource, parsedOld);
    }
    const text = patchDocumentSource(oldSource, before, after, { adapter: this.adapter, index });
    let parsed = this._sourcePreparation(text, before);
    let expected = parsed.doc;
    if (parsed.mode.startsWith('incremental')) {
      expected = clone(before);
      this._applyLocal(expected, parsed);
      if (documentShape(expected) !== documentShape(after)) {
        parsed = { ...this._parse(text), mode: 'full', reason: 'combined-model-change' };
        expected = parsed.doc;
        this.processingStats.incrementalUpdates--;
        this.processingStats.fullUpdates++;
        this.lastUpdate = {
          ...this.lastUpdate,
          mode: 'full',
          reason: parsed.reason,
          charactersParsed: this.lastUpdate.charactersParsed + text.length,
          charactersScanned: this.lastUpdate.charactersScanned + text.length,
        };
      }
    }
    if (documentShape(expected) !== documentShape(after))
      throw Error(
        'This visual edit would change additional markup during parsing. Make the affected source container explicit before editing it.',
      );
    this._record(after, text, text);
    this._pendingParsed = { source: text, ...parsed, document: after };
    this.origin = 'visual';
  }
  updateSource(text, options = {}) {
    return this._updateSource(text, options);
  }
  _updateSource(text, { origin = 'code', expectedRevision } = {}, knownEdit) {
    text = String(text);
    if (expectedRevision !== undefined && expectedRevision !== this.revision)
      return {
        accepted: false,
        valid: this.isValid,
        revision: this.revision,
        diagnostics: [
          {
            severity: 'error',
            code: 'revision-conflict',
            message: 'The document changed since this source edit was created.',
          },
        ],
      };
    if (text === this.source)
      return {
        accepted: true,
        valid: this.isValid,
        revision: this.revision,
        diagnostics: this.diagnostics,
      };
    let parsed,
      errors = [];
    try {
      parsed = this._sourcePreparation(text, this.store.document, knownEdit);
    } catch (error) {
      errors = [this._diagnostic(error, text)];
    }
    this.origin = origin;
    this._applying = true;
    try {
      this.store.transaction(
        errors.length ? 'Edit source draft' : 'Edit ' + this.language + ' source',
        (doc) => {
          if (parsed) {
            const dimensions = { Width: doc.root.props.Width, Height: doc.root.props.Height };
            if (parsed.mode.startsWith('incremental')) this._applyLocal(doc, parsed);
            else {
              reconcileDocumentIds(doc, parsed.doc);
              doc.root = parsed.doc.root;
              doc.preamble = parsed.doc.preamble || [];
              doc.postamble = parsed.doc.postamble || [];
              if (this.language === 'HTML')
                doc.metadata.html = { ...doc.metadata.html, ...parsed.doc.metadata.html };
            }
            if (this.language === 'XAML')
              for (const [property, dimension] of [
                ['Width', 'width'],
                ['Height', 'height'],
              ]) {
                const value = doc.root.props[property];
                if (
                  value !== dimensions[property] &&
                  value !== undefined &&
                  String(value).trim() !== '' &&
                  Number.isFinite(Number(value)) &&
                  Number(value) > 0
                )
                  doc.design[dimension] = Number(value);
              }
            this._record(doc, text, text);
            this._pendingParsed = { source: text, ...parsed, document: doc };
          } else this._record(doc, text, this.validSource, errors);
        },
      );
    } finally {
      this._applying = false;
    }
    return {
      accepted: true,
      valid: !errors.length,
      revision: this.revision,
      diagnostics: this.diagnostics,
    };
  }
  applySourceEdits(edits, { origin = 'code', expectedRevision, expectedVersion } = {}) {
    if (expectedRevision !== undefined && expectedRevision !== this.revision)
      return {
        accepted: false,
        valid: this.isValid,
        revision: this.revision,
        diagnostics: [
          {
            severity: 'error',
            code: 'revision-conflict',
            message: 'The document changed since these source edits were created.',
          },
        ],
      };
    const proposed = this.buffer.fork(),
      result = proposed.applyEdits(edits, { expectedVersion });
    if (!result.accepted)
      return {
        accepted: false,
        valid: this.isValid,
        revision: this.revision,
        diagnostics: [
          {
            severity: 'error',
            code: result.reason || 'invalid-source-edits',
            message: result.error || 'The source edits are invalid.',
          },
        ],
      };
    return this._updateSource(
      proposed.text,
      { origin, expectedRevision },
      result.edits.length === 1 ? result.edits[0] : undefined,
    );
  }
  discardDraft() {
    if (this.isValid) return false;
    const text = this.validSource;
    return this.updateSource(text, { origin: 'discard' }).valid;
  }
  serialize({ draft = false } = {}) {
    return draft ? this.source : this.validSource;
  }
  sourceAtNode(id) {
    const span = this.index?.byId.get(id);
    if (!span) return null;
    const { children, ...copy } = span;
    return copy;
  }
  nodeAtOffset(offset) {
    if (!Number.isFinite(offset)) return null;
    let best;
    for (const span of this.index?.spans || [])
      if (
        !span.synthetic &&
        span.start <= offset &&
        offset < span.end &&
        (!best || span.end - span.start < best.end - best.start)
      )
        best = span;
    return best
      ? find(this.store.document.root, best.nodeId) ||
          nodes(this.store.document).find((n) => n.id === best.nodeId) ||
          null
      : null;
  }
  undo() {
    this.origin = 'undo';
    this.store.undo();
  }
  redo() {
    this.origin = 'redo';
    this.store.redo();
  }
  /** Restore sessions after solution snapshot swaps, without creating history. */
  refresh({ emit = true } = {}) {
    const doc = this.store.document;
    let saved = doc.metadata?.source,
      source = saved?.validText;
    let parsed;
    if (
      this._pendingParsed &&
      this._pendingParsed.source === source &&
      this._pendingParsed.document === doc
    ) {
      parsed = this._pendingParsed;
      this._pendingParsed = null;
    }
    if (parsed?.mode?.startsWith('incremental')) {
      updateSourceIndex(this.index, parsed.edit, {
        nodeId: parsed.nodeId,
        attributeName: parsed.attributeName,
      });
      this._lastShape = documentShape(doc);
      this._lastRoot = doc.root;
      this.buffer.applyEdits([parsed.edit]);
      if (emit) this._emit();
      return this;
    }
    if (this.buffer) this.buffer.replace(this.source);
    if (
      !parsed &&
      this.index?.source === source &&
      this._lastRoot === doc.root &&
      this._lastShape === documentShape(doc)
    ) {
      if (emit) this._emit();
      return this;
    }
    if (!parsed && typeof source === 'string') {
      try {
        parsed = this._parse(source);
        if (documentShape(parsed.doc) !== documentShape(doc)) parsed = null;
      } catch {
        parsed = null;
      }
    }
    if (!parsed) {
      source = this.adapter.serialize(doc);
      parsed = this._parse(source);
      this._record(doc, source, source);
      saved = doc.metadata.source;
    }
    reconcileDocumentIds(doc, parsed.doc);
    this.index = buildSourceIndex(source, parsed.doc, parsed.syntax);
    this._lastShape = documentShape(doc);
    this._lastRoot = doc.root;
    this._modelNodes = new Map(nodes(doc).map((n) => [n.id, n]));
    if (!this.buffer) this.buffer = new SourceTextBuffer(this.source);
    else this.buffer.replace(this.source);
    if (!saved) this._record(doc, source, source);
    if (emit) this._emit();
    return this;
  }
  dispose() {
    this._removeHook?.();
    this.store.removeEventListener('change', this._onStoreChange);
  }
}
