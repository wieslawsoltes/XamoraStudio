import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { OutlineTree } from '../dist/controls/outline-tree.js';
import { controlDOM } from './control-fixture.mjs';
const items = [
  { id: 'root', label: 'Root' },
  { id: 'a', parentId: 'root', label: 'Alpha' },
  { id: 'a1', parentId: 'a', label: 'Nested', detail: '#Café' },
  { id: 'b', parentId: 'root', label: 'Bravo' },
  { id: 'c', parentId: 'root', label: 'Beta' },
];
function setup(t, options = {}) {
  const dom = controlDOM(t),
    selected = [],
    activated = [];
  const tree = new OutlineTree(dom.host(), {
    items,
    onSelect: (id) => selected.push(id),
    onActivate: (id) => activated.push(id),
    ...options,
  });
  t.after(() => tree.dispose());
  const key = (k) =>
    tree.element.dispatchEvent(
      new tree.element.ownerDocument.defaultView.KeyboardEvent('keydown', {
        key: k,
        bubbles: true,
        cancelable: true,
      }),
    );
  return { ...dom, tree, key, selected, activated };
}
test('tree declares hierarchy ownership, positions, state and unique active-descendant IDs', (t) => {
  const { tree } = setup(t);
  tree.focus('a1');
  assert.equal(tree.element.getAttribute('role'), 'tree');
  const row = tree.rows.get('a1'),
    group = row.parentElement;
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.parentElement.dataset.outlineId, 'a');
  assert.equal(row.getAttribute('aria-level'), '3');
  assert.equal(row.getAttribute('aria-posinset'), '1');
  assert.equal(row.getAttribute('aria-setsize'), '1');
  assert.equal(row.getAttribute('aria-expanded'), null);
  assert.equal(tree.element.getAttribute('aria-activedescendant'), row.id);
  assert.equal(tree.rows.get('a').getAttribute('aria-expanded'), 'true');
});
test('keyboard movement is separate from selection and activation', (t) => {
  const { tree, key, selected, activated } = setup(t);
  tree.focus('root');
  key('ArrowRight');
  assert.equal(tree.activeId, 'a');
  key('ArrowRight');
  assert.equal(tree.activeId, 'a1');
  key('ArrowDown');
  assert.equal(tree.activeId, 'b');
  assert.deepEqual(selected, []);
  assert.deepEqual(activated, []);
  key(' ');
  assert.deepEqual(selected, ['b']);
  key('Enter');
  assert.deepEqual(activated, ['b']);
  key('Home');
  assert.equal(tree.activeId, 'root');
  key('End');
  assert.equal(tree.activeId, 'c');
});
test('collapse and expand follow active ancestors without changing selected application data', (t) => {
  const { tree, key, selected } = setup(t);
  tree.select('a1', { reveal: true });
  tree.setCollapsed('a');
  assert.equal(tree.activeId, 'a');
  assert.equal(tree.selectedId, 'a1');
  key('ArrowRight');
  assert.equal(tree.activeId, 'a');
  key('ArrowRight');
  assert.equal(tree.activeId, 'a1');
  key('ArrowLeft');
  assert.equal(tree.activeId, 'a');
  tree.collapseAll();
  assert.equal(tree.visible.length, 1);
  tree.expandAll();
  assert.equal(tree.visible.length, 5);
  assert.deepEqual(selected, []);
});
test('filtered results retain ancestor paths and branch state; accent-insensitive matches use AND terms', (t) => {
  const { tree } = setup(t);
  tree.setCollapsed('a');
  tree.setFilter('nested cafe');
  assert.deepEqual(
    tree.visible.map((x) => x.item.id),
    ['root', 'a', 'a1'],
  );
  assert.equal(tree.matchCount, 1);
  assert(tree.collapsed.has('a'));
  tree.setFilter('no match');
  assert.equal(tree.visible.length, 0);
  assert.equal(tree.element.getAttribute('aria-activedescendant'), null);
  tree.setFilter('');
  assert.equal(tree.visible.length, 4);
  assert(tree.collapsed.has('a'));
});
test('typeahead cycles repeated characters and searches prefix sequences', (t) => {
  const { tree, key } = setup(t);
  tree.focus('root');
  key('b');
  assert.equal(tree.activeId, 'b');
  key('b');
  assert.equal(tree.activeId, 'c');
  tree.typedAt = 0;
  key('n');
  key('e');
  assert.equal(tree.activeId, 'a1');
});
test('10,000-item viewport mounts visible rows and active ancestry instead of the entire tree', (t) => {
  const list = [
    { id: 'root', label: 'Root' },
    ...Array.from({ length: 10000 }, (_, i) => ({
      id: 'r' + i,
      parentId: 'root',
      label: 'Row ' + i,
    })),
  ];
  const { tree } = setup(t, { items: list });
  tree.focus('r9999');
  assert(tree.rows.size < 40);
  assert(tree.rows.has('root'));
  assert(tree.rows.has('r9999'));
  tree.element.scrollTop = 0;
  tree.render();
  assert(tree.rows.has('r9999'), 'active descendant stays present when pointer scrolls away');
  assert(tree.rows.size < 40);
  assert.equal(tree.rows.get('r9999').getAttribute('aria-setsize'), '10000');
});
test('row data is text-only and caller data cannot mutate the control', (t) => {
  const list = [{ id: 'x', label: '<img src=x onerror=alert(1)>', detail: '<script>bad</script>' }];
  const { tree } = setup(t, { items: list });
  list[0].label = 'mutated';
  assert.match(tree.rows.get('x').textContent, /<img/);
  assert.equal(tree.element.querySelector('img,script'), null);
});
test('invalid datasets and view state are rejected atomically', (t) => {
  const { tree } = setup(t);
  const before = tree.getState();
  for (const data of [
    [{ id: 'a' }, { id: 'a' }],
    [{ id: 'x', parentId: 'missing' }],
    [{ id: '' }],
    {},
  ])
    assert.throws(() => tree.setItems(data), TypeError);
  assert.equal(tree.data.byId.size, 5);
  assert.deepEqual(tree.getState(), before);
  assert.throws(() => tree.restoreState({ collapsed: 'root' }), TypeError);
  assert.throws(() => tree.restoreState({ scrollTop: NaN }), TypeError);
  assert.throws(() => tree.setRowHeight(0), TypeError);
});
test('restoring document view state prunes removed identifiers without invoking selection callbacks', (t) => {
  const { tree, selected } = setup(t);
  tree.select('a1', { reveal: true });
  tree.setCollapsed('a');
  const saved = tree.getState();
  tree.setItems([{ id: 'new', label: 'New' }]);
  tree.restoreState(saved);
  assert.equal(tree.selectedId, null);
  assert.equal(tree.activeId, 'new');
  assert.equal(tree.collapsed.size, 0);
  tree.setItems(items);
  tree.restoreState(saved);
  assert.equal(tree.selectedId, 'a1');
  assert(tree.collapsed.has('a'));
  assert.deepEqual(selected, []);
});
test('controls with the same item IDs remain independent and host ownership is released on disposal', (t) => {
  const { tree, host } = setup(t);
  const root = host();
  const other = new OutlineTree(root, { items });
  t.after(() => other.dispose());
  assert.throws(() => new OutlineTree(root), /already/);
  assert.notEqual(tree.rows.get('root').id, other.rows.get('root').id);
  tree.setCollapsed('root');
  assert.equal(other.visible.length, 5);
  other.dispose();
  const replacement = new OutlineTree(root);
  replacement.dispose();
});
test('adopted control retains keyboard listeners and schedules with the current document', (t) => {
  const { tree, key, activated } = setup(t);
  const popup = new Window();
  t.after(() => popup.close());
  popup.document.body.append(tree.element);
  tree.focus('b');
  key('Enter');
  assert.deepEqual(activated, ['b']);
  assert.equal(popup.document.activeElement, tree.element);
  tree.schedule();
  assert.equal(tree.frameWindow, popup);
  tree.dispose();
  tree.activate('b');
  assert.deepEqual(activated, ['b']);
  assert.equal(tree.rows.size, 0);
});
test('constructor failure and rejected callback promises neither leak ownership nor escape', async (t) => {
  const { host } = controlDOM(t),
    root = host();
  assert.throws(() => new OutlineTree(root, { items: [{}] }), TypeError);
  const errors = [];
  const tree = new OutlineTree(root, {
    items,
    onActivate: async () => {
      throw Error('rejected');
    },
    onError: (e) => errors.push(e.message),
  });
  t.after(() => tree.dispose());
  tree.activate('a');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(errors, ['rejected']);
  tree.dispose();
  assert.equal(root.children.length, 0);
});
