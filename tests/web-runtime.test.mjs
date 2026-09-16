import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ObservableState,
  RuntimePropertyRegistry,
  RuntimePropertyStore,
  coerceProperty,
  observable,
} from '../dist/core/runtime-properties.js';
import { createApplication, RUNTIME_STYLES } from '../dist/core/web-runtime.js';
import { parseXaml, diagnostics } from '../dist/core/xaml.js';
import { builtins } from '../dist/core/registry.js';

test('observable state batches nested mutations, array changes and deletion', async () => {
  const state = observable({ person: { name: 'Ada' }, items: [] }),
    changes = [];
  const stop = state.subscribe((change) => changes.push(change));
  state.batch((data) => {
    data.person.name = 'Grace';
    data.items.push({ title: 'First' });
  });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].revision, 1);
  assert.ok(changes[0].paths.includes(''), 'nested paths include conservative root invalidation');
  state.data.items[0].title = 'Changed';
  delete state.data.person.name;
  await Promise.resolve();
  assert.equal(changes.length, 2);
  assert.deepEqual(state.snapshot(), { person: {}, items: [{ title: 'Changed' }] });
  stop();
  state.set('person.name', 'Unsubscribed');
  state.flush();
  assert.equal(changes.length, 2);
});

test('observable state rejects prototype paths and supports safe numeric paths', () => {
  const state = new ObservableState({});
  state.set('rows[0].value', 8);
  assert.equal(state.get('rows.0.value'), 8);
  for (const path of ['__proto__.polluted', 'rows.constructor.name', 'rows.prototype'])
    assert.throws(() => state.set(path, true), /safe/);
  assert.throws(() => {
    state.data.__proto__ = {};
  }, /Unsafe/);
  assert.throws(() => Object.setPrototypeOf(state.data, {}), /prototypes/);
  assert.throws(() => state.set('rows.0.value.other', true), /scalar/);
  assert.equal({}.polluted, undefined);
});

test('observable aliases and moved array entries invalidate root subscribers', () => {
  const item = { name: 'A' },
    state = observable({ rows: [item], alias: item }),
    changes = [];
  state.subscribe((change) => changes.push(change));
  const retained = state.data.rows[0];
  state.data.rows.unshift({ name: 'B' });
  state.flush();
  retained.name = 'C';
  state.flush();
  assert.equal(state.data.rows[1].name, 'C');
  assert.equal(state.data.alias.name, 'C');
  assert.ok(changes.at(-1).paths.includes(''));
});

test('typed properties validate numeric boolean enum and custom coercion', () => {
  assert.equal(coerceProperty('12', { type: 'number' }), 12);
  assert.equal(coerceProperty('False', { type: 'boolean' }), false);
  assert.equal(coerceProperty('Auto', { type: 'number', allowAuto: true }), 'Auto');
  assert.throws(() => coerceProperty(Infinity, { type: 'number' }), /finite/);
  assert.throws(() => coerceProperty('yes', { type: 'boolean' }), /True or False/);
  assert.throws(() => coerceProperty(2, { type: 'number', maximum: 1 }), /range/);
  assert.throws(() => coerceProperty('Top', { values: ['Left', 'Right'] }), /one of/);
  assert.equal(coerceProperty(' pad ', { coerce: (value) => value.trim() }), 'pad');
});

test('property precedence clears animation and local overrides back to style', () => {
  const registry = new RuntimePropertyRegistry(),
    properties = new RuntimePropertyStore(registry);
  properties.set('button', 'Button', 'Opacity', '.4', 'style');
  properties.set('button', 'Button', 'Opacity', '.7', 'local');
  properties.set('button', 'Button', 'Opacity', '.2', 'animation');
  assert.equal(properties.get('button', 'Button', 'Opacity'), 0.2);
  properties.clear('button', 'Opacity', 'animation');
  assert.equal(properties.get('button', 'Button', 'Opacity'), 0.7);
  properties.clear('button', 'Opacity');
  assert.equal(properties.get('button', 'Button', 'Opacity'), 0.4);
  assert.equal(properties.get('other', 'Button', 'IsEnabled'), true);
  assert.equal(properties.get('other', 'TextBlock', 'Foreground', 'red'), 'red');
});

