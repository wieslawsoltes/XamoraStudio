import test from 'node:test';
import assert from 'node:assert/strict';
import { installDOM, FakeElement } from './dom-fixture.mjs';
import { parseXaml, serializeXaml } from '../dist/core/xaml.js';
import { builtins } from '../dist/core/registry.js';
import { PreviewRenderer } from '../dist/core/render.js';
import { MotionRuntime } from '../dist/studio/motion-runtime.js';
import { listStoryboards } from '../dist/core/animation.js';
import { find, walk } from '../dist/core/model.js';
import { readFile } from 'node:fs/promises';
installDOM();
const x = 'xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"';
function runtime(source) {
  const doc = parseXaml(source),
    renderer = new PreviewRenderer(builtins()),
    host = new FakeElement();
  renderer.render(doc, host, { interactive: true });
  let now = 0,
    id = 0;
  const queue = new Map(),
    motion = new MotionRuntime(doc, {
      now: () => now,
      schedule: (callback) => {
        queue.set(++id, callback);
        return id;
      },
      cancel: (key) => queue.delete(key),
    });
  motion.bind(renderer);
  return {
    doc,
    renderer,
    host,
    motion,
    queue,
    at(seconds) {
      now = seconds * 1000;
      for (const [key, callback] of [...queue]) {
        queue.delete(key);
        callback();
      }
      motion.tick();
    },
  };
}
const named = (doc, name) => {
  let out;
  walk(doc.root, (n) => {
    if (n.props?.['x:Name'] === name) out = n;
  });
  return out;
};
test('interactive To-only animation samples style baseline and stops at completion', () => {
  const r = runtime(
      `<Grid ${x}><Grid.Resources><Style TargetType="Border"><Setter Property="Opacity" Value="0.2"/></Style><Storyboard x:Key="A"><DoubleAnimation Storyboard.TargetName="Card" Storyboard.TargetProperty="Opacity" To="1" Duration="0:00:02"/></Storyboard></Grid.Resources><Border x:Name="Card"/></Grid>`,
    ),
    n = named(r.doc, 'Card');
  r.motion.start(listStoryboards(r.doc)[0].id);
  r.at(1);
  assert.equal(r.renderer.elements.get(n.id).style.opacity, '0.6');
  r.at(3);
  assert.equal(r.motion.needsFrame(), false);
  r.at(4);
  assert.equal(r.queue.size, 0);
  r.motion.dispose();
});
test('native Loaded fires once on repeated preview bind and source remains untouched', () => {
  const r = runtime(
      `<Grid ${x}><Grid.Resources><Storyboard x:Key="Fade"><DoubleAnimation Storyboard.TargetName="Card" Storyboard.TargetProperty="Opacity" To="0" Duration="0:00:02"/></Storyboard></Grid.Resources><Grid.Triggers><EventTrigger RoutedEvent="Loaded"><BeginStoryboard x:Name="BeginFade" Storyboard="{StaticResource Fade}"/></EventTrigger></Grid.Triggers><Border x:Name="Card"/></Grid>`,
    ),
    before = serializeXaml(r.doc);
  assert.equal(r.motion.clocks.size, 1);
  r.at(1);
  const start = r.motion.clocks.get('BeginFade').start;
  r.renderer.render(r.doc, r.host, { interactive: true });
  r.motion.bind(r.renderer);
  assert.equal(r.motion.clocks.get('BeginFade').start, start);
  assert.equal(serializeXaml(r.doc), before);
  r.motion.dispose();
});
test('ancestor SourceName routed event starts sibling-target storyboard', () => {
  const r = runtime(
    `<Grid ${x}><Grid.Resources><Storyboard x:Key="A"><DoubleAnimation Storyboard.TargetName="Card" Storyboard.TargetProperty="Opacity" To="0" Duration="0:00:02"/></Storyboard></Grid.Resources><Grid.Triggers><EventTrigger RoutedEvent="Button.Click" SourceName="Replay"><BeginStoryboard Storyboard="{StaticResource A}"/></EventTrigger></Grid.Triggers><Button x:Name="Replay"/><Border x:Name="Card"/></Grid>`,
  );
  r.motion.event(named(r.doc, 'Replay').id, 'Click');
  assert.equal(r.motion.clocks.size, 1);
  r.at(1);
  assert.equal(r.renderer.elements.get(named(r.doc, 'Card').id).style.opacity, '0.5');
  r.motion.dispose();
});
test('two control template instances have isolated visual-state playback', () => {
  const r = runtime(
      `<Grid ${x}><Grid.Resources><ControlTemplate x:Key="T"><Border x:Name="Surface" Opacity="1"><VisualStateManager.VisualStateGroups><VisualStateGroup x:Name="CommonStates"><VisualState x:Name="Normal"/><VisualState x:Name="MouseOver"><Storyboard><DoubleAnimation Storyboard.TargetName="Surface" Storyboard.TargetProperty="Opacity" To="0.3" Duration="0:00:00"/></Storyboard></VisualState></VisualStateGroup></VisualStateManager.VisualStateGroups></Border></ControlTemplate></Grid.Resources><Button x:Name="One" Template="{StaticResource T}"/><Button x:Name="Two" Template="{StaticResource T}"/></Grid>`,
    ),
    one = named(r.doc, 'One'),
    two = named(r.doc, 'Two'),
    first = [...r.renderer.templateOwners].find(
      ([id, owner]) => owner === one.id && r.renderer.elements.has(id),
    )?.[0],
    second = [...r.renderer.templateOwners].find(
      ([id, owner]) => owner === two.id && r.renderer.elements.has(id),
    )?.[0];
  assert.ok(first && second && first !== second);
  r.motion.event(one.id, 'PointerEnter');
  r.at(0.1);
  assert.equal(r.renderer.elements.get(first).style.opacity, '0.3');
  assert.notEqual(r.renderer.elements.get(second).style.opacity, '0.3');
  r.motion.event(one.id, 'PointerLeave');
  r.at(0.2);
  assert.equal(r.renderer.elements.get(first).style.opacity, '1');
  assert.equal(r.motion.needsFrame(), false);
  r.motion.dispose();
});
test('style-trigger owner values propagate through TemplateBinding', () => {
  const r = runtime(
      `<Grid ${x}><Grid.Resources><Style TargetType="Button"><Setter Property="Background" Value="Red"/><Setter Property="Template"><Setter.Value><ControlTemplate><Border Background="{TemplateBinding Background}"/></ControlTemplate></Setter.Value></Setter><Style.Triggers><Trigger Property="IsMouseOver" Value="True"><Setter Property="Background" Value="Blue"/></Trigger></Style.Triggers></Style></Grid.Resources><Button x:Name="Owner"/></Grid>`,
    ),
    owner = named(r.doc, 'Owner'),
    child = [...r.renderer.templateOwners].find(
      ([id, source]) => source === owner.id && r.renderer.elements.has(id),
    )?.[0];
  r.motion.event(owner.id, 'PointerEnter');
  assert.equal(r.renderer.elements.get(child).style.background, 'Blue');
  r.motion.dispose();
});
test('preview disposal cancels scheduled work and restores opacity', () => {
  const r = runtime(
    `<Grid ${x}><Grid.Resources><Storyboard x:Key="A"><DoubleAnimation Storyboard.TargetName="Card" Storyboard.TargetProperty="Opacity" To="0" Duration="0:00:10"/></Storyboard></Grid.Resources><Border x:Name="Card" Opacity="1"/></Grid>`,
  );
  r.motion.start(listStoryboards(r.doc)[0].id);
  r.at(2);
  r.motion.dispose();
  assert.equal(r.queue.size, 0);
  assert.equal(r.motion.disposed, true);
});
test('motion lab parses, roundtrips and renders with executable storyboards', async () => {
  const text = await readFile(new URL('../dist/examples/MotionLab.xaml', import.meta.url), 'utf8'),
    r = runtime(text);
  assert.equal(listStoryboards(r.doc).length, 2);
  assert.equal(r.motion.clocks.size, 1);
  r.at(1);
  assert.ok(r.renderer.elements.size > 10);
  assert.equal(serializeXaml(parseXaml(serializeXaml(r.doc))), serializeXaml(r.doc));
  r.motion.dispose();
});
test('animation ticks preserve uncommitted input even when that input animates another property', () => {
  const r = runtime(
      `<Grid ${x}><Grid.Resources><Storyboard x:Key="A"><DoubleAnimation Storyboard.TargetName="Input" Storyboard.TargetProperty="Opacity" To="0.5" Duration="0:00:02"/></Storyboard></Grid.Resources><TextBox x:Name="Input" Text="Original"/></Grid>`,
    ),
    input = named(r.doc, 'Input'),
    el = r.renderer.elements.get(input.id);
  el.value = 'Typed but not committed';
  r.motion.start(listStoryboards(r.doc)[0].id);
  r.at(1);
  assert.equal(el.value, 'Typed but not committed');
  assert.equal(el.style.opacity, '0.75');
  r.motion.event(input.id, 'GotFocus');
  assert.equal(el.value, 'Typed but not committed');
  r.motion.dispose();
  assert.equal(el.value, 'Original');
});
test('seek and repeated pause use the controllable BeginStoryboard clock', () => {
  const r = runtime(
      `<Grid ${x}><Grid.Resources><Storyboard x:Key="A"><DoubleAnimation Storyboard.TargetName="Card" Storyboard.TargetProperty="Opacity" From="0" To="1" Duration="0:00:10"/></Storyboard></Grid.Resources><Grid.Triggers><EventTrigger RoutedEvent="Loaded"><BeginStoryboard x:Name="Clock" Storyboard="{StaticResource A}"/></EventTrigger></Grid.Triggers><Border x:Name="Card"/></Grid>`,
    ),
    id = named(r.doc, 'Card').id,
    actions = (type, props = {}) => ({
      children: [
        { kind: 'element', type, props: { BeginStoryboardName: 'Clock', ...props }, children: [] },
      ],
    });
  r.at(2);
  r.motion.runActions(actions('PauseStoryboard'), id);
  r.at(3);
  r.motion.runActions(actions('PauseStoryboard'), id);
  r.at(4);
  assert.equal(r.renderer.elements.get(id).style.opacity, '0.2');
  r.motion.runActions(actions('SeekStoryboard', { Origin: 'Duration', Offset: '-0:00:03' }), id);
  r.motion.tick();
  assert.equal(r.renderer.elements.get(id).style.opacity, '0.7');
  r.motion.runActions(actions('ResumeStoryboard'), id);
  r.at(5);
  assert.equal(r.renderer.elements.get(id).style.opacity, '0.8');
  r.motion.dispose();
});
