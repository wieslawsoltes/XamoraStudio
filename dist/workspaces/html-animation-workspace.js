import { find, walk, label } from '../core/model.js';
import { isHtml, setHtmlStyle } from '../core/html.js';
import {
  listHtmlAnimations,
  createHtmlAnimation,
  setHtmlAnimationKeyframe,
  removeHtmlAnimationKeyframe,
  moveHtmlAnimationKeyframe,
  setHtmlAnimationTiming,
  removeHtmlAnimation,
  renameHtmlAnimation,
  bindHtmlAnimation,
  unbindHtmlAnimation,
  HTML_ANIMATION_PRESETS,
  HtmlAnimationPreview,
} from '../core/html-animation.js';
import { ScrollButtons } from '../controls/scroll-buttons.js';
import { WorkspaceComponent, esc } from './workspace-context.js';

const TIMING_PROPERTIES = ['duration', 'delay', 'iterations', 'direction', 'fill', 'easing'];
const CSS_PROPERTIES = [
  'opacity',
  'transform',
  'translate',
  'rotate',
  'scale',
  'width',
  'height',
  'left',
  'top',
  'background-color',
  'color',
  'border-radius',
  'box-shadow',
  'filter',
  'clip-path',
  'offset-distance',
  'font-size',
  'letter-spacing',
];
const NON_RECORDED = new Set(['position', 'display', 'box-sizing', 'animation', 'transition']);
const canRecord = (key) =>
  !NON_RECORDED.has(key) && !key.startsWith('animation-') && !key.startsWith('transition-');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const number = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const durationOf = (b) => Math.max(1, number(b?.timing?.duration, 1000));
const styles = (text, document) => {
  const probe = document.createElement('span');
  probe.style.cssText = text || '';
  return new Map([...probe.style].map((k) => [k, probe.style.getPropertyValue(k)]));
};
const option = (value, current, label = value) =>
  `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${esc(label)}</option>`;

/** Map document playback time to the directed local progress used while recording. */
export function htmlRecordingOffset(time, timing = {}) {
  const duration = Math.max(1, number(timing.duration, 1000)),
    local = Math.max(0, time - number(timing.delay)),
    iterations =
      timing.iterations === 'infinite' || timing.iterations === Infinity
        ? Infinity
        : Math.max(0, number(timing.iterations, 1)),
    end = duration * iterations;
  let iteration = Math.floor(local / duration),
    fraction = local / duration - iteration;
  if (local >= end && Number.isFinite(end)) {
    iteration = Math.max(0, Math.ceil(iterations) - 1);
    fraction = iterations % 1 || 1;
  }
  const direction = timing.direction || 'normal';
  if (
    direction === 'reverse' ||
    (direction === 'alternate' && iteration % 2 === 1) ||
    (direction === 'alternate-reverse' && iteration % 2 === 0)
  )
    fraction = 1 - fraction;
  return clamp(fraction, 0, 1);
}

