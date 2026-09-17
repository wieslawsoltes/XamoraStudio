import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { controlDOM } from './control-fixture.mjs';
import { DockLayout, locatePanel } from '../dist/core/docking.js';
import { DockWorkspace } from '../dist/controls/docking.js';

function fixture(t) {
  const dom = controlDOM(t),
    popups = [],
    closed = [];
  const model = new DockLayout(['one', 'two', 'three'].map((id) => ({ id, kind: 'document' })));
  const control = new DockWorkspace(dom.host(), model, {
    browserWindows: {
      openWindow: () => {
        const popup = new Window();
        popups.push(popup);
        const close = popup.close.bind(popup);
        popup.close = () => {
          closed.push(popup);
          close();
        };
        return popup;
      },
    },
  });
  for (const id of model.panels.keys()) {
    const input = dom.document.createElement('textarea');
    input.value = 'draft ' + id;
    control.mount(id, input);
  }
  control.render();
  t.after(() => {
    control.dispose();
    if (control.windows.watch) dom.window.clearInterval(control.windows.watch);
    for (const popup of popups) popup.close();
  });
  const open = (id) => control.windows.get(control.openWindow(id));
  return { ...dom, model, control, popups, closed, open };
}
function transfer(control, source, ids) {
  const data = new Map();
  const dataTransfer = {
    setData: (type, value) => data.set(type, value),
    getData: (type) => data.get(type) || '',
    get types() {
      return [...data.keys()];
    },
  };
  control.windows.beginTransfer({ target: source, dataTransfer, stopPropagation() {} }, ids);
  return dataTransfer;
}
function drag(source, type, dataTransfer) {
  const event = new source.ownerDocument.defaultView.Event(type, {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  source.dispatchEvent(event);
  return event;
}

test('returning an unrelated browser host leaves another host pointer gesture active', (t) => {
  const { control, open } = fixture(t),
    a = open('one'),
    b = open('two');
  let canceled = 0;
  control.gesture(
    {
      target: control.contents.get('one'),
      pointerId: 1,
      preventDefault() {},
      stopPropagation() {},
    },
    () => {},
    () => {},
    () => canceled++,
  );
  control.returnWindow(b.id);
  assert.equal(canceled, 0);
  assert(control.gestureDocument === a.document);
  control.returnWindow(a.id);
  assert.equal(canceled, 1);
  assert.equal(control.cancelGesture, null);
});

test('returning an unrelated host clears only its drop preview, not the active transfer', (t) => {
  const { control, open } = fixture(t),
    a = open('one'),
    b = open('two');
  transfer(control, a.host.querySelector('.dock-transfer-grip'), ['one']);
  const current = control.windows.transfer;
  const preview = b.document.createElement('div');
  b.document.body.append(preview);
  control.overlay = preview;
  control.returnWindow(b.id);
  assert(control.windows.transfer === current);
  assert.equal(preview.isConnected, false);
  assert.equal(control.overlay, null);
  control.returnWindow(a.id);
  assert.equal(control.windows.transfer, null);
});

test('foreign and stale dragend events cannot terminate a newer source transfer', (t) => {
  const { control, open } = fixture(t),
    a = open('one'),
    b = open('two');
  const first = a.host.querySelector('.dock-transfer-grip'),
    second = b.host.querySelector('.dock-transfer-grip');
  const oldData = transfer(control, first, ['one']);
  const data = transfer(control, second, ['two']),
    current = control.windows.transfer;
  drag(first, 'dragend', oldData);
  assert(control.windows.transfer === current);
  drag(control.contents.get('two'), 'dragend', data);
  assert(control.windows.transfer === current);
  drag(second, 'dragend', data);
  assert.equal(control.windows.transfer, null);
});

test('manager disposal clears a main-window transfer and cannot start another', (t) => {
  const { control, document } = fixture(t),
    source = control.host.querySelector('.dock-transfer-grip');
  transfer(control, source, ['one']);
  const preview = document.createElement('div');
  document.body.append(preview);
  control.overlay = preview;
  control.windows.dispose();
  assert.equal(control.windows.transfer, null);
  assert.equal(preview.isConnected, false);
  transfer(control, source, ['one']);
  assert.equal(control.windows.transfer, null);
});

for (const background of [false, true])
  test(`group transfer guards the selected member with background=${background}`, (t) => {
    const { control, model, open } = fixture(t);
    model.dock('two', locatePanel(model.state, 'one').group.id);
    model.activate('two');
    const a = control.windows.get(control.openWindow(['one', 'two']));
    const b = open('three');
    if (!background) model.activate('two');
    const calls = [];
    control.beforeActivate = (id) => {
      calls.push(id);
      return true;
    };
    control.dropAt = () => ({ id: locatePanel(model.state, 'three').group.id, position: 'center' });
    const data = transfer(control, a.host.querySelector('.dock-transfer-grip'), ['one', 'two']);
    drag(b.host, 'drop', data);
    assert.deepEqual(calls, ['two']);
    assert.equal(locatePanel(model.state, 'two').group.active, 'two');
  });

test('a throwing transfer guard is reported without escaping the event or changing layout/history', (t) => {
  const { control, model, open } = fixture(t),
    a = open('one'),
    b = open('two');
  const before = model.serialize(),
    history = model.history.length,
    messages = [],
    errors = [];
  b.window.addEventListener('error', (event) => {
    errors.push(event.message);
    event.preventDefault();
  });
  control.beforeActivate = () => {
    throw Error('guard rejected');
  };
  control.notify = (message) => messages.push(message);
  control.dropAt = () => ({ id: locatePanel(model.state, 'two').group.id, position: 'center' });
  drag(b.host, 'drop', transfer(control, a.host.querySelector('.dock-transfer-grip'), ['one']));
  assert.deepEqual(errors, []);
  assert.deepEqual(messages, ['guard rejected']);
  assert.equal(model.serialize(), before);
  assert.equal(model.history.length, history);
  assert.equal(control.windows.transfer, null);
});

for (const owner of ['control', 'manager'])
  test(`onOpen disposal of ${owner} rolls back and releases a late portal cleanup exactly once`, (t) => {
    const { control, model } = fixture(t),
      before = model.serialize(),
      history = model.history.length;
    let cleanups = 0;
    control.windows.options.onOpen = () => {
      (owner === 'control' ? control : control.windows).dispose();
      return () => cleanups++;
    };
    assert.equal(control.openWindow('one'), null);
    assert.equal(cleanups, 1);
    assert.equal(control.windows.records.size, 0);
    assert(!control.windows.watch);
    assert.equal(model.serialize(), before);
    assert.equal(model.history.length, history);
  });

test('disposal during activation never creates a portal or a window watcher', (t) => {
  const { control, model, popups, closed } = fixture(t),
    before = model.serialize();
  let portals = 0;
  control.windows.options.onOpen = () => portals++;
  control.beforeActivate = () => {
    control.dispose();
    return true;
  };
  assert.equal(control.openWindow('one'), null);
  assert.equal(portals, 0);
  assert.equal(control.windows.records.size, 0);
  assert(!control.windows.watch);
  assert.equal(model.serialize(), before);
  assert(popups.every((window) => closed.includes(window)));
});

test('onClose can reopen the same floating tree without the old return closing its replacement', (t) => {
  const { control, model, open } = fixture(t),
    old = open('one');
  let replacement;
  control.windows.options.onClose = (id) => {
    control.windows.options.onClose = null;
    replacement = control.windows.get(control.windows.reopen(id));
  };
  control.returnWindow(old.id);
  assert(replacement && replacement !== old);
  assert(control.windows.get(old.id) === replacement);
  assert.equal(replacement.window.closed, false);
  assert(model.state.floating.find((f) => f.id === old.id).browserWindow);
  assert(control.contents.get('one').ownerDocument === replacement.document);
});

test('focus reaches a directly mounted input in its current owner document', (t) => {
  const { control, open } = fixture(t),
    a = open('one'),
    input = control.contents.get('one');
  control.focus('one');
  assert(a.document.activeElement === input);
  control.returnWindow(a.id);
  control.focus('one');
  assert(control.document.activeElement === input);
});

test('closing a popup menu releases its return-focus reference', (t) => {
  const { control, open } = fixture(t),
    a = open('one');
  const tab = a.host.querySelector('[data-dock-panel="one"]');
  tab.focus();
  control.context({ target: tab }, 'one');
  control.closeMenu();
  assert.equal(control.menu, null);
  assert(control.menuReturn === null);
});

for (const hook of ['openWindow', 'onOpen'])
  test(`disposal inside ${hook} cannot retain browser hosts or change layout`, (t) => {
    const { control, model, popups, closed } = fixture(t),
      before = model.serialize();
    const manager = control.windows,
      original = manager.options.openWindow;
    if (hook === 'openWindow')
      manager.options.openWindow = (...args) => {
        const popup = original(...args);
        manager.dispose();
        return popup;
      };
    else
      manager.options.onOpen = () => {
        manager.dispose();
        throw Error('disposed portal');
      };
    assert.equal(control.openWindow('one'), null);
    assert.equal(model.serialize(), before);
    assert.equal(manager.records.size, 0);
    assert(!manager.watch);
    assert(popups.every((popup) => closed.includes(popup)));
  });

test('owner pagehide rejects callback-driven reopening and cancels the owner transfer', (t) => {
  const { control, window, open } = fixture(t),
    a = open('one');
  transfer(control, control.host.querySelector('.dock-transfer-grip'), ['two']);
  let reopened;
  control.windows.options.onClose = () => {
    reopened = control.openWindow('one');
  };
  window.dispatchEvent(new window.Event('pagehide'));
  assert.equal(reopened, null);
  assert.equal(control.windows.records.size, 0);
  assert.equal(control.windows.transfer, null);
  assert(!control.windows.watch);
  control.windows.options.onClose = null;
  const event = new window.Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: true });
  window.dispatchEvent(event);
  assert(control.windows.reopen(a.id));
});

test('pointer group docking uses the same selected-member guard as browser transfers', (t) => {
  const { control, model } = fixture(t);
  model.float('three');
  model.activate('two');
  const group = locatePanel(model.state, 'one').group;
  model.activate('three');
  const calls = [];
  control.beforeActivate = (id) => {
    calls.push(id);
    return true;
  };
  control.dropAt = () => ({ id: locatePanel(model.state, 'three').group.id, position: 'center' });
  const target = control.query(`[data-dock-group="${group.id}"] .dock-group-title`);
  const event = { target, button: 0, pointerId: 1, clientX: 0, clientY: 0 };
  control.gesture = (_event, move, finish) => {
    const moved = { ...event, clientX: 30, clientY: 30 };
    move(moved);
    finish(moved);
  };
  control.startDrag(event, ['one', 'two'], group);
  assert.deepEqual(calls, ['two']);
  assert.equal(locatePanel(model.state, 'two').group.active, 'two');
});
