import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { controlDOM } from './control-fixture.mjs';
import { DockLayout } from '../dist/core/docking.js';
import { DockWorkspace } from '../dist/controls/docking.js';
import { DocumentScope } from '../dist/controls/document-scope.js';
import { DialogHost } from '../dist/controls/dialog-host.js';

function fixture(t) {
  const dom = controlDOM(t);
  const model = new DockLayout([
    { id: 'one', kind: 'document' },
    { id: 'two', kind: 'document' },
  ]);
  const control = new DockWorkspace(dom.host(), model, {
    keyboardScope: 'document',
    browserWindows: { openWindow: () => new Window() },
  });
  for (const id of ['one', 'two']) {
    const input = dom.document.createElement('textarea');
    input.value = 'unsaved ' + id;
    control.mount(id, input);
  }
  const one = control.windows.get(control.openWindow('one'));
  const two = control.windows.get(control.openWindow('two'));
  t.after(() => control.dispose());
  return { ...dom, model, control, one, two };
}
function key(document, target, value) {
  const event = new document.defaultView.KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

test('a popup menu never consumes text-navigation keys in another browser document', (t) => {
  const { control, one, two } = fixture(t);
  const tab = one.host.querySelector('[data-dock-panel="one"]');
  control.context({ target: tab }, 'one');
  const menu = control.menu;
  const input = control.contents.get('two');
  input.focus();
  for (const value of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape']) {
    assert.equal(key(two.document, input, value).defaultPrevented, false, value);
    assert.equal(control.menu, menu);
    assert.equal(two.document.activeElement, input);
  }
  const button = menu.querySelector('button:not(:disabled)');
  assert.equal(key(one.document, button, 'ArrowDown').defaultPrevented, true);
  assert.equal(key(one.document, one.document.activeElement, 'Escape').defaultPrevented, true);
  assert.equal(control.menu, null);
});

test('an owner-document modal handles Escape before an older docking menu', (t) => {
  const { control, one } = fixture(t);
  control.context({ target: one.host.querySelector('[data-dock-panel="one"]') }, 'one');
  const menu = control.menu;
  const root = one.document.createElement('div');
  one.document.body.append(root);
  const dialogs = new DialogHost(root);
  t.after(() => dialogs.dispose());
  const dialog = dialogs.open({ title: 'Owned dialog', html: '<input aria-label="value">' });
  const input = dialog.querySelector('input');
  input.focus();
  key(one.document, input, 'Escape');
  assert.equal(dialogs.isOpen, false, 'Escape must reach the modal handler');
  assert.equal(control.menu, menu, 'A modal key must not operate underlying docking chrome');
});

test('Escape in another browser document cannot cancel an active pointer gesture', (t) => {
  const { control, one, two } = fixture(t);
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
  const input = control.contents.get('two');
  assert.equal(key(two.document, input, 'Escape').defaultPrevented, false);
  assert.equal(canceled, 0);
  assert.equal(key(one.document, control.contents.get('one'), 'Escape').defaultPrevented, true);
  assert.equal(canceled, 1);
  assert.equal(control.cancelGesture, null);
});

test('a stale portal disposer cannot unregister a replacement registration for the same document', (t) => {
  const dom = controlDOM(t);
  const scope = new DocumentScope(dom.document, dom.host());
  const popup = new Window();
  t.after(() => {
    scope.dispose();
    popup.close();
  });
  let calls = 0;
  scope.listen(dom.document, 'input', () => calls++);
  const old = scope.add(popup.document);
  old();
  const current = scope.add(popup.document);
  old();
  assert.equal(scope.documents.has(popup.document), true);
  popup.document.dispatchEvent(new popup.Event('input'));
  assert.equal(calls, 1);
  current();
  assert.equal(scope.documents.has(popup.document), false);
  popup.document.dispatchEvent(new popup.Event('input'));
  assert.equal(calls, 1);
});
