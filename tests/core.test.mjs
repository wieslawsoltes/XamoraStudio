import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXaml, serializeXaml, diagnostics } from '../dist/core/xaml.js';
import { DocumentStore, element, find, walk, validateDocument } from '../dist/core/model.js';
import { builtins, ToolkitRegistry } from '../dist/core/registry.js';
import { samples } from '../dist/core/samples.js';
const normalize = (n) =>
  n.kind === 'element'
    ? { kind: n.kind, type: n.type, props: n.props, children: n.children.map(normalize) }
    : { kind: n.kind, text: n.text };
const roundTrip = (s) => {
  const d = parseXaml(s);
  assert.deepEqual(normalize(parseXaml(serializeXaml(d)).root), normalize(d.root));
};
test('all sample documents parse, validate and round-trip', () => {
  for (const d of samples()) {
    validateDocument(d);
    roundTrip(serializeXaml(d));
  }
});
test('unknown namespaces, bindings and events survive', () =>
  roundTrip(
    '<Grid xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:a="clr-namespace:Acme"><a:Thing x:Name="Thing" Click="Handle" Data="{Binding Customer.Name, Mode=TwoWay}" /></Grid>',
  ));
test('comments, PI and CDATA survive round-trip', () =>
  roundTrip(
    '<?xml version="1.0"?><!--before--><Grid><!--inside--><![CDATA[a < b]]></Grid><!--after-->',
  ));
test('mixed inline content preserves authored spaces', () =>
  roundTrip('<TextBlock>Hello <Run>world</Run>!</TextBlock>'));
test('xml:space is inherited', () =>
  roundTrip('<TextBlock xml:space="preserve"><Span><Run>a</Run> <Run>b</Run></Span></TextBlock>'));
test('explicit empty string differs from resetting a property', () => {
  const d = parseXaml('<Button Content="styled"/>'),
    s = new DocumentStore(d);
  s.setProperty([d.root.id], 'Content', '');
  assert.match(serializeXaml(s.document), /Content=""/);
  s.setProperty([d.root.id], 'Content', null);
  assert.equal(s.document.root.props.Content, undefined);
  s.undo();
  assert.equal(s.document.root.props.Content, '');
});
test('prototype-looking attributes are preserved', () =>
  roundTrip('<Grid __proto__="a" constructor="b" toString="c"/>'));
test('numeric attribute whitespace is preserved', () =>
  roundTrip('<TextBlock Text="a&#9;b&#13;c&#10;d"/>'));
test('BOM and xml-stylesheet PI accepted', () =>
  assert.doesNotThrow(() =>
    parseXaml('\uFEFF<?xml version="1.0"?><?xml-stylesheet href="theme.xsl"?><Grid/>'),
  ));
test('Avalonia detected from prefixed root namespace', () =>
  assert.equal(
    parseXaml('<a:UserControl xmlns:a="https://github.com/avaloniaui"/>').framework,
    'Avalonia',
  ));
test('custom prefixed Button never resolves to builtin', () =>
  assert.equal(builtins().get('custom:Button', 'clr-namespace:Custom'), undefined));
test('prefixed framework types resolve through namespace', () =>
  assert.equal(builtins().get('a:Button', 'https://github.com/avaloniaui').type, 'Button'));
