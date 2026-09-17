import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  DockLayout,
  createDockLayout,
  dockGroup,
  dockSplit,
  dockGroups,
  findDock,
  locatePanel,
  validateDockLayout,
} from '../dist/core/docking.js';
import { DockWorkspace } from '../dist/controls/dock-workspace.js';
import { ScrollButtons } from '../dist/controls/scroll-buttons.js';
import { ChromeScroll } from '../dist/studio/chrome-scroll.js';
import {
  LayoutPreferences,
  readLayoutPreferences,
  LAYOUT_PREFERENCES_KEY,
} from '../dist/studio/layout-preferences.js';
import { installDockDOM } from './docking-dom.mjs';

const panels = [
  { id: 'a', kind: 'document', title: 'A' },
  { id: 'b', kind: 'document', title: 'B' },
  { id: 'tool', kind: 'tool', title: 'Tool' },
];
function model(keep = true) {
  return new DockLayout(
    panels,
    {
      ...createDockLayout(panels.map((p) => p.id)),
      root: dockSplit(
        'horizontal',
        dockGroup(['a', 'b'], 'document', 'docs'),
        dockGroup(['tool'], 'tool', 'tools'),
        0.73,
        'split',
      ),
      hidden: [],
      activePanel: 'a',
    },
    { keepEmptyDocumentGroups: keep },
  );
}
const check = (m) => validateDockLayout(m.state, new Set(m.panels.keys()));

test('closing the last document preserves its group, split identity and ratio', () => {
  const m = model();
  m.hide('a');
  m.hide('b');
  const group = findDock(m.state, 'docs');
  assert.deepEqual(group.panels, []);
  assert.equal(group.active, null);
  assert.equal(m.state.root.id, 'split');
  assert.equal(m.state.root.ratio, 0.73);
  assert.equal(m.state.activePanel, 'tool');
  check(m);
  m.show('a');
  assert.equal(locatePanel(m.state, 'a').group.id, 'docs');
  assert.equal(m.state.root.ratio, 0.73);
});

test('retention is opt-in for standalone consumers and explicitly configurable', () => {
  const m = model(false);
  m.hide(['a', 'b']);
  assert.equal(findDock(m.state, 'docs'), null);
  assert.equal(m.state.root.id, 'tools');
  assert.equal(new DockLayout().keepEmptyDocumentGroups, false);
  for (const value of ['true', null, 1]) {
    assert.throws(() => new DockLayout([], null, { keepEmptyDocumentGroups: value }), TypeError);
    assert.throws(() => createDockLayout([], { keepEmptyDocumentGroups: value }), TypeError);
  }
});

test('retained empty groups round-trip through serialize, load and constructor without mutating input', () => {
  const m = model();
  m.hide(['a', 'b']);
  const saved = m.serialize();
  const restored = new DockLayout(panels, JSON.parse(saved), { keepEmptyDocumentGroups: true });
  assert.equal(restored.serialize(), saved);
  const target = model();
  target.load(saved, { reconcile: true });
  assert.equal(target.serialize(), saved);
  target.load(saved);
  assert.equal(target.serialize(), saved);
  const collapsed = new DockLayout(panels, JSON.parse(saved));
  assert.equal(findDock(collapsed.state, 'docs'), null);
  assert.equal(m.serialize(), saved);
});

test('empty document format rejects active IDs, empty tool groups and empty floating groups atomically', () => {
  const m = model();
  m.hide(['a', 'b']);
  const before = m.serialize();
  for (const modify of [
    (d) => {
      findDock(d, 'docs').active = 'a';
    },
    (d) => {
      findDock(d, 'docs').kind = 'tool';
    },
    (d) => {
      d.floating.push({
        id: 'float',
        root: dockGroup([], 'document', 'empty-float'),
        rect: { x: 0, y: 0, width: 300, height: 200 },
      });
    },
  ]) {
    const invalid = JSON.parse(before);
    modify(invalid);
    assert.throws(() => m.load(invalid));
    assert.equal(m.serialize(), before);
  }
});

test('empty main document panels survive while empty tools and floating documents still close', () => {
  const m = model();
  m.float(['a', 'b']);
  assert.deepEqual(findDock(m.state, 'docs').panels, []);
  m.hide(['a', 'b']);
  assert.equal(m.state.floating.length, 0);
  m.hide('tool');
  assert.equal(m.state.root.id, 'docs');
  assert.equal(m.state.activePanel, null);
  check(m);
});

