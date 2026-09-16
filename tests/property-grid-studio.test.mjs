import test from 'node:test';
import assert from 'node:assert/strict';
import { Studio } from '../dist/studio/studio.js';
import { PropertyGrid } from '../dist/controls/property-grid.js';
import { DocumentStore, createDocument, element } from '../dist/core/model.js';
import { builtins } from '../dist/core/registry.js';
import { controlDOM } from './control-fixture.mjs';

function fixture(t, docked) {
  const dom = controlDOM(t);
  const s = Object.create(Studio.prototype);
  s.active = 0;
  s.rightTab = 'design';
  s.registry = builtins();
  s.stores = [new DocumentStore(createDocument(element('Button', { Width: '120' })))];
  s.store.select([s.doc.root.id]);
  if (docked) {
    for (const mode of ['design', 'inspect', 'notes']) dom.host().dataset.inspectorHost = mode;
  } else dom.host().id = 'inspector';
  t.after(() => s.propertyGrid?.dispose());
  s.renderInspector();
  return { ...dom, s };
}

test('separate docked inspector refreshes preserve the live property grid and its filtering', (t) => {
  const { s, document, window } = fixture(t, true);
  const grid = s.propertyGrid;
  const input = grid.fields.get('Width').input;
  assert(grid instanceof PropertyGrid);
  for (const mode of ['inspect', 'notes']) {
    s.rightTab = mode;
    s.renderInspector();
    assert.equal(s.propertyGrid, grid);
    assert.equal(grid.disposed, false);
    assert.equal(grid.fields.get('Width').input, input);
    assert(input.isConnected);
  }
  const search = document.querySelector('#property-search');
  search.value = 'Width';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(grid.filter, 'Width');
  assert.equal(grid.fields.get('Width').field.hidden, false);
  assert.equal(grid.fields.get('Height').field.hidden, true);
});

test('replacing the design inspector or clearing selection disposes only the previous grid', (t) => {
  const { s } = fixture(t, true);
  const old = s.propertyGrid;
  s.renderInspector();
  assert(old.disposed);
  assert.notEqual(s.propertyGrid, old);
  assert(s.propertyGrid.host.isConnected);
  const next = s.propertyGrid;
  s.store.select([]);
  s.renderInspector();
  assert(next.disposed);
  assert.equal(s.propertyGrid, null);
});

test('undocked inspectors release the grid when their shared panel changes modes', (t) => {
  const { s } = fixture(t, false);
  const old = s.propertyGrid;
  s.rightTab = 'inspect';
  s.renderInspector();
  assert(old.disposed);
  assert.equal(s.propertyGrid, null);
  s.rightTab = 'design';
  s.renderInspector();
  assert(s.propertyGrid instanceof PropertyGrid);
});
