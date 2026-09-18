import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { DockLayout, locatePanel } from '../dist/core/docking.js';
import { DockWorkspace } from '../dist/controls/dock-workspace.js';
import { DialogHost } from '../dist/controls/dialog-host.js';
import { modal, closeModal } from '../dist/studio/dialog-host.js';
import { WindowNavigator, windowEntries, searchWindows } from '../dist/studio/window-navigator.js';

function fixture(t) {
  const dom = controlDOM(t),
    root = dom.host();
  root.id = 'modal-root';
  const panels = [
    { id: 'a', title: 'Page.xaml', kind: 'document', documentId: 'a' },
    { id: 'b', title: 'Page.xaml', kind: 'document', documentId: 'b' },
    { id: 'c', title: 'Résumé.xaml', kind: 'document', documentId: 'c' },
    { id: 'properties', title: 'Properties', kind: 'tool' },
  ];
  const model = new DockLayout(panels);
  model.hide('c');
  const control = new DockWorkspace(dom.host(), model);
  for (const p of panels) {
    const input = dom.document.createElement('textarea');
    input.value = 'Original ' + p.id;
    control.mount(p.id, input);
  }
  control.render();
  const stores = panels
    .filter((p) => p.documentId)
    .map((p) =>
      Object.assign(new EventTarget(), {
        document: {
          id: p.id,
          name: p.title,
          metadata: { solutionPath: (p.id === 'a' ? 'Views/' : 'Templates/') + p.title },
        },
      }),
    );
  const originalRoute = () => 'original';
  const studio = {
    stores,
    doc: stores[0].document,
    docking: { model, control, navigator: originalRoute },
    modal(...args) {
      modal(this, ...args);
    },
    closeModal() {
      closeModal(this);
    },
  };
  const navigator = new WindowNavigator(studio);
  const open = () => {
    studio.docking.navigator();
    const dialog = studio.dialogHost.element,
      input = dialog.querySelector('#dock-window-search');
    input.focus();
    return { dialog, input, list: dialog.querySelector('#dock-window-list') };
  };
  const query = (input, value) => {
    input.value = value;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  const key = (input, key, extra = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    input.dispatchEvent(event);
    return event;
  };
  t.after(() => {
    navigator.dispose();
    studio.dialogHost?.dispose();
    control.dispose();
  });
  return { ...dom, root, model, control, studio, navigator, originalRoute, open, query, key };
}

test('dialog lifetime signals abort once on replacement, close and disposal', (t) => {
  const dom = controlDOM(t),
    host = new DialogHost(dom.host());
  assert.equal(host.signal, null);
  host.open();
  const a = host.signal;
  let aborted = 0;
  a.addEventListener('abort', () => aborted++);
  host.open();
  const b = host.signal;
  assert(a.aborted);
  assert.notEqual(a, b);
  assert(!b.aborted);
  host.close();
  host.close();
  assert(b.aborted);
  assert.equal(host.signal, null);
  assert.equal(aborted, 1);
  host.open();
  const c = host.signal;
  host.dispose();
  assert(c.aborted);
  assert.equal(host.signal, null);
});

test('window catalog distinguishes paths, closed, active, auto-hidden and physical browser hosts', (t) => {
  const f = fixture(t),
    before = JSON.stringify(f.studio.stores.map((s) => s.document));
  f.model.autoHide('properties', 'right');
  f.model.float('b');
  const id = locatePanel(f.model.state, 'b').floating.id;
  const read = () =>
    windowEntries({
      ...f.studio,
      docking: {
        model: f.model,
        control: { visible: f.control.visible, windows: { get: (i) => (i === id ? {} : null) } },
      },
    });
  const items = read();
  assert.equal(items.find((p) => p.id === 'a').path, 'Views/Page.xaml');
  assert.equal(items.find((p) => p.id === 'c').closed, true);
  assert.equal(items.find((p) => p.id === 'b').location, 'Browser window');
  assert.equal(items.find((p) => p.id === 'properties').location, 'Auto-hidden · right');
  assert.equal(JSON.stringify(f.studio.stores.map((s) => s.document)), before);
});

test('saved popup intent is not advertised as an open browser window', (t) => {
  const f = fixture(t);
  f.model.float('b');
  f.model.setBrowserWindow(locatePanel(f.model.state, 'b').floating.id, {
    x: 0,
    y: 0,
    width: 700,
    height: 500,
  });
  const entry = windowEntries(f.studio).find((e) => e.id === 'b');
  assert.equal(entry.location, 'Main window · saved popup');
  assert.equal(entry.browser, false);
});

test('search matches accented names, multi-term paths and locations and ranks names ahead of paths', (t) => {
  const f = fixture(t),
    entries = windowEntries(f.studio);
  assert.equal(searchWindows(entries, 'resume').items[0].id, 'c');
  assert.deepEqual(
    searchWindows(entries, 'templates page').items.map((e) => e.id),
    ['b'],
  );
  assert.equal(searchWindows(entries, 'closed resume').items[0].id, 'c');
  const added = { ...entries[0], id: 'path', title: 'Other', path: 'Page.xaml' };
  assert.equal(searchWindows([added, ...entries], 'Page.xaml').items[0].id, 'a');
});

test('window filters remain distinct and a large registry returns bounded results with exact totals', (t) => {
  const f = fixture(t),
    entries = windowEntries(f.studio);
  assert.equal(searchWindows(entries, '', { scope: 'documents' }).total, 3);
  assert.equal(searchWindows(entries, '', { scope: 'tools' }).items[0].id, 'properties');
  assert.equal(searchWindows(entries, '', { scope: 'closed' }).items[0].id, 'c');
  assert.equal(searchWindows(entries, '', { scope: 'browser' }).total, 0);
  const many = Array.from({ length: 500 }, (_, i) => ({ ...entries[0], id: String(i) }));
  assert.equal(searchWindows(many).items.length, 80);
  assert.equal(searchWindows(many).total, 500);
});

test('keyboard selection retains search focus and activates the selected result instead of the first', (t) => {
  const f = fixture(t),
    before = f.model.serialize(),
    { input, list } = f.open();
  f.query(input, 'page');
  f.key(input, 'ArrowDown');
  assert.equal(f.document.activeElement, input);
  assert.equal(f.model.serialize(), before);
  const row = list.querySelector('[aria-selected="true"]');
  assert.equal(row.dataset.showDock, 'b');
  assert.equal(input.getAttribute('aria-activedescendant'), row.id);
  f.key(input, 'Enter');
  assert.equal(f.model.state.activePanel, 'b');
  assert.equal(f.studio.dialogHost.isOpen, false);
  assert.equal(f.document.activeElement, f.control.contents.get('b'));
});

test('search and filters have an actionable empty state with valid ARIA and no document edits', (t) => {
  const f = fixture(t),
    before = f.model.serialize(),
    { dialog, input, list } = f.open();
  f.query(input, 'does not exist');
  assert(list.hidden);
  assert(!dialog.querySelector('.ux-window-empty').hidden);
  assert.equal(input.hasAttribute('aria-activedescendant'), false);
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  f.key(input, 'Enter');
  assert(f.studio.dialogHost.isOpen);
  dialog.querySelector('[data-window-clear]').click();
  assert.equal(input.value, '');
  assert(!list.hidden);
  assert.equal(f.document.activeElement, input);
  dialog.querySelector('[data-window-scope="closed"]').click();
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].dataset.showDock, 'c');
  assert.equal(f.model.serialize(), before);
});

