import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHistoryPatch,
  applyHistoryPatch,
  estimateHistoryBytes,
  validateHistoryValue,
} from '../dist/core/history.js';
import { DocumentStore, element, find, clone } from '../dist/core/model.js';
import { parseXaml } from '../dist/core/xaml.js';
import { DocumentSession } from '../dist/core/document-session.js';
const roundTrip = (before, after) => {
  const patch = createHistoryPatch(before, after);
  assert.ok(patch);
  const next = applyHistoryPatch(before, patch);
  assert.deepEqual(next, after);
  assert.deepEqual(applyHistoryPatch(next, patch, { direction: 'backward' }), before);
  return patch;
};

test('property membership, source strings and original property order reverse exactly', () => {
  const before = JSON.parse(
    '{"__proto__":"safe","a":1,"b":null,"c":false,"source":"<Grid Width=\'12\'/>"}',
  );
  const after = { c: true, a: 1, source: "<Grid Width='123'/>", d: undefined };
  const patch = roundTrip(before, after),
    back = applyHistoryPatch(after, patch, { direction: 'backward' });
  assert.deepEqual(Object.keys(back), Object.keys(before));
  assert.equal(Object.getPrototypeOf(back), Object.prototype);
  assert.equal(back.__proto__, 'safe');
  assert.equal(Object.prototype.safe, undefined);
});
test('one-character source replacement stores only its changed UTF-16 range', () => {
  const source = '<!--' + 'x'.repeat(600000) + '-->\n<Button Content="a"/>',
    next = source.replace('Content="a"', 'Content="b"');
  const patch = roundTrip({ source }, { source: next });
  const text = patch.delta.changes[0].delta;
  assert.equal(text.type, 'text');
  assert.equal(text.removed, 'a');
  assert.equal(text.inserted, 'b');
  assert.ok(patch.estimatedBytes < 2000);
  assert.ok(!JSON.stringify(patch).includes('x'.repeat(100)));
});
test('text patches preserve emoji, CRLF and unpaired HTML source code units', () => {
  for (const [before, after] of [
    ['a😀z', 'a😎z'],
    ['line\r\nnext', 'line\nnext'],
    ['\ud800x', '\ud800y'],
    ['', 'insert'],
    ['delete', ''],
  ])
    roundTrip(before, after);
});
test('stable-ID arrays store compact moves and immutable unchanged child references', () => {
  const before = Array.from({ length: 1000 }, (_, i) => ({
    id: 'n' + i,
    props: { content: 'v'.repeat(500) },
  }));
  const after = before.slice();
  after.splice(10, 0, after.splice(800, 1)[0]);
  const patch = roundTrip(before, after);
  assert.equal(patch.delta.type, 'keyed-array');
  assert.equal(patch.delta.order.type, 'moves');
  assert.ok(patch.estimatedBytes < 2000);
  const applied = applyHistoryPatch(before, patch);
  assert.equal(applied[0], before[0]);
  assert.equal(applied[10], before[800]);
  assert.equal(before[10].id, 'n10');
});
test('keyed array insertion, deletion, reorder and edits compose in both directions', () => {
  const before = [
    { id: 'a', v: 'A' },
    { id: 'b', v: 'B' },
    { id: 'c', v: 'C' },
  ];
  const after = [
    { id: 'c', v: 'C changed' },
    { id: 'new', v: 'N' },
    { id: 'a', v: 'A' },
  ];
  roundTrip(before, after);
  const rows = [
    { _id: '1', fields: { text: 'one' } },
    { _id: '2', fields: { text: 'two' } },
  ];
  roundTrip(rows, [rows[1], { _id: '3', fields: { text: 'three' } }]);
});
test('large reorder falls back to bounded key payload without copying node subtrees', () => {
  const before = Array.from({ length: 100 }, (_, i) => ({
      id: 'node' + i,
      body: 'content'.repeat(100),
    })),
    after = [...before].reverse();
  const patch = roundTrip(before, after);
  assert.equal(patch.delta.order.type, 'splice');
  assert.ok(!JSON.stringify(patch).includes('contentcontent'));
  assert.ok(patch.estimatedBytes < estimateHistoryBytes(before) / 4);
});
test('plain arrays and sparse arrays preserve structure with mixed nested values', () => {
  roundTrip([1, { nested: ['before'] }, 3], [1, { nested: ['after'] }, 3]);
  roundTrip(['a', 'b', 'c'], ['a', 'insert', 'b', 'c']);
  roundTrip([0, 1, 2, 3], [0, 3]);
  const a = [];
  a[4] = 'x';
  const b = [];
  b[2] = 'y';
  roundTrip(a, b);
  roundTrip(
    { date: new Date('2026-01-01'), bytes: new Uint8Array([1, 2]) },
    { date: new Date('2026-01-02'), bytes: new Uint8Array([1, 3]) },
  );
});
test('patch payload owns inserted values and rejects cycles without an infinite traversal', () => {
  const before = { items: [] },
    after = { items: [{ id: 'a', value: 'original' }] };
  const patch = createHistoryPatch(before, after);
  after.items[0].value = 'mutated';
  assert.equal(applyHistoryPatch(before, patch).items[0].value, 'original');
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => validateHistoryValue(cyclic), /cyclic/);
  assert.throws(() => createHistoryPatch({}, cyclic), /cyclic/);
});
test('history preserves transaction hooks, selection and exact draft source across undo redo', () => {
  const text = '<Grid><Button Name="one" Content="Before"/></Grid>',
    store = new DocumentStore(parseXaml(text)),
    session = new DocumentSession(store, { source: text }),
    id = store.document.root.children[0].id;
  store.select([id]);
  session.updateSource(text.replace('Before', 'Typed'));
  store.setProperty([id], 'Width', '120');
  const valid = session.source;
  session.updateSource(valid.slice(0, -1));
  assert.equal(session.isValid, false);
  assert.throws(() => store.setProperty([id], 'Width', '999'));
  assert.equal(store.history.length, 3);
  assert.deepEqual(store.selection, [id]);
  session.undo();
  assert.equal(session.source, valid);
  session.undo();
  assert.ok(!session.source.includes('Width'));
  session.undo();
  assert.equal(session.source, text);
  assert.equal(store.history.length, 0);
  session.redo();
  session.redo();
  session.redo();
  assert.equal(session.source, valid.slice(0, -1));
  assert.equal(session.isValid, false);
  session.dispose();
});
test('reparent, insert, deletion and gesture commits retain one shared compact history', () => {
  const store = new DocumentStore(parseXaml('<Grid><StackPanel/><Canvas/></Grid>')),
    initial = clone(store.document),
    [a, b] = store.document.root.children,
    node = element('Button', { Content: 'One' });
  store.insert(a.id, node);
  store.move([node.id], b.id);
  const before = clone(store.document);
  find(store.document.root, node.id).props.Width = '220';
  store.commitSnapshot('Gesture', before);
  store.remove([node.id]);
  for (let i = 0; i < 4; i++) store.undo();
  assert.deepEqual(store.document, initial);
  for (let i = 0; i < 4; i++) store.redo();
  assert.equal(find(store.document.root, node.id), null);
});
test('history inspector compatibility materializes independent before and after documents', () => {
  const store = new DocumentStore(parseXaml('<Button Content="A"/>')),
    id = store.document.root.id;
  store.setProperty([id], 'Content', 'B');
  const entry = store.history[0];
  store.setProperty([id], 'Content', 'C');
  assert.equal(entry.label, 'Set Content');
  assert.equal(entry.document.root.props.Content, 'A');
  assert.equal(Object.keys(entry).includes('document'), false);
  const materialized = entry.document;
  materialized.root.props.Content = 'external';
  assert.equal(entry.document.root.props.Content, 'A');
  store.undo();
  assert.equal(store.future[0].document.root.props.Content, 'C');
  store.undo();
  assert.equal(entry.document.root.props.Content, 'A');
  store.redo();
  assert.equal(store.history.at(-1).document.root.props.Content, 'A');
});
test('retention is bounded by entry count and estimated bytes with redo invalidation', () => {
  const store = new DocumentStore(parseXaml('<Button/>'), {
      historyLimit: 3,
      historyByteLimit: 100000,
    }),
    id = store.document.root.id;
  for (let i = 0; i < 6; i++) store.setProperty([id], 'Content', 'v' + i);
  assert.equal(store.history.length, 3);
  assert.equal(store.historyStats().droppedEntries, 3);
  store.undo();
  assert.equal(store.future.length, 1);
  store.setProperty([id], 'Content', 'new');
  assert.equal(store.future.length, 0);
  const tiny = new DocumentStore(parseXaml('<Button/>'), { historyByteLimit: 100 });
  tiny.setProperty([tiny.document.root.id], 'Content', 'large'.repeat(100));
  assert.equal(tiny.history.length, 0);
  assert.ok(tiny.historyBytes <= 100);
  assert.equal(tiny.historyDropped, 1);
  assert.ok(tiny.document.root.props.Content);
  assert.throws(() => new DocumentStore(store.document, { historyLimit: Infinity }), /limits/);
});
test('rejected and no-op transactions leave revision, document and retained bytes untouched', () => {
  const store = new DocumentStore(parseXaml('<Button Content="A"/>'));
  store.setProperty([store.document.root.id], 'Content', 'B');
  const before = clone(store.document),
    revision = store.revision,
    bytes = store.historyBytes;
  store.transaction('No change', () => {});
  assert.equal(store.revision, revision);
  assert.equal(store.historyBytes, bytes);
  const remove = store.addCommitHook(() => {
    throw Error('Abort hook');
  });
  assert.throws(() => store.setProperty([store.document.root.id], 'Content', 'C'), /Abort hook/);
  remove();
  assert.deepEqual(store.document, before);
  assert.equal(store.historyBytes, bytes);
  assert.equal(store.revision, revision);
  assert.throws(
    () => store.transaction('cycle', (doc) => (doc.metadata.loop = doc.metadata)),
    /cyclic/,
  );
  assert.deepEqual(store.document, before);
  assert.equal(store.historyBytes, bytes);
});
test('hundreds of tiny edits retain deltas rather than repeated large source snapshots', (t) => {
  const source = '<Grid><!--' + 'x'.repeat(150000) + '--><Button Content="0"/></Grid>',
    store = new DocumentStore(parseXaml(source));
  store.document.metadata.source = { text: source, validText: source };
  const baselineBytes = estimateHistoryBytes(store.document);
  const id = store.document.root.children.find((n) => n.type === 'Button').id;
  for (let i = 1; i <= 120; i++)
    store.transaction('Source ' + i, (doc) => {
      find(doc.root, id).props.Content = String(i);
      doc.metadata.source.text = source.replace('Content="0"', 'Content="' + i + '"');
      doc.metadata.source.validText = doc.metadata.source.text;
    });
  const stats = store.historyStats();
  t.diagnostic(
    JSON.stringify({
      compactBytes: stats.estimatedBytes,
      snapshotBytes: baselineBytes * stats.pastEntries,
      entryCount: stats.pastEntries,
      reduction: Number(((baselineBytes * stats.pastEntries) / stats.estimatedBytes).toFixed(1)),
    }),
  );
  assert.equal(stats.pastEntries, 100);
  assert.ok(stats.estimatedBytes < baselineBytes * 2, JSON.stringify({ stats, baselineBytes }));
  assert.ok(stats.estimatedBytes < (baselineBytes * stats.pastEntries) / 20);
  for (let i = 0; i < 100; i++) store.undo();
  assert.equal(find(store.document.root, id).props.Content, '20');
  for (let i = 0; i < 100; i++) store.redo();
  assert.equal(find(store.document.root, id).props.Content, '120');
});

