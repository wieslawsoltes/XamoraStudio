import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { DocumentStore } from '../dist/core/model.js';
import { DocumentSession } from '../dist/core/document-session.js';
import { parseXaml } from '../dist/core/xaml.js';
import { builtins } from '../dist/core/registry.js';
import { DockLayout } from '../dist/core/docking.js';
import { DockWorkspace } from '../dist/controls/dock-workspace.js';
import { DialogHost } from '../dist/controls/dialog-host.js';
import { JevPreferences } from '../dist/core/jev-settings.js';
import { JevWorkspace } from '../dist/studio/jev-workspace.js';
import { responseFor } from './jev-fixture.mjs';
function setup(t, customFetch) {
  let cleanup = () => {};
  t.after(() => cleanup());
  const dom = controlDOM(t),
    registry = builtins();
  dom.window.xamora = {};
  const source = '<Grid><!-- preserved --><Button Content="Before"/></Grid>';
  const store = new DocumentStore(parseXaml(source)),
    session = new DocumentSession(store, { source });
  store.session = session;
  store.select([store.document.root.children.find((n) => n.kind === 'element').id]);
  const control = new DockWorkspace(dom.host(), new DockLayout([{ id: 'xaml', kind: 'tool' }]));
  const editor = { input: dom.document.createElement('textarea') };
  editor.input.value = source;
  store.addEventListener('change', () => {
    editor.input.value = session.source;
  });
  const s = {
    registry,
    store,
    stores: [store],
    editor,
    sync: { composing: false },
    readOnly: false,
    density: { value: 'compact' },
    view: 'split',
    dark: false,
    get doc() {
      return this.store.document;
    },
    prepareEdit: () => !s.sync.composing && session.isValid,
    docking: { control, model: control.model, canvas: dom.host(), code: dom.host() },
    menus: {
      menus: [{ label: 'Edit', children: [] }],
      commands: new Map(),
      bar: { value: (v, f) => (typeof v === 'function' ? v() : (v ?? f)) },
    },
    dialogHost: new DialogHost(dom.host()),
    closeModal() {
      this.dialogHost.close();
    },
    modal(title, html, actions, wide) {
      this.dialogHost.open({ title, html, actions, wide });
    },
  };
  let requests = 0;
  const fetch =
    customFetch ||
    (async (url, o) => {
      requests++;
      const body = JSON.parse(o.body);
      return Response.json(
        responseFor(
          body,
          body.questions.value
            ? { value: '"After"' }
            : { operation: body.state.completed.length ? 'done:' : 'set_text:', target: 'Button' },
        ),
      );
    });
  const preferences = new JevPreferences();
  preferences.save({}, { apiKey: 'unit-private' });
  const workspace = new JevWorkspace(s, { preferences, fetch });
  workspace.root.querySelector('[data-jev-consent]').checked = true;
  workspace.prompt.value = 'Set button text to "After"';
  cleanup = () => {
    workspace.dispose();
    control.dispose();
    s.dialogHost.dispose();
    session.dispose();
  };
  return { ...dom, s, workspace, requests: () => requests };
}
test('Studio proposal requires review and applies exactly one undoable source edit', async (t) => {
  const { s, workspace } = setup(t),
    before = s.store.session.source,
    revision = s.store.revision;
  await workspace.run();
  assert.equal(s.doc.root.children.find((n) => n.kind === 'element').props.Content, 'Before');
  assert(workspace.fresh());
  workspace.apply();
  assert.equal(s.doc.root.children.find((n) => n.kind === 'element').props.Content, 'After');
  assert.equal(s.store.revision, revision + 1);
  s.store.undo();
  assert.equal(s.store.session.source, before);
  assert.equal(workspace.proposal, null);
});
test('edits or selection changes after inference reject stale proposals without overwriting', async (t) => {
  const { s, workspace } = setup(t);
  await workspace.run();
  s.store.setProperty([s.store.selection[0]], 'Width', '222');
  assert.throws(() => workspace.apply(), /changed/);
  assert.equal(s.doc.root.children.find((n) => n.kind === 'element').props.Content, 'Before');
  assert.equal(s.doc.root.children.find((n) => n.kind === 'element').props.Width, '222');
});
test('invalid or composing source and read-only modes block planning before network', async (t) => {
  const { s, workspace, requests } = setup(t);
  s.sync.composing = true;
  await assert.rejects(workspace.run(), /composition/);
  assert.equal(requests(), 0);
  s.sync.composing = false;
  s.readOnly = true;
  await assert.rejects(workspace.run(), /read-only/);
  assert.equal(requests(), 0);
});
test('context consent and previews do not imply permission to execute or send', async (t) => {
  const { workspace, requests } = setup(t);
  workspace.root.querySelector('[data-jev-consent]').checked = false;
  await assert.rejects(workspace.run(), /allow sending/);
  assert.equal(requests(), 0);
  const preview = await workspace.preview();
  assert(preview.request.questions);
  assert.equal(requests(), 0);
  assert.equal(workspace.proposal, null);
});
test('cancel and disposal cannot apply a late provider response', async (t) => {
  let release;
  const { workspace, s } = setup(t, async (url, o) => {
    await new Promise((r) => (release = r));
    return Response.json(responseFor(JSON.parse(o.body), { operation: 'done:' }));
  });
  const pending = workspace.run();
  assert(workspace.running);
  workspace.cancel();
  release();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(workspace.proposal, null);
  assert.equal(s.doc.root.children.find((n) => n.kind === 'element').props.Content, 'Before');
  assert.equal(workspace.running, null);
});
test('global plans invalidate when non-document app context changes', async (t) => {
  const { workspace, s } = setup(t, async (url, o) =>
    Response.json(responseFor(JSON.parse(o.body), { operation: 'command:', command: 'theme:' })),
  );
  s.menus.commands.set('theme', {
    id: 'theme',
    label: 'Dark theme',
    run: () => {
      s.dark = !s.dark;
    },
  });
  workspace.scope.value = 'application';
  await workspace.run();
  assert(workspace.fresh());
  s.dark = true;
  assert.throws(() => workspace.apply(), /changed/);
  assert.equal(s.dark, true);
});
test('Jev settings use password fields and clear credential field references after dismissal', (t) => {
  const { workspace, s } = setup(t);
  workspace.settings();
  const input = s.dialogHost.body.querySelector('[name=apiKey]');
  assert.equal(input.type, 'password');
  assert.equal(input.value, 'unit-private');
  s.closeModal();
  assert.equal(input.value, '');
  assert.equal(workspace.preferences.credentials().apiKey, 'unit-private');
});
test('model listing is canceled with its settings dialog and never updates a replacement dialog', async (t) => {
  let release;
  const { workspace, s } = setup(t, async () => {
    await new Promise((r) => (release = r));
    return Response.json({ models: [{ name: 'fixture' }] });
  });
  workspace.settings();
  const button = s.dialogHost.body.querySelector('[data-jev-test]'),
    oldStatus = s.dialogHost.body.querySelector('[data-jev-test-status]');
  const pending = button.onclick();
  s.closeModal();
  release();
  await pending;
  assert(!oldStatus.textContent.includes('Connected'));
  assert.equal(s.dialogHost.isOpen, false);
});
test('disposed workspace releases command entries, content and exposed app routes', (t) => {
  const { workspace, s, window } = setup(t);
  workspace.dispose();
  workspace.dispose();
  assert.equal(s.menus.commands.has('jev:document'), false);
  assert.equal(s.docking.model.panels.has('jev'), false);
  assert.equal(window.xamora.jev, undefined);
});

