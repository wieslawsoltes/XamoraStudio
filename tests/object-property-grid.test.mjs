import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { ObjectPropertyGrid } from '../dist/controls/object-property-grid.js';
import {
  inspectObjectProperties,
  editObjectProperty,
  cloneObjectGraph,
  objectPathKey,
  getObjectProperty,
} from '../dist/controls/object-properties.js';
import { PropertyGrid } from '../dist/controls/property-grid.js';
import { LabHost } from '../dist/examples/WorkspaceLab/host.js';
import { DataEditor } from '../dist/workspaces/data-editor.js';
function fixture(t, options = {}) {
  const dom = controlDOM(t),
    root = dom.host();
  const grid = new ObjectPropertyGrid(root, {
    value: { name: 'Alice', address: { city: 'Warsaw' }, tags: ['first'], enabled: true },
    ...options,
  });
  t.after(() => grid.dispose());
  return { ...dom, root, grid, input: (path) => grid.grid.fields.get(objectPathKey(path)).input };
}
test('inspection discovers nested arrays, null and scalar types without evaluating getters', () => {
  let calls = 0;
  const value = {
    a: { b: [1, null] },
    get secret() {
      calls++;
      throw Error('getter');
    },
  };
  const tree = inspectObjectProperties(value);
  assert.equal(calls, 0);
  assert.equal(tree.children[1].kind, 'accessor');
  assert(tree.children[1].readOnly);
  assert.equal(tree.children[0].children[0].children[1].kind, 'null');
  assert.throws(() => getObjectProperty(value, ['secret']), /own data/);
  assert.equal(calls, 0);
});
test('inspection marks cycles and respects depth and entry limits without dropping inspected children', () => {
  const value = { a: { b: 1 }, c: 2 };
  value.self = value;
  assert.equal(inspectObjectProperties(value).children[2].note, 'Circular reference');
  const capped = inspectObjectProperties(value, { maxEntries: 2 });
  assert(capped.truncated);
  assert.equal(capped.children[0].children.length, 1);
  assert.equal(inspectObjectProperties(value, { maxDepth: 0 }).note, 'Maximum depth reached');
  assert.throws(() => inspectObjectProperties(value, { maxEntries: 0 }), /maxEntries/);
});
test('graph cloning and editing preserve cycles, aliases, descriptors and the immutable original', () => {
  const shared = { value: 1 };
  const value = { a: shared, b: shared };
  value.self = value;
  const next = editObjectProperty(value, ['a', 'value'], 2);
  assert.equal(next.a, next.b);
  assert.equal(next.self, next);
  assert.equal(next.a.value, 2);
  assert.equal(value.a.value, 1);
  assert.equal(
    Object.getOwnPropertyDescriptor(cloneObjectGraph(Object.freeze({ a: 1 })), 'a').writable,
    false,
  );
  assert.throws(() => cloneObjectGraph(value, { maxNodes: 1 }), /Maximum object/);
});
test('path segments do not split dots or write through prototypes', () => {
  const value = JSON.parse('{"a.b":{"__proto__":{"safe":1}},"constructor":2}');
  const next = editObjectProperty(value, ['a.b', '__proto__', 'safe'], 7);
  assert.equal(next['a.b'].__proto__.safe, 7);
  assert.equal({}.safe, undefined);
  const added = editObjectProperty({}, ['__proto__'], { flag: true }, { operation: 'add' });
  assert.equal(Object.getPrototypeOf(added), Object.prototype);
  assert.equal({}.flag, undefined);
  assert.throws(() => editObjectProperty({}, ['constructor', 'polluted'], true), /own data/);
});
test('read-only properties and accessors cannot be modified or traversed', () => {
  const value = {
    get x() {
      throw Error('getter');
    },
  };
  Object.defineProperty(value, 'fixed', { value: { x: 1 }, enumerable: true });
  assert.throws(() => editObjectProperty(value, ['x'], 2), /own data/);
  assert.throws(() => editObjectProperty(value, ['fixed', 'x'], 2), /read-only/);
  assert.throws(
    () => editObjectProperty(Object.preventExtensions({}), ['x'], 2, { operation: 'add' }),
    /new properties/,
  );
});
test('array append and removal shift indices without modifying source or invoking accessors', () => {
  const value = { items: [1, 2] };
  const next = editObjectProperty(value, ['items', 2], 3, { operation: 'add' });
  assert.deepEqual(
    editObjectProperty(next, ['items', 1], undefined, { operation: 'remove' }).items,
    [1, 3],
  );
  assert.deepEqual(value.items, [1, 2]);
  assert.throws(() => editObjectProperty(value, ['items', 5], 2, { operation: 'add' }), /appended/);
  let calls = 0;
  Object.defineProperty(value.items, '1', {
    get() {
      calls++;
      return 2;
    },
    configurable: true,
  });
  assert.throws(
    () => editObjectProperty(value, ['items', 0], null, { operation: 'remove' }),
    /accessor/,
  );
  assert.equal(calls, 0);
});
test('a bounded tree with truncated children remains filterable', (t) => {
  const { grid } = fixture(t, { value: { a: { b: 1 }, c: 2 }, maxEntries: 2 });
  grid.setFilter('b');
  assert.equal(grid.entries.get('["a","b"]').element.hidden, false);
});
test('accepted nested edits retain input identity, selection and alias displays', (t) => {
  const shared = { city: 'Warsaw' };
  let change;
  const { grid, input, window } = fixture(t, {
    value: { a: shared, b: shared },
    onChange: (c) => {
      change = c;
    },
  });
  grid.setExpanded(['a'], true);
  const el = input(['a', 'city']);
  el.focus();
  el.value = 'Krakow';
  el.setSelectionRange(2, 4);
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(input(['a', 'city']), el);
  assert.equal(el.selectionStart, 2);
  assert.equal(input(['b', 'city']).value, 'Krakow');
  assert.equal(change.previous.a.city, 'Warsaw');
  assert.equal(change.next.a.city, 'Krakow');
  assert.equal(change.next.a, change.next.b);
});
test('rejected changes restore the committed display and report an accessible error', (t) => {
  const { grid, input, window, root } = fixture(t, { onChange: () => 'Not allowed' });
  const el = input(['name']);
  el.value = 'Bob';
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(el.value, 'Alice');
  assert.equal(grid.value.name, 'Alice');
  assert.match(root.querySelector('[role="alert"]').textContent, /Not allowed/);
});
test('callbacks cannot overwrite a newer setValue or a disposed control', (t) => {
  const { grid } = fixture(t);
  grid.onChange = () => grid.setValue({ fresh: true });
  assert(grid.setProperty(['name'], 'Bob'));
  assert.deepEqual(grid.value, { fresh: true });
  grid.onChange = () => grid.dispose();
  assert(grid.setProperty(['fresh'], false));
  assert(grid.disposed);
});
test('asynchronous commit providers are rejected without unhandled promise errors', async (t) => {
  const { grid } = fixture(t, {
    onChange: async () => {
      throw Error('later');
    },
  });
  assert.equal(grid.setProperty(['name'], 'Bob'), false);
  assert.equal(grid.value.name, 'Alice');
  await Promise.resolve();
});
test('add, remove, change type and reset use immutable path events', (t) => {
  const events = [];
  const { grid } = fixture(t, { onChange: (e) => events.push(e) });
  assert(grid.addProperty(['address'], 'zip', 123));
  assert.equal(grid.value.address.zip, 123);
  assert(grid.removeProperty(['tags', 0]));
  assert.deepEqual(grid.value.tags, []);
  assert(grid.setProperty(['name'], { first: 'A' }));
  assert(grid.setProperty(['name', 'first'], 'B'));
  assert(grid.reset(['name']));
  assert.equal(grid.value.name, 'Alice');
  assert.equal(events.at(-1).reset, true);
});
test('search expands matching descendants and restores explicit collapse afterwards', (t) => {
  const { grid } = fixture(t);
  const branch = grid.entries.get('["address"]');
  assert(branch.children.hidden);
  grid.setFilter('city');
  assert(!branch.children.hidden);
  assert(!grid.entries.get('["address","city"]').element.hidden);
  grid.setFilter('');
  assert(branch.children.hidden);
  grid.setExpanded(['address'], true);
  assert(!branch.children.hidden);
});
test('read-only and structure policies reject edits without a callback', (t) => {
  const { grid } = fixture(t, { readOnly: true, onChange: () => assert.fail('callback') });
  assert.equal(grid.setProperty(['name'], 'B'), false);
  assert.equal(grid.addProperty([], 'other', 1), false);
});
test('replacement and disposal detach callbacks from retained elements and release host ownership', (t) => {
  const { grid, root, window } = fixture(t);
  assert.throws(() => new ObjectPropertyGrid(root), /Dispose/);
  const old = root.querySelector('select');
  const callback = old.onchange;
  grid.setValue({ fresh: 1 });
  callback();
  assert.deepEqual(grid.value, { fresh: 1 });
  grid.dispose();
  old.dispatchEvent(new window.Event('change'));
  assert.equal(root.children.length, 0);
  assert.equal(grid.setProperty(['fresh'], 2), false);
  const next = new ObjectPropertyGrid(root, { value: { fresh: 2 } });
  next.dispose();
});
test('scalar batch value updates validate atomically and retain controls', (t) => {
  const { host } = controlDOM(t),
    grid = new PropertyGrid(host(), {
      properties: [
        { name: 'a', value: 1 },
        { name: 'b', value: 2 },
      ],
    });
  t.after(() => grid.dispose());
  const input = grid.fields.get('a').input;
  assert.throws(
    () =>
      grid.updateValues(
        new Map([
          ['a', 3],
          ['missing', 4],
        ]),
      ),
    /Unknown/,
  );
  assert.equal(grid.getValue('a'), 1);
  grid.updateValues(
    new Map([
      ['a', 3],
      ['b', 4],
    ]),
  );
  assert.equal(grid.fields.get('a').input, input);
  assert.equal(input.value, '3');
});
test('data-workspace object editing uses its owning document transaction and undo', (t) => {
  const dom = controlDOM(t),
    host = new LabHost(dom.host(), dom.host()),
    data = new DataEditor(host);
  host.data = data;
  t.after(() => {
    data.dispose();
    host.dispose();
  });
  data.mode = 'objects';
  data.open();
  const before = JSON.stringify(data.db.objects);
  assert(data.objectGrid instanceof ObjectPropertyGrid);
  assert(data.objectGrid.addProperty([], 'Nested', { values: [1, 2] }));
  assert(data.objectGrid.setProperty(['Nested', 'values', 1], 7));
  assert.deepEqual(data.db.objects.Nested.values, [1, 7]);
  host.store.undo();
  assert.deepEqual(data.db.objects.Nested.values, [1, 2]);
  host.store.undo();
  assert.equal(JSON.stringify(data.db.objects), before);
  const grid = data.objectGrid;
  data.open();
  assert(grid.disposed);
  data.dispose();
  assert.equal(data.objectGrid, null);
});