test('document moves and splits can target an empty document group', () => {
  const m = model();
  m.hide(['a', 'b']);
  m.dock('a', 'docs', 'left');
  assert.ok(findDock(m.state, 'docs'));
  m.dock('b', 'docs', 'center');
  assert.equal(locatePanel(m.state, 'b').group.id, 'docs');
  m.dock('tool', 'docs', 'center');
  check(m);
});

test('registry removal retains empty wells and newly registered documents reuse them', () => {
  const m = model();
  m.unregister('a');
  m.unregister('b');
  assert.equal(findDock(m.state, 'docs').active, null);
  m.register({ id: 'new', kind: 'document' });
  m.show('new');
  assert.equal(locatePanel(m.state, 'new').group.id, 'docs');
  m.undo();
  m.redo();
  assert.equal(locatePanel(m.state, 'new').group.id, 'docs');
  check(m);
});

test('close, reopen, undo and redo preserve the same empty well', () => {
  const m = model();
  m.hide(['a', 'b']);
  const empty = m.serialize();
  m.show('a');
  m.undo();
  assert.equal(m.serialize(), empty);
  m.redo();
  assert.equal(locatePanel(m.state, 'a').group.id, 'docs');
});

test('changing the preference migrates history and mode snapshots without adding an undo entry', () => {
  const m = model();
  m.hide(['a', 'b']);
  m.transaction('snapshot', (d) => {
    d.modeRestore = structuredClone(d);
  });
  m.show('a');
  m.undo();
  const counts = [m.history.length, m.future.length];
  m.setKeepEmptyDocumentGroups(false);
  assert.deepEqual([m.history.length, m.future.length], counts);
  assert.equal(findDock(m.state, 'docs'), null);
  assert.equal(findDock(m.state.modeRestore, 'docs'), null);
  assert.equal(m.setKeepEmptyDocumentGroups(false), false);
  for (const state of [m.state, ...m.history, ...m.future]) {
    assert.ok(dockGroups(state).every((g) => g.panels.length));
    validateDockLayout(state, new Set(m.panels.keys()));
  }
  m.redo();
  assert.equal(m.keepEmptyDocumentGroups, false);
  const before = m.serialize();
  assert.throws(() => m.setKeepEmptyDocumentGroups('true'), TypeError);
  assert.throws(() => m.batch('invalid', () => m.setKeepEmptyDocumentGroups(true)));
  assert.equal(m.serialize(), before);
  assert.equal(m.keepEmptyDocumentGroups, false);
});

test('explicit mode cleanup removes empty wells but does not disable future retention', () => {
  const m = model();
  m.hide(['a', 'b']);
  m.batch('mode', () => {
    m.show('a');
    m.hide('a');
    m.pruneEmptyGroups();
  });
  assert.equal(findDock(m.state, 'docs'), null);
  assert.equal(m.keepEmptyDocumentGroups, true);
  m.undo();
  assert.equal(findDock(m.state, 'docs').active, null);
});

test('an initially document-free standalone workspace can opt into a real empty well', () => {
  const m = new DockLayout([], null, { keepEmptyDocumentGroups: true });
  assert.equal(m.state.root.id, 'documents');
  assert.deepEqual(m.state.root.panels, []);
  m.register({ id: 'first', kind: 'document' });
  m.show('first');
  assert.equal(locatePanel(m.state, 'first').group.id, 'documents');
});

test('empty group renders a focusable drop target without invalid active-tab controls', () => {
  const dom = installDockDOM();
  const m = model();
  const host = dom.element();
  document.body.append(host);
  const view = new DockWorkspace(host, m);
  for (const panel of panels) view.mount(panel.id, dom.element());
  m.hide(['a', 'b']);
  const empty = view.query('[data-dock-group="docs"]');
  assert.equal(empty.tabIndex, 0);
  assert.equal(empty.getAttribute('aria-label'), 'Empty document panel');
  assert.equal(empty.querySelector('button'), null);
  assert.equal(view.strips.has('docs'), false);
  dom.document.hit = empty;
  const drop = view.dropAt({ target: empty, clientX: 500, clientY: 320 }, ['a'], null);
  assert.equal(drop.id, 'docs');
  assert.equal(drop.position, 'center');
  view.move(['a'], drop.id, drop.position);
  assert.equal(locatePanel(m.state, 'a').group.id, 'docs');
  view.dispose();
});

