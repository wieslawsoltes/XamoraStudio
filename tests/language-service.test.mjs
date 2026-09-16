import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentSession } from '../dist/core/document-session.js';
import { DocumentStore, walk } from '../dist/core/model.js';
import { parseXaml, serializeXaml } from '../dist/core/xaml.js';
import { builtins } from '../dist/core/registry.js';
import { SemanticLanguageService } from '../dist/core/language-service.js';

const X = 'http://schemas.microsoft.com/winfx/2006/xaml';
function setup(source, { html = false, ...options } = {}) {
  const adapter = {
    parse(text) {
      const doc = parseXaml(text);
      doc.framework = 'HTML';
      doc.name = 'index.html';
      return doc;
    },
    serialize(doc) {
      return serializeXaml({ ...doc, framework: 'WPF' });
    },
  };
  const store = new DocumentStore(html ? adapter.parse(source) : parseXaml(source));
  const session = new DocumentSession(store, {
    source,
    ...(html ? { adapters: { HTML: adapter } } : {}),
  });
  const service = new SemanticLanguageService(session, { registry: builtins(), ...options });
  return { store, session, service };
}
function at(source, needle, within = needle) {
  const start = source.indexOf(needle);
  assert.notEqual(start, -1, `Missing source fragment ${needle}`);
  const inner = needle.indexOf(within);
  assert.notEqual(inner, -1);
  return start + inner + Math.min(1, within.length - 1);
}
function named(document, name) {
  let found;
  walk(document.root, (n) => {
    if (n.props?.['x:Name'] === name || n.props?.Name === name || n.props?.id === name) found = n;
  });
  assert.ok(found, `Missing element ${name}`);
  return found;
}
function values(source, occurrences) {
  return occurrences.map((o) => source.slice(o.start, o.end));
}
function assertLocations(source, occurrences) {
  for (const o of occurrences) {
    assert.ok(Number.isInteger(o.start) && o.end > o.start);
    assert.ok(o.nodeId);
    const prefix = source.slice(0, o.start),
      line = prefix.split('\n').length,
      column = o.start - prefix.lastIndexOf('\n');
    assert.equal(o.line, line);
    assert.equal(o.column, column);
  }
}

test('semantic symbols use namespace identity and retain source coordinates', () => {
  const source = `<Grid xmlns:n='${X}' xmlns:custom='urn:custom'>\n  <Button n:Name = 'Save' custom:Name='Unrelated'/>\n  <TextBox Name='Input'/>\n  <Grid.Resources><SolidColorBrush n:Key='Accent' Color='Blue'/></Grid.Resources>\n</Grid>`;
  const { service } = setup(source),
    symbols = service.symbols().filter((s) => s.renamable !== false);
  assert.deepEqual(symbols.map((s) => s.name).sort(), ['Accent', 'Input', 'Save']);
  assert.equal(symbols.find((s) => s.name === 'Accent').kind, 'resource');
  assert.equal(symbols.find((s) => s.name === 'Save').kind, 'element');
  for (const symbol of symbols) {
    assert.ok(symbol.id);
    assert.ok(symbol.scopeId);
    assert.equal(source.slice(symbol.selectionRange.start, symbol.selectionRange.end), symbol.name);
  }
  assertLocations(source, symbols);
});

test('definition and references resolve XAML names without touching literal text or comments', () => {
  const source = `<Grid xmlns:x='${X}'>\n  <!-- Save is a comment -->\n  <Button x:Name = 'Save' Content='Save'/>\n  <TextBlock Text='{Binding ElementName=Save, Path=Content}' Tag='{x:Reference Save}'/>\n  <DoubleAnimation Storyboard.TargetName='Save'/>\n  <EventTrigger SourceName='Save'><Setter TargetName='Save' Property='Opacity' Value='1'/></EventTrigger>\n</Grid>`;
  const { service, store } = setup(source),
    caret = at(source, 'ElementName=Save', 'Save');
  assert.deepEqual(
    service.definitionAt(caret).map((d) => d.nodeId),
    [named(store.document, 'Save').id],
  );
  const occurrences = service.referencesAt(caret);
  assert.equal(occurrences.length, 6);
  assert.deepEqual(values(source, occurrences), Array(6).fill('Save'));
  assert.equal(occurrences.filter((o) => o.declaration).length, 1);
  assertLocations(source, occurrences);
  assert.equal(service.referencesAt(caret, { includeDeclaration: false }).length, 5);
  assert.deepEqual(service.definitionAt(at(source, "Content='Save'", 'Save')), []);
  assert.deepEqual(service.definitionAt(at(source, '<!-- Save is a comment -->', 'Save')), []);
});

