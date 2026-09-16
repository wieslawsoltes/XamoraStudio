import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { DockLayout, DockWorkspace } from '../dist/controls/docking.js';
import { graph } from '../scripts/package-graph.mjs';
import { rewriteStyleImports } from '../scripts/package-build/metadata.mjs';

function workspace(dom, options) {
  const model = new DockLayout([
    { id: 'one', kind: 'document' },
    { id: 'two', kind: 'document' },
  ]);
  const host = dom.host();
  const control = new DockWorkspace(host, model, options);
  const input = dom.document.createElement('textarea');
  input.value = 'Owned by the consumer';
  control.mount('one', input);
  control.mount('two', dom.document.createElement('div'));
  control.render();
  return { host, model, control, input };
}

test('docking has one canonical owner, lightweight dependencies and legacy reexport paths', async () => {
  const current = await graph();
  assert.equal(current.owners.get('dist/core/docking.js').entry.id, 'docking');
  assert.equal(current.owners.get('dist/controls/dock-workspace.js').entry.id, 'docking');
  const docking = current.entries.find((entry) => entry.id === 'docking');
  assert.deepEqual([...docking.dependencies], ['@wieslawsoltes/xamora-control-primitives']);
  assert.equal(
    current.entries.find((entry) => entry.id === 'control-primitives').dependencies.size,
    0,
  );
  const legacy = current.entries.find((entry) => entry.id === 'controls');
  assert(legacy.reexports.some((entry) => entry.name === 'dock-workspace'));
  assert.equal(legacy.sources.length, 0);
});

test('two docking workspaces route keyboard navigation only to the owning host', (t) => {
  const dom = controlDOM(t),
    a = workspace(dom),
    b = workspace(dom);
  const first = a.model.state.activePanel,
    second = b.model.state.activePanel;
  b.input.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', {
      key: 'Tab',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(a.model.state.activePanel, first);
  assert.notEqual(b.model.state.activePanel, second);
  const outside = dom.document.createElement('input');
  dom.document.body.append(outside);
  const state = b.model.serialize();
  const event = new dom.window.KeyboardEvent('keydown', {
    key: 'F4',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  outside.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(b.model.serialize(), state);
  a.control.dispose();
  b.control.dispose();
  dom.flushFrames();
});

test('document-wide docking shortcuts remain opt-in and do not intercept dialogs', (t) => {
  const dom = controlDOM(t),
    { control, model } = workspace(dom, { keyboardScope: 'document' });
  const outside = dom.document.createElement('button');
  dom.document.body.append(outside);
  const before = model.state.activePanel;
  outside.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true }),
  );
  assert.notEqual(model.state.activePanel, before);
  const dialog = dom.document.createElement('section');
  dialog.setAttribute('role', 'dialog');
  dialog.append(outside);
  dom.document.body.append(dialog);
  const current = model.serialize();
  outside.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'F4', ctrlKey: true, bubbles: true }),
  );
  assert.equal(model.serialize(), current);
  control.dispose();
});

test('content replacement, unmount and idempotent disposal release nodes without destroying their state', (t) => {
  const dom = controlDOM(t),
    { control, model, input, host } = workspace(dom);
  const replacement = dom.document.createElement('textarea');
  replacement.value = 'Replacement';
  control.mount('one', replacement);
  assert.equal(input.parentNode, null);
  assert.equal(input.dataset.dockContent, undefined);
  assert.throws(() => control.mount('two', replacement), /one panel/);
  assert.equal(control.unmount('one'), replacement);
  assert.equal(control.unmount('one'), null);
  control.mount('one', replacement);
  control.render();
  control.activate('two');
  control.dispose();
  control.dispose();
  dom.flushFrames();
  assert.equal(replacement.parentNode, host);
  assert.equal(replacement.value, 'Replacement');
  assert.equal(replacement.dataset.dockContent, undefined);
  assert.equal(host.classList.contains('dock-workspace'), false);
  assert.equal(control.contents.size, 0);
  assert.equal(control.activate('one'), false);
  assert.throws(() => control.mount('one', input), /disposed/);
  model.float('one'); // the caller-owned model remains usable after the view is disposed
  assert.equal(replacement.parentNode, host);
});

test('flattened stylesheet imports point at declared packaged assets, preserving media queries', () => {
  const source =
    '@import url("../controls/menu-bar.css") screen;\n@import "https://example.invalid/theme.css";';
  assert.equal(
    rewriteStyleImports(source, 'dist/styles/editor.css', ['dist/controls/menu-bar.css']),
    '@import url("./menu-bar.css") screen;\n@import "https://example.invalid/theme.css";',
  );
  assert.throws(
    () => rewriteStyleImports(source, 'dist/styles/editor.css', []),
    /Undeclared CSS import/,
  );
});
