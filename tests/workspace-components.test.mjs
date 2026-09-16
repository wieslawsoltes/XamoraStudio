import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { LabHost } from '../dist/examples/WorkspaceLab/host.js';
import { WorkspaceContext } from '../dist/workspaces/workspace-context.js';
import { CanvasController } from '../dist/workspaces/canvas-controller.js';
import { BlendFeatures } from '../dist/workspaces/blend-features.js';
import { TimelineWorkspace } from '../dist/workspaces/timeline-workspace.js';
import { ResourceWorkspace } from '../dist/workspaces/resource-workspace.js';
import { RichProperties } from '../dist/workspaces/rich-properties.js';
import { SolutionWorkspace } from '../dist/workspaces/solution-workspace.js';
import { DataEditor } from '../dist/workspaces/data-editor.js';
import { HtmlWorkspace } from '../dist/workspaces/html-workspace.js';
import { createDatabase } from '../dist/core/design-data.js';

function fixture(t) {
  const dom = controlDOM(t),
    messages = [];
  const host = new LabHost(dom.host(), dom.host(), { notify: (message) => messages.push(message) });
  const parts = [];
  t.after(() => {
    for (const part of parts.reverse()) part.dispose();
    host.dispose();
  });
  const own = (part) => {
    parts.push(part);
    return part;
  };
  return { ...dom, host, own, messages };
}

test('workspace contexts isolate selectors, keyboard events, API and storage in two live roots', (t) => {
  const { window, host } = controlDOM(t),
    a = host(),
    b = host();
  a.innerHTML = '<input id="value">';
  b.innerHTML = '<input id="value">';
  const one = new WorkspaceContext({ root: a }),
    two = new WorkspaceContext({ root: b });
  t.after(() => {
    one.dispose();
    two.dispose();
  });
  assert.notEqual(one.query('#value'), two.query('#value'));
  one.storage.setItem('key', 'one');
  assert.equal(two.storage.getItem('key'), null);
  let first = 0,
    second = 0;
  one.listen(window.document, 'keydown', () => first++);
  two.listen(window.document, 'keydown', () => second++);
  one
    .query('#value')
    .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(first, 1);
  assert.equal(second, 0);
  one.dispose();
  one
    .query('#value')
    .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(first, 1);
});

test('out-of-order component disposal bypasses captured hooks without overwriting external replacements', (t) => {
  const { host } = controlDOM(t),
    root = host(),
    a = new WorkspaceContext({ root }),
    b = new WorkspaceContext({ root });
  const original = function (value) {
      return value + 1;
    },
    target = { run: original };
  const before = target.run.bind(target);
  a.override(target, 'run', (v) => before(v) * 2);
  const wrapped = target.run.bind(target);
  b.override(target, 'run', (v) => wrapped(v) + 3);
  assert.equal(target.run(2), 9);
  a.dispose();
  assert.equal(target.run(2), 6);
  b.dispose();
  assert.equal(target.run, original);
  const c = new WorkspaceContext({ root });
  c.override(target, 'run', () => 0);
  const external = () => 42;
  target.run = external;
  c.dispose();
  assert.equal(target.run, external);
});

test('canvas workspace restores host methods and tabindex when released', (t) => {
  const { host, own } = fixture(t),
    before = host.pointerDown,
    viewport = host.root.querySelector('#canvas-viewport');
  const canvas = own(new CanvasController(host));
  assert.notEqual(host.pointerDown, before);
  assert.equal(viewport.tabIndex, 0);
  host.store.select([host.doc.root.children[0].id]);
  canvas.dispose();
  assert.equal(host.pointerDown, before);
  assert.equal(viewport.hasAttribute('tabindex'), false);
});

test('motion, timeline, states, brushes and resource libraries author the same document history outside Studio', (t) => {
  const { host, own } = fixture(t);
  const blend = own(new BlendFeatures(host));
  own(new TimelineWorkspace(host));
  own(new SolutionWorkspace(host));
  host.rich = own(new RichProperties(host));
  host.resources = own(new ResourceWorkspace(host));
  host.store.select([host.doc.root.children[0].id]);
  blend.animation.newStoryboard();
  assert(blend.animation.story);
  assert(host.store.history.length > 0);
  blend.states();
  assert.match(host.dialogHost.element.textContent, /state/i);
  host.closeModal();
  host.resources.create('SolidColorBrush');
  assert.equal(
    host.resources.entries().filter((entry) => entry.node.type === 'SolidColorBrush').length,
    1,
  );
  host.closeModal();
  host.rich.commit(host.store.selection, 'Width', '175');
  assert.equal(host.selected[0].props.Width, '175');
  host.store.undo();
  assert.equal(host.selected[0].props.Width, '120');
});