test('XAML rename is one revision with exact formatting preservation and unified undo', () => {
  const source = `<?xml version='1.0'?>\r\n<Grid xmlns:x='${X}'>\r\n  <!-- Save -->\r\n  <Button  x:Name = 'Save' Content="Save"/>\r\n  <TextBlock Text='{Binding ElementName=Save, Path=Content}' Tag='{x:Reference Save}'/>\r\n</Grid>`;
  const { service, session, store } = setup(source),
    revision = session.revision,
    history = store.history.length;
  const result = service.rename(at(source, 'ElementName=Save', 'Save'), 'Confirm', {
    expectedRevision: revision,
  });
  const expected = source
    .replace("x:Name = 'Save'", "x:Name = 'Confirm'")
    .replace('ElementName=Save', 'ElementName=Confirm')
    .replace('{x:Reference Save}', '{x:Reference Confirm}');
  assert.equal(result.count, 3);
  assert.equal(result.revision, revision + 1);
  assert.equal(store.history.length, history + 1);
  assert.equal(session.source, expected);
  assert.ok(named(store.document, 'Confirm'));
  session.undo();
  assert.equal(session.source, source);
  assert.ok(named(store.document, 'Save'));
  session.redo();
  assert.equal(session.source, expected);
  assert.ok(named(store.document, 'Confirm'));
});

test('namespace-aliased x:Reference and quoted binding names navigate and rename their value tokens', () => {
  const source = `<Grid xmlns:n='${X}'><Button n:Name='Save'/><TextBlock Text="{Binding ElementName='Save', Path=Content}" Tag='{n:Reference Name=Save}'/><ContentControl Content='{n:Reference Save}'/></Grid>`;
  const { service, session } = setup(source),
    caret = at(source, "ElementName='Save'", 'Save');
  assert.equal(service.definitionAt(caret)[0].name, 'Save');
  assert.equal(service.referencesAt(caret).length, 4);
  assert.equal(service.rename(caret, 'Confirm').count, 4);
  assert.equal(session.source, source.replaceAll('Save', 'Confirm'));
});

test('XAML template namescopes resolve and rename repeated parts independently', () => {
  const source = `<Grid xmlns:x='${X}'>
  <Grid.Resources>
    <ControlTemplate x:Key='First'><Grid><Button x:Name='PART_Content'/><TextBlock Text='{Binding ElementName=PART_Content}'/></Grid></ControlTemplate>
    <ControlTemplate x:Key='Second'><Grid><Button x:Name='PART_Content'/><TextBlock Text='{Binding ElementName=PART_Content}'/></Grid></ControlTemplate>
  </Grid.Resources>
  <Button x:Name='Outside'/>
</Grid>`;
  const { service, session } = setup(source),
    parts = service.symbols().filter((s) => s.name === 'PART_Content');
  assert.equal(parts.length, 2);
  assert.notEqual(parts[0].scopeId, parts[1].scopeId);
  assert.equal(service.referencesAt(parts[0].selectionRange.start + 1).length, 2);
  assert.equal(service.referencesAt(parts[1].selectionRange.start + 1).length, 2);
  assert.equal(
    service.diagnostics().some((d) => /duplicate|ambiguous/i.test(d.message)),
    false,
  );
  const result = service.rename(parts[0].selectionRange.start + 1, 'PART_Icon');
  assert.equal(result.count, 2);
  assert.equal(
    session.source,
    source
      .replace("x:Name='PART_Content'", "x:Name='PART_Icon'")
      .replace('ElementName=PART_Content', 'ElementName=PART_Icon'),
  );
});

