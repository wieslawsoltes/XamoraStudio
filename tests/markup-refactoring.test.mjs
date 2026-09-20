import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { DocumentStore, find, clone, walk } from '../dist/core/model.js';
import { DocumentSession } from '../dist/core/document-session.js';
import { parseXaml } from '../dist/core/xaml.js';
import { parseHtml, HTML_NAMESPACE, SVG_NAMESPACE, MATHML_NAMESPACE } from '../dist/core/html.js';
import { MarkupRefactorService } from '../dist/core/markup-refactoring.js';
import { builtins } from '../dist/core/registry.js';
const WPF = 'http://schemas.microsoft.com/winfx/2006/xaml/presentation';
function setup(t, source, html = false, registry) {
  if (html) controlDOM(t);
  const store = new DocumentStore(html ? parseHtml(source) : parseXaml(source)),
    session = new DocumentSession(store, { source }),
    service = new MarkupRefactorService(session, { registry });
  t.after(() => {
    service.dispose();
    session.dispose();
  });
  const node = (name) => {
    let result;
    walk(store.document.root, (n) => {
      if (n.type === name || n.props?.id === name || n.props?.Name === name) result ??= n;
    });
    assert(result, `Missing ${name}`);
    return result;
  };
  return { store, session, service, node };
}
function state(s) {
  return JSON.stringify([
    s.store.document,
    s.store.selection,
    s.session.source,
    s.store.revision,
    s.store.history.length,
  ]);
}
function rejectUnchanged(s, action, pattern) {
  const before = state(s);
  assert.throws(action, pattern);
  assert.equal(state(s), before);
}

test('rename pairs exact source names and own property tags without rewriting quoted values or comments', (t) => {
  const source = `<?xml version='1.0'?>\r\n<a:StackPanel xmlns:a='${WPF}' xmlns:b='${WPF}' Tag='StackPanel'>\r\n  <b:StackPanel.Resources><!-- StackPanel --></b:StackPanel.Resources>\r\n  <a:TextBlock Text='A &amp; B'/>\r\n</a:StackPanel>`,
    s = setup(t, source),
    id = s.store.document.root.id;
  const before = state(s),
    plan = s.service.prepareRename(id, 'a:Grid');
  assert.equal(state(s), before);
  assert.equal(
    plan.after,
    source
      .replaceAll('a:StackPanel', 'a:Grid')
      .replaceAll('b:StackPanel.Resources', 'b:Grid.Resources'),
  );
  assert(Object.isFrozen(plan));
  assert(Object.isFrozen(plan.warnings));
  const result = s.service.apply(plan);
  assert(result.changed);
  assert.equal(s.session.source, plan.after);
  assert.equal(s.store.document.root.id, id);
  assert.equal(s.store.history.length, 1);
  s.store.undo();
  assert.equal(s.session.source, source);
  s.store.redo();
  assert.equal(s.session.source, plan.after);
  assert.equal(s.store.document.root.id, id);
});

test('namespace aliases rename owners without touching attached-property providers', (t) => {
  const s = setup(
    t,
    `<a:Grid xmlns:a='${WPF}' xmlns:b='${WPF}'><a:StackPanel><b:StackPanel.Resources/><a:Grid.Row>1</a:Grid.Row></a:StackPanel></a:Grid>`,
  );
  const plan = s.service.prepareRename(s.node('a:StackPanel').id, 'b:Grid');
  assert.match(plan.after, /<b:Grid><b:Grid.Resources\/><a:Grid.Row>1<\/a:Grid.Row><\/b:Grid>/);
  s.service.apply(plan);
});

test('same-name proposal is a consumed no-op with no undo entry', (t) => {
  const s = setup(t, '<Grid><Button/></Grid>'),
    p = s.service.prepareRename(s.node('Button').id, 'Button');
  assert.equal(s.service.apply(p).changed, false);
  assert.equal(s.store.history.length, 0);
  assert.throws(() => s.service.apply(p), /consumed/);
});

