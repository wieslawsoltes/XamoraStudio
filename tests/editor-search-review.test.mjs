import test from 'node:test';
import assert from 'node:assert/strict';
import { TextSearchIndex } from '../dist/controls/text-search.js';
import { CodeEditor } from '../dist/controls/code-editor.js';
import { DocumentStore } from '../dist/core/model.js';
import { DocumentSession } from '../dist/core/document-session.js';
import { parseXaml } from '../dist/core/xaml.js';
import { DocumentSync } from '../dist/studio/document-sync.js';
import { controlDOM } from './control-fixture.mjs';

for (const [source, query, start] of [
  ['xa a a', 'a a', 3],
  ['xA a A', 'a a', 3],
  ['x😀 😀 😀', '😀 😀', 4],
])
  test(`whole-word search retries after rejected overlaps: ${source}`, () => {
    const search = new TextSearchIndex(source, query, { wholeWord: true });
    assert.deepEqual(search.matches, [{ start, end: source.length }]);
    assert.equal(search.replacement('done').text, source.slice(0, start) + 'done');
  });

test('accepted whole-word phrase matches remain nonoverlapping and respect the result cap', () => {
  const search = new TextSearchIndex('a a a a a', 'a a', { wholeWord: true, maxMatches: 1 });
  assert.deepEqual(search.matches, [{ start: 0, end: 3 }]);
  assert.equal(search.truncated, true);
  assert.throws(() => search.replacement('X'), /Too many matches/);
  assert.deepEqual(
    new TextSearchIndex('xa a a', 'a a', {
      wholeWord: true,
      range: { start: 0, end: 4 },
    }).matches,
    [],
  );
});

test('unpaired UTF-16 surrogates are not mistaken for the neighboring letter at a word boundary', () => {
  assert.deepEqual(new TextSearchIndex('a\udc00cat', 'cat', { wholeWord: true }).matches, [
    { start: 2, end: 5 },
  ]);
  assert.equal(new TextSearchIndex('𐐀cat', 'cat', { wholeWord: true }).matches.length, 0);
  assert.equal(new TextSearchIndex('😀cat', 'cat', { wholeWord: true }).matches.length, 1);
});

function editorFixture(t) {
  const dom = controlDOM(t);
  const editor = new CodeEditor(dom.host());
  editor.setValue('one one one');
  editor.input.setSelectionRange(4, 7);
  editor.find({ seed: false, replace: true });
  const search = editor.search;
  search.query.value = 'one';
  search.replacement.value = 'two';
  search.host.querySelector('[data-find="selection"]').click();
  search.refresh();
  t.after(() => editor.dispose());
  return { editor, search };
}

for (const throws of [false, true])
  test(`a failed host edit clears obsolete search scope after an external source change, throws=${throws}`, (t) => {
    const { editor, search } = editorFixture(t);
    editor.onTextEdits = () => {
      editor.setValue('one unrelated one', { force: true });
      if (throws) throw Error('Another operation changed the document');
      return false;
    };
    assert.equal(search.replace(true), false);
    assert.equal(editor.getValue(), 'one unrelated one');
    assert.equal(search.scope, null);
    assert.equal(search.candidate, null);
    assert.equal(search.model.matches.length, 2);
    assert.equal(editor.highlight.querySelectorAll('mark').length, 2);
  });

test('a rejected host edit with unchanged source retains its captured range', (t) => {
  const { editor, search } = editorFixture(t);
  editor.onTextEdits = () => false;
  assert.equal(search.replace(true), false);
  assert.deepEqual(search.scope, { start: 4, end: 7 });
  assert.equal(editor.getValue(), 'one one one');
});

