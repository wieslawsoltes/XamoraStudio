import { find, walk, label } from '../core/model.js';
import { isHtml } from '../core/html.js';
import {
  listHtmlStates,
  createHtmlState,
  setHtmlStateProperties,
  recordHtmlStateProperties,
  bindHtmlState,
  removeHtmlState,
  getHtmlTransitions,
  setHtmlTransitions,
  getHtmlStateTransitions,
  setHtmlStateTransitions,
  HtmlStatePreview,
  bindHtmlStateInteraction,
  listHtmlStateInteractions,
  removeHtmlStateInteraction,
} from '../core/html-states.js';
import { esc, notify } from './ui.js';
const kinds = [
  'hover',
  'focus',
  'focus-visible',
  'active',
  'disabled',
  'checked',
  'named',
  'class',
  'data',
];
const properties = [
  'opacity',
  'background-color',
  'color',
  'transform',
  'translate',
  'scale',
  'rotate',
  'width',
  'height',
  'padding',
  'border-color',
  'border-radius',
  'box-shadow',
  'filter',
  'clip-path',
  'display',
  'visibility',
];
const option = (value, current, title = value) =>
  `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${esc(title)}</option>`;
const cssValues = (text) => {
  const el = document.createElement('span');
  el.style.cssText = text || '';
  return new Map(
    [...el.style].map((k) => [
      k,
      el.style.getPropertyValue(k) + (el.style.getPropertyPriority(k) ? ' !important' : ''),
    ]),
  );
};
const plain = (value) => String(value ?? '').replace(/\s*!important\s*$/i, '');
/** Compare declared CSS values, including clearing an override. The caller resolves removals. */
export function htmlStateStyleChanges(before, after, resolveRemoved) {
  const values = {};
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key) === after.get(key) || /^(animation|transition)(-|$)/.test(key)) continue;
    const value = after.has(key) ? after.get(key) : resolveRemoved(key);
    if (value === undefined || value === null || value === '')
      throw Error(
        'Cannot resolve ' +
          key +
          ' after clearing its override. Exit state recording to edit base styles.',
      );
    values[key] = value;
  }
  return values;
}

