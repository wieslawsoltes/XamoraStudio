import test from 'node:test';
import assert from 'node:assert/strict';
import { TextSearchIndex, applyEditorTextEdits } from '../dist/controls/text-search.js';

test('search treats regex-like queries and replacement dollar syntax literally', () => {
  const s = new TextSearchIndex('a+b.* a+b.* [x]', 'a+b.*');
  assert.deepEqual(s.matches, [
    { start: 0, end: 5 },
    { start: 6, end: 11 },
  ]);
  assert.equal(s.replacement('$&$1').text, '$&$1 $&$1 [x]');
  assert.equal(new TextSearchIndex('aaa', 'aa').matches.length, 1);
});
test('case folding preserves original Unicode UTF-16 positions', () => {
  const source = 'İ😀 K K ſ S A a';
  for (const [query, expected] of [
    ['k', ['K', 'K']],
    ['s', ['ſ', 'S']],
    ['a', ['A', 'a']],
  ]) {
    const search = new TextSearchIndex(source, query);
    assert.deepEqual(
      search.matches.map(({ start, end }) => source.slice(start, end)),
      expected,
    );
  }
  assert.equal(new TextSearchIndex(source, 'İ', { matchCase: true }).matches[0].start, 0);
  assert.equal(new TextSearchIndex(source, 'a', { matchCase: true }).matches.length, 1);
});
test('whole word recognizes non-ASCII letters, marks, numbers and connector punctuation', () => {
  const s = new TextSearchIndex('cat cat2 cat_ 猫cat caté cat\u0301 cat-cat', 'cat', {
    wholeWord: true,
  });
  assert.deepEqual(
    s.matches.map((m) => m.start),
    [0, 29, 33],
  );
});
test('range containment uses full-source word boundaries, not artificially sliced words', () => {
  assert.equal(
    new TextSearchIndex('scatter cat!', 'cat', { range: { start: 1, end: 4 }, wholeWord: true })
      .matches.length,
    0,
  );
  const search = new TextSearchIndex('a cat cat z', 'cat', { range: { start: 2, end: 7 } });
  assert.deepEqual(search.matches, [{ start: 2, end: 5 }]);
  assert.equal(search.replacement('dog').text, 'a dog cat z');
});
test('next/previous honor current occurrence, caret positions and wrapping', () => {
  const s = new TextSearchIndex('xx xx xx', 'xx');
  assert.deepEqual(s.next(0), { start: 0, end: 2, index: 0, wrapped: false });
  assert.deepEqual(s.next(0, 2), { start: 3, end: 5, index: 1, wrapped: false });
  assert.deepEqual(s.next(6, 8), { start: 0, end: 2, index: 0, wrapped: true });
  assert.deepEqual(s.next(0, 2, true), { start: 6, end: 8, index: 2, wrapped: true });
  assert.deepEqual(s.next(6, 6, true), { start: 3, end: 5, index: 1, wrapped: false });
});
test('empty/no-match searches never invent zero-width replacement sites', () => {
  for (const query of ['', 'not found']) {
    const s = new TextSearchIndex('unchanged', query);
    assert.equal(s.next(0), null);
    assert.equal(s.selected(0), -1);
    assert.equal(s.replacement('x').text, 'unchanged');
    assert.equal(s.replacement('x').count, 0);
  }
});
test('match cap is explicit, exact at the boundary, and replace all fails closed', () => {
  const truncated = new TextSearchIndex('a a a', 'a', { maxMatches: 2 });
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.matches.length, 2);
  assert.throws(() => truncated.replacement('b'), /Narrow/);
  assert.equal(truncated.replacement('b', 1).text, 'a b a');
  assert.equal(new TextSearchIndex('a a', 'a', { maxMatches: 2 }).truncated, false);
});
test('snapshots, ranges and match records are immutable', () => {
  const range = { start: 0, end: 3 };
  const s = new TextSearchIndex('aaa', 'a', { range });
  range.end = 0;
  assert.equal(s.matches.length, 3);
  assert.throws(() => {
    s.matches[0].end = 42;
  }, TypeError);
  assert.throws(() => {
    s.matches.push({});
  }, TypeError);
  assert.throws(() => {
    s.source = 'x';
  }, TypeError);
});
test('replacement batches preserve untouched intervals and do not recursively replace inserted text', () => {
  const s = new TextSearchIndex('x\r\ny\nx\rz', 'x');
  assert.equal(s.replacement('xx').text, 'xx\r\ny\nxx\rz');
  assert.equal(s.replacement('').text, '\r\ny\n\rz');
});
test('invalid ranges and edit batches fail without mutating input', () => {
  for (const range of [
    { start: -1, end: 2 },
    { start: 2, end: 1 },
    { start: 0, end: 4 },
    { start: 0.2, end: 1 },
  ])
    assert.throws(() => new TextSearchIndex('abc', 'a', { range }));
  for (const edits of [
    [{ start: 2, end: 1, text: 'x' }],
    [
      { start: 2, end: 3, text: 'x' },
      { start: 0, end: 1, text: 'y' },
    ],
    [
      { start: 0, end: 2, text: 'x' },
      { start: 1, end: 3, text: 'y' },
    ],
  ])
    assert.throws(() => applyEditorTextEdits('abc', edits), /ordered/);
  assert.throws(() => new TextSearchIndex('abc', 'a', { maxMatches: 0 }));
  assert.throws(() => new TextSearchIndex('abc', 'a').replacement('x', 20));
  assert.throws(() => new TextSearchIndex('a', 'a').next(NaN));
});
test('large match sets keep bounded storage and refuse over-limit expansion before allocation', () => {
  const s = new TextSearchIndex('a'.repeat(100000), 'a');
  assert.equal(s.matches.length, 20000);
  assert.equal(s.truncated, true);
  assert.throws(
    () => new TextSearchIndex('aaa', 'a').replacement('x'.repeat(3000000)),
    /size limit/,
  );
});
test('multiline literal search and astral characters return correct ranges', () => {
  const s = new TextSearchIndex('😀\nX 😀\nX', '😀\nX');
  assert.deepEqual(s.matches, [
    { start: 0, end: 4 },
    { start: 5, end: 9 },
  ]);
  assert.equal(s.replacement('Y').text, 'Y Y');
});
