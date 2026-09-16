import { findResource } from '../core/styling.js';
import { captureMotion, restoreMotion, patchMotion } from '../core/motion-render.js';
import { clone, find, element, localName, reidentify } from '../core/model.js';
import {
  definitions,
  writeDefinitions,
  insertTrack,
  removeTrack,
  isLocked,
} from '../core/design-tools.js';
import {
  fourValues,
  colorParts,
  argb,
  propertyObject,
  replaceObject,
  setLiteral,
} from '../core/authoring.js';
import { brushCSS } from '../core/appearance.js';
import {
  TRANSFORM_PATHS,
  ensureTransformPath,
  readPropertyPath,
  writePropertyPath,
} from '../core/property-path.js';
import { WorkspaceComponent, esc } from './workspace-context.js';
const colors = new Set(['Background', 'Foreground', 'Fill', 'Stroke', 'BorderBrush', 'Color']);
const numeric = new Set([
  'Width',
  'Height',
  'MinWidth',
  'MinHeight',
  'MaxWidth',
  'MaxHeight',
  'FontSize',
  'Opacity',
  'StrokeThickness',
  'RadiusX',
  'RadiusY',
  'Canvas.Left',
  'Canvas.Top',
  'Canvas.Right',
  'Canvas.Bottom',
  'Grid.Row',
  'Grid.Column',
  'Grid.RowSpan',
  'Grid.ColumnSpan',
]);
export class RichProperties extends WorkspaceComponent {
  /** @param {import('./workspace-context.js').ResourceWorkspaceHost} s
   * @param {import('./workspace-context.js').WorkspaceOptions} [workspaceOptions] */
  constructor(s, workspaceOptions = s.workspaceOptions) {
    super(workspaceOptions);
    try {
      this.s = s;
      this.editors = new Map();
      this.expanded = new Set(['brush', 'transforms']);
      this.linked = true;
      const render = s.renderInspector.bind(s);
      this.environment.override(s, 'renderInspector', () => {
        render();
        this.decorate();
      });
      const field = s.field.bind(s);
      this.environment.override(s, 'field', (key, title, value, options, full) => {
        let html = field(key, title, value, options, full);
        if (s.selected.length > 1) {
          const mixed = s.selected.some((n) => n.props[key] !== s.selected[0].props[key]);
          if (mixed)
            html = html
              .replace(/value="[^"]*"/, 'value=""')
              .replace(/placeholder="[^"]*"/, 'placeholder="Mixed"');
        }
        return html;
      });
      this.environment.override(this.environment.api, 'propertyEditors', {
        register: (name, create) => this.editors.set(name, create),
        unregister: (name) => this.editors.delete(name),
      });
    } catch (error) {
      try {
        this.environment.dispose();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'RichProperties initialization failed.');
      }
      throw error;
    }
  }
  commit(ids, key, value) {
    if (
      ['Background', 'Foreground', 'Fill', 'Stroke', 'BorderBrush'].includes(key) &&
      !String(value).startsWith('{') &&
      !this.s.blend.animation.record &&
      ids.some((id) =>
        propertyObject(find(this.s.doc.root, id), key)?.type.endsWith('SolidColorBrush'),
      )
    )
      return this.mutate('Set ' + key, (doc) =>
        ids.forEach((id) => {
          const n = find(doc.root, id),
            brush = propertyObject(n, key);
          if (brush?.type.endsWith('SolidColorBrush')) brush.props.Color = String(value);
          else setLiteral(n, key, value);
        }),
      );
    this.s.setProps(ids, key, value);
  }
  mutate(label, fn) {
    const s = this.s;
    if (!s.prepareEdit()) return;
    if (s.selected.some((n) => isLocked(s.doc, n.id))) {
      this.environment.notify('Unlock the selection before editing.');
      return;
    }
    try {
      s.store.transaction(label, fn);
    } catch (e) {
      this.environment.notify(e.message);
    }
  }
  decorate() {
    const s = this.s,
      host = s.inspectorHost('design'),
      node = s.selected[0];
    if (!node) return;
    const ids = [...s.store.selection];
    this.environment.all('[data-prop]', host).forEach((input) => {
      const key = input.dataset.prop,
        field = input.closest('.prop-field');
      if (!field || field.dataset.rich) return;
      field.dataset.rich = 'true';
      const descriptor = s.registry.get(node.type)?.properties?.find((p) => p.name === key);
      if (descriptor?.editor && this.editors.has(descriptor.editor)) {
        const editor = this.editors.get(descriptor.editor)({
          studio: s,
          node,
          ids,
          key,
          value: node.props[key],
          commit: (value) => this.commit(ids, key, value),
        });
        if (editor instanceof HTMLElement) {
          input.replaceWith(editor);
          return;
        }
      }
      if (numeric.has(key) || descriptor?.type === 'number') {
        input.inputMode = 'decimal';
        const label = this.environment.query('label', field);
        label.classList.add('scrub-label');
        label.title = 'Drag to change ' + key + '; Shift = fine; Escape cancels';
        this.environment.handler(label, 'onpointerdown', (e) =>
          this.scrub(e, ids, key, input.value),
        );
      }
      if (colors.has(key)) {
        const parts = colorParts(input.value),
          picker = this.environment.track(this.environment.document.createElement('input'));
        picker.type = 'color';
        picker.className = 'rich-color';
        picker.title = 'Choose ' + key;
        picker.value = parts?.rgb || '#2563eb';
        this.environment.handler(picker, 'onchange', (e) => {
          e.stopPropagation();
          this.commit(ids, key, argb(picker.value, parts?.alpha ?? 1));
        });
        field.insertBefore(picker, input);
        if (parts) {
          const alpha = this.environment.track(this.environment.document.createElement('input'));
          alpha.type = 'range';
          alpha.className = 'rich-alpha';
          alpha.min = '0';
          alpha.max = '1';
          alpha.step = '.01';
          alpha.value = parts.alpha;
          alpha.title = 'Color opacity';
          this.environment.handler(alpha, 'onchange', (e) => {
            e.stopPropagation();
            this.commit(ids, key, argb(picker.value, Number(alpha.value)));
          });
          field.append(alpha);
        }
      }
      if (['Margin', 'Padding', 'BorderThickness', 'CornerRadius'].includes(key)) {
        const values = fourValues(input.value);
        if (values) {
          const box = this.environment.track(this.environment.document.createElement('div'));
          box.className = 'rich-four';
          box.innerHTML = `${values.map((v, i) => `<label>${key === 'CornerRadius' ? ['↖', '↗', '↘', '↙'][i] : ['L', 'T', 'R', 'B'][i]}<input data-side="${i}" type="number" value="${v}" aria-label="${key} ${i + 1}"></label>`).join('')}<button type="button" class="${this.linked ? 'active' : ''}" title="Link all sides">${this.linked ? '🔗' : '⋯'}</button>`;
          this.environment.handler(box.querySelector('button'), 'onclick', () => {
            this.linked = !this.linked;
            this.s.renderInspector();
          });
          box.querySelectorAll('input').forEach((side) =>
            this.environment.handler(side, 'onchange', (e) => {
              e.stopPropagation();
              const next = [...values],
                v = Number(side.value);
              if (!Number.isFinite(v)) return;
              if (this.linked) next.fill(v);
              else next[Number(side.dataset.side)] = v;
              this.commit(
                ids,
                key,
                next.every((v) => v === next[0]) ? String(next[0]) : next.join(','),
              );
            }),
          );
          field.append(box);
          field.classList.add('full');
        }
      }
      if (
        input.tagName === 'SELECT' &&
        [
          'HorizontalAlignment',
          'VerticalAlignment',
          'Orientation',
          'FontWeight',
          'TextAlignment',
          'Stretch',
        ].includes(key)
      ) {
        const buttons = this.environment.track(this.environment.document.createElement('div'));
        buttons.className = 'rich-segments';
        [...input.options]
          .filter((o) => o.value)
          .forEach((option) => {
            const b = this.environment.track(this.environment.document.createElement('button'));
            b.textContent = option.textContent;
            b.classList.toggle('active', option.value === input.value);
            this.environment.handler(b, 'onclick', () => this.commit(ids, key, option.value));
            buttons.append(b);
          });
        field.append(buttons);
        field.classList.add('full');
      }
      if (String(input.value).startsWith('{')) {
        const badge = this.environment.track(this.environment.document.createElement('button'));
        badge.className = 'rich-expression';
        badge.textContent = input.value.startsWith('{Binding') ? 'Binding' : 'Resource';
        this.environment.handler(badge, 'onclick', () =>
          s.docking.control.show(input.value.startsWith('{Binding') ? 'data' : 'assets'),
        );
        field.append(badge);
      }
    });
    const extras = this.environment.track(this.environment.document.createElement('section'));
    extras.className = 'rich-editors';
    extras.innerHTML = `<details data-rich-section="brush" ${this.expanded.has('brush') ? 'open' : ''}><summary>Brush & gradient</summary><div class="rich-brush-body"></div></details><details data-rich-section="transforms" ${this.expanded.has('transforms') ? 'open' : ''}><summary>Transform & origin</summary><div class="rich-transforms"></div></details><details data-rich-section="effects" ${this.expanded.has('effects') ? 'open' : ''}><summary>Effects</summary><div class="rich-effects"></div></details>`;
    host.append(extras);
    this.environment
      .all('details', extras)
      .forEach((detail) =>
        this.environment.handler(detail, 'ontoggle', () =>
          detail.open
            ? this.expanded.add(detail.dataset.richSection)
            : this.expanded.delete(detail.dataset.richSection),
        ),
      );
    this.brush(this.environment.query('.rich-brush-body', extras), node, ids);
    this.transforms(this.environment.query('.rich-transforms', extras), node, ids);
    this.effects(this.environment.query('.rich-effects', extras), node, ids);
    if (localName(node.type) === 'Style') this.style(host, node);
    if (localName(node.type) === 'Grid') this.grid(host, node);
  }
  scrub(e, ids, key, value) {
    if (e.button !== 0 || !String(value).trim() || !Number.isFinite(Number(value))) return;
    const s = this.s;
    if (!s.prepareEdit() || ids.some((id) => isLocked(s.doc, id))) return;
    e.preventDefault();
    const before = clone(s.doc),
      baselines = captureMotion(s.renderer);
    let next = Number(value),
      changed = false;
    const record = s.blend.animation.record;
    s.blend.animation.player.pause();
    s.direct.gesture(
      e,
      (ev) => {
        changed = true;
        const step = key === 'Opacity' ? 0.01 : ev.shiftKey ? 0.1 : 1;
        next = Number(value) + (ev.clientX - e.clientX) * step;
        if (key === 'Opacity') next = Math.min(1, Math.max(0, next));
        if (['Width', 'Height', 'FontSize', 'StrokeThickness'].includes(key))
          next = Math.max(0, next);
        next = Math.round(next * 1000) / 1000;
        patchMotion(s.renderer, before, new Map(ids.map((id) => [id, { [key]: next }])), baselines);
        s.drawSelection();
      },
      (cancel) => {
        restoreMotion(s.renderer, baselines);
        if (changed && !cancel) {
          if (record)
            s.blend.animation.recordBatch(
              ids.map((id) => ({ id, path: key, value: next })),
              'Scrub ' + key,
            );
          else
            s.store.transaction('Scrub ' + key, (doc) =>
              ids.forEach((id) => setLiteral(find(doc.root, id), key, next)),
            );
        } else {
          s.blend.animation.frame();
          s.drawSelection();
        }
      },
    );
  }

  brush(host, node, ids) {
    const property =
        this.brushProperty ||
        (['Rectangle', 'Ellipse', 'Path', 'Line'].includes(localName(node.type))
          ? 'Fill'
          : 'Background'),
      brush = propertyObject(node, property),
      type = localName(brush?.type || 'SolidColorBrush'),
      kind =
        type === 'LinearGradientBrush'
          ? 'Linear'
          : type === 'RadialGradientBrush'
            ? 'Radial'
            : 'Solid',
      stops = (brush?.children || [])
        .flatMap((n) => (n.type?.endsWith('.GradientStops') ? n.children : [n]))
        .filter((n) => localName(n.type || '') === 'GradientStop');
    host.innerHTML = `<div class="rich-row"><select data-brush-prop aria-label="Brush property">${['Background', 'Foreground', 'Fill', 'Stroke', 'BorderBrush'].map((p) => `<option ${p === property ? 'selected' : ''}>${p}</option>`).join('')}</select><select data-brush-kind aria-label="Brush type">${['Solid', 'Linear', 'Radial'].map((p) => `<option ${p === kind ? 'selected' : ''}>${p}</option>`).join('')}</select><button data-brush-resource title="Show reusable resources">◇</button></div><div class="rich-ramp"></div>${kind === 'Solid' ? `<input data-brush-color value="${esc(brush?.props.Color || node.props[property] || '#2563EB')}" aria-label="Brush color">` : `<div class="rich-stops">${stops.map((stop, i) => `<div><input type="color" data-stop-color="${stop.id}" value="${colorParts(stop.props.Color)?.rgb || '#2563eb'}" aria-label="Stop color"><input type="number" data-stop-offset="${stop.id}" min="0" max="1" step=".01" value="${esc(stop.props.Offset)}" aria-label="Stop offset"><button data-stop-remove="${stop.id}" ${stops.length < 3 ? 'disabled' : ''}>×</button></div>`).join('')}</div><button data-stop-add>+ Gradient stop</button>`}<label class="rich-label">Opacity<input data-brush-opacity type="range" min="0" max="1" step=".01" value="${esc(brush?.props.Opacity || 1)}"></label>${kind === 'Linear' ? `<div class="rich-row"><label>Start<input data-brush-point="StartPoint" value="${esc(brush?.props.StartPoint || '0,0')}"></label><label>End<input data-brush-point="EndPoint" value="${esc(brush?.props.EndPoint || '1,1')}"></label></div>` : ''}`;
    this.environment.query('.rich-ramp', host).style.background = brush
      ? brushCSS(brush)
      : colorParts(node.props[property])?.rgb || 'transparent';
    this.environment.handler(this.environment.query('[data-brush-prop]', host), 'onchange', (e) => {
      this.brushProperty = e.target.value;
      this.s.renderInspector();
    });
    this.environment.handler(this.environment.query('[data-brush-resource]', host), 'onclick', () =>
      this.s.docking.control.show('assets'),
    );
    this.environment.handler(this.environment.query('[data-brush-kind]', host), 'onchange', (e) =>
      this.mutate('Change brush type', (doc) =>
        ids.forEach((id) => {
          const target = find(doc.root, id),
            kind = e.target.value;
          replaceObject(
            target,
            property,
            kind === 'Solid'
              ? element('SolidColorBrush', {
                  Color: colorParts(target.props[property])?.rgb || '#2563EB',
                })
              : element(
                  kind + 'GradientBrush',
                  kind === 'Linear'
                    ? { StartPoint: '0,0', EndPoint: '1,1' }
                    : {
                        Center: '0.5,0.5',
                        GradientOrigin: '0.5,0.5',
                        RadiusX: '.5',
                        RadiusY: '.5',
                      },
                  [
                    element('GradientStop', { Color: '#2563EB', Offset: '0' }),
                    element('GradientStop', { Color: '#7C3AED', Offset: '1' }),
                  ],
                ),
          );
        }),
      ),
    );
    this.environment.listen(this.environment.query('[data-brush-color]', host), 'change', (e) => {
      if (this.s.blend.animation.record)
        this.s.blend.animation.recordBatch(
          ids.map((id) => ({ id, path: property, value: e.target.value })),
          'Record brush color',
        );
      else edit('Brush color', (b) => (b.props.Color = e.target.value));
    });
    const edit = (title, fn) =>
      this.mutate(title, (doc) =>
        ids.forEach((id) => {
          const target = find(doc.root, id);
          let b = propertyObject(target, property);
          if (!b) {
            const value = target.props[property] || '#2563EB',
              key = String(value).match(/^\{(?:StaticResource|DynamicResource)\s+([^}]+)\}$/)?.[1],
              resource = key && findResource(doc, target, key, this.s.solution.resolve);
            if (resource && /Brush$/.test(localName(resource.type))) {
              b = reidentify(resource);
              delete b.props['x:Key'];
            } else {
              if (String(value).startsWith('{') && !resource)
                throw Error('Edit this brush binding before changing its local opacity.');
              b = element('SolidColorBrush', { Color: value });
            }
            replaceObject(target, property, b);
          }
          fn(b);
        }),
      );
    this.environment.handler(
      this.environment.query('[data-brush-opacity]', host),
      'onchange',
      (e) => edit('Brush opacity', (b) => (b.props.Opacity = e.target.value)),
    );
    this.environment.all('[data-brush-point]', host).forEach((input) =>
      this.environment.handler(input, 'onchange', () => {
        if (!/^\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*$/.test(input.value)) {
          this.environment.notify('Enter two coordinates, such as 0,1.');
          return;
        }
        edit('Gradient direction', (b) => (b.props[input.dataset.brushPoint] = input.value));
      }),
    );
    const stopEdit = (id, title, fn) =>
      this.mutate(title, (doc) => {
        const stop = find(doc.root, id);
        if (stop) fn(stop, doc);
      });
    this.environment
      .all('[data-stop-color]', host)
      .forEach((input) =>
        this.environment.handler(input, 'onchange', () =>
          stopEdit(
            input.dataset.stopColor,
            'Gradient color',
            (stop) =>
              (stop.props.Color = argb(input.value, colorParts(stop.props.Color)?.alpha ?? 1)),
          ),
        ),
      );
    this.environment.all('[data-stop-offset]', host).forEach((input) =>
      this.environment.handler(input, 'onchange', () => {
        const value = Number(input.value);
        if (value >= 0 && value <= 1)
          stopEdit(
            input.dataset.stopOffset,
            'Gradient stop',
            (stop) => (stop.props.Offset = String(value)),
          );
      }),
    );
    this.environment.all('[data-stop-remove]', host).forEach((b) =>
      this.environment.handler(b, 'onclick', () =>
        edit('Remove gradient stop', (brush) => {
          const holder = brush.children.find((n) => n.type?.endsWith('.GradientStops')) || brush;
          holder.children = holder.children.filter((n) => n.id !== b.dataset.stopRemove);
        }),
      ),
    );
    this.environment.listen(this.environment.query('[data-stop-add]', host), 'click', () =>
      edit('Add gradient stop', (brush) => {
        const holder = brush.children.find((n) => n.type?.endsWith('.GradientStops')) || brush;
        holder.children.push(element('GradientStop', { Color: '#FFFFFF', Offset: '.5' }));
      }),
    );
    const ramp = this.environment.query('.rich-ramp', host);
    if (stops.length) {
      for (const stop of stops) {
        const handle = this.environment.track(this.environment.document.createElement('button'));
        handle.className = 'gradient-handle';
        handle.style.left = Number(stop.props.Offset) * 100 + '%';
        handle.style.background = colorParts(stop.props.Color)?.rgb || '#fff';
        handle.title = 'Drag gradient stop';
        ramp.append(handle);
        this.environment.handler(handle, 'onpointerdown', (e) => {
          e.preventDefault();
          const rect = ramp.getBoundingClientRect();
          let value = Number(stop.props.Offset);
          this.s.direct.gesture(
            e,
            (ev) => {
              value = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
              handle.style.left = value * 100 + '%';
              const draft = clone(brush);
              find(draft, stop.id).props.Offset = String(value);
              ramp.style.background = brushCSS(draft);
            },
            (cancel) => {
              if (!cancel)
                stopEdit(
                  stop.id,
                  'Move gradient stop',
                  (n) => (n.props.Offset = String(Math.round(value * 1000) / 1000)),
                );
              else this.s.renderInspector();
            },
          );
        });
      }
    }
  }
  transforms(host, node, ids) {
    const doc = clone(this.s.doc),
      target = find(doc.root, node.id),
      keys = ['X', 'Y', 'Angle', 'ScaleX', 'ScaleY', 'SkewX', 'SkewY'];
    host.innerHTML = `<div class="rich-transform-grid">${keys
      .map((key) => {
        const path = ensureTransformPath(doc, target, TRANSFORM_PATHS[key]),
          value = readPropertyPath(doc, target, path);
        return `<label>${key}<input data-transform="${key}" type="number" step="${key.startsWith('Scale') ? '.01' : '1'}" value="${esc(value)}"></label>`;
      })
      .join(
        '',
      )}</div><div class="rich-origin" aria-label="Transform origin">${[0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => `<button data-origin="${x},${y}" title="Origin ${x}, ${y}" class="${(node.props.RenderTransformOrigin || '0,0') === `${x},${y}` ? 'active' : ''}">•</button>`)).join('')}</div><button data-transform-reset>Reset transform</button>`;
    this.environment.all('[data-transform]', host).forEach((input) =>
      this.environment.handler(input, 'onchange', () => {
        const value = Number(input.value),
          key = input.dataset.transform;
        if (!Number.isFinite(value)) return;
        if (this.s.blend.animation.record)
          this.s.blend.animation.recordBatch(
            ids.map((id) => ({ id, path: TRANSFORM_PATHS[key], value })),
            'Record transform',
          );
        else
          this.mutate('Set ' + key, (doc) =>
            ids.forEach((id) => {
              const target = find(doc.root, id),
                path = ensureTransformPath(doc, target, TRANSFORM_PATHS[key]);
              writePropertyPath(doc, target, path, value);
            }),
          );
      }),
    );
    this.environment
      .all('[data-origin]', host)
      .forEach((b) =>
        this.environment.handler(b, 'onclick', () =>
          this.commit(ids, 'RenderTransformOrigin', b.dataset.origin),
        ),
      );
    this.environment.handler(
      this.environment.query('[data-transform-reset]', host),
      'onclick',
      () =>
        this.mutate('Reset transforms', (doc) =>
          ids.forEach((id) => {
            const n = find(doc.root, id);
            replaceObject(n, 'RenderTransform', null);
            delete n.props.RenderTransformOrigin;
          }),
        ),
    );
  }
  effects(host, node, ids) {
    const effect = propertyObject(node, 'Effect'),
      type = localName(effect?.type || 'None');
    host.innerHTML = `<select data-effect-type aria-label="Effect">${['None', 'DropShadowEffect', 'BlurEffect'].map((t) => `<option ${t === type ? 'selected' : ''}>${t}</option>`).join('')}</select>${type !== 'None' ? `<div class="rich-transform-grid">${(type === 'BlurEffect' ? ['Radius'] : ['BlurRadius', 'ShadowDepth', 'Direction', 'Opacity', 'Color']).map((key) => `<label>${key}<input data-effect-prop="${key}" value="${esc(effect.props[key] || { BlurRadius: 12, Radius: 5, ShadowDepth: 4, Direction: 315, Opacity: 0.25, Color: '#000000' }[key])}"></label>`).join('')}</div>` : ''}`;
    this.environment.handler(this.environment.query('[data-effect-type]', host), 'onchange', (e) =>
      this.mutate('Change effect', (doc) =>
        ids.forEach((id) =>
          replaceObject(
            find(doc.root, id),
            'Effect',
            e.target.value === 'None' ? null : element(e.target.value),
          ),
        ),
      ),
    );
    this.environment.all('[data-effect-prop]', host).forEach((input) =>
      this.environment.handler(input, 'onchange', () =>
        this.mutate('Edit effect', (doc) => {
          const key = input.dataset.effectProp;
          if (key !== 'Color' && !Number.isFinite(Number(input.value)))
            throw Error('Enter a number.');
          if (key === 'Opacity' && (Number(input.value) < 0 || Number(input.value) > 1))
            throw Error('Opacity must be from 0 to 1.');
          ids.forEach(
            (id) => (propertyObject(find(doc.root, id), 'Effect').props[key] = input.value),
          );
        }),
      ),
    );
  }
  style(host, node) {
    const section = this.environment.track(this.environment.document.createElement('section'));
    section.className = 'panel-section';
    const setters = node.children.filter(
      (n) => localName(n.type || '') === 'Setter' && n.props.Value !== undefined,
    );
    section.innerHTML = `<h4>Style setters</h4>${setters.map((n) => `<div class="rich-row"><input data-setter-property="${n.id}" value="${esc(n.props.Property)}" aria-label="Setter property"><input data-setter-value="${n.id}" value="${esc(n.props.Value)}" aria-label="Setter value"><button data-setter-delete="${n.id}">×</button></div>`).join('')}<button data-setter-add>+ Setter</button>`;
    host.append(section);
    this.environment.all('[data-setter-property],[data-setter-value]', section).forEach((input) =>
      this.environment.handler(input, 'onchange', () =>
        this.mutate('Edit style setter', (doc) => {
          const n = find(doc.root, input.dataset.setterProperty || input.dataset.setterValue);
          n.props[input.dataset.setterProperty ? 'Property' : 'Value'] = input.value;
        }),
      ),
    );
    this.environment.all('[data-setter-delete]', section).forEach((b) =>
      this.environment.handler(b, 'onclick', () =>
        this.mutate('Remove style setter', (doc) => {
          const style = find(doc.root, node.id);
          style.children = style.children.filter((n) => n.id !== b.dataset.setterDelete);
        }),
      ),
    );
    this.environment.handler(this.environment.query('[data-setter-add]', section), 'onclick', () =>
      this.mutate('Add style setter', (doc) =>
        find(doc.root, node.id).children.push(
          element('Setter', { Property: 'Opacity', Value: '1' }),
        ),
      ),
    );
  }
  grid(host, node) {
    const section = this.environment.track(this.environment.document.createElement('section'));
    section.className = 'panel-section';
    section.innerHTML = `<h4>Grid tracks</h4>${['Row', 'Column']
      .map(
        (axis) =>
          `<div class="rich-grid-tracks"><strong>${axis}s</strong>${definitions(node, axis)
            .map(
              (d, i) =>
                `<div class="rich-row"><span>${i}</span><input data-grid-axis="${axis}" data-grid-index="${i}" value="${esc(d.props[axis === 'Row' ? 'Height' : 'Width'] || '*')}" aria-label="${axis} ${i} size"><button data-grid-delete="${i}" data-axis="${axis}" title="Delete track">×</button></div>`,
            )
            .join('')}<button data-grid-add="${axis}">+ ${axis}</button></div>`,
      )
      .join('')}`;
    host.append(section);
    this.environment.all('[data-grid-axis]', section).forEach((input) =>
      this.environment.handler(input, 'onchange', () => {
        const value = input.value.trim(),
          axis = input.dataset.gridAxis;
        if (!/^(Auto|(?:\d*\.?\d+)?\*|\d+(?:\.\d+)?)$/.test(value)) {
          this.environment.notify('Use Auto, a pixel value, or star units.');
          return;
        }
        this.mutate('Edit grid track', (doc) => {
          const target = find(doc.root, node.id),
            defs = definitions(target, axis);
          defs[Number(input.dataset.gridIndex)].props[axis === 'Row' ? 'Height' : 'Width'] = value;
          writeDefinitions(target, axis, defs);
        });
      }),
    );
    this.environment.all('[data-grid-add]', section).forEach((b) =>
      this.environment.handler(b, 'onclick', () =>
        this.mutate('Add grid track', (doc) => {
          const target = find(doc.root, node.id);
          insertTrack(target, b.dataset.gridAdd, definitions(target, b.dataset.gridAdd).length);
        }),
      ),
    );
    this.environment
      .all('[data-grid-delete]', section)
      .forEach((b) =>
        this.environment.handler(b, 'onclick', () =>
          this.mutate('Delete grid track', (doc) =>
            removeTrack(find(doc.root, node.id), b.dataset.axis, Number(b.dataset.gridDelete)),
          ),
        ),
      );
  }
  dispose() {
    if (this.disposed) return;
    try {
      this.editors.clear();
    } finally {
      super.dispose();
    }
  }
}
