/**
 * Versioned UTF-16 source text with an incrementally maintained line index.
 * Text is an immutable JavaScript string, not a rope: replacement copies text
 * and shifts following line offsets, but only changed text and its immediate
 * boundaries are rescanned for line endings. CR, LF and CRLF are preserved.
 */
export class SourceTextBuffer {
  #text;
  #version;
  #lines;
  #stats;

  constructor(text = '', { version = 0 } = {}) {
    if (typeof text !== 'string') throw new TypeError('Source text must be a string.');
    if (!Number.isSafeInteger(version) || version < 0)
      throw new TypeError('Version must be a nonnegative safe integer.');
    this.#text = text;
    this.#version = version;
    this.#lines = [0];
    this.#stats = {
      charsScanned: 0,
      updates: 0,
      fullResets: 1,
      diffCharsCompared: 0,
      offsetsShifted: 0,
    };
    this.#scan(text, 0, text.length, this.#lines);
  }

  get text() {
    return this.#text;
  }
  get version() {
    return this.#version;
  }
  get length() {
    return this.#text.length;
  }
  get lineCount() {
    return this.#lines.length;
  }
  get lineStarts() {
    return [...this.#lines];
  }
  get stats() {
    return { ...this.#stats };
  }

  /** Return an independent snapshot without rescanning the source. */
  fork() {
    const fork = new SourceTextBuffer();
    fork.#text = this.#text;
    fork.#version = this.#version;
    fork.#lines = [...this.#lines];
    fork.#stats = { ...this.#stats };
    return fork;
  }

  /** Offsets and columns count UTF-16 code units, including newline characters. */
  positionAt(offset) {
    const at = clampInteger(offset, 0, this.length);
    const line = upperBound(this.#lines, at) - 1;
    return { line: line + 1, column: at - this.#lines[line] + 1 };
  }

  /** Clamp columns to the last offset belonging to the requested line. */
  offsetAt({ line = 1, column = 1 } = {}) {
    const index = clampInteger(line, 1, this.lineCount) - 1;
    const start = this.#lines[index];
    const end = index + 1 < this.lineCount ? this.#lines[index + 1] - 1 : this.length;
    return start + clampInteger(column, 1, end - start + 1) - 1;
  }

  /**
   * Apply nonoverlapping edits atomically against the original snapshot.
   * Input order does not matter. Identical start offsets are ambiguous and are
   * rejected, including multiple insertions at the same point.
   */
  applyEdits(edits, { expectedVersion } = {}) {
    const conflict = this.#checkVersion(expectedVersion);
    if (conflict) return conflict;
    if (!Array.isArray(edits)) return this.#reject('invalid-edit', 'Edits must be an array.');
    const ordered = [];
    for (const edit of edits) {
      if (
        !edit ||
        !Number.isSafeInteger(edit.start) ||
        !Number.isSafeInteger(edit.end) ||
        edit.start < 0 ||
        edit.end < edit.start ||
        edit.end > this.length ||
        typeof edit.text !== 'string'
      ) {
        return this.#reject(
          'invalid-edit',
          'Each edit requires valid UTF-16 start/end offsets and string text.',
        );
      }
      ordered.push({ start: edit.start, end: edit.end, text: edit.text });
    }
    ordered.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].start < ordered[i - 1].end || ordered[i].start === ordered[i - 1].start) {
        return this.#reject(
          'overlapping-edits',
          'Edit ranges overlap or share an ambiguous start offset.',
        );
      }
    }
    const effective = ordered.filter(
      (edit) => this.#text.slice(edit.start, edit.end) !== edit.text,
    );
    if (!effective.length)
      return {
        accepted: true,
        changed: false,
        version: this.version,
        edits: [],
        changedRange: null,
      };
    if (this.version === Number.MAX_SAFE_INTEGER)
      return this.#reject('version-exhausted', 'Source version cannot be incremented safely.');

    const oldText = this.#text;
    const pieces = [];
    const groups = [];
    let cursor = 0;
    for (const edit of effective) {
      pieces.push(oldText.slice(cursor, edit.start), edit.text);
      cursor = edit.end;
      // Newline classification depends on the following character. Include
      // one unchanged character on either side to handle CR/LF joins/splits.
      const lo = Math.max(0, edit.start - 1);
      const hi = Math.min(oldText.length, edit.end + 1);
      const delta = edit.text.length - (edit.end - edit.start);
      const group = groups.at(-1);
      if (group && lo <= group.hi) {
        group.hi = Math.max(group.hi, hi);
        group.delta += delta;
      } else groups.push({ lo, hi, delta });
    }
    pieces.push(oldText.slice(cursor));
    const nextText = pieces.join('');
    const nextLines = [0];
    let oldLine = 1;
    let shift = 0;
    for (const group of groups) {
      while (oldLine < this.#lines.length && this.#lines[oldLine] <= group.lo) {
        nextLines.push(this.#lines[oldLine++] + shift);
        if (shift) this.#stats.offsetsShifted++;
      }
      while (oldLine < this.#lines.length && this.#lines[oldLine] <= group.hi) oldLine++;
      this.#scan(nextText, group.lo + shift, group.hi + shift + group.delta, nextLines);
      shift += group.delta;
    }
    while (oldLine < this.#lines.length) {
      nextLines.push(this.#lines[oldLine++] + shift);
      if (shift) this.#stats.offsetsShifted++;
    }
    this.#text = nextText;
    this.#lines = nextLines;
    this.#version++;
    this.#stats.updates++;
    return {
      accepted: true,
      changed: true,
      version: this.version,
      edits: effective,
      changedRange: {
        start: effective[0].start,
        oldEnd: effective.at(-1).end,
        newEnd: effective.at(-1).end + shift,
      },
    };
  }

  /** Reduce a complete source snapshot to one common-prefix/suffix edit. */
  replace(text, { expectedVersion } = {}) {
    const conflict = this.#checkVersion(expectedVersion);
    if (conflict) return conflict;
    if (typeof text !== 'string')
      return this.#reject('invalid-edit', 'Source text must be a string.');
    const diff = sourceDiff(this.#text, text);
    const result = this.applyEdits(diff.edit ? [diff.edit] : [], { expectedVersion });
    if (result.accepted) this.#stats.diffCharsCompared += diff.compared;
    return result;
  }

  #scan(text, start, end, lines) {
    this.#stats.charsScanned += end - start;
    for (let i = start; i < end; i++) {
      const code = text.charCodeAt(i);
      if (code === 10 || (code === 13 && text.charCodeAt(i + 1) !== 10)) lines.push(i + 1);
    }
  }

  #checkVersion(expected) {
    if (expected !== undefined && (!Number.isSafeInteger(expected) || expected !== this.version)) {
      return this.#reject('version-conflict', 'The source changed since this edit was prepared.');
    }
    return null;
  }

  #reject(reason, error) {
    return {
      accepted: false,
      changed: false,
      version: this.version,
      edits: [],
      changedRange: null,
      reason,
      error,
    };
  }
}

/** Return the smallest single UTF-16 replacement, or null for identical text. */
export function computeSourceEdit(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string')
    throw new TypeError('Source snapshots must be strings.');
  return sourceDiff(before, after).edit;
}

function sourceDiff(before, after) {
  if (before === after) return { edit: null, compared: 0 };
  const limit = Math.min(before.length, after.length);
  let start = 0,
    compared = 0;
  while (start < limit) {
    compared++;
    if (before.charCodeAt(start) !== after.charCodeAt(start)) break;
    start++;
  }
  let oldEnd = before.length,
    newEnd = after.length;
  while (oldEnd > start && newEnd > start) {
    compared++;
    if (before.charCodeAt(oldEnd - 1) !== after.charCodeAt(newEnd - 1)) break;
    oldEnd--;
    newEnd--;
  }
  return { edit: { start, end: oldEnd, text: after.slice(start, newEnd) }, compared };
}

function upperBound(values, value) {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (Number.isNaN(number)) return min;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}