test('local resource lookup honors lexical shadowing during navigation and rename', () => {
  const source = `<Grid xmlns:x='${X}'>
  <Grid.Resources><SolidColorBrush x:Key='Accent' Color='Blue'/></Grid.Resources>
  <Button Background='{StaticResource Accent}'/>
  <StackPanel>
    <StackPanel.Resources><SolidColorBrush x:Key='Accent' Color='Red'/></StackPanel.Resources>
    <Button Background='{DynamicResource Accent}'/>
  </StackPanel>
</Grid>`;
  const { service, session } = setup(source),
    resources = service.symbols().filter((s) => s.name === 'Accent'),
    outerRef = at(source, '{StaticResource Accent}', 'Accent'),
    innerRef = at(source, '{DynamicResource Accent}', 'Accent');
  assert.equal(resources.length, 2);
  assert.notEqual(resources[0].scopeId, resources[1].scopeId);
  assert.equal(service.definitionAt(outerRef)[0].nodeId, resources[0].nodeId);
  assert.equal(service.definitionAt(innerRef)[0].nodeId, resources[1].nodeId);
  assert.equal(service.referencesAt(innerRef).length, 2);
  assert.equal(
    service.diagnostics().some((d) => /duplicate|ambiguous/i.test(d.message)),
    false,
  );
  assert.equal(service.rename(innerRef, 'InnerAccent').count, 2);
  const split = source.indexOf('<StackPanel>');
  assert.equal(
    session.source,
    source.slice(0, split) + source.slice(split).replaceAll('Accent', 'InnerAccent'),
  );
});

test('DataTemplate names do not leak to outer namescopes or other template instances', () => {
  const source = `<Grid xmlns:x='${X}'><Button x:Name='Outside'/><Grid.Resources><DataTemplate x:Key='Row'><StackPanel><Button x:Name='Inside'/><TextBlock Text='{Binding ElementName=Outside}'/></StackPanel></DataTemplate></Grid.Resources><TextBlock Text='{Binding ElementName=Inside}'/></Grid>`;
  const { service } = setup(source);
  assert.deepEqual(service.definitionAt(at(source, 'ElementName=Outside', 'Outside')), []);
  assert.deepEqual(service.definitionAt(at(source, 'ElementName=Inside', 'Inside')), []);
  assert.ok(service.diagnostics().some((d) => d.message.includes('Outside')));
  assert.ok(service.diagnostics().some((d) => d.message.includes('Inside')));
});

test('duplicate resource keys in one dictionary diagnose ambiguity and block a partial rename', () => {
  const source = `<Grid xmlns:x='${X}'><Grid.Resources><SolidColorBrush x:Key='Accent' Color='Blue'/><SolidColorBrush x:Key='Accent' Color='Red'/></Grid.Resources><Button Background='{StaticResource Accent}'/></Grid>`;
  const { service, session } = setup(source),
    caret = at(source, '{StaticResource Accent}', 'Accent'),
    revision = session.revision;
  assert.equal(service.definitionAt(caret).length, 2);
  assert.ok(service.diagnostics().some((d) => /duplicate|ambiguous/i.test(d.message)));
  assert.throws(() => service.rename(caret, 'Foreground'));
  assert.equal(session.source, source);
  assert.equal(session.revision, revision);
});

test('same-scope duplicate declarations diagnose ambiguity and reject rename atomically', () => {
  const source = `<Grid xmlns:x='${X}'><Button x:Name='Save'/><TextBox Name='Save'/><TextBlock Text='{Binding ElementName=Save}'/></Grid>`;
  const { service, session, store } = setup(source),
    revision = session.revision,
    history = store.history.length,
    caret = at(source, 'ElementName=Save', 'Save');
  assert.equal(service.definitionAt(caret).length, 2);
  assert.ok(service.diagnostics().some((d) => /duplicate|ambiguous/i.test(d.message)));
  assert.throws(() => service.rename(caret, 'Confirm'), /ambiguous|duplicate|unique/i);
  assert.equal(session.source, source);
  assert.equal(session.revision, revision);
  assert.equal(store.history.length, history);
});

test('rename rejects invalid identifiers, collisions, and stale revisions without losing edits', () => {
  const source = `<Grid xmlns:x='${X}'><Button x:Name='Save'/><TextBox x:Name='Input'/><TextBlock Text='{Binding ElementName=Save}'/></Grid>`;
  const { service, session, store } = setup(source),
    caret = at(source, "x:Name='Save'", 'Save'),
    revision = session.revision;
  for (const name of ['', 'not valid', '1invalid', 'Input']) {
    assert.throws(() => service.rename(caret, name));
    assert.equal(session.source, source);
    assert.equal(session.revision, revision);
  }
  store.setProperty([named(store.document, 'Save').id], 'Content', 'Panel edit');
  const current = session.source,
    currentRevision = session.revision;
  assert.throws(
    () => service.rename(caret, 'Confirm', { expectedRevision: revision }),
    /revision|changed|stale/i,
  );
  assert.equal(session.source, current);
  assert.equal(session.revision, currentRevision);
});

