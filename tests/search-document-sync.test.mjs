import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentStore } from '../dist/core/model.js';
import { DocumentSession } from '../dist/core/document-session.js';
import { parseXaml } from '../dist/core/xaml.js';
import { CodeEditor } from '../dist/controls/code-editor.js';
import { DocumentSync } from '../dist/studio/document-sync.js';
import { controlDOM } from './control-fixture.mjs';

function fixture(
  t,
  source = '\uFEFF<Grid>\r\n<Button Content="Old"/>\n<!-- Keep -->\r<Button Content="Old"/>\r\n</Grid>',
) {
  const dom = controlDOM(t),
    store = new DocumentStore(parseXaml(source));
  const session = new DocumentSession(store, { source });
  store.session = session;
  const editor = new CodeEditor(dom.host());
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
  s.sync = sync;
  editor.onChange = (value, options) => sync.capture(value, options);
  editor.onTextEdits = (edits, value) => sync.applyEditorEdits(edits, value);
  sync.updateEditor();
  t.after(() => {
    editor.dispose();
    session.dispose();
  });
  const replace = (query, text) => {
    editor.find({ seed: false, replace: true });
    editor.search.query.value = query;
    editor.search.replacement.value = text;
    editor.search.refresh();
    return editor.search.replace(true);
  };
  return { ...dom, source, store, session, editor, sync, s, replace };
}

test('batch replacement preserves every untouched mixed newline interval, BOM and exact Undo', (t) => {
  const { replace, source, session, store, editor, sync } = fixture(t);
  const beforeIds = store.document.root.children
    .filter((n) => n.kind === 'element')
    .map((n) => n.id);
  assert(replace('Old', 'Updated'));
  assert.equal(session.source, source.replaceAll('Old', 'Updated'));
  assert.equal(store.history.length, 1);
  assert.deepEqual(
    store.document.root.children.filter((n) => n.kind === 'element').map((n) => n.id),
    beforeIds,
  );
  assert.equal(editor.getValue(), session.source.replace(/\r\n?/g, '\n'));
  sync.history(false);
  assert.equal(session.source, source);
  sync.history(true);
  assert.equal(session.source, source.replaceAll('Old', 'Updated'));
});
test('pending source is captured before range translation, never overwritten by an older search snapshot', (t) => {
  const { editor, session, source, replace } = fixture(t);
  editor.input.value = editor.input.value.replace('Keep', 'Pending comment');
  assert(replace('Old', 'New'));
  assert.equal(session.source, source.replace('Keep', 'Pending comment').replaceAll('Old', 'New'));
});
test('invalid source remains an undoable draft after unsafe text replacement, rather than silent AST edits', (t) => {
  const { replace, session, store, source, sync } = fixture(t);
  const old = JSON.stringify(store.document.root);
  assert(replace('Grid', 'Invalid Tag'));
  assert.equal(session.isValid, false);
  assert.equal(JSON.stringify(store.document.root), old);
  assert.match(session.source, /<Invalid Tag>/);
  sync.history(false);
  assert.equal(session.isValid, true);
  assert.equal(session.source, source);
});
test('find/replace can repair a live invalid draft through the existing source session', (t) => {
  const { session, store, sync, replace, source } = fixture(t);
  session.updateSource(source.replace('</Grid>', '</Bad>'));
  sync.updateEditor();
  assert.equal(session.isValid, false);
  assert(replace('</Bad>', '</Grid>'));
  assert.equal(session.isValid, true);
  assert.equal(session.source, source);
  store.undo();
  sync.updateEditor();
  assert.equal(session.isValid, false);
  assert.match(session.source, /<\/Bad>/);
});
test('search and navigation do not create source changes or histories in a CRLF document', (t) => {
  const { editor, session, store, source } = fixture(t);
  const revision = session.revision;
  editor.find({ seed: false });
  editor.search.query.value = 'Old';
  editor.search.refresh();
  for (let i = 0; i < 8; i++) editor.search.move();
  assert.equal(session.source, source);
  assert.equal(session.revision, revision);
  assert.equal(store.history.length, 0);
});
test('read-only, composition and stale-value adapter calls reject without source mutation', (t) => {
  const { editor, sync, session, source } = fixture(t);
  const edits = [{ start: 1, end: 2, text: 'X' }];
  assert.equal(sync.applyEditorEdits(edits, 'stale'), false);
  for (const prop of ['readOnly', 'disabled']) {
    editor.input[prop] = true;
    assert.equal(sync.applyEditorEdits(edits, editor.getValue()), false);
    editor.input[prop] = false;
  }
  editor.composing = true;
  assert.equal(sync.applyEditorEdits(edits, editor.getValue()), false);
  editor.composing = false;
  assert.equal(session.source, source);
});
