/** Bounded, DOM-free literal search. Public positions are UTF-16 offsets in the supplied snapshot. */
const MAX_SOURCE = 8_000_000;
const MAX_MATCHES = 100_000;
const word = /[\p{L}\p{N}\p{M}\p{Pc}\u200c\u200d]/u;
function offset(value, length) {
  if (!Number.isSafeInteger(value) || value < 0 || value > length)
    throw new RangeError('Search range must use UTF-16 offsets within the source.');
}
function before(source, at) {
  if (!at) return '';
  const tail = source.charCodeAt(at - 1);
  const head = source.charCodeAt(at - 2);
  const pair = tail >= 0xdc00 && tail <= 0xdfff && head >= 0xd800 && head <= 0xdbff;
  return source.slice(pair ? at - 2 : at - 1, at);
}
function after(source, at) {
  return at === source.length ? '' : String.fromCodePoint(source.codePointAt(at));
}
/** Immutable nonoverlapping matches. Regex syntax and replacement substitutions are never executed. */
export class TextSearchIndex {
  constructor(
    source,
    query,
    { matchCase = false, wholeWord = false, range, maxMatches = 20000 } = {},
  ) {
    if (typeof source !== 'string' || source.length > MAX_SOURCE)
      throw new RangeError('Search supports source snapshots up to 8 million UTF-16 code units.');
    if (typeof query !== 'string' || query.length > 10000)
      throw new RangeError('Find text must be a string of at most 10000 UTF-16 code units.');
    if (!Number.isSafeInteger(maxMatches) || maxMatches < 1 || maxMatches > MAX_MATCHES)
      throw new RangeError('Match limit must be between 1 and 100000.');
    const start = range?.start ?? 0,
      end = range?.end ?? source.length;
    offset(start, source.length);
    offset(end, source.length);
    if (end < start) throw new RangeError('Search range ends before it starts.');
    const matches = [];
    let truncated = false;
    if (query) {
      // All metacharacters are escaped. /iu performs Unicode simple folding without
      // changing the source length (lowercasing the entire source would shift offsets).
      const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const expression = new RegExp(pattern, matchCase ? 'gu' : 'giu');
      expression.lastIndex = start;
      for (let match; (match = expression.exec(source)) && match.index + match[0].length <= end;) {
        const at = match.index,
          until = at + match[0].length;
        if (at < start) continue;
        if (wholeWord && (word.test(before(source, at)) || word.test(after(source, until)))) {
          // A rejected phrase may overlap the next valid occurrence ("xa a a", "a a").
          // Only accepted matches consume their full range; retry at the next code point.
          expression.lastIndex = at + after(source, at).length;
          continue;
        }
        if (matches.length === maxMatches) {
          truncated = true;
          break;
        }
        matches.push(Object.freeze({ start: at, end: until }));
      }
    }
    this.source = source;
    this.query = query;
    this.range = Object.freeze({ start, end });
    this.matches = Object.freeze(matches);
    this.truncated = truncated;
    Object.freeze(this);
  }
  /** Exact selected occurrence, or -1. */
  selected(start, end = start) {
    const at = this.lowerBound(start);
    return this.matches[at]?.start === start && this.matches[at].end === end ? at : -1;
  }
  lowerBound(at) {
    let lo = 0,
      hi = this.matches.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.matches[mid].start < at) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  /** Navigate relative to the current selection, wrapping within the bounded result set. */
  next(start, end = start, backwards = false) {
    offset(start, this.source.length);
    offset(end, this.source.length);
    if (end < start) throw new RangeError('Selection ends before it starts.');
    if (!this.matches.length) return null;
    const selected = this.selected(start, end);
    let at =
      selected >= 0
        ? selected + (backwards ? -1 : 1)
        : backwards
          ? this.lowerBound(start) - 1
          : this.lowerBound(end);
    const wrapped = at < 0 || at >= this.matches.length;
    at = (at + this.matches.length) % this.matches.length;
    return { ...this.matches[at], index: at, wrapped };
  }
  /** Omit index to replace all. Truncated searches never perform a partial Replace all. */
  replacement(value, index) {
    if (typeof value !== 'string') throw new TypeError('Replacement must be literal text.');
    if (index === undefined && this.truncated)
      throw new RangeError('Too many matches. Narrow the search before replacing all.');
    if (index !== undefined && (!Number.isSafeInteger(index) || !this.matches[index]))
      throw new RangeError('The selected search match no longer exists.');
    const matches = index === undefined ? this.matches : [this.matches[index]];
    const edits = matches.map(({ start, end }) => ({ start, end, text: value }));
    return { text: applyEditorTextEdits(this.source, edits), edits, count: matches.length };
  }
}
/** Validate a whole edit batch before constructing its result. No mutation or partial application. */
export function applyEditorTextEdits(source, edits) {
  if (typeof source !== 'string' || !Array.isArray(edits) || edits.length > MAX_MATCHES)
    throw new TypeError('Expected a source snapshot and a bounded edit array.');
  let cursor = 0,
    length = source.length;
  for (const edit of edits) {
    if (!edit || typeof edit.text !== 'string')
      throw new TypeError('Each edit needs literal text.');
    offset(edit.start, source.length);
    offset(edit.end, source.length);
    if (edit.start < cursor || edit.end < edit.start)
      throw new RangeError('Source edits must be ordered and nonoverlapping.');
    cursor = edit.end;
    length += edit.text.length - (edit.end - edit.start);
  }
  if (length > MAX_SOURCE)
    throw new RangeError('Replacement result exceeds the editor size limit.');
  const parts = [];
  cursor = 0;
  for (const edit of edits) {
    parts.push(source.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
}