test('source changes, visual edits, and undo invalidate the semantic index', () => {
  const source = `<Grid xmlns:x='${X}'><Button x:Name='Save'/><TextBlock Text='{Binding ElementName=Save}'/></Grid>`;
  const { service, session, store } = setup(source),
    id = named(store.document, 'Save').id;
  assert.equal(service.symbols().find((s) => s.name === 'Save').nodeId, id);
  session.updateSource(source.replaceAll('Save', 'Confirm'));
  assert.equal(service.symbols().find((s) => s.name === 'Confirm').nodeId, id);
  assert.equal(
    service.symbols().some((s) => s.name === 'Save'),
    false,
  );
  store.setProperty([id], 'x:Name', 'PanelName');
  assert.ok(service.symbols().some((s) => s.name === 'PanelName'));
  assert.deepEqual(service.definitionAt(at(session.source, 'ElementName=Confirm', 'Confirm')), []);
  session.undo();
  assert.equal(
    service.referencesAt(at(session.source, 'ElementName=Confirm', 'Confirm')).length,
    2,
  );
  session.undo();
  assert.equal(session.source, source);
  assert.equal(service.symbols().find((s) => s.name === 'Save').nodeId, id);
});

test('unresolved explicit local names report diagnostics while unknown external resources stay unresolved', () => {
  const source = `<Grid xmlns:x='${X}' xmlns:acme='urn:custom'><Button Content='{Binding ElementName=MissingLocal}' Tag='{x:Reference OtherMissing}' Background='{DynamicResource RuntimeAccent}' Style='{StaticResource ImportedStyle}' acme:Value='{acme:Lookup Arbitrary}'/></Grid>`;
  const { service } = setup(source),
    diagnostics = service.diagnostics();
  assert.ok(diagnostics.some((d) => d.message.includes('MissingLocal')));
  assert.ok(diagnostics.some((d) => d.message.includes('OtherMissing')));
  assert.equal(
    diagnostics.some((d) => /RuntimeAccent|ImportedStyle|Arbitrary/.test(d.message)),
    false,
  );
  for (const d of diagnostics) {
    assert.ok(d.code);
    assert.ok(d.severity);
    assert.ok(d.end > d.start);
    assert.ok(d.line >= 1 && d.column >= 1);
  }
  assert.deepEqual(
    service.definitionAt(at(source, '{DynamicResource RuntimeAccent}', 'RuntimeAccent')),
    [],
  );
});

test('invalid drafts cannot be renamed and retain their last valid document', () => {
  const source = `<Grid xmlns:x='${X}'><Button x:Name='Save'/></Grid>`;
  const { service, session, store } = setup(source),
    id = named(store.document, 'Save').id;
  session.updateSource(source.slice(0, -7));
  const draft = session.source,
    revision = session.revision;
  assert.throws(() => service.rename(at(draft, "x:Name='Save'", 'Save'), 'Confirm'));
  assert.equal(session.source, draft);
  assert.equal(session.revision, revision);
  assert.equal(named(store.document, 'Save').id, id);
  assert.ok(session.diagnostics.some((d) => d.severity === 'error'));
});

test('encoded symbol spellings are preserved and cannot be unsafely renamed', () => {
  const source = `<Grid xmlns:x='${X}'><Button x:Name='S&#97;ve'/><TextBlock Text='{Binding ElementName=Save}'/></Grid>`;
  const { service, session } = setup(source),
    revision = session.revision;
  assert.throws(
    () => service.rename(at(source, 'ElementName=Save', 'Save'), 'Confirm'),
    /encoded|unsupported|unescaped|range|safely/i,
  );
  assert.equal(session.source, source);
  assert.equal(session.revision, revision);
});

test('semantic completions retain toolkit values and restrict names to the current namescope', () => {
  const source = `<Grid xmlns:x='${X}'><Button x:Name='Outside'/><Grid.Resources><ControlTemplate x:Key='Template'><Grid><Button x:Name='Inside'/><TextBlock Text='{Binding ElementName=}'/></Grid></ControlTemplate></Grid.Resources></Grid>`;
  const { service } = setup(source),
    offset = source.indexOf('ElementName=') + 'ElementName='.length,
    items = service.completions(source, offset);
  assert.ok(items.some((x) => x.label === 'Inside'));
  assert.equal(
    items.some((x) => x.label === 'Outside'),
    false,
  );
  const property = service.completions('<Button Wid', 11).find((x) => x.label === 'Width');
  assert.ok(property);
  assert.equal(property.insertText, 'Width=""');
  assert.ok(
    service.completions('<StackPanel Orientation="H', 26).some((x) => x.label === 'Horizontal'),
  );
});