/** CSS state and transition authoring using the same source/AST transaction as every panel. */
export class HtmlStatesWorkspace {
  constructor(html) {
    this.html = html;
    this.s = html.s;
    this.s.htmlStates = this;
    this.nodeId = null;
    this.stateId = null;
    this.recording = false;
    this.active = false;
    this.transitionScope = 'element';
    this.catalog = { states: [], transitions: [], diagnostics: [] };
    this.bound = new WeakSet();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../styles/html-states.css', import.meta.url).href;
    document.head.append(link);
    this.host = document.createElement('section');
    this.host.id = 'html-states-panel';
    this.host.className = 'html-states-panel';
    this.host.setAttribute('aria-label', 'HTML states and transitions');
    this.host.tabIndex = 0;
    this.panel = this.s.docking.registerPanel({
      id: 'html-states',
      title: 'HTML states & transitions',
      icon: '↔',
      content: this.host,
      onClose: () => this.reset(),
    });
    this.panel.close();
    const menu = (id, run) => {
      const command = this.s.menus.commands.get(id);
      if (!command) return;
      const oldRun = command.run,
        oldEnabled = command.enabled;
      command.run = (...args) => (isHtml(this.s.doc) ? run(...args) : oldRun(...args));
      command.enabled = () =>
        isHtml(this.s.doc) ||
        (typeof oldEnabled === 'function' ? oldEnabled() : oldEnabled !== false);
    };
    for (const id of ['visual-states', 'native-trigger']) menu(id, () => this.show());
    const example = {
      id: 'html-interaction-example',
      label: 'Open HTML interaction example',
      run: () => this.openExample(),
      enabled: () => true,
    };
    this.s.menus.commands.set(example.id, example);
    this.s.menus.menus.find((m) => m.label === 'Animation')?.children.push(example);
    const setProps = this.s.setProps.bind(this.s);
    this.s.setProps = (ids, key, value) => {
      if (isHtml(this.s.doc) && this.recording && key === 'style') {
        this.html.perform('Record state CSS', (doc) =>
          ids.forEach((id) => {
            const node = find(doc.root, id);
            if (node) {
              if (value === null) delete node.props.style;
              else node.props.style = String(value);
            }
          }),
        );
        return;
      }
      return setProps(ids, key, value);
    };
    const record = this.html.motion.toggleRecord.bind(this.html.motion);
    this.html.motion.toggleRecord = () => {
      this.recording = false;
      this.render();
      return record();
    };
    const play = this.html.motion.play.bind(this.html.motion);
    this.html.motion.play = () => {
      this.reset();
      return play();
    };
    window.xamora.html.states = {
      list: () => this.read(),
      create: (options) => this.create(options),
      select: (id) => this.selectState(id),
      preview: () => this.trigger(),
      reset: () => this.reset(),
      show: () => this.show(),
    };
    this.refresh();
  }
  get state() {
    return this.catalog.states.find((s) => s.id === this.stateId) || null;
  }
  get target() {
    return find(this.s.doc.root, this.nodeId || this.s.store.selection[0]);
  }
  read() {
    return listHtmlStates(this.s.doc, { elements: this.renderer?.elements });
  }
  refresh() {
    if (!isHtml(this.s.doc)) {
      this.reset();
      this.host.innerHTML =
        '<p class="hs-hint">Open an HTML document to edit CSS states and transitions.</p>';
      return;
    }
    if (this.documentId !== this.s.doc.id) {
      this.reset();
      this.nodeId = null;
      this.stateId = null;
      this.documentId = this.s.doc.id;
      this.transitionScope = 'element';
    }
    for (const store of this.s.stores)
      if (!this.bound.has(store)) {
        this.bound.add(store);
        store.addEventListener('selection', () => {
          if (store === this.s.store && isHtml(this.s.doc)) {
            this.selectTarget();
            this.render();
          }
        });
      }
    this.catalog = this.read();
    if (this.stateId && !this.state) {
      this.stateId = null;
      this.active = false;
      this.recording = false;
    }
    this.selectTarget();
    this.render();
  }
  selectTarget() {
    const id = this.s.store.selection[0];
    if (id && id !== this.nodeId) {
      this.preview?.clear();
      this.nodeId = id;
      this.stateId = null;
      this.recording = false;
      this.active = false;
    }
  }
  connect(renderer) {
    this.preview?.dispose();
    this.renderer = renderer;
    this.preview = new HtmlStatePreview({
      document: renderer.frame.contentDocument,
      elements: renderer.elements,
      sourceDocument: this.s.doc,
    });
    this.catalog = this.read();
    if (this.active && this.state && this.nodeId) this.preview.setState(this.state, this.nodeId);
    this.syncMotion();
    this.render();
  }
  command(action) {
    if (
      ['visual-states', 'motion-states', 'native-trigger', 'motion-event', 'html-states'].includes(
        action,
      )
    ) {
      this.show();
      return true;
    }
    if (action === 'html-interaction-example') {
      this.openExample();
      return true;
    }
    return false;
  }
  show() {
    this.s.docking.control.show('html-states');
    this.refresh();
  }
  async openExample() {
    if (!this.s.prepareEdit()) return;
    try {
      const response = await fetch(new URL('../examples/HtmlInteractionLab.html', import.meta.url));
      if (!response.ok) throw Error('Could not load the HTML interaction example.');
      this.s.importText(await response.text(), 'HtmlInteractionLab.html');
      this.s.setView('split');
      this.show();
    } catch (error) {
      notify(error.message);
    }
  }
  mutate(title, action) {
    if (!this.s.prepareEdit()) return false;
    try {
      this.s.store.transaction(title, action);
      this.catalog = this.read();
      this.render();
      return true;
    } catch (error) {
      notify(error.message);
      this.render();
      return false;
    }
  }
  create(options) {
    const target = this.target;
    if (
      !target ||
      ['html', 'head', 'style', 'script', 'meta', 'link', 'title'].includes(target.type)
    ) {
      notify('Select a visual HTML element to create a state.');
      return;
    }
    const config = options || {
        kind: this.host.querySelector('[data-hs-kind]')?.value || 'hover',
        name: this.host.querySelector('[data-hs-name]')?.value || 'expanded',
      },
      kind = config.kind || 'hover';
    let created;
    if (
      this.mutate('Create HTML ' + kind + ' state', (doc) => {
        created = createHtmlState(doc, target.id, config);
      })
    ) {
      this.stateId = created.id;
      this.nodeId = target.id;
      this.active = true;
      this.catalog = this.read();
      this.render();
    }
    return created;
  }
  selectState(id) {
    this.recording = false;
    this.preview?.clear();
    this.stateId = id || null;
    this.active = !!id;
    this.catalog = this.read();
    if (this.state && this.nodeId) this.preview?.setState(this.state, this.nodeId);
    this.syncMotion();
    this.render();
    this.s.renderInspector();
    this.html.selection();
  }
  toggleRecord() {
    if (!this.state) {
      notify('Choose a state first. Base styles are edited with recording off.');
      return;
    }
    this.html.motion.pause();
    this.html.motion.recording = false;
    this.html.motion.transport();
    this.recording = !this.recording;
    this.active = true;
    if (this.state && this.nodeId) this.preview?.setState(this.state, this.nodeId);
    this.syncMotion();
    this.render();
    this.s.renderInspector();
  }
  trigger() {
    if (!this.state || !this.nodeId) {
      notify('Choose an element and state.');
      return;
    }
    this.html.motion.pause();
    this.preview?.clear();
    this.renderer?.frame.contentDocument.documentElement.getBoundingClientRect();
    this.active = true;
    try {
      this.preview?.setState(this.state, this.nodeId, { transitions: true });
      this.syncMotion();
      this.render();
      this.html.selection();
    } catch (error) {
      notify(error.message);
    }
  }
  reapply() {
    if (this.active && this.state && this.nodeId) {
      try {
        this.preview?.setState(this.state, this.nodeId);
        this.syncMotion();
      } catch {}
    }
  }
  syncMotion() {
    this.html.motion.preview?.refresh().seek(this.html.motion.time);
  }
  reset() {
    this.preview?.clear();
    this.syncMotion();
    this.active = false;
    this.recording = false;
    if (isHtml(this.s.doc)) {
      this.render();
      this.html.selection();
    }
  }
  /** Apply CSS edits to the chosen state inside the caller's single document transaction. */
  recordMutation(doc, action) {
    if (!this.recording || !this.state) {
      action(doc);
      return;
    }
    const state = this.state,
      before = new Map();
    walk(doc.root, (n) => {
      if (n.kind === 'element')
        before.set(n.id, { source: n.props.style, values: cssValues(n.props.style) });
    });
    action(doc);
    const changes = [];
    walk(doc.root, (n) => {
      const old = before.get(n.id);
      if (!old || old.source === n.props.style) return;
      const edited = n.props.style,
        after = cssValues(edited),
        values = htmlStateStyleChanges(old.values, after, (key) => {
          this.preview?.clear();
          return this.html.motion.resolveRemovedValue(n.id, key, edited);
        });
      if (!Object.keys(values).length) return;
      if (
        [...new Set([...old.values.keys(), ...after.keys()])].every(
          (k) => old.values.get(k) === after.get(k) || !/^(animation|transition)(-|$)/.test(k),
        )
      ) {
        if (old.source === undefined) delete n.props.style;
        else n.props.style = old.source;
      } else {
        const probe = document.createElement('span');
        probe.style.cssText = edited || '';
        for (const k of Object.keys(values)) {
          const prior = old.values.get(k);
          if (prior)
            probe.style.setProperty(
              k,
              plain(prior),
              /!important\s*$/i.test(prior) ? 'important' : '',
            );
          else probe.style.removeProperty(k);
        }
        if (probe.style.cssText) n.props.style = probe.style.cssText;
        else delete n.props.style;
      }
      changes.push({ id: n.id, values });
    });
    for (const { id, values } of changes) {
      let targetState = state;
      if (!state.targetIds.includes(id)) {
        targetState =
          listHtmlStates(doc, { elements: this.renderer?.elements }).states.find(
            (s) => s.targetIds.includes(id) && s.kind === state.kind && s.name === state.name,
          ) ||
          createHtmlState(doc, id, {
            kind: state.kind,
            name: state.name,
            attribute: state.attribute,
            value: state.value,
            values: {},
          });
      }
      recordHtmlStateProperties(doc, targetState.id, id, values);
    }
  }
  decorateInspector(host) {
    if (!this.recording || !this.state || !this.state.targetIds.includes(this.s.store.selection[0]))
      return;
    host.querySelectorAll('[data-html-css]').forEach((input) => {
      const value = this.state.values[input.dataset.htmlCss];
      if (value !== undefined) input.value = plain(value);
    });
    const note = document.createElement('div');
    note.className = 'html-state-recording-note';
    note.textContent =
      '● Recording ' + this.state.name + ' state. CSS changes are stored in its rule.';
    host.prepend(note);
  }
  values() {
    return this.state?.values || {};
  }
  render() {
    if (!this.host || !isHtml(this.s.doc)) return;
    const scroll = this.host.scrollTop,
      selected = this.target,
      state = this.state,
      nodes = [];
    walk(this.s.doc.root, (n) => {
      if (
        n.kind === 'element' &&
        !['html', 'head', 'style', 'script', 'meta', 'link', 'title'].includes(n.type)
      )
        nodes.push(n);
    });
    const relevant = this.catalog.states.filter(
        (s) => !this.nodeId || s.targetIds.includes(this.nodeId),
      ),
      all = this.catalog.states;
    let transitions = [],
      diagnostic = '';
    try {
      transitions =
        this.transitionScope === 'state' && state
          ? getHtmlStateTransitions(this.s.doc, state.id)
          : selected
            ? getHtmlTransitions(this.s.doc, selected.id, { elements: this.renderer?.elements })
            : [];
    } catch (error) {
      diagnostic = error.message;
    }
    let interactions = [];
    try {
      interactions = listHtmlStateInteractions(this.s.doc);
    } catch (error) {
      diagnostic = [diagnostic, error.message].filter(Boolean).join(' · ');
    }
    const values = this.values(),
      simpleColor = (v) => /^#[\da-f]{6}$/i.test(plain(v));
    this.host.innerHTML = `<header><strong>States & transitions</strong><button data-hs-timeline>◇ Keyframes</button><button data-hs-example>Example</button></header><select class="hs-target" data-hs-target aria-label="State target"><option value="">Select an HTML element</option>${nodes.map((n) => option(n.id, this.nodeId, n.type + ' · ' + label(n))).join('')}</select><div class="hs-states" role="group" aria-label="Element states"><button data-hs-state="" class="${!state ? 'active' : ''}">Base</button>${relevant.map((s) => `<button data-hs-state="${esc(s.id)}" class="${s.id === this.stateId ? 'active' : ''}">${esc(s.name)}</button>`).join('')}</div><div class="hs-create"><select data-hs-kind aria-label="New state kind">${kinds.map((k) => option(k, 'hover')).join('')}</select><input data-hs-name value="expanded" placeholder="State name" aria-label="New state name"><button data-hs-create ${selected ? '' : 'disabled'}>＋ State</button></div><div class="hs-actions"><button data-hs-record ${state ? '' : 'disabled'} class="${this.recording ? 'recording' : ''}" aria-pressed="${this.recording}">${this.recording ? '● Recording' : '● Record CSS'}</button><button data-hs-trigger ${state ? '' : 'disabled'}>▶ Transition to state</button><button data-hs-reset>Reset preview</button><button data-hs-delete ${state ? '' : 'disabled'}>Delete state</button></div>${state ? `<code class="hs-selector">${esc(state.selector)}</code>` : '<p class="hs-hint">Base is the authored element style. Select or create a CSS state, then record property-panel and canvas edits.</p>'}
  <details open><summary>State CSS properties</summary>${
    state
      ? Object.entries(values)
          .filter(([k]) => !k.startsWith('transition'))
          .map(
            ([k, v]) =>
              `<div class="hs-value"><code>${esc(k)}</code><span class="hs-rich-value">${simpleColor(v) ? `<input type="color" data-hs-color="${esc(k)}" value="${plain(v)}" aria-label="${esc(k)} color">` : ''}<input data-hs-value="${esc(k)}" value="${esc(v)}" aria-label="${esc(k)} state value"></span><button data-hs-remove-value="${esc(k)}" aria-label="Remove ${esc(k)}">×</button></div>`,
          )
          .join('')
      : '<p class="hs-hint">No state selected.</p>'
  }<div class="hs-create"><input data-hs-property list="html-state-properties" value="opacity" aria-label="State CSS property"><input data-hs-property-value value="0.6" aria-label="New state CSS value"><button data-hs-add-value ${state ? '' : 'disabled'}>Add</button></div><datalist id="html-state-properties">${properties.map((p) => `<option>${p}</option>`).join('')}</datalist></details>
  <details open><summary>Transitions</summary><label class="hs-scope">Apply to<select data-hs-transition-scope>${option('element', this.transitionScope, 'Element base style')}${state ? option('state', this.transitionScope, 'Selected state rule') : ''}</select></label>${transitions.map((t, i) => `<div class="hs-transition" data-hs-transition="${i}">${['property', 'duration', 'delay', 'easing', 'behavior'].map((k) => `<label>${k}${k === 'behavior' ? `<select data-hs-transition-field="${k}">${['normal', 'allow-discrete'].map((v) => option(v, t[k])).join('')}</select>` : `<input data-hs-transition-field="${k}" value="${esc(t[k])}" ${['duration', 'delay'].includes(k) ? `type="number" step="10" ${k === 'duration' ? 'min="0"' : ''}` : ''} ${k === 'easing' ? 'list="html-state-easings"' : ''}>`}${['duration', 'delay'].includes(k) ? '<small>milliseconds</small>' : ''}</label>`).join('')}<button data-hs-remove-transition="${i}">Remove</button></div>`).join('')}<button data-hs-add-transition ${selected ? '' : 'disabled'}>＋ Transition</button><datalist id="html-state-easings">${['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'steps(4, end)', 'cubic-bezier(0.16, 1, 0.3, 1)'].map((v) => `<option>${esc(v)}</option>`).join('')}</datalist></details>
  <details open><summary>Preview interactions</summary><p class="hs-hint">Named states can be toggled by exported event bindings. Pseudo states use native browser hover, focus, active, disabled and checked behavior.</p><div class="hs-interaction"><select data-hs-trigger-node aria-label="Interaction trigger">${nodes.map((n) => option(n.id, this.nodeId, n.type + ' · ' + label(n))).join('')}</select><select data-hs-event aria-label="Interaction event">${['click', 'dblclick', 'pointerenter', 'pointerleave', 'focusin', 'focusout', 'change', 'input'].map((v) => option(v, 'click')).join('')}</select><select data-hs-action aria-label="State interaction action">${['toggle', 'set', 'clear'].map((v) => option(v, 'toggle')).join('')}</select></div><button data-hs-bind-interaction ${state?.kind === 'named' ? '' : 'disabled'}>Bind event to ${esc(state?.name || 'named state')}</button>${interactions.map((b, i) => `<div class="hs-binding"><span>${esc(label(find(this.s.doc.root, b.triggerNodeId)))} · ${esc(b.event)} → ${esc(b.action)} ${esc(b.stateName || b.name || 'state')}</span><button data-hs-remove-interaction="${i}">×</button></div>`).join('')}<button data-hs-preview>Open interactive preview</button></details>
  <details><summary>All document states</summary><select data-hs-document-state aria-label="All document states"><option value="">Choose a state rule</option>${all.map((s) => option(s.id, this.stateId, s.name + ' · ' + s.selector)).join('')}</select><button data-hs-bind-state ${state?.binding && selected ? '' : 'disabled'}>Bind selected state to element</button></details><footer role="status">${esc(diagnostic || this.catalog.diagnostics.map((d) => d.message).join(' · ') || (this.recording ? 'State recording is active. Base styles are preserved.' : this.active ? 'State preview is temporary. The source and undo history contain authored edits only.' : 'Ready. CSS rules and event bindings are included in HTML source and export.'))}</footer>`;
    const q = (sel) => this.host.querySelector(sel);
    q('[data-hs-target]').onchange = (e) => {
      this.s.store.select(e.target.value ? [e.target.value] : []);
    };
    this.host
      .querySelectorAll('[data-hs-state]')
      .forEach((b) => (b.onclick = () => this.selectState(b.dataset.hsState)));
    q('[data-hs-create]').onclick = () => this.create();
    q('[data-hs-record]').onclick = () => this.toggleRecord();
    q('[data-hs-trigger]').onclick = () => this.trigger();
    q('[data-hs-reset]').onclick = () => {
      this.reset();
      this.s.renderInspector();
    };
    q('[data-hs-timeline]').onclick = () => this.s.docking.showTimeline();
    q('[data-hs-example]').onclick = () => this.openExample();
    q('[data-hs-delete]').onclick = () => {
      const id = this.stateId;
      this.reset();
      if (this.mutate('Delete HTML state', (doc) => removeHtmlState(doc, id))) {
        this.stateId = null;
        this.refresh();
      }
    };
    const edit = (values) => {
      if (
        this.mutate('Edit HTML state CSS', (doc) =>
          recordHtmlStateProperties(doc, state.id, this.nodeId, values),
        )
      )
        this.s.renderInspector();
    };
    this.host
      .querySelectorAll('[data-hs-value]')
      .forEach((el) => (el.onchange = () => edit({ [el.dataset.hsValue]: el.value || null })));
    this.host
      .querySelectorAll('[data-hs-color]')
      .forEach((el) => (el.onchange = () => edit({ [el.dataset.hsColor]: el.value })));
    this.host
      .querySelectorAll('[data-hs-remove-value]')
      .forEach((el) => (el.onclick = () => edit({ [el.dataset.hsRemoveValue]: null })));
    q('[data-hs-add-value]').onclick = () =>
      edit({ [q('[data-hs-property]').value]: q('[data-hs-property-value]').value });
    const saveTransitions = (items) =>
      this.mutate('Edit HTML transitions', (doc) =>
        this.transitionScope === 'state' && state
          ? setHtmlStateTransitions(doc, state.id, items)
          : setHtmlTransitions(doc, this.nodeId, items, { elements: this.renderer?.elements }),
      );
    q('[data-hs-transition-scope]').onchange = (e) => {
      this.transitionScope = e.target.value;
      this.render();
    };
    this.host.querySelectorAll('[data-hs-transition]').forEach((row) =>
      row.querySelectorAll('[data-hs-transition-field]').forEach(
        (input) =>
          (input.onchange = () => {
            const next = transitions.map((t) => ({ ...t })),
              key = input.dataset.hsTransitionField;
            next[Number(row.dataset.hsTransition)][key] = ['duration', 'delay'].includes(key)
              ? Number(input.value)
              : input.value;
            saveTransitions(next);
          }),
      ),
    );
    this.host
      .querySelectorAll('[data-hs-remove-transition]')
      .forEach(
        (el) =>
          (el.onclick = () =>
            saveTransitions(
              transitions.filter((_, i) => i !== Number(el.dataset.hsRemoveTransition)),
            )),
      );
    q('[data-hs-add-transition]').onclick = () =>
      saveTransitions([
        ...transitions,
        { property: 'all', duration: 300, delay: 0, easing: 'ease', behavior: 'normal' },
      ]);
    q('[data-hs-bind-interaction]').onclick = () =>
      this.mutate('Bind HTML state interaction', (doc) =>
        bindHtmlStateInteraction(doc, state.id, {
          triggerNodeId: q('[data-hs-trigger-node]').value,
          event: q('[data-hs-event]').value,
          action: q('[data-hs-action]').value,
        }),
      );
    this.host
      .querySelectorAll('[data-hs-remove-interaction]')
      .forEach(
        (el) =>
          (el.onclick = () =>
            this.mutate('Remove HTML state interaction', (doc) =>
              removeHtmlStateInteraction(
                doc,
                interactions[Number(el.dataset.hsRemoveInteraction)].id,
              ),
            )),
      );
    q('[data-hs-preview]').onclick = () => this.html.preview();
    q('[data-hs-document-state]').onchange = (e) => {
      const next = this.catalog.states.find((s) => s.id === e.target.value);
      if (next) {
        const targetId = next.targetIds.includes(this.nodeId)
          ? this.nodeId
          : next.targetIds.find((id) => nodes.some((n) => n.id === id));
        if (targetId) {
          this.s.store.select([targetId]);
          this.nodeId = targetId;
        }
        this.selectState(next.id);
      }
    };
    q('[data-hs-bind-state]').onclick = () =>
      this.mutate('Bind HTML state', (doc) => bindHtmlState(doc, state.id, this.nodeId));
    this.host.onkeydown = (e) => {
      if (e.target.closest('input,select,textarea')) {
        e.stopPropagation();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.reset();
      }
    };
    this.host.scrollTop = scroll;
  }
}
