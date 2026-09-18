import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { builtins } from '../dist/core/registry.js';
import { completeXaml, openTags } from '../dist/core/xaml-language.js';
import { completeHtml, parseHtml, serializeHtml } from '../dist/core/html.js';
import { parseXaml } from '../dist/core/xaml.js';
import { DocumentStore } from '../dist/core/model.js';
import { DocumentSession } from '../dist/core/document-session.js';
import { SemanticLanguageService } from '../dist/core/language-service.js';
import { markupCompletionContext } from '../dist/core/markup-context.js';
const WPF = 'http://schemas.microsoft.com/winfx/2006/xaml/presentation',
  XAML = 'http://schemas.microsoft.com/winfx/2006/xaml',
  SVG = 'http://www.w3.org/2000/svg',
  MATH = 'http://www.w3.org/1998/Math/MathML',
  HTML = 'http://www.w3.org/1999/xhtml';
const registry = builtins(),
  complete = (source, options = {}) =>
    completeXaml(source, source.length, { registry, ...options }),
  labels = (items) => items.map((i) => i.label),
  html = (source) => completeHtml(source, source.length);
function service(source, html = false) {
  const store = new DocumentStore(html ? parseHtml(source) : parseXaml(source));
  const session = new DocumentSession(store, {
    source,
    ...(html ? { adapters: { HTML: { parse: parseHtml, serialize: serializeHtml } } } : {}),
  });
  return { store, session, language: new SemanticLanguageService(session, { registry }) };
}

test('completion lexer ignores comments, CDATA, declarations and quoted tag lookalikes', () => {
  assert.deepEqual(
    openTags('<Grid Tag="<Fake/> >"><![CDATA[<Wrong>]]><!-- <Other> --><?p <Bogus>?>'),
    ['Grid'],
  );
  const source = `<a:Grid xmlns:a="${WPF}" Tag="a > b"><a:Button Content="<Fake/>" Wid`;
  const scan = markupCompletionContext(source);
  assert.equal(scan.tag.type, 'a:Button');
  assert.equal(scan.tag.namespaceURI, WPF);
  assert.equal(scan.stack.length, 1);
  assert(labels(complete(source)).includes('Width'));
  for (const s of ['<!-- <Grid', '<![CDATA[<Grid', '<?pi <Grid']) assert.deepEqual(complete(s), []);
});

test('XAML namespace aliases scope, restore and decode without leaking from self-closing elements', () => {
  const source = `<a:Grid xmlns:a="${WPF}"><a:Grid xmlns:a="urn:custom"></a:Grid><Widget xmlns:a="urn:other"/><a:Sta`;
  assert(labels(complete(source)).includes('a:StackPanel'));
  assert(
    !labels(complete(`<a:Grid xmlns:a="${WPF}"><a:Grid xmlns:a="urn:custom"><a:Sta`)).includes(
      'a:StackPanel',
    ),
  );
  assert(
    labels(
      complete(
        `<Grid xmlns="urn:custom" xmlns:p="${WPF.replace('/presentation', '&#47;presentation')}"><p:Bu`,
      ),
    ).includes('p:Button'),
  );
  assert(!labels(complete(`<a:Grid xmlns:a="${WPF}"><Bu`)).includes('Button'));
});

test('aliased native types resolve registry-defined enum metadata, custom types do not inherit builtin members', () => {
  const r = builtins();
  r.registerControl({
    type: 'Fancy',
    category: 'Custom',
    properties: [{ name: 'Mode', values: ['Quiet', 'Loud'] }],
  });
  assert(labels(complete(`<a:Fancy xmlns:a="${WPF}" Mode="Q`, { registry: r })).includes('Quiet'));
  assert.deepEqual(complete('<c:Button xmlns:c="urn:custom" FontStyle="N'), []);
  assert(!labels(complete('<Button xmlns="urn:custom" Wid')).includes('Width'));
  r.registerControl({
    type: 'c:Card',
    category: 'Custom',
    properties: [{ name: 'Width', values: ['Narrow', 'Wide'] }],
  });
  assert.deepEqual(labels(complete('<c:Card Width="W', { registry: r })), ['Wide']);
});

test('XAML language attributes and markup extensions follow their actual alias', () => {
  const start = `<Grid xmlns:q="${XAML}" `;
  assert(labels(complete(start + 'q:N')).includes('q:Name'));
  assert(!labels(complete(start + 'x:N')).includes('x:Name'));
  assert(labels(complete(start + 'Tag="{q:N')).includes('q:Null'));
  assert(!labels(complete('<Grid xmlns:x="urn:custom" x:N')).includes('x:Name'));
});

