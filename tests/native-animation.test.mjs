import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXaml, serializeXaml } from '../dist/core/xaml.js';
import { element, find, walk, DocumentStore } from '../dist/core/model.js';
import {
  formatTime,
  parseTime,
  keyframes,
  simpleDuration,
  clockTime,
  sampleTrack,
  listStoryboards,
  sampleStoryboard,
  createStoryboard,
  addTrack,
  setKeyframe,
  AnimationPlayer,
  interpolate,
  splineProgress,
  ease,
} from '../dist/core/animation.js';
import {
  TRANSFORM_PATHS,
  ensureTransformPath,
  readPropertyPath,
  writePropertyPath,
} from '../dist/core/property-path.js';
import {
  VisualStateRuntime,
  createStateGroup,
  createState,
  stateStoryboard,
} from '../dist/core/states.js';
import { PrototypeSession } from '../dist/core/prototype.js';
import { createDatabase } from '../dist/core/design-data.js';
import { completeXaml } from '../dist/core/xaml-language.js';
import { builtins } from '../dist/core/registry.js';
const x = 'xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"';
const doc = (s) => parseXaml(s);
function fixture(extra = '', track = 'To="0" Duration="0:00:02"') {
  return doc(
    `<Grid ${x}><Grid.Resources><Storyboard x:Key="Fade" ${extra}><DoubleAnimation Storyboard.TargetName="Card" Storyboard.TargetProperty="Opacity" ${track}/></Storyboard></Grid.Resources><Border x:Name="Card" Opacity="1"/></Grid>`,
  );
}
const story = (d) => listStoryboards(d)[0].node;
const named = (d, name) => {
  let n;
  walk(d.root, (c) => {
    if (c.props?.['x:Name'] === name) n = c;
  });
  return n;
};
const sample = (d, t) =>
  sampleStoryboard(d, story(d), t).overrides.get(named(d, 'Card').id)?.Opacity;

