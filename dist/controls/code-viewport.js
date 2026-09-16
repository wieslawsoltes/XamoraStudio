/** DOM-free line and token indexes used by the virtualized editing surface. */
export class EditorLineIndex {
  constructor(source = '') {
    if (typeof source !== 'string') throw new TypeError('Editor source must be a string.');
    this.source = source;
    const starts = [0];
    for (let at = source.indexOf('\n'); at >= 0; at = source.indexOf('\n', at + 1))
      starts.push(at + 1);
    this.starts = Uint32Array.from(starts);
  }
  get length() {
    return this.starts.length;
  }
  lineAt(offset) {
    offset = Math.max(
      0,
      Math.min(this.source.length, Number.isFinite(offset) ? Math.floor(offset) : 0),
    );
    let lo = 0,
      hi = this.starts.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  offsetAt(line) {
    return this.starts[Math.max(0, Math.floor(line))] ?? this.source.length;
  }
  visibleRange(scrollTop, height, lineHeight, overscan = 8) {
    if (!Number.isFinite(lineHeight) || lineHeight <= 0)
      throw new RangeError('Line height must be positive.');
    if (!Number.isInteger(overscan) || overscan < 0 || overscan > 200)
      throw new RangeError('Overscan must be 0–200 lines.');
    const top = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
    const count = Math.max(
      1,
      Math.ceil((Number.isFinite(height) ? Math.max(0, height) : 0) / lineHeight),
    );
    const first = Math.min(this.length - 1, Math.floor(top / lineHeight));
    const startLine = Math.max(0, first - overscan),
      endLine = Math.min(this.length, first + count + overscan + 1);
    return { startLine, endLine, start: this.offsetAt(startLine), end: this.offsetAt(endLine) };
  }
}
const kinds = new Set(['comment', 'string', 'tag', 'attr', 'keyword', 'number']);
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function indexEditorTokens(source, provider = {}) {
  let tokens;
  try {
    tokens = provider.tokenize?.(source);
  } catch {
    return null;
  }
  if (!Array.isArray(tokens)) return null;
  const result = [];
  let at = 0;
  for (const token of tokens) {
    if (!token || typeof token.text !== 'string' || !source.startsWith(token.text, at)) return null;
    const end = at + token.text.length;
    if (end > source.length) return null;
    if (end !== at)
      result.push({ start: at, end, kind: kinds.has(token.kind) ? token.kind : undefined });
    at = end;
  }
  return at === source.length ? result : null;
}
export function renderEditorTokens(source, tokens, start = 0, end = source.length) {
  if (!tokens) return escape(source.slice(start, end));
  let lo = 0,
    hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tokens[mid].end <= start) lo = mid + 1;
    else hi = mid;
  }
  const output = [];
  for (let i = lo; i < tokens.length && tokens[i].start < end; i++) {
    const token = tokens[i],
      text = escape(source.slice(Math.max(start, token.start), Math.min(end, token.end)));
    output.push(kinds.has(token.kind) ? `<span class="syntax-${token.kind}">${text}</span>` : text);
  }
  return output.join('');
}
export function editorVirtualization(value = {}) {
  if (value === false) return { threshold: Infinity, overscan: 8 };
  if (value === true) return { threshold: 0, overscan: 8 };
  if (!value || typeof value !== 'object')
    throw new TypeError('Virtualization must be a boolean or options object.');
  const { threshold = 1000, overscan = 8 } = value;
  if (!Number.isInteger(threshold) || threshold < 0)
    throw new RangeError('Virtualization threshold must be a non-negative integer.');
  if (!Number.isInteger(overscan) || overscan < 0 || overscan > 200)
    throw new RangeError('Overscan must be 0–200 lines.');
  return { threshold, overscan };
}
