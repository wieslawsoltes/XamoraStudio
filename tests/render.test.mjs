import test from 'node:test';
import assert from 'node:assert/strict';
import { installDOM, FakeElement } from './dom-fixture.mjs';
import {
  PreviewRenderer,
  gridDefinitions,
  thickness,
  color,
  exportHTML,
} from '../dist/core/render.js';
import { parseXaml } from '../dist/core/xaml.js';
import { builtins } from '../dist/core/registry.js';
installDOM();
function render(source) {
  const d = parseXaml(source),
    r = new PreviewRenderer(builtins()),
    host = new FakeElement();
  r.render(d, host, { interactive: true });
  return { d, r, host };
}
test('thickness follows WPF left/top/right/bottom order', () => {
  assert.deepEqual(thickness('1,2,3,4'), [2, 3, 4, 1]);
  assert.deepEqual(thickness('8,12'), [12, 8, 12, 8]);
});
test('ARGB becomes browser RGBA', () => assert.equal(color('#80FF0000'), '#FF000080'));
test('empty grid definitions use an implicit star track', () => {
  const d = parseXaml('<Grid><Grid.RowDefinitions/><Button/></Grid>');
  assert.deepEqual(gridDefinitions(d.root, 'Row'), ['*']);
  const { r } = render('<Grid><Grid.RowDefinitions/><Button/></Grid>');
  assert.ok([...r.elements.values()].some((n) => n.style.gridRow === '1 / span 1'));
});
test('mixed TextBlock inlines remain visible and ordered', () => {
  const { host } = render('<TextBlock>Hello <Run>world</Run>!</TextBlock>');
  assert.equal(host.textContent, 'Hello world!');
});
test('content-property syntax renders the same content', () => {
  const a = render(
    '<Button><Button.Content><TextBlock Text="Important label"/></Button.Content></Button>',
  );
  assert.equal(a.host.textContent, 'Important label');
});
test('resource lookup respects ancestor and sibling scopes', () => {
  const { d, r } = render(
    '<Grid><Grid.Resources><SolidColorBrush xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Key="Accent" Color="Red"/></Grid.Resources><Border Background="{StaticResource Accent}"/><StackPanel><StackPanel.Resources><SolidColorBrush xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Key="Accent" Color="Blue"/></StackPanel.Resources><Border Background="{StaticResource Accent}"/></StackPanel></Grid>',
  );
  assert.equal(r.elements.get(d.root.children[1].id).style.background, 'Red');
  assert.equal(r.elements.get(d.root.children[2].children[1].id).style.background, 'Blue');
});
test('disabled parent disables nested interactive inputs', () => {
  const { host } = render(
    '<StackPanel IsEnabled="False"><CheckBox/><ComboBox/><Slider/><DatePicker/></StackPanel>',
  );
  assert.ok(host.querySelectorAll('input,select').length >= 4);
  assert.ok(host.querySelectorAll('input,select').every((n) => n.disabled));
});
test('keyed style setters are applied before local values', () => {
  const { d, r } = render(
    '<Grid xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><Grid.Resources><Style x:Key="Accent"><Setter Property="Background" Value="Purple"/><Setter Property="Foreground" Value="White"/></Style></Grid.Resources><Button Style="{StaticResource Accent}" Background="Red"/></Grid>',
  );
  const b = r.elements.get(d.root.children[1].id);
  assert.equal(b.style.background, 'Red');
  assert.equal(b.style.color, 'White');
});
test('template in a style setter is previewed', () => {
  const { host } = render(
    '<Grid xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><Grid.Resources><Style x:Key="Test"><Setter Property="Template"><Setter.Value><ControlTemplate><Border><ContentPresenter Content="{TemplateBinding Content}"/></Border></ControlTemplate></Setter.Value></Setter></Style></Grid.Resources><Button Content="Templated" Style="{StaticResource Test}"/></Grid>',
  );
  assert.equal(host.textContent, 'Templated');
});
test('Canvas anchors and Grid spans produce explicit layout values', () => {
  const { d, r } = render(
    '<Canvas><Button Canvas.Left="24" Canvas.Top="40" Width="120"/></Canvas>',
  );
  const b = r.elements.get(d.root.children[0].id);
  assert.equal(b.style.position, 'absolute');
  assert.equal(b.style.left, '24px');
  assert.equal(b.style.top, '40px');
});
test('HTML export reflects textbox checkbox and selection initial state', () => {
  const d = parseXaml(
    '<StackPanel><TextBox Text="Saved text"/><CheckBox IsChecked="True"/><ComboBox SelectedIndex="1"><ComboBoxItem Content="A"/><ComboBoxItem Content="B"/></ComboBox></StackPanel>',
  );
  const out = exportHTML(d, builtins());
  assert.match(out, /value="Saved text"/);
  assert.match(out, /checked=""/);
  assert.match(out, /<option selected="">B/);
  assert.doesNotMatch(out, /data-node-id=/);
});
