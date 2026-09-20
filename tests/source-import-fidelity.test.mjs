import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { DocumentStore, walk } from '../dist/core/model.js';
import { DocumentSession } from '../dist/core/document-session.js';
import { MarkupRefactorService } from '../dist/core/markup-refactoring.js';
import { importText } from '../dist/studio/workspace-files.js';

function studio(t) {
  controlDOM(t);
  const s = {
    stores: [],
    prepareEdit: () => true,
    addStore(doc) {
      const store = new DocumentStore(doc);
      store.session = new DocumentSession(store);
      this.stores.push(store);
      t.after(() => store.session.dispose());
      return store;
    },
    switchDocument(index) {
      this.active = index;
    },
  };
  return s;
}

for (const [name, source, type, replacement] of [
  [
    'Authored.xaml',
    `\ufeff<?xml version='1.0'?>\r\n<Grid>\r\n\t<!-- source -->\r\n\t<Button Content = 'A &#38; B' />\r\n</Grid>`,
    'Button',
    'Label',
  ],
  [
    'Authored.html',
    `<!doctype html><html><head></head><body><main><section title='A &amp; B'>Keep&nbsp;text</section></main></body></html>`,
    'section',
    'article',
  ],
])
  test(`${name} import preserves the input file before its first refactor and after undo`, (t) => {
    const s = studio(t),
      id = importText(s, source, name),
      store = s.stores[0],
      session = store.session;
    assert.equal(id, store.document.id);
    assert.equal(s.active, 0);
    assert.equal(session.source, source);
    assert.equal(session.validSource, source);
    assert.equal(session.isValid, true);
    assert.equal(store.history.length, 0);
    let target;
    walk(store.document.root, (node) => {
      if (node.type === type) target = node;
    });
    const service = new MarkupRefactorService(session);
    t.after(() => service.dispose());
    const proposal = service.prepareRename(target.id, replacement);
    assert.equal(proposal.after, source.replaceAll(type, replacement));
    service.apply(proposal);
    assert.equal(session.source, proposal.after);
    assert.equal(store.history.length, 1);
    store.undo();
    assert.equal(session.source, source);
    assert.equal(store.history.length, 0);
    store.redo();
    assert.equal(session.source, proposal.after);
  });

test('a rejected or malformed import does not add a source session', (t) => {
  const s = studio(t);
  s.prepareEdit = () => false;
  assert.equal(importText(s, '<Grid/>'), undefined);
  assert.equal(s.stores.length, 0);
  s.prepareEdit = () => true;
  assert.throws(() => importText(s, '<Grid'), /Unclosed/);
  assert.equal(s.stores.length, 0);
});
