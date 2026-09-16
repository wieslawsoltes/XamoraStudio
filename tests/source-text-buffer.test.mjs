import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceTextBuffer, computeSourceEdit } from '../dist/core/source-text-buffer.js';

function lines(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r' && text[i + 1] === '\n') {
      starts.push(i + 2);
      i++;
    } else if (text[i] === '\r' || text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}
function assertIndex(buffer) {
  const expected = lines(buffer.text);
  assert.deepEqual(buffer.lineStarts, expected);
  assert.equal(buffer.lineCount, expected.length);
  for (let offset = 0; offset <= buffer.length; offset++) {
    let line = 0;
    while (line + 1 < expected.length && expected[line + 1] <= offset) line++;
    assert.deepEqual(buffer.positionAt(offset), {
      line: line + 1,
      column: offset - expected[line] + 1,
    });
    assert.equal(buffer.offsetAt(buffer.positionAt(offset)), offset);
  }
}

test('UTF-16 snapshots preserve BOM, CRLF, lone CR, LF and surrogate pairs exactly', () => {
  const text = '\uFEFF<Grid>😀\r\nabc\rdef\n</Grid>\r\n';
  const buffer = new SourceTextBuffer(text, { version: 7 });
  assert.equal(buffer.text, text);
  assert.equal(buffer.version, 7);
  assert.equal(buffer.length, text.length);
  assertIndex(buffer);
  assert.equal(buffer.stats.fullResets, 1);
});

test('unsorted original-snapshot edits apply atomically and report the combined range', () => {
  const buffer = new SourceTextBuffer('abc\r\ndef\nghi');
  const result = buffer.applyEdits(
    [
      { start: 9, end: 12, text: 'z' },
      { start: 1, end: 2, text: 'XY' },
    ],
    { expectedVersion: 0 },
  );
  assert.equal(buffer.text, 'aXYc\r\ndef\nz');
  assert.equal(result.accepted, true);
  assert.equal(result.version, 1);
  assert.deepEqual(result.changedRange, { start: 1, oldEnd: 12, newEnd: 11 });
  assert.deepEqual(
    result.edits.map((edit) => edit.start),
    [1, 9],
  );
  assertIndex(buffer);
});

test('stale, malformed and overlapping batches leave text, index, version and counters unchanged', () => {
  const buffer = new SourceTextBuffer('abc\r\ndef');
  const original = {
    text: buffer.text,
    starts: buffer.lineStarts,
    stats: buffer.stats,
    version: buffer.version,
  };
  const invalid = [
    null,
    [{ start: -1, end: 0, text: '' }],
    [{ start: 2, end: 1, text: '' }],
    [{ start: 0, end: 99, text: '' }],
    [{ start: 0.5, end: 1, text: '' }],
    [{ start: 0, end: 1, text: null }],
    [
      { start: 0, end: 3, text: '' },
      { start: 2, end: 4, text: '' },
    ],
    [
      { start: 1, end: 1, text: 'a' },
      { start: 1, end: 1, text: 'b' },
    ],
  ];
  for (const edits of invalid) assert.equal(buffer.applyEdits(edits).accepted, false);
  assert.equal(
    buffer.applyEdits([{ start: 0, end: 1, text: 'z' }], { expectedVersion: 1 }).reason,
    'version-conflict',
  );
  assert.equal(buffer.replace('xyz', { expectedVersion: 2 }).accepted, false);
  assert.equal(buffer.replace(null).accepted, false);
  assert.deepEqual(
    { text: buffer.text, starts: buffer.lineStarts, stats: buffer.stats, version: buffer.version },
    original,
  );
});

test('line index handles CRLF creation and destruction at every edit boundary', () => {
  const cases = [
    ['a\r\nb', 2, 2, 'X'],
    ['a\rb', 2, 2, '\n'],
    ['a\nb', 1, 1, '\r'],
    ['a\rX\nb', 2, 3, ''],
    ['a\r\nb', 1, 2, ''],
    ['a\r\nb', 2, 3, ''],
    ['', 0, 0, '\r\n'],
    ['a\r', 2, 2, '\n'],
    ['\r\n', 0, 2, ''],
    ['abc', 0, 3, '\r\n\r\n'],
    ['a\r\nb\r\nc', 2, 5, '\n\r'],
  ];
  for (const [text, start, end, inserted] of cases) {
    const buffer = new SourceTextBuffer(text);
    assert.equal(buffer.applyEdits([{ start, end, text: inserted }]).accepted, true);
    assert.equal(buffer.text, text.slice(0, start) + inserted + text.slice(end));
    assertIndex(buffer);
  }
});

