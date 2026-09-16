import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentSession } from '../dist/core/document-session.js';
import { DocumentStore, walk, find } from '../dist/core/model.js';
import { parseXaml } from '../dist/core/xaml.js';
import { scanSource, buildSourceIndex } from '../dist/core/source-syntax.js';
const X = 'http://schemas.microsoft.com/winfx/2006/xaml';
const setup = (source, options = {}) => {
  const store = new DocumentStore(parseXaml(source));
  return { store, session: new DocumentSession(store, { source, ...options }) };
};
const semantic = (n) =>
  n.kind === 'element'
    ? {
        kind: n.kind,
        type: n.type,
        props: n.props,
        namespace: n.namespaceURI,
        children: n.children.map(semantic),
      }
    : { kind: n.kind, text: n.text };
function differential(session) {
  const full = parseXaml(session.source);
  assert.deepEqual(semantic(session.store.document.root), semantic(full.root));
  const live = [];
  walk(session.store.document.root, (n) => live.push(n));
  const parsed = [];
  walk(full.root, (n) => parsed.push(n));
  const index = buildSourceIndex(session.source, full);
  for (let i = 0; i < live.length; i++) {
    const actual = session.sourceAtNode(live[i].id),
      expected = index.byId.get(parsed[i].id);
    assert.ok(actual);
    assert.equal(actual.start, expected.start);
    assert.equal(actual.end, expected.end);
    assert.equal(actual.line, expected.line);
    assert.equal(actual.column, expected.column);
    if (actual.attrs) assert.deepEqual(actual.attrs, expected.attrs);
  }
}

test('quoted value edits reuse untouched AST and syntax tokens without any full parse or scan', () => {
  const source =
    '<Grid xmlns:x="' +
    X +
    '">\n' +
    Array.from({ length: 600 }, (_, i) => ` <Button x:Name="B${i}" Content="Value ${i}"/>`).join(
      '\n',
    ) +
    '\n</Grid>';
  const { store, session } = setup(source),
    untouched = store.document.root.children[599],
    token = session.index.tokenById.get(untouched.id),
    stats = { ...session.processingStats };
  session.updateSource(source.replace('Value 300', 'Edited &amp; decoded'));
  assert.equal(session.lastUpdate.mode, 'incremental-attribute');
  assert.equal(store.document.root.children[300].props.Content, 'Edited & decoded');
  assert.equal(store.document.root.children[599], untouched);
  assert.equal(session.index.tokenById.get(untouched.id), token);
  assert.equal(session.processingStats.fullParses, stats.fullParses);
  assert.equal(session.processingStats.fullScans, stats.fullScans);
  assert.ok(session.lastUpdate.charactersParsed < 250);
  assert.ok(session.lastUpdate.charactersScanned < 250);
  differential(session);
});

test('range edits preserve inherited namespaces, entities, Unicode and exact authored formatting', () => {
  const { store, session } = setup(
    `\ufeff<Grid xmlns:x="${X}" xmlns:c="urn:controls">\r\n <c:Control  x:Name = 'Named' Label='A&amp;B'/>\r\n</Grid>`,
  );
  const id = store.document.root.children[0].id;
  for (const value of ['&#x1f600;', '&lt;node&gt;', 'two\r\nlines', '', 'x&amp;y']) {
    const range = session.sourceAtNode(id).attrs.find((a) => a.name === 'Label');
    const result = session.applySourceEdits(
      [{ start: range.valueStart, end: range.valueEnd, text: value }],
      { expectedRevision: session.revision },
    );
    assert.equal(result.valid, true);
    assert.equal(session.lastUpdate.mode, 'incremental-attribute');
    assert.equal(store.document.root.children[0].id, id);
    differential(session);
  }
  assert.match(session.source, /x:Name = 'Named'/);
});

test('text edits parse only the affected token and retain inherited xml:space rules', () => {
  const { store, session } = setup(
      '<Grid xml:space="preserve"><TextBlock>A &amp; B</TextBlock><Button/></Grid>',
    ),
    text = store.document.root.children[0].children[0];
  for (const value of ['C &#169; D', '   \n ', '😀 &lt;literal&gt;']) {
    const range = session.sourceAtNode(text.id);
    session.applySourceEdits([{ start: range.start, end: range.end, text: value }]);
    assert.equal(session.lastUpdate.mode, 'incremental-text');
    assert.equal(store.document.root.children[0].children[0], text);
    differential(session);
  }
});

