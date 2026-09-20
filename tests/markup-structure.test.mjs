import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentStore } from '../dist/core/model.js';
import { parseXaml } from '../dist/core/xaml.js';
import { parseHtml } from '../dist/core/html.js';
import { DocumentSession } from '../dist/core/document-session.js';
import { MarkupStructureIndex } from '../dist/core/markup-structure.js';
import { controlDOM } from './control-fixture.mjs';

function setup(t, source, html = false) {
  if (html) controlDOM(t);
  const store = new DocumentStore(html ? parseHtml(source) : parseXaml(source));
  const session = new DocumentSession(store, { source });
  const index = new MarkupStructureIndex(session);
  t.after(() => {
    index.dispose();
    session.dispose();
  });
  return { store, session, index };
}

test('outline includes named, unnamed, aliased resource and property elements in canonical hierarchy', (t) => {
  const source =
    '<p:Grid xmlns:p="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:n="http://schemas.microsoft.com/winfx/2006/xaml"><p:Grid.Resources><p:SolidColorBrush n:Key="Accent"/></p:Grid.Resources><p:Button n:Name="Submit"/><p:TextBlock Text="label"/></p:Grid>';
  const { index, store } = setup(t, source);
  const before = JSON.stringify(store.document);
  const entries = index.entries();
  assert.deepEqual(
    entries.map((x) => [x.label, x.detail, x.depth, x.kind]),
    [
      ['p:Grid', '', 0, 'element'],
      ['p:Grid.Resources', '', 1, 'property'],
      ['p:SolidColorBrush', '{Accent}', 2, 'resource'],
      ['p:Button', '#Submit', 1, 'element'],
      ['p:TextBlock', '', 1, 'element'],
    ],
  );
  assert.equal(entries[1].parentId, entries[0].id);
  assert.equal(index.designerId(entries[1].id), entries[0].id);
  assert.equal(index.designerId(entries[2].id), entries[2].id);
  assert.equal(JSON.stringify(store.document), before);
  assert.equal(store.history.length, 0);
});

test('navigation links are element siblings rather than comments, text or guessed type matches', (t) => {
  const { index } = setup(
    t,
    '<Grid><Button/><!-- keep --><TextBlock><Run/></TextBlock><Button/></Grid>',
  );
  const [root, first, second, run, last] = index.entries();
  assert.equal(index.related(first.id, 'next-sibling'), second);
  assert.equal(index.related(last.id, 'previous-sibling'), second);
  assert.equal(index.related(run.id, 'parent'), second);
  assert.equal(index.related(second.id, 'first-child'), run);
  assert.equal(index.related(root.id, 'parent'), null);
  assert.equal(index.related(last.id, 'next-sibling'), null);
  assert.equal(index.related(first.id, 'previous-sibling'), null);
  assert.equal(index.related('missing', 'parent'), null);
  assert.throws(() => index.related(first.id, 'unknown'), /Choose/);
  assert.deepEqual(index.path(run.id), [root, second, run]);
});

test('caret lookup respects exact UTF-16 ranges, closing tags, literal lookalikes and CRLF', (t) => {
  const source =
    '\uFEFF<Grid>\r\n  <Button Content="😀 &lt;Grid>"/><!-- <Button/> --><TextBlock>Hi</TextBlock></Grid>\r\n';
  const { index } = setup(t, source);
  const [root, button, block] = index.entries();
  assert.equal(index.at(source.indexOf('😀')), button);
  assert.equal(index.at(source.indexOf('<!--') + 6), root);
  assert.equal(index.at(source.indexOf('</TextBlock>') + 3), block);
  assert.equal(source.slice(button.range.start, button.range.end), 'Button');
  assert.deepEqual([button.range.line, button.range.column], [2, 4]);
  for (const value of [-1, NaN, 0.5, Infinity, '4', source.length])
    assert.equal(index.at(value), null);
});