test('IME keys and text-editing shortcuts do not activate or navigate windows', (t) => {
  const f = fixture(t),
    { input } = f.open(),
    before = f.model.serialize(),
    selected = input.getAttribute('aria-activedescendant');
  for (const props of [{ isComposing: true }, { keyCode: 229 }]) {
    f.key(input, 'Enter', props);
    f.key(input, 'Escape', props);
    f.key(input, 'ArrowDown', props);
    assert(f.studio.dialogHost.isOpen);
  }
  assert.equal(f.key(input, 'Home').defaultPrevented, false);
  assert.equal(f.key(input, 'End').defaultPrevented, false);
  f.key(input, 'ArrowDown', { ctrlKey: true });
  assert.equal(input.getAttribute('aria-activedescendant'), selected);
  assert.equal(f.model.serialize(), before);
});

test('a rejected source guard leaves search, selection and layout intact with accessible feedback', (t) => {
  const f = fixture(t),
    { input, dialog } = f.open();
  f.query(input, 'templates page');
  const before = f.model.serialize(),
    selected = input.getAttribute('aria-activedescendant');
  f.control.beforeActivate = () => false;
  f.key(input, 'Enter');
  assert.equal(f.studio.dialogHost.element, dialog);
  assert.equal(input.value, 'templates page');
  assert.equal(input.getAttribute('aria-activedescendant'), selected);
  assert.equal(f.model.serialize(), before);
  assert.match(dialog.querySelector('[role="alert"]').textContent, /source draft/);
  assert.equal(f.document.activeElement, input);
});

