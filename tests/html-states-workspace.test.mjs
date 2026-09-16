import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlStateStyleChanges } from '../dist/studio/html-states-workspace.js';

test('state recording collects changed CSS while leaving animation and transition configuration alone', () => {
  const before = new Map([
    ['opacity', '1'],
    ['color', 'red'],
    ['animation-duration', '1s'],
    ['transition', 'all 1s'],
  ]);
  const after = new Map([
    ['opacity', '.4'],
    ['color', 'red'],
    ['animation-duration', '2s'],
    ['transition', 'all 2s'],
  ]);
  assert.deepEqual(
    htmlStateStyleChanges(before, after, () => ''),
    { opacity: '.4' },
  );
});
test('state recording resolves removed CSS without losing an important value', () => {
  const before = new Map([
    ['opacity', '1 !important'],
    ['color', 'red'],
  ]);
  const after = new Map([['color', 'blue !important']]);
  assert.deepEqual(
    htmlStateStyleChanges(before, after, (key) => (key === 'opacity' ? '.8' : '')),
    { opacity: '.8', color: 'blue !important' },
  );
});
test('state recording rejects unresolved removal and ignores unchanged CSS', () => {
  assert.deepEqual(
    htmlStateStyleChanges(new Map([['color', 'red']]), new Map([['color', 'red']]), () => ''),
    {},
  );
  assert.throws(
    () => htmlStateStyleChanges(new Map([['--theme', 'dark']]), new Map(), () => ''),
    /Cannot resolve/,
  );
});