test('legacy snapshot entries supplied by extensions remain usable and convert to deltas', () => {
  const store = new DocumentStore(parseXaml('<Button Content="A"/>')),
    before = clone(store.document);
  store.document.root.props.Content = 'B';
  store.history.push({ label: 'Legacy extension', document: before });
  store.undo();
  assert.equal(store.document.root.props.Content, 'A');
  assert.equal(store.future[0].document.root.props.Content, 'B');
  assert.ok(store.future[0].patch);
  store.redo();
  assert.equal(store.document.root.props.Content, 'B');
  assert.equal(store.history[0].label, 'Legacy extension');
  assert.ok(store.history[0].patch);
});
test('stale and malformed patch application fails without mutating the supplied document', () => {
  const before = { text: 'abc', nested: { value: 1 } },
    patch = createHistoryPatch(before, { text: 'abXc', nested: { value: 2 } }),
    stale = { text: 'a', nested: { value: 1 } };
  assert.throws(() => applyHistoryPatch(stale, patch), /no longer matches/);
  assert.deepEqual(stale, { text: 'a', nested: { value: 1 } });
  const mismatch = { text: 'abc', nested: { value: 9 } };
  assert.throws(() => applyHistoryPatch(mismatch, patch), /no longer matches/);
  assert.equal(mismatch.text, 'abc');
});
