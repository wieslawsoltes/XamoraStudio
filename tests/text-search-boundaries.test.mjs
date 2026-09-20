import test from 'node:test';
import assert from 'node:assert/strict';
import { TextSearchIndex } from '../dist/controls/text-search.js';

test('whole-word boundary checks reject repeated long literal candidates without losing later matches', () => {
  const query = 'a'.repeat(3000);
  const prefix = 'a'.repeat(300000);
  const source = prefix + ' ' + query + ' ' + query;
  const search = new TextSearchIndex(source, query, { wholeWord: true });
  assert.deepEqual(search.matches, [
    { start: prefix.length + 1, end: prefix.length + 1 + query.length },
    { start: prefix.length + 2 + query.length, end: source.length },
  ]);
  assert.equal(search.replacement('X').text, prefix + ' X X');
});