test('solution and data editors work with application-owned snapshots, dialogs and undo', (t) => {
  const { host, own } = fixture(t);
  own(new BlendFeatures(host));
  const solution = own(new SolutionWorkspace(host));
  host.data = own(new DataEditor(host));
  assert.equal(solution.model.startupId, host.doc.id);
  assert(host.panels.has('solution'));
  host.data.loadSample();
  assert(host.data.db.tables.length > 0);
  assert(host.dialogHost.isOpen);
  assert(host.snapshot);
  const after = host.data.db.tables.length;
  host.store.undo();
  assert.equal(host.data.db.tables.length, 0);
  host.store.redo();
  assert.equal(host.data.db.tables.length, after);
  host.closeModal();
  solution.dispose();
  assert(!host.panels.has('solution'));
  assert.equal(host.solution, undefined);
});

test('HTML authoring and its motion/state libraries mount and dispose without Studio singletons', (t) => {
  const { host, own } = fixture(t);
  own(new BlendFeatures(host));
  own(new TimelineWorkspace(host));
  own(new SolutionWorkspace(host));
  const before = host.render,
    html = own(new HtmlWorkspace(host));
  assert(host.htmlAnimation);
  assert(host.htmlStates);
  assert(host.panels.has('html-states'));
  assert.equal(host.menus.commands.has('html-interaction-example'), true);
  html.dispose();
  assert.equal(host.render, before);
  assert.equal(host.htmlAnimation, undefined);
  assert.equal(host.htmlStates, undefined);
  assert.equal(host.html, undefined);
  assert.equal(host.menus.commands.has('html-interaction-example'), false);
  assert.equal(host.root.querySelector('#html-animation-panel'), null);
});

test('legacy imports are the exact independently packaged constructors', async () => {
  for (const file of [
    'canvas-controller',
    'blend-features',
    'animation-editor',
    'timeline-workspace',
    'resource-workspace',
    'rich-properties',
    'solution-workspace',
    'data-editor',
    'html-workspace',
    'html-animation-workspace',
    'html-states-workspace',
    'motion-runtime',
  ]) {
    const a = await import('../dist/studio/' + file + '.js'),
      b = await import('../dist/workspaces/' + file + '.js');
    for (const name of Object.keys(a)) assert.equal(a[name], b[name], file + ':' + name);
  }
});

test('partial constructor failure rolls back already installed host hooks and root ownership', (t) => {
  const { host, own } = fixture(t),
    original = host.pointerDown;
  const tree = host.root.querySelector('#left-content'),
    parent = tree.parentElement;
  tree.remove();
  assert.throws(() => new CanvasController(host));
  assert.equal(host.pointerDown, original);
  parent.append(tree);
  const canvas = own(new CanvasController(host));
  assert.throws(() => new CanvasController(host), /already owns/);
  canvas.dispose();
  const next = own(new CanvasController(host));
  assert.equal(next.disposed, false);
});

test('disposed contexts cancel scheduled work, restore handlers and remove only library-created nodes', (t) => {
  const { window, host } = controlDOM(t),
    root = host(),
    other = window.document.createElement('span');
  root.append(other);
  const callbacks = new Map();
  let sequence = 0,
    called = 0;
  const ctx = new WorkspaceContext({
    root,
    scheduleFrame: (f) => {
      callbacks.set(++sequence, f);
      return sequence;
    },
    cancelFrame: (id) => callbacks.delete(id),
  });
  const button = ctx.track(window.document.createElement('button'));
  root.append(button);
  const original = () => called++;
  other.onclick = original;
  ctx.handler(other, 'onclick', () => (called += 10));
  ctx.frame(() => (called += 100));
  ctx.dispose();
  assert.equal(callbacks.size, 0);
  assert.equal(other.onclick, original);
  assert(root.contains(other));
  assert.equal(button.parentNode, null);
  other.click();
  assert.equal(called, 1);
});

test('workspace modules have package owners, no Studio imports and a current integration inventory', async () => {
  const { graph } = await import('../scripts/package-graph.mjs');
  const { workspaceInventory } = await import('../scripts/workspace-inventory.mjs');
  const { readFile } = await import('node:fs/promises');
  const result = await graph();
  for (const [path, source] of result.contents)
    if (path.startsWith('dist/workspaces/'))
      assert(!/from\s*['"](?:[^'"]*\/studio\/|\.\/ui\.js)/.test(source), path);
  const expected = JSON.parse(
    await readFile(new URL('../docs/WORKSPACE-SERVICES.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(await workspaceInventory(), expected);
});