test('queries reuse the index, and visual edits, exact undo/redo and invalid drafts invalidate it', (t) => {
  const { store, session, index } = setup(t, '<Grid><Button Name="A"/></Grid>');
  const first = index.entries(),
    id = first[1].id;
  for (let n = 0; n < 20; n++) {
    index.at(n);
    index.path(id);
  }
  assert.equal(index.builds, 1);
  assert.equal(index.entries(), first);
  store.setProperty([id], 'Name', 'B');
  assert.equal(index.get(id).detail, '#B');
  assert.equal(index.builds, 2);
  store.undo();
  assert.equal(index.get(id).detail, '#A');
  store.redo();
  assert.equal(index.get(id).detail, '#B');
  session.updateSource('<Grid>');
  assert.deepEqual(index.entries(), []);
  assert.equal(index.at(2), null);
  assert.deepEqual(index.path(id), []);
  session.discardDraft();
  assert.equal(index.get(id).detail, '#B');
});

test('source reparents retain stable node identity and update breadcrumb ancestry', (t) => {
  const { index, session } = setup(
    t,
    '<Grid><StackPanel Name="L"><Button Name="A"/></StackPanel><StackPanel Name="R"/></Grid>',
  );
  const id = index.entries().find((x) => x.detail === '#A').id;
  session.updateSource(
    '<Grid><StackPanel Name="L"/><StackPanel Name="R"><Button Name="A"/></StackPanel></Grid>',
  );
  assert.deepEqual(
    index.path(id).map((x) => x.detail),
    ['', '#R', '#A'],
  );
});

test('returned records cannot mutate the cached index or session, and disposal releases source references', (t) => {
  const { index, session } = setup(t, '<Grid><Button/></Grid>');
  const entries = index.entries();
  assert.throws(() => entries.push({}), TypeError);
  assert.throws(() => {
    entries[0].label = 'bad';
  }, TypeError);
  assert.throws(() => {
    entries[0].range.start = 999;
  }, TypeError);
  const path = index.path(entries[1].id);
  path.length = 0;
  assert.equal(index.path(entries[1].id).length, 2);
  session.dispose();
  assert.equal(index.get(entries[0].id), null);
  index.dispose();
  index.dispose();
  assert.deepEqual(index.entries(), []);
  assert.equal(index.session, null);
  assert.equal(index.source, null);
});

test('HTML outline retains implied parents but never fabricates source locations for them', (t) => {
  const source = '<main id="main"><button id="save">Save</button></main>';
  const { index } = setup(t, source, true);
  const entries = index.entries();
  assert.equal(entries.find((x) => x.label === 'html').synthetic, true);
  assert.equal(entries.find((x) => x.label === 'body').range, null);
  const button = entries.find((x) => x.label === 'button');
  assert.equal(button.detail, '#save');
  assert.equal(index.at(source.indexOf('Save')), button);
  assert.deepEqual(
    index.path(button.id).map((x) => x.label),
    ['html', 'body', 'main', 'button'],
  );
});

test('SVG, MathML, templates, scripts and dotted HTML custom names retain canonical semantics', (t) => {
  const { index } = setup(
    t,
    '<html><body><svg><g id="x"><circle/></g></svg><math><mrow><mi>x</mi></mrow></math><template><p id="copy">copy</p></template><script>"<fake/>"</script><x.a></x.a></body></html>',
    true,
  );
  assert.equal(
    index.entries().some((x) => x.label === 'fake'),
    false,
  );
  assert.equal(
    index.entries().find((x) => x.label === 'circle').namespaceURI,
    'http://www.w3.org/2000/svg',
  );
  // MathML namespace/integration points are qualified with the native browser parser.
  assert.equal(
    index.entries().some((x) => x.label === 'mi'),
    true,
  );
  assert.equal(index.entries().find((x) => x.label === 'x.a').kind, 'element');
  const p = index.entries().find((x) => x.detail === '#copy');
  assert.equal(index.path(p.id).at(-2).label, 'template');
});

test('thousands of siblings support deterministic indexed caret and sibling navigation', (t) => {
  const source =
    '<Grid>' +
    Array.from({ length: 4000 }, (_, n) => `<Button Name="B${n}"/>`).join('') +
    '</Grid>';
  const { index } = setup(t, source);
  for (let n = 0; n < 4000; n += 17) {
    const item = index.at(source.indexOf(`Name="B${n}"`));
    assert.equal(item.detail, `#B${n}`);
    assert.equal(index.related(item.id, 'parent').label, 'Grid');
  }
  assert.equal(index.entries().length, 4001);
  assert.equal(index.builds, 1);
});