test('HTML symbols resolve native ID references, fragment URLs, inline URLs, and style selectors', () => {
  const source = `<html><head><style>#save:hover { color: red; } #other { color: blue; }</style></head><body>
  <!-- save is only a comment -->
  <button id = 'save'>save</button><button id='other'>Other</button>
  <label for='save'>Caption</label><a href='#save'>Jump</a>
  <div aria-labelledby='other save' aria-describedby='save' headers='save other' style='clip-path:url(#save)'></div>
</body></html>`;
  const { service, store } = setup(source, { html: true }),
    caret = at(source, "href='#save'", 'save'),
    declaration = service.definitionAt(caret);
  assert.equal(declaration.length, 1);
  assert.equal(declaration[0].kind, 'html-id');
  assert.equal(declaration[0].nodeId, named(store.document, 'save').id);
  const occurrences = service.referencesAt(caret);
  assert.equal(occurrences.length, 8);
  assert.deepEqual(values(source, occurrences), Array(8).fill('save'));
  assertLocations(source, occurrences);
  assert.equal(service.referencesAt(caret, { includeDeclaration: false }).length, 7);
});

test('HTML rename preserves text, scripts, CSS strings, comments, and external URL fragments', () => {
  const source = `<html><head><style>/* #save */ #save:hover { color:red; } .note::after { content:'#save'; }</style><script>const target = '#save';</script></head><body>
  <!-- save --> <button id = 'save' title='save'>save</button>
  <label for='save'>Save</label><a href='#save'>Jump</a><a href='other.html#save'>External</a>
  <div aria-labelledby='save other' style='clip-path: url(#save)'></div><span id='other'></span>
</body></html>`;
  const { service, session, store } = setup(source, { html: true }),
    revision = session.revision,
    history = store.history.length;
  const expected = source
    .replace('*/ #save:hover', '*/ #confirm:hover')
    .replace("id = 'save'", "id = 'confirm'")
    .replace("for='save'", "for='confirm'")
    .replace("href='#save'", "href='#confirm'")
    .replace("aria-labelledby='save other'", "aria-labelledby='confirm other'")
    .replace('url(#save)', 'url(#confirm)');
  assert.equal(service.rename(at(source, "for='save'", 'save'), 'confirm').count, 6);
  assert.equal(session.source, expected);
  assert.equal(session.revision, revision + 1);
  assert.equal(store.history.length, history + 1);
  session.undo();
  assert.equal(session.source, source);
  session.redo();
  assert.equal(session.source, expected);
});

test('HTML form, list, and multiple IDREF tokens resolve independently', () => {
  const source =
    "<html><head></head><body><form id='checkout'></form><datalist id='choices'></datalist><span id='help'>Help</span><input form='checkout' list='choices' aria-describedby='help missing' /></body></html>";
  const { service } = setup(source, { html: true });
  for (const [attribute, name] of [
    ['form', 'checkout'],
    ['list', 'choices'],
  ]) {
    const caret = at(source, `${attribute}='${name}'`, name);
    assert.equal(service.definitionAt(caret)[0].name, name);
    assert.equal(service.referencesAt(caret).length, 2);
  }
  assert.equal(
    service.definitionAt(at(source, "aria-describedby='help missing'", 'help'))[0].name,
    'help',
  );
  assert.deepEqual(
    service.definitionAt(at(source, "aria-describedby='help missing'", 'missing')),
    [],
  );
  assert.ok(service.diagnostics().some((d) => d.message.includes('missing')));
});

test('duplicate HTML IDs reject a partial rename without changing history', () => {
  const source =
    "<html><head></head><body><button id='save'></button><div id='save'></div><label for='save'>Save</label></body></html>";
  const { service, session, store } = setup(source, { html: true }),
    history = store.history.length;
  assert.equal(service.definitionAt(at(source, "for='save'", 'save')).length, 2);
  assert.ok(service.diagnostics().some((d) => /duplicate|ambiguous/i.test(d.message)));
  assert.throws(() => service.rename(at(source, "for='save'", 'save'), 'confirm'));
  assert.equal(session.source, source);
  assert.equal(store.history.length, history);
});

test('rename rejects capturing an existing unresolved reference to the proposed name', () => {
  const { session, service } = setup(
    '<Grid xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><Button x:Name="Old"/><TextBlock Text="{Binding ElementName=New, Path=Content}"/></Grid>',
  );
  const before = session.source;
  assert.throws(() => service.rename(before.indexOf('Old'), 'New'), /capture/i);
  assert.equal(session.source, before);
});