test('linked names use UTF-16 positions and exclude attribute and comment lookalikes', (t) => {
  const source = '<Grid>😀<Button Tag="Button"><!-- Button -->Text</Button></Grid>',
    s = setup(t, source);
  const ranges = s.service.linkedTagRanges(source.indexOf('<Button') + 2);
  assert.deepEqual(
    ranges.map((r) => source.slice(r.start, r.end)),
    ['Button', 'Button'],
  );
  assert.equal(ranges[1].start, source.indexOf('</Button') + 2);
  assert.deepEqual(s.service.linkedTagRanges(source.indexOf('Tag=') + 1), []);
  assert.deepEqual(s.service.linkedTagRanges(source.indexOf('<!--') + 5), []);
  for (const n of [-1, NaN, Infinity, 2.5, source.length])
    assert.deepEqual(s.service.linkedTagRanges(n), []);
});

test('self-closing XAML has one linked name and can be renamed', (t) => {
  const s = setup(t, '<Grid><Button Content="Save" /></Grid>');
  assert.equal(s.service.linkedTagRanges(8).length, 1);
  s.service.apply(s.service.prepareRename(s.node('Button').id, 'Label'));
  assert.equal(s.session.source, '<Grid><Label Content="Save" /></Grid>');
});

test('renaming cannot change namespace or use an undeclared prefix', (t) => {
  const s = setup(t, `<Grid xmlns='${WPF}' xmlns:c='urn:custom'><Button/></Grid>`),
    id = s.node('Button').id;
  rejectUnchanged(s, () => s.service.prepareRename(id, 'c:Button'), /namespace/);
  rejectUnchanged(s, () => s.service.prepareRename(id, 'missing:Button'), /Declare/);
});

test('invalid tag names are rejected without edits', (t) => {
  const s = setup(t, '<Grid><Button/></Grid>'),
    id = s.node('Button').id;
  for (const name of ['', '<Grid>', 'Grid.Row', 'x:a:b', 'One Two', 'x'.repeat(161)])
    rejectUnchanged(s, () => s.service.prepareRename(id, name), /tag name/);
});

test('wrap consecutive siblings keeps IDs, entity spelling, CRLF and interleaved comments', (t) => {
  const source =
      '<Grid>\r\n  <Button Content = \'A &#38; B\'/>\r\n  <!-- between -->\r\n  <TextBlock Text="Other" />\r\n</Grid>',
    s = setup(t, source),
    a = s.node('Button').id,
    b = s.node('TextBlock').id;
  const p = s.service.prepareWrap([b, a], 'StackPanel');
  assert.match(
    p.after,
    /<StackPanel><Button Content = 'A &#38; B'\/>\r\n  <!-- between -->\r\n  <TextBlock Text="Other" \/><\/StackPanel>/,
  );
  s.service.apply(p);
  assert(find(s.store.document.root, a));
  assert(find(s.store.document.root, b));
  assert.equal(s.store.selection[0], p.selectedId);
  assert.equal(s.store.document.root.children[0].children.length, 3);
  s.store.undo();
  assert.equal(s.session.source, source);
  s.store.redo();
  assert.equal(s.session.source, p.after);
});

test('single inline wrapping uses its explicit property collection and retains scope metadata', (t) => {
  const s = setup(
      t,
      `<a:TextBlock xmlns:a='${WPF}'><a:TextBlock.Inlines><a:Run Text='A'/></a:TextBlock.Inlines></a:TextBlock>`,
    ),
    run = s.node('a:Run').id;
  const p = s.service.prepareWrap(run, 'a:Bold');
  s.service.apply(p);
  const bold = find(s.store.document.root, p.selectedId);
  assert.equal(bold.namespaceURI, WPF);
  assert.equal(bold.scope.a, WPF);
  assert.equal(bold.children[0].id, run);
  s.service.apply(s.service.prepareUnwrap(bold.id));
  assert(s.session.source.includes("<a:Run Text='A'/>") && !s.session.source.includes('<a:Bold>'));
});