test('local source diagnostics retain valid AST and exact invalid draft without a full parse', () => {
  const { store, session } = setup('<Grid>\n <Button Content="Good"/>\n</Grid>'),
    valid = session.source,
    node = store.document.root.children[0],
    count = session.processingStats.fullParses;
  const result = session.updateSource(valid.replace('Good', 'Broken &missing;'));
  assert.equal(result.valid, false);
  assert.equal(session.lastUpdate.mode, 'incremental-invalid');
  assert.equal(session.processingStats.fullParses, count);
  assert.equal(node.props.Content, 'Good');
  assert.equal(session.diagnostics[0].line, 2);
  assert.throws(() => store.setProperty([node.id], 'Width', '20'), /draft|source/);
  session.undo();
  assert.equal(session.source, valid);
  assert.equal(session.isValid, true);
});

test('attribute names, namespace context and injected markup take the full-parser fallback', () => {
  const cases = [
    ['<Grid><Button Content="A"/></Grid>', '<Grid><Button Content="A" Width="20"/></Grid>'],
    ['<Grid xmlns:c="urn:one"><c:Button/></Grid>', '<Grid xmlns:c="urn:two"><c:Button/></Grid>'],
    [
      '<Grid xml:space="preserve"><TextBlock>\n </TextBlock></Grid>',
      '<Grid xml:space="default"><TextBlock>\n </TextBlock></Grid>',
    ],
    [
      '<Grid><TextBlock>Hello</TextBlock></Grid>',
      '<Grid><TextBlock><Run Text="Hello"/></TextBlock></Grid>',
    ],
  ];
  for (const [before, after] of cases) {
    const { session } = setup(before),
      count = session.processingStats.fullParses;
    assert.equal(session.updateSource(after).valid, true);
    assert.equal(session.lastUpdate.mode, 'full');
    assert.ok(session.processingStats.fullParses > count);
    differential(session);
  }
});

test('visual property and text transactions use the same localized validation path', () => {
  const { store, session } = setup(
      '<Grid><Button Content="Before"/><TextBlock>Text</TextBlock></Grid>',
    ),
    button = store.document.root.children[0],
    text = store.document.root.children[1].children[0];
  store.setProperty([button.id], 'Content', 'Panel & value');
  assert.equal(session.lastUpdate.mode, 'incremental-attribute');
  differential(session);
  store.transaction('Edit text', (doc) => (find(doc.root, text.id).text = 'Panel text'));
  assert.equal(session.lastUpdate.mode, 'incremental-text');
  differential(session);
  store.undo();
  assert.equal(find(store.document.root, text.id).text, 'Text');
  store.redo();
  assert.equal(find(store.document.root, text.id).text, 'Panel text');
  differential(session);
});

test('batched source ranges remain atomic and enforce document and buffer versions', () => {
  const { store, session } = setup('<Grid><Button Content="One"/><Button Content="Two"/></Grid>');
  const ranges = store.document.root.children.map((n) => session.sourceAtNode(n.id).attrs[0]);
  const before = session.source,
    revision = session.revision,
    version = session.buffer.version;
  const result = session.applySourceEdits(
    ranges.map((r, i) => ({ start: r.valueStart, end: r.valueEnd, text: 'Changed ' + i })),
    { expectedRevision: revision, expectedVersion: version },
  );
  assert.equal(result.valid, true);
  assert.equal(store.history.length, 1);
  assert.equal(session.lastUpdate.mode, 'full');
  differential(session);
  const rejected = session.applySourceEdits([{ start: 0, end: 1, text: '!' }], {
    expectedRevision: revision,
  });
  assert.equal(rejected.accepted, false);
  assert.equal(store.history.length, 1);
  assert.equal(
    session.applySourceEdits([{ start: 0, end: 1, text: '!' }], { expectedVersion: version })
      .accepted,
    false,
  );
  session.undo();
  assert.equal(session.source, before);
  assert.equal(session.buffer.text, before);
});

