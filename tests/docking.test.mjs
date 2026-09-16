import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DockLayout,
  createDockLayout,
  dockGroup,
  dockSplit,
  findDock,
  dockGroups,
  locatePanel,
  validateDockLayout,
  clampFloat,
} from '../dist/core/docking.js';
const tools = [
  'layers',
  'toolkit',
  'assets',
  'data',
  'properties',
  'raw',
  'flow',
  'inspect',
  'notes',
  'timeline',
  'problems',
];
const panels = [
  ...tools.map((id) => ({ id, kind: 'tool' })),
  ...['document:one', 'document:two', 'xaml', 'views'].map((id) => ({ id, kind: 'document' })),
];
function model(preset = 'designer') {
  return new DockLayout(
    panels,
    createDockLayout(
      panels.map((p) => p.id),
      { documents: ['document:one', 'document:two'], preset },
    ),
  );
}
const check = (m) => validateDockLayout(m.state, new Set(m.panels.keys()));
const groupOf = (m, id) => locatePanel(m.state, id)?.group;
function inventory(m) {
  return [
    ...dockGroups(m.state).flatMap((g) => g.panels),
    ...Object.values(m.state.autoHide).flat(),
    ...m.state.hidden,
  ].sort();
}
test('all workspace presets preserve every registered panel exactly once', () => {
  for (const preset of ['designer', 'coding', 'animation', 'compact']) {
    const m = model(preset);
    check(m);
    assert.deepEqual(inventory(m), panels.map((p) => p.id).sort());
  }
});
test('tab reordering adjusts insertion index after removing source', () => {
  const m = model(),
    g = groupOf(m, 'layers');
  m.dock('layers', g.id, 'center', 3);
  assert.deepEqual(groupOf(m, 'layers').panels, ['toolkit', 'assets', 'layers', 'data']);
  m.dock('data', g.id, 'center', 0);
  assert.deepEqual(groupOf(m, 'layers').panels, ['data', 'toolkit', 'assets', 'layers']);
});
test('moving a nested single tab collapses only the empty source split', () => {
  const m = model(),
    source = groupOf(m, 'xaml').id,
    target = groupOf(m, 'document:one').id;
  m.dock('xaml', target);
  assert.equal(findDock(m.state, source), null);
  assert.deepEqual(groupOf(m, 'xaml').panels, ['document:one', 'document:two', 'xaml']);
  check(m);
});
test('vertical and horizontal groups use the requested axis', () => {
  const m = model();
  m.dock('document:two', groupOf(m, 'document:one').id, 'right');
  const right = groupOf(m, 'document:two');
  assert.notEqual(right.id, groupOf(m, 'document:one').id);
  m.dock('toolkit', groupOf(m, 'layers').id, 'bottom');
  check(m);
  assert.equal(groupOf(m, 'layers').panels.includes('toolkit'), false);
});
test('invalid target and self split roll back the entire operation and history', () => {
  const m = model(),
    before = m.serialize(),
    history = m.history.length;
  assert.throws(() => m.dock('layers', 'missing', 'left'));
  assert.throws(() => m.dock(groupOf(m, 'layers').panels, groupOf(m, 'layers').id, 'left'));
  assert.equal(m.serialize(), before);
  assert.equal(m.history.length, history);
});
test('docking extracted panels around their ancestor does not create cycles', () => {
  const m = model(),
    rootId = m.state.root.id;
  m.dock(['layers', 'toolkit'], rootId, 'bottom');
  check(m);
  assert.deepEqual(groupOf(m, 'layers').panels, ['layers', 'toolkit']);
  assert.ok(m.serialize().length < 10000);
});
test('whole tool groups float together and source cleanup preserves other panels', () => {
  const m = model(),
    ids = [...groupOf(m, 'layers').panels];
  m.float(ids, { x: 80, y: 50, width: 500, height: 350 });
  assert.equal(m.state.floating.length, 1);
  assert.deepEqual(m.state.floating[0].root.panels, ids);
  assert.equal(locatePanel(m.state, 'properties').floating, null);
  check(m);
});
test('floating groups can receive nested splits and tabs', () => {
  const m = model();
  m.float('layers');
  const float = m.state.floating[0];
  m.dock('toolkit', float.root.id, 'bottom');
  assert.equal(m.state.floating[0].root.type, 'split');
  m.dock('assets', groupOf(m, 'toolkit').id, 'center');
  check(m);
  assert.deepEqual(groupOf(m, 'assets').panels, ['toolkit', 'assets']);
});
test('dock back restores an existing group and saved position', () => {
  const m = model(),
    original = groupOf(m, 'toolkit').id;
  m.float('toolkit');
  m.dockBack('toolkit');
  assert.equal(groupOf(m, 'toolkit').id, original);
  assert.deepEqual(groupOf(m, 'toolkit').panels, ['layers', 'toolkit', 'assets', 'data']);
  assert.equal(m.state.floating.length, 0);
});
test('dock back creates an edge group if the original group was removed', () => {
  const m = model();
  m.float([...groupOf(m, 'layers').panels]);
  m.dockBack('layers');
  check(m);
  assert.equal(locatePanel(m.state, 'layers').floating, null);
  assert.equal(m.state.floating[0].root.panels.includes('layers'), false);
});
test('auto-hide roundtrip keeps panel identity and return location', () => {
  const m = model(),
    original = groupOf(m, 'properties').id;
  m.autoHide('properties', 'left');
  assert.equal(locatePanel(m.state, 'properties').edge, 'left');
  m.activate('properties');
  assert.equal(m.state.activePanel, 'properties');
  m.dockBack('properties');
  assert.equal(groupOf(m, 'properties').id, original);
  assert.equal(m.state.autoHide.left.length, 0);
});
test('documents cannot auto-hide or join an edge tool group', () => {
  const m = model(),
    before = m.serialize();
  assert.throws(() => m.autoHide('document:one'));
  assert.throws(() => m.dock('document:one', groupOf(m, 'layers').id, 'center'));
  assert.equal(m.serialize(), before);
});
test('tools can be docked into a document well', () => {
  const m = model();
  m.dock('properties', groupOf(m, 'document:one').id, 'center');
  assert.equal(groupOf(m, 'properties').kind, 'document');
  check(m);
});
test('closing all windows and reopening a document gives a valid root', () => {
  const m = model();
  m.hide([...m.panels.keys()]);
  assert.equal(m.state.root, null);
  assert.equal(m.state.activePanel, null);
  m.show('document:one');
  assert.equal(m.state.root.kind, 'document');
  check(m);
});
test('layout undo and redo do not share mutable state with earlier snapshots', () => {
  const m = model(),
    before = m.serialize();
  m.float('layers');
  const after = m.serialize();
  m.undo();
  assert.equal(m.serialize(), before);
  m.redo();
  assert.equal(m.serialize(), after);
  m.resizeSplit(m.state.root.id, 0.32);
  check(m);
});
test('activation leaves layout undo history intact', () => {
  const m = model();
  m.float('layers');
  const count = m.history.length;
  m.activate('toolkit');
  assert.equal(m.history.length, count);
});
test('layout load is validated atomically for duplicate panels and malformed ratios', () => {
  const m = model(),
    before = m.serialize(),
    bad = JSON.parse(before);
  groupOf({ state: bad }, 'layers').panels.push('properties');
  assert.throws(() => m.load(bad));
  const bad2 = JSON.parse(before);
  bad2.root.ratio = Infinity;
  assert.throws(() => m.load(bad2));
  assert.equal(m.serialize(), before);
});
test('layout reconciliation drops stale extension panels and retains new ones as hidden', () => {
  const m = model();
  m.register({ id: 'extension:old', kind: 'tool' });
  m.show('extension:old');
  const saved = m.serialize();
  m.unregister('extension:old');
  m.register({ id: 'extension:new', kind: 'tool' });
  m.load(saved, { reconcile: true });
  assert.equal(locatePanel(m.state, 'extension:old'), null);
  assert.equal(locatePanel(m.state, 'extension:new').kind, 'hidden');
  check(m);
});
test('registration resets stale layout history so undo cannot lose a new panel', () => {
  const m = model();
  m.float('layers');
  m.register({ id: 'extension:new', kind: 'tool' });
  assert.equal(m.undo(), false);
  check(m);
});
test('invalid panel identifiers and unbounded imported layouts are rejected', () => {
  const m = model();
  assert.throws(() => m.register({ id: '__proto__' }));
  assert.throws(() => m.load(' '.repeat(1000001)));
  const bad = JSON.parse(m.serialize());
  bad.placements.layers.index = -1;
  assert.throws(() => m.load(bad));
});
test('floating bounds stay reachable in smaller viewports without changing the model', () => {
  const m = model();
  m.float('layers', { x: 900, y: 700, width: 420, height: 300 });
  const before = m.serialize(),
    rect = clampFloat(m.state.floating[0].rect, 320, 240);
  assert.deepEqual(rect, { x: 0, y: 0, width: 320, height: 240 });
  assert.equal(m.serialize(), before);
  m.maximizeFloat(m.state.floating[0].id);
  assert.equal(m.state.floating[0].maximized, true);
  m.maximizeFloat(m.state.floating[0].id);
  assert.equal(m.state.floating[0].maximized, false);
});
test('group focus and pinned tabs survive serialization and layout restore', () => {
  const m = model();
  m.pin('document:one');
  m.zoomGroup(groupOf(m, 'document:one').id);
  const saved = m.serialize();
  m.hide('toolkit');
  m.load(saved);
  assert.deepEqual(m.state.pinned, ['document:one']);
  assert.ok(m.state.zoomedGroup);
});
test('seeded mixed operations preserve a unique complete inventory', () => {
  const m = model();
  let seed = 987654321;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 400; i++) {
    const id = panels[Math.floor(random() * panels.length)].id,
      op = Math.floor(random() * 6),
      groups = dockGroups(m.state),
      target = groups[Math.floor(random() * groups.length)];
    try {
      if (op === 0) m.hide(id);
      if (op === 1) m.show(id);
      if (op === 2) m.float(id);
      if (op === 3 && tools.includes(id))
        m.autoHide(id, ['left', 'right', 'top', 'bottom'][Math.floor(random() * 4)]);
      if (op === 4 && target)
        m.dock(id, target.id, ['center', 'left', 'bottom'][Math.floor(random() * 3)]);
      if (op === 5) m.undo();
    } catch (error) {
      assert.match(error.message, /group|split|target/i);
    }
    check(m);
    assert.deepEqual(inventory(m), panels.map((p) => p.id).sort());
  }
});
test('standalone model supports the XAML source as its only document', () => {
  const m = new DockLayout([{ id: 'xaml', kind: 'document' }]);
  check(m);
  assert.deepEqual(inventory(m), ['xaml']);
});
test('joining a floating tab group does not overwrite the last docked return position', () => {
  const m = model(),
    old = groupOf(m, 'toolkit').id;
  m.float('layers');
  m.dock('toolkit', groupOf(m, 'layers').id);
  assert.ok(locatePanel(m.state, 'toolkit').floating);
  m.dockBack('toolkit');
  assert.equal(locatePanel(m.state, 'toolkit').floating, null);
  assert.equal(groupOf(m, 'toolkit').id, old);
});
test('floating coordinates are not constrained to an assumed desktop size', () => {
  const m = model();
  m.float('layers', { x: 1500, y: 900, width: 400, height: 300 });
  assert.deepEqual(locatePanel(m.state, 'layers').floating.rect, {
    x: 1500,
    y: 900,
    width: 400,
    height: 300,
  });
  m.dockBack('layers');
  m.float('layers');
  assert.deepEqual(locatePanel(m.state, 'layers').floating.rect, {
    x: 1500,
    y: 900,
    width: 400,
    height: 300,
  });
});
test('imported layouts cannot bypass document auto-hide restrictions', () => {
  const m = model(),
    saved = JSON.parse(m.serialize()),
    g = groupOf({ state: saved }, 'document:two');
  g.panels = g.panels.filter((p) => p !== 'document:two');
  saved.autoHide.left.push('document:two');
  assert.throws(() => m.load(saved), /auto-hide/);
});
test('auto-hide window sizes and floating activation order are restored', () => {
  const m = model();
  m.setAutoHideSize('left', 420);
  m.float('layers');
  const first = m.state.floating[0].id;
  m.float('toolkit');
  m.raiseFloat(first);
  assert.equal(m.state.floating.at(-1).id, first);
  const saved = m.serialize();
  m.load(saved);
  assert.equal(m.state.autoHideSize.left, 420);
});