test('custom property registrations restore previous metadata', () => {
  const registry = new RuntimePropertyRegistry();
  const stop = registry.register('TextBox', 'Text', {
    type: 'string',
    defaultBindingMode: 'OneWay',
  });
  assert.equal(registry.get('TextBox', 'Text').defaultBindingMode, 'OneWay');
  stop();
  assert.equal(registry.get('TextBox', 'Text').defaultBindingMode, 'TwoWay');
});

const source =
  '<StackPanel xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><TextBox x:Name="Name" Text="{Binding name}"/><TextBlock x:Name="Greeting" Text="{Binding name}"/></StackPanel>';
test('application creation and source validation need no DOM; invalid source retains AST', () => {
  const app = createApplication({ source, data: { name: 'Ada' } }),
    previous = app.document;
  assert.equal(app.data.name, 'Ada');
  assert.equal(app.findNode('Name').type, 'TextBox');
  const invalid = app.updateSource('<StackPanel>');
  assert.equal(invalid.valid, false);
  assert.equal(app.document, previous);
  assert.equal(app.source, source);
  assert.match(RUNTIME_STYLES, /xamora-application/);
  assert.throws(() => app.mount(null), /DOM/);
  app.dispose();
  app.dispose();
  assert.throws(() => app.setData('name', 'Later'), /disposed/);
});

test('registered converters resolve safely without evaluating XAML code', () => {
  const app = createApplication({
    source,
    data: { name: 'Ada' },
    converters: { Upper: (value) => value.toUpperCase() },
  });
  const node = app.findNode('Name');
  assert.equal(
    app.resolveBinding('{Binding name, Converter={StaticResource Upper}}', node, app.data),
    'ADA',
  );
  assert.equal(
    app.resolveBinding('{Binding missing, FallbackValue=Fallback}', node, app.data),
    'Fallback',
  );
  assert.equal(app.resolveBinding('{Binding __proto__.constructor}', node, app.data), '');
  assert.ok(app.diagnostics.some((value) => value.code === 'binding-evaluation'));
  app.dispose();
});

test('TwoWay binding writeback validates modes and reversible converters', () => {
  const app = createApplication({
      source,
      data: { name: 'Ada' },
      converters: { Upper: (value) => value.toUpperCase() },
    }),
    node = app.findNode('Name');
  assert.equal(
    app.acceptInput({
      node,
      property: 'Text',
      expression: '{Binding name}',
      value: 'Grace',
      context: app.data,
    }),
    true,
  );
  assert.equal(app.data.name, 'Grace');
  assert.equal(
    app.acceptInput({
      node,
      property: 'Text',
      expression: '{Binding name, Mode=OneWay}',
      value: 'Blocked',
      context: app.data,
    }),
    false,
  );
  assert.equal(
    app.acceptInput({
      node,
      property: 'Text',
      expression: '{Binding name, Converter={StaticResource Upper}}',
      value: 'BLOCKED',
      context: app.data,
    }),
    false,
  );
  assert.equal(app.data.name, 'Grace');
  assert.equal(
    app.acceptInput({
      node,
      property: 'Text',
      expression: '{Binding name, UpdateSourceTrigger=Explicit}',
      value: 'Commit',
      context: app.data,
    }),
    true,
  );
  assert.equal(app.data.name, 'Grace');
  assert.equal(app.updateSourceBinding('Name', 'Text'), true);
  assert.equal(app.data.name, 'Commit');
  app.dispose();
});