test('wrapping rejects nonconsecutive or cross-parent selections and empty selection', (t) => {
  const s = setup(t, '<Grid><Button/><TextBlock/><CheckBox/><Border><Label/></Border></Grid>');
  rejectUnchanged(
    s,
    () => s.service.prepareWrap([s.node('Button').id, s.node('CheckBox').id], 'Grid'),
    /consecutive/,
  );
  rejectUnchanged(
    s,
    () => s.service.prepareWrap([s.node('Button').id, s.node('Label').id], 'Grid'),
    /sibling/,
  );
  rejectUnchanged(s, () => s.service.prepareWrap([], 'Grid'), /Choose/);
  rejectUnchanged(s, () => s.service.prepareWrap(s.store.document.root.id, 'Grid'), /root/);
});

test('wrapping respects ordinary and inline container rules', (t) => {
  const s = setup(t, '<Grid><Button/><Label/></Grid>'),
    ids = s.store.document.root.children.map((n) => n.id);
  rejectUnchanged(s, () => s.service.prepareWrap(ids, 'Border'), /one visual child/);
  rejectUnchanged(s, () => s.service.prepareWrap(ids[0], 'Run'), /registered container/);
  rejectUnchanged(s, () => s.service.prepareWrap(ids[0], 'Span'), /inline elements/);
});

test('unwrap checks single-child rules even inside explicit content-property syntax', (t) => {
  for (const source of [
    '<Border><Border.Child><Grid><Button/><Label/></Grid></Border.Child></Border>',
    '<Button><Button.Content><Grid><Button/><Label/></Grid></Button.Content></Button>',
  ]) {
    const s = setup(t, source);
    rejectUnchanged(s, () => s.service.prepareUnwrap(s.node('Grid').id), /one visual child/);
  }
});

test('a parent is not accepted as an unrestricted inline collection', (t) => {
  const s = setup(
    t,
    '<TextBlock><TextBlock.Inlines><Span><Run/></Span></TextBlock.Inlines></TextBlock>',
  );
  rejectUnchanged(s, () => s.service.prepareRename(s.node('Run').id, 'Button'), /inline/);
  rejectUnchanged(s, () => s.service.prepareWrap(s.node('Span').id, 'Grid'), /Inline/);
});

test('unwrap refuses namespace/property ownership loss and document roots', (t) => {
  const s = setup(
    t,
    '<Grid><Border xmlns:a="urn:a"><a:Child/></Border><StackPanel><StackPanel.Resources/><Button/></StackPanel></Grid>',
  );
  rejectUnchanged(s, () => s.service.prepareUnwrap(s.node('Border').id), /namespace declarations/);
  rejectUnchanged(s, () => s.service.prepareUnwrap(s.node('StackPanel').id), /property elements/);
  rejectUnchanged(s, () => s.service.prepareUnwrap(s.store.document.root.id), /document root/);
});

test('unknown foreign unqualified names do not silently acquire native wrapper metadata', (t) => {
  const s = setup(t, '<Panel xmlns="urn:custom"><Button/></Panel>');
  rejectUnchanged(s, () => s.service.prepareWrap(s.node('Button').id, 'Grid'), /registered/);
});

test('explicitly registered custom containers may wrap within the same namespace', (t) => {
  const registry = builtins();
  registry.registerControl({ type: 'c:Panel', category: 'Custom', container: true });
  const s = setup(t, '<Grid xmlns:c="urn:custom"><Button/></Grid>', false, registry);
  const p = s.service.prepareWrap(s.node('Button').id, 'c:Panel');
  s.service.apply(p);
  assert.equal(find(s.store.document.root, p.selectedId).namespaceURI, 'urn:custom');
});

