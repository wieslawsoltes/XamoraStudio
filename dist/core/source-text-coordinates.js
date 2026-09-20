import { computeSourceEdit } from './source-text-buffer.js';

/** Immutable mapping between authored UTF-16 source and a textarea's LF-normalized value. */
export class SourceTextCoordinates {
  #sourceBreaks = [];
  #editorBreaks = [];
  constructor(source) {
    if (typeof source !== 'string') throw new TypeError('Source text must be a string.');
    this.source = source;
    this.editorText = source.replace(/\r\n?/g, '\n');
    this.newline = source.match(/\r\n?|\n/)?.[0] || '\n';
    for (let i = 1; i < source.length; i++)
      if (source[i] === '\n' && source[i - 1] === '\r') {
        this.#editorBreaks.push(i - this.#sourceBreaks.length);
        this.#sourceBreaks.push(i);
      }
    Object.freeze(this);
  }
  toSource(offset) {
    valid(offset, this.editorText.length);
    return offset + count(this.#editorBreaks, offset, true);
  }
  toEditor(offset) {
    valid(offset, this.source.length);
    return offset - count(this.#sourceBreaks, offset, false);
  }
  /** Preserve untouched source bytes; newly inserted lines use the document's first newline style. */
  fromEditor(text) {
    if (typeof text !== 'string') throw new TypeError('Editor text must be a string.');
    const next = text.replace(/\r\n?/g, '\n');
    const edit = computeSourceEdit(this.editorText, next);
    if (!edit) return this.source;
    return (
      this.source.slice(0, this.toSource(edit.start)) +
      edit.text.replace(/\n/g, this.newline) +
      this.source.slice(this.toSource(edit.end))
    );
  }
}
function valid(offset, length) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > length)
    throw new RangeError('Offset must be a UTF-16 position within this snapshot.');
}
function count(values, offset, inclusive) {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < offset || (inclusive && values[mid] === offset)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