test('imported document windows require document groups atomically', () => {
  const m = model(),
    before = m.serialize(),
    saved = JSON.parse(before);
  groupOf({ state: saved }, 'document:one').kind = 'tool';
  assert.throws(() => m.load(saved), /document group/);
  assert.equal(m.serialize(), before);
});

test('layout batches emit one event, make one undo step, and rollback all failed operations', () => {
  const m = model(),
    before = m.serialize(),
    labels = [];
  m.addEventListener('change', (e) => labels.push(e.label));
  m.batch('Arrange', (dock) => {
    dock.float('layers');
    dock.hide('properties');
  });
  assert.deepEqual(labels, ['Arrange']);
  assert.equal(m.history.length, 1);
  m.undo();
  assert.equal(m.serialize(), before);
  const history = m.history.length;
  assert.throws(() =>
    m.batch('Invalid', (dock) => {
      dock.float('layers');
      dock.dock('xaml', 'missing');
    }),
  );
  assert.equal(m.serialize(), before);
  assert.equal(m.history.length, history);
  assert.throws(() => m.batch('Registration', (dock) => dock.register({ id: 'new' })), /outside/);
  assert.equal(m.panels.has('new'), false);
});
test('editor mode snapshots are serialized but cannot recursively contain snapshots', () => {
  const m = model(),
    before = structuredClone(m.state);
  m.transaction('Remember mode', (d) => (d.modeRestore = before));
  const serialized = m.serialize();
  m.load(serialized);
  assert.deepEqual(m.state.modeRestore, before);
  const bad = JSON.parse(serialized);
  bad.modeRestore.modeRestore = before;
  assert.throws(() => m.load(bad), /Nested/);
  assert.equal(m.serialize(), serialized);
});
