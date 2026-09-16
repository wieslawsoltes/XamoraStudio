import { clone, find, localName } from '../core/model.js';
import {
  createStoryboard,
  addTrack,
  setKeyframe,
  sampleStoryboard,
  storyboardTracks,
  formatTime,
  simpleDuration,
  ANIMATION_PROPERTIES,
} from '../core/animation.js';
import { ensureTransformPath, readPropertyPath } from '../core/property-path.js';
import {
  shiftKeyframes,
  deleteKeyframes,
  editKeyframe,
  pasteKeyframes,
} from '../core/timeline-editing.js';
import { WorkspaceComponent, esc } from './workspace-context.js';
export class TimelineWorkspace extends WorkspaceComponent {
  /** @param {import('./workspace-context.js').TimelineWorkspaceHost} s
   * @param {import('./workspace-context.js').WorkspaceOptions} [workspaceOptions] */
  constructor(s, workspaceOptions = s.workspaceOptions) {
    super(workspaceOptions);
    try {
      this.s = s;
      this.a = s.blend.animation;
      this.selected = new Set();
      this.clipboard = [];
      this.fps = 60;
      this.snap = true;
      this.zoom = 1;
      const a = this.a,
        render = a.render.bind(a);
      this.environment.override(a, 'render', () => {
        const scroll = this.environment.query('.motion-track-area')?.scrollTop || 0,
          x = this.environment.query('.motion-track-area')?.scrollLeft || 0;
        render();
        if (a.open) {
          this.render();
          const area = this.environment.query('.motion-track-area');
          area.scrollTop = scroll;
          area.scrollLeft = x;
        }
      });
      this.environment.override(a, 'dragKey', (e, b) => this.dragKey(e, b));
      this.environment.override(a, 'newStoryboard', () => this.newStory());
    } catch (error) {
      try {
        this.environment.dispose();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'TimelineWorkspace initialization failed.');
      }
      throw error;
    }
  }
  get frames() {
    return this.a.tracks.flatMap((track) =>
      track.frames.map((frame) => ({ ...frame, trackId: track.id })),
    );
  }
  get keys() {
    return this.frames.filter((f) => this.selected.has(f.id));
  }
  quantize(t) {
    return Math.round(t * (this.snap ? this.fps : 1000)) / (this.snap ? this.fps : 1000);
  }
  newStory() {
    let id;
    if (
      this.a.mutate('Create Storyboard', (doc) => (id = createStoryboard(doc, 'Animation', 3).id))
    ) {
      this.a.storyId = id;
      this.a.show(id);
      this.selected.clear();
      this.a.render();
    }
  }
  changeKeys(label, fn) {
    const selected = [...this.selected];
    if (
      this.a.mutate(label, (doc) => {
        const next = fn(doc, selected);
        if (next) this.selected = new Set(next);
      })
    ) {
      this.a.frame();
      this.a.render();
    }
  }
  remove() {
    if (!this.keys.length) return;
    this.changeKeys('Delete keyframes', (doc, ids) => {
      deleteKeyframes(doc, this.a.storyId, ids);
      return [];
    });
  }
  shift(delta, duplicate = false) {
    if (!this.keys.length) return;
    this.changeKeys(duplicate ? 'Duplicate keyframes' : 'Move keyframes', (doc, ids) =>
      shiftKeyframes(doc, this.a.storyId, ids, delta, { duplicate }),
    );
  }
  copy() {
    this.clipboard = this.keys.map((f) => ({
      node: clone(f.node),
      trackId: f.trackId,
      time: f.time,
    }));
    this.environment.notify(this.clipboard.length + ' keyframes copied');
  }
  paste() {
    if (!this.clipboard.length) return;
    this.changeKeys('Paste keyframes', (doc) =>
      pasteKeyframes(doc, this.a.storyId, this.clipboard, this.a.player.time),
    );
  }
  add(property = this.environment.query('#motion-quick-property')?.value || 'Opacity') {
    const a = this.a,
      s = this.s;
    if (!s.selected.length) {
      this.environment.notify('Select a control on the canvas.');
      return;
    }
    if (!a.story) this.newStory();
    if (!a.story) return;
    const base = clone(a.base || s.doc),
      sample = sampleStoryboard(
        base,
        find(base.root, a.storyId) || a.story,
        a.player.time,
      ).overrides;
    const changes = s.selected.map((n) => {
      const node = find(base.root, n.id) || n,
        path = ensureTransformPath(base, node, property);
      return {
        id: n.id,
        path,
        value: sample.get(n.id)?.[path] ?? readPropertyPath(base, node, path),
      };
    });
    a.recordBatch(changes, 'Insert property keyframes');
    a.render();
  }

  render() {
    const a = this.a,
      panel = this.environment.query('#animation-panel');
    if (!panel) return;
    const valid = new Set(this.frames.map((f) => f.id));
    this.selected = new Set([...this.selected].filter((id) => valid.has(id)));
    if (this.documentId !== this.s.doc.id || this.storyId !== a.storyId) {
      this.selected.clear();
      this.documentId = this.s.doc.id;
      this.storyId = a.storyId;
    }
    const bar = this.environment.track(this.environment.document.createElement('div'));
    bar.className = 'motion-quick';
    bar.innerHTML = `<label>Name<input id="motion-inline-name" value="${esc(a.story?.props['x:Key'] || a.story?.props['x:Name'] || '')}" ${a.story ? '' : 'disabled'}></label><label>Duration<input id="motion-inline-duration" type="number" min="0.01" step="0.1" value="${a.story ? simpleDuration(a.story) : 3}" ${a.story ? '' : 'disabled'}></label><select id="motion-quick-property" aria-label="Animated property">${ANIMATION_PROPERTIES.map((p) => `<option value="${esc(p)}">${esc(p.includes('Transform') ? p.match(/\(([^)]+)\)$/)?.[1] || p : p)}</option>`).join('')}</select><button id="motion-quick-add">◇ Key selected controls</button><label>FPS<select id="motion-fps">${[24, 30, 60, 120].map((n) => `<option ${n === this.fps ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label><input type="checkbox" id="motion-snap" ${this.snap ? 'checked' : ''}> Snap</label><label>Zoom<input id="motion-timeline-zoom" type="range" min="1" max="6" step="0.5" value="${this.zoom}"></label>`;
    panel.insertBefore(bar, this.environment.query('.motion-track-area', panel));
    this.environment.handler(this.environment.query('#motion-quick-add'), 'onclick', () =>
      this.add(),
    );
    this.environment.handler(
      this.environment.query('#motion-fps'),
      'onchange',
      (e) => (this.fps = Number(e.target.value)),
    );
    this.environment.handler(
      this.environment.query('#motion-snap'),
      'onchange',
      (e) => (this.snap = e.target.checked),
    );
    this.environment.handler(this.environment.query('#motion-timeline-zoom'), 'oninput', (e) => {
      this.zoom = Number(e.target.value);
      this.applyZoom();
    });
    this.environment.handler(this.environment.query('#motion-inline-name'), 'onchange', (e) => {
      const key = a.story.props['x:Key'] ? 'x:Key' : 'x:Name',
        name = e.target.value.trim();
      if (!/^[A-Za-z_][\w.]*$/.test(name)) {
        this.environment.notify('Enter a resource name.');
        return;
      }
      if (key === 'x:Key') this.s.solution.renameKey(this.s.doc.id, a.story.id, name);
      else a.mutate('Rename Storyboard', (doc) => (find(doc.root, a.storyId).props[key] = name));
    });
    this.environment.handler(this.environment.query('#motion-inline-duration'), 'onchange', (e) => {
      const value = Number(e.target.value);
      if (value > 0 && Number.isFinite(value))
        a.mutate(
          'Set Storyboard duration',
          (doc) => (find(doc.root, a.storyId).props.Duration = formatTime(value)),
        );
    });
    const inspector = this.environment.track(this.environment.document.createElement('div'));
    inspector.className = 'motion-key-inspector';
    const first = this.keys[0];
    inspector.innerHTML = `<strong>${this.keys.length ? this.keys.length + ' keyframes' : 'Select a keyframe'}</strong><label>Time<input data-key-time type="number" step="${1 / this.fps}" min="0" value="${first?.time ?? ''}" ${first ? '' : 'disabled'}></label><label>Value<input data-key-value value="${esc(first?.value ?? '')}" ${first ? '' : 'disabled'}></label><label>Interpolation<select data-key-mode ${first ? '' : 'disabled'}>${['Linear', 'Discrete', 'Spline', 'Easing'].map((mode) => `<option ${first?.mode === mode ? 'selected' : ''}>${mode}</option>`).join('')}</select></label><label>Easing<select data-key-ease>${['Cubic', 'Quadratic', 'Sine', 'Bounce', 'Back', 'Elastic', 'Exponential'].map((v) => `<option>${v}</option>`).join('')}</select></label><button data-key-duplicate ${first ? '' : 'disabled'}>Duplicate</button><button data-key-remove ${first ? '' : 'disabled'}>Delete</button><button data-key-advanced ${first ? '' : 'disabled'}>Curve…</button>`;
    panel.append(inspector);
    this.environment.handler(
      this.environment.query('[data-key-time]', inspector),
      'onchange',
      (e) => this.shift(Number(e.target.value) - first.time),
    );
    const edit = (options) =>
      this.changeKeys('Edit keyframes', (doc, ids) => {
        for (const id of ids) editKeyframe(doc, a.storyId, id, options);
        return ids;
      });
    this.environment.handler(
      this.environment.query('[data-key-value]', inspector),
      'onchange',
      (e) => edit({ value: e.target.value }),
    );
    this.environment.handler(
      this.environment.query('[data-key-mode]', inspector),
      'onchange',
      (e) =>
        edit({
          interpolation: e.target.value,
          easing: this.environment.query('[data-key-ease]', inspector).value,
        }),
    );
    this.environment.handler(
      this.environment.query('[data-key-ease]', inspector),
      'onchange',
      (e) => edit({ interpolation: 'Easing', easing: e.target.value }),
    );
    this.environment.handler(
      this.environment.query('[data-key-remove]', inspector),
      'onclick',
      () => this.remove(),
    );
    this.environment.handler(
      this.environment.query('[data-key-duplicate]', inspector),
      'onclick',
      () =>
        this.shift(
          Math.max(
            1 / this.fps,
            first ? Math.max(...this.keys.map((k) => k.time)) - first.time + 1 / this.fps : 0,
          ),
          true,
        ),
    );
    this.environment.handler(
      this.environment.query('[data-key-advanced]', inspector),
      'onclick',
      () => {
        a.trackId = first.trackId;
        a.keyDialog(first.id);
      },
    );
    this.environment
      .all('[data-key-id]', panel)
      .forEach((b) => b.classList.toggle('selected', this.selected.has(b.dataset.keyId)));
    this.environment.handler(panel, 'onkeydown', (e) => {
      if (!e.defaultPrevented) this.key(e);
      else e.stopPropagation();
    });
    this.environment.all('[data-track-lane]', panel).forEach((lane) =>
      this.environment.handler(lane, 'ondblclick', (e) => {
        if (e.target.closest('[data-key-id]')) return;
        const r = lane.getBoundingClientRect(),
          time = this.quantize(((e.clientX - r.left) / r.width) * a.duration),
          track = a.tracks.find((t) => t.id === lane.dataset.trackLane);
        a.trackId = track.id;
        a.seek(time);
        const base = a.base || this.s.doc,
          sample = sampleStoryboard(base, find(base.root, a.storyId) || a.story, time).overrides;
        const value =
          sample.get(track.targetId)?.[track.property] ??
          readPropertyPath(base, find(base.root, track.targetId), track.property);
        a.recordBatch([{ id: track.targetId, path: track.property, value }], 'Insert keyframe');
        a.render();
      }),
    );
    this.applyZoom();
  }
  applyZoom() {
    const area = this.environment.query('.motion-track-area');
    if (!area) return;
    this.environment
      .all('.motion-ruler,.motion-track', area)
      .forEach(
        (row) =>
          (row.style.minWidth = Math.max(area.clientWidth, area.clientWidth * this.zoom) + 'px'),
      );
  }
  key(e) {
    const input = e.target.closest('input,select,textarea');
    if (input) {
      e.stopPropagation();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    let handled = true;
    if (e.key === 'Delete' || e.key === 'Backspace') this.remove();
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      this.keys.length
        ? this.shift(((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)) / this.fps)
        : this.a.seek(this.a.player.time + (e.key === 'ArrowLeft' ? -1 : 1) / this.fps);
    else if (e.code === 'Space') {
      if (this.a.player.playing) this.a.player.pause();
      else {
        this.a.previewing = true;
        this.a.player.play();
      }
    } else if (mod && e.key.toLowerCase() === 'c') this.copy();
    else if (mod && e.key.toLowerCase() === 'v') this.paste();
    else if (mod && e.key.toLowerCase() === 'a') {
      this.selected = new Set(this.frames.map((f) => f.id));
      this.a.render();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const tracks = this.a.tracks,
        at = tracks.findIndex((t) => t.id === this.a.trackId);
      this.a.trackId =
        tracks[Math.max(0, Math.min(tracks.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.id;
      this.a.render();
    } else if (mod && e.key.toLowerCase() === 'x') {
      this.copy();
      this.remove();
    } else if (mod && e.key.toLowerCase() === 'd') this.shift(1 / this.fps, true);
    else handled = false;
    e.stopPropagation();
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  dragKey(e, button) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const a = this.a,
      id = button.dataset.keyId;
    a.player.pause();
    a.trackId = button.dataset.keyTrack;
    const frames = this.frames,
      frame = frames.find((f) => f.id === id);
    if (!frame) return;
    if (e.ctrlKey || e.metaKey) {
      this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
    } else if (e.shiftKey && this.anchor) {
      const same = frames.filter((f) => f.trackId === frame.trackId),
        start = same.find((f) => f.id === this.anchor)?.time ?? frame.time;
      for (const f of same)
        if (f.time >= Math.min(start, frame.time) && f.time <= Math.max(start, frame.time))
          this.selected.add(f.id);
    } else if (!this.selected.has(id)) this.selected = new Set([id]);
    this.anchor = id;
    a.keyId = id;
    const r = button.parentElement.getBoundingClientRect(),
      start = e.clientX,
      selected = [...this.selected],
      docId = this.s.doc.id,
      revision = this.s.store.revision,
      storyId = a.storyId,
      pointer = e.pointerId;
    let delta = 0,
      moved = false;
    const move = (ev) => {
      if (ev.pointerId !== pointer) return;
      moved ||= Math.abs(ev.clientX - start) > 3;
      if (!moved) return;
      delta =
        this.quantize(frame.time + ((ev.clientX - start) / r.width) * a.duration) - frame.time;
      for (const key of frames.filter((f) => selected.includes(f.id))) {
        const b = this.environment.query(`[data-key-id="${key.id}"]`);
        if (b) b.style.left = ((key.time + delta) / a.duration) * 100 + '%';
      }
    };
    const cleanup = () => {
      this.environment.unlisten(this.environment.document, 'pointermove', move);
      this.environment.unlisten(this.environment.document, 'pointerup', end);
      this.environment.unlisten(this.environment.document, 'pointercancel', cancel);
      this.environment.unlisten(this.environment.document, 'keydown', key, true);
      this.environment.unlisten(this.environment.window, 'blur', cancel);
    };
    const cancel = () => {
        cleanup();
        a.render();
      },
      key = (ev) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          cancel();
        }
      };
    const end = (ev) => {
      if (ev.pointerId !== pointer) return;
      cleanup();
      if (this.s.doc.id !== docId || this.s.store.revision !== revision || a.storyId !== storyId)
        return;
      if (moved) this.shift(delta);
      else {
        a.seek(frame.time);
        a.render();
      }
    };
    this.environment.listen(this.environment.document, 'pointermove', move);
    this.environment.listen(this.environment.document, 'pointerup', end);
    this.environment.listen(this.environment.document, 'pointercancel', cancel);
    this.environment.listen(this.environment.document, 'keydown', key, true);
    this.environment.listen(this.environment.window, 'blur', cancel);
  }
  dispose() {
    if (this.disposed) return;
    try {
      this.selected.clear();
      this.clipboard.length = 0;
    } finally {
      super.dispose();
    }
  }
}
