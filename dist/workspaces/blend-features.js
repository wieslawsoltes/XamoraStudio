import {
  clone,
  find,
  parentOf,
  walk,
  label,
  localName,
  element,
  reidentify,
} from '../core/model.js';
import { isLocked } from '../core/design-tools.js';
import { AnimationEditor } from './animation-editor.js';
import { listStoryboards, addTrack, setKeyframe, formatTime } from '../core/animation.js';
import { stateGroups, createStateGroup, createState, stateStoryboard } from '../core/states.js';
import * as PropertyPaths from '../core/property-path.js';
import { brushNode, designProperties } from '../core/appearance.js';
import {
  parsePath,
  serializePath,
  pathPoints,
  movePathPoint,
  shapeToPath,
} from '../core/vector.js';
import { MotionRuntime } from './motion-runtime.js';
import {
  captureMotion,
  restoreMotion,
  patchMotion,
  motionDocument,
} from '../core/motion-render.js';
import { WorkspaceComponent, esc, field, select } from './workspace-context.js';

const propertyChild = (node, key) =>
  node.children.find((n) => localName(n.type || '').endsWith('.' + key));
const identifier = (value, what = 'name') => {
  if (!/^[A-Za-z_][\w]*$/.test(value))
    throw Error(`Use letters, digits, and underscores for the ${what}.`);
  return value;
};
const number = (value, title, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    throw Error(`${title} must be between ${min} and ${max}.`);
  return n;
};
const remove = (root, id) => {
  const parent = parentOf(root, id);
  if (parent) parent.children = parent.children.filter((n) => n.id !== id);
};
const replaceProperty = (node, name, value) => {
  node.children = node.children.filter((n) => !localName(n.type || '').endsWith('.' + name));
  delete node.props[name];
  if (value) node.children.push(element(node.type + '.' + name, {}, [value]));
};
const names = (items) =>
  items
    .map((value) => (typeof value === 'string' ? value : value.name || value.property))
    .filter(Boolean);
function ensureDesignNamespace(doc) {
  const root = doc.root,
    design = 'http://schemas.microsoft.com/expression/blend/2008',
    compat = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const claim = (preferred, uri) => {
    const found = Object.entries(root.props).find(
      ([key, value]) => key.startsWith('xmlns:') && value === uri,
    );
    if (found) return found[0].slice(6);
    let prefix = preferred,
      i = 1;
    while (root.props['xmlns:' + prefix] && root.props['xmlns:' + prefix] !== uri)
      prefix = preferred + i++;
    root.props['xmlns:' + prefix] = uri;
    return prefix;
  };
  const prefix = claim('d', design),
    mc = claim('mc', compat);
  root.props[mc + ':Ignorable'] = [
    ...new Set((root.props[mc + ':Ignorable'] || '').split(/\s+/).filter(Boolean).concat(prefix)),
  ].join(' ');
  return prefix;
}