test('time formatter carries fractional seconds into minutes', () => {
  assert.equal(formatTime(59.9998), '0:01:00');
  assert.equal(formatTime(3599.9998), '1:00:00');
  assert.equal(parseTime('1.02:03:04.5'), 93784.5);
});
test('Fill Stop releases animation without changing authored values', () => {
  const d = fixture('FillBehavior="Stop"'),
    before = serializeXaml(d);
  assert.equal(Number(sample(d, 1)), 0.5);
  assert.equal(sample(d, 2), undefined);
  assert.equal(serializeXaml(d), before);
});
test('comments and explicit Storyboard.Children preserve tracks', () => {
  const d = doc(
    `<Grid ${x}><!--c--><Grid.Resources><Storyboard x:Key="A"><Storyboard.Children><!--c--><DoubleAnimation Storyboard.TargetName="Card" Storyboard.TargetProperty="Opacity" To="0" Duration="0:00:02"/></Storyboard.Children></Storyboard></Grid.Resources><Border x:Name="Card"/></Grid>`,
  );
  assert.equal(simpleDuration(story(d)), 2);
  assert.equal(Number(sample(d, 1)), 0.5);
});
test('nested delay and speed ratio compose local time', () => {
  const d = doc(
    `<Grid ${x}><Grid.Resources><Storyboard x:Key="A"><ParallelTimeline BeginTime="0:00:01" SpeedRatio="2"><DoubleAnimation Storyboard.TargetName="Card" Storyboard.TargetProperty="Opacity" From="0" To="1" Duration="0:00:02"/></ParallelTimeline></Storyboard></Grid.Resources><Border x:Name="Card"/></Grid>`,
  );
  assert.equal(sample(d, 0.5), undefined);
  assert.equal(Number(sample(d, 1.5)), 0.5);
});
test('autoreverse and fractional repetition retain final clock position', () => {
  const n = element('DoubleAnimation', {
    Duration: '0:00:02',
    AutoReverse: 'True',
    RepeatBehavior: '1.5x',
  });
  assert.equal(clockTime(n, 3), 1);
  assert.equal(clockTime(n, 7), 2);
  n.props.BeginTime = '{x:Null}';
  assert.equal(clockTime(n, 20), null);
});
test('zero-repeat and zero-duration semantics differ', () => {
  assert.equal(
    clockTime(element('DoubleAnimation', { Duration: '0:00:01', RepeatBehavior: '0x' }), 0),
    null,
  );
  const n = element('DoubleAnimation', { Duration: '0:00:00', To: '.4' });
  assert.equal(Number(sampleTrack(n, clockTime(n, 0), '1')), 0.4);
});
test('automatic duration uses absolute key times rather than percentage fallback', () => {
  const n = element('DoubleAnimationUsingKeyFrames', {}, [
    element('LinearDoubleKeyFrame', { KeyTime: '0:00:00.4', Value: '2' }),
    element('LinearDoubleKeyFrame', { KeyTime: '100%', Value: '3' }),
  ]);
  assert.equal(simpleDuration(n), 0.4);
  assert.deepEqual(
    keyframes(n, 0.4).map((k) => k.time),
    [0.4, 0.4],
  );
});
test('Paced scheduling uses distance rather than uniform slots', () => {
  const n = element(
      'DoubleAnimationUsingKeyFrames',
      {},
      [0, 100, 101].map((v) =>
        element('LinearDoubleKeyFrame', { KeyTime: 'Paced', Value: String(v) }),
      ),
    ),
    keys = keyframes(n, 3);
  assert.equal(keys[0].time, 0);
  assert.ok(Math.abs(keys[1].time - 300 / 101) < 1e-7);
  assert.equal(keys[2].time, 3);
});
test('prefixed discrete and typed object keys sample correctly', () => {
  const n = doc(
    '<DoubleAnimationUsingKeyFrames xmlns:a="urn:a" Duration="0:00:02"><a:DiscreteDoubleKeyFrame KeyTime="0:00:02" Value="9"/></DoubleAnimationUsingKeyFrames>',
  ).root;
  assert.equal(Number(sampleTrack(n, 1, '3')), 3);
  assert.equal(Number(sampleTrack(n, 2, '3')), 9);
  const obj = doc(
    '<ObjectAnimationUsingKeyFrames><DiscreteObjectKeyFrame KeyTime="0"><DiscreteObjectKeyFrame.Value><Visibility>Collapsed</Visibility></DiscreteObjectKeyFrame.Value></DiscreteObjectKeyFrame></ObjectAnimationUsingKeyFrames>',
  );
  assert.equal(keyframes(obj.root, 1)[0].value, 'Collapsed');
});
test('From plus By, thickness, color and spline interpolation', () => {
  assert.equal(
    Number(
      sampleTrack(element('DoubleAnimation', { From: '2', By: '4', Duration: '0:00:02' }), 1, '0'),
    ),
    4,
  );
  assert.equal(interpolate('1,2', '3,6', 0.5, 'Thickness'), '2,4,2,4');
  assert.equal(interpolate('#00FF0000', '#FFFF0000', 0.5, 'Color').toUpperCase(), '#80FF0000');
  assert.ok(Math.abs(splineProgress(0.5, '0,0,1,1') - 0.5) < 1e-6);
});
test('transform path adapts to preexisting transforms and localizes resource', () => {
  const d = doc(
      `<Grid ${x}><Grid.Resources><TransformGroup x:Key="Motion"><TransformGroup.Children><TranslateTransform X="10"/></TransformGroup.Children></TransformGroup></Grid.Resources><Border RenderTransform="{StaticResource Motion}"/></Grid>`,
    ),
    n = d.root.children[1],
    path = ensureTransformPath(d, n, TRANSFORM_PATHS.X);
  assert.equal(Number(readPropertyPath(d, n, path)), 10);
  assert.equal(n.props.RenderTransform, undefined);
  writePropertyPath(d, n, path, 20);
  assert.equal(Number(readPropertyPath(d, n, path)), 20);
  const ids = [];
  walk(d.root, (n) => ids.push(n.id));
  assert.equal(new Set(ids).size, ids.length);
});
test('ordinary animation conversion removes invalid old easing owner', () => {
  const n = doc(
    '<DoubleAnimation From="0" To="1" Duration="0:00:01"><DoubleAnimation.EasingFunction><CubicEase/></DoubleAnimation.EasingFunction></DoubleAnimation>',
  ).root;
  setKeyframe(n, 0.5, '.2');
  assert.equal(n.type, 'DoubleAnimationUsingKeyFrames');
  assert.equal(
    n.children.some((c) => c.type === 'DoubleAnimation.EasingFunction'),
    false,
  );
  assert.equal(keyframes(n, 1).length, 3);
});
test('animation authoring is undoable and uses requested type', () => {
  const store = new DocumentStore(doc('<Grid><Border/></Grid>'));
  store.transaction('Animate', (d) => {
    const target = d.root.children[0],
      s = createStoryboard(d, 'Fade', 2),
      t = addTrack(d, s, target.id, 'Opacity', 'Double');
    setKeyframe(t, 0, 1);
    setKeyframe(t, 2, 0);
    assert.equal(t.type, 'DoubleAnimationUsingKeyFrames');
  });
  assert.equal(listStoryboards(store.document).length, 1);
  store.undo();
  assert.equal(listStoryboards(store.document).length, 0);
  store.redo();
  assert.equal(listStoryboards(store.document).length, 1);
});
function stateFixture() {
  const d = doc('<Grid><Border Opacity="1" Width="100"/></Grid>'),
    n = d.root.children[0],
    g = createStateGroup(d, n.id, 'CommonStates');
  createState(g, 'Normal');
  const hover = createState(g, 'MouseOver'),
    t = addTrack(d, stateStoryboard(hover), n.id, 'Opacity');
  t.props.Duration = '0:00:00';
  setKeyframe(t, 0, '.4');
  g.children.push(
    element('VisualStateGroup.Transitions', {}, [
      element('VisualTransition', { GeneratedDuration: '0:00:01' }),
    ]),
  );
  return { d, n, g };
}
test('state transitions blend from base and empty state releases animated property', () => {
  const { d, n, g } = stateFixture(),
    r = new VisualStateRuntime(d);
  r.go(g.id, 'MouseOver', 0);
  assert.equal(Number(r.sample(0.5).get(n.id).Opacity), 0.7);
  r.go(g.id, 'Normal', 1);
  assert.equal(Number(r.sample(1.5).get(n.id).Opacity), 0.7);
  assert.equal(r.sample(2).has(n.id), false);
});
test('different state groups never blend unrelated properties to base', () => {
  const { d, n, g } = stateFixture(),
    other = createStateGroup(d, n.id, 'Size'),
    wide = createState(other, 'Wide'),
    t = addTrack(d, stateStoryboard(wide), n.id, 'Width');
  t.props.Duration = '0:00:00';
  setKeyframe(t, 0, 50);
  other.children.push(
    element('VisualStateGroup.Transitions', {}, [
      element('VisualTransition', { GeneratedDuration: '0:00:01' }),
    ]),
  );
  const r = new VisualStateRuntime(d);
  r.go(g.id, 'MouseOver', 0, false);
  r.go(other.id, 'Wide', 0);
  assert.equal(Number(r.sample(0.5).get(n.id).Opacity), 0.4);
  assert.equal(Number(r.sample(0.5).get(n.id).Width), 75);
});
test('sampling empty imported states does not create authored Storyboards', () => {
  const d = doc(
      `<Grid ${x}><VisualStateManager.VisualStateGroups><VisualStateGroup x:Name="G"><VisualState x:Name="Normal"/></VisualStateGroup></VisualStateManager.VisualStateGroups></Grid>`,
    ),
    before = serializeXaml(d),
    r = new VisualStateRuntime(d);
  r.go('G', 'Normal');
  r.sample(1);
  assert.equal(serializeXaml(d), before);
});
test('explicit transition runs with no GeneratedDuration', () => {
  const { d, n, g } = stateFixture();
  g.children.find((c) => c.type.endsWith('.Transitions')).children = [
    element('VisualTransition', {}, [
      element('Storyboard', {}, [
        element('DoubleAnimation', {
          'Storyboard.TargetName': n.props['x:Name'],
          'Storyboard.TargetProperty': 'Opacity',
          From: '1',
          To: '0',
          Duration: '0:00:02',
        }),
      ]),
    ]),
  ];
  const r = new VisualStateRuntime(d);
  r.go(g.id, 'MouseOver', 0);
  assert.equal(Number(r.sample(1).get(n.id).Opacity), 0.5);
  assert.equal(Number(r.sample(2).get(n.id).Opacity), 0.4);
});
test('motion command queues roll back atomically with a failing later action', () => {
  const d = fixture(),
    n = named(d, 'Card');
  d.metadata.interactions = [
    {
      sourceId: n.id,
      event: 'Click',
      actions: [
        { type: 'startStoryboard', storyboardId: story(d).id },
        { type: 'navigate', targetViewId: 'missing' },
      ],
    },
  ];
  const session = new PrototypeSession([d], createDatabase());
  assert.throws(() => session.dispatch(d.id, n.id, 'Click'));
  assert.equal(session.motionCommands.length, 0);
  assert.equal(session.motionSerial, 0);
});
test('XAML completion includes motion elements and named targets', () => {
  const d = fixture(),
    registry = builtins(),
    source = '<DoubleAnimation Storyboard.TargetName="C';
  assert.ok(
    completeXaml('<Dou', 4, { registry, document: d }).some((c) => c.label === 'DoubleAnimation'),
  );
  assert.ok(
    completeXaml(source, source.length, { registry, document: d }).some((c) => c.label === 'Card'),
  );
});
