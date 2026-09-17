import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { controlDOM } from './control-fixture.mjs';
import { DockLayout, locatePanel, validateDockLayout } from '../dist/core/docking.js';
import { DockWorkspace } from '../dist/controls/docking.js';
import { DocumentScope } from '../dist/controls/document-scope.js';
import { WorkspaceContext } from '../dist/workspaces/workspace-context.js';
import { CodeEditor } from '../dist/controls/code-editor.js';
import { DialogHost } from '../dist/controls/dialog-host.js';

function fixture(t, options = {}) {
  const dom = controlDOM(t),
    host = dom.host(),
    windows = [],
    cleanups = [];
  const model = new DockLayout([
    { id: 'one', title: 'One', kind: 'document' },
    { id: 'two', title: 'Two', kind: 'document' },
    { id: 'tools', title: 'Tools', kind: 'tool' },
    { id: 'other', title: 'Other', kind: 'tool' },
  ]);
  const scope = new DocumentScope(dom.document, host);
  const control = new DockWorkspace(host, model, {
    browserWindows: {
      openWindow: () => {
        const win = new Window();
        windows.push(win);
        return win;
      },
      onOpen: (info) => {
        const remove = scope.add(info.document, { root: info.host, workspace: info.host });
        return () => {
          cleanups.push(info.id);
          remove();
        };
      },
      ...options,
    },
  });
  const nodes = new Map();
  for (const id of model.panels.keys()) {
    const node = dom.document.createElement('div');
    node.innerHTML = `<textarea aria-label="${id}">draft ${id}</textarea>`;
    nodes.set(id, node);
    control.mount(id, node);
  }
  control.render();
  t.after(() => {
    control.dispose();
    scope.dispose();
    windows.forEach((win) => win.close());
  });
  return { ...dom, host, model, control, scope, nodes, windows, cleanups };
}
const valid = (model) => validateDockLayout(model.state, new Set(model.panels.keys()));

test('two browser hosts retain live node identity, content listeners and unrelated frame identity', (t) => {
  const f = fixture(t),
    input = f.nodes.get('one').firstElementChild;
  input.value = 'unsaved λ';
  input.setSelectionRange(2, 5, 'backward');
  let edits = 0;
  input.addEventListener('input', () => edits++);
  const a = f.control.openWindow('one'),
    b = f.control.openWindow('tools');
  assert(a && b && a !== b, f.control.live.textContent);
  assert.equal(f.control.windows.list().length, 2);
  const record = f.control.windows.get(a),
    frame = record.frame;
  assert(input.ownerDocument === record.document, 'input owner document after popout');
  assert.equal(input.value, 'unsaved λ');
  input.dispatchEvent(new record.window.InputEvent('input', { bubbles: true }));
  assert.equal(edits, 1);
  f.control.activate('two');
  f.model.pin('two');
  f.control.render();
  assert(record.frame === frame, 'unrelated render retained frame');
  assert.equal(input.value, 'unsaved λ');
  assert.equal(input.selectionStart, 2);
  assert.equal(input.selectionEnd, 5);
  assert(f.control.contents.get('one') === f.nodes.get('one'));
  assert(f.control.visible.has('one'));
  assert(f.control.visible.has('tools'));
  valid(f.model);
});

test('popup blocking and thrown allocation do not change the layout or undo stacks', (t) => {
  const f = fixture(t, { openWindow: () => null }),
    before = f.model.serialize(),
    history = f.model.history.length;
  assert.equal(f.control.openWindow('one'), null);
  assert.equal(f.model.serialize(), before);
  assert.equal(f.model.history.length, history);
  assert(f.nodes.get('one').ownerDocument === f.document, 'realm or node identity');
  f.control.windows.options.openWindow = () => {
    throw Error('denied');
  };
  assert.equal(f.control.openWindow('one'), null);
  assert.equal(f.model.serialize(), before);
  assert.throws(() => f.control.openWindow('one', { rect: { width: Infinity } }), /bounds/);
  assert.equal(f.model.serialize(), before);
});

