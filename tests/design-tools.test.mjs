import test from 'node:test';
import assert from 'node:assert/strict';
import { element, createDocument, find, clone, DocumentStore } from '../dist/core/model.js';
import { builtins } from '../dist/core/registry.js';
import { parseXaml } from '../dist/core/xaml.js';
import {
  contentChildren,
  logicalParent,
  orderedSelection,
  isLocked,
  HitTestService,
  gridTrackIndex,
  planDrop,
  applyDropPlan,
  definitions,
  writeDefinitions,
  insertTrack,
  removeTrack,
  reconcileIdentities,
} from '../dist/core/design-tools.js';
const registry = builtins();
const document = (...children) => createDocument(element('Canvas', {}, children));
test('content wrappers participate in logical parent and ordered selection', () => {
  const child = element('Button'),
    panel = element('StackPanel', {}, [element('StackPanel.Children', {}, [child])]),
    doc = document(panel);
  assert.deepEqual(contentChildren(panel), [child]);
  assert.equal(logicalParent(doc.root, child.id), panel);
  assert.deepEqual(orderedSelection(doc.root, [child.id, panel.id]), [panel]);
});
test('metadata locking applies to descendants and accepts legacy map shape', () => {
  const child = element('Button'),
    parent = element('Grid', {}, [child]),
    doc = document(parent);
  doc.metadata.locked = [parent.id];
  assert.equal(isLocked(doc, child.id), true);
  doc.metadata.locked = { [parent.id]: true };
  assert.equal(isLocked(doc, child.id), true);
});
test('tree reorder keeps canvas coordinates, margins, and attached properties', () => {
  const a = element('Button', { 'Canvas.Left': '120', 'Canvas.Top': '80', Margin: '4' }),
    b = element('Button'),
    doc = document(a, b);
  const plan = planDrop({
    root: doc.root,
    registry,
    ids: [b.id],
    parentId: doc.root.id,
    beforeId: a.id,
    preserveLayout: true,
  });
  applyDropPlan(doc, plan);
  assert.equal(doc.root.children[0], b);
  assert.equal(a.props['Canvas.Left'], '120');
  assert.deepEqual(b.props, {});
});
test('multi-layer canvas drop preserves relative offsets and pointer grab', () => {
  const a = element('Button'),
    b = element('Button'),
    target = element('Canvas'),
    doc = document(a, b, target);
  const plan = planDrop({
    root: doc.root,
    registry,
    ids: [a.id, b.id],
    parentId: target.id,
    point: { x: 200, y: 150 },
    grab: { x: 10, y: 5 },
    originalRects: {
      [a.id]: { x: 20, y: 40, width: 50, height: 30 },
      [b.id]: { x: 100, y: 80, width: 80, height: 30 },
    },
  });
  applyDropPlan(doc, plan);
  assert.equal(a.props['Canvas.Left'], '190');
  assert.equal(b.props['Canvas.Left'], '270');
  assert.equal(b.props['Canvas.Top'], '185');
  assert.equal(b.props.Width, '80');
});
test('drop planning rejects cycles, roots, invalid anchors, and single-child overflow', () => {
  const child = element('Grid'),
    parent = element('Grid', {}, [child]),
    single = element('Border', {}, [element('TextBlock')]),
    doc = document(parent, single);
  for (const args of [
    { ids: [parent.id], parentId: child.id },
    { ids: [doc.root.id], parentId: child.id },
    { ids: [child.id], parentId: single.id },
    { ids: [child.id], parentId: doc.root.id, beforeId: 'missing' },
  ])
    assert.equal(planDrop({ root: doc.root, registry, ...args }).allowed, false);
});
test('drop commit is one undoable edit including wrapper insertion', () => {
  const child = element('Button', { 'Canvas.Left': '17' }),
    target = element('StackPanel', {}, [element('StackPanel.Children')]),
    store = new DocumentStore(document(child, target)),
    before = clone(store.document);
  const plan = planDrop({
    root: store.document.root,
    registry,
    ids: [child.id],
    parentId: target.id,
  });
  store.transaction('Drop', (d) => applyDropPlan(d, plan));
  assert.equal(contentChildren(find(store.document.root, target.id))[0].id, child.id);
  assert.equal(store.history.length, 1);
  store.undo();
  assert.deepEqual(store.document, before);
});
test('measured unequal grid tracks and gaps resolve exact cells', () => {
  assert.equal(gridTrackIndex([80, 240, 160], 79), 0);
  assert.equal(gridTrackIndex([80, 240, 160], 81), 1);
  assert.equal(gridTrackIndex([80, 240, 160], 350), 2);
  assert.equal(gridTrackIndex([80, 240], 84, 10), 0);
  assert.equal(gridTrackIndex([80, 240], 86, 10), 1);
});
test('grid insert and delete adjust cells, spans, and retain definition metadata', () => {
  const child = element('Button', { 'Grid.Row': '1', 'Grid.RowSpan': '2' }),
    grid = element('Grid', { RowDefinitions: '100,2*,Auto' }, [child]);
  const list = definitions(grid, 'Row');
  list[0].props.SharedSizeGroup = 'Labels';
  writeDefinitions(grid, 'Row', list);
  insertTrack(grid, 'Row', 2);
  assert.equal(child.props['Grid.RowSpan'], '3');
  removeTrack(grid, 'Row', 0);
  assert.equal(child.props['Grid.Row'], '0');
  assert.equal(definitions(grid, 'Row').length, 3);
});
test('draft track edits leave live document unchanged until transaction and undo', () => {
  const grid = element('Grid', { RowDefinitions: '100,*' }),
    store = new DocumentStore(createDocument(grid));
  store.transaction('Initialize tracks', () =>
    writeDefinitions(store.document.root, 'Row', definitions(store.document.root, 'Row')),
  );
  const before = clone(store.document),
    draft = clone(definitions(store.document.root, 'Row'));
  draft[0].props.Height = '250';
  assert.equal(definitions(store.document.root, 'Row')[0].props.Height, '100');
  store.transaction('Apply draft', () => writeDefinitions(store.document.root, 'Row', draft));
  store.undo();
  assert.deepEqual(store.document, before);
});
test('applying edited XAML retains named interaction identities after reorder', () => {
  const old = parseXaml(
      '<Grid xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><Button x:Name="A"/><Button x:Name="B"/></Grid>',
    ),
    next = parseXaml(
      '<Grid xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><Button x:Name="B" Content="Changed"/><Button x:Name="A"/></Grid>',
    );
  reconcileIdentities(old.root, next.root);
  assert.equal(next.root.id, old.root.id);
  assert.equal(next.root.children[0].id, old.root.children[1].id);
  assert.equal(next.root.children[1].id, old.root.children[0].id);
});
test('deep hit fallback puts disabled descendant before ancestor and cycles nested layers', () => {
  const button = element('Button'),
    grid = element('Grid', {}, [button]),
    doc = createDocument(grid),
    box = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
  const el = (n) => ({
    dataset: { nodeId: n.id },
    getBoundingClientRect: () => box,
    closest() {
      return this;
    },
    parentElement: null,
  });
  const gridEl = el(grid),
    buttonEl = el(button);
  globalThis.document = { body: {}, elementsFromPoint: () => [gridEl] };
  globalThis.getComputedStyle = () => ({
    display: 'block',
    visibility: 'visible',
    overflow: 'visible',
  });
  const studio = {
    doc,
    renderer: {
      elements: new Map([
        [grid.id, gridEl],
        [button.id, buttonEl],
      ]),
    },
    store: { selection: [grid.id], revision: 0 },
  };
  const hit = new HitTestService(studio);
  assert.equal(hit.pick(20, 20, { deep: true }).id, button.id);
  assert.equal(hit.pick(20, 20).id, grid.id);
  assert.equal(hit.pick(20, 20, { cycle: true }).id, button.id);
  assert.equal(hit.pick(20, 20, { cycle: true }).id, grid.id);
  doc.metadata.locked = [button.id];
  assert.equal(hit.stack(20, 20)[0].id, grid.id);
  studio.features = { isolationId: button.id };
  assert.equal(hit.stack(20, 20).length, 0);
});
test('smart snapping aligns an edge or center only within its tolerance', async () => {
  const { snapBounds } = await import('../dist/core/design-tools.js');
  const snapped = snapBounds(
    { x: 97, y: 20, width: 40, height: 30 },
    [{ x: 100, y: 100, width: 40, height: 30 }],
    5,
  );
  assert.equal(snapped.x, 100);
  assert.equal(snapped.y, 20);
  assert.equal(snapped.guides.length, 1);
  const far = snapBounds(
    { x: 80, y: 20, width: 10, height: 10 },
    [{ x: 100, y: 100, width: 40, height: 30 }],
    5,
  );
  assert.equal(far.x, 80);
});