function documentFixture(t) {
  const { host } = controlDOM(t);
  const source =
    '\uFEFF<Grid>\r\n<Button Content="Old"/>\n<!-- Keep -->\r<Button Content="Old"/>\r\n</Grid>';
  const store = new DocumentStore(parseXaml(source));
  store.session = new DocumentSession(store, { source });
  const session = store.session;
  const editor = new CodeEditor(host());
  const s = {
    store,
    editor,
    get doc() {
      return this.store.document;
    },
  };
  const sync = Object.create(DocumentSync.prototype);
  sync.s = s;
  sync.status = () => {};
  editor.onTextEdits = (edits, before) => sync.applyEditorEdits(edits, before);
  sync.updateEditor();
  t.after(() => {
    editor.dispose();
    session.dispose();
  });
  const replace = () => {
    editor.find({ seed: false, replace: true });
    editor.search.query.value = 'Old';
    editor.search.replacement.value = 'New';
    editor.search.refresh();
    return editor.search.replace(true);
  };
  return { s, sync, source, store, session, editor, replace };
}

for (const owner of ['direct', 'html'])
  test(`replacement rechecks source and revision after ${owner} gesture cleanup`, (t) => {
    const { s, sync, source, store, session, replace } = documentFixture(t);
    s[owner] = {
      cancelGesture() {
        session.updateSource(source.replace('Keep', 'Changed by another operation'));
        sync.updateEditor();
      },
    };
    assert.equal(replace(), false);
    assert.equal(session.source, source.replace('Keep', 'Changed by another operation'));
    assert.equal(store.history.length, 1, 'Only the independent operation has history');
  });

test('gesture cleanup that switches documents never writes into the previous source session', (t) => {
  const { s, source, store, session, sync, replace } = documentFixture(t);
  const other = new DocumentStore(parseXaml(source));
  other.session = new DocumentSession(other, { source });
  t.after(() => other.session.dispose());
  let laterCleanup = 0;
  s.direct = {
    cancelGesture() {
      s.store = other;
      sync.updateEditor();
    },
  };
  s.html = {
    cancelGesture() {
      laterCleanup++;
    },
  };
  assert.equal(replace(), false);
  assert.equal(session.source, source);
  assert.equal(other.session.source, source);
  assert.equal(store.history.length, 0);
  assert.equal(other.history.length, 0);
  assert.equal(laterCleanup, 0, 'Do not run subsequent callbacks in a changed document');
});

for (const property of ['readOnly', 'disabled', 'composing'])
  test(`gesture cleanup cannot bypass editor ${property} protection`, (t) => {
    const { s, editor, session, source, store, replace } = documentFixture(t);
    s.direct = {
      cancelGesture() {
        (property === 'composing' ? editor : editor.input)[property] = true;
      },
    };
    assert.equal(replace(), false);
    assert.equal(session.source, source);
    assert.equal(store.history.length, 0);
  });

test('whole-word literal results agree with a code-point oracle for 600 deterministic cases', () => {
  const alphabet = ['a', 'b', ' ', '_', '.', 'é', '😀', '\u0301'];
  const word = /[\p{L}\p{N}\p{M}\p{Pc}\u200c\u200d]/u;
  let seed = 937;
  const random = (n) => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n;
  for (let trial = 0; trial < 600; trial++) {
    const points = Array.from({ length: 40 }, () => alphabet[random(alphabet.length)]);
    const source = points.join('');
    const first = random(30),
      query = points.slice(first, first + 1 + random(8)).join('');
    const expected = [];
    let offset = 0,
      usedUntil = 0;
    for (let i = 0; i < points.length; offset += points[i++].length) {
      const end = offset + query.length;
      if (offset < usedUntil || !source.startsWith(query, offset)) continue;
      const next = source.codePointAt(end);
      if (
        word.test(points[i - 1] || '') ||
        word.test(next === undefined ? '' : String.fromCodePoint(next))
      )
        continue;
      expected.push({ start: offset, end });
      usedUntil = end;
    }
    assert.deepEqual(
      new TextSearchIndex(source, query, { matchCase: true, wholeWord: true }).matches,
      expected,
      JSON.stringify({ trial, source, query }),
    );
  }
});
