import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { builtins } from '../dist/core/registry.js';
import { PreviewRenderer, exportHTML } from '../dist/core/render.js';
import { parseXaml, serializeXaml, diagnostics } from '../dist/core/xaml.js';
import {
  DocumentStore,
  element,
  find,
  isXamlInline,
  isXamlInlineContainer,
} from '../dist/core/model.js';
import { textTarget, setText } from '../dist/core/authoring.js';
import {
  contentHost,
  contentChildren,
  inlineContentError,
  prepareInlineContent,
  planDrop,
  applyDropPlan,
} from '../dist/core/design-tools.js';
import { createApplication } from '../dist/core/web-runtime.js';

function draw(t, source, { data = {}, interactive = false } = {}) {
  const dom = controlDOM(t),
    doc = parseXaml(source),
    renderer = new PreviewRenderer(builtins());
  renderer.sampleData = data;
  const host = dom.host();
  renderer.render(doc, host, { interactive });
  return { ...dom, doc, renderer, host };
}

test('explicit inline collections render ordered content without leaking resources or comments', (t) => {
  const { host, renderer, doc } = draw(
    t,
    '<TextBlock xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><TextBlock.Resources><x:String x:Key="secret">Not content</x:String></TextBlock.Resources><TextBlock.Inlines><Run Text="Hello "/><!-- not text --><Bold><Bold.Inlines><Italic><Run Text="world"/></Italic></Bold.Inlines></Bold><LineBreak/><Underline>Next</Underline></TextBlock.Inlines></TextBlock>',
  );
  assert.equal(host.textContent, 'Hello worldNext');
  assert.equal(host.querySelectorAll('br').length, 1);
  assert.equal(host.querySelector('[data-type="Bold"]').style.fontWeight, 'bold');
  assert.equal(host.querySelector('[data-type="Italic"]').style.fontStyle, 'italic');
  assert.equal(host.querySelector('[data-type="Underline"]').style.textDecorationLine, 'underline');
  assert.equal(renderer.elements.size, 7);
  assert.equal(
    diagnostics(doc, builtins()).filter((x) =>
      /Unknown.*(?:Run|Span|Bold|Italic|Underline|LineBreak)/.test(x.message),
    ).length,
    0,
  );
});

test('inline styles, resources, inherited contexts and effective property maps use the main renderer', (t) => {
  const { host, doc, renderer } = draw(
    t,
    '<TextBlock xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" DataContext="{Binding Person}"><TextBlock.Resources><SolidColorBrush x:Key="Ink" Color="#FF224466"/><Style TargetType="Run"><Setter Property="FontSize" Value="23"/><Setter Property="Foreground" Value="{StaticResource Ink}"/></Style></TextBlock.Resources><Span FontFamily="serif" FontStyle="Italic"><Run Text="{Binding Name}" FontWeight="SemiBold" BaselineAlignment="Superscript"/></Span></TextBlock>',
    { data: { Person: { Name: 'Ada' } } },
  );
  assert.equal(host.textContent, 'Ada');
  const run = doc.root.children[1].children[0],
    el = renderer.elements.get(run.id);
  assert.equal(el.style.fontSize, '23px');
  assert.equal(el.style.fontWeight, '600');
  assert.equal(el.style.verticalAlign, 'super');
  assert.equal(renderer.effectiveProperties.get(run.id).Text, 'Ada');
  assert.equal(el.dataset.sourceNodeId, run.id);
  assert.equal(el.parentElement.style.fontFamily, 'serif');
});

test('Run.Text property content remains literal and can be edited without removing its comments', (t) => {
  const { doc, renderer, host } = draw(
    t,
    '<TextBlock><Run><Run.Text><!-- keep -->{Binding Literal}</Run.Text></Run></TextBlock>',
  );
  const run = doc.root.children[0],
    comment = run.children[0].children[0];
  assert.equal(host.textContent, '{Binding Literal}');
  assert.equal(textTarget(run).value, '{Binding Literal}');
  setText(run, '{Updated}');
  assert.equal(run.children[0].children[0], comment);
  renderer.render(doc, host);
  assert.equal(host.textContent, '{Updated}');
  assert.match(serializeXaml(doc), /<!-- keep -->/);
});

for (const type of ['TextBlock', 'Run'])
  test(`${type} literal escape prefix is removed only when resolving an attribute`, (t) => {
    const xml =
      type === 'Run'
        ? '<TextBlock><Run Text="{}{Hello}"/></TextBlock>'
        : '<TextBlock Text="{}{Hello}"/>';
    const { host, doc } = draw(t, xml);
    assert.equal(host.textContent, '{Hello}');
    assert.match(serializeXaml(doc), /Text="\{\}\{Hello\}"/);
  });