/** CSS is the authored animation model; DOM animation objects are disposable previews only. */
export class HtmlAnimationWorkspace extends WorkspaceComponent {
  constructor(html, workspaceOptions = html.s.workspaceOptions) {
    super(workspaceOptions);
    try {
      this.html = html;
      this.s = html.s;
      this.environment.override(this.s, 'htmlAnimation', this);
      this.time = 0;
      this.rate = 1;
      this.loop = true;
      this.playing = false;
      this.recording = false;
      this.fps = 60;
      this.snap = true;
      this.zoom = 1;
      this.definitionId = null;
      this.nodeId = null;
      this.keyOffset = null;
      this.property = 'opacity';
      this.subscriptions = new WeakSet();
      this.catalog = { definitions: [], bindings: [], diagnostics: [] };
      this.scrolls = [];
      this.environment.stylesheet('html-animation');
      this.host = this.environment.own(
        this.environment.track(this.environment.document.createElement('section')),
      );
      this.host.id = 'html-animation-panel';
      this.host.className = 'html-motion-panel';
      this.host.setAttribute('aria-label', 'HTML animation timeline');
      this.host.tabIndex = 0;
      this.host.hidden = true;
      this.s.docking.timelineHost.append(this.host);
      const animation = this.s.blend.animation,
        render = animation.render.bind(animation),
        stop = animation.stop.bind(animation),
        frame = animation.frame.bind(animation);
      this.environment.override(animation, 'render', () =>
        isHtml(this.s.doc) ? this.render() : render(),
      );
      this.environment.override(animation, 'stop', () => {
        if (isHtml(this.s.doc)) {
          this.stop();
          animation.record = false;
          animation.previewing = false;
        } else stop();
      });
      this.environment.override(animation, 'frame', () => {
        if (!isHtml(this.s.doc)) frame();
      });
      const visibility = this.s.docking.visibility.bind(this.s.docking);
      this.environment.override(this.s.docking, 'visibility', (id, visible) => {
        if (id === 'timeline' && isHtml(this.s.doc)) {
          if (visible) this.refresh();
          else this.pause();
          return;
        }
        return visibility(id, visible);
      });
      const show = this.s.docking.showTimeline.bind(this.s.docking);
      this.environment.override(this.s.docking, 'showTimeline', () => {
        if (!isHtml(this.s.doc)) return show();
        this.s.docking.control.show('timeline');
        this.refresh();
      });
      const setProps = this.s.setProps.bind(this.s);
      this.environment.override(this.s, 'setProps', (ids, key, value) => {
        if (isHtml(this.s.doc) && this.recording && key === 'style') {
          this.html.perform('Record inline CSS', (doc) =>
            ids.forEach((id) => {
              const n = find(doc.root, id);
              if (n) {
                if (value === null) delete n.props.style;
                else n.props.style = value;
              }
            }),
          );
          return;
        }
        return setProps(ids, key, value);
      });
      const menu = (id, run, enabled = () => true, checked) => {
        const item = this.s.menus?.commands.get(id);
        if (!item) return;
        const originalRun = item.run,
          originalEnabled = item.enabled,
          originalChecked = item.checked;
        this.environment.override(item, 'run', (...args) =>
          isHtml(this.s.doc) ? run(...args) : originalRun(...args),
        );
        this.environment.override(item, 'enabled', () =>
          isHtml(this.s.doc)
            ? enabled()
            : typeof originalEnabled === 'function'
              ? originalEnabled()
              : originalEnabled !== false,
        );
        if (checked)
          this.environment.override(item, 'checked', () =>
            isHtml(this.s.doc)
              ? checked()
              : typeof originalChecked === 'function'
                ? originalChecked()
                : !!originalChecked,
          );
      };
      menu('motion-example', () => this.openExample());
      menu(
        'new-storyboard',
        () => {
          this.show();
          this.create();
        },
        () => !!this.target,
      );
      menu(
        'animation-play',
        () => {
          this.show();
          this.playing ? this.pause() : this.play();
        },
        () => !!this.catalog.bindings.length,
      );
      menu('animation-stop', () => this.stop());
      menu(
        'animation-record',
        () => this.toggleRecord(),
        () => !!this.target,
        () => this.recording,
      );
      menu(
        'animation-key',
        () => {
          this.show();
          this.addKey();
        },
        () => !!this.target && !!this.definition,
      );
      menu(
        'key-copy',
        () => {
          const frame = this.definition?.frames.find((f) => f.offset === this.keyOffset);
          if (frame) this.clipboard = { ...frame.values };
        },
        () => this.keyOffset !== null,
      );
      menu(
        'key-paste',
        () => this.addKey({ ...this.clipboard }),
        () => !!this.clipboard && !!this.definition,
      );
      menu(
        'key-delete',
        () => this.host.querySelector('[data-hm-remove-key]')?.click(),
        () => this.keyOffset !== null,
      );
      for (const direction of ['previous', 'next'])
        menu(
          'key-' + direction,
          () => {
            const frames = (this.definition?.frames || []).map(
              (f) => number(this.binding?.timing.delay) + f.offset * durationOf(this.binding),
            );
            this.pause();
            this.seek(
              direction === 'previous'
                ? Math.max(0, ...frames.filter((t) => t < this.time - 0.01))
                : Math.min(this.end, ...frames.filter((t) => t > this.time + 0.01)),
            );
          },
          () => !!this.definition,
        );
      this.environment.override(this.environment.api.html, 'animations', {
        list: () => this.read(),
        seek: (ms) => this.seek(ms),
        play: () => this.play(),
        pause: () => this.pause(),
        stop: () => this.stop(),
        create: (config) => this.create(config),
        get currentTime() {
          return html.motion.time;
        },
      });
    } catch (error) {
      try {
        this.environment.dispose();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'HtmlAnimationWorkspace initialization failed.');
      }
      throw error;
    }
  }
  get definition() {
    return this.catalog.definitions.find((d) => d.id === this.definitionId) || null;
  }
  get binding() {
    return (
      this.catalog.bindings.find(
        (b) => b.name === this.definition?.name && b.nodeId === this.nodeId,
      ) ||
      (!this.nodeId ? this.catalog.bindings.find((b) => b.name === this.definition?.name) : null) ||
      null
    );
  }
  get target() {
    return find(this.s.doc.root, this.nodeId || this.s.store.selection[0]);
  }
  get end() {
    return Math.max(
      1000,
      ...this.catalog.bindings.map(
        (b) =>
          Math.max(0, number(b.timing.delay)) +
          durationOf(b) *
            (b.timing.iterations === 'infinite' || b.timing.iterations === Infinity
              ? 2
              : Math.min(1000, Math.max(1, number(b.timing.iterations, 1)))),
      ),
    );
  }
  read() {
    return listHtmlAnimations(this.s.doc, { elements: this.s.renderer.htmlRenderer?.elements });
  }
  refresh() {
    const active = isHtml(this.s.doc);
    this.host.hidden = !active;
    const legacy = this.environment.query('#' + 'animation-panel');
    if (legacy) legacy.hidden = active;
    if (!active) {
      this.pause();
      this.recording = false;
      this.preview?.dispose();
      this.preview = null;
      return;
    }
    if (this.documentId !== this.s.doc.id) {
      this.pause();
      this.time = 0;
      this.definitionId = null;
      this.nodeId = null;
      this.keyOffset = null;
      this.recording = false;
      this.documentId = this.s.doc.id;
    }
    for (const store of this.s.stores)
      if (!this.subscriptions.has(store)) {
        this.subscriptions.add(store);
        this.environment.listen(store, 'selection', () => {
          if (store === this.s.store && isHtml(this.s.doc)) {
            this.selectCanvasTarget();
            this.render();
          }
        });
      }
    this.catalog = this.read();
    this.selectCanvasTarget();
    this.render();
  }
  connect(renderer) {
    this.preview?.dispose();
    this.renderer = renderer;
    this.preview = new HtmlAnimationPreview({
      document: renderer.frame.contentDocument,
      elements: renderer.elements,
    });
    this.catalog = this.read();
    this.selectCanvasTarget();
    this.preview.seek(this.time);
    this.render();
    // External CSS and fonts can arrive after iframe creation. Refresh bindings after their layout.
    renderer.frame.contentDocument.fonts?.ready.then(() => {
      if (this.renderer === renderer && renderer.frame?.isConnected) {
        this.catalog = this.read();
        this.render();
      }
    });
  }
  selectCanvasTarget() {
    const selected = this.s.store.selection[0];
    if (selected && selected !== this.nodeId) {
      this.nodeId = selected;
      const binding = this.catalog.bindings.find((b) => b.nodeId === selected);
      this.definitionId =
        this.catalog.definitions.find((d) => d.name === binding?.name)?.id || this.definitionId;
      this.keyOffset = null;
    }
    if (!this.definition) this.definitionId = this.catalog.definitions[0]?.id || null;
  }
  mutate(title, action) {
    if (!this.s.prepareEdit()) return false;
    this.pause();
    try {
      this.s.store.transaction(title, action);
      this.catalog = this.read();
      this.render();
      return true;
    } catch (error) {
      this.environment.notify(error.message);
      this.render();
      return false;
    }
  }
  command(action) {
    if (action === 'motion-example') {
      this.openExample();
      return true;
    }
    if (['motion', 'motion-timeline'].includes(action)) {
      this.s.docking.toggleTimeline();
      return true;
    }
    if (['animation-add', 'new-storyboard', 'motion-new'].includes(action)) {
      this.show();
      this.create();
      return true;
    }
    if (['motion-play', 'animation-play'].includes(action)) {
      this.playing ? this.pause() : this.play();
      return true;
    }
    if (['motion-stop', 'animation-stop'].includes(action)) {
      this.stop();
      return true;
    }
    if (['motion-record', 'animation-record'].includes(action)) {
      this.toggleRecord();
      return true;
    }
    return false;
  }
  async openExample() {
    if (!this.s.prepareEdit()) return;
    try {
      const exampleSource =
        '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <title>Xamora — HTML Motion Lab</title>\n  <style>\n    /* This stylesheet is intentionally readable and editable in Xamora\'s timeline. */\n    :root { color-scheme: dark; font: 15px/1.6 system-ui, sans-serif; background: #11121a; color: #ededfa; }\n    * { box-sizing: border-box; }\n    body { margin: 0; padding: 36px; }\n    main { max-width: 1100px; margin: auto; }\n    header { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 28px; }\n    h1 { margin: 0; font-size: 28px; letter-spacing: -.04em; }\n    p { color: #a8aac3; }\n    header p { margin: 6px 0 0; }\n    button { border: 1px solid #514d76; padding: 10px 16px; border-radius: 8px; background: #292541; color: white; cursor: pointer; }\n    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }\n    article { padding: 22px; border: 1px solid #303147; border-radius: 14px; background: #1b1c28; min-width: 0; }\n    h2 { font-size: 16px; margin: 0 0 6px; }\n    article p { margin: 0; font-size: 12px; min-height: 38px; }\n    .stage { height: 170px; display: grid; place-items: center; overflow: hidden; }\n    .shape { width: 70px; height: 70px; border-radius: 18px; background: #8c6eff; box-shadow: 0 12px 36px #8c6eff30; }\n    #arrival { animation: arrival 1.8s cubic-bezier(.16, 1, .3, 1) infinite alternate both; }\n    #orbit { transform: rotate(12deg); animation: orbit 3s linear infinite; }\n    #pulse { animation: pulse 1.6s ease-in-out infinite alternate; }\n    #color { animation: colorShift 2s ease-in-out infinite alternate; }\n    #mask { animation: reveal 2.4s ease-in-out infinite alternate; }\n    #combined { animation: drift 2.5s ease-in-out -.75s infinite alternate, glow 1.25s steps(4, end) infinite alternate; }\n    @keyframes arrival {\n      from { opacity: 0; translate: 0 35px; scale: .7; }\n      65% { opacity: 1; scale: 1.08; }\n      to { opacity: 1; translate: 0 0; scale: 1; }\n    }\n    @keyframes orbit {\n      from { rotate: 0deg; }\n      to { rotate: 360deg; }\n    }\n    @keyframes pulse {\n      from, to { scale: .85; border-radius: 18px; }\n      50% { scale: 1.15; border-radius: 35px; animation-timing-function: cubic-bezier(.7, 0, .3, 1); }\n    }\n    @keyframes colorShift {\n      0% { background-color: #8c6eff; filter: hue-rotate(0deg); }\n      50% { background-color: #1ce0bb; filter: hue-rotate(15deg); }\n      100% { background-color: #ff6f95; filter: hue-rotate(0deg); }\n    }\n    @keyframes reveal {\n      from { clip-path: circle(15% at 50% 50%); rotate: -15deg; }\n      to { clip-path: circle(75% at 50% 50%); rotate: 15deg; }\n    }\n    @keyframes drift {\n      from { translate: -45px 0; }\n      to { translate: 45px 0; }\n    }\n    @keyframes glow {\n      from { opacity: .3; box-shadow: 0 0 8px #8c6eff40; }\n      to { opacity: 1; box-shadow: 0 0 40px #8c6effcc; }\n    }\n    @media (max-width: 760px) { body { padding: 20px; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }\n    @media (max-width: 460px) { .grid { grid-template-columns: 1fr; } header { align-items: start; flex-direction: column; } }\n    @media (prefers-reduced-motion: reduce) { .shape { animation-duration: 1ms !important; animation-iteration-count: 1 !important; } }\n  </style>\n</head>\n<body>\n  <main>\n    <header>\n      <div><h1>HTML Motion Lab</h1><p>Native CSS keyframes · independent transforms · browser interpolation</p></div>\n      <button id="toggle" type="button" aria-pressed="false">Pause animations</button>\n    </header>\n    <section class="grid">\n      <article><h2>Arrival</h2><p>Three properties, multiple offsets and a custom easing curve.</p><div class="stage"><div class="shape" id="arrival"></div></div></article>\n      <article><h2>Rotation</h2><p>Individual rotate preserves the existing 12° transform.</p><div class="stage"><div class="shape" id="orbit"></div></div></article>\n      <article><h2>Pulse</h2><p>Grouped endpoints and a per-keyframe timing function.</p><div class="stage"><div class="shape" id="pulse"></div></div></article>\n      <article><h2>Color &amp; filter</h2><p>Native color and filter interpolation with alternate playback.</p><div class="stage"><div class="shape" id="color"></div></div></article>\n      <article><h2>Clip reveal</h2><p>Clip-path and rotation sampled by the browser animation engine.</p><div class="stage"><div class="shape" id="mask"></div></div></article>\n      <article><h2>Multiple animations</h2><p>Two independent effects, a negative delay and stepped easing.</p><div class="stage"><div class="shape" id="combined"></div></div></article>\n    </section>\n    <p>Open this HTML file in Xamora Studio to edit its CSS keyframes, timing and properties visually. Changes remain ordinary HTML and CSS.</p>\n  </main>\n  <script>\n    const toggle = document.querySelector(\'#toggle\');\n    toggle.addEventListener(\'click\', () => {\n      const paused = toggle.getAttribute(\'aria-pressed\') !== \'true\';\n      for (const animation of document.getAnimations()) paused ? animation.pause() : animation.play();\n      toggle.setAttribute(\'aria-pressed\', String(paused));\n      toggle.textContent = paused ? \'Play animations\' : \'Pause animations\';\n    });\n  </script>\n</body>\n</html>\n';
      const source = exampleSource;
      this.s.importText(source, 'HtmlMotionLab.html');
      this.s.setView('split');
      this.show();
    } catch (error) {
      this.environment.notify(error.message);
    }
  }
  show() {
    this.s.docking.showTimeline();
  }
  create(config) {
    const node = this.target;
    if (!node || ['html', 'head', 'style', 'script', 'title', 'meta', 'link'].includes(node.type)) {
      this.environment.notify('Select a visual HTML element to animate.');
      return;
    }
    const preset =
      HTML_ANIMATION_PRESETS.find(
        (p) => p.id === (config?.preset || this.host.querySelector('[data-hm-preset]')?.value),
      ) || HTML_ANIMATION_PRESETS[0];
    let created;
    const settings = config || { ...preset, name: undefined };
    if (
      this.mutate('Create HTML animation', (doc) => {
        created = createHtmlAnimation(doc, node.id, settings, {
          elements: this.renderer?.elements,
        });
      })
    ) {
      this.definitionId = created.definitionId;
      this.nodeId = node.id;
      this.keyOffset = null;
      this.time = 0;
      this.catalog = this.read();
      this.render();
    }
    return created;
  }
  addKey(values) {
    if (!this.definition) {
      this.create();
      if (!this.definition) return;
    }
    const b = this.binding,
      offset = htmlRecordingOffset(this.time, b?.timing || {}),
      property = this.host.querySelector('[data-hm-property]')?.value || this.property;
    values ||= { [property]: this.computed(this.nodeId, property) };
    const id = this.definitionId;
    if (
      this.mutate('Insert HTML keyframe', (doc) =>
        setHtmlAnimationKeyframe(doc, id, offset, values),
      )
    )
      this.keyOffset = offset;
    this.render();
  }
  computed(id, property) {
    const el = this.renderer?.elements.get(id);
    return (
      el?.ownerDocument.defaultView.getComputedStyle(el).getPropertyValue(property) ||
      { opacity: '1', transform: 'none' }[property] ||
      '0'
    );
  }
  toggleRecord() {
    this.pause();
    if (!this.target) {
      this.environment.notify('Select the HTML element to record.');
      return;
    }
    this.recording = !this.recording;
    this.show();
    this.render();
  }
  /** Called inside the existing DocumentStore transaction, before its one commit. */
  recordMutation(doc, action) {
    if (!this.recording) {
      action(doc);
      return;
    }
    const before = new Map();
    walk(doc.root, (n) => {
      if (n.kind === 'element')
        before.set(n.id, {
          style: n.props.style,
          values: styles(n.props.style, this.environment.document),
        });
    });
    action(doc);
    const changes = [];
    walk(doc.root, (n) => {
      const prior = before.get(n.id);
      if (!prior || n.props.style === prior.style) return;
      const next = styles(n.props.style, this.environment.document),
        editedStyle = n.props.style,
        values = {},
        keys = [...new Set([...prior.values.keys(), ...next.keys()])].filter(
          (key) => prior.values.get(key) !== next.get(key),
        );
      for (const key of keys)
        if (canRecord(key)) {
          values[key] = next.has(key)
            ? next.get(key)
            : this.resolveRemovedValue(n.id, key, editedStyle);
          if (!values[key])
            throw Error(
              'Cannot resolve ' +
                key +
                ' after removing its inline value. Turn off Record to edit the base style.',
            );
        }
      if (Object.keys(values).length) {
        if (keys.every(canRecord)) {
          if (prior.style === undefined) delete n.props.style;
          else n.props.style = prior.style;
        } else
          for (const key of Object.keys(values)) setHtmlStyle(n, key, prior.values.get(key) || '');
        changes.push({ node: n, values, prior });
      }
    });
    for (const change of changes) {
      const catalog = listHtmlAnimations(doc, { elements: this.renderer?.elements }),
        binding =
          catalog.bindings.find(
            (b) => b.nodeId === change.node.id && b.name === this.definition?.name,
          ) || catalog.bindings.find((b) => b.nodeId === change.node.id);
      let definition = catalog.definitions.find((d) => d.name === binding?.name),
        timing = binding?.timing || { duration: 1000, fill: 'both' };
      if (!definition) {
        const base = Object.fromEntries(
          Object.keys(change.values).map((k) => [
            k,
            change.prior.values.get(k) || this.computed(change.node.id, k),
          ]),
        );
        const created = createHtmlAnimation(
          doc,
          change.node.id,
          {
            duration: 1000,
            fill: 'both',
            frames: [
              { offset: 0, values: base },
              { offset: 1, values: base },
            ],
          },
          { elements: this.renderer?.elements },
        );
        definition = { id: created.definitionId, name: created.name };
      }
      setHtmlAnimationKeyframe(
        doc,
        definition.id,
        htmlRecordingOffset(this.time, timing),
        change.values,
      );
      this.definitionId = definition.id;
      this.nodeId = change.node.id;
    }
  }
  resolveRemovedValue(id, property, editedStyle) {
    const el = this.renderer?.elements.get(id);
    if (!el) return '';
    const before = el.style.cssText;
    try {
      el.style.cssText = editedStyle || '';
      el.style.setProperty('animation', 'none', 'important');
      el.style.setProperty('transition', 'none', 'important');
      return el.ownerDocument.defaultView.getComputedStyle(el).getPropertyValue(property);
    } finally {
      el.style.cssText = before;
      this.preview?.refresh().seek(this.time);
    }
  }
  seek(ms) {
    this.time = clamp(number(ms), 0, this.end);
    this.preview?.seek(this.time);
    this.transport();
    this.html.selection();
  }
  pause() {
    this.playing = false;
    this.environment.cancelFrame(this.frameId);
    this.preview?.pause();
    this.transport();
  }
  stop() {
    this.pause();
    this.time = 0;
    this.recording = false;
    this.preview?.stop();
    this.transport();
    this.html.selection();
  }
  play() {
    if (!this.catalog.bindings.length) {
      this.environment.notify('Create or bind an HTML animation first.');
      return;
    }
    this.recording = false;
    if (this.time >= this.end) this.time = 0;
    this.playing = true;
    this.lastTick = null;
    this.transport();
    const tick = (stamp) => {
      if (!this.playing || !isHtml(this.s.doc)) return;
      const delta = this.lastTick === null ? 0 : stamp - this.lastTick;
      this.lastTick = stamp;
      let next = this.time + delta * this.rate;
      if (next >= this.end) {
        if (this.loop) next %= this.end;
        else {
          this.seek(this.end);
          this.pause();
          return;
        }
      }
      this.seek(next);
      this.frameId = this.environment.frame(tick);
    };
    this.environment.cancelFrame(this.frameId);
    this.frameId = this.environment.frame(tick);
  }
  transport() {
    const panel = this.host;
    if (!panel) return;
    panel.classList.toggle('recording', this.recording);
    const play = panel.querySelector('[data-hm-play]');
    if (play) play.textContent = this.playing ? 'Ⅱ Pause' : '▶ Play';
    const record = panel.querySelector('[data-hm-record]');
    if (record) {
      record.classList.toggle('active', this.recording);
      record.setAttribute('aria-pressed', String(this.recording));
      record.textContent = this.recording ? '● Recording' : '● Record';
    }
    const time = panel.querySelector('[data-hm-time]');
    if (time && this.environment.document.activeElement !== time)
      time.value = (this.time / 1000).toFixed(3);
    const scrub = panel.querySelector('[data-hm-scrub]');
    if (scrub && this.environment.document.activeElement !== scrub) scrub.value = String(this.time);
    panel
      .querySelectorAll('.html-motion-playhead')
      .forEach((el) => (el.style.left = (this.time / this.end) * 100 + '%'));
  }
  render() {
    if (!this.host || !isHtml(this.s.doc)) return;
    this.host.hidden = false;
    const legacy = this.environment.query('#' + 'animation-panel');
    if (legacy) legacy.hidden = true;
    const scroll = this.host.querySelector('.html-motion-track-area')?.scrollTop || 0;
    this.scrolls.forEach((s) => s.dispose());
    this.scrolls = [];
    const d = this.definition,
      b = this.binding,
      t = b?.timing || {
        duration: 1000,
        delay: 0,
        iterations: 1,
        direction: 'normal',
        fill: 'both',
        easing: 'ease',
      },
      frames = d?.frames || [],
      key =
        this.keyOffset === null
          ? null
          : frames.find((f) => Math.abs(f.offset - this.keyOffset) < 0.00001),
      targets = [];
    walk(this.s.doc.root, (n) => {
      if (
        n.kind === 'element' &&
        !['html', 'head', 'style', 'script', 'meta', 'link', 'title'].includes(n.type)
      )
        targets.push(n);
    });
    const tracks = this.catalog.definitions.flatMap((def) => {
      const bindings = this.catalog.bindings.filter((x) => x.name === def.name);
      return (
        bindings.length
          ? bindings
          : [{ nodeId: null, name: def.name, timing: { duration: 1000, delay: 0 } }]
      ).map((binding) => ({ def, binding }));
    });
    this.host.innerHTML = `<div class="html-motion-bar"><strong>HTML animation</strong><select data-hm-definition aria-label="Animation">${this.catalog.definitions.length ? this.catalog.definitions.map((def) => option(def.id, this.definitionId, def.name)).join('') : '<option>No animations</option>'}</select><label>Name<input data-hm-name value="${esc(d?.name || '')}" ${d ? '' : 'disabled'} aria-label="Animation name"></label><select data-hm-target aria-label="Animation target"><option value="">Select a target</option>${targets.map((n) => option(n.id, this.nodeId, n.type + ' · ' + label(n))).join('')}</select><button data-hm-bind ${d && this.target ? '' : 'disabled'} title="Apply the selected keyframes to the target element">Bind target</button><button data-hm-unbind ${b ? '' : 'disabled'}>Unbind target</button><select data-hm-preset aria-label="Animation preset">${HTML_ANIMATION_PRESETS.map((p) => option(p.id, null, p.label || p.name || p.id)).join('')}</select><button data-hm-create>＋ Animation</button><button data-hm-delete ${d ? '' : 'disabled'}>Delete animation</button></div>
  <div class="html-motion-bar html-motion-transport"><button data-hm-play>▶ Play</button><button data-hm-stop>■ Stop</button><button data-hm-record aria-pressed="${this.recording}">● Record</button><label>Time <input data-hm-time type="number" min="0" max="${this.end / 1000}" step="${1 / this.fps}" value="${this.time / 1000}"> s</label><input data-hm-scrub type="range" aria-label="Scrub HTML animation" min="0" max="${this.end}" step="1" value="${this.time}"><label><input data-hm-loop type="checkbox" ${this.loop ? 'checked' : ''}>Loop preview</label><label>Speed<select data-hm-rate>${[0.25, 0.5, 1, 1.5, 2, 4].map((n) => option(n, this.rate, n + '×')).join('')}</select></label><label><input data-hm-snap type="checkbox" ${this.snap ? 'checked' : ''}>Snap 60 fps</label><label>Zoom<input data-hm-zoom type="range" min="1" max="8" step=".5" value="${this.zoom}"></label></div>
  <div class="html-motion-bar html-motion-timing">${['duration', 'delay', 'iterations'].map((k) => `<label>${k}<input data-hm-timing="${k}" value="${esc(t[k] === Infinity ? 'infinite' : t[k])}" ${k === 'iterations' ? '' : 'type="number" step="10"'} ${k === 'duration' ? 'min="0"' : ''} ${b ? '' : 'disabled'}>${k === 'iterations' ? '' : 'ms'}</label>`).join('')}<label>Direction<select data-hm-timing="direction" ${b ? '' : 'disabled'}>${['normal', 'reverse', 'alternate', 'alternate-reverse'].map((v) => option(v, t.direction)).join('')}</select></label><label>Fill<select data-hm-timing="fill" ${b ? '' : 'disabled'}>${['none', 'forwards', 'backwards', 'both'].map((v) => option(v, t.fill)).join('')}</select></label><label>Easing<input data-hm-timing="easing" list="html-motion-easings" value="${esc(t.easing || 'ease')}" ${b ? '' : 'disabled'}></label><datalist id="html-motion-easings">${['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'steps(4, end)', 'cubic-bezier(0.16, 1, 0.3, 1)'].map((v) => `<option>${esc(v)}</option>`).join('')}</datalist><label>CSS property<input data-hm-property list="html-motion-properties" value="${esc(this.property)}"></label><datalist id="html-motion-properties">${CSS_PROPERTIES.map((v) => `<option>${v}</option>`).join('')}</datalist><button data-hm-add-key ${d ? '' : 'disabled'}>◇ Key at playhead</button></div>
  <div class="html-motion-track-area"><div class="html-motion-ruler html-motion-row"><span>Element / CSS keyframes</span><div data-hm-ruler class="html-motion-lane">${Array.from({ length: 11 }, (_, i) => `<i style="left:${i * 10}%"><b>${((this.end * i) / 10000).toFixed(1)}s</b></i>`).join('')}<span class="html-motion-playhead"></span></div></div>${tracks.length ? tracks.map(({ def, binding }, i) => `<div class="html-motion-row html-motion-track ${def.id === this.definitionId && binding.nodeId === this.nodeId ? 'selected' : ''}"><button data-hm-track="${i}" class="html-motion-track-label"><strong>${esc(binding.nodeId ? label(find(this.s.doc.root, binding.nodeId)) : 'Unbound keyframes')}</strong><small>${esc(def.name)} · ${esc([...new Set(def.frames.flatMap((f) => Object.keys(f.values)))].join(', '))}</small></button><div class="html-motion-lane" data-hm-lane="${i}"><div class="html-motion-span" style="left:${(Math.max(0, number(binding.timing.delay)) / this.end) * 100}%;width:${(Math.min(this.end, durationOf(binding)) / this.end) * 100}%"></div>${def.frames.map((f, j) => `<button class="html-motion-key ${def.id === this.definitionId && f.offset === this.keyOffset ? 'selected' : ''}" data-hm-key="${i}:${j}" title="${esc(def.name)} · ${(f.offset * 100).toFixed(1)}% · ${esc(JSON.stringify(f.values))}" aria-label="Keyframe ${(f.offset * 100).toFixed(1)} percent" style="left:${clamp(((number(binding.timing.delay) + durationOf(binding) * f.offset) / this.end) * 100, 0, 100)}%">◆</button>`).join('')}<span class="html-motion-playhead"></span></div></div>`).join('') : '<p class="html-motion-empty">Select an HTML element and choose a preset to create an animation. CSS @keyframes from source appear here automatically. Record captures CSS property and canvas edits into keyframes.</p>'}</div>
  <div class="html-motion-key-editor"><strong>${key ? 'Keyframe' : 'Select a keyframe'}</strong><label>Offset %<input data-hm-offset type="number" min="0" max="100" step=".1" value="${key ? key.offset * 100 : ''}" ${key ? '' : 'disabled'}></label>${
    key
      ? Object.entries(key.values)
          .map(
            ([prop, value]) =>
              `<label>${esc(prop)}<input data-hm-key-value="${esc(prop)}" value="${esc(value)}"><button data-hm-remove-property="${esc(prop)}" title="Remove animated property ${esc(prop)}" aria-label="Remove animated property ${esc(prop)}">×</button></label>`,
          )
          .join('')
      : ''
  }<label>Key easing<input data-hm-key-easing list="html-motion-easings" value="${esc(key?.values['animation-timing-function'] || '')}" placeholder="Animation easing" ${key ? '' : 'disabled'}></label><button data-hm-remove-key ${key ? '' : 'disabled'}>Delete key</button><button data-hm-duplicate-key ${key ? '' : 'disabled'}>Duplicate key</button></div>
  <footer role="status" title="${esc(this.catalog.diagnostics.map((x) => x.message || x).join(' · '))}">${this.catalog.diagnostics.length ? esc(this.catalog.diagnostics.map((x) => x.message || x).join(' · ')) : this.recording ? 'Recording CSS changes at the playhead. Base styles remain unchanged.' : 'CSS @keyframes and animation properties are the source of truth. Playback samples never enter undo history.'}</footer>`;
    const q = (selector) => this.host.querySelector(selector);
    this.environment.handler(q('[data-hm-definition]'), 'onchange', (e) => {
      this.definitionId = e.target.value;
      this.keyOffset = null;
      const binding = this.catalog.bindings.find((b) => b.name === this.definition?.name);
      if (binding) this.nodeId = binding.nodeId;
      this.render();
    });
    this.environment.handler(q('[data-hm-name]'), 'onchange', (e) => {
      let id;
      if (
        this.mutate('Rename HTML animation', (doc) => {
          id = renameHtmlAnimation(doc, d.id, e.target.value.trim());
        })
      ) {
        this.definitionId = id;
        this.catalog = this.read();
        this.render();
      }
    });
    this.environment.handler(q('[data-hm-target]'), 'onchange', (e) => {
      this.nodeId = e.target.value;
      this.s.store.select(this.nodeId ? [this.nodeId] : []);
      this.render();
    });
    this.environment.handler(q('[data-hm-create]'), 'onclick', () => this.create());
    this.environment.handler(q('[data-hm-bind]'), 'onclick', () =>
      this.mutate('Bind HTML animation', (doc) =>
        bindHtmlAnimation(doc, this.nodeId, d.name, t, { elements: this.renderer?.elements }),
      ),
    );
    this.environment.handler(q('[data-hm-unbind]'), 'onclick', () =>
      this.mutate('Unbind HTML animation', (doc) =>
        unbindHtmlAnimation(doc, b.nodeId, b.name, { elements: this.renderer?.elements }),
      ),
    );
    this.environment.handler(q('[data-hm-delete]'), 'onclick', () => {
      if (
        this.mutate('Delete HTML animation', (doc) => {
          for (const binding of this.catalog.bindings.filter((x) => x.name === d.name))
            unbindHtmlAnimation(doc, binding.nodeId, d.name, { elements: this.renderer?.elements });
          removeHtmlAnimation(doc, this.definitionId);
        })
      ) {
        this.definitionId = null;
        this.refresh();
      }
    });
    this.environment.handler(q('[data-hm-play]'), 'onclick', () =>
      this.playing ? this.pause() : this.play(),
    );
    this.environment.handler(q('[data-hm-stop]'), 'onclick', () => this.stop());
    this.environment.handler(q('[data-hm-record]'), 'onclick', () => this.toggleRecord());
    this.environment.handler(q('[data-hm-time]'), 'onchange', (e) => {
      this.pause();
      this.seek(number(e.target.value) * 1000);
    });
    this.environment.handler(q('[data-hm-scrub]'), 'oninput', (e) => {
      this.pause();
      this.seek(number(e.target.value));
    });
    this.environment.handler(
      q('[data-hm-loop]'),
      'onchange',
      (e) => (this.loop = e.target.checked),
    );
    this.environment.handler(
      q('[data-hm-rate]'),
      'onchange',
      (e) => (this.rate = number(e.target.value, 1)),
    );
    this.environment.handler(
      q('[data-hm-snap]'),
      'onchange',
      (e) => (this.snap = e.target.checked),
    );
    this.environment.handler(q('[data-hm-zoom]'), 'oninput', (e) => {
      this.zoom = number(e.target.value, 1);
      this.zoomRows();
    });
    this.environment.handler(
      q('[data-hm-property]'),
      'onchange',
      (e) => (this.property = e.target.value),
    );
    this.environment.handler(q('[data-hm-add-key]'), 'onclick', () => this.addKey());
    this.host.querySelectorAll('[data-hm-timing]').forEach((input) =>
      this.environment.handler(input, 'onchange', () => {
        const k = input.dataset.hmTiming;
        if (!TIMING_PROPERTIES.includes(k)) return;
        const value = ['duration', 'delay'].includes(k)
          ? Number(input.value)
          : k === 'iterations' && input.value !== 'infinite'
            ? Number(input.value)
            : input.value;
        this.mutate('Set HTML animation ' + k, (doc) =>
          setHtmlAnimationTiming(
            doc,
            b.nodeId,
            b.name,
            { [k]: value },
            { elements: this.renderer?.elements },
          ),
        );
      }),
    );
    this.host.querySelectorAll('[data-hm-track]').forEach((el) =>
      this.environment.handler(el, 'onclick', () => {
        const track = tracks[Number(el.dataset.hmTrack)];
        this.definitionId = track.def.id;
        this.nodeId = track.binding.nodeId;
        this.keyOffset = null;
        if (this.nodeId) this.s.store.select([this.nodeId]);
        this.render();
      }),
    );
    this.host.querySelectorAll('[data-hm-key]').forEach((el) =>
      this.environment.handler(el, 'onpointerdown', (e) => {
        const [ti, ki] = el.dataset.hmKey.split(':').map(Number);
        this.dragKey(e, el, tracks[ti], tracks[ti].def.frames[ki]);
      }),
    );
    const scrub = (e) => {
      this.pause();
      const r = e.currentTarget.getBoundingClientRect();
      this.seek(clamp((e.clientX - r.left) / r.width, 0, 1) * this.end);
    };
    this.environment.handler(q('[data-hm-ruler]'), 'onpointerdown', (e) =>
      this.scrubGesture(e, scrub),
    );
    this.host.querySelectorAll('[data-hm-lane]').forEach((el) =>
      this.environment.handler(el, 'ondblclick', (e) => {
        if (e.target.closest('[data-hm-key]')) return;
        const track = tracks[Number(el.dataset.hmLane)];
        this.definitionId = track.def.id;
        this.nodeId = track.binding.nodeId;
        scrub(e);
        this.addKey();
      }),
    );
    this.environment.handler(q('[data-hm-offset]'), 'onchange', (e) => {
      const offset = Number(e.target.value) / 100;
      if (
        this.mutate('Move HTML keyframe', (doc) =>
          moveHtmlAnimationKeyframe(doc, d.id, key.offset, offset),
        )
      )
        this.keyOffset = offset;
      this.render();
    });
    this.host.querySelectorAll('[data-hm-key-value]').forEach((el) =>
      this.environment.handler(el, 'onchange', () =>
        this.mutate('Edit HTML keyframe value', (doc) =>
          setHtmlAnimationKeyframe(doc, d.id, key.offset, {
            [el.dataset.hmKeyValue]: el.value,
          }),
        ),
      ),
    );
    this.host.querySelectorAll('[data-hm-remove-property]').forEach((el) =>
      this.environment.handler(el, 'onclick', () =>
        this.mutate('Remove animated CSS property', (doc) =>
          setHtmlAnimationKeyframe(doc, d.id, key.offset, {
            [el.dataset.hmRemoveProperty]: null,
          }),
        ),
      ),
    );
    this.environment.handler(q('[data-hm-key-easing]'), 'onchange', (e) =>
      this.mutate('Set keyframe easing', (doc) =>
        setHtmlAnimationKeyframe(doc, d.id, key.offset, {
          'animation-timing-function': e.target.value || null,
        }),
      ),
    );
    this.environment.handler(q('[data-hm-remove-key]'), 'onclick', () => {
      this.mutate('Delete HTML keyframe', (doc) =>
        removeHtmlAnimationKeyframe(doc, d.id, key.offset),
      );
      this.keyOffset = null;
      this.render();
    });
    this.environment.handler(q('[data-hm-duplicate-key]'), 'onclick', () => {
      const offset = clamp(key.offset + 1000 / this.fps / durationOf(b), 0, 1);
      if (
        this.mutate('Duplicate HTML keyframe', (doc) =>
          setHtmlAnimationKeyframe(doc, d.id, offset, key.values),
        )
      )
        this.keyOffset = offset;
      this.render();
    });
    this.environment.handler(this.host, 'onkeydown', (e) => this.key(e));
    this.host.querySelector('.html-motion-track-area').scrollTop = scroll;
    this.host.querySelectorAll('.html-motion-bar').forEach((bar) => {
      const next = bar.nextSibling,
        scroll = new ScrollButtons(bar, { label: 'HTML animation controls' });
      this.host.insertBefore(scroll.host, next);
      this.scrolls.push(scroll);
    });
    this.zoomRows();
    this.transport();
  }
  zoomRows() {
    this.host
      .querySelectorAll('.html-motion-row')
      .forEach(
        (row) =>
          (row.style.minWidth = `${Math.max(480, (this.host.clientWidth || 600) * this.zoom)}px`),
      );
  }
  scrubGesture(event, scrub) {
    const target = event.currentTarget;
    event.preventDefault();
    scrub(event);
    const move = (e) => scrub({ clientX: e.clientX, currentTarget: target }),
      done = () => {
        this.environment.unlisten(this.environment.document, 'pointermove', move);
        this.environment.unlisten(this.environment.document, 'pointerup', done);
        this.environment.unlisten(this.environment.document, 'pointercancel', done);
      };
    this.environment.listen(this.environment.document, 'pointermove', move);
    this.environment.listen(this.environment.document, 'pointerup', done);
    this.environment.listen(this.environment.document, 'pointercancel', done);
  }
  dragKey(event, button, track, frame) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.pause();
    this.definitionId = track.def.id;
    this.nodeId = track.binding.nodeId;
    this.keyOffset = frame.offset;
    const revision = this.s.store.revision,
      documentId = this.s.doc.id,
      rect = button.parentElement.getBoundingClientRect(),
      start = event.clientX;
    let next = frame.offset,
      moved = false;
    const move = (e) => {
      moved ||= Math.abs(e.clientX - start) > 3;
      let ms =
        frame.offset * durationOf(track.binding) + ((e.clientX - start) / rect.width) * this.end;
      if (this.snap) ms = Math.round(ms / (1000 / this.fps)) * (1000 / this.fps);
      next = clamp(ms / durationOf(track.binding), 0, 1);
      button.style.left =
        clamp(
          ((number(track.binding.timing.delay) + next * durationOf(track.binding)) / this.end) *
            100,
          0,
          100,
        ) + '%';
      this.seek(Math.max(0, number(track.binding.timing.delay) + next * durationOf(track.binding)));
    };
    const clean = () => {
      this.environment.unlisten(this.environment.document, 'pointermove', move);
      this.environment.unlisten(this.environment.document, 'pointerup', end);
      this.environment.unlisten(this.environment.document, 'pointercancel', cancel);
      this.environment.unlisten(this.environment.document, 'keydown', key, true);
      this.environment.unlisten(this.environment.window, 'blur', cancel);
    };
    const cancel = () => {
        clean();
        this.render();
      },
      key = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          cancel();
        }
      };
    const end = () => {
      clean();
      if (this.s.doc.id !== documentId || this.s.store.revision !== revision) {
        this.render();
        return;
      }
      if (moved) {
        if (
          this.mutate('Move HTML keyframe', (doc) =>
            moveHtmlAnimationKeyframe(doc, track.def.id, frame.offset, next),
          )
        )
          this.keyOffset = next;
      } else
        this.seek(
          Math.max(
            0,
            number(track.binding.timing.delay) + frame.offset * durationOf(track.binding),
          ),
        );
      if (this.nodeId) this.s.store.select([this.nodeId]);
      this.render();
    };
    this.environment.listen(this.environment.document, 'pointermove', move);
    this.environment.listen(this.environment.document, 'pointerup', end);
    this.environment.listen(this.environment.document, 'pointercancel', cancel);
    this.environment.listen(this.environment.document, 'keydown', key, true);
    this.environment.listen(this.environment.window, 'blur', cancel);
  }
  key(e) {
    if (e.target.closest('input,select,textarea')) {
      e.stopPropagation();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    let handled = true;
    if (mod && ['c', 'v', 'd'].includes(e.key.toLowerCase())) {
      const command =
        e.key.toLowerCase() === 'c' ? 'key-copy' : e.key.toLowerCase() === 'v' ? 'key-paste' : null;
      if (command) this.s.menus.commands.get(command)?.run();
      else this.host.querySelector('[data-hm-duplicate-key]')?.click();
    } else if (e.code === 'Space') this.playing ? this.pause() : this.play();
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      this.pause();
      this.seek(
        this.time + ((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) * 1000) / this.fps,
      );
    } else if (e.key === 'Home') this.seek(0);
    else if (e.key === 'End') this.seek(this.end);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && this.keyOffset !== null)
      this.host.querySelector('[data-hm-remove-key]')?.click();
    else if (e.key.toLowerCase() === 'k') this.addKey();
    else if (e.key.toLowerCase() === 'r') this.toggleRecord();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  dispose() {
    if (this.disposed) return;
    try {
      this.pause();
      this.preview?.dispose?.();
      this.scrolls.forEach((scroll) => scroll.dispose());
      this.host.remove();
    } finally {
      super.dispose();
    }
  }
}