test('reusable plans reject source edits, undo ABA, foreign services and copied payloads', (t) => {
  const s = setup(t, '<Grid><Button/></Grid>'),
    p = s.service.prepareRename(s.node('Button').id, 'Label');
  const other = new MarkupRefactorService(s.session);
  t.after(() => other.dispose());
  rejectUnchanged(s, () => other.apply(p), /unknown/);
  rejectUnchanged(s, () => s.service.apply({ ...p }), /unknown/);
  s.store.setProperty([s.node('Button').id], 'Content', 'Changed');
  s.store.undo();
  assert.equal(s.session.source, p.before);
  rejectUnchanged(s, () => s.service.apply(p), /document changed/);
});

test('raw metadata/lock changes invalidate a reviewed proposal even without a revision', (t) => {
  const s = setup(t, '<Grid><Button/></Grid>'),
    p = s.service.prepareRename(s.node('Button').id, 'Label');
  s.store.document.metadata.locked = [s.node('Button').id];
  rejectUnchanged(s, () => s.service.apply(p), /document changed/);
});

test('invalid source and disposed session/service never change the last valid tree', (t) => {
  const s = setup(t, '<Grid><Button/></Grid>'),
    p = s.service.prepareRename(s.node('Button').id, 'Label');
  s.session.updateSource('<Grid');
  rejectUnchanged(s, () => s.service.apply(p), /source errors/);
  s.session.discardDraft();
  s.session.dispose();
  rejectUnchanged(s, () => s.service.prepareRename(s.node('Button').id, 'Label'), /disposed/);
  const b = setup(t, '<Grid/>');
  b.service.dispose();
  rejectUnchanged(b, () => b.service.prepareRename(b.store.document.root.id, 'Canvas'), /disposed/);
});

test('plan affected identities cover descendants for host lock enforcement', (t) => {
  const s = setup(t, '<Grid><Border><Button/></Border></Grid>'),
    button = s.node('Button').id;
  assert(s.service.prepareRename(s.node('Border').id, 'Grid').affectedNodeIds.includes(button));
  assert(s.service.prepareWrap(s.node('Border').id, 'Grid').affectedNodeIds.includes(button));
  assert(s.service.prepareUnwrap(s.node('Border').id).affectedNodeIds.includes(button));
});

test('a commit hook cannot commit source other than the reviewed source', (t) => {
  const s = setup(t, '<Grid><Button/></Grid>'),
    p = s.service.prepareRename(s.node('Button').id, 'Label');
  const remove = s.store.addCommitHook(({ document }) => {
    document.metadata.source.text += '<!-- unexpected -->';
  });
  rejectUnchanged(s, () => s.service.apply(p), /reviewed/);
  remove();
  // The failed transaction did not consume the proposal or prevent a correctly reviewed retry.
  s.service.apply(p);
  assert.equal(s.session.source, p.after);
});

for (const [label, source, target, name, expected] of [
  [
    'HTML',
    "<main><section title='A &amp; B'>Text</section></main>",
    'section',
    'article',
    "<main><article title='A &amp; B'>Text</article></main>",
  ],
  [
    'SVG',
    '<svg><g id="group"><circle r="4"/></g></svg>',
    'g',
    'a',
    '<svg><a id="group"><circle r="4"/></a></svg>',
  ],
  ['MathML', '<math><mi>x</mi></math>', 'mi', 'mn', '<math><mn>x</mn></math>'],
])
  test(`${label} paired rename retains text/source/namespaces and selected IDs`, (t) => {
    const s = setup(t, source, true),
      id = s.node(target).id,
      p = s.service.prepareRename(id, name),
      ns = s.node(target).namespaceURI;
    assert.equal(p.after, expected);
    s.service.apply(p);
    assert.equal(find(s.store.document.root, id).namespaceURI, ns);
    s.store.undo();
    assert.equal(s.session.source, source);
    s.store.redo();
    assert.equal(s.session.source, expected);
  });

