import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { DocumentStore } from '../dist/core/model.js';
import { DocumentSession } from '../dist/core/document-session.js';
import { parseXaml } from '../dist/core/xaml.js';
import { CodeEditor } from '../dist/controls/code-editor.js';
import { DockLayout } from '../dist/core/docking.js';
import { DockWorkspace } from '../dist/controls/docking.js';
import { DockingStudio } from '../dist/studio/docking-studio.js';
import { OutlineWorkspace } from '../dist/studio/outline-workspace.js';
import { DocumentSync } from '../dist/studio/document-sync.js';
import { LanguageWorkspace } from '../dist/studio/language-workspace.js';

function fixture(
  t,
  source = '<Grid>\r\n  <TextBlock><TextBlock.Inlines><Run Text="Hello"/></TextBlock.Inlines></TextBlock>\r\n  <Button Name="Save"/>\r\n</Grid>',
) {
  let cleanup = () => {};
  t.after(() => cleanup());
  const dom = controlDOM(t),
    notices = [],
    stores = [];
  function add(source) {
    const store = new DocumentStore(parseXaml(source));
    store.session = new DocumentSession(store, { source });
    stores.push(store);
    return store;
  }
  const editor = new CodeEditor(dom.host());
  const model = new DockLayout([
    { id: 'xaml', kind: 'document' },
    { id: 'tool', kind: 'tool' },
  ]);
  const control = new DockWorkspace(dom.host(), model);
  control.mount('xaml', editor.host);
  control.render();
  const s = {
    store: add(source),
    editor,
    registry: null,
    get doc() {
      return this.store.document;
    },
    render() {
      this.sync.updateEditor();
    },
    command: () => {},
    menus: {
      commands: new Map(),
      menus: ['View', 'Edit', 'Designer'].map((label) => ({ label, children: [] })),
    },
    workspaceOptions: {
      root: dom.document,
      api: {},
      notify: (m) => notices.push(m),
      scheduleFrame: globalThis.requestAnimationFrame,
      cancelFrame: globalThis.cancelAnimationFrame,
    },
  };
  s.docking = { model, control, registerPanel: DockingStudio.prototype.registerPanel };
  const sync = Object.create(DocumentSync.prototype);
  sync.s = s;
  sync.status = () => {};
  s.sync = sync;
  sync.updateEditor();
  editor.onChange = (v, o) => sync.capture(v, o);
  editor.onSelection = () => sync.selectAtCaret();
  const language = Object.create(LanguageWorkspace.prototype);
  language.s = s;
  language.back = [];
  language.forward = [];
  s.language = language;
  s.store.select([s.doc.root.id]);
  const beforeLayout = model.serialize();
  const w = new OutlineWorkspace(s);
  function switchTo(source) {
    s.store = add(source);
    s.render();
  }
  cleanup = () => {
    w.dispose();
    control.dispose();
    editor.dispose();
    for (const store of stores) store.session.dispose();
  };
  return { ...dom, s, w, editor, model, control, sync, source, beforeLayout, switchTo, notices };
}