test('plugins and command registrations dispose without implicit code execution', () => {
  let disposed = 0;
  const app = createApplication({
    source,
    plugins: [
      {
        setup(application) {
          application.registerCommand('Save', () => {});
          return () => disposed++;
        },
      },
    ],
  });
  assert.equal(typeof app.commands.get('Save'), 'function');
  assert.throws(() => app.registerCommand('Bad', {}), /execute/);
  assert.throws(() => app.registerEvent('Bad', 'alert(1)'), /function/);
  app.dispose();
  app.dispose();
  assert.equal(disposed, 1);
});

test('resource and theme changes validate resource dictionaries', () => {
  const app = createApplication({ source, resources: { Accent: 'red' } });
  app.setResource('Accent', 'blue');
  app.setTheme(
    '<ResourceDictionary xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><SolidColorBrush x:Key="ThemeAccent" Color="green"/></ResourceDictionary>',
  );
  assert.equal(app.runtimeDocument().root.children[0].type, 'StackPanel.Resources');
  assert.throws(() => app.setTheme('<Button/>'), /ResourceDictionary/);
  assert.throws(() => app.setResource('Unsafe', { callback: () => {} }), /primitive/);
  app.dispose();
});

test('concurrent markup loads keep the latest response and ignore disposed requests', async () => {
  const requests = new Map(),
    app = createApplication({
      source,
      fetch: (url) => new Promise((resolve) => requests.set(url, resolve)),
    });
  const older = app.load('old.xaml'),
    newer = app.load('new.xaml');
  requests.get('new.xaml')({ ok: true, text: async () => '<TextBlock Text="New"/>' });
  await newer;
  requests.get('old.xaml')({ ok: true, text: async () => '<TextBlock Text="Old"/>' });
  await older;
  assert.equal(app.document.root.props.Text, 'New');
  const late = app.load('late.xaml');
  app.dispose();
  requests.get('late.xaml')({ ok: true, text: async () => '<Button/>' });
  await assert.rejects(late, /disposed/);
});

test('GridLength validation accepts stars only on row and column definitions', () => {
  const valid = parseXaml(
    '<Grid><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="2.5*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions><Grid.RowDefinitions><RowDefinition Height="3*"/></Grid.RowDefinitions></Grid>',
  );
  assert.equal(
    diagnostics(valid, builtins()).filter((value) => value.severity === 'error').length,
    0,
  );
  for (const invalid of [
    '<Button Width="*"/>',
    '<Grid><Grid.ColumnDefinitions><ColumnDefinition Width="-2*"/></Grid.ColumnDefinitions></Grid>',
    '<Grid><Grid.RowDefinitions><RowDefinition Width="*"/></Grid.RowDefinitions></Grid>',
  ])
    assert.ok(
      diagnostics(parseXaml(invalid), builtins()).some((value) => value.severity === 'error'),
    );
});

test('dictionary reloads keep latest request and old disposer cannot remove replacement', async () => {
  const requests = [],
    app = createApplication({
      source,
      fetch: () => new Promise((resolve) => requests.push(resolve)),
    });
  const first = app.loadDictionary('theme.xaml'),
    second = app.loadDictionary('theme.xaml');
  requests[1]({
    ok: true,
    text: async () => '<ResourceDictionary><Color>blue</Color></ResourceDictionary>',
  });
  await second;
  requests[0]({
    ok: true,
    text: async () => '<ResourceDictionary><Color>red</Color></ResourceDictionary>',
  });
  await first;
  assert.equal(app.dictionaries.get('theme.xaml').children[0].children[0].text, 'blue');
  const stop = app.registerDictionary(
    'theme.xaml',
    '<ResourceDictionary><Color>old</Color></ResourceDictionary>',
  );
  app.registerDictionary(
    'theme.xaml',
    '<ResourceDictionary><Color>new</Color></ResourceDictionary>',
  );
  stop();
  assert.equal(app.dictionaries.get('theme.xaml').children[0].children[0].text, 'new');
  app.dispose();
});