test('a rejected application activation or portal setup rolls back without losing any panel', (t) => {
  const f = fixture(t),
    before = f.model.serialize();
  f.control.beforeActivate = () => false;
  assert.equal(f.control.openWindow('one'), null);
  assert.equal(f.model.serialize(), before);
  f.control.beforeActivate = () => true;
  f.control.windows.options.onOpen = () => {
    throw Error('portal failure');
  };
  assert.equal(f.control.openWindow('one'), null);
  assert.equal(f.model.serialize(), before);
  assert.equal(f.control.windows.list().length, 0);
  assert(f.nodes.get('one').ownerDocument === f.document, 'realm or node identity');
  assert.equal(f.scope.documents.size, 1);
});

test('closing or reloading a popup reclaims active and inactive live tabs', (t) => {
  const f = fixture(t);
  f.model.dock('two', locatePanel(f.model.state, 'one').group.id);
  const id = f.control.openWindow('one', { wholeGroup: true });
  assert(id, f.control.live.textContent);
  const r = f.control.windows.get(id);
  assert(f.nodes.get('one').ownerDocument === r.document, 'realm or node identity');
  f.control.activate('two'); // both panels have visited the popup, including inactive parking
  assert(f.nodes.get('two').ownerDocument === r.document, 'realm or node identity');
  r.window.dispatchEvent(new r.window.Event('pagehide'));
  assert.equal(f.control.windows.list().length, 0);
  for (const name of ['one', 'two'])
    assert(f.nodes.get(name).ownerDocument === f.document, 'realm or node identity');
  assert.deepEqual(f.cleanups, [id]);
  assert.equal(f.scope.documents.size, 1);
  assert.equal(f.model.state.floating.find((x) => x.id === id).browserWindow, undefined);
  valid(f.model);
});

test('window transfers share one layout history; redo and loading never allocate unsolicited popups', (t) => {
  const f = fixture(t),
    before = f.model.serialize(),
    count = f.model.history.length;
  const id = f.control.openWindow('one');
  assert(id, f.control.live.textContent);
  const saved = f.model.serialize();
  assert.equal(f.model.history.length, count + 1);
  f.model.undo();
  assert.equal(f.model.serialize(), before);
  assert.equal(f.control.windows.list().length, 0);
  assert(f.nodes.get('one').ownerDocument === f.document, 'realm or node identity');
  f.model.redo();
  assert.equal(f.windows.length, 1);
  assert.deepEqual(f.control.windows.pending(), [id]);
  assert.equal(f.control.windows.list().length, 0);
  assert.equal(f.control.windows.reopen(id), id);
  assert.equal(f.windows.length, 2);
  f.control.returnWindow(id);
  assert.equal(f.control.windows.list().length, 0);
  f.model.load(saved);
  assert.equal(f.windows.length, 2);
  assert.deepEqual(f.control.windows.pending(), [id]);
  valid(f.model);
});

test('moving between browser groups and unregistering the last panel releases only its own window', (t) => {
  const f = fixture(t),
    a = f.control.openWindow('one'),
    b = f.control.openWindow('two');
  assert(a && b, f.control.live.textContent);
  const target = locatePanel(f.model.state, 'two').group.id,
    r = f.control.windows.get(b);
  f.control.move('one', target, 'right');
  assert.equal(f.control.windows.get(a), null);
  assert(f.control.windows.get(b) === r);
  assert(f.nodes.get('one').ownerDocument === r.document, 'realm or node identity');
  const released = f.control.unmount('one');
  f.model.unregister('one');
  assert(released.parentNode === null, 'realm or node identity');
  assert(f.control.windows.get(b) === r);
  f.control.unmount('two');
  f.model.unregister('two');
  assert.equal(f.control.windows.list().length, 0);
  valid(f.model);
});

test('a complete floating split root opens intact and stays intact on return', (t) => {
  const f = fixture(t);
  f.model.float('one');
  f.model.dock('two', locatePanel(f.model.state, 'one').group.id, 'right');
  const root = locatePanel(f.model.state, 'one').floating,
    tree = JSON.stringify(root.root);
  const id = f.control.openWindow(['one', 'two']);
  assert.equal(id, root.id);
  assert.equal(JSON.stringify(f.model.state.floating[0].root), tree);
  assert.equal(f.control.windows.reopen(id), id);
  assert.equal(f.windows.length, 1);
  f.control.returnWindow(id);
  assert.equal(JSON.stringify(f.model.state.floating[0].root), tree);
});

