import { recordProperties } from '../core/timeline-editing.js';
import { find, parentOf, clone, label, localName, walk } from '../core/model.js';
import { isLocked } from '../core/design-tools.js';
import {
  ANIMATION_PROPERTIES,
  EASINGS,
  AnimationPlayer,
  createStoryboard,
  addTrack,
  setKeyframe,
  listStoryboards,
  storyboardTracks,
  sampleStoryboard,
  parseTime,
  formatTime,
  simpleDuration,
  activeDuration,
  ease,
  splineProgress,
} from '../core/animation.js';
import { readPropertyPath } from '../core/property-path.js';
import {
  motionDocument,
  motionBase,
  captureMotion,
  restoreMotion,
  patchMotion,
} from '../core/motion-render.js';
import { WorkspaceComponent, esc, field, select } from './workspace-context.js';

const safeNumber = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const byId = (doc, id) => id && find(doc.root, id);
const names = (values) =>
  values
    .map((value) => (typeof value === 'string' ? value : value.name || value.property))
    .filter(Boolean);
const removeNode = (doc, id) => {
  const p = parentOf(doc.root, id);
  if (p) p.children = p.children.filter((n) => n.id !== id);
};

/** Docked authoring for native Storyboards. Playback never commits document properties. */
export class AnimationEditor extends WorkspaceComponent {
  /** @param {import('./workspace-context.js').MotionWorkspaceHost} studio
   * @param {import('./workspace-context.js').WorkspaceOptions} [workspaceOptions] */
  constructor(studio, workspaceOptions = studio.workspaceOptions) {
    super(workspaceOptions);
    try {
      this.s = studio;
      this.open = false;
      this.record = false;
      this.previewing = false;
      this.storyId = null;
      this.trackId = null;
      this.baselines = null;
      this.documentId = studio.doc.id;
      this.player = new AnimationPlayer({
        duration: 3,
        now: () => this.environment.window.performance.now(),
        schedule: (callback) => this.environment.frame(callback),
        cancel: (id) => this.environment.cancelFrame(id),
      });
      this.environment.listen(this.player, 'frame', () => this.frame());
      for (const event of ['play', 'pause', 'ended'])
        this.environment.listen(this.player, event, () => this.updateTransport());
      const canvas = studio.renderCanvas.bind(studio);
      this.environment.override(studio, 'renderCanvas', () => {
        canvas();
        if (this.documentId !== studio.doc.id) {
          this.player.pause();
          this.documentId = studio.doc.id;
          this.storyId = null;
          this.trackId = null;
          this.previewing = false;
          this.record = false;
        }
        this.capture();
        if (this.previewing) this.frame();
        this.render();
      });
      const setProps = studio.setProps.bind(studio);
      this.environment.override(studio, 'setProps', (ids, key, value) => {
        if (this.record && this.open && !key.startsWith('$') && value !== null) {
          if (this.recordValues(ids, key, value)) return;
        }
        return setProps(ids, key, value);
      });
      const propertyChanged = studio.propertyChanged.bind(studio);
      this.environment.override(studio, 'propertyChanged', (event) => {
        const input = event.target,
          key = input.dataset?.prop;
        if (this.record && this.open && key && !key.startsWith('$')) {
          const value =
            input.type === 'checkbox' ? (input.checked ? 'True' : 'False') : input.value;
          if (this.recordValues(studio.store.selection, key, value)) return;
        }
        return propertyChanged(event);
      });
      this.capture();
    } catch (error) {
      try {
        this.environment.dispose();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'AnimationEditor initialization failed.');
      }
      throw error;
    }
  }
  get story() {
    return byId(this.s.doc, this.storyId);
  }
  get tracks() {
    return this.story
      ? storyboardTracks(this.s.doc, this.story, { nameScopeId: this.s.scopeId || undefined })
      : [];
  }
  get track() {
    return this.tracks.find((t) => t.id === this.trackId) || null;
  }
  get duration() {
    if (!this.story) return 3;
    const value =
      activeDuration(this.story) / (Number(this.story.props.SpeedRatio) || 1) +
      parseTime(this.story.props.BeginTime);
    return Number.isFinite(value) && value > 0
      ? value
      : Math.max(3, ...this.tracks.map((t) => (Number.isFinite(t.duration) ? t.duration : 3)));
  }
  toggle() {
    if (this.s.docking) {
      this.s.docking.toggleTimeline();
      return;
    }
    if (this.open) {
      this.stop();
      this.open = false;
      this.environment.query('#animation-panel')?.remove();
    } else this.show();
  }
  show(id) {
    if (!this.s.prepareEdit()) return;
    if (this.s.docking && !this.s.docking.refreshing) this.s.docking.showTimeline();
    this.open = true;
    if (id) this.storyId = id;
    if (!this.story) this.storyId = listStoryboards(this.s.doc)[0]?.id || null;
    this.player.duration = this.duration;
    this.render();
  }
  capture() {
    this.baselines = captureMotion(this.s.renderer);
    this.base = motionBase(this.s.renderer, motionDocument(this.s.renderer) || this.s.doc);
  }
  restore() {
    if (this.baselines) restoreMotion(this.s.renderer, this.baselines);
    this.s.drawSelection();
  }
  stop() {
    this.previewing = false;
    this.record = false;
    this.player.stop();
    this.restore();
    this.updateTransport();
  }
  frame() {
    if (!this.open || !this.story || !this.previewing) return;
    try {
      this.restore();
      const doc = motionDocument(this.s.renderer) || this.s.doc;
      const sample = sampleStoryboard(
        doc,
        byId(doc, this.storyId) || this.story,
        this.player.time,
        { baseDocument: this.base || doc, nameScopeId: this.s.scopeId || undefined },
      );
      patchMotion(this.s.renderer, doc, sample.overrides || sample.values, this.baselines);
      this.s.drawSelection();
      const status = this.environment.query('#motion-status');
      if (status)
        status.textContent =
          sample.warnings?.join(' · ') || 'Preview values are separate from authored values.';
    } catch (error) {
      this.player.pause();
      const status = this.environment.query('#motion-status');
      if (status) status.textContent = error.message;
    }
    this.updateTransport();
  }
  seek(time) {
    this.previewing = true;
    this.player.seek(Math.max(0, Math.min(this.duration, time)));
    this.frame();
  }
  mutate(title, action) {
    if (!this.s.prepareEdit()) return false;
    this.player.pause();
    try {
      this.s.store.transaction(title, action);
      return true;
    } catch (error) {
      this.environment.notify(error.message);
      return false;
    }
  }
  recordValues(ids, key, value) {
    if (!this.story) return false;
    if (ids.some((id) => isLocked(this.s.doc, id))) {
      this.environment.notify('Unlock the layer before recording its properties.');
      return true;
    }
    const allowed = names(ANIMATION_PROPERTIES);
    let property = key;
    if (
      ['Background', 'Foreground', 'Fill', 'Stroke', 'BorderBrush'].includes(key) &&
      !String(value).startsWith('{')
    )
      property = `(${key}).(SolidColorBrush.Color)`;
    if (
      !allowed.includes(key) &&
      !allowed.includes(property) &&
      !['Background', 'Foreground', 'Fill', 'Stroke', 'BorderBrush'].includes(key)
    )
      return false;
    if (String(value).startsWith('{')) {
      this.environment.notify('Record a literal value. Bindings remain authored base values.');
      return true;
    }
    this.recordBatch(
      ids.map((id) => ({ id, path: key, value })),
      `Record ${key}`,
    );
    return true;
  }
  recordBatch(changes, title = 'Record canvas properties') {
    if (!this.story) {
      this.environment.notify('Select a Storyboard before recording.');
      return false;
    }
    if (changes.some((c) => isLocked(this.s.doc, c.id))) {
      this.environment.notify('Unlock the layer before recording.');
      return false;
    }
    const base = clone(this.base || this.s.doc),
      storyId = this.storyId,
      time = this.player.time;
    const ok = this.mutate(title, (doc) => {
      const ids = recordProperties(doc, storyId, changes, time, { baseDocument: base });
      this.trackId = ids.at(-1);
    });
    if (ok) {
      this.previewing = true;
      this.frame();
    }
    return ok;
  }

  render() {
    if (!this.open) return;
    let panel = this.environment.query('#animation-panel');
    if (!panel) {
      panel = this.environment.track(this.environment.document.createElement('section'));
      panel.id = 'animation-panel';
      panel.className = 'motion-panel';
      this.environment.own(panel);
      (this.s.docking?.timelineHost || this.environment.query('.center')).append(panel);
    }
    const stories = listStoryboards(this.s.doc),
      tracks = this.tracks,
      duration = this.duration;
    if (this.story && !tracks.some((t) => t.id === this.trackId))
      this.trackId = tracks[0]?.id || null;
    this.player.duration = duration;
    panel.innerHTML = `<header class="motion-toolbar"><strong>Objects & timeline</strong><select id="motion-story" aria-label="Storyboard">${stories.length ? stories.map((story) => `<option value="${story.id}" ${story.id === this.storyId ? 'selected' : ''}>${esc(story.name)}</option>`).join('') : '<option value="">No Storyboards</option>'}</select><button id="motion-new" title="New Storyboard">＋</button><button id="motion-settings" ${this.story ? '' : 'disabled'} title="Timing and name">⚙</button><span class="spacer"></span><button id="motion-record" aria-pressed="${this.record}" ${this.story ? '' : 'disabled'} title="Record inspector values into keyframes">● Record</button><button id="motion-close" aria-label="Close timeline">×</button></header><div class="motion-transport"><button id="motion-play" ${this.story ? '' : 'disabled'}>${this.player.playing ? 'Ⅱ' : '▶'} ${this.player.playing ? 'Pause' : 'Play'}</button><button id="motion-stop">■ Stop</button><label class="motion-time-label"><input id="motion-time" type="number" min="0" max="${duration}" step="0.01" value="${Number(this.player.time.toFixed(3))}"> s</label><label><input id="motion-loop" type="checkbox" ${this.player.loop ? 'checked' : ''}> Loop preview</label><select id="motion-rate" aria-label="Playback speed">${[0.25, 0.5, 1, 1.5, 2].map((rate) => `<option value="${rate}" ${rate === this.player.rate ? 'selected' : ''}>${rate}×</option>`).join('')}</select><span class="spacer"></span><button id="motion-add-track" ${this.story ? '' : 'disabled'}>＋ Property</button><button id="motion-add-key" ${this.track ? '' : 'disabled'}>◇ Keyframe</button></div><div class="motion-track-area"><div class="motion-ruler"><span>Target / property</span><div id="motion-ruler-track" role="slider" aria-label="Playhead" aria-valuemin="0" aria-valuemax="${duration}" aria-valuenow="${this.player.time}" tabindex="0">${Array.from({ length: 11 }, (_, i) => `<i style="left:${i * 10}%"><b>${((duration * i) / 10).toFixed(duration < 2 ? 2 : 1)}s</b></i>`).join('')}<em class="motion-playhead" style="left:${(this.player.time / duration) * 100}%"></em></div></div>${tracks.map((track) => `<div class="motion-track ${track.id === this.trackId ? 'selected' : ''}" data-track-row="${track.id}"><button class="motion-track-label" data-track-select="${track.id}" title="${esc(track.property)}"><strong>${esc(track.targetName || label(byId(this.s.doc, track.targetId)) || 'Missing target')}</strong><small>${esc(track.property)}</small></button><div class="motion-key-lane" data-track-lane="${track.id}">${track.frames.map((frame) => `<button class="motion-key ${frame.id === this.keyId ? 'selected' : ''}" data-key-track="${track.id}" data-key-id="${frame.id}" style="left:${Math.min(100, (frame.time / duration) * 100)}%" title="${frame.time.toFixed(3)}s · ${esc(frame.value)} · ${esc(frame.mode || frame.kind || 'Linear')}">◆</button>`).join('')}<em class="motion-playhead" style="left:${(this.player.time / duration) * 100}%"></em></div></div>`).join('') || '<div class="motion-empty">Create a Storyboard, select a layer, then add an animated property. Record captures inspector values at the playhead. Canvas gestures continue to edit base layout.</div>'}</div><footer id="motion-status">${this.record ? 'Recording inspector values at the playhead.' : 'Preview values are separate from authored values.'}</footer>`;
    this.environment.handler(this.environment.query('#motion-new'), 'onclick', () =>
      this.newStoryboard(),
    );
    this.environment.handler(this.environment.query('#motion-settings'), 'onclick', () =>
      this.settings(),
    );
    this.environment.handler(this.environment.query('#motion-close'), 'onclick', () =>
      this.toggle(),
    );
    this.environment.handler(this.environment.query('#motion-story'), 'onchange', (e) => {
      this.stop();
      this.storyId = e.target.value;
      this.trackId = null;
      this.render();
    });
    this.environment.handler(this.environment.query('#motion-record'), 'onclick', () => {
      this.record = !this.record;
      this.previewing = this.record || this.previewing;
      this.updateTransport();
    });
    this.environment.handler(this.environment.query('#motion-play'), 'onclick', () => {
      if (this.player.playing) this.player.pause();
      else {
        this.previewing = true;
        if (this.player.time >= duration) this.player.seek(0);
        this.player.play();
      }
      this.updateTransport();
    });
    this.environment.handler(this.environment.query('#motion-stop'), 'onclick', () => this.stop());
    this.environment.handler(this.environment.query('#motion-time'), 'onchange', (e) =>
      this.seek(safeNumber(e.target.value)),
    );
    this.environment.handler(
      this.environment.query('#motion-loop'),
      'onchange',
      (e) => (this.player.loop = e.target.checked),
    );
    this.environment.handler(
      this.environment.query('#motion-rate'),
      'onchange',
      (e) => (this.player.rate = Number(e.target.value)),
    );
    this.environment.handler(this.environment.query('#motion-add-track'), 'onclick', () =>
      this.addTrackDialog(),
    );
    this.environment.handler(this.environment.query('#motion-add-key'), 'onclick', () =>
      this.keyDialog(),
    );
    const ruler = this.environment.query('#motion-ruler-track');
    this.environment.handler(ruler, 'onpointerdown', (e) => {
      const rect = ruler.getBoundingClientRect();
      const move = (event) => this.seek(((event.clientX - rect.left) / rect.width) * duration);
      const end = () => {
        this.environment.unlisten(this.environment.document, 'pointermove', move);
        this.environment.unlisten(this.environment.document, 'pointerup', end);
        this.environment.unlisten(this.environment.document, 'pointercancel', end);
      };
      move(e);
      this.environment.listen(this.environment.document, 'pointermove', move);
      this.environment.listen(this.environment.document, 'pointerup', end, { once: true });
      this.environment.listen(this.environment.document, 'pointercancel', end, { once: true });
    });
    this.environment.handler(ruler, 'onkeydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        this.seek(this.player.time + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.01));
      }
    });
    this.environment.all('[data-track-select]', panel).forEach((button) =>
      this.environment.handler(button, 'onclick', () => {
        this.trackId = button.dataset.trackSelect;
        const track = this.track;
        if (track?.targetId) this.s.store.select([track.targetId]);
        this.render();
      }),
    );
    this.environment.all('[data-track-lane]', panel).forEach((lane) =>
      this.environment.handler(lane, 'ondblclick', (e) => {
        if (e.target.closest('[data-key-id]')) return;
        this.trackId = lane.dataset.trackLane;
        const rect = lane.getBoundingClientRect();
        this.seek(((e.clientX - rect.left) / rect.width) * duration);
        this.keyDialog();
      }),
    );
    this.environment.all('[data-key-id]', panel).forEach((button) => {
      this.environment.handler(button, 'onpointerdown', (e) => this.dragKey(e, button));
      this.environment.handler(button, 'ondblclick', (e) => {
        e.stopPropagation();
        this.trackId = button.dataset.keyTrack;
        this.keyDialog(button.dataset.keyId);
      });
      this.environment.handler(button, 'onkeydown', (e) => {
        if (e.key === 'Enter') {
          this.trackId = button.dataset.keyTrack;
          this.keyDialog(button.dataset.keyId);
        }
      });
    });
    this.updateTransport();
  }
  updateTransport() {
    const panel = this.environment.query('#animation-panel');
    if (!panel) return;
    panel.classList.toggle('recording', this.record);
    const time = this.environment.query('#motion-time');
    if (time && this.environment.document.activeElement !== time)
      time.value = Number(this.player.time.toFixed(3));
    this.environment
      .all('.motion-playhead', panel)
      .forEach(
        (el) => (el.style.left = Math.min(100, (this.player.time / this.duration) * 100) + '%'),
      );
    const play = this.environment.query('#motion-play');
    if (play) play.textContent = this.player.playing ? 'Ⅱ Pause' : '▶ Play';
    const record = this.environment.query('#motion-record');
    if (record) {
      record.classList.toggle('active', this.record);
      record.setAttribute('aria-pressed', String(this.record));
    }
    this.environment
      .query('#motion-ruler-track')
      ?.setAttribute('aria-valuenow', String(this.player.time));
  }
  newStoryboard() {
    if (this.s.doc.framework !== 'WPF') {
      this.environment.notify(
        'Native Storyboard authoring is currently available for WPF documents.',
      );
      return;
    }
    this.s.modal(
      'New Storyboard',
      `${field('motion-name', 'Resource name', 'Motion' + (listStoryboards(this.s.doc).length + 1))}${field('motion-duration', 'Duration (seconds)', 3, 'number')}`,
      [
        {
          label: 'Create Storyboard',
          primary: true,
          run: () => {
            const name = this.environment.query('[name=motion-name]').value.trim(),
              duration = Number(this.environment.query('[name=motion-duration]').value);
            if (!/^[A-Za-z_][\w]*$/.test(name))
              throw Error('Use an identifier for the resource name.');
            if (!Number.isFinite(duration) || duration <= 0)
              throw Error('Duration must be greater than zero.');
            if (listStoryboards(this.s.doc).some((s) => s.name === name))
              throw Error('A Storyboard with this name already exists.');
            if (
              this.mutate('Create Storyboard', (doc) => {
                this.storyId = createStoryboard(doc, name, duration).id;
              })
            ) {
              this.s.closeModal();
              this.show(this.storyId);
            }
          },
        },
      ],
    );
  }
  settings() {
    const story = this.story;
    if (!story) return;
    const id = story.id,
      key = story.props['x:Key'] ? 'x:Key' : story.props['x:Name'] ? 'x:Name' : null;
    this.s.modal(
      'Storyboard timing',
      `${field('motion-name', 'Name', key ? story.props[key] : '')}${field('motion-duration', 'Duration (seconds)', simpleDuration(story), 'number')}${field('motion-begin', 'Begin time', story.props.BeginTime || '0:0:0')}${field('motion-repeat', 'Repeat count, duration, or Forever', story.props.RepeatBehavior || '1x')}${field('motion-speed', 'Speed ratio', story.props.SpeedRatio || '1', 'number')}${select('motion-fill', 'Fill behavior', ['HoldEnd', 'Stop'], story.props.FillBehavior || 'HoldEnd')}<label class="check-row"><input name="motion-reverse" type="checkbox" ${story.props.AutoReverse === 'True' ? 'checked' : ''}> Auto reverse</label>`,
      [
        {
          label: 'Delete Storyboard',
          run: () => {
            if (this.mutate('Delete Storyboard', (doc) => removeNode(doc, id))) {
              this.storyId = null;
              this.trackId = null;
              this.stop();
              this.s.closeModal();
              this.render();
            }
          },
        },
        {
          label: 'Apply timing',
          primary: true,
          run: () => {
            const name = this.environment.query('[name=motion-name]').value.trim(),
              duration = Number(this.environment.query('[name=motion-duration]').value),
              speed = Number(this.environment.query('[name=motion-speed]').value),
              begin = this.environment.query('[name=motion-begin]').value,
              repeat = this.environment.query('[name=motion-repeat]').value;
            if (
              !Number.isFinite(duration) ||
              duration <= 0 ||
              !Number.isFinite(speed) ||
              speed <= 0
            )
              throw Error('Use positive duration and speed values.');
            if (name && !/^[A-Za-z_][\w]*$/.test(name))
              throw Error('Use an identifier for the name.');
            if (
              name &&
              listStoryboards(this.s.doc).some((item) => item.id !== id && item.name === name)
            )
              throw Error('The name is already used.');
            if (begin !== '{x:Null}' && !Number.isFinite(parseTime(begin, NaN)))
              throw Error('Enter a valid begin time.');
            if (
              repeat !== 'Forever' &&
              !/^\d+(?:\.\d+)?x$/i.test(repeat) &&
              !Number.isFinite(parseTime(repeat, NaN))
            )
              throw Error('Repeat must be a count such as 2x, a duration, or Forever.');
            const values = {
              Duration: formatTime(duration),
              BeginTime: begin,
              RepeatBehavior: repeat,
              SpeedRatio: String(speed),
              FillBehavior: this.environment.query('[name=motion-fill]').value,
              AutoReverse: this.environment.query('[name=motion-reverse]').checked
                ? 'True'
                : 'False',
            };
            if (
              this.mutate('Edit Storyboard timing', (doc) => {
                const node = byId(doc, id);
                if (key && name && name !== node.props[key]) {
                  const old = node.props[key];
                  node.props[key] = name;
                  walk(doc.root, (n) => {
                    for (const [property, value] of Object.entries(n.props || {})) {
                      if (
                        value === `{StaticResource ${old}}` ||
                        value === `{DynamicResource ${old}}`
                      )
                        n.props[property] = value.startsWith('{StaticResource ')
                          ? `{StaticResource ${name}}`
                          : `{DynamicResource ${name}}`;
                    }
                  });
                }
                Object.assign(node.props, values);
              })
            ) {
              this.s.closeModal();
              this.player.duration = duration;
              this.render();
            }
          },
        },
      ],
    );
  }
  addTrackDialog() {
    if (!this.story) return;
    const targets = [];
    walk(this.s.doc.root, (node) => {
      if (
        node.kind === 'element' &&
        !localName(node.type).includes('.') &&
        ![
          'ResourceDictionary',
          'Storyboard',
          'Style',
          'Setter',
          'VisualState',
          'VisualStateGroup',
        ].includes(localName(node.type))
      )
        targets.push(node);
    });
    const options = names(ANIMATION_PROPERTIES);
    this.s.modal(
      'Animate a property',
      `${select(
        'motion-target',
        'Target',
        targets.map((n) => [n.id, label(n) + ' · ' + n.type]),
        this.s.selected[0]?.id || targets[0]?.id,
      )}${select('motion-property', 'Property', options, 'Opacity')}<label>Custom property path<input name="motion-custom" placeholder="(UIElement.RenderTransform).(RotateTransform.Angle)"></label>`,
      [
        {
          label: 'Add property track',
          primary: true,
          run: () => {
            const targetId = this.environment.query('[name=motion-target]').value,
              property =
                this.environment.query('[name=motion-custom]').value.trim() ||
                this.environment.query('[name=motion-property]').value,
              id = this.storyId;
            if (isLocked(this.s.doc, targetId)) throw Error('Unlock the target layer first.');
            if (
              this.mutate('Add animation track', (doc) => {
                const target = byId(doc, targetId),
                  story = byId(doc, id);
                if (
                  storyboardTracks(doc, story).some(
                    (t) => t.targetId === targetId && t.property === property,
                  )
                )
                  throw Error('This Storyboard already animates that property.');
                const track = addTrack(doc, story, target, property);
                this.trackId = track.id;
                setKeyframe(
                  track,
                  0,
                  readPropertyPath(
                    this.base || doc,
                    byId(this.base || doc, targetId) || target,
                    track.props['Storyboard.TargetProperty'],
                  ),
                  { interpolation: 'Linear' },
                );
              })
            ) {
              this.s.closeModal();
              this.render();
            }
          },
        },
      ],
    );
  }
  keyDialog(keyId) {
    const track = this.track;
    if (!track) return;
    const frame = track.frames.find((frame) => frame.id === keyId);
    this.keyId = keyId;
    const existing = frame?.node;
    let mode = frame?.mode || frame?.kind || 'Linear';
    mode = ['Discrete', 'Spline', 'Easing'].find((name) => String(mode).includes(name)) || 'Linear';
    let easing = 'Cubic',
      easingMode = 'EaseInOut';
    if (existing)
      walk(existing, (n) => {
        if (/Ease$/.test(localName(n.type || ''))) {
          easing = localName(n.type).replace(/Ease$/, '');
          easingMode = n.props.EasingMode || 'EaseInOut';
        }
      });
    const current =
      frame?.value ??
      readPropertyPath(
        this.base || this.s.doc,
        byId(this.base || this.s.doc, track.targetId),
        track.property,
      );
    const trackId = track.id;
    this.s.modal(
      frame ? 'Edit keyframe' : 'Add keyframe',
      `<p>${esc(track.targetName || track.targetId)} · ${esc(track.property)}</p><div class="form-columns">${field('key-time', 'Time (seconds)', frame?.time ?? Number(this.player.time.toFixed(3)), 'number')}${field('key-value', 'Value', current)}${select('key-interpolation', 'Interpolation', ['Linear', 'Discrete', 'Spline', 'Easing'], mode)}${select('key-easing', 'Easing function', names(EASINGS), easing)}${select('key-easing-mode', 'Easing mode', ['EaseIn', 'EaseOut', 'EaseInOut'], easingMode)}${field('key-spline', 'Key spline (x1,y1 x2,y2)', existing?.props.KeySpline || '0.25,0.1 0.25,1')}</div><svg id="key-curve" class="motion-curve" viewBox="0 0 300 120" aria-label="Interpolation curve"></svg><p class="feature-help">Interpolation belongs to the ending keyframe. Object values use discrete interpolation.</p>`,
      [
        ...(frame
          ? [
              {
                label: 'Delete keyframe',
                run: () => {
                  if (this.mutate('Delete keyframe', (doc) => removeNode(doc, frame.id))) {
                    this.s.closeModal();
                    this.frame();
                  }
                },
              },
            ]
          : []),
        {
          label: 'Delete track',
          run: () => {
            if (this.mutate('Delete animation track', (doc) => removeNode(doc, trackId))) {
              this.trackId = null;
              this.s.closeModal();
              this.render();
            }
          },
        },
        {
          label: frame ? 'Update keyframe' : 'Insert keyframe',
          primary: true,
          run: () => {
            const time = Number(this.environment.query('[name=key-time]').value),
              value = this.environment.query('[name=key-value]').value,
              interpolation = this.environment.query('[name=key-interpolation]').value,
              spline = this.environment.query('[name=key-spline]').value,
              easeName = this.environment.query('[name=key-easing]').value,
              easeMode = this.environment.query('[name=key-easing-mode]').value;
            if (!Number.isFinite(time) || time < 0)
              throw Error('Keyframe time must be nonnegative.');
            if (
              this.mutate('Edit keyframe', (doc) => {
                const node = byId(doc, trackId);
                if (
                  storyboardTracks(doc, byId(doc, this.storyId))
                    .find((t) => t.id === trackId)
                    ?.frames.some((k) => k.id !== frame?.id && Math.abs(k.time - time) < 0.0005)
                )
                  throw Error('Another keyframe occupies that time.');
                if (frame) removeNode(doc, frame.id);
                setKeyframe(node, time, value, {
                  interpolation,
                  easing: easeName,
                  easingMode: easeMode,
                  spline,
                });
                if (time > simpleDuration(node)) node.props.Duration = formatTime(time);
                if (time > simpleDuration(byId(doc, this.storyId)))
                  byId(doc, this.storyId).props.Duration = formatTime(time);
              })
            ) {
              this.s.closeModal();
              this.seek(time);
              this.render();
            }
          },
        },
      ],
    );
    const curve = () => {
      try {
        const interpolation = this.environment.query('[name=key-interpolation]').value,
          spline = this.environment.query('[name=key-spline]').value,
          easing = this.environment.query('[name=key-easing]').value,
          mode = this.environment.query('[name=key-easing-mode]').value;
        const points = Array.from({ length: 61 }, (_, i) => {
          const t = i / 60;
          let y = t;
          if (interpolation === 'Discrete') y = i === 60 ? 1 : 0;
          else if (interpolation === 'Spline') y = splineProgress(t, spline);
          else if (interpolation === 'Easing') y = ease(t, easing, mode);
          return `${10 + t * 280},${110 - y * 100}`;
        }).join(' ');
        this.environment.query('#key-curve').innerHTML =
          `<path d="M10,10 V110 H290" fill="none" stroke="currentColor" opacity=".25"/><polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
      } catch {
        this.environment.query('#key-curve').innerHTML = '';
      }
    };
    for (const name of ['key-interpolation', 'key-easing', 'key-easing-mode', 'key-spline'])
      this.environment.listen(this.environment.query(`[name=${name}]`), 'change', curve);
    curve();
  }
  dragKey(event, button) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.player.pause();
    this.trackId = button.dataset.keyTrack;
    const track = this.track,
      frame = track?.frames.find((f) => f.id === button.dataset.keyId);
    if (!frame) return;
    this.keyId = frame.id;
    const lane = button.parentElement,
      rect = lane.getBoundingClientRect(),
      duration = this.duration,
      start = event.clientX;
    let time = frame.time,
      moved = false;
    const move = (e) => {
      moved ||= Math.abs(e.clientX - start) > 3;
      if (!moved) return;
      time = Math.max(
        0,
        Math.round(((e.clientX - rect.left) / rect.width) * duration * (e.shiftKey ? 1000 : 100)) /
          (e.shiftKey ? 1000 : 100),
      );
      button.style.left = Math.min(100, (time / duration) * 100) + '%';
      button.title = `${time.toFixed(3)}s · ${frame.value}`;
    };
    const finish = (e) => {
      this.environment.unlisten(this.environment.document, 'pointermove', move);
      this.environment.unlisten(this.environment.document, 'pointerup', finish);
      this.environment.unlisten(this.environment.document, 'pointercancel', cancel);
      if (moved) {
        const id = frame.id;
        if (
          this.mutate('Move keyframe', (doc) => {
            const node = byId(doc, id);
            if (
              storyboardTracks(doc, byId(doc, this.storyId))
                .find((t) => t.id === track.id)
                ?.frames.some((key) => key.id !== id && Math.abs(key.time - time) < 0.0005)
            )
              throw Error('Another keyframe already occupies that time.');
            node.props.KeyTime = formatTime(time);
            if (time > simpleDuration(byId(doc, track.id)))
              byId(doc, track.id).props.Duration = formatTime(time);
            if (time > simpleDuration(byId(doc, this.storyId)))
              byId(doc, this.storyId).props.Duration = formatTime(time);
          })
        ) {
          this.seek(time);
          this.render();
        }
      } else this.seek(frame.time);
    };
    const cancel = () => {
      this.environment.unlisten(this.environment.document, 'pointermove', move);
      this.environment.unlisten(this.environment.document, 'pointerup', finish);
      this.environment.unlisten(this.environment.document, 'pointercancel', cancel);
      this.render();
    };
    this.environment.listen(this.environment.document, 'pointermove', move);
    this.environment.listen(this.environment.document, 'pointerup', finish, { once: true });
    this.environment.listen(this.environment.document, 'pointercancel', cancel, { once: true });
  }
  dispose() {
    if (this.disposed) return;
    try {
      this.player.pause();
      if (this.baselines) restoreMotion(this.s.renderer, this.baselines);
      this.environment.query('#animation-panel')?.remove();
    } finally {
      super.dispose();
    }
  }
}