/** Brush, state, style, vector and motion authoring on the ordinary XAML tree. */
export class BlendFeatures extends WorkspaceComponent {
  /** @param {import('./workspace-context.js').MotionWorkspaceHost} studio
   * @param {import('./workspace-context.js').WorkspaceOptions} [workspaceOptions] */
  constructor(studio, workspaceOptions = studio.workspaceOptions) {
    super(workspaceOptions);
    try {
      const s = (this.s = studio);
      this.environment.override(s, 'blend', this);
      this.animation = this.environment.own(new AnimationEditor(s, this.environment.options));
      this.previewRuntime = null;
      this.previewFrame = 0;
      const command = s.command.bind(s);
      this.environment.override(s, 'command', (action, event) => {
        const handler = this.commands[action];
        if (!handler) return command(action, event);
        try {
          return handler(event);
        } catch (error) {
          this.environment.notify(error.message);
        }
      });
      const inspector = s.renderInspector.bind(s);
      this.environment.override(s, 'renderInspector', () => {
        inspector();
        if (s.rightTab === 'design') this.inspector();
      });
      this.environment.override(
        s.renderer,
        'resourceResolver',
        (source) =>
          s.stores
            .map((store) => store.document)
            .find((doc) => doc.name === source || doc.name === source.split('/').pop())?.root,
      );
      const canvas = s.renderCanvas.bind(s);
      this.environment.override(s, 'renderCanvas', (...args) => {
        this.stopStatePreview();
        return canvas(...args);
      });
      const close = s.closeModal.bind(s);
      this.environment.override(s, 'closeModal', () => {
        this.stopStatePreview();
        close();
      });
      const toolbar = this.environment.track(this.environment.document.createElement('div'));
      toolbar.className = 'feature-toolbar motion-tools';
      toolbar.innerHTML =
        '<button data-action="motion-timeline" title="Objects and animation timeline">◇ <span>Motion</span></button><button data-action="motion-states" title="Visual states and transitions">↔ <span>States</span></button>';
      this.environment
        .query('.toolbar')
        .insertBefore(toolbar, this.environment.query('.toolbar .view-toggle'));
      this.environment.own(toolbar);
      this.environment.override(this.environment.api, 'animation', this.animation);
      this.environment.override(this.environment.api, 'blend', this);
      s.render();
    } catch (error) {
      try {
        this.environment.dispose();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'BlendFeatures initialization failed.');
      }
      throw error;
    }
  }
  get commands() {
    return {
      motion: () => this.animation.toggle(),
      'visual-states': () => this.states(),
      'edit-brush': () => this.brush(),
      'edit-transforms': () => this.transforms(),
      'edit-effects': () => this.effects(),
      'style-designer': () => this.style(),
      'design-values': () => this.designValues(),
      'path-designer': () => this.path(),
      'native-trigger': () => this.eventTrigger(),
      'motion-example': () => this.openExample(),
      'motion-timeline': () => this.animation.toggle(),
      'motion-new': () => {
        this.animation.show();
        this.animation.newStoryboard();
      },
      'motion-states': () => this.states(),
      'motion-brush': () => this.brush(),
      'motion-transforms': () => this.transforms(),
      'motion-effects': () => this.effects(),
      'motion-style': () => this.style(),
      'motion-design-data': () => this.designValues(),
      'motion-event': () => this.eventTrigger(),
      'motion-path': () => this.path(),
      'motion-reset-layout': () => this.resetLayout(),
    };
  }
  async openExample() {
    if (!this.s.prepareEdit()) return;
    try {
      const exampleSource =
        '<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"\n      xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"\n      xmlns:d="http://schemas.microsoft.com/expression/blend/2008"\n      xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"\n      mc:Ignorable="d" Width="1000" Height="680" Background="#F3F0FA">\n    <Grid.Resources>\n        <Storyboard x:Key="Entrance" Duration="0:00:02.5">\n            <DoubleAnimationUsingKeyFrames Storyboard.TargetName="FeatureCard" Storyboard.TargetProperty="Opacity" Duration="0:00:02.5">\n                <LinearDoubleKeyFrame KeyTime="0:00:00" Value="0" />\n                <EasingDoubleKeyFrame KeyTime="0:00:01.2" Value="1">\n                    <EasingDoubleKeyFrame.EasingFunction>\n                        <CubicEase EasingMode="EaseOut" />\n                    </EasingDoubleKeyFrame.EasingFunction>\n                </EasingDoubleKeyFrame>\n            </DoubleAnimationUsingKeyFrames>\n            <DoubleAnimationUsingKeyFrames Storyboard.TargetName="FeatureCard" Storyboard.TargetProperty="(UIElement.RenderTransform).(TranslateTransform.Y)" Duration="0:00:02.5">\n                <LinearDoubleKeyFrame KeyTime="0:00:00" Value="60" />\n                <EasingDoubleKeyFrame KeyTime="0:00:01.2" Value="0">\n                    <EasingDoubleKeyFrame.EasingFunction>\n                        <CubicEase EasingMode="EaseOut" />\n                    </EasingDoubleKeyFrame.EasingFunction>\n                </EasingDoubleKeyFrame>\n            </DoubleAnimationUsingKeyFrames>\n            <ColorAnimation Storyboard.TargetName="AccentShape" Storyboard.TargetProperty="(Shape.Fill).(SolidColorBrush.Color)" From="#7953E8" To="#42B8A5" Duration="0:00:02.5" />\n        </Storyboard>\n        <Style x:Key="ActionButton" TargetType="Button">\n            <Setter Property="Background" Value="#7953E8" />\n            <Setter Property="Foreground" Value="White" />\n            <Setter Property="Height" Value="44" />\n            <Setter Property="Padding" Value="22,10" />\n            <Style.Triggers>\n                <Trigger Property="IsMouseOver" Value="True">\n                    <Setter Property="Background" Value="#6340C8" />\n                </Trigger>\n            </Style.Triggers>\n        </Style>\n    </Grid.Resources>\n    <Grid.Triggers>\n        <EventTrigger RoutedEvent="Loaded">\n            <BeginStoryboard x:Name="BeginEntrance" Storyboard="{StaticResource Entrance}" />\n        </EventTrigger>\n    </Grid.Triggers>\n    <StackPanel Margin="64,46">\n        <TextBlock Text="MOTION LAB" FontSize="12" FontWeight="SemiBold" Foreground="#8066A9" />\n        <TextBlock Text="Design how it feels." FontSize="38" FontWeight="Bold" Margin="0,12,0,8" Foreground="#292238" />\n        <TextBlock Text="Scrub a Storyboard. Shape a curve. Bring a control to life." Foreground="#81778E" FontSize="15" Margin="0,0,0,32" />\n        <Border x:Name="FeatureCard" Padding="30" CornerRadius="20" Background="White" Height="296">\n            <Border.RenderTransform>\n                <TranslateTransform Y="0" />\n            </Border.RenderTransform>\n            <Border.Effect>\n                <DropShadowEffect Color="#250E1630" ShadowDepth="8" BlurRadius="26" Direction="270" />\n            </Border.Effect>\n            <Grid>\n                <Grid.ColumnDefinitions>\n                    <ColumnDefinition Width="170" />\n                    <ColumnDefinition Width="*" />\n                </Grid.ColumnDefinitions>\n                <Path x:Name="AccentShape" Data="M20,120 C0,55 70,0 125,25 C180,50 140,140 95,145 Z" Width="160" Height="160" Fill="#7953E8" VerticalAlignment="Center" />\n                <StackPanel Grid.Column="1" Margin="24,12,0,0">\n                    <TextBlock Text="A little motion. A lot of meaning." FontSize="24" FontWeight="SemiBold" TextWrapping="Wrap" />\n                    <TextBlock Text="Authored as human-readable WPF XAML." Foreground="#847A91" Margin="0,12,0,22" TextWrapping="Wrap" />\n                    <Button x:Name="Replay" Content="Replay entrance" Style="{StaticResource ActionButton}" HorizontalAlignment="Left">\n                        <Button.Triggers>\n                            <EventTrigger RoutedEvent="Button.Click">\n                                <BeginStoryboard Storyboard="{StaticResource Entrance}" />\n                            </EventTrigger>\n                        </Button.Triggers>\n                    </Button>\n                    <TextBlock Text="Hover this button to see its style trigger." Foreground="#9B90A7" FontSize="11" Margin="0,12,0,0" />\n                </StackPanel>\n            </Grid>\n        </Border>\n        <Border x:Name="StateCard" Margin="0,20,0,0" Padding="18" CornerRadius="12" Background="#E8E0F7" Opacity="1">\n            <VisualStateManager.VisualStateGroups>\n                <VisualStateGroup x:Name="CommonStates">\n                    <VisualState x:Name="Normal" />\n                    <VisualState x:Name="MouseOver">\n                        <Storyboard>\n                            <DoubleAnimation Storyboard.TargetName="StateCard" Storyboard.TargetProperty="Opacity" To="0.6" Duration="0:00:00" />\n                        </Storyboard>\n                    </VisualState>\n                    <VisualStateGroup.Transitions>\n                        <VisualTransition GeneratedDuration="0:00:00.25" />\n                    </VisualStateGroup.Transitions>\n                </VisualStateGroup>\n            </VisualStateManager.VisualStateGroups>\n            <TextBlock Text="Hover here: visual states transition between Normal and MouseOver." FontSize="13" Foreground="#76608D" />\n        </Border>\n    </StackPanel>\n</Grid>\n';
      const { parseXaml } = await import('../core/xaml.js'),
        doc = parseXaml(exampleSource, { name: 'MotionLab.xaml', framework: 'WPF' });
      if (this.disposed) return;
      doc.design = { width: 1000, height: 680 };
      this.s.addStore(doc);
      this.s.switchDocument(this.s.stores.length - 1);
      this.animation.show(listStoryboards(this.s.doc)[0]?.id);
      this.s.fit();
    } catch (error) {
      this.environment.notify(error.message);
    }
  }
  editable() {
    return this.s.features?.editable() ? true : false;
  }
  selected() {
    const node = this.s.selected[0];
    if (!node) throw Error('Select a layer first.');
    if (isLocked(this.s.doc, node.id)) throw Error('Unlock the selected layer first.');
    if (!this.s.prepareEdit()) return null;
    return node;
  }
  wpf() {
    if (this.s.doc.framework !== 'WPF')
      throw Error(
        'This native authoring tool currently targets WPF. Existing framework markup remains editable in XAML.',
      );
  }
  mutate(title, action) {
    if (!this.s.prepareEdit()) return false;
    this.animation.player.pause();
    this.s.store.transaction(title, action);
    return true;
  }
  inspector() {
    const host = this.s.inspectorHost(),
      node = this.s.selected[0],
      section = this.environment.track(this.environment.document.createElement('section'));
    section.className = 'panel-section blend-section';
    section.innerHTML = `<div class="section-heading">Appearance & behavior</div><div class="blend-actions"><button class="button" data-action="motion-timeline">◇ Timeline</button><button class="button" data-action="motion-example">Motion example</button><button class="button" data-action="motion-states">↔ States</button>${node ? '<button class="button" data-action="motion-brush">Brushes</button><button class="button" data-action="motion-transforms">Transforms</button><button class="button" data-action="motion-effects">Effects & clip</button><button class="button" data-action="motion-style">Style & triggers</button><button class="button" data-action="motion-event">Event triggers</button><button class="button" data-action="motion-design-data">Design values</button><button class="button" data-action="motion-path">Edit path</button><button class="button" data-action="motion-reset-layout">Reset layout</button>' : ''}</div>`;
    host.prepend(section);
  }
  brush() {
    const s = this.s,
      selected = this.selected();
    if (!selected) return;
    const id = selected.id;
    let property = ['Rectangle', 'Ellipse', 'Path', 'Polygon'].includes(localName(selected.type))
      ? 'Fill'
      : 'Background';
    let kind = 'Solid',
      draft = {
        color: '#7953E8',
        opacity: '1',
        start: '0,0',
        end: '1,1',
        center: '0.5,0.5',
        origin: '0.5,0.5',
        radiusX: '0.5',
        radiusY: '0.5',
        stops: [
          { color: '#7953E8', offset: '0' },
          { color: '#31C8C4', offset: '1' },
        ],
      };
    const load = () => {
      const node = find(s.doc.root, id),
        brush = brushNode(s.doc, node, property),
        type = localName(brush?.type || '');
      kind =
        type === 'LinearGradientBrush'
          ? 'Linear'
          : type === 'RadialGradientBrush'
            ? 'Radial'
            : 'Solid';
      draft.color = brush?.props.Color || node.props[property] || '#7953E8';
      if (draft.color.startsWith('{')) draft.color = '#7953E8';
      Object.assign(draft, {
        opacity: brush?.props.Opacity || '1',
        start: brush?.props.StartPoint || '0,0',
        end: brush?.props.EndPoint || '1,1',
        center: brush?.props.Center || '0.5,0.5',
        origin: brush?.props.GradientOrigin || '0.5,0.5',
        radiusX: brush?.props.RadiusX || '0.5',
        radiusY: brush?.props.RadiusY || '0.5',
      });
      const stops = [];
      if (brush)
        walk(brush, (n) => {
          if (localName(n.type || '') === 'GradientStop')
            stops.push({ color: n.props.Color || '#000000', offset: n.props.Offset || '0' });
        });
      if (stops.length) draft.stops = stops;
    };
    load();
    const show = () => {
      s.modal(
        'Brush editor',
        `<div class="form-columns">${select('brush-property', 'Property', ['Background', 'Foreground', 'Fill', 'Stroke', 'BorderBrush'], property)}${select('brush-kind', 'Brush', ['Solid', 'Linear', 'Radial'], kind)}${field('brush-opacity', 'Opacity', draft.opacity, 'number')}${kind === 'Solid' ? field('brush-color', 'Color', draft.color) : ''}${kind === 'Linear' ? field('brush-start', 'Start point', draft.start) + field('brush-end', 'End point', draft.end) : ''}${kind === 'Radial' ? field('brush-center', 'Center', draft.center) + field('brush-origin', 'Gradient origin', draft.origin) + field('brush-radius-x', 'Radius X', draft.radiusX) + field('brush-radius-y', 'Radius Y', draft.radiusY) : ''}</div>${kind !== 'Solid' ? `<div class="section-heading">Gradient stops<span class="spacer"></span><button class="button" id="brush-add-stop">+ Stop</button></div><div id="brush-stops">${draft.stops.map((stop, i) => `<div class="brush-stop" data-stop="${i}"><span class="swatch" style="background:${esc(/^#[\da-f]{3,8}$/i.test(stop.color) ? stop.color : '#7953E8')}"></span><input data-stop-color value="${esc(stop.color)}" aria-label="Stop color"><input data-stop-offset type="number" min="0" max="1" step="0.01" value="${esc(stop.offset)}" aria-label="Stop offset"><button data-stop-remove="${i}" aria-label="Remove stop">×</button></div>`).join('')}</div>` : ''}<p class="feature-help">Saving writes a local native brush property element. Colors accept WPF names, #RRGGBB, and #AARRGGBB.</p>`,
        [
          {
            label: 'Reset brush',
            run: () => {
              this.mutate('Reset brush', (doc) =>
                replaceProperty(find(doc.root, id), property, null),
              );
              s.closeModal();
            },
          },
          {
            label: 'Apply brush',
            primary: true,
            run: () => {
              capture();
              const opacity = number(draft.opacity, 'Opacity', { min: 0, max: 1 });
              let brush;
              if (kind === 'Solid')
                brush = element('SolidColorBrush', {
                  Color: draft.color,
                  Opacity: String(opacity),
                });
              else {
                if (draft.stops.length < 2) throw Error('Add at least two gradient stops.');
                const props = { Opacity: String(opacity) };
                if (kind === 'Linear')
                  Object.assign(props, { StartPoint: draft.start, EndPoint: draft.end });
                else
                  Object.assign(props, {
                    Center: draft.center,
                    GradientOrigin: draft.origin,
                    RadiusX: String(number(draft.radiusX, 'Radius X', { min: 0 })),
                    RadiusY: String(number(draft.radiusY, 'Radius Y', { min: 0 })),
                  });
                for (const key of ['StartPoint', 'EndPoint', 'Center', 'GradientOrigin'])
                  if (props[key] && !/^\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*$/.test(props[key]))
                    throw Error(key + ' requires two numeric coordinates.');
                brush = element(
                  kind + 'GradientBrush',
                  props,
                  draft.stops.map((stop) =>
                    element('GradientStop', {
                      Color: stop.color,
                      Offset: String(number(stop.offset, 'Offset', { min: 0, max: 1 })),
                    }),
                  ),
                );
              }
              this.mutate('Edit ' + property + ' brush', (doc) =>
                replaceProperty(find(doc.root, id), property, brush),
              );
              s.closeModal();
            },
          },
        ],
        true,
      );
      const capture = () => {
        draft.opacity = this.environment.query('[name=brush-opacity]').value;
        for (const [key, name] of Object.entries({
          color: 'brush-color',
          start: 'brush-start',
          end: 'brush-end',
          center: 'brush-center',
          origin: 'brush-origin',
          radiusX: 'brush-radius-x',
          radiusY: 'brush-radius-y',
        }))
          if (this.environment.query(`[name=${name}]`))
            draft[key] = this.environment.query(`[name=${name}]`).value;
        if (kind !== 'Solid')
          draft.stops = this.environment.all('[data-stop]').map((row) => ({
            color: this.environment.query('[data-stop-color]', row).value,
            offset: this.environment.query('[data-stop-offset]', row).value,
          }));
      };
      this.environment.handler(this.environment.query('[name=brush-property]'), 'onchange', (e) => {
        property = e.target.value;
        load();
        show();
      });
      this.environment.handler(this.environment.query('[name=brush-kind]'), 'onchange', (e) => {
        capture();
        kind = e.target.value;
        show();
      });
      this.environment.listen(this.environment.query('#brush-add-stop'), 'click', () => {
        capture();
        draft.stops.push({ color: '#FFFFFF', offset: '0.5' });
        show();
      });
      this.environment.all('[data-stop-remove]').forEach((button) =>
        this.environment.handler(button, 'onclick', () => {
          capture();
          draft.stops.splice(Number(button.dataset.stopRemove), 1);
          show();
        }),
      );
    };
    show();
  }
  transforms() {
    const node = this.selected();
    if (!node) return;
    const s = this.s,
      id = node.id,
      paths = PropertyPaths.TRANSFORM_PATHS;
    const fields = [
      ['ScaleX', 'Scale X', 1],
      ['ScaleY', 'Scale Y', 1],
      ['SkewX', 'Skew X', 0],
      ['SkewY', 'Skew Y', 0],
      ['Angle', 'Rotate (degrees)', 0],
      ['X', 'Translate X', 0],
      ['Y', 'Translate Y', 0],
    ];
    const draftDoc = clone(s.doc),
      draftNode = find(draftDoc.root, id);
    const values = Object.fromEntries(
      fields.map(([key, title, fallback]) => {
        const path = PropertyPaths.ensureTransformPath(draftDoc, draftNode, paths[key]);
        return [key, PropertyPaths.readPropertyPath(draftDoc, draftNode, path) ?? fallback];
      }),
    );
    s.modal(
      'Render transforms',
      `<div class="form-columns">${fields.map(([key, title]) => field('transform-' + key, title, values[key], 'number')).join('')}${field('transform-origin', 'Origin (relative x,y)', node.props.RenderTransformOrigin || '0,0')}</div><p class="feature-help">The editor retains existing transform order and inserts missing transforms. Render transforms affect appearance without reserving layout space.</p>`,
      [
        {
          label: 'Reset transforms',
          run: () => {
            this.mutate('Reset transforms', (doc) => {
              const target = find(doc.root, id);
              replaceProperty(target, 'RenderTransform', null);
              delete target.props.RenderTransformOrigin;
            });
            s.closeModal();
          },
        },
        {
          label: 'Apply transforms',
          primary: true,
          run: () => {
            const next = {};
            for (const [key, title] of fields)
              next[key] = number(
                this.environment.query('[name=transform-' + key + ']').value,
                title,
              );
            const origin = this.environment.query('[name=transform-origin]').value;
            if (!/^\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*$/.test(origin))
              throw Error('Origin requires two numeric coordinates.');
            this.mutate('Edit render transforms', (doc) => {
              const target = find(doc.root, id);
              for (const [key] of fields) {
                let path = paths[key];
                if (PropertyPaths.ensureTransformPath)
                  path = PropertyPaths.ensureTransformPath(doc, target, path) || path;
                else PropertyPaths.transformGroup(target, true);
                PropertyPaths.writePropertyPath(doc, target, path, String(next[key]));
              }
              target.props.RenderTransformOrigin = origin;
            });
            s.closeModal();
          },
        },
      ],
      true,
    );
  }
  effects() {
    const node = this.selected();
    if (!node) return;
    const id = node.id,
      s = this.s,
      effect = propertyChild(node, 'Effect')?.children[0],
      clip = propertyChild(node, 'Clip')?.children[0];
    s.modal(
      'Effects and clipping',
      `<div class="form-columns">${select('effect-kind', 'Effect', ['None', 'DropShadowEffect', 'BlurEffect'], effect?.type || 'None')}${field('effect-color', 'Shadow color', effect?.props.Color || '#000000')}${field('effect-blur', 'Blur radius', effect?.props.BlurRadius || effect?.props.Radius || '12', 'number')}${field('effect-depth', 'Shadow depth', effect?.props.ShadowDepth || '4', 'number')}${field('effect-direction', 'Shadow direction', effect?.props.Direction || '315', 'number')}${field('effect-opacity', 'Shadow opacity', effect?.props.Opacity || '0.25', 'number')}${field('clip-rect', 'Clip rectangle (x,y,width,height)', clip?.props.Rect || '')}${field('clip-radius', 'Clip corner radius', clip?.props.RadiusX || '0', 'number')}</div><p class="feature-help">An empty clip rectangle clears rectangular clipping. Complex geometry remains editable in XAML.</p>`,
      [
        {
          label: 'Apply appearance',
          primary: true,
          run: () => {
            const kind = this.environment.query('[name=effect-kind]').value,
              blur = number(this.environment.query('[name=effect-blur]').value, 'Blur', { min: 0 }),
              depth = number(this.environment.query('[name=effect-depth]').value, 'Shadow depth'),
              direction = number(
                this.environment.query('[name=effect-direction]').value,
                'Direction',
              ),
              opacity = number(this.environment.query('[name=effect-opacity]').value, 'Opacity', {
                min: 0,
                max: 1,
              }),
              color = this.environment.query('[name=effect-color]').value,
              rect = this.environment.query('[name=clip-rect]').value.trim(),
              radius = number(this.environment.query('[name=clip-radius]').value, 'Corner radius', {
                min: 0,
              });
            if (
              rect &&
              (rect.split(',').length !== 4 ||
                rect.split(',').some((v) => !Number.isFinite(Number(v))))
            )
              throw Error('Clip rectangle requires four numbers.');
            this.mutate('Edit effects and clip', (doc) => {
              const target = find(doc.root, id);
              replaceProperty(
                target,
                'Effect',
                kind === 'None'
                  ? null
                  : element(
                      kind,
                      kind === 'BlurEffect'
                        ? { Radius: String(blur) }
                        : {
                            Color: color,
                            BlurRadius: String(blur),
                            ShadowDepth: String(depth),
                            Direction: String(direction),
                            Opacity: String(opacity),
                          },
                    ),
              );
              replaceProperty(
                target,
                'Clip',
                rect
                  ? element('RectangleGeometry', {
                      Rect: rect,
                      RadiusX: String(radius),
                      RadiusY: String(radius),
                    })
                  : null,
              );
            });
            s.closeModal();
          },
        },
      ],
      true,
    );
  }
  designValues() {
    const node = this.selected();
    if (!node) return;
    const s = this.s,
      id = node.id,
      current = designProperties(node, s.doc);
    let rows = Object.entries(current).map(([property, value]) => ({ property, value }));
    if (!rows.length) rows = [{ property: 'Text', value: 'Design preview' }];
    const show = () => {
      s.modal(
        'Design-time values',
        `<p>These overrides appear on the design canvas. Runtime and exported HTML use the authored properties and bindings.</p><div id="design-value-rows">${rows.map((row, index) => `<div class="design-value-row" data-design-row="${index}"><input data-design-key value="${esc(row.property)}" placeholder="Property"><input data-design-value value="${esc(row.value)}" placeholder="Preview value"><button data-design-remove="${index}">×</button></div>`).join('')}</div><div class="helper-buttons"><button class="button" id="design-value-add">+ Value</button><button class="button" id="design-sample-items">Sample ItemsSource</button></div>`,
        [
          {
            label: 'Save design values',
            primary: true,
            run: () => {
              capture();
              rows.forEach((row) => {
                if (!/^[A-Za-z_][\w.]*$/.test(row.property))
                  throw Error('Use valid property names.');
              });
              this.mutate('Edit design-time values', (doc) => {
                const target = find(doc.root, id),
                  prefix = ensureDesignNamespace(doc);
                const namespaces = new Set(
                  Object.entries(doc.root.props)
                    .filter(
                      ([key, value]) =>
                        key.startsWith('xmlns:') &&
                        value === 'http://schemas.microsoft.com/expression/blend/2008',
                    )
                    .map(([key]) => key.slice(6)),
                );
                for (const key of Object.keys(target.props))
                  if (namespaces.has(key.split(':')[0])) delete target.props[key];
                rows.forEach(
                  (row) =>
                    (target.props[prefix + ':' + row.property] = row.value.replace(
                      /\{d:SampleData/g,
                      '{' + prefix + ':SampleData',
                    )),
                );
              });
              s.closeModal();
            },
          },
        ],
        true,
      );
      const capture = () =>
        (rows = this.environment.all('[data-design-row]').map((row) => ({
          property: this.environment.query('[data-design-key]', row).value.trim(),
          value: this.environment.query('[data-design-value]', row).value,
        })));
      this.environment.handler(this.environment.query('#design-value-add'), 'onclick', () => {
        capture();
        rows.push({ property: '', value: '' });
        show();
      });
      this.environment.handler(this.environment.query('#design-sample-items'), 'onclick', () => {
        capture();
        rows = rows.filter((row) => row.property !== 'ItemsSource');
        rows.push({ property: 'ItemsSource', value: '{d:SampleData ItemCount=5}' });
        show();
      });
      this.environment.all('[data-design-remove]').forEach((button) =>
        this.environment.handler(button, 'onclick', () => {
          capture();
          rows.splice(Number(button.dataset.designRemove), 1);
          show();
        }),
      );
    };
    show();
  }
  resetLayout() {
    const node = this.selected();
    if (!node) return;
    const keys = [
      'Width',
      'Height',
      'MinWidth',
      'MinHeight',
      'MaxWidth',
      'MaxHeight',
      'Margin',
      'HorizontalAlignment',
      'VerticalAlignment',
      'Canvas.Left',
      'Canvas.Top',
      'Canvas.Right',
      'Canvas.Bottom',
      'Grid.Row',
      'Grid.Column',
      'Grid.RowSpan',
      'Grid.ColumnSpan',
      'DockPanel.Dock',
    ];
    this.mutate('Reset selected layout', (doc) => {
      for (const id of this.s.store.selection) {
        const target = find(doc.root, id);
        if (!target || isLocked(doc, id)) continue;
        keys.forEach((key) => delete target.props[key]);
      }
    });
    this.environment.notify('Local layout values reset. Parent layout now determines placement.');
  }
  style() {
    this.wpf();
    const selected = this.selected();
    if (!selected) return;
    const s = this.s,
      targetId = selected.id;
    let source =
      localName(selected.type) === 'Style'
        ? selected
        : propertyChild(selected, 'Style')?.children.find((n) => localName(n.type) === 'Style');
    if (!source) {
      const reference = selected.props.Style?.match(/^\{(?:Static|Dynamic)Resource\s+([^}]+)\}$/);
      if (reference) source = PropertyPaths.scopedResource(s.doc, selected, reference[1]);
    }
    if (source && localName(source.type) !== 'Style') source = null;
    const keyed = Boolean(source?.props['x:Key']),
      sourceId = source?.id;
    let key = keyed ? source.props['x:Key'] : label(selected).replace(/\W/g, '') + 'Style',
      targetType = source?.props.TargetType || localName(selected.type),
      basedOn = source?.props.BasedOn || '';
    let setters = (source?.children || [])
      .filter((n) => localName(n.type) === 'Setter' && n.props.Value !== undefined)
      .map((n) => ({
        id: n.id,
        property: n.props.Property || '',
        value: n.props.Value,
        target: n.props.TargetName || '',
      }));
    if (!source)
      setters = Object.entries(selected.props)
        .filter(([property]) =>
          [
            'Background',
            'Foreground',
            'FontSize',
            'FontFamily',
            'FontWeight',
            'BorderBrush',
            'BorderThickness',
            'Padding',
            'Opacity',
          ].includes(property),
        )
        .map(([property, value]) => ({ property, value, target: '' }));
    const triggerProp = source && propertyChild(source, 'Triggers');
    let triggers = (triggerProp?.children || [])
      .filter(
        (n) =>
          localName(n.type) === 'Trigger' &&
          n.props.Property &&
          n.children.every((c) => localName(c.type) === 'Setter' && c.props.Value !== undefined),
      )
      .map((n) => ({
        id: n.id,
        property: n.props.Property,
        value: n.props.Value || 'True',
        setters: n.children.map((c) => ({
          property: c.props.Property,
          value: c.props.Value,
          target: c.props.TargetName || '',
        })),
      }));
    const show = () => {
      s.modal(
        'Style and property triggers',
        `<div class="form-columns">${field('style-key', 'Resource key', key)}${field('style-target', 'Target type', targetType)}${field('style-based', 'Based on (resource expression)', basedOn)}</div><div class="section-heading">Setters<span class="spacer"></span><button id="style-add-setter" class="button">+ Setter</button></div><div id="style-setters">${setters.map((row, index) => this.setterRow(row, index)).join('')}</div><div class="section-heading">Property triggers<span class="spacer"></span><button id="style-add-trigger" class="button">+ Trigger</button></div><div id="style-triggers">${triggers.map((trigger, index) => `<article class="style-trigger" data-style-trigger="${index}"><div class="form-columns"><label>Property<input data-trigger-property value="${esc(trigger.property)}"></label><label>Equals<input data-trigger-value value="${esc(trigger.value)}"></label></div><div data-trigger-setters>${trigger.setters.map((row, i) => this.setterRow(row, i, true)).join('')}</div><button class="button" data-trigger-setter-add="${index}">+ Setter</button><button class="button" data-trigger-remove="${index}">Remove trigger</button></article>`).join('')}</div>${localName(selected.type) !== 'Style' ? '<label class="check-row"><input name="style-clear-locals" type="checkbox"> Move matching local values into this style</label>' : ''}<p class="feature-help">Advanced setter values, event/data/multi triggers, and resource children are preserved. Editing an inline or implicit style creates an explicit resource copy. Existing keyed resources keep their name.</p>`,
        [
          {
            label: 'Apply style',
            primary: true,
            run: () => {
              capture();
              identifier(key, 'resource key');
              if (keyed && key !== source.props['x:Key'])
                throw Error('Rename keyed resources in XAML together with their references.');
              if (!targetType.trim()) throw Error('Enter a target type.');
              const used = [];
              walk(s.doc.root, (n) => {
                if (n.props?.['x:Key'] === key && n.id !== sourceId) used.push(n);
              });
              if (used.length) throw Error('The resource key is already used.');
              for (const row of setters.concat(triggers.flatMap((t) => t.setters))) {
                if (!/^[A-Za-z_][\w.]*$/.test(row.property))
                  throw Error('Use valid setter property names.');
                if (row.target)
                  throw Error(
                    'TargetName is supported in template triggers, not in Style setters. Edit the template trigger in XAML.',
                  );
              }
              const clearLocals = this.environment.query('[name=style-clear-locals]')?.checked;
              this.mutate('Edit style and triggers', (doc) => {
                doc.root.props['xmlns:x'] ??= 'http://schemas.microsoft.com/winfx/2006/xaml';
                const target = find(doc.root, targetId);
                let style = sourceId && find(doc.root, sourceId);
                const explicitExisting = style && keyed;
                if (!explicitExisting) style = source ? reidentify(source) : element('Style');
                style.props['x:Key'] = key;
                style.props.TargetType = targetType;
                if (basedOn) style.props.BasedOn = basedOn;
                else delete style.props.BasedOn;
                style.children = style.children.filter(
                  (n) => !(localName(n.type) === 'Setter' && n.props.Value !== undefined),
                );
                const setterNodes = (rows) =>
                  rows.map((row) =>
                    element('Setter', {
                      Property: row.property,
                      Value: row.value,
                      ...(row.target ? { TargetName: row.target } : {}),
                    }),
                  );
                style.children.push(...setterNodes(setters));
                let holder = propertyChild(style, 'Triggers');
                if (!holder && triggers.length) {
                  holder = element('Style.Triggers');
                  style.children.push(holder);
                }
                if (holder) {
                  holder.children = holder.children.filter(
                    (n) =>
                      !(
                        localName(n.type) === 'Trigger' &&
                        n.props.Property &&
                        n.children.every(
                          (c) => localName(c.type) === 'Setter' && c.props.Value !== undefined,
                        )
                      ),
                  );
                  holder.children.push(
                    ...triggers.map((trigger) =>
                      element(
                        'Trigger',
                        { Property: trigger.property, Value: trigger.value },
                        setterNodes(trigger.setters),
                      ),
                    ),
                  );
                }
                if (!explicitExisting) {
                  let resources =
                    localName(doc.root.type) === 'ResourceDictionary'
                      ? doc.root
                      : propertyChild(doc.root, 'Resources');
                  if (!resources) {
                    resources = element(doc.root.type + '.Resources');
                    doc.root.children.unshift(resources);
                  }
                  resources.children.push(style);
                }
                if (localName(target.type) !== 'Style') {
                  replaceProperty(target, 'Style', null);
                  target.props.Style = `{StaticResource ${key}}`;
                  if (clearLocals) setters.forEach((row) => delete target.props[row.property]);
                }
              });
              s.closeModal();
            },
          },
        ],
        true,
      );
      if (keyed) this.environment.query('[name=style-key]').readOnly = true;
      const capture = () => {
        key = this.environment.query('[name=style-key]').value.trim();
        targetType = this.environment.query('[name=style-target]').value.trim();
        basedOn = this.environment.query('[name=style-based]').value.trim();
        const readRows = (holder) =>
          this.environment.all(':scope > [data-setter-row]', holder).map((row) => ({
            property: this.environment.query('[data-setter-property]', row).value.trim(),
            value: this.environment.query('[data-setter-value]', row).value,
            target: this.environment.query('[data-setter-target]', row).value.trim(),
          }));
        setters = readRows(this.environment.query('#style-setters'));
        triggers = this.environment.all('[data-style-trigger]').map((row) => ({
          property: this.environment.query('[data-trigger-property]', row).value.trim(),
          value: this.environment.query('[data-trigger-value]', row).value,
          setters: readRows(this.environment.query('[data-trigger-setters]', row)),
        }));
      };
      this.environment.handler(this.environment.query('#style-add-setter'), 'onclick', () => {
        capture();
        setters.push({ property: 'Foreground', value: '#7953E8', target: '' });
        show();
      });
      this.environment.handler(this.environment.query('#style-add-trigger'), 'onclick', () => {
        capture();
        triggers.push({
          property: 'IsMouseOver',
          value: 'True',
          setters: [{ property: 'Opacity', value: '0.8', target: '' }],
        });
        show();
      });
      this.environment.all('[data-setter-remove]').forEach((button) =>
        this.environment.handler(button, 'onclick', () => {
          const trigger = button.closest('[data-style-trigger]'),
            index = Number(button.dataset.setterRemove);
          capture();
          if (trigger) triggers[Number(trigger.dataset.styleTrigger)].setters.splice(index, 1);
          else setters.splice(index, 1);
          show();
        }),
      );
      this.environment.all('[data-trigger-remove]').forEach((button) =>
        this.environment.handler(button, 'onclick', () => {
          capture();
          triggers.splice(Number(button.dataset.triggerRemove), 1);
          show();
        }),
      );
      this.environment.all('[data-trigger-setter-add]').forEach((button) =>
        this.environment.handler(button, 'onclick', () => {
          capture();
          triggers[Number(button.dataset.triggerSetterAdd)].setters.push({
            property: 'Background',
            value: '#7953E8',
            target: '',
          });
          show();
        }),
      );
    };
    show();
  }
  setterRow(row, index) {
    return `<div class="style-setter-row" data-setter-row="${index}"><input data-setter-property value="${esc(row.property)}" placeholder="Property" aria-label="Property"><input data-setter-value value="${esc(row.value)}" placeholder="Value" aria-label="Value"><input data-setter-target value="${esc(row.target || '')}" placeholder="Target name (template only)" aria-label="Target name"><button data-setter-remove="${index}" aria-label="Remove setter">×</button></div>`;
  }
  states() {
    this.wpf();
    const s = this.s,
      owner = s.selected[0] || s.scope || s.doc.root;
    if (!s.prepareEdit()) return;
    const groups = stateGroups(s.doc);
    s.modal(
      'Visual states and transitions',
      `<div class="state-heading"><p>Author mutually exclusive states within each group. Groups can run together.</p><button class="button primary" id="state-add-group">+ Group on ${esc(label(owner))}</button></div><div class="state-group-list">${groups.map((group) => `<section class="state-group"><header><strong>${esc(group.name)}</strong><small>${esc(label(find(s.doc.root, group.ownerId)))}</small><span class="spacer"></span><button data-state-new="${group.id}">+ State</button><button data-transition-new="${group.id}">+ Transition</button><button data-state-group-delete="${group.id}" aria-label="Delete group">×</button></header><div class="state-cards">${group.states.map((state) => `<article><strong>${esc(state.props['x:Name'] || state.props.Name)}</strong><button data-state-preview="${state.id}" data-state-group="${group.id}">Preview</button><button data-state-timeline="${state.id}">Timeline</button><button data-state-value="${state.id}">+ Value</button><button data-state-delete="${state.id}" aria-label="Delete state">×</button></article>`).join('') || '<p>No states yet.</p>'}</div>${group.transitions.map((transition) => `<button class="state-transition" data-transition-edit="${transition.id}" data-transition-group="${group.id}">${esc(transition.props.From || 'Any')} → ${esc(transition.props.To || 'Any')} · ${esc(transition.props.GeneratedDuration || '0:0:0')}</button>`).join('')}</section>`).join('') || '<div class="motion-empty">Add a group, then create states such as Normal, PointerOver, and Pressed.</div>'}</div><p class="feature-help">WPF states contain Storyboards. Empty states release the previous state’s animated values. Preview uses the current design canvas; close this panel to restore it.</p>`,
      [],
      true,
    );
    this.environment.handler(this.environment.query('#state-add-group'), 'onclick', () =>
      this.namedDialog('New visual state group', 'CommonStates', (name) => {
        this.mutate('Create visual state group', (doc) =>
          createStateGroup(doc, find(doc.root, owner.id), name),
        );
        this.states();
      }),
    );
    this.environment.all('[data-state-new]').forEach((button) =>
      this.environment.handler(button, 'onclick', () =>
        this.namedDialog('New visual state', 'Normal', (name) => {
          this.mutate('Create visual state', (doc) =>
            createState(find(doc.root, button.dataset.stateNew), name),
          );
          this.states();
        }),
      ),
    );
    this.environment.all('[data-state-group-delete]').forEach((button) =>
      this.environment.handler(button, 'onclick', () => {
        this.mutate('Delete visual state group', (doc) =>
          remove(doc.root, button.dataset.stateGroupDelete),
        );
        this.states();
      }),
    );
    this.environment.all('[data-state-delete]').forEach((button) =>
      this.environment.handler(button, 'onclick', () => {
        this.mutate('Delete visual state', (doc) => {
          const state = find(doc.root, button.dataset.stateDelete),
            name = state.props['x:Name'] || state.props.Name;
          let group = parentOf(doc.root, state.id);
          while (group && localName(group.type) !== 'VisualStateGroup')
            group = parentOf(doc.root, group.id);
          remove(doc.root, state.id);
          if (group) {
            const holder = propertyChild(group, 'Transitions');
            if (holder)
              holder.children = holder.children.filter(
                (t) => t.props.From !== name && t.props.To !== name,
              );
            group.children = group.children.filter(
              (t) =>
                localName(t.type) !== 'VisualTransition' ||
                (t.props.From !== name && t.props.To !== name),
            );
          }
        });
        this.states();
      }),
    );
    this.environment.all('[data-state-timeline]').forEach((button) =>
      this.environment.handler(button, 'onclick', () => {
        let id;
        this.mutate('Open visual state Storyboard', (doc) => {
          id = stateStoryboard(find(doc.root, button.dataset.stateTimeline)).id;
        });
        s.closeModal();
        this.animation.show(id);
      }),
    );
    this.environment
      .all('[data-state-value]')
      .forEach((button) =>
        this.environment.handler(button, 'onclick', () =>
          this.stateValue(button.dataset.stateValue),
        ),
      );
    this.environment.all('[data-state-preview]').forEach((button) =>
      this.environment.handler(button, 'onclick', () => {
        this.previewState(button.dataset.stateGroup, button.dataset.statePreview);
        this.environment
          .all('[data-state-preview]')
          .forEach((b) => b.classList.toggle('active', b === button));
      }),
    );
    this.environment
      .all('[data-transition-new]')
      .forEach((button) =>
        this.environment.handler(button, 'onclick', () =>
          this.transition(button.dataset.transitionNew),
        ),
      );
    this.environment
      .all('[data-transition-edit]')
      .forEach((button) =>
        this.environment.handler(button, 'onclick', () =>
          this.transition(button.dataset.transitionGroup, button.dataset.transitionEdit),
        ),
      );
  }
  namedDialog(title, suggestion, save) {
    this.s.modal(title, field('motion-object-name', 'Name', suggestion), [
      {
        label: 'Create',
        primary: true,
        run: () =>
          save(identifier(this.environment.query('[name=motion-object-name]').value.trim())),
      },
    ]);
  }
  stateValue(stateId) {
    const s = this.s,
      target = s.selected[0] || s.doc.root;
    const targets = [];
    walk(s.doc.root, (n) => {
      if (n.kind === 'element' && !localName(n.type).includes('.')) targets.push(n);
    });
    s.modal(
      'Visual state property',
      `${select(
        'state-target',
        'Target',
        targets.map((n) => [n.id, label(n)]),
        target.id,
      )}${field('state-property', 'Property path', 'Opacity')}${field('state-value', 'State value', '0.6')}`,
      [
        {
          label: 'Add state value',
          primary: true,
          run: () => {
            const id = this.environment.query('[name=state-target]').value,
              property = this.environment.query('[name=state-property]').value.trim(),
              value = this.environment.query('[name=state-value]').value;
            if (isLocked(s.doc, id)) throw Error('Unlock the target first.');
            this.mutate('Set visual state value', (doc) => {
              const story = stateStoryboard(find(doc.root, stateId));
              const existing = story.children.find(
                (n) =>
                  n.props['Storyboard.TargetName'] ===
                    (find(doc.root, id).props['x:Name'] || find(doc.root, id).props.Name) &&
                  n.props['Storyboard.TargetProperty'] === property,
              );
              const track = existing || addTrack(doc, story, find(doc.root, id), property);
              setKeyframe(track, 0, value, { interpolation: 'Discrete' });
            });
            this.states();
          },
        },
      ],
    );
  }
  transition(groupId, transitionId) {
    const s = this.s,
      group = stateGroups(s.doc).find((g) => g.id === groupId),
      existing = transitionId && find(s.doc.root, transitionId);
    if (!group) return;
    const options = [
      ['', 'Any'],
      ...group.states.map((state) => [
        state.props['x:Name'] || state.props.Name,
        state.props['x:Name'] || state.props.Name,
      ]),
    ];
    s.modal(
      'Visual transition',
      `${select('transition-from', 'From', options, existing?.props.From || '')}${select('transition-to', 'To', options, existing?.props.To || '')}${field('transition-duration', 'Generated duration (seconds)', existing?.props.GeneratedDuration ? parseDuration(existing.props.GeneratedDuration) : 0.3, 'number')}<p>Generated transitions interpolate supported animated properties. Explicit transition Storyboards remain editable in the timeline.</p>`,
      [
        ...(existing
          ? [
              {
                label: 'Delete transition',
                run: () => {
                  this.mutate('Delete transition', (doc) => remove(doc.root, transitionId));
                  this.states();
                },
              },
              {
                label: 'Edit transition Storyboard',
                run: () => {
                  let id;
                  this.mutate('Edit transition Storyboard', (doc) => {
                    const transition = find(doc.root, transitionId);
                    let holder = propertyChild(transition, 'Storyboard');
                    if (!holder) {
                      holder = element('VisualTransition.Storyboard', {}, [
                        element('Storyboard', {
                          Duration: transition.props.GeneratedDuration || '0:0:0.3',
                        }),
                      ]);
                      transition.children.push(holder);
                    }
                    id = holder.children[0].id;
                  });
                  s.closeModal();
                  this.animation.show(id);
                },
              },
            ]
          : []),
        {
          label: 'Save transition',
          primary: true,
          run: () => {
            const from = this.environment.query('[name=transition-from]').value,
              to = this.environment.query('[name=transition-to]').value,
              duration = number(
                this.environment.query('[name=transition-duration]').value,
                'Duration',
                { min: 0 },
              );
            this.mutate('Edit transition', (doc) => {
              const node = find(doc.root, groupId);
              let holder = propertyChild(node, 'Transitions');
              if (!holder) {
                holder = element('VisualStateGroup.Transitions');
                node.children.push(holder);
              }
              let transition = transitionId && find(doc.root, transitionId);
              if (!transition) {
                transition = element('VisualTransition');
                holder.children.push(transition);
              }
              delete transition.props.From;
              delete transition.props.To;
              if (from) transition.props.From = from;
              if (to) transition.props.To = to;
              transition.props.GeneratedDuration = formatTime(duration);
            });
            this.states();
          },
        },
      ],
    );
  }
  previewState(groupId, stateId) {
    this.animation.stop();
    if (!this.previewRuntime) {
      this.previewBaselines = captureMotion(this.s.renderer);
      this.previewRuntime = new MotionRuntime(this.s.doc, {
        now: () => this.environment.window.performance.now(),
        schedule: (callback) => this.environment.frame(callback),
        cancel: (id) => this.environment.cancelFrame(id),
      });
      this.previewRuntime.bind(this.s.renderer);
      this.previewStarted = this.environment.window.performance.now() / 1000;
    }
    const state = find(this.s.doc.root, stateId),
      now = this.previewRuntime.time;
    this.previewRuntime.states.go(groupId, state.props['x:Name'] || state.props.Name, now, true);
    this.environment.cancelFrame(this.previewFrame);
    this.previewRuntime.tick();
    this.s.drawSelection();
  }
  stopStatePreview() {
    this.environment.cancelFrame(this.previewFrame);
    this.previewFrame = 0;
    if (this.previewRuntime) {
      this.previewRuntime.dispose();
      this.previewRuntime = null;
      if (this.previewBaselines) restoreMotion(this.s.renderer, this.previewBaselines);
      this.previewBaselines = null;
    }
  }
  eventTrigger() {
    this.wpf();
    const node = this.selected();
    if (!node) return;
    const s = this.s,
      id = node.id,
      stories = listStoryboards(s.doc).filter((story) => story.node?.props['x:Key']),
      holder = propertyChild(node, 'Triggers'),
      events = (holder?.children || []).filter((n) => localName(n.type) === 'EventTrigger');
    let beginNames = [];
    walk(node, (n) => {
      if (localName(n.type || '') === 'BeginStoryboard' && (n.props.Name || n.props['x:Name']))
        beginNames.push(n.props.Name || n.props['x:Name']);
    });
    s.modal(
      'Native event triggers',
      `<p>Actions are stored as native WPF EventTrigger markup.</p>${events.map((event) => `<article class="connection-card"><strong>${esc(event.props.RoutedEvent || 'Event')}</strong><span>${esc(event.children.map((n) => localName(n.type)).join(', '))}</span><button data-event-delete="${event.id}">Remove</button></article>`).join('')}<div class="form-columns">${select('event-name', 'Routed event', ['Loaded', 'MouseEnter', 'MouseLeave', 'MouseDown', 'MouseUp', 'GotFocus', 'LostFocus', 'Button.Click'], 'Loaded')}${select('event-action', 'Action', ['BeginStoryboard', 'StopStoryboard', 'PauseStoryboard', 'ResumeStoryboard', 'SeekStoryboard'], 'BeginStoryboard')}${select(
        'event-story',
        'Storyboard resource',
        stories.map((story) => [story.node.props['x:Key'], story.name]),
        stories[0]?.node.props['x:Key'] || '',
      )}${select('event-begin', 'Controllable begin name', beginNames, beginNames[0] || '')}${field('event-offset', 'Seek offset', '0:0:0')}</div>`,
      [
        {
          label: 'Add native trigger',
          primary: true,
          run: () => {
            const event = this.environment.query('[name=event-name]').value,
              type = this.environment.query('[name=event-action]').value,
              key = this.environment.query('[name=event-story]').value,
              begin = this.environment.query('[name=event-begin]').value,
              offset = this.environment.query('[name=event-offset]').value;
            if (type === 'BeginStoryboard' && !key)
              throw Error('Create a resource Storyboard first.');
            if (type !== 'BeginStoryboard' && !begin)
              throw Error('Add a named BeginStoryboard first.');
            this.mutate('Add native event trigger', (doc) => {
              const target = find(doc.root, id);
              let triggers = propertyChild(target, 'Triggers');
              if (!triggers) {
                triggers = element(target.type + '.Triggers');
                target.children.push(triggers);
              }
              let props;
              if (type === 'BeginStoryboard') {
                const existing = new Set();
                walk(doc.root, (n) => {
                  if (n.props?.['x:Name'] || n.props?.Name)
                    existing.add(n.props['x:Name'] || n.props.Name);
                });
                const stem = 'Begin' + key.replace(/[^A-Za-z0-9_]/g, '_');
                let name = stem,
                  i = 1;
                while (existing.has(name)) name = stem + i++;
                doc.root.props['xmlns:x'] ??= 'http://schemas.microsoft.com/winfx/2006/xaml';
                props = { 'x:Name': name, Storyboard: `{StaticResource ${key}}` };
              } else
                props = {
                  BeginStoryboardName: begin,
                  ...(type === 'SeekStoryboard' ? { Offset: offset, Origin: 'BeginTime' } : {}),
                };
              triggers.children.push(
                element('EventTrigger', { RoutedEvent: event }, [element(type, props)]),
              );
            });
            s.closeModal();
          },
        },
      ],
      true,
    );
    this.environment.all('[data-event-delete]').forEach((button) =>
      this.environment.handler(button, 'onclick', () => {
        this.mutate('Delete event trigger', (doc) => remove(doc.root, button.dataset.eventDelete));
        this.eventTrigger();
      }),
    );
  }
  path() {
    const node = this.selected();
    if (!node) return;
    if (!['Path', 'Rectangle', 'Ellipse'].includes(localName(node.type)))
      throw Error('Select a Path, Rectangle, or Ellipse to edit vector geometry.');
    const s = this.s,
      id = node.id,
      width = Number(node.props.Width) || 240,
      height = Number(node.props.Height) || 160;
    let commands = parsePath(
        localName(node.type) === 'Path'
          ? node.props.Data || 'M 0,0 L 120,0 L 120,80 Z'
          : shapeToPath(node),
      ),
      selectedPoint = null,
      tool = 'select';
    s.modal(
      'Vector path editor',
      `<div class="path-toolbar"><button class="button active" data-path-tool="select">Select points</button><button class="button" data-path-tool="line">Pen · line</button><button class="button" data-path-tool="curve">Pen · cubic</button><button class="button" id="path-close">Close subpath</button><button class="button" id="path-delete">Delete segment</button></div><svg id="vector-editor" class="vector-editor" viewBox="-20 -20 ${width + 40} ${height + 40}" aria-label="Editable vector geometry"></svg><label>Path data<textarea id="vector-path-data" spellcheck="false">${esc(serializePath(commands))}</textarea></label><p class="feature-help">Drag anchors and tangent handles. Pen clicks append line or cubic segments. Shift constrains point dragging to one axis. Conversion retains shared appearance and renames owned property elements.</p>`,
      [
        {
          label: 'Apply path',
          primary: true,
          run: () => {
            const data = serializePath(
              parsePath(this.environment.query('#vector-path-data').value),
            );
            this.mutate('Edit vector path', (doc) => {
              const target = find(doc.root, id),
                oldType = target.type;
              target.type = 'Path';
              for (const child of target.children)
                if (child.type?.startsWith(oldType + '.'))
                  child.type = 'Path.' + child.type.slice(oldType.length + 1);
              target.props.Data = data;
              delete target.props.RadiusX;
              delete target.props.RadiusY;
            });
            s.closeModal();
          },
        },
      ],
      true,
    );
    const render = () => {
      const points = pathPoints(commands),
        svg = this.environment.query('#vector-editor');
      svg.innerHTML = `<rect x="0" y="0" width="${width}" height="${height}" fill="var(--panel)" stroke="var(--border)"/><path d="${esc(serializePath(commands))}" fill="${esc(node.props.Fill || '#7953E833')}" stroke="${esc(node.props.Stroke || '#9471e8')}" stroke-width="${Number(node.props.StrokeThickness) || 2}"/>${points.map((point, index) => `<circle data-path-point="${index}" cx="${point.x}" cy="${point.y}" r="${point.control ? 3 : 4}" class="${point.control ? 'path-tangent' : 'path-anchor'} ${selectedPoint === index ? 'selected' : ''}"/>`).join('')}`;
      this.environment.query('#vector-path-data').value = serializePath(commands);
      this.environment.all('[data-path-point]', svg).forEach((handle) =>
        this.environment.handler(handle, 'onpointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const index = Number(handle.dataset.pathPoint),
            point = pathPoints(commands)[index],
            initial = { ...point };
          selectedPoint = index;
          const locate = (ev) => {
            const p = svg.createSVGPoint();
            p.x = ev.clientX;
            p.y = ev.clientY;
            return p.matrixTransform(svg.getScreenCTM().inverse());
          };
          const move = (ev) => {
            const p = locate(ev);
            if (ev.shiftKey) {
              if (Math.abs(p.x - initial.x) > Math.abs(p.y - initial.y)) p.y = initial.y;
              else p.x = initial.x;
            }
            commands = movePathPoint(
              commands,
              point,
              Math.round(p.x * 100) / 100,
              Math.round(p.y * 100) / 100,
            );
            render();
          };
          const end = () => {
            this.environment.unlisten(this.environment.document, 'pointermove', move);
            this.environment.unlisten(this.environment.document, 'pointerup', end);
            this.environment.unlisten(this.environment.document, 'pointercancel', end);
          };
          this.environment.listen(this.environment.document, 'pointermove', move);
          this.environment.listen(this.environment.document, 'pointerup', end, { once: true });
          this.environment.listen(this.environment.document, 'pointercancel', end, { once: true });
        }),
      );
    };
    render();
    this.environment.handler(this.environment.query('#vector-editor'), 'onpointerdown', (e) => {
      if (tool === 'select' || e.target.closest('[data-path-point]')) return;
      const svg = this.environment.query('#vector-editor'),
        p = svg.createSVGPoint();
      p.x = e.clientX;
      p.y = e.clientY;
      const point = p.matrixTransform(svg.getScreenCTM().inverse()),
        x = Math.round(point.x),
        y = Math.round(point.y),
        last = pathPoints(commands)
          .filter((p) => !p.control)
          .at(-1);
      if (!commands.length || commands.at(-1).type === 'Z')
        commands.push({ type: 'M', values: [x, y] });
      else if (tool === 'curve') {
        const previous = last || { x: 0, y: 0 };
        commands.push({
          type: 'C',
          values: [
            previous.x + (x - previous.x) / 3,
            previous.y,
            previous.x + ((x - previous.x) * 2) / 3,
            y,
            x,
            y,
          ],
        });
      } else commands.push({ type: 'L', values: [x, y] });
      render();
    });
    this.environment.all('[data-path-tool]').forEach((button) =>
      this.environment.handler(button, 'onclick', () => {
        tool = button.dataset.pathTool;
        this.environment
          .all('[data-path-tool]')
          .forEach((b) => b.classList.toggle('active', b === button));
      }),
    );
    this.environment.handler(this.environment.query('#path-close'), 'onclick', () => {
      if (commands.length && commands.at(-1).type !== 'Z') commands.push({ type: 'Z', values: [] });
      render();
    });
    this.environment.handler(this.environment.query('#path-delete'), 'onclick', () => {
      const point = pathPoints(commands)[selectedPoint];
      if (!point) return;
      commands.splice(point.command, 1);
      if (commands.length && commands[0].type !== 'M') {
        this.environment.notify('A path must begin with a move command.');
        commands = [];
      }
      selectedPoint = null;
      render();
    });
    this.environment.handler(this.environment.query('#vector-path-data'), 'onchange', () => {
      try {
        commands = parsePath(this.environment.query('#vector-path-data').value);
        render();
      } catch (error) {
        this.environment.notify(error.message);
      }
    });
  }
  dispose() {
    if (this.disposed) return;
    try {
      this.animation.dispose();
      this.stopStatePreview();
      this.previewRuntime?.dispose();
    } finally {
      super.dispose();
    }
  }
}
function parseDuration(value) {
  const parts = String(value).split(':').map(Number);
  if (parts.some((v) => !Number.isFinite(v))) return 0;
  return parts.reduce((sum, value) => sum * 60 + value, 0);
}