test('literal strings that resemble markup extensions do not become semantic references', () => {
  const source = `<Grid xmlns:x="${X}"><Button x:Name="Save"/><TextBlock Text="literal {x:Reference Save}"/><TextBlock Text="{Binding ConverterParameter='ElementName=Save'}"/></Grid>`;
  const { service, session } = setup(source);
  assert.equal(service.referencesAt(source.indexOf('x:Name="Save"') + 9).length, 1);
  service.rename(source.indexOf('x:Name="Save"') + 9, 'Commit');
  assert.ok(session.source.includes('literal {x:Reference Save}'));
  assert.ok(session.source.includes("ConverterParameter='ElementName=Save'"));
});
test('CSS URL references ignore comments and content strings', () => {
  const source =
    '<html><head><style>/* url(#target) */ p { content: "url(#target)"; filter: URL(#target); }</style></head><body><div id="target"/></body></html>';
  const { service, session } = setup(source, { html: true });
  service.rename(source.indexOf('id="target"') + 5, 'next');
  assert.ok(session.source.includes('/* url(#target) */'));
  assert.ok(session.source.includes('content: "url(#target)"'));
  assert.ok(session.source.includes('URL(#next)'));
});
test('encoded literal references block a rename that would otherwise leave a stale reference', () => {
  const source = `<Grid xmlns:x="${X}"><Button x:Name="Save"/><TextBlock Text="{Binding ElementName=S&#97;ve}"/></Grid>`;
  const { service, session } = setup(source);
  assert.throws(() => service.rename(source.indexOf('x:Name="Save"') + 9, 'Commit'), /encoded/i);
  assert.equal(session.source, source);
});
test('nested CSS selectors require review before HTML id rename', () => {
  const source =
    '<html><head><style>.parent { color: red; &amp; #target { color: blue; } }</style></head><body><div id="target"/></body></html>';
  const { service, session } = setup(source, { html: true });
  assert.throws(() => service.rename(source.indexOf('id="target"') + 5, 'next'), /nested/i);
  assert.equal(session.source, source);
});

test('HTML template fragments keep their id declarations in separate scopes', () => {
  const source =
    '<html><head/><body><button id="action"/><template><button id="action"/><label for="action"/></template><label for="action"/></body></html>';
  const { service, session } = setup(source, { html: true });
  assert.equal(
    service.diagnostics().filter((issue) => issue.code === 'ambiguous-declaration').length,
    0,
  );
  const inner = source.indexOf('id="action"', source.indexOf('<template>')) + 5;
  assert.equal(service.referencesAt(inner).length, 2);
  service.rename(inner, 'localAction');
  assert.equal((session.source.match(/id="action"/g) || []).length, 1);
  assert.ok(
    session.source.includes(
      '<template><button id="localAction"/><label for="localAction"/></template>',
    ),
  );
});

test('merged dictionary resources refuse rename when project-wide lookup is required', () => {
  const source = `<ResourceDictionary xmlns:x="${X}"><ResourceDictionary.MergedDictionaries><ResourceDictionary><SolidColorBrush x:Key="Shared" Color="Red"/></ResourceDictionary></ResourceDictionary.MergedDictionaries><Style x:Key="Style" BasedOn="{StaticResource Shared}"/></ResourceDictionary>`;
  const { service, session } = setup(source);
  assert.throws(
    () => service.rename(source.indexOf('x:Key="Shared"') + 8, 'Changed'),
    /merged|project/i,
  );
  assert.equal(session.source, source);
});

test('HTML and CSS value completion follows the containing attribute or declaration', () => {
  const source =
    '<html><head><style>button { display: fl; }</style></head><body><button type="su" role="bu" style="position: ab"/><script>const text="display: fl";</script></body></html>';
  const { service } = setup(source, { html: true });
  const complete = (needle) =>
    service.completions(source, source.indexOf(needle) + needle.length).map((item) => item.label);
  assert.deepEqual(complete('display: fl'), ['flex']);
  assert.deepEqual(complete('type="su'), ['submit']);
  assert.deepEqual(complete('role="bu'), ['button']);
  assert.deepEqual(complete('position: ab'), ['absolute']);
  assert.deepEqual(
    service.completions(source, source.lastIndexOf('display: fl') + 'display: fl'.length),
    [],
  );
});