test('complete-source replacement finds a minimal edit and no-ops retain their version', () => {
  assert.deepEqual(computeSourceEdit('abcXYZdef', 'abc12def'), { start: 3, end: 6, text: '12' });
  assert.equal(computeSourceEdit('same', 'same'), null);
  assert.deepEqual(computeSourceEdit('', 'x'), { start: 0, end: 0, text: 'x' });
  assert.deepEqual(computeSourceEdit('x', ''), { start: 0, end: 1, text: '' });
  const buffer = new SourceTextBuffer('abc\r\ndef');
  const result = buffer.replace('abc\r\nDdef');
  assert.deepEqual(result.edits, [{ start: 5, end: 5, text: 'D' }]);
  const stats = buffer.stats;
  assert.equal(buffer.replace(buffer.text).changed, false);
  assert.equal(buffer.applyEdits([{ start: 0, end: 3, text: 'abc' }]).changed, false);
  assert.equal(buffer.version, 1);
  assert.deepEqual(buffer.stats, stats);
  assertIndex(buffer);
});

test('local edits scan only inserted text and boundaries even on a very long line', () => {
  const text = 'a'.repeat(100_000) + '\r\n' + 'b\n'.repeat(10_000);
  const buffer = new SourceTextBuffer(text);
  const before = buffer.stats;
  buffer.applyEdits([{ start: 50_000, end: 50_001, text: '😀\r\nz' }]);
  assert.equal(buffer.stats.charsScanned - before.charsScanned, 7);
  assert.equal(buffer.stats.fullResets, before.fullResets);
  assert.equal(buffer.stats.updates, 1);
  assert.ok(buffer.stats.offsetsShifted > 9_000);
  assert.deepEqual(buffer.lineStarts, lines(buffer.text));
  const next = buffer.stats;
  buffer.replace(buffer.text.replace('😀', '😃'));
  assert.ok(buffer.stats.charsScanned - next.charsScanned <= 4);
  assert.ok(buffer.stats.diffCharsCompared > 100_000);
});

test('snapshots and exposed indexes are independent, and positions clamp consistently', () => {
  const buffer = new SourceTextBuffer('ab\r\nc\n', { version: 4 });
  const fork = buffer.fork();
  assert.deepEqual(fork.stats, buffer.stats);
  fork.applyEdits([{ start: 0, end: 2, text: '\nX' }]);
  assert.equal(buffer.text, 'ab\r\nc\n');
  assert.equal(buffer.version, 4);
  assert.equal(fork.version, 5);
  buffer.lineStarts.push(999);
  buffer.stats.fullResets = 999;
  assert.equal(buffer.stats.fullResets, 1);
  assert.equal(buffer.offsetAt({ line: 0, column: 0 }), 0);
  assert.equal(buffer.offsetAt({ line: 999, column: 999 }), buffer.length);
  assert.equal(buffer.offsetAt({ line: 1, column: 999 }), 3);
  assert.deepEqual(buffer.positionAt(-99), { line: 1, column: 1 });
  assert.deepEqual(buffer.positionAt(Infinity), { line: 3, column: 1 });
  assertIndex(buffer);
  assertIndex(fork);
});

test('deterministic random batches match full text and line rescans after every transaction', () => {
  let seed = 0xa57c0de;
  const random = (max) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  };
  const alphabet = ['a', 'Z', '\r', '\n', '😀', '\uFEFF', '<', '>'];
  const fragment = () =>
    Array.from({ length: random(7) }, () => alphabet[random(alphabet.length)]).join('');
  let text = '\uFEFF<Grid>😀\r\nabc\rdef\n</Grid>';
  const buffer = new SourceTextBuffer(text);
  for (let iteration = 0; iteration < 600; iteration++) {
    const candidates = Array.from({ length: 1 + random(4) }, () => {
      const start = random(text.length + 1);
      return { start, end: start + random(text.length - start + 1), text: fragment() };
    }).sort((a, b) => a.start - b.start || a.end - b.end);
    const edits = candidates.filter(
      (edit, index, all) =>
        index === 0 ||
        edit.start > Math.max(...all.slice(0, index).map((previous) => previous.end)),
    );
    for (const edit of edits.toReversed())
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    const result = buffer.applyEdits(edits.toReversed(), { expectedVersion: buffer.version });
    assert.equal(result.accepted, true);
    assert.equal(buffer.text, text, `transaction ${iteration}`);
    assertIndex(buffer);
  }
});