test('empty text removal falls back because the semantic child topology changes', () => {
  const { session } = setup('<Grid><TextBlock>Remove</TextBlock></Grid>');
  session.updateSource(session.source.replace('Remove', ''));
  assert.equal(session.lastUpdate.mode, 'full');
  differential(session);
});

test('incremental:false is a reproducible full-parser reference implementation', () => {
  const source = '<Grid><Button Content="A"/></Grid>',
    a = setup(source),
    b = setup(source, { incremental: false });
  a.session.updateSource(source.replace('"A"', '"B"'));
  b.session.updateSource(source.replace('"A"', '"B"'));
  assert.equal(a.session.lastUpdate.mode, 'incremental-attribute');
  assert.equal(b.session.lastUpdate.mode, 'full');
  assert.equal(b.session.lastUpdate.reason, 'incremental-disabled');
  assert.deepEqual(semantic(a.store.document.root), semantic(b.store.document.root));
});

test('deterministic alternating token edits preserve every source range against full parsing', () => {
  const { store, session } = setup(
    '<Grid>\n  <TextBlock Name="Text">Original</TextBlock>\n  <Button Content="Original"/>\n</Grid>',
  );
  let seed = 7;
  for (let i = 0; i < 80; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const text = store.document.root.children[0].children[0],
      button = store.document.root.children[1],
      attribute = seed % 2 === 0,
      node = attribute ? button : text;
    const range = session.sourceAtNode(node.id),
      r = attribute ? range.attrs[0] : range;
    const start = attribute ? r.valueStart : r.start,
      end = attribute ? r.valueEnd : r.end,
      value = ['Alpha', 'Longer value', '&#65; &amp; B', '😀', 'New\nLine'][seed % 5];
    assert.equal(session.applySourceEdits([{ start, end, text: value }]).valid, true);
    assert.ok(session.lastUpdate.mode.startsWith('incremental'));
    differential(session);
  }
});

test('source indexing ignores stale import hints that point to another same-type sibling', () => {
  const { store, session } = setup(
    '<Grid><Button Name="First" Content="x"/><Button Name="Second"/></Grid>',
  );
  const first = store.document.root.children[0],
    second = store.document.root.children[1];
  first.source.start = second.source.start;
  second.source.start = first.source.start;
  const indexed = buildSourceIndex(session.source, store.document);
  assert.match(
    session.source.slice(indexed.byId.get(first.id).start, indexed.byId.get(first.id).end),
    /Name="First"/,
  );
  assert.match(
    session.source.slice(indexed.byId.get(second.id).start, indexed.byId.get(second.id).end),
    /Name="Second"/,
  );
});

test('direct range editing does not compare the unchanged document prefix in the text buffer', () => {
  const { store, session } = setup(
      '<Grid>' +
        Array.from({ length: 100 }, (_, i) => '<Button Content="' + i + '"/>').join('') +
        '</Grid>',
    ),
    range = session.sourceAtNode(store.document.root.children[99].id).attrs[0],
    stats = session.buffer.stats;
  session.applySourceEdits([{ start: range.valueStart, end: range.valueEnd, text: 'changed' }]);
  assert.equal(session.lastUpdate.input, 'range');
  assert.equal(session.buffer.stats.diffCharsCompared, stats.diffCharsCompared);
  assert.ok(session.buffer.stats.charsScanned - stats.charsScanned <= 9);
  differential(session);
});

test('combined framework and value mutations conservatively validate the full document', () => {
  const { store, session } = setup('<Grid Width="300"/>');
  store.transaction('Change framework and width', (doc) => {
    doc.framework = 'Avalonia';
    doc.root.props.Width = '500';
  });
  assert.equal(store.document.framework, 'Avalonia');
  assert.equal(store.document.design.width, 500);
  assert.equal(session.lastUpdate.mode, 'full');
  assert.equal(session.lastUpdate.reason, 'combined-model-change');
  assert.equal(parseXaml(session.source, { framework: 'Avalonia' }).root.props.Width, '500');
});