test('throwing activation reports a literal message without unhandled events', (t) => {
  const f = fixture(t),
    { input, dialog } = f.open();
  f.control.beforeActivate = () => {
    throw Error('<b>Rejected</b>');
  };
  f.key(input, 'Enter');
  assert.equal(dialog.querySelector('[role="alert"]').textContent, '<b>Rejected</b>');
  assert.equal(dialog.querySelector('[role="alert"] b'), null);
  assert(f.studio.dialogHost.isOpen);
});

test('live registry changes retain selection by identity, reconcile removed rows and release subscriptions on close', (t) => {
  const f = fixture(t),
    { input, list } = f.open();
  f.query(input, 'page');
  f.key(input, 'ArrowDown');
  f.model.hide('a');
  assert.equal(list.querySelector('[aria-selected="true"]').dataset.showDock, 'b');
  f.model.unregister('b');
  assert.equal(list.querySelector('[aria-selected="true"]').dataset.showDock, 'a');
  const before = list.innerHTML,
    signal = f.studio.dialogHost.signal;
  f.studio.closeModal();
  assert(signal.aborted);
  assert.equal(f.navigator.cleanup, null);
  f.model.show('a');
  assert.equal(list.innerHTML, before);
  f.key(input, 'Enter');
  assert.equal(f.studio.dialogHost.isOpen, false);
});

test('window titles and file paths are escaped and never interpreted as executable markup', (t) => {
  const f = fixture(t);
  f.model.panels.get('a').title = '<img src=x onerror=alert(1)>';
  f.studio.stores[0].document.metadata.solutionPath = '<script>bad</script>';
  const { list } = f.open();
  assert.equal(list.querySelector('img,script'), null);
  assert.match(list.textContent, /<img/);
});

test('pointer interactions retain touch scrolling while mouse selection opens the chosen window', (t) => {
  const f = fixture(t),
    { list } = f.open();
  const mouse = new f.window.PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerType: 'mouse',
    button: 0,
  });
  const touch = new f.window.PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerType: 'touch',
    button: 0,
  });
  list.firstElementChild.dispatchEvent(mouse);
  list.firstElementChild.dispatchEvent(touch);
  assert(mouse.defaultPrevented);
  assert.equal(touch.defaultPrevented, false);
  list.querySelector('[data-show-dock="b"]').click();
  assert.equal(f.model.state.activePanel, 'b');
});

test('successful activation cannot dismiss a replacement dialog created by a host callback', (t) => {
  const f = fixture(t),
    { input } = f.open();
  f.control.beforeActivate = () => {
    f.studio.modal('Replacement', 'Keep me');
    return true;
  };
  f.key(input, 'Enter');
  assert.equal(f.studio.dialogHost.element.getAttribute('aria-label'), 'Replacement');
  assert.equal(f.navigator.cleanup, null);
});

test('dialog-to-dialog navigation restores the original editor and caret on Escape', (t) => {
  const f = fixture(t),
    editor = f.control.contents.get('a');
  editor.focus();
  editor.setSelectionRange(2, 7, 'backward');
  f.studio.modal('Layouts', '<button id="next">All windows</button>');
  f.document.querySelector('#next').focus();
  const { input } = f.open();
  f.key(input, 'Escape');
  assert.equal(f.document.activeElement, editor);
  assert.equal(editor.selectionStart, 2);
  assert.equal(editor.selectionEnd, 7);
  assert.equal(editor.selectionDirection, 'backward');
});

test('disposing navigator restores routes and closes only its own dialog', (t) => {
  const f = fixture(t);
  f.open();
  f.navigator.dispose();
  assert.equal(f.studio.docking.navigator, f.originalRoute);
  assert.equal(f.studio.dialogHost.isOpen, false);
  assert.equal(f.navigator.open(), undefined);
  f.studio.modal('Other', 'Keep');
  f.navigator.dispose();
  assert(f.studio.dialogHost.isOpen);
});

// Live registry updates retain identity; a new search is a new ranked choice.
test('changing query or filters starts at the highest-ranked result rather than a stale last row', (t) => {
  const f = fixture(t),
    { input, list, dialog } = f.open();
  f.query(input, 'templates page');
  assert.equal(list.querySelector('[aria-selected="true"]').dataset.showDock, 'b');
  f.query(input, 'page');
  assert.equal(list.querySelector('[aria-selected="true"]').dataset.showDock, 'a');
  f.key(input, 'ArrowDown');
  assert.equal(list.querySelector('[aria-selected="true"]').dataset.showDock, 'b');
  dialog.querySelector('[data-window-scope="documents"]').click();
  assert.equal(list.querySelector('[aria-selected="true"]').dataset.showDock, 'a');
});