test('explicit generated repair stages an invalid draft and undo restores that exact invalid draft', async (t) => {
  const { workspace, s } = setup(t, async (url, o) => {
    const body = JSON.parse(o.body);
    if (url.includes('writer.test')) {
      assert.equal(JSON.parse(body.messages[1].content).source, '<Grid><Button');
      return Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '<Grid><Button Content="Repaired"/></Grid>' },
          },
        ],
      });
    }
    if (body.questions.fits) assert.equal(body.state.originalSource, '<Grid><Button');
    return Response.json(
      responseFor(body, body.questions.fits ? { fits: 0.99 } : { operation: 'repair' }),
    );
  });
  workspace.preferences.save(
    {
      generatorEnabled: true,
      generatorEndpoint: 'https://writer.test/chat/completions',
      generatorModel: 'fixture',
    },
    { apiKey: 'unit-private' },
  );
  workspace.scope.value = 'document';
  workspace.prompt.value = 'Repair the invalid source draft';
  s.store.session.updateSource('<Grid><Button');
  const before = s.store.revision;
  assert.equal(s.store.session.isValid, false);
  const result = await workspace.run();
  assert(result.repair);
  assert.equal(s.store.revision, before);
  assert.equal(s.store.session.source, '<Grid><Button');
  workspace.apply();
  assert.equal(s.store.session.isValid, true);
  assert.equal(s.store.revision, before + 1);
  s.store.undo();
  assert.equal(s.store.session.source, '<Grid><Button');
  assert.equal(s.store.session.isValid, false);
});
