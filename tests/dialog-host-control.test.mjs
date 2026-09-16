import test from 'node:test';
import assert from 'node:assert/strict';
import { DialogHost } from '../dist/controls/dialog-host.js';
import { controlDOM } from './control-fixture.mjs';
import { graph } from '../scripts/package-graph.mjs';
function fixture(t) {
  const dom = controlDOM(t);
  const root = dom.host();
  const control = new DialogHost(root);
  t.after(() => control.dispose());
  return { ...dom, root, control };
}

test('dialog package has no runtime dependencies and safe text needs no trusted markup', async (t) => {
  assert.deepEqual(
    [...(await graph()).entries.find((entry) => entry.id === 'dialogs').dependencies],
    [],
  );
  const { control } = fixture(t);
  control.open({
    title: '<Title>',
    content: '<img src=x>',
    actions: [{ label: '<Run>', run() {} }],
  });
  assert.equal(control.element.getAttribute('aria-label'), '<Title>');
  assert.equal(control.body.textContent, '<img src=x>');
  assert.equal(control.element.querySelector('img'), null);
  assert.equal(control.element.querySelector('[data-modal-action]').textContent, '<Run>');
});

test('dialog hosts enforce ownership, validate options atomically and allow remount after disposal', (t) => {
  const { control, root } = fixture(t);
  assert.throws(() => new DialogHost(root), /Dispose/);
  const dialog = control.open({ content: 'Original' });
  assert.throws(() => control.open({ actions: [{}] }), /run callback/);
  assert.throws(() => control.open({ content: root }), /host ancestor/);
  assert.throws(() => control.open({ content: 'text', html: '<p>x</p>' }), /either/);
  assert.equal(control.element, dialog);
  control.dispose();
  control.dispose();
  assert.throws(() => control.open(), /disposed/);
  const replacement = new DialogHost(root);
  replacement.dispose();
});

test('mounted content returns to its exact sibling position with edited state and listeners', (t) => {
  const { document, control, host, window } = fixture(t);
  const origin = host();
  const input = document.createElement('input');
  const tail = document.createElement('span');
  origin.append(input, tail);
  let edits = 0;
  input.addEventListener('input', () => edits++);
  control.open({ content: input });
  input.value = 'retained';
  input.dispatchEvent(new window.Event('input'));
  control.close();
  assert.equal(input.parentNode, origin);
  assert.equal(input.nextSibling, tail);
  assert.equal(input.value, 'retained');
  assert.equal(edits, 1);
});

test('focus wraps visible enabled controls, Escape restores focus and original inert attributes', (t) => {
  const { control, document, host, window } = fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = document.createElement('button');
  document.body.append(previous);
  const inert = host();
  inert.setAttribute('inert', 'existing');
  previous.focus();
  const dialog = control.open({
    html: '<input id="value"><input hidden><button disabled>Skip</button><button style="display:none">Hidden</button>',
    actions: [{ label: 'Run', run() {} }],
  });
  t.mock.timers.tick(0);
  assert.equal(document.activeElement.id, 'value');
  assert(previous.hasAttribute('inert'));
  const first = dialog.querySelector('[data-dialog-close]');
  const last = dialog.querySelector('[data-modal-action]');
  last.focus();
  dialog.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
  );
  assert.equal(document.activeElement, first);
  dialog.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(document.activeElement, last);
  dialog.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  assert.equal(control.isOpen, false);
  assert.equal(document.activeElement, previous);
  assert.equal(previous.hasAttribute('inert'), false);
  assert.equal(inert.getAttribute('inert'), 'existing');
});

test('nested independent hosts route Escape only to the top dialog and restore lower focus', (t) => {
  const { control, host, window, document } = fixture(t);
  const other = new DialogHost(host());
  t.after(() => other.dispose());
  const lower = control.open({ content: 'Lower' });
  control.focus();
  const saved = document.activeElement;
  const upper = other.open({ content: 'Upper' });
  other.focus();
  assert.equal(lower.getAttribute('aria-modal'), 'false');
  upper.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(other.isOpen, false);
  assert.equal(control.isOpen, true);
  assert.equal(lower.getAttribute('aria-modal'), 'true');
  assert.equal(document.activeElement, saved);
});

test('async actions suppress duplicate activation and render rejection as literal accessible text', async (t) => {
  const { control } = fixture(t);
  let reject,
    calls = 0;
  const dialog = control.open({
    actions: [
      {
        label: 'Run',
        run() {
          calls++;
          return new Promise((_, r) => {
            reject = r;
          });
        },
      },
    ],
  });
  const button = dialog.querySelector('[data-modal-action]');
  const pending = button.onclick();
  await button.onclick();
  assert.equal(calls, 1);
  assert(button.disabled);
  assert.equal(dialog.getAttribute('aria-busy'), 'true');
  reject(Error('<Failed>'));
  await pending;
  assert.equal(dialog.querySelector('[role="alert"]').textContent, '<Failed>');
  assert.equal(button.disabled, false);
  assert.equal(dialog.hasAttribute('aria-busy'), false);
});