test('TextBlock.Text property syntax displays literal content', (t) => {
  const { host } = draw(
    t,
    '<TextBlock><TextBlock.Text>Explicit &amp; literal</TextBlock.Text></TextBlock>',
  );
  assert.equal(host.textContent, 'Explicit & literal');
});

test('inline UI children remain real selectable controls with events', (t) => {
  const { host, renderer } = draw(
    t,
    '<TextBlock>Before <InlineUIContainer><InlineUIContainer.Child><Button Content="Action"/></InlineUIContainer.Child></InlineUIContainer> after</TextBlock>',
    { interactive: true },
  );
  const events = [];
  renderer.onEvent = (e) => events.push(e);
  host.querySelector('button').click();
  assert.equal(events.filter((e) => e.event === 'Click').length, 1);
  assert.equal(host.querySelector('[data-type="InlineUIContainer"]').style.display, 'inline-block');
  assert.equal(host.textContent, 'Before Action after');
});

test('hyperlink activation is host-owned and never injects an executable href', (t) => {
  const { host, renderer, window } = draw(
    t,
    '<TextBlock><Hyperlink NavigateUri="javascript:alert(1)"><Run Text="Link"/></Hyperlink></TextBlock>',
    { interactive: true },
  );
  const events = [];
  renderer.onEvent = (e) => events.push(e);
  const link = host.querySelector('a');
  assert.equal(link.getAttribute('href'), null);
  assert.equal(link.tabIndex, 0);
  link.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  assert.equal(events.filter((e) => e.event === 'Click').length, 1);
  assert.equal(events.find((e) => e.event === 'Click').value, 'javascript:alert(1)');
});

test('disabled and design-time hyperlinks cannot activate', (t) => {
  const { host, renderer } = draw(
    t,
    '<TextBlock IsEnabled="False"><Hyperlink NavigateUri="https://example.test">Link</Hyperlink></TextBlock>',
    { interactive: true },
  );
  const events = [];
  renderer.onEvent = (e) => events.push(e);
  const link = host.querySelector('a');
  link.click();
  assert.equal(link.getAttribute('aria-disabled'), 'true');
  assert.equal(link.tabIndex, -1);
  assert.equal(events.filter((e) => e.event === 'Click').length, 0);
});

test('empty spans do not acquire layout-container minimum sizes', (t) => {
  const { host } = draw(t, '<TextBlock><Span/><Run Text=""/></TextBlock>');
  for (const span of host.querySelectorAll('span')) {
    assert(!span.classList.contains('empty-container'));
    assert.equal(parseFloat(span.style.minHeight), 0);
  }
});

test('repeated template inline instances retain unique selectable identities and context', (t) => {
  const { host, renderer } = draw(
    t,
    '<ItemsControl ItemsSource="{Binding People}"><ItemsControl.ItemTemplate><DataTemplate><TextBlock><TextBlock.Inlines><Run Text="{Binding Name}"/></TextBlock.Inlines></TextBlock></DataTemplate></ItemsControl.ItemTemplate></ItemsControl>',
    { data: { People: [{ Name: 'A' }, { Name: 'B' }] } },
  );
  const runs = [...host.querySelectorAll('[data-type="Run"]')];
  assert.deepEqual(
    runs.map((x) => x.textContent),
    ['A', 'B'],
  );
  assert.notEqual(runs[0].dataset.nodeId, runs[1].dataset.nodeId);
  assert.equal(runs[0].dataset.sourceNodeId, runs[1].dataset.sourceNodeId);
  assert(runs.every((x) => renderer.effectiveProperties.has(x.dataset.nodeId)));
});

test('inline collection helpers and placement guards are namespace-aware', () => {
  const parent = element('TextBlock'),
    run = element('Run'),
    button = element('Button');
  assert(isXamlInline(run));
  assert(isXamlInlineContainer(parent));
  assert(inlineContentError(parent, [button]));
  assert(inlineContentError(element('Grid'), [run]));
  assert.equal(inlineContentError(parent, [run]), null);
  assert.equal(isXamlInline({ ...run, namespaceURI: 'urn:custom' }), false);
  const wrapped = parseXaml(
    '<TextBlock><TextBlock.Inlines><Run Text="A"/></TextBlock.Inlines></TextBlock>',
  ).root;
  assert.equal(contentHost(wrapped), wrapped.children[0]);
  assert.equal(contentChildren(wrapped)[0], wrapped.children[0].children[0]);
});