test('HTML wrapper retains exact mixed-content bytes and all existing child identities', (t) => {
  const source = "<main><b title='keep'>A&nbsp;B</b> &amp; <!--gap--> <i>C</i></main>",
    s = setup(t, source, true),
    a = s.node('b').id,
    b = s.node('i').id;
  const p = s.service.prepareWrap([a, b], 'section');
  assert.equal(
    p.after,
    source.replace('<main>', '<main><section>').replace('</main>', '</section></main>'),
  );
  s.service.apply(p);
  assert.equal(find(s.store.document.root, a).props.title, 'keep');
  s.service.apply(s.service.prepareUnwrap(p.selectedId));
  assert.equal(s.session.source, source);
});

for (const [source, target, wrapper, ns] of [
  ['<svg><circle r="4"/></svg>', 'circle', 'g', SVG_NAMESPACE],
])
  test(`namespace-safe wrapping ${target} in ${wrapper}`, (t) => {
    const s = setup(t, source, true),
      p = s.service.prepareWrap(s.node(target).id, wrapper);
    s.service.apply(p);
    assert.equal(find(s.store.document.root, p.selectedId).namespaceURI, ns);
  });

test('HTML cannot introduce void, document/template, or raw-text parser changes', (t) => {
  const s = setup(t, '<main><div>text &lt;b&gt;</div></main>', true),
    id = s.node('div').id;
  for (const name of ['img', 'body', 'template', 'script'])
    rejectUnchanged(s, () => s.service.prepareRename(id, name), /termination|boundaries|parsing/);
  rejectUnchanged(s, () => s.service.prepareWrap(id, 'input'), /normal container/);
});

test('HTML implicit boundaries and duplicate attributes are not silently normalized', (t) => {
  const s = setup(t, '<ul><li>A<li>B</ul><p id="a" id="b">P</p>', true);
  rejectUnchanged(s, () => s.service.prepareRename(s.node('li').id, 'div'), /closing tag/);
  // Existing duplicate syntax remains unchanged; rename does not merge or reorder the attributes.
  const p = s.service.prepareRename(s.node('p').id, 'div');
  assert.match(p.after, /<div id="a" id="b">P<\/div>/);
});

test('HTML unwrapping advertises removed attributes and retains child IDs', (t) => {
  const s = setup(t, '<main><div id="old" class="layout"><b>B</b></div></main>', true),
    id = s.node('b').id,
    p = s.service.prepareUnwrap(s.node('div').id);
  assert(p.warnings.some((w) => w.includes('id, class')));
  s.service.apply(p);
  assert.equal(s.store.selection[0], id);
});

test('a reentrant adapter cannot replay a plan while application is being preflighted', (t) => {
  const s = setup(t, '<Grid><Button/></Grid>'),
    p = s.service.prepareRename(s.node('Button').id, 'Label'),
    base = s.session.adapter;
  s.session.adapters.WPF = {
    ...base,
    parse(source, options) {
      s.service.apply(p);
      return base.parse(source, options);
    },
  };
  rejectUnchanged(s, () => s.service.apply(p), /already active/);
  delete s.session.adapters.WPF;
  s.service.apply(p);
  assert.equal(s.session.source, p.after);
});

test('foreign attributes retain quote and entity spelling during tag and value changes', (t) => {
  const s = setup(
    t,
    "<svg><linearGradient gradientUnits = 'userSpaceOnUse' id='A&#38;B'><stop offset='0'/></linearGradient></svg>",
    true,
  );
  const id = s.node('linearGradient').id,
    p = s.service.prepareRename(id, 'radialGradient');
  assert.match(p.after, /gradientUnits = 'userSpaceOnUse' id='A&#38;B'/);
  s.service.apply(p);
  s.store.setProperty([id], 'gradientUnits', 'objectBoundingBox');
  assert.match(s.session.source, /gradientUnits = 'objectBoundingBox' id='A&#38;B'/);
});
