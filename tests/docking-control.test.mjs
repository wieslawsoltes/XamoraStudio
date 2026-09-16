import test from 'node:test';
import assert from 'node:assert/strict';
import { DockLayout, createDockLayout, locatePanel, dockGroups } from '../dist/core/docking.js';
import { DockWorkspace } from '../dist/controls/dock-workspace.js';
import { DockingStudio } from '../dist/studio/docking-studio.js';
import { parseXaml } from '../dist/core/xaml.js';
import { builtins } from '../dist/core/registry.js';
import { PreviewRenderer } from '../dist/core/render.js';
import { listStoryboards } from '../dist/core/animation.js';
import { installDockDOM } from './docking-dom.mjs';
function fixture() {
  const dom = installDockDOM(),
    host = dom.element();
  document.body.append(host);
  const panels = [
      { id: 'document:one', kind: 'document', title: 'View' },
      { id: 'xaml', kind: 'document', title: 'Source' },
      { id: 'layers', kind: 'tool', title: 'Layers' },
      { id: 'toolkit', kind: 'tool', title: 'Toolbox' },
    ],
    model = new DockLayout(
      panels,
      createDockLayout(
        panels.map((p) => p.id),
        { documents: ['document:one'] },
      ),
    ),
    control = new DockWorkspace(host, model),
    nodes = new Map();
  for (const p of panels) {
    const node = dom.element();
    nodes.set(p.id, node);
    control.mount(p.id, node);
  }
  control.render();
  return { dom, host, model, control, nodes };
}
test('docking moves live editor nodes without replacing buffer selection scroll or listeners', () => {
  const { dom, model, control, nodes } = fixture(),
    input = dom.element('textarea');
  input.value = '<Grid>unsaved';
  input.scrollTop = 120;
  input.setSelectionRange(4, 9);
  let edits = 0;
  input.addEventListener('input', () => edits++);
  nodes.get('xaml').append(input);
  input.focus();
  model.float('xaml');
  assert.equal(document.activeElement, input);
  assert.equal(input.value, '<Grid>unsaved');
  assert.equal(input.scrollTop, 120);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [4, 9]);
  model.dockBack('xaml');
  assert.equal(nodes.get('xaml').querySelector('textarea'), input);
  input.dispatchEvent({ type: 'input' });
  assert.equal(edits, 1);
  control.dispose();
});
test('focus inside panel content updates active window without remounting content', () => {
  const { dom, model, control, nodes } = fixture(),
    input = dom.element('input');
  nodes.get('xaml').append(input);
  input.focus();
  const parent = input.parentElement;
  control.contentFocus({ type: 'focusin', target: input });
  assert.equal(model.state.activePanel, 'xaml');
  assert.equal(input.parentElement, parent);
  assert.equal(document.activeElement, input);
  control.dispose();
});
test('auto-hide keeps focus while entering flyout and closes on external focus', () => {
  const { dom, model, control, nodes } = fixture();
  model.autoHide('layers', 'left');
  control.activate('layers');
  assert.equal(control.flyout, 'layers');
  const input = dom.element('input');
  nodes.get('layers').append(input);
  control.contentFocus({ type: 'focusin', target: input });
  assert.equal(control.flyout, 'layers');
  control.contentFocus({ type: 'focusin', target: nodes.get('xaml') });
  assert.equal(control.flyout, null);
  control.dispose();
});
test('empty docking root accepts a dock destination and Control suppresses it', () => {
  const { dom, model, control } = fixture();
  model.hide([...model.panels.keys()]);
  const e = { clientX: 300, clientY: 200, ctrlKey: false, metaKey: false };
  assert.equal(control.dropAt(e, ['layers'], 'old').position, 'center');
  assert.equal(control.dropAt({ ...e, ctrlKey: true }, ['layers'], 'old'), null);
  control.dispose();
});
test('split compass cannot offer joining tabs directly to a split node', () => {
  const { model, control } = fixture();
  assert.equal(
    control.validDrop({ id: model.state.root.id, position: 'center' }, ['layers'], 'old'),
    null,
  );
  control.dispose();
});
function studioFixture() {
  const dom = installDockDOM(),
    studioNode = dom.element('main', 'studio', 'studio'),
    top = dom.element('header', null, 'topbar'),
    search = dom.element('button', null, 'top-command'),
    work = dom.element('div', null, 'workspace'),
    left = dom.element('aside', null, 'left-panel'),
    right = dom.element('aside', null, 'right-panel'),
    center = dom.element('section', null, 'center'),
    leftContent = dom.element('div', 'left-content'),
    inspector = dom.element('div', 'inspector'),
    notes = dom.element('span', 'notes-count'),
    code = dom.element('section', 'code-panel'),
    viewport = dom.element('div', 'canvas-viewport');
  top.append(search);
  left.append(leftContent);
  right.append(notes, inspector);
  center.append(viewport, code);
  work.append(left, center, right);
  studioNode.append(top, work);
  document.body.append(studioNode, dom.element('div', 'modal-root'));
  const docs = [
    parseXaml(
      '<Grid xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><Grid.Resources><Storyboard x:Key="Fade"><DoubleAnimation Storyboard.TargetProperty="Opacity" To="0" Duration="0:0:1"/></Storyboard></Grid.Resources><TextBlock Text="One"/></Grid>',
      { name: 'One.xaml' },
    ),
    parseXaml('<Grid><TextBlock Text="Two"/></Grid>', { name: 'Two.xaml' }),
  ];
  const s = {
    stores: docs.map((document) => ({ document })),
    active: 0,
    leftTab: 'layers',
    rightTab: 'design',
    view: 'split',
    registry: builtins(),
    selected: [],
    issues: [],
    scopeId: null,
    editor: { dirty: false, valid: true },
    drawGrid() {},
    drawSelection() {},
    prepareEdit() {
      this.prepares = (this.prepares || 0) + 1;
      return !this.editor.dirty || this.editor.valid;
    },
    get doc() {
      return this.stores[this.active].document;
    },
    leftHost(tab = this.leftTab) {
      return document.querySelector(`[data-left-host="${tab}"]`) || leftContent;
    },
    inspectorHost(tab = this.rightTab) {
      return document.querySelector(`[data-inspector-host="${tab}"]`) || inspector;
    },
    renderLeft() {
      this.leftHost().textContent = this.leftTab;
    },
    renderInspector() {
      this.inspectorHost().textContent = this.rightTab;
    },
    renderCanvas() {},
    render() {
      this.renderLeft();
      this.renderInspector();
      this.renderCanvas();
    },
    switchDocument(index) {
      if (index === this.active || !this.prepareEdit()) return;
      this.active = index;
      this.render();
    },
    addStore(doc) {
      const store = { document: doc };
      this.stores.push(store);
      return store;
    },
    command() {},
    setView() {},
    modal() {},
    closeModal() {},
    chooseFile() {},
  };
  s.renderer = new PreviewRenderer(s.registry);
  s.features = {
    context: () => ({}),
    prototype: {
      board() {
        s.boardRenders = (s.boardRenders || 0) + 1;
        const old = document.getElementById('views-board');
        old?.remove();
        const n = dom.element('div', 'views-board');
        s.docking.viewsHost.append(n);
      },
      drawConnections() {},
    },
  };
  const animation = {
    open: false,
    record: false,
    previewing: false,
    storyId: null,
    player: { duration: 0, pause() {} },
    get story() {
      return this.storyId ? listStoryboards(s.doc).find((n) => n.id === this.storyId)?.node : null;
    },
    get duration() {
      return 1;
    },
    render() {
      if (!this.open) return;
      s.timelineRenders = (s.timelineRenders || 0) + 1;
      if (!document.getElementById('animation-panel'))
        s.docking.timelineHost.append(dom.element('section', 'animation-panel'));
    },
    stop() {
      this.record = false;
      this.previewing = false;
    },
    show() {
      s.docking.showTimeline();
    },
    restore() {},
  };
  s.blend = { animation };
  const docking = new DockingStudio(s);
  return {
    dom,
    s,
    docking,
    code,
    viewport,
    cleanup() {
      clearTimeout(docking.saveTimer);
      docking.control.dispose();
    },
  };
}
test('Studio mounts separate functional render hosts while retaining live canvas and source', () => {
  const f = studioFixture();
  assert.equal(f.s.leftHost('layers').textContent, 'layers');
  assert.equal(f.s.leftHost('toolkit').textContent, 'toolkit');
  assert.notEqual(f.s.inspectorHost('raw'), f.s.inspectorHost('design'));
  assert.equal(f.s.inspectorHost('flow').textContent, 'flow');
  assert.equal(document.getElementById('code-panel'), f.code);
  assert.equal(document.getElementById('canvas-viewport'), f.viewport);
  assert.equal(document.querySelectorAll('#notes-count').length, 1);
  f.cleanup();
});
test('Studio rejects document activation and close when pending XAML is invalid', () => {
  const f = studioFixture(),
    old = f.s.doc.id,
    target = 'document:' + f.s.stores[1].document.id;
  f.s.editor.dirty = true;
  f.s.editor.valid = false;
  assert.equal(f.docking.control.activate(target), false);
  assert.equal(f.s.doc.id, old);
  assert.equal(f.docking.control.hide('document:' + old), false);
  assert.notEqual(locatePanel(f.docking.model.state, 'document:' + old).kind, 'hidden');
  f.cleanup();
});
test('Studio document groups share one editable canvas and retain other page previews', () => {
  const f = studioFixture(),
    one = f.s.doc.id,
    two = f.s.stores[1].document.id;
  f.docking.control.activate('document:' + two);
  assert.equal(f.s.doc.id, two);
  assert.ok(f.docking.documentHosts.get(two).contains(f.docking.canvas));
  assert.ok(f.docking.documentHosts.get(one).querySelector('.dock-passive-document'));
  assert.equal(document.querySelectorAll('#canvas-viewport').length, 1);
  f.cleanup();
});
test('opening timeline through navigator initializes a storyboard and hiding stops recording', () => {
  const f = studioFixture();
  f.docking.control.show('timeline');
  assert.ok(f.s.blend.animation.storyId);
  assert.ok(f.s.timelineRenders > 0);
  f.s.blend.animation.record = true;
  f.s.blend.animation.previewing = true;
  f.docking.control.hide('timeline');
  assert.equal(f.s.blend.animation.record, false);
  assert.equal(f.s.blend.animation.previewing, false);
  f.cleanup();
});
test('Animation preset initializes timeline despite batched visibility changes', () => {
  const f = studioFixture();
  f.docking.preset('animation');
  assert.ok(f.docking.control.visible.has('timeline'));
  assert.ok(f.s.timelineRenders > 0);
  assert.ok(f.s.blend.animation.storyId);
  f.cleanup();
});
test('toggle reveals an inactive tab instead of closing its window', () => {
  const f = studioFixture();
  assert.equal(f.docking.control.visible.has('toolkit'), false);
  f.docking.toggle('toolkit');
  assert.equal(f.docking.control.visible.has('toolkit'), true);
  assert.notEqual(locatePanel(f.docking.model.state, 'toolkit').kind, 'hidden');
  f.cleanup();
});