test('inserting an inline converts existing literal text without losing content and supports undo', () => {
  const doc = parseXaml('<TextBlock Text="{}{literal}"/>'),
    store = new DocumentStore(doc);
  store.transaction('Insert bold', (d) =>
    prepareInlineContent(d.root).children.push(builtins().create('Bold')),
  );
  assert.equal(store.document.root.props.Text, undefined);
  assert.equal(store.document.root.children[0].props.Text, '{}{literal}');
  assert.equal(store.document.root.children[1].type, 'Bold');
  store.undo();
  assert.equal(store.document.root.props.Text, '{}{literal}');
  store.redo();
  assert.equal(store.document.root.children[0].props.Text, '{}{literal}');
});

test('bound text cannot be replaced by visual inline insertion', () => {
  const root = parseXaml('<TextBlock Text="{Binding Name}"/>').root,
    before = JSON.stringify(root);
  assert.match(inlineContentError(root, [element('Run')]), /bound/);
  assert.throws(() => prepareInlineContent(root), /bound/);
  assert.equal(JSON.stringify(root), before);
});

test('moving an inline into explicit Inlines keeps the wrapper and the target literal', () => {
  const doc = parseXaml(
    '<Grid><TextBlock><Run Text="Move"/></TextBlock><TextBlock Text="Keep"><TextBlock.Inlines/></TextBlock></Grid>',
  );
  const run = doc.root.children[0].children[0],
    target = doc.root.children[1];
  const plan = planDrop({
    root: doc.root,
    registry: builtins(),
    ids: [run.id],
    parentId: target.id,
  });
  assert(plan.allowed);
  applyDropPlan(doc, plan);
  assert.deepEqual(
    contentHost(target).children.map((x) => x.props.Text),
    ['Keep', 'Move'],
  );
  const invalid = planDrop({
    root: doc.root,
    registry: builtins(),
    ids: [run.id],
    parentId: doc.root.id,
  });
  assert.equal(invalid.allowed, false);
});

test('inline HTML export carries actual formatting and removes all editor identities', (t) => {
  controlDOM(t);
  const source = parseXaml(
    '<TextBlock><TextBlock.Inlines><Bold><Run Text="Saved"/></Bold><LineBreak/><Run Text="Other"/></TextBlock.Inlines></TextBlock>',
  );
  const output = exportHTML(source, builtins());
  assert.match(output, /font-weight: bold/);
  assert.match(output, /<br/);
  assert.match(output, /Saved/);
  assert.doesNotMatch(output, /data-node-id|data-instance-id|data-source-node-id/);
});

test('alternate namespace prefixes identify the same inline content property', (t) => {
  const { host, doc } = draw(
    t,
    '<a:TextBlock xmlns:a="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:b="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><b:TextBlock.Inlines><a:Run><b:Run.Text>Alias text</b:Run.Text></a:Run></b:TextBlock.Inlines></a:TextBlock>',
  );
  assert.equal(host.textContent, 'Alias text');
  const run = doc.root.children[0].children[0];
  assert.equal(textTarget(run).value, 'Alias text');
  setText(run, 'Edited alias');
  assert.equal(run.children[0].children[0].text, 'Edited alias');
});

test('standalone application updates bound inline text and named inline properties', (t) => {
  const dom = controlDOM(t);
  const app = createApplication({
    source:
      '<TextBlock xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><TextBlock.Inlines><Run x:Name="InlineName" Text="{Binding Name}"/></TextBlock.Inlines></TextBlock>',
    data: { Name: 'First' },
  }).mount(dom.host());
  t.after(() => app.dispose());
  assert.equal(app.findName('InlineName').textContent, 'First');
  app.setData('Name', 'Second');
  app.refresh();
  assert.equal(app.findName('InlineName').textContent, 'Second');
  app.setValue('InlineName', 'FontSize', 26);
  app.refresh();
  assert.equal(app.findName('InlineName').style.fontSize, '26px');
});

test('runtime inherits through explicit collections and Bold establishes its own weight', (t) => {
  const dom = controlDOM(t);
  const app = createApplication({
    source:
      '<TextBlock xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" FontSize="22" FontWeight="Normal"><TextBlock.Inlines><Bold><Bold.Inlines><Run x:Name="BoldRun" Text="strong"/></Bold.Inlines></Bold><Run x:Name="PlainRun" Text="plain"/></TextBlock.Inlines></TextBlock>',
  });
  t.after(() => app.dispose());
  app.mount(dom.host());
  assert.equal(app.findName('BoldRun').style.fontSize, '22px');
  assert.equal(app.findName('BoldRun').style.fontWeight, '700');
  assert.equal(app.findName('PlainRun').style.fontWeight, '400');
});