test('scroll controls are hidden unless tabs actually overflow, including the self-created overflow threshold', async () => {
  const window = new Window();
  const viewport = window.document.createElement('div');
  let fullWidth = 200,
    contentWidth = 190;
  const strip = new ScrollButtons(viewport);
  window.document.body.append(strip.host);
  Object.defineProperty(strip.previous, 'offsetWidth', {
    get: () => (strip.previous.hidden ? 0 : 18),
  });
  Object.defineProperty(strip.next, 'offsetWidth', { get: () => (strip.next.hidden ? 0 : 18) });
  Object.defineProperty(viewport, 'clientWidth', {
    get: () => fullWidth - strip.previous.offsetWidth - strip.next.offsetWidth,
  });
  Object.defineProperty(viewport, 'scrollWidth', {
    get: () => Math.max(contentWidth, viewport.clientWidth),
  });
  assert.equal(strip.previous.hidden, true);
  strip.update();
  assert.equal(strip.next.hidden, true);
  contentWidth = 210;
  strip.update();
  assert.equal(strip.next.hidden, false);
  contentWidth = 190;
  for (let i = 0; i < 5; i++) strip.update();
  assert.equal(strip.next.hidden, true);
  assert.equal(strip.next.disabled, true);
  fullWidth = 180;
  strip.update();
  assert.equal(strip.next.hidden, false);
  fullWidth = 500;
  strip.update();
  assert.equal(strip.previous.hidden, true);
  strip.dispose();
  await window.happyDOM.abort();
});

test('application chrome retains native scrolling without arrow controls and disposes in place', async () => {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML =
    '<main><header class="topbar"><button>A</button></header><nav class="ide-menubar"></nav><div class="toolbar"></div><footer class="statusbar"></footer></main>';
  const nodes = [...document.querySelector('main').children];
  const chrome = new ChromeScroll({ docking: { control: { document } } });
  assert.equal(document.querySelectorAll('.strip-scroll-button').length, 0);
  assert.equal(document.querySelectorAll('.chrome-scroll-wrapper').length, 4);
  for (const node of nodes) assert.ok(node.classList.contains('scroll-button-viewport'));
  chrome.dispose();
  chrome.dispose();
  assert.deepEqual([...document.querySelector('main').children], nodes);
  await window.happyDOM.abort();
});

test('layout preferences default to retained wells and hidden tips and validate stored values', () => {
  const load = (value) => readLayoutPreferences({ getItem: () => value });
  assert.deepEqual(load(null), { keepEmptyDocumentGroups: true, showCanvasTips: false });
  assert.deepEqual(load('{"keepEmptyDocumentGroups":false,"showCanvasTips":true}'), {
    keepEmptyDocumentGroups: false,
    showCanvasTips: true,
  });
  assert.deepEqual(load('{"keepEmptyDocumentGroups":"false","showCanvasTips":1}'), load(null));
  assert.deepEqual(load('not json'), load(null));
  assert.deepEqual(
    readLayoutPreferences({
      getItem() {
        throw Error('blocked');
      },
    }),
    load(null),
  );
});

test('preference commands apply and persist without changing authored state, then clean up', async () => {
  const window = new Window();
  const hint = window.document.createElement('div');
  hint.className = 'canvas-hint';
  const canvas = window.document.createElement('section');
  canvas.append(hint);
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  const studio = {
    doc: { source: 'unchanged' },
    docking: { model: model(), canvas },
    menus: { menus: [{ label: 'View', children: [] }], commands: new Map() },
  };
  const prefs = new LayoutPreferences(studio, { storage });
  assert.equal(hint.hidden, true);
  studio.menus.commands.get('layout:canvas-tips').run();
  assert.equal(hint.hidden, false);
  assert.equal(hint.dataset.tipsVisible, 'true');
  studio.menus.commands.get('layout:keep-empty-documents').run();
  assert.equal(studio.docking.model.keepEmptyDocumentGroups, false);
  assert.deepEqual(JSON.parse(data.get(LAYOUT_PREFERENCES_KEY)), {
    keepEmptyDocumentGroups: false,
    showCanvasTips: true,
  });
  assert.deepEqual(studio.doc, { source: 'unchanged' });
  assert.throws(() => prefs.set('showCanvasTips', 'false'), TypeError);
  assert.throws(() => prefs.set('__proto__', true), TypeError);
  prefs.dispose();
  prefs.dispose();
  assert.equal(studio.menus.commands.size, 0);
  assert.equal(studio.menus.menus[0].children.length, 0);
  assert.equal(prefs.set('showCanvasTips', false), false);
  await window.happyDOM.abort();
});
