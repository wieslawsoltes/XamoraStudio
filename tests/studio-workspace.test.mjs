import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Studio } from '../dist/studio/studio.js';
import { DocumentStore, createDocument, element } from '../dist/core/model.js';

function fixture(t) {
  const window = new Window();
  for (const name of ['document', 'localStorage']) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  t.after(() => window.close());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  window.document.body.innerHTML = '<button id="previous">Previous</button><div id="modal-root"></div><div id="toast"></div><span id="save-state"></span>';
  const host = Object.create(Studio.prototype);
  host.stores = [new DocumentStore(createDocument(element('Grid')))];
  host.active = 0;
  host.registry = { toolkits: new Map(), adapters: new Map(), install() {} };
  host.prepareEdit = () => true;
  host.addStore = doc => host.stores.push(new DocumentStore(doc));
  host.switchDocument = index => { host.active = index; };
  return { window, document: window.document, host };
}

test('modal delegates preserve accessible markup, action errors, focus wrapping and restoration', async t => {
  const { window, document, host } = fixture(t);
  const previous = document.querySelector('#previous');
  previous.focus();
  host.modal('<Title>', '<input id="value">', [{ label: '<Run>', run() { throw Error('<Failure>'); } }], true);
  t.mock.timers.tick(0);
  const dialog = document.querySelector('[role="dialog"]');
  assert.equal(dialog.getAttribute('aria-label'), '<Title>');
  assert(dialog.classList.contains('wide'));
  const first = document.querySelector('#close-modal');
  const last = document.querySelector('[data-modal-action]');
  assert.equal(last.textContent, '<Run>');
  await last.onclick();
  assert.equal(document.querySelector('[role="alert"]').textContent, '<Failure>');
  assert.equal(document.querySelector('[role="alert"]').children.length, 0);
  last.focus();
  dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, first);
  dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, last);
  host.closeModal();
  assert.equal(document.querySelector('#modal-root').children.length, 0);
  assert.equal(document.activeElement, previous);
});

test('modal cancellation and overlay dismissal remain distinct from clicks inside the dialog', t => {
  const { window, document, host } = fixture(t);
  host.modal('Actions', '<p>Body</p>', [{ label: 'Run', run() {} }]);
  document.querySelector('.modal-body').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  assert(document.querySelector('.modal'));
  document.querySelector('#cancel-modal').click();
  assert.equal(document.querySelector('.modal'), null);
  host.modal('Overlay', 'Body');
  document.querySelector('.modal-overlay').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  assert.equal(document.querySelector('.modal'), null);
});

test('new document dialog keeps validation and framework/template defaults', async t => {
  const { document, host } = fixture(t);
  host.doc.framework = 'HTML';
  host.newDocumentDialog();
  assert.equal(document.querySelector('#new-framework').value, 'WPF');
  document.querySelector('#new-name').value = 'Template';
  document.querySelector('#new-kind').value = 'ControlTemplate';
  document.querySelector('#new-width').value = '99';
  await document.querySelector('[data-modal-action]').onclick();
  assert.equal(host.stores.length, 1);
  assert.match(document.querySelector('.modal-error').textContent, /between 100 and 8000/);
  document.querySelector('#new-width').value = '640';
  await document.querySelector('[data-modal-action]').onclick();
  assert.equal(host.stores.length, 2);
  assert.equal(host.doc.name, 'Template.xaml');
  assert.equal(host.doc.root.props.TargetType, 'Button');
  assert.equal(host.doc.root.props.Width, undefined);
  assert.equal(host.doc.design.width, 640);
  assert.equal(document.querySelector('.modal'), null);
});

test('rename dialog uses the original document transaction and rejects an empty name', async t => {
  const { document, host } = fixture(t);
  const original = host.doc.name;
  host.renameDocumentDialog();
  document.querySelector('#page-name').value = ' ';
  await document.querySelector('[data-modal-action]').onclick();
  assert.equal(host.doc.name, original);
  document.querySelector('#page-name').value = 'Renamed.xaml';
  await document.querySelector('[data-modal-action]').onclick();
  assert.equal(host.doc.name, 'Renamed.xaml');
  host.store.undo();
  assert.equal(host.doc.name, original);
});

test('workspace persistence retains its schema, shared documents and storage-full feedback', t => {
  const { document, host } = fixture(t);
  host.solution = { model: { name: 'Solution' } };
  const data = host.workspaceData();
  assert.equal(data.format, 'xamora-workspace');
  assert.equal(data.version, 1);
  assert.equal(data.documents[0], host.doc);
  assert.equal(data.solution, host.solution.model);
  assert.equal(data.activeId, host.doc.id);
  host.save();
  const saved = JSON.parse(localStorage.getItem('xamora-workspace-v1'));
  assert.equal(saved.documents[0].id, host.doc.id);
  assert.equal(saved.active, 0);
  assert.equal(document.querySelector('#save-state').textContent, 'Saved on this device');
  t.mock.method(localStorage, 'setItem', () => { throw Error('Quota'); });
  host.save();
  assert.match(document.querySelector('#save-state').textContent, /Local storage full/);
  assert.match(document.querySelector('#toast').textContent, /Export your project/);
});

test('file delegates retain pending-edit guards, size limits and XAML import results', async t => {
  const { host } = fixture(t);
  host.prepareEdit = () => false;
  assert.equal(host.importText('<Grid/>'), undefined);
  await host.importFile({ size: 1, text() { throw Error('Must not read'); } });
  assert.equal(host.stores.length, 1);
  host.prepareEdit = () => true;
  await assert.rejects(host.importFile({ size: 15000001 }), /15 MB/);
  const id = host.importText('<Grid/>');
  assert.equal(id, host.doc.id);
  assert.equal(host.doc.name, 'Imported.xaml');
  assert.equal(host.stores.length, 2);
});

test('export dialog preserves raw pending source and skips composition-time exports', async t => {
  const { window, document, host } = fixture(t);
  const blobs = [];
  t.mock.method(URL, 'createObjectURL', blob => { blobs.push(blob); return 'blob:test'; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  t.mock.method(window.HTMLAnchorElement.prototype, 'click', () => {});
  host.editor = { composing: true };
  host.exportDialog();
  assert.equal(document.querySelector('.modal'), null);
  host.editor.composing = false;
  let flushed = 0;
  host.sync = { flush() { flushed++; } };
  host.store.session = { source: '<Grid><!-- pending source' };
  host.prepareEdit = () => false;
  host.exportDialog();
  assert.equal(flushed, 1);
  await document.querySelector('[data-modal-action]').onclick();
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].type, 'application/xml');
  assert.equal(await blobs[0].text(), '<Grid><!-- pending source');
});