test('replacement aborts actions and stale rejection cannot update or close the new dialog', async (t) => {
  const { control } = fixture(t);
  let reject, signal;
  const old = control.open({
    actions: [
      {
        label: 'Run',
        closeOnSuccess: true,
        run(context) {
          signal = context.signal;
          return new Promise((_, r) => {
            reject = r;
          });
        },
      },
    ],
  });
  const pending = old.querySelector('[data-modal-action]').onclick();
  const replacement = control.open({ content: 'New' });
  assert(signal.aborted);
  reject(Error('Late failure'));
  await pending;
  assert.equal(control.element, replacement);
  assert.equal(replacement.querySelector('[role="alert"]').textContent, '');
});

test('controlled action success closes only when explicitly enabled and not rejected with false', async (t) => {
  const { control } = fixture(t);
  let result = false;
  control.open({ actions: [{ label: 'Apply', closeOnSuccess: true, run: () => result }] });
  await control.element.querySelector('[data-modal-action]').onclick();
  assert(control.isOpen);
  result = undefined;
  await control.element.querySelector('[data-modal-action]').onclick();
  assert.equal(control.isOpen, false);
});

test('disposed dialogs cancel deferred focus and do not steal focus or retain event handlers', (t) => {
  const { control, document, window } = fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = document.createElement('button');
  document.body.append(previous);
  previous.focus();
  const dialog = control.open({ content: 'Close immediately' });
  control.dispose();
  t.mock.timers.tick(1);
  previous.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Tab', cancelable: true, bubbles: true }),
  );
  assert.equal(document.activeElement, previous);
  assert.equal(dialog.querySelector('[data-dialog-close]').onclick, null);
});

test('overlay and Escape dismissal are independently configurable and content clicks stay open', (t) => {
  const { control, window } = fixture(t);
  const dialog = control.open({ dismissOnOverlay: false, dismissOnEscape: false });
  dialog.parentElement.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(control.isOpen);
  control.open();
  control.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  assert(control.isOpen);
  control.element.parentElement.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  assert.equal(control.isOpen, false);
});

test('explicit initial focus can select a static heading with negative tabindex', (t) => {
  const { control, document } = fixture(t);
  control.open({
    html: '<h3 tabindex="-1">Read first</h3><input>',
    initialFocus: (dialog) => dialog.querySelector('h3'),
  });
  control.focus();
  assert.equal(document.activeElement.tagName, 'H3');
});

test('closing a lower dialog leaves the upper host active and restores inert state only at the end', (t) => {
  const { control, host, document } = fixture(t);
  const other = new DialogHost(host());
  t.after(() => other.dispose());
  const background = host();
  control.open({ content: 'Lower' });
  const upper = other.open({ content: 'Upper' });
  other.focus();
  control.dispose();
  assert(other.isOpen);
  assert(upper.contains(document.activeElement));
  assert(background.hasAttribute('inert'));
  other.dispose();
  assert.equal(background.hasAttribute('inert'), false);
});

test('close does not reclaim content explicitly moved elsewhere by the application', (t) => {
  const { control, host, document } = fixture(t);
  const content = document.createElement('input');
  const original = host();
  original.append(content);
  control.open({ content });
  const destination = host();
  destination.append(content);
  control.close();
  assert.equal(content.parentElement, destination);
});

test('hidden initial focus ancestors are skipped without losing the modal focus guard', (t) => {
  const { control, document } = fixture(t);
  control.open({
    html: '<div style="display:none"><h3 tabindex="-1">Hidden</h3></div><input id="visible">',
    initialFocus: (dialog) => dialog.querySelector('h3'),
  });
  control.focus();
  assert.equal(document.activeElement.id, 'visible');
});

test('synchronous abort reentry cannot orphan a replacement overlay or resurrect disposal', async (t) => {
  const { control, root } = fixture(t);
  control.open({
    actions: [
      {
        label: 'Start',
        run({ signal }) {
          signal.addEventListener('abort', () => control.open({ title: 'Newer' }), { once: true });
        },
      },
    ],
  });
  await control.element.querySelector('[data-modal-action]').onclick();
  assert.throws(() => control.open({ title: 'Superseded' }), /superseded/);
  assert.equal(control.element.getAttribute('aria-label'), 'Newer');
  assert.equal(root.querySelectorAll('[role="dialog"]').length, 1);
  control.open({
    actions: [
      {
        label: 'Start',
        run({ signal }) {
          signal.addEventListener('abort', () => control.dispose(), { once: true });
        },
      },
    ],
  });
  await control.element.querySelector('[data-modal-action]').onclick();
  assert.throws(() => control.open(), /superseded/);
  assert.equal(root.querySelectorAll('[role="dialog"]').length, 0);
  assert.equal(control.disposed, true);
});