test('inline content completion offers inline types and correct owner properties, not panels', () => {
  const list = labels(complete(`<a:TextBlock xmlns:a="${WPF}"><a:`));
  assert(list.includes('a:Run') && list.includes('a:Bold') && list.includes('a:TextBlock.Inlines'));
  assert(!list.includes('a:Grid'));
  const explicit = labels(complete('<TextBlock><TextBlock.Inlines><'));
  assert(explicit.includes('Run') && explicit.includes('InlineUIContainer'));
  assert(!explicit.includes('StackPanel'));
  assert(labels(complete('<Run><Run.T')).includes('Run.Text'));
  assert(!labels(complete('<Run Text="Already"><Run.T')).includes('Run.Text'));
});

test('attached members honor framework prefixes and property suggestions suppress existing attributes', () => {
  const source = `<a:Button xmlns:a="${WPF}" a:Grid.R`;
  assert(labels(complete(source)).includes('a:Grid.Row'));
  assert(!labels(complete(`<a:Button xmlns:a="${WPF}" Grid.R`)).includes('Grid.Row'));
  assert.deepEqual(
    labels(complete(`<a:Button xmlns:a="${WPF}" a:Grid.RowSpan="`)),
    Array.from({ length: 12 }, (_, i) => String(i + 1)),
  );
  assert(!labels(complete('<Button Width="12" W')).includes('Width'));
  assert(labels(complete('<Button Tag="Width=12 > x" W')).includes('Width'));
});

test('XAML literal brace escapes and property-element text do not offer binding or resource values', () => {
  const document = parseXaml(
    `<Grid xmlns:q="${XAML}"><Grid.Resources><SolidColorBrush q:Key="Accent"/></Grid.Resources></Grid>`,
  );
  assert(
    labels(complete('<Button Background="{StaticResource Ac', { document })).includes('Accent'),
  );
  assert.deepEqual(complete('<TextBlock Text="{}{Binding N', { context: { Name: 'A' } }), []);
  const { language } = service('<TextBlock Text="Sample"/>');
  assert.deepEqual(language.completions('<TextBlock Text="{}{StaticResource ', 35), []);
  const text = '<TextBlock><TextBlock.Text>{StaticResource ';
  assert.deepEqual(language.completions(text, text.length), []);
});

for (const [name, ns, prefix, item] of [
  ['SVG', SVG, '<svg><linearG', 'linearGradient'],
  ['MathML', MATH, '<math><mfr', 'mfrac'],
])
  test(`${name} element completion retains its namespace and replacement range`, () => {
    const result = html(prefix).find((x) => x.label === item);
    assert(result);
    assert.equal(prefix.slice(result.start, result.end), prefix.split('<').at(-1));
    assert.equal(result.insertText, item);
    assert.equal(
      markupCompletionContext(prefix, prefix.length, { html: true }).tag.namespaceURI,
      ns,
    );
    assert(!labels(html(prefix.slice(0, prefix.lastIndexOf('<') + 1))).includes('div'));
  });

test('SVG completion emits case-sensitive attributes and filters duplicates by HTML token casing', () => {
  const view = html('<svg viewB').find((i) => i.label === 'viewBox');
  assert.equal(view.insertText, 'viewBox=""');
  assert.equal(view.caretOffset, 9);
  assert(labels(html('<svg><linearGradient gradientU')).includes('gradientUnits'));
  assert(!labels(html('<svg VIEWBOX="0 0 1 1" view')).includes('viewBox'));
  assert(!labels(html('<svg><circle ')).includes('href'));
  assert(labels(html('<svg><circle ')).includes('r'));
});

test('HTML/SVG integration points change available children without changing foreign attributes', () => {
  for (const name of ['foreignObject', 'desc', 'title']) {
    const prefix = `<svg><${name}><`;
    assert(labels(html(prefix)).includes('div'), name);
    assert(!labels(html(prefix)).includes('circle'), name);
  }
  assert(labels(html('<svg><foreignObject width')).includes('width'));
  assert(labels(html('<svg><foreignObject><svg><')).includes('circle'));
});

test('MathML integration points and annotation encoding retain the correct child rules', () => {
  assert(labels(html('<math><mi><')).includes('span'));
  assert(labels(html('<math><mi><')).includes('mglyph'));
  assert(labels(html('<math><annotation-xml encoding="text/html"><')).includes('div'));
  assert(!labels(html('<math><annotation-xml encoding="application/xml"><')).includes('div'));
  assert(
    labels(html('<math><annotation-xml encoding="application/xhtml+xml"><svg><')).includes(
      'circle',
    ),
  );
});

