import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceTextCoordinates } from '../dist/core/source-text-coordinates.js';
import { DocumentStore } from '../dist/core/model.js';
import { DocumentSession } from '../dist/core/document-session.js';
import { parseXaml } from '../dist/core/xaml.js';
import { CodeEditor } from '../dist/controls/code-editor.js';
import { SemanticLanguageService } from '../dist/core/language-service.js';
import { DocumentSync } from '../dist/studio/document-sync.js';
import { LanguageWorkspace } from '../dist/studio/language-workspace.js';
import { MarkupRefactorService } from '../dist/core/markup-refactoring.js';
import { controlDOM } from './control-fixture.mjs';

for (const source of ['', 'a\nb', 'a\r\nb', 'a\rb', '😀\r\n\r\nlast\r\n', '\uFEFFa\r\nb\nc\rd'])
  test(`coordinate round trips preserve UTF-16 offsets: ${JSON.stringify(source)}`, () => {
    const c = new SourceTextCoordinates(source);
    for (let offset = 0; offset <= c.editorText.length; offset++) {
      assert.equal(c.toEditor(c.toSource(offset)), offset);
      assert.equal(
        c.source.slice(c.toSource(offset)).replace(/\r\n?/g, '\n'),
        c.editorText.slice(offset),
      );
    }
    assert.equal(c.fromEditor(c.editorText), source);
    assert(Object.isFrozen(c));
  });

test('coordinate mapping rejects malformed offsets and text without clamping silently', () => {
  assert.throws(() => new SourceTextCoordinates(null), TypeError);
  const c = new SourceTextCoordinates('a\r\nb');
  for (const value of [-1, NaN, Infinity, 0.5, '1', null]) {
    assert.throws(() => c.toSource(value), RangeError);
    assert.throws(() => c.toEditor(value), RangeError);
  }
  assert.throws(() => c.toSource(4), RangeError);
  assert.throws(() => c.toEditor(5), RangeError);
  assert.throws(() => c.fromEditor(null), TypeError);
});

test('ordinary source edits retain BOM, untouched mixed endings and first-newline insertion style', () => {
  const source = '\uFEFFa\r\nb\nc\rd';
  const c = new SourceTextCoordinates(source);
  assert.equal(c.fromEditor('\uFEFFa\nb\nchanged\nd'), '\uFEFFa\r\nb\nchanged\rd');
  assert.equal(c.fromEditor('\uFEFFa\nnew\nb\nc\nd'), '\uFEFFa\r\nnew\r\nb\nc\rd');
  assert.equal(c.fromEditor(c.editorText + '\nend'), source + '\r\nend');
});

function fixture(t) {
  const dom = controlDOM(t);
  const source =
    '\uFEFF<Grid>\r\n  <StackPanel>\r\n    <Button Name="Save" Content="Save"/>\r\n  </StackPanel>\r\n</Grid>\r\n';
  const store = new DocumentStore(parseXaml(source));
  const session = new DocumentSession(store, { source });
  store.session = session;
  const editor = new CodeEditor(dom.host());
  const s = {
    store,
    editor,
    get doc() {
      return store.document;
    },
    docking: { control: { activate: () => true } },
  };
  const sync = Object.create(DocumentSync.prototype);
  sync.s = s;
  sync.positions = new Map();
  sync.status = () => {};
  s.sync = sync;
  sync.updateEditor();
  editor.onChange = (value, options) => sync.capture(value, options);
  const language = Object.create(LanguageWorkspace.prototype);
  language.s = s;
  language.services = new WeakMap([[session, new SemanticLanguageService(session)]]);
  language.back = [];
  language.forward = [];
  s.language = language;
  t.after(() => {
    editor.dispose();
    session.dispose();
  });
  return { ...dom, source, store, session, editor, sync, language };
}

test('flushing a CRLF textarea is a no-op and never dirties canonical history', (t) => {
  const { source, session, editor, sync, store } = fixture(t);
  assert.equal(editor.getValue(), source.replace(/\r\n/g, '\n'));
  assert.equal(editor.lastText, editor.getValue());
  assert.equal(editor.syncedText, editor.getValue());
  const revision = session.revision;
  for (let i = 0; i < 10; i++) assert(sync.flush());
  assert.equal(session.source, source);
  assert.equal(session.revision, revision);
  assert.equal(store.history.length, 0);
  assert.equal(editor.dirty, false);
});

test('actual editor input and undo/redo retain canonical CRLF and selection identities', (t) => {
  const { source, session, editor, sync, store } = fixture(t);
  const id = store.document.root.children[0].children[0].id;
  editor.input.value = editor.input.value.replace('Content="Save"', 'Content="Changed"');
  editor.changed();
  assert.equal(session.source, source.replace('Content="Save"', 'Content="Changed"'));
  assert.equal(store.document.root.children[0].children[0].id, id);
  assert.equal(store.history.length, 1);
  sync.history(false);
  assert.equal(session.source, source);
  sync.history(true);
  assert.match(session.source, /Content="Changed"/);
  assert.equal((session.source.match(/\r\n/g) || []).length, 5);
});

test('source selection and structural navigation translate both directions across CRLF', (t) => {
  const { source, session, editor, sync, store, language } = fixture(t);
  const caret = editor.input.value.indexOf('Button') + 2;
  editor.input.setSelectionRange(caret, caret);
  sync.selectAtCaret();
  const id = store.document.root.children[0].children[0].id;
  assert.deepEqual(store.selection, [id]);
  assert.equal(language.current().start, source.indexOf('Button') + 2);
  assert(language.command('language-expand-selection'));
  assert.equal(
    editor.input.value.slice(editor.input.selectionStart, editor.input.selectionEnd),
    'Button',
  );
  assert(language.command('language-shrink-selection'));
  assert.equal(editor.input.selectionStart, caret);
  assert(
    language.navigate({
      ...session.sourceAtNode(store.document.root.children[0].id),
      start: source.indexOf('StackPanel'),
      end: source.indexOf('StackPanel') + 10,
    }),
  );
  assert.equal(
    editor.input.value.slice(editor.input.selectionStart, editor.input.selectionEnd),
    'StackPanel',
  );
  assert(language.history(false));
  assert.equal(editor.input.selectionStart, caret);
  assert.equal(session.source, source);
});

test('reviewed refactor and exact undo preserve CRLF source while textarea stays normalized', (t) => {
  const { source, session, editor, sync, store } = fixture(t);
  const service = new MarkupRefactorService(session);
  const plan = service.prepareRename(source.indexOf('Button') + 1, 'Label');
  service.apply(plan);
  sync.updateEditor();
  assert(sync.matchesEditor());
  assert.equal(session.source, source.replace('Button', 'Label'));
  sync.flush();
  assert.equal(store.history.length, 1);
  sync.history(false);
  assert.equal(session.source, source);
  assert.equal(editor.getValue(), source.replace(/\r\n/g, '\n'));
});

test('invalid and composing LF buffers are mapped without discarding the last valid CRLF source', (t) => {
  const { source, session, editor, sync } = fixture(t);
  editor.composing = true;
  sync.capture(editor.input.value + '<', { composing: true });
  assert.equal(sync.composition.base, source);
  assert.equal(sync.composition.text, source + '<');
  assert.equal(sync.flush(), false);
  editor.composing = false;
  editor.input.value += '<';
  editor.changed();
  assert.equal(session.isValid, false);
  assert.equal(session.source, source + '<');
  assert.equal(session.validSource, source);
  sync.history(false);
  assert.equal(session.source, source);
});
