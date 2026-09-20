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
  workspace.prompt.value = 'Set button text to "After"';
  const allow = () => {
    workspace.consent.checked = true;
    workspace.consent.dispatchEvent(new dom.window.Event('change'));
  };
  allow();
  cleanup = () => {
    workspace.dispose();
    control.dispose();
    s.dialogHost.dispose();
    session.dispose();
  };
  return { ...dom, s, workspace, allow, requests: () => requests };
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
  await assert.rejects(workspace.run(), /Allow context sharing/);
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
  const { workspace, s, allow } = setup(t, async (url, o) =>
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
  allow();
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
  const { workspace, s, allow } = setup(t, async (url, o) => {
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
  allow();
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

async function consentDialog(s) {
  // The preview is asynchronous but performs no network IO.
  for (let n = 0; n < 20; n++) {
    if (s.dialogHost.body?.querySelector('.jev-share-review')) return s.dialogHost.element;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('Expected the context-sharing dialog');
}

test('Run with unchecked consent opens a request review and sends only after Allow and run', async (t) => {
  const { workspace, s, requests } = setup(t);
  workspace.consent.checked = false;
  const source = s.store.session.source;
  const pending = workspace.run({ interactive: true });
  const dialog = await consentDialog(s);
  assert.equal(workspace.api.status().awaitingConsent, true);
  assert.equal(requests(), 0);
  assert.equal(workspace.consent.checked, false);
  assert(dialog.textContent.includes('https://api.typesafe.ai'));
  assert(dialog.textContent.includes('Current document'));
  assert(dialog.textContent.includes('Usage may be billed'));
  assert(!dialog.textContent.includes('unit-private'));
  assert(dialog.querySelector('pre').textContent.includes('questions'));
  assert(!workspace.root.querySelector('[data-jev-status]').classList.contains('jev-error'));
  await dialog.querySelector('[data-modal-action="0"]').onclick();
  const plan = await pending;
  assert(plan.operations.length > 0);
  assert(requests() > 0);
  assert.equal(s.store.session.source, source);
  assert.equal(
    workspace.consent.checked,
    false,
    'One-run permission must not tick persistent consent',
  );
  assert.equal(workspace.api.status().awaitingConsent, false);
  assert.equal(workspace.api.status().running, false);
  workspace.apply();
  s.store.undo();
  assert.equal(s.store.session.source, source);
  const calls = requests();
  const next = workspace.run({ interactive: true });
  await consentDialog(s);
  s.closeModal();
  assert.equal(await next, null);
  assert.equal(requests(), calls, 'A second run needs a new approval');
});

for (const method of ['cancel button', 'close', 'Escape', 'API cancel', 'dispose', 'replacement']) {
  test(`context review ${method} sends nothing and settles without granting permission`, async (t) => {
    const { workspace, s, requests, window } = setup(t);
    workspace.consent.checked = false;
    const pending = workspace.run({ interactive: true });
    const dialog = await consentDialog(s);
    const allow = dialog.querySelector('[data-modal-action="0"]').onclick;
    if (method === 'cancel button') dialog.querySelector('[data-dialog-cancel]').click();
    else if (method === 'close') dialog.querySelector('[data-dialog-close]').click();
    else if (method === 'Escape')
      dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (method === 'API cancel') workspace.cancel();
    else if (method === 'dispose') workspace.dispose();
    else s.modal('Replacement', '<p>Unrelated dialog</p>', []);
    assert.equal(await pending, null);
    await allow();
    assert.equal(requests(), 0);
    assert.equal(workspace.proposal, null);
    assert.equal(workspace.api.status().awaitingConsent, false);
    assert.equal(workspace.api.status().running, false);
    assert.equal(workspace.consent.checked, false);
    if (method === 'replacement')
      assert.equal(s.dialogHost.element.getAttribute('aria-label'), 'Replacement');
    else assert.equal(s.dialogHost.isOpen, false);
  });
}

for (const changed of [
  'prompt',
  'scope',
  'source',
  'selection',
  'draft',
  'settings',
  'composition',
  'app state',
]) {
  test(`context review rejects changed ${changed} before making any provider call`, async (t) => {
    const { workspace, s, requests } = setup(t);
    workspace.consent.checked = false;
    if (changed === 'app state') workspace.scope.value = 'application';
    const pending = workspace.run({ interactive: true });
    const dialog = await consentDialog(s);
    if (changed === 'prompt') workspace.prompt.value = 'Delete the selected control';
    if (changed === 'scope') workspace.scope.value = 'application';
    if (changed === 'source') s.store.setProperty([s.store.selection[0]], 'Width', '444');
    if (changed === 'selection') s.store.select([s.doc.root.id]);
    if (changed === 'draft') s.editor.input.value += '<unfinished';
    if (changed === 'settings')
      workspace.preferences.save({
        generatorEnabled: true,
        generatorEndpoint: 'https://different.test/generate',
        generatorModel: 'fixture',
      });
    if (changed === 'composition') s.sync.composing = true;
    if (changed === 'app state') s.dark = !s.dark;
    const rejected = assert.rejects(pending, /changed.*Nothing was sent/);
    await dialog.querySelector('[data-modal-action="0"]').onclick();
    await rejected;
    assert.equal(requests(), 0);
    assert.equal(workspace.proposal, null);
    assert.equal(workspace.consent.checked, false);
    assert.equal(workspace.api.status().running, false);
  });
}

test('prompt and scope input revoke checkbox permission without treating either action as sending consent', async (t) => {
  const { workspace, allow, window, requests } = setup(t);
  workspace.prompt.value = 'Something else';
  workspace.prompt.dispatchEvent(new window.Event('input'));
  assert.equal(workspace.consent.checked, false);
  await assert.rejects(workspace.api.run(), /Allow context sharing/);
  allow();
  workspace.scope.value = 'selection';
  workspace.scope.dispatchEvent(new window.Event('change'));
  assert.equal(workspace.consent.checked, false);
  await assert.rejects(workspace.api.run(), /Allow context sharing/);
  assert.equal(requests(), 0);
});

test('checked consent cannot silently follow edited source, an API prompt or changed provider settings', async (t) => {
  const { workspace, s, allow, requests } = setup(t);
  s.store.setProperty([s.store.selection[0]], 'Width', '444');
  await assert.rejects(workspace.api.run(), /Allow context sharing/);
  assert.equal(workspace.consent.checked, false);
  allow();
  await assert.rejects(workspace.api.run('Delete the button'), /Allow context sharing/);
  allow();
  workspace.preferences.save({ model: 'jev-preview' });
  await assert.rejects(workspace.api.run(), /Allow context sharing/);
  assert.equal(requests(), 0);
});

test('duplicate Run cannot open a second consent dialog or multiply requests', async (t) => {
  const { workspace, s, requests } = setup(t);
  workspace.consent.checked = false;
  const pending = workspace.run({ interactive: true });
  const dialog = await consentDialog(s);
  await assert.rejects(workspace.run({ interactive: true }), /already running/);
  assert.equal(s.dialogHost.element, dialog);
  assert.equal(workspace.root.querySelector('[data-jev-run]').disabled, true);
  s.closeModal();
  await pending;
  assert.equal(workspace.root.querySelector('[data-jev-run]').disabled, false);
  assert.equal(requests(), 0);
});

test('Run validates drafts and empty prompts before presenting a consent dialog', async (t) => {
  const { workspace, s, requests } = setup(t);
  workspace.consent.checked = false;
  s.sync.composing = true;
  await assert.rejects(workspace.run({ interactive: true }), /composition/);
  assert.equal(s.dialogHost.isOpen, false);
  s.sync.composing = false;
  workspace.prompt.value = '  ';
  await assert.rejects(workspace.run({ interactive: true }), /prompt/i);
  assert.equal(s.dialogHost.isOpen, false);
  assert.equal(requests(), 0);
});

test('context approval renders authored names and prompt as text, and discloses optional generator', async (t) => {
  const { workspace, s, requests } = setup(t);
  workspace.consent.checked = false;
  s.doc.name = '<img src=x onerror=alert(1)>.xaml';
  workspace.prompt.value = 'Set text to "<script>alert(1)</script>"';
  workspace.preferences.save({
    generatorEnabled: true,
    generatorEndpoint: 'https://writer.test/v1/chat/completions',
    generatorModel: 'fixture',
  });
  const pending = workspace.run({ interactive: true });
  const dialog = await consentDialog(s);
  assert(dialog.textContent.includes('https://writer.test/v1/chat/completions'));
  assert(dialog.textContent.includes('<img src=x onerror=alert(1)>.xaml'));
  assert.equal(dialog.querySelectorAll('img,script').length, 0);
  s.closeModal();
  await pending;
  assert.equal(requests(), 0);
});

test('the request approved in the dialog is exactly the first native HTTP payload', async (t) => {
  const sent = [];
  const { workspace, s } = setup(t, async (url, options) => {
    const request = JSON.parse(options.body);
    sent.push(request);
    return Response.json(responseFor(request, { operation: 'done:' }));
  });
  workspace.consent.checked = false;
  const pending = workspace.run({ interactive: true });
  const dialog = await consentDialog(s);
  const preview = JSON.parse(dialog.querySelector('pre').textContent);
  await dialog.querySelector('[data-modal-action="0"]').onclick();
  await pending;
  assert.deepEqual(sent, [preview]);
});

test('checkbox approval clears the old error and saved settings revoke the previous grant', async (t) => {
  const { workspace, s, allow, requests } = setup(t);
  workspace.status('Previous error', true);
  allow();
  const status = workspace.root.querySelector('[data-jev-status]');
  assert(!status.classList.contains('jev-error'));
  assert(status.textContent.includes('Context sharing allowed'));
  workspace.settings();
  await s.dialogHost.element.querySelector('[data-modal-action="0"]').onclick();
  assert.equal(workspace.consent.checked, false);
  await assert.rejects(workspace.api.run(), /Allow context sharing/);
  assert.equal(requests(), 0);
});

test('a rejected browser fetch exposes actionable connection setup without mutating the document', async (t) => {
  let calls = 0;
  const { workspace, s } = setup(t, async () => {
    calls++;
    throw new TypeError('Failed to fetch');
  });
  const source = s.store.session.source;
  await assert.rejects(workspace.run(), /private bridge/);
  assert.equal(calls, 1);
  assert.equal(workspace.root.querySelector('[data-jev-connection-fix]').hidden, false);
  assert.equal(s.store.session.source, source);
  workspace.root.querySelector('[data-jev-connection-setup]').click();
  assert.equal(s.dialogHost.body.querySelector('[data-jev-bridge-instructions]').open, true);
  assert.equal(calls, 1, 'Opening setup must not probe other destinations');
});

test('connection presets are staged and clear credentials/trust without moving the workspace', (t) => {
  const { workspace, s } = setup(t),
    before = s.store.session.source;
  workspace.settings();
  const body = s.dialogHost.body;
  body.querySelector('[name=proxyToken]').value = 'old-proxy-token';
  body.querySelector('[name=trustDestination]').checked = true;
  body.querySelector('[data-jev-local-bridge]').click();
  assert.equal(body.querySelector('[name=endpoint]').value, 'http://127.0.0.1:8080/api/jev');
  assert.equal(body.querySelector('[name=apiKey]').value, '');
  assert.equal(body.querySelector('[name=proxyToken]').value, '');
  assert.equal(body.querySelector('[name=trustDestination]').checked, false);
  assert.equal(workspace.preferences.value.endpoint, 'https://api.typesafe.ai');
  assert.equal(workspace.preferences.credentials().apiKey, 'unit-private');
  assert.equal(s.store.session.source, before);
  s.closeModal();
  assert.equal(workspace.preferences.value.endpoint, 'https://api.typesafe.ai');
});

test('a changed bridge destination requires explicit trust before a settings connection test', async (t) => {
  let calls = 0;
  const { workspace, s } = setup(t, async () => {
    calls++;
    return Response.json({ models: [{ name: 'jev-latest' }] });
  });
  workspace.settings();
  const body = s.dialogHost.body;
  body.querySelector('[data-jev-local-bridge]').click();
  await body.querySelector('[data-jev-test]').onclick();
  assert.equal(calls, 0);
  assert.match(body.querySelector('[data-jev-test-status]').textContent, /trusted/);
});

test('editing settings cancels model discovery and discards late success for the old endpoint', async (t) => {
  let release, transportSignal;
  const { workspace, s, window } = setup(t, async (_url, options) => {
    transportSignal = options.signal;
    await new Promise((r) => (release = r));
    return Response.json({ models: [{ name: 'must-not-appear' }] });
  });
  workspace.settings();
  const body = s.dialogHost.body;
  const pending = body.querySelector('[data-jev-test]').onclick();
  assert(transportSignal);
  body.querySelector('[name=apiKey]').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(transportSignal.aborted, true);
  release();
  await pending;
  assert.doesNotMatch(
    body.querySelector('[data-jev-test-status]').textContent,
    /Connected|must-not-appear/,
  );
  assert.equal(body.querySelector('[data-jev-test]').disabled, false);
});

test('forgetting keys aborts discovery and cannot report the old credentials connected', async (t) => {
  let release, transportSignal;
  const { workspace, s } = setup(t, async (_url, o) => {
    transportSignal = o.signal;
    await new Promise((r) => (release = r));
    return Response.json({ models: [{ name: 'old' }] });
  });
  workspace.settings();
  const body = s.dialogHost.body;
  const pending = body.querySelector('[data-jev-test]').onclick();
  body.querySelector('[data-jev-clear-keys]').click();
  assert.equal(transportSignal.aborted, true);
  release();
  await pending;
  assert.equal(body.querySelector('[name=apiKey]').value, '');
  assert.doesNotMatch(body.querySelector('[data-jev-test-status]').textContent, /Connected/);
});

test('reviewed Jev proposals accept normalized CRLF editor text without weakening freshness guards', async (t) => {
  const { s, workspace, allow } = setup(t);
  const source = '\uFEFF<Grid>\r\n  <Button Content="Before"/>\r\n</Grid>\r\n';
  s.store.session.updateSource(source);
  s.store.select([s.doc.root.children.find((n) => n.kind === 'element').id]);
  s.editor.input.value = source.replace(/\r\n?/g, '\n');
  allow();
  await workspace.run();
  assert(workspace.fresh(), 'Canonical source and its normalized textarea are the same draft');
  s.editor.input.value += 'pending';
  assert.equal(workspace.fresh(), false, 'Uncaptured input still invalidates the proposal');
  s.editor.input.value = source.replace(/\r\n?/g, '\n');
  assert(workspace.fresh());
  workspace.apply();
  assert.equal(s.doc.root.children.find((n) => n.kind === 'element').props.Content, 'After');
  s.store.undo();
  assert.equal(s.store.session.source, source, 'Undo restores exact imported source');
});
