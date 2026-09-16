import test from 'node:test';
import assert from 'node:assert/strict';
import { installDOM, FakeElement } from './dom-fixture.mjs';
import { PreviewRenderer } from '../dist/core/render.js';
import { builtins } from '../dist/core/registry.js';
import { parseXaml } from '../dist/core/xaml.js';
import { element, createDocument } from '../dist/core/model.js';
import { PrototypeSession } from '../dist/core/prototype.js';
import { createDatabase } from '../dist/core/design-data.js';
installDOM();
function draw(xml, data, interactive = false) {
  const doc = parseXaml(xml),
    renderer = new PreviewRenderer(builtins()),
    host = new FakeElement();
  renderer.sampleData = data;
  renderer.render(doc, host, { interactive });
  return { renderer, host, doc };
}
test('ItemsSource repeats a template and applies nested DataContext', () => {
  const { host, renderer } = draw(
    '<ItemsControl ItemsSource="{Binding Rows}"><ItemsControl.ItemTemplate><DataTemplate><StackPanel><TextBlock Text="{Binding Name}"/><Border DataContext="{Binding Child}"><TextBlock Text="{Binding Name}"/></Border></StackPanel></DataTemplate></ItemsControl.ItemTemplate></ItemsControl>',
    {
      Rows: [
        { _id: 'one', Name: 'Parent', Child: { Name: 'Nested' } },
        { _id: 'two', Name: 'Second', Child: { Name: 'Child2' } },
      ],
    },
  );
  assert.equal(host.textContent, 'ParentNestedSecondChild2');
  assert.equal(renderer.instances.size, 2);
});
test('nested template instances retain authored event identities', () => {
  const text = element('TextBlock', { Text: '{Binding Name}' }),
    source = element('StackPanel', {}, [text]),
    owner = element('ItemsControl'),
    doc = createDocument(owner),
    r = new PreviewRenderer(builtins());
  r.render(doc, new FakeElement());
  const outer = r.instantiate(source, { _id: 'outer' }, 0, owner),
    inner = r.instantiate(outer, { _id: 'inner' }, 0, outer);
  assert.equal(inner.children[0].sourceId, text.id);
  assert.notEqual(inner.children[0].id, outer.children[0].id);
});
test('collection renderers tolerate nullable design objects', () => {
  for (const type of ['ItemsControl', 'ComboBox', 'DataGrid'])
    assert.doesNotThrow(() => draw(`<${type} ItemsSource="{Binding Rows}"/>`, { Rows: [null] }));
});
test('bound ComboBox selected value and date input are initialized from state', () => {
  const { host } = draw(
    '<StackPanel><ComboBox ItemsSource="{Binding Rows}" SelectedValue="{Binding Pick}"/><DatePicker SelectedDate="{Binding Due}"/></StackPanel>',
    {
      Rows: [
        { _id: 'a', Name: 'A' },
        { _id: 'b', Name: 'B' },
      ],
      Pick: 'b',
      Due: '2026-10-10',
    },
  );
  assert.equal(host.querySelectorAll('option')[1].selected, true);
  assert.equal(host.querySelectorAll('input')[0].value, '2026-10-10');
});
test('failed TwoWay input emits no Change connector', () => {
  const { renderer, host } = draw(
      '<TextBox Text="{Binding Name, Mode=TwoWay}"/>',
      { Name: 'Valid' },
      true,
    ),
    events = [];
  renderer.onInput = () => false;
  renderer.onEvent = (e) => events.push(e);
  const input = host.querySelector('input');
  input.value = 'Rejected';
  input.dispatchEvent({ type: 'change' });
  assert.equal(input.value, 'Valid');
  assert.equal(events.length, 0);
});
test('renderer captures stable provenance before a Click action replaces context', () => {
  const doc = parseXaml('<CheckBox IsChecked="{Binding App.IsOpen, Mode=TwoWay}"/>'),
    s = new PrototypeSession([doc], createDatabase()),
    r = new PreviewRenderer(builtins()),
    host = new FakeElement();
  r.sampleData = s.context;
  r.describeContext = (c) => s.describeContext(c);
  r.onInput = (change) => s.writeBinding(change);
  r.render(doc, host, { interactive: true });
  s.execute({ type: 'increment', path: 'App.Counter', value: 1 }, {}, doc.id);
  const input = host.querySelector('input');
  input.checked = true;
  input.dispatchEvent({ type: 'change' });
  assert.equal(s.context.App.Counter, 1);
  assert.equal(s.context.App.IsOpen, true);
});

test('rejected toggle write cancels its Click connector', () => {
  const { renderer, host } = draw(
      '<ToggleButton IsChecked="{Binding Flag, Mode=TwoWay}"/>',
      { Flag: false },
      true,
    ),
    events = [];
  renderer.onInput = () => false;
  renderer.onEvent = (e) => events.push(e);
  host.querySelector('button').dispatchEvent({ type: 'click' });
  assert.equal(events.length, 0);
});
test('clicking an item template emits its collection selection and row identity', () => {
  const { renderer, doc } = draw(
      '<ListBox ItemsSource="{Binding Rows}"><ListBox.ItemTemplate><DataTemplate><TextBlock Text="{Binding Name}"/></DataTemplate></ListBox.ItemTemplate></ListBox>',
      { Rows: [{ _id: 'projectA', Name: 'Alpha' }] },
      true,
    ),
    events = [];
  renderer.onEvent = (e) => events.push(e);
  [...renderer.instances.values()][0].dispatchEvent({ type: 'click' });
  assert.equal(events[0].nodeId, doc.root.id);
  assert.equal(events[0].event, 'SelectionChanged');
  assert.equal(events[0].rowId, 'projectA');
});