test('invalid serialized browser geometry is rejected atomically', (t) => {
  const f = fixture(t);
  f.model.float('one');
  const before = f.model.serialize(),
    id = f.model.state.floating[0].id;
  for (const rect of [
    { x: 0, y: 0, width: NaN, height: 300 },
    { x: 1e10, y: 0, width: 300, height: 300 },
    { x: 0, y: 0, width: 300, height: 1 },
  ]) {
    assert.throws(() => f.model.setBrowserWindow(id, rect));
    assert.equal(f.model.serialize(), before);
  }
  assert.throws(() => f.model.setBrowserWindow('missing', { x: 0, y: 0, width: 300, height: 300 }));
});

test('disposing the view reclaims every popup node and releases portals without deleting caller state', (t) => {
  const f = fixture(t),
    a = f.control.openWindow('one'),
    b = f.control.openWindow('two');
  assert(a && b, f.control.live.textContent);
  f.control.dispose();
  f.control.dispose();
  assert.equal(f.control.windows.list().length, 0);
  assert.equal(f.scope.documents.size, 1);
  assert.equal(f.cleanups.length, 2);
  for (const node of f.nodes.values()) {
    assert(node.ownerDocument === f.document, 'realm or node identity');
    assert(node.parentNode === f.host, 'realm or node identity');
  }
  assert.equal(f.model.panels.size, 4);
  valid(f.model);
});