test('conversion preserves definition metadata', () => {
  const d = parseXaml(
    '<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><Grid.ColumnDefinitions><!-- sizing --><ColumnDefinition Width="*" MinWidth="80" MaxWidth="300" SharedSizeGroup="label" /></Grid.ColumnDefinitions></Grid>',
  );
  const out = serializeXaml(d, { framework: 'Avalonia' });
  for (const s of ['MinWidth="80"', 'MaxWidth="300"', 'SharedSizeGroup="label"', '<!-- sizing -->'])
    assert.ok(out.includes(s));
  assert.equal(parseXaml(out).framework, 'Avalonia');
});
test('conversion updates a prefixed framework namespace', () => {
  const d = parseXaml(
    '<w:Grid xmlns:w="http://schemas.microsoft.com/winfx/2006/xaml/presentation"/>',
  );
  assert.equal(parseXaml(serializeXaml(d, { framework: 'Avalonia' })).framework, 'Avalonia');
});
test('WPF conversion expands compact grid definitions', () => {
  const d = parseXaml(
    '<Grid xmlns="https://github.com/avaloniaui" RowDefinitions="Auto,2*" ColumnDefinitions="120,*"/>',
  );
  const out = serializeXaml(d, { framework: 'WPF' });
  assert.match(out, /<Grid.RowDefinitions>/);
  assert.match(out, /Height="2\*"/);
  assert.match(out, /Width="120"/);
});
test('Hidden is not silently converted to collapsing IsVisible', () => {
  const d = parseXaml('<Grid><Button Visibility="Hidden"/></Grid>');
  const out = serializeXaml(d, { framework: 'Avalonia' });
  assert.match(out, /Visibility="Hidden"/);
  assert.doesNotMatch(out, /IsVisible="False"/);
});
test('malformed XML produces located diagnostics', () => {
  assert.throws(
    () => parseXaml('<Grid>\n<Button></Grid>'),
    (e) => e.line === 2 && e.column > 0 && e.name === 'XamlError',
  );
});
for (const [name, xml] of Object.entries({
  doctype: '<!DOCTYPE Grid><Grid/>',
  entity: '<Grid Text="&unknown;"/>',
  nul: '<Grid Text="&#0;"/>',
  surrogate: '<Grid Text="&#xD800;"/>',
  range: '<Grid Text="&#x110000;"/>',
  topCDATA: '<Grid/><![CDATA[a]]>',
  prefix: '<a:Grid/>',
  duplicate: '<Grid Width="1" Width="2"/>',
  qname: '<a:b:c/>',
  comment: '<Grid><!--x---></Grid>',
  pi: '<Grid><? ?></Grid>',
})) {
  test('rejects invalid XML: ' + name, () => assert.throws(() => parseXaml(xml)));
}
test('invalid JSON comment injection is rejected', () => {
  const d = parseXaml('<Grid/>');
  d.root.children.push({ id: 'c', kind: 'comment', text: '--><Button/><!--' });
  assert.throws(() => validateDocument(d));
});
test('invalid preamble is rejected', () => {
  const d = parseXaml('<Grid/>');
  d.preamble = [element('Button')];
  assert.throws(() => validateDocument(d));
});
test('transaction failure rolls back atomically', () => {
  const s = new DocumentStore(parseXaml('<Grid/>')),
    original = serializeXaml(s.document);
  assert.throws(() =>
    s.transaction('bad', (d) => {
      d.root.type = 'bad type';
    }),
  );
  assert.equal(serializeXaml(s.document), original);
  assert.equal(s.history.length, 0);
});
test('undo/redo restore insert move property delete operations', () => {
  const d = parseXaml('<Grid><StackPanel/><Canvas/></Grid>'),
    s = new DocumentStore(d),
    [stack, canvas] = s.document.root.children;
  const button = element('Button', { Content: 'A' });
  s.insert(stack.id, button);
  s.setProperty([button.id], 'Content', 'B');
  s.move([button.id], canvas.id);
  s.remove([button.id]);
  for (let i = 0; i < 4; i++) s.undo();
  assert.equal(serializeXaml(s.document), serializeXaml(d));
  for (let i = 0; i < 4; i++) s.redo();
  assert.equal(find(s.document.root, button.id), null);
});
test('inserted node is owned by the store', () => {
  const s = new DocumentStore(parseXaml('<Grid/>')),
    n = element('Button', { Content: 'A' });
  s.insert(s.document.root.id, n);
  n.props.Content = 'external';
  assert.equal(find(s.document.root, n.id).props.Content, 'A');
});
test('moving into descendant is rejected without mutation', () => {
  const d = parseXaml('<Grid><StackPanel><Canvas/></StackPanel></Grid>'),
    s = new DocumentStore(d),
    stack = s.document.root.children[0],
    canvas = stack.children[0];
  assert.throws(() => s.move([stack.id], canvas.id));
  assert.equal(serializeXaml(s.document), serializeXaml(d));
});
test('history is bounded and redo invalidates after a new edit', () => {
  const s = new DocumentStore(parseXaml('<Button/>'));
  for (let i = 0; i < 110; i++) s.setProperty([s.document.root.id], 'Content', String(i));
  assert.equal(s.history.length, 100);
  s.undo();
  assert.equal(s.future.length, 1);
  s.setProperty([s.document.root.id], 'Content', 'new');
  assert.equal(s.future.length, 0);
});
test('toolkit validation is atomic for invalid descriptors', () => {
  const r = new ToolkitRegistry();
  assert.throws(() =>
    r.install({ name: 'Broken', controls: [{ type: 'Fine', category: 'A' }, { type: 'Broken' }] }),
  );
  assert.equal(r.list().length, 0);
});
test('nested toolkit scaffolds instantiate every level', () => {
  const r = new ToolkitRegistry();
  r.install({
    name: 'Test',
    controls: [
      {
        type: 'Page',
        category: 'C',
        children: [
          {
            type: 'Grid',
            children: [
              { type: 'StackPanel', children: [{ type: 'Button', props: { Content: 'nested' } }] },
            ],
          },
        ],
      },
    ],
  });
  const n = r.create('Page');
  assert.equal(n.children[0].children[0].children[0].props.Content, 'nested');
});
test('semantic diagnostics flag invalid single-child content', () => {
  const d = parseXaml('<Border><Button/><Button/></Border>');
  assert.ok(
    diagnostics(d, builtins()).some(
      (i) => i.severity === 'error' && i.message.includes('one visual child'),
    ),
  );
});
test('5000-node document stays within import limits and round-trips', () => {
  const source =
    '<Grid>' +
    Array.from({ length: 5000 }, (_, i) => `<Button Content="${i}"/>`).join('') +
    '</Grid>';
  const d = parseXaml(source);
  let count = 0;
  walk(d.root, () => count++);
  assert.equal(count, 5001);
  assert.equal(parseXaml(serializeXaml(d)).root.children.length, 5000);
});