test('HTML raw-text and RCDATA block fake tags but still offer actual closing names', () => {
  for (const tag of ['script', 'textarea', 'title', 'xmp', 'iframe']) {
    assert.deepEqual(html(`<${tag}>const v = '<di`), []);
    assert(labels(html(`<${tag}>body</${tag.slice(0, 2)}`)).includes(tag));
  }
  assert(labels(html('<style>body { col')).includes('color'));
  assert.deepEqual(html('<style>/* <di'), []);
  assert.deepEqual(html('<plaintext></pla'), []);
});

test('HTML quotes, comments and unquoted values cannot fabricate tag or attribute contexts', () => {
  assert.deepEqual(html('<!-- <style> color:'), []);
  assert.deepEqual(html('<div title="<style> color:'), []);
  assert.deepEqual(html('<div data-text=<svg'), []);
  assert(labels(html('<div title=" > <Fake>" wi')).includes('width'));
  assert(!labels(html('<input DISABLED dis')).includes('disabled'));
  assert(labels(html('<x-card></x-card><x-')).includes('x-card'));
  assert(!labels(html('<script>"<x-fake>"</script><x-')).includes('x-fake'));
});

test('closing suggestions ignore HTML self-close slashes and void tags', () => {
  assert(labels(html('<div/><span></')).includes('div'));
  assert(!labels(html('<div><img><br></')).includes('img'));
  assert(!labels(html('<svg><circle/></')).includes('circle'));
  assert.deepEqual(labels(html('<ul><li>A<li>B</')), ['li', 'ul']);
});

test('semantic completion uses the unfinished buffer instead of stale script, comment or tag identities', (t) => {
  controlDOM(t);
  const { language, store, session } = service('<script>old text</script><!-- old -->', true),
    before = JSON.stringify(store.document),
    revision = store.revision;
  const source = '<button type="r';
  assert.deepEqual(labels(language.completions(source, source.length)), ['reset']);
  const svg = '<svg><linearGradient gradientUnits="u';
  assert.deepEqual(labels(language.completions(svg, svg.length)), ['userSpaceOnUse']);
  const fake = '<!-- href="#';
  assert.deepEqual(language.completions(fake, fake.length), []);
  assert.equal(JSON.stringify(store.document), before);
  assert.equal(store.revision, revision);
  session.dispose();
});

test('semantic XAML completion retains native alias metadata through its registry adapter', () => {
  const r = builtins();
  r.registerControl({
    type: 'Card',
    category: 'Custom',
    properties: [{ name: 'Mode', values: ['Quiet', 'Loud'] }],
  });
  const store = new DocumentStore(parseXaml('<Grid/>')),
    session = new DocumentSession(store, { source: '<Grid/>' }),
    language = new SemanticLanguageService(session, { registry: r });
  const source = `<a:Card xmlns:a="${WPF}" Mode="Q`;
  assert.deepEqual(labels(language.completions(source, source.length)), ['Quiet']);
  session.dispose();
});

test('completion limits and malformed offsets fail without DOM or source mutation', () => {
  for (const at of [-1, NaN, Infinity, 1.5, '2', 99]) {
    assert(markupCompletionContext('<G', at).blocked);
    assert.deepEqual(completeHtml('<G', at), []);
    assert.deepEqual(completeXaml('<G', at, { registry }), []);
  }
  assert(markupCompletionContext('<G>'.repeat(152)).blocked);
  assert(markupCompletionContext('x'.repeat(2_000_001)).blocked);
  assert.equal(
    markupCompletionContext('<Grid xmlns:__proto__="urn:kept"><__proto__:Custom ').tag.namespaceURI,
    'urn:kept',
  );
  assert.equal({}.polluted, undefined);
});

test('completed attributes suppress even a fully typed duplicate without treating current names as committed', () => {
  assert(!labels(complete('<Button Width="12" Width')).includes('Width'));
  assert(labels(complete('<Button Width')).includes('Width'));
  assert(!labels(html('<svg viewBox="0 0 1 1" viewBox')).includes('viewBox'));
  assert(!labels(html('<input disabled disabled')).includes('disabled'));
  assert(labels(html('<input disabled')).includes('disabled'));
});

test('quoted equals signs remain literal values, never new XAML or HTML attributes', () => {
  assert.deepEqual(complete('<Button Tag="FontStyle=\'No'), []);
  assert.deepEqual(html('<div title="style=\'col'), []);
});