test('DocumentScope and WorkspaceContext route real input, cancellation, queries and once listeners with cleanup', (t) => {
  const f = fixture(t),
    context = new WorkspaceContext({ root: f.document, domScope: f.scope });
  t.after(() => context.dispose());
  let calls = 0,
    once = 0;
  const original = (e) => {
    calls++;
    e.preventDefault();
  };
  context.listen(f.document, 'keydown', original);
  f.scope.listen(f.host, 'change', () => once++, { once: true });
  const id = f.control.openWindow('one');
  assert(id, f.control.live.textContent);
  const input = f.nodes.get('one').firstElementChild,
    r = f.control.windows.get(id);
  const ev = new r.window.KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
  input.dispatchEvent(ev);
  assert.equal(calls, 1);
  assert(ev.defaultPrevented);
  input.dispatchEvent(new r.window.Event('change', { bubbles: true }));
  f.nodes.get('two').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  assert.equal(once, 1);
  assert(context.query('[aria-label="one"]') === input);
  assert.equal(context.all('textarea').length, 4);
  context.dispose();
  input.dispatchEvent(new r.window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  assert.equal(calls, 1);
  f.control.returnWindow(id);
  assert.equal(f.scope.documents.size, 1);
});

test('editor buffer and undo stay live after adoption; owner-modal return focus uses caller callback', (t) => {
  const f = fixture(t),
    editor = new CodeEditor(f.nodes.get('one'));
  t.after(() => editor.dispose());
  editor.setValue('before');
  const id = f.control.openWindow('one');
  assert(id, f.control.live.textContent);
  const r = f.control.windows.get(id);
  assert(editor.window === r.window, 'realm or node identity');
  editor.input.value = 'after';
  editor.input.dispatchEvent(new r.window.InputEvent('input', { bubbles: true }));
  editor.undoBuffer();
  assert.equal(editor.input.value, 'before');
  const dialog = new DialogHost(f.host),
    calls = [];
  dialog.open({ title: 'Owner modal', returnFocus: () => calls.push(editor.input) });
  dialog.close();
  assert(calls.length === 1 && calls[0] === editor.input);
  dialog.dispose();
  f.control.returnWindow(id);
  assert(editor.window === f.window, 'realm or node identity');
  assert.equal(editor.input.value, 'before');
});

test('dynamic panel registration and idempotent mounting retain unrelated browser frames', (t) => {
  const f = fixture(t),
    id = f.control.openWindow('one');
  const r = f.control.windows.get(id),
    frame = r.frame,
    node = f.nodes.get('one');
  const parent = node.parentNode;
  f.control.mount('one', node);
  assert.equal(node.parentNode, parent, 'idempotent mounting must not park a live editor');
  f.model.register({ id: 'new', kind: 'document' });
  f.control.mount('new', f.document.createElement('div'));
  f.control.render();
  assert.equal(r.frame, frame, 'file creation must not rebuild an unrelated popup');
  f.control.unmount('new');
  f.model.unregister('new');
  assert.equal(r.frame, frame, 'file closure must not rebuild an unrelated popup');
  const replacement = f.document.createElement('textarea');
  replacement.value = 'replacement editor';
  f.control.mount('one', replacement);
  f.control.render();
  assert.notEqual(r.frame, frame, 'replacing a hosted panel invalidates that host');
  assert(r.frame.contains(replacement));
  assert.equal(replacement.ownerDocument, r.document);
  assert.equal(node.parentNode, null);
  valid(f.model);
});

const settleStyles = () => new Promise((resolve) => setTimeout(resolve, 10));

test('popup theme observation includes nested containers without replacing styles or live frames', async (t) => {
  const f = fixture(t);
  const style = f.document.createElement('style');
  style.textContent = ':root { --probe: light; } .dark { --probe: dark; }';
  f.document.head.append(style);
  const wrapper = f.document.createElement('section');
  f.host.before(wrapper);
  wrapper.append(f.host);
  const id = f.control.openWindow('one');
  const record = f.control.windows.get(id);
  const clone = record.document.querySelector('.dock-browser-styles style');
  const frame = record.frame;
  let readings = 0;
  const compute = f.window.getComputedStyle.bind(f.window);
  f.window.getComputedStyle = (...args) => {
    readings++;
    return compute(...args);
  };
  // happy-dom does not compute inherited CSS variables; real-browser tests assert their values.
  for (const owner of [f.document.body, wrapper]) {
    const before = readings;
    owner.classList.add('dark');
    await settleStyles();
    assert(readings > before, 'theme change recomputed the inherited presentation');
    if (owner === f.document.body) assert(record.document.body.classList.contains('dark'));
    const after = readings;
    owner.classList.remove('dark');
    await settleStyles();
    assert(readings > after, 'theme removal recomputed the inherited presentation');
    assert(!record.document.body.classList.contains('dark'));
  }
  f.document.documentElement.dataset.density = 'comfortable';
  await settleStyles();
  assert.equal(record.document.documentElement.dataset.density, 'comfortable');
  assert.equal(record.document.querySelector('.dock-browser-styles style'), clone);
  assert.equal(record.frame, frame);
  assert.equal(f.control.contents.get('one'), f.nodes.get('one'));
});

test('removed inherited custom properties release popup inline overrides', async (t) => {
  const f = fixture(t);
  f.host.style.setProperty('--temporary-theme-token', 'old-theme');
  const id = f.control.openWindow('one');
  const record = f.control.windows.get(id);
  assert.equal(record.host.style.getPropertyValue('--temporary-theme-token'), 'old-theme');
  f.host.style.removeProperty('--temporary-theme-token');
  await settleStyles();
  assert.equal(record.host.style.getPropertyValue('--temporary-theme-token'), '');
});

test('popup stylesheet synchronization preserves order and updates only changed sources', async (t) => {
  const f = fixture(t);
  const a = f.document.createElement('style'),
    b = f.document.createElement('style');
  a.textContent = ':root { --first: 1; }';
  b.textContent = ':root { --second: 2; }';
  f.document.head.append(a, b);
  const id = f.control.openWindow('one');
  const record = f.control.windows.get(id);
  const copies = record.document.querySelector('.dock-browser-styles');
  const original = [...copies.children];
  a.textContent = ':root { --first: 3; }';
  await settleStyles();
  assert.equal(copies.children[0].textContent, a.textContent);
  assert.equal(copies.children[1], original[1]);
  f.document.head.insertBefore(b, a);
  await settleStyles();
  assert.equal(copies.children[0], original[1]);
  b.remove();
  await settleStyles();
  assert.equal(copies.children.length, 1);
  assert.equal(copies.children[0].textContent, a.textContent);
  f.control.returnWindow(id);
  a.textContent = ':root { --first: 4; }';
  await settleStyles();
  assert.equal(copies.children[0].textContent, ':root { --first: 3; }');
});