test('outline registers passively without selecting a tool or moving editor focus', (t) => {
  const { w, s, model, editor, flushFrames } = fixture(t);
  editor.focus();
  const active = model.state.activePanel;
  flushFrames();
  assert.equal(model.state.activePanel, active);
  assert.equal(editor.input.ownerDocument.activeElement, editor.input);
  assert(model.state.hidden.includes('document-outline'));
  assert.equal(s.store.history.length, 0);
  assert(s.menus.commands.has('outline-show'));
  assert.equal(w.tree.data.byId.size, 5);
});
test('outline breadcrumbs follow source offsets through CRLF and select XAML property owners', (t) => {
  const { w, s, editor, source } = fixture(t);
  const property = w.index.entries().find((x) => x.kind === 'property');
  editor.focus();
  const caret = editor.input.value.indexOf('TextBlock.Inlines') + 2;
  editor.input.setSelectionRange(caret, caret);
  editor.cursor(true);
  assert.equal(w.breadcrumbs.querySelector('[aria-current]').dataset.crumbId, property.id);
  assert(w.selectInDesigner(property.id));
  assert.deepEqual(s.store.selection, [property.parentId]);
  assert.equal(s.store.session.source, source);
  assert.equal(s.store.history.length, 0);
});
test('outline reveals exact source and structural siblings without changing document history', (t) => {
  const { w, s, editor, source } = fixture(t);
  const run = w.index.entries().find((x) => x.label === 'Run');
  assert(w.revealSource(run.id));
  assert.equal(
    editor.input.value.slice(editor.input.selectionStart, editor.input.selectionEnd),
    'Run',
  );
  assert(w.navigate('parent'));
  assert.equal(
    editor.input.value.slice(editor.input.selectionStart, editor.input.selectionEnd),
    'TextBlock.Inlines',
  );
  assert.equal(s.store.session.source, source);
  assert.equal(s.store.history.length, 0);
});
test('pending source and composition pause old-outline actions instead of applying stale coordinates', (t) => {
  const { w, s, editor, source } = fixture(t);
  const id = w.index.entries()[1].id;
  editor.input.value += ' ';
  w.refresh();
  assert.equal(w.tree.element.getAttribute('aria-disabled'), 'true');
  assert.equal(w.revealSource(id), false);
  assert.equal(w.selectInDesigner(id), false);
  assert.equal(s.store.session.source, source);
  editor.input.value = source.replace(/\r\n/g, '\n');
  editor.composing = true;
  assert.equal(w.revealSource(id), false);
  editor.composing = false;
  w.refresh();
  assert.equal(w.tree.element.getAttribute('aria-disabled'), 'false');
});
test('invalid source retains last valid outline with disabled actions and recovers through Undo', (t) => {
  const { w, s, editor, sync, source } = fixture(t);
  const entries = w.treeEntries;
  editor.input.value += '<';
  editor.changed();
  w.refresh();
  assert.equal(s.store.session.isValid, false);
  assert.equal(w.treeEntries, entries);
  assert.match(w.message.textContent, /Last valid outline/);
  assert.equal(w.selectInDesigner(entries[1].id), false);
  sync.history(false);
  w.refresh();
  assert.equal(s.store.session.source, source);
  assert.equal(w.tree.element.getAttribute('aria-disabled'), 'false');
});
test('per-document filters and collapsed branches restore without leaking node IDs', (t) => {
  const { w, s, switchTo } = fixture(t);
  const firstStore = s.store,
    id = w.index.entries()[1].id;
  w.follow = false;
  w.tree.setCollapsed(id);
  w.tree.setFilter('Run');
  switchTo('<Grid><Label Name="Other"/></Grid>');
  assert.equal(w.tree.query, '');
  assert.equal(w.tree.collapsed.has(id), false);
  w.tree.setFilter('Other');
  s.store = firstStore;
  s.render();
  assert.equal(w.tree.query, 'Run');
  assert(w.tree.collapsed.has(id));
  assert.equal(w.filter.value, 'Run');
});
test('programmatic locate clears filtering, reveals selection and keeps source unchanged', (t) => {
  const { w, s, source } = fixture(t);
  const entry = w.index.entries().at(-1);
  s.store.select([entry.id]);
  w.tree.setFilter('not-found');
  assert(w.locate());
  assert.equal(w.tree.query, '');
  assert.equal(w.tree.selectedId, entry.id);
  assert.equal(w.tree.activeId, entry.id);
  assert.equal(s.store.session.source, source);
});
test('disposal restores host overrides and releases panel, breadcrumbs, listeners and retained API behavior', (t) => {
  const { w, s, model, editor, flushFrames } = fixture(t);
  const api = s.workspaceOptions.api.outline;
  w.schedule();
  w.dispose();
  flushFrames();
  assert.equal(model.panels.has('document-outline'), false);
  assert.equal(editor.host.querySelector('.markup-breadcrumbs'), null);
  assert.equal(s.menus.commands.has('outline-show'), false);
  assert.equal(s.workspaceOptions.api.outline, undefined);
  assert.equal(api.show(), false);
  assert.deepEqual(api.entries(), []);
  assert.equal(w.session, null);
  assert.equal(w.environment.listeners.size, 0);
});

test('outline shortcut does not intercept the existing Open Solution shortcut', (t) => {
  const { s, w, editor, document, window } = fixture(t);
  editor.focus();
  const existing = new window.KeyboardEvent('keydown', {
    key: 'o',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  editor.input.dispatchEvent(existing);
  assert.equal(existing.defaultPrevented, false);
  const outline = new window.KeyboardEvent('keydown', {
    key: 'o',
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  editor.input.dispatchEvent(outline);
  assert.equal(outline.defaultPrevented, true);
  assert.equal(document.activeElement, w.filter);
  assert.equal(s.docking.model.state.activePanel, 'document-outline');
});