test('changing preset stops a timeline that becomes hidden', () => {
  const f = studioFixture();
  f.docking.preset('animation');
  f.s.blend.animation.record = true;
  f.s.blend.animation.previewing = true;
  f.docking.preset('compact');
  assert.equal(f.docking.control.visible.has('timeline'), false);
  assert.equal(f.s.blend.animation.record, false);
  assert.equal(f.s.blend.animation.previewing, false);
  f.cleanup();
});

test('editor modes expose only their primary surfaces and use one layout undo step', () => {
  const f = studioFixture(),
    d = f.docking,
    m = d.model,
    id = 'document:' + f.s.doc.id;
  const count = m.history.length;
  d.setView('code');
  assert.ok(d.control.visible.has('xaml'));
  assert.equal(d.control.visible.has(id), false);
  assert.equal(d.control.visible.has('views'), false);
  assert.equal(m.history.length, count + 1);
  d.setView('views');
  assert.ok(d.control.visible.has('views'));
  assert.equal(d.control.visible.has('xaml'), false);
  d.setView('design');
  assert.ok(d.control.visible.has(id));
  assert.equal(d.control.visible.has('xaml'), false);
  d.setView('split');
  assert.ok(d.control.visible.has(id));
  assert.ok(d.control.visible.has('xaml'));
  f.cleanup();
});
test('Code to Design restores tiled and floating documents across serialization and undo', () => {
  const f = studioFixture(),
    d = f.docking,
    m = d.model,
    one = 'document:' + f.s.doc.id,
    two = 'document:' + f.s.stores[1].document.id;
  const third = parseXaml('<Grid/>', { name: 'Three.xaml' });
  f.s.addStore(third);
  m.dock(two, locatePanel(m.state, one).group.id, 'right');
  m.float('document:' + third.id, { x: 50, y: 60, width: 400, height: 320 });
  const firstGroup = locatePanel(m.state, one).group.id,
    secondGroup = locatePanel(m.state, two).group.id;
  d.setView('code');
  const code = m.serialize();
  d.setView('design');
  assert.equal(locatePanel(m.state, one).group.id, firstGroup);
  assert.equal(locatePanel(m.state, two).group.id, secondGroup);
  assert.deepEqual(locatePanel(m.state, 'document:' + third.id).floating.rect, {
    x: 50,
    y: 60,
    width: 400,
    height: 320,
  });
  m.undo();
  assert.equal(m.serialize(), code);
  m.load(code);
  d.setView('design');
  assert.equal(locatePanel(m.state, two).group.id, secondGroup);
  f.cleanup();
});
test('mode return keeps a user-closed document closed and repeated Split preserves ratio', () => {
  const f = studioFixture(),
    d = f.docking,
    m = d.model,
    two = 'document:' + f.s.stores[1].document.id;
  m.hide(two);
  d.setView('code');
  d.setView('split');
  assert.equal(locatePanel(m.state, two).kind, 'hidden');
  const source = locatePanel(m.state, 'xaml').group.id;
  let split;
  const visit = (n) => {
    if (n?.type === 'split') {
      if (n.first.id === source || n.second.id === source) split = n;
      visit(n.first);
      visit(n.second);
    }
  };
  visit(m.state.root);
  m.resizeSplit(split.id, 0.44);
  const before = m.serialize(),
    history = m.history.length;
  d.setView('split');
  assert.equal(m.serialize(), before);
  assert.equal(m.history.length, history);
  f.cleanup();
});
test('invalid XAML leaves mode, window arrangement, and history untouched', () => {
  const f = studioFixture(),
    m = f.docking.model,
    before = m.serialize(),
    count = m.history.length;
  f.s.editor.dirty = true;
  f.s.editor.valid = false;
  assert.equal(f.docking.setView('code'), false);
  assert.equal(m.serialize(), before);
  assert.equal(m.history.length, count);
  f.cleanup();
});
