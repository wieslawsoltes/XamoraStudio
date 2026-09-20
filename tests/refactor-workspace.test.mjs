import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { DocumentStore, find } from '../dist/core/model.js';
import { DocumentSession } from '../dist/core/document-session.js';
import { parseXaml } from '../dist/core/xaml.js';
import { builtins } from '../dist/core/registry.js';
import { CodeEditor } from '../dist/controls/code-editor.js';
import { SemanticLanguageService } from '../dist/core/language-service.js';
import { RefactorWorkspace } from '../dist/studio/refactor-workspace.js';
import { modal, closeModal } from '../dist/studio/dialog-host.js';
function setup(t, source = '<Grid><Border><Button Content="Save"/></Border></Grid>') {
  const dom = controlDOM(t),
    store = new DocumentStore(parseXaml(source)),
    session = new DocumentSession(store, { source });
  store.session = session;
  const root = dom.host();
  root.id = 'modal-root';
  dom.window.xamora = {};
  const editor = new CodeEditor(dom.host());
  editor.setValue(source);
  const s = {
    store,
    editor,
    registry: builtins(),
    menus: {
      commands: new Map(),
      menus: [
        { label: 'Edit', children: [] },
        { label: 'Designer', children: [] },
      ],
    },
    get doc() {
      return this.store.document;
    },
    command: (id) => 'base:' + id,
    modal(...args) {
      return modal(this, ...args);
    },
    closeModal() {
      closeModal(this);
    },
  };
  s.language = {
    service: new SemanticLanguageService(session),
    navigate(range) {
      editor.input.setSelectionRange(range.start, range.end);
      editor.focus();
    },
  };
  s.sync = {
    flush() {
      if (editor.input.value !== s.store.session.source) {
        const r = s.store.session.updateSource(editor.input.value);
        return r.accepted && r.valid;
      }
      return session.isValid;
    },
    updateEditor() {
      editor.setValue(s.store.session.source, { force: true });
    },
  };
  session.addEventListener('change', () => s.sync.updateEditor());
  const w = new RefactorWorkspace(s);
  t.after(() => {
    w.dispose();
    s.dialogHost?.dispose();
    editor.dispose();
    session.dispose();
  });
  const field = () => root.querySelector('[data-refactor-name]'),
    apply = () => root.querySelector('.modal-footer .primary');
  const name = (value) => {
    field().value = value;
    field().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  return { ...dom, s, w, store, session, editor, field, apply, name, root };
}

test('source rename review is inert until Apply, retains AST identity and uses one history entry', async (t) => {
  const x = setup(t),
    id = x.store.document.root.children[0].id;
  x.editor.input.setSelectionRange(10, 10);
  assert(x.w.open('rename'));
  x.name('Grid');
  assert.equal(x.store.history.length, 0);
  assert(!x.apply().disabled);
  x.apply().click();
  await Promise.resolve();
  assert.equal(x.root.querySelector('[role="dialog"]'), null);
  assert.equal(find(x.store.document.root, id).type, 'Grid');
  assert.equal(x.store.history.length, 1);
  assert.equal(x.session.source, '<Grid><Grid><Button Content="Save"/></Grid></Grid>');
});

test('canceling a proposal preserves source, selected nodes and revision', (t) => {
  const x = setup(t),
    source = x.session.source,
    id = x.store.document.root.children[0].id;
  x.store.select([id]);
  x.w.open('wrap', 'designer');
  assert(!x.apply().disabled);
  x.root.querySelector('[data-dialog-cancel]').click();
  assert.equal(x.session.source, source);
  assert.deepEqual(x.store.selection, [id]);
  assert.equal(x.store.revision, 0);
});

test('source property-element commands select their logical control owner', (t) => {
  const x = setup(
    t,
    '<Grid><Border><Border.Background>Red</Border.Background><Button/></Border></Grid>',
  );
  x.editor.input.setSelectionRange(23, 23);
  assert(x.w.open('rename', 'source'));
  assert.equal(x.field().value, 'Border');
});

test('renaming a container cannot bypass locked descendants', (t) => {
  const x = setup(t),
    border = x.store.document.root.children[0],
    button = border.children[0];
  x.store.document.metadata.locked = [button.id];
  x.store.select([border.id]);
  x.w.open('rename', 'designer');
  x.name('Grid');
  assert(x.apply().disabled);
  assert.match(x.root.textContent, /Unlock all affected/);
  assert.equal(x.store.history.length, 0);
});

test('changing source from another window disables the displayed proposal', (t) => {
  const x = setup(t);
  x.editor.input.setSelectionRange(10, 10);
  x.w.open('rename');
  x.name('Grid');
  x.session.updateSource(x.session.source.replace('Save', 'Changed'));
  assert(x.apply().disabled);
  assert.match(x.root.textContent, /document or selection changed/);
});

test('pending input and active composition cannot apply a previous-source plan', (t) => {
  const x = setup(t);
  x.editor.input.setSelectionRange(10, 10);
  x.w.open('rename');
  x.name('Grid');
  x.editor.input.value += '<';
  x.editor.input.dispatchEvent(new x.window.Event('input', { bubbles: true }));
  assert(x.apply().disabled);
  assert.equal(x.store.history.length, 0);
  assert.deepEqual(x.w.api.linkedTagRanges(10), []);
});

test('read-only, composing and invalid source refuse refactoring commands', (t) => {
  const x = setup(t);
  x.editor.input.setSelectionRange(10, 10);
  x.editor.setReadOnly(true);
  assert.equal(x.w.open(), false);
  x.editor.setReadOnly(false);
  x.editor.composing = true;
  assert.equal(x.w.open(), false);
  x.editor.composing = false;
  x.editor.input.value = '<Grid';
  assert.equal(x.w.open(), false);
  assert.equal(x.session.isValid, false);
  assert.equal(x.store.document.root.type, 'Grid');
});

test('changing selection invalidates designer proposals but source scope keeps its captured target', (t) => {
  const x = setup(t),
    border = x.store.document.root.children[0];
  x.store.select([border.id]);
  x.w.open('rename', 'designer');
  x.name('Grid');
  x.store.select([border.children[0].id]);
  assert(x.apply().disabled);
  x.s.closeModal();
  x.editor.input.setSelectionRange(10, 10);
  x.w.open('rename');
  x.name('Grid');
  x.store.select([]);
  assert(!x.apply().disabled);
});

test('Shift+F2 opens tag refactoring while F2 retains existing symbol renaming', (t) => {
  const x = setup(t),
    commands = [];
  x.editor.onSemanticCommand = (id) => commands.push(id);
  for (const shiftKey of [false, true])
    x.editor.input.dispatchEvent(
      new x.window.KeyboardEvent('keydown', {
        key: 'F2',
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  assert.deepEqual(commands, ['language-rename', 'language-rename-tag']);
});

test('disposal closes its own dialog and restores menu/API/command state without erasing replacements', (t) => {
  const x = setup(t),
    api = x.w.api,
    run = x.s.menus.commands.get('language-rename-tag').run;
  x.editor.input.setSelectionRange(10, 10);
  x.w.open();
  const newer = { open() {} };
  x.window.xamora.refactoring = newer;
  x.w.dispose();
  assert.equal(x.root.querySelector('[role="dialog"]'), null);
  assert.equal(x.s.menus.commands.has('language-rename-tag'), false);
  assert.equal(x.s.menus.menus[0].children.length, 0);
  assert.equal(x.window.xamora.refactoring, newer);
  assert.equal(api.open(), false);
  assert.equal(run(), false);
  assert.equal(x.s.command('test'), 'base:test');
});

test('a document switch cannot redirect an open proposal to the new store', async (t) => {
  const x = setup(t);
  x.editor.input.setSelectionRange(10, 10);
  x.w.open('rename');
  x.name('Grid');
  const doc = new DocumentStore(parseXaml('<Canvas/>'));
  doc.session = new DocumentSession(doc);
  t.after(() => doc.session.dispose());
  x.s.store = doc;
  x.editor.setValue(doc.session.source, { force: true });
  x.apply().click();
  await Promise.resolve();
  assert.equal(doc.document.root.type, 'Canvas');
  assert.equal(doc.history.length, 0);
  assert.equal(x.store.history.length, 0);
  assert.match(x.root.querySelector('.modal-error').textContent, /document or selection changed/);
});
