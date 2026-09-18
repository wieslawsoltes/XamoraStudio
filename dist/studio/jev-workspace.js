import { JevAssistant, JEV_COMMAND_IDS } from '../core/jev-assistant.js';
import { JevClient, jevSettings, jevEndpoint, AITransportError } from '../core/jev-client.js';
import { JevPreferences } from '../core/jev-settings.js';
import { clone, find } from '../core/model.js';
import { isLocked } from '../core/design-tools.js';
import { esc, notify } from './ui.js';
const scopeLabels = {
  selection: 'Selected elements',
  document: 'Current document',
  application: 'Entire app',
};
function storage(window, name) {
  try {
    return window[name];
  } catch {
    return undefined;
  }
}

/** Studio adapter: the assistant owns no document state and runs no actions without explicit Apply. */
export class JevWorkspace {
  constructor(studio, { preferences, fetch } = {}) {
    this.s = studio;
    this.document = studio.docking.control.document;
    this.window = this.document.defaultView;
    this.fetch = fetch;
    this.preferences =
      preferences ||
      new JevPreferences({
        storage: storage(this.window, 'localStorage'),
        sessionStorage: storage(this.window, 'sessionStorage'),
        origin: this.window.location.origin,
      });
    this.disposed = false;
    this.proposal = null;
    this.permission = null;
    this.awaitingConsent = false;
    this.cleanups = [];
    studio.jev = this;
    this.root = this.document.createElement('section');
    this.root.className = 'jev-workspace';
    this.root.setAttribute('aria-label', 'Jev assistant');
    this.root.dataset.dockIgnoreShortcuts = '';
    this.root.innerHTML = `<header class="jev-heading"><div><strong>Jev assistant</strong><span>TypeSafe · decisions into design</span></div><button type="button" class="button quiet" data-jev-settings>Settings</button></header>
      <label class="jev-field">Context scope<select data-jev-scope>${Object.entries(scopeLabels)
        .map(([v, l]) => `<option value="${v}">${l}</option>`)
        .join('')}</select></label>
      <div class="jev-context-label" data-jev-target></div>
      <label class="jev-field">What would you like to do?<textarea data-jev-prompt rows="5" placeholder='Set the selected button background to "#2563EB". Add a TextBlock. Create a login starter in HTML.' maxlength="4000" spellcheck="true"></textarea></label>
      <p class="jev-note">Native Jev chooses typed actions and exact values; it does not write code. Enable the optional text generator for bespoke XAML/HTML. Changes always require review.</p>
      <label class="jev-consent"><input type="checkbox" data-jev-consent> Allow sending this prompt and the displayed scope to configured AI endpoints. Usage may be billed.</label>
      <p class="jev-note">You can also choose Run to review the destination and allow this request once. No context is sent until you approve.</p>
      <div class="jev-actions"><button type="button" class="button primary" data-jev-run>Run · Ctrl+Enter</button><button type="button" class="button quiet" data-jev-preview>Preview context</button><button type="button" class="button quiet" data-jev-cancel disabled>Cancel</button></div>
      <div class="jev-status" role="status" aria-live="polite" data-jev-status>Configure your TypeSafe key or a private proxy to begin.</div>
      <div data-jev-connection-fix hidden><button type="button" class="button" data-jev-connection-setup>Connection setup…</button></div>
      <details class="jev-context"><summary>Outbound context and typed questions</summary><p class="jev-note" data-jev-budget></p><pre data-jev-request></pre></details>
      <section data-jev-proposal hidden><h3>Review proposal</h3><p data-jev-summary></p><ol data-jev-operations></ol><p class="jev-note" data-jev-usage></p>
        <details><summary>Source changes · before / after</summary><h4>Before</h4><pre data-jev-before></pre><h4>After</h4><pre data-jev-after></pre></details>
        <div class="jev-actions"><button type="button" class="button primary" data-jev-apply>Apply reviewed proposal</button><button type="button" class="button quiet" data-jev-discard>Discard</button></div></section>`;
    const q = (selector) => this.root.querySelector(selector);
    this.prompt = q('[data-jev-prompt]');
    this.scope = q('[data-jev-scope]');
    this.consent = q('[data-jev-consent]');
    this.scope.value = 'document';
    studio.docking.model.register({ id: 'jev', title: 'Jev assistant', kind: 'tool', icon: '✦' });
    studio.docking.control.mount('jev', this.root);
    q('[data-jev-settings]').onclick = () => this.settings();
    q('[data-jev-connection-setup]').onclick = () => this.settings({ connection: true });
    q('[data-jev-run]').onclick = () => this.run({ interactive: true }).catch(() => {});
    q('[data-jev-preview]').onclick = () => this.preview().catch(() => {});
    q('[data-jev-cancel]').onclick = () => this.cancel();
    q('[data-jev-apply]').onclick = () => {
      try {
        this.apply();
      } catch (e) {
        this.status(e.message, true);
      }
    };
    q('[data-jev-discard]').onclick = () => this.discard();
    this.prompt.onkeydown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.run({ interactive: true }).catch(() => {});
      }
    };
    this.consent.onchange = () => {
      this.permission = this.consent.checked ? this.requestContext() : null;
      this.status(
        this.consent.checked
          ? 'Context sharing allowed for this prompt and scope. Run creates a proposal for review.'
          : 'No context shared. Choose Run to review and approve this request.',
      );
    };
    this.prompt.oninput = () => this.revokeConsent();
    this.scope.onchange = () => {
      this.revokeConsent();
      this.cancel();
      this.discard();
      this.target();
    };
    this.commands = [
      { id: 'jev:selection', label: 'Ask Jev about selection…', run: () => this.open('selection') },
      {
        id: 'jev:document',
        label: 'Ask Jev to design XAML / HTML…',
        run: () => this.open('document'),
      },
      {
        id: 'jev:application',
        label: 'Control app with Jev…',
        run: () => this.open('application'),
      },
      { id: 'jev:settings', label: 'Jev AI settings…', run: () => this.settings() },
    ];
    this.menu =
      studio.menus.menus.find((m) => m.label === 'Tools') ||
      studio.menus.menus.find((m) => m.label === 'Edit');
    this.group = { label: 'Jev AI', children: this.commands };
    this.menu?.children.push(this.group);
    for (const command of this.commands) studio.menus.commands.set(command.id, command);
    for (const [host, scope, label] of [
      [studio.docking.canvas.querySelector('.canvas-header'), 'selection', 'Ask Jev · selection'],
      [studio.docking.code.querySelector('.code-header'), 'document', 'Ask Jev'],
      [this.document.querySelector('.topbar'), 'application', 'Jev · app'],
    ]) {
      if (!host) continue;
      const button = this.document.createElement('button');
      button.type = 'button';
      button.className = 'button quiet jev-trigger';
      button.textContent = '✦ ' + label;
      button.setAttribute('aria-label', label);
      button.title = 'Open the Jev prompt panel';
      button.onclick = () => this.open(scope);
      host.append(button);
      this.cleanups.push(() => button.remove());
    }
    this.api = Object.freeze({
      open: (scope) => this.open(scope),
      settings: () => this.settings(),
      run: (prompt, scope) => {
        if (prompt !== undefined) this.prompt.value = String(prompt);
        if (scope) this.scope.value = scope;
        return this.run();
      },
      preview: () => this.preview(),
      cancel: () => this.cancel(),
      discard: () => this.discard(),
      apply: () => this.apply(),
      status: () => ({
        running: !!this.running,
        awaitingConsent: this.awaitingConsent,
        hasProposal: !!this.proposal,
        fresh: this.fresh(),
        configuredModel: this.preferences.value.model,
      }),
    });
    this.window.xamora.jev = this.api;
    this.pagehide = (e) => {
      this.cancel();
      if (!e.persisted) this.dispose();
    };
    this.window.addEventListener('pagehide', this.pagehide);
    this.cleanups.push(() => this.window.removeEventListener('pagehide', this.pagehide));
    this.target();
  }
  open(scope = 'document') {
    if (this.disposed) return;
    if (!Object.hasOwn(scopeLabels, scope)) throw Error('Unknown assistant scope.');
    if (scope !== this.scope.value) {
      this.revokeConsent();
      this.cancel();
      this.discard();
    }
    this.scope.value = scope;
    this.s.docking.control.show('jev');
    this.target();
    this.prompt.focus();
  }
  target() {
    this.hasConsent();
    const s = this.s,
      cfg = this.preferences.value;
    this.root.querySelector('[data-jev-target]').textContent =
      `${s.doc.name} · ${s.doc.framework} · ${s.store.selection.length} selected · ${cfg.model}\nJev: ${cfg.endpoint}${cfg.generatorEnabled ? '\nGenerator: ' + (cfg.generatorEndpoint || 'not configured') : '\nNative typed actions only'}`;
  }
  status(message, error = false) {
    if (this.disposed) return;
    const node = this.root.querySelector('[data-jev-status]');
    node.textContent = message;
    node.classList.toggle('jev-error', error);
    this.root.querySelector('[data-jev-connection-fix]').hidden = true;
  }
  appStamp() {
    const s = this.s;
    return JSON.stringify([
      s.view,
      s.dark,
      s.density.value,
      s.docking.model.serialize(),
      s.stores.map((store) => [store.document.id, store.document.name]),
      [...s.menus.commands.values()]
        .filter((c) => JEV_COMMAND_IDS.includes(c.id))
        .map((c) => [
          c.id,
          s.menus.bar.value(c.enabled, true),
          s.menus.bar.value(c.checked, false),
        ]),
    ]);
  }
  snapshot() {
    const s = this.s;
    if (this.disposed) throw Error('The assistant is disposed.');
    if (
      !s.prepareEdit() &&
      (s.sync.composing ||
        !this.preferences.value.generatorEnabled ||
        this.scope.value !== 'document')
    )
      throw Error(
        'Finish input composition or fix the current source draft first. Invalid-draft repair requires document scope and the explicitly enabled generator.',
      );
    if (s.readOnly || s.blend?.animation?.record || s.htmlAnimation?.recording)
      throw Error('Leave read-only or animation recording mode before requesting AI edits.');
    const snapshot = {
      document: clone(s.doc),
      source: s.store.session.source,
      revision: s.store.revision,
      selection: [...s.store.selection],
      scope: this.scope.value,
      appStamp: this.scope.value === 'application' ? this.appStamp() : undefined,
      appContext: {
        view: s.view,
        darkTheme: s.dark,
        density: s.density.value,
        activePanel: s.docking.model.state.activePanel,
      },
      commands: [...s.menus.commands.values()]
        .filter((c) => JEV_COMMAND_IDS.includes(c.id))
        .map((c) => ({
          id: c.id,
          label:
            c.label +
            (c.checked
              ? ' · currently ' + (s.menus.bar.value(c.checked, false) ? 'on' : 'off')
              : ''),
          enabled: s.menus.bar.value(c.enabled, true),
        })),
      panels: [...s.docking.model.panels.values()]
        .filter((p) => p.id !== 'jev')
        .map((p) => ({ id: p.id, label: p.title || p.id })),
      documents: s.stores.map((store) => ({ id: store.document.id, name: store.document.name })),
    };
    return snapshot;
  }
  assistant() {
    return new JevAssistant({
      settings: this.preferences.value,
      credentials: this.preferences.credentials(),
      registry: this.s.registry,
      fetch: this.fetch,
    });
  }
  showRequest(packed) {
    if (this.disposed) return;
    this.root.querySelector('[data-jev-request]').textContent = JSON.stringify(
      packed.request,
      null,
      2,
    );
    this.root.querySelector('[data-jev-budget]').textContent =
      `${packed.generator ? 'Separate generator' : 'Jev System One'} · ${packed.bytes.toLocaleString()} UTF-8 bytes / ${this.preferences.value.maxRequestBytes.toLocaleString()} budget. ${packed.estimatedTokens ? '~' + packed.estimatedTokens.toLocaleString() + ' estimated tokens (not an exact tokenizer count). ' : ''}${packed.omitted?.length ? 'Omitted: ' + packed.omitted.join(', ') + '.' : ''} Candidate context is bounded; not the entire solution. Secrets are best-effort redacted. Inspect before sending.`;
  }
  async preview() {
    if (this.running) throw Error('Cancel the active request before previewing a new one.');
    try {
      const result = await this.assistant().plan(this.snapshot(), this.prompt.value, {
        previewOnly: true,
      });
      this.showRequest(result);
      this.root.querySelector('.jev-context').open = true;
      this.status(
        'Context preview only. No network request was made. Later action-specific questions use the same scope and budget.',
      );
      return result;
    } catch (error) {
      this.status(error.message, true);
      throw error;
    }
  }
  busy(value) {
    this.root.setAttribute('aria-busy', String(value));
    for (const name of ['run', 'preview', 'settings'])
      this.root.querySelector(`[data-jev-${name}]`).disabled = value;
    this.root.querySelector('[data-jev-cancel]').disabled = !value;
    this.scope.disabled = value;
    this.consent.disabled = value;
  }
  requestContext() {
    const s = this.s;
    return {
      prompt: this.prompt.value,
      scope: this.scope.value,
      configuration: JSON.stringify(this.preferences.value),
      documentId: s.doc.id,
      revision: s.store.revision,
      source: s.editor.input.value,
      selection: JSON.stringify(s.store.selection),
      composing: !!s.sync.composing,
      readOnly: !!s.readOnly,
      recording: !!(s.blend?.animation?.record || s.htmlAnimation?.recording),
      appStamp: this.scope.value === 'application' ? this.appStamp() : null,
    };
  }
  matchesContext(context) {
    if (this.disposed || !context) return false;
    const current = this.requestContext();
    return Object.keys(current).every((key) => context[key] === current[key]);
  }
  revokeConsent() {
    this.permission = null;
    this.consent.checked = false;
  }
  hasConsent() {
    if (!this.consent.checked || !this.matchesContext(this.permission)) {
      this.revokeConsent();
      return false;
    }
    return true;
  }
  confirmSending(snapshot, context, packed, signal) {
    const s = this.s,
      config = JSON.parse(context.configuration);
    this.awaitingConsent = true;
    this.status(
      'Waiting for permission. Review the destination and choose Allow and run. Nothing has been sent.',
    );
    return new Promise((resolve, reject) => {
      let body,
        lifetime,
        settled = false;
      const cleanup = () => {
        signal.removeEventListener('abort', canceled);
        lifetime?.removeEventListener('abort', dismissed);
        this.awaitingConsent = false;
      };
      const finish = (approved) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(approved);
      };
      const dismissed = () => finish(false);
      const canceled = () => {
        finish(false);
        // Do not close an unrelated replacement dialog.
        if (body && s.dialogHost?.body === body) s.closeModal();
      };
      try {
        // Keep a focusable return target even though Run is disabled while pending.
        this.prompt.focus({ preventScroll: true });
        s.modal(
          'Allow Jev to use this context?',
          `<div class="jev-share-review">
            <p>No request has been sent. Approve sharing only with destinations you trust.</p>
            <dl><dt>Jev destination</dt><dd>${esc(config.endpoint)}</dd>
            ${config.generatorEnabled ? `<dt>Optional text generator</dt><dd>${esc(config.generatorEndpoint || 'Not configured')}</dd>` : ''}
            <dt>Scope</dt><dd>${esc(scopeLabels[context.scope])} · ${esc(snapshot.document.name)} · ${snapshot.selection.length} selected</dd>
            <dt>First request</dt><dd>${packed.bytes.toLocaleString()} UTF-8 bytes · ${config.maxRequestBytes.toLocaleString()} byte limit per request</dd></dl>
            <p class="jev-note">The prompt and bounded context below will be sent to Jev. Later action-specific questions use the same scope and budget.${config.generatorEnabled ? ' If needed, the complete editing target will also be sent to the separate generator, then verified by Jev.' : ''} Usage may be billed. This approval is for this run only. Changes still require a separate Apply.</p>
            <details><summary>Review outbound context and typed questions</summary><pre>${esc(JSON.stringify(packed.request, null, 2))}</pre></details>
          </div>`,
          [
            {
              label: 'Allow and run',
              primary: true,
              run: () => {
                if (settled || signal.aborted || this.disposed || s.dialogHost?.body !== body)
                  return;
                finish(true);
                s.closeModal();
              },
            },
          ],
          true,
        );
        body = s.dialogHost.body;
        lifetime = s.dialogHost.signal;
        lifetime.addEventListener('abort', dismissed, { once: true });
        signal.addEventListener('abort', canceled, { once: true });
        if (signal.aborted) canceled();
        else if (lifetime.aborted) dismissed();
      } catch (error) {
        settled = true;
        cleanup();
        reject(error);
      }
    });
  }
  async run({ interactive = false } = {}) {
    if (this.disposed) throw Error('The assistant is disposed.');
    if (this.running) throw Error('A Jev request is already running.');
    let controller;
    try {
      const snapshot = this.snapshot();
      this.target();
      const context = this.requestContext(),
        assistant = this.assistant(),
        allowed = this.hasConsent();
      // Programmatic callers still need explicit panel permission. Only the Run
      // button/shortcut opens the one-request approval flow; neither grants consent.
      if (!allowed && !interactive)
        throw Error(
          'Allow context sharing in the Jev panel, or use Run to review and approve this request.',
        );
      controller = new AbortController();
      this.running = controller;
      this.busy(true);
      if (!allowed) {
        const packed = await assistant.plan(snapshot, context.prompt, {
          signal: controller.signal,
          previewOnly: true,
        });
        if (controller.signal.aborted || this.disposed)
          throw new DOMException('Canceled', 'AbortError');
        if (!this.matchesContext(context))
          throw Error(
            'The prompt, context or settings changed. Run again to review the current request.',
          );
        this.showRequest(packed);
        const approved = await this.confirmSending(snapshot, context, packed, controller.signal);
        if (!approved) {
          this.status('Canceled. No context was sent.');
          return null;
        }
        // Another window can still edit source or settings while the owner modal
        // is open. Approval must never authorize a different request or endpoint.
        if (controller.signal.aborted || this.disposed)
          throw new DOMException('Canceled', 'AbortError');
        if (!this.matchesContext(context))
          throw Error(
            'The prompt, context or settings changed. Nothing was sent. Run again to review the current request.',
          );
      }
      this.discard();
      this.captured = snapshot;
      const plan = await assistant.plan(snapshot, context.prompt, {
        signal: controller.signal,
        onRequest: (packed) => this.showRequest(packed),
        onProgress: (message) => this.status(message),
      });
      if (this.disposed || controller.signal.aborted || this.running !== controller)
        throw new DOMException('Canceled', 'AbortError');
      this.proposal = plan;
      this.renderProposal();
      return clone(plan);
    } catch (error) {
      this.status(
        error.name === 'AbortError' ? 'Canceled. No changes were applied.' : error.message,
        error.name !== 'AbortError',
      );
      if (!this.disposed && error instanceof AITransportError)
        this.root.querySelector('[data-jev-connection-fix]').hidden = false;
      throw error;
    } finally {
      if (this.running === controller) {
        this.running = null;
        if (!this.disposed) this.busy(false);
      }
    }
  }
  fresh() {
    const p = this.proposal,
      s = this.s;
    return (
      !!p &&
      !this.disposed &&
      s.doc.id === p.documentId &&
      s.store.revision === p.revision &&
      s.store.session.source === p.originalSource &&
      s.editor.input.value === p.originalSource &&
      JSON.stringify(s.store.selection) === JSON.stringify(p.selection) &&
      !s.sync.composing &&
      (p.scope !== 'application' || p.appStamp === this.appStamp())
    );
  }
  renderProposal() {
    const p = this.proposal,
      q = (name) => this.root.querySelector(`[data-jev-${name}]`);
    q('proposal').hidden = false;
    q('summary').textContent =
      `${p.operations.length} proposed operation(s). ${p.stopped || (p.complete ? 'Plan completed.' : '')} ${p.generator ? 'Source written by the separate generator; reviewed by Jev.' : 'Native typed Jev decisions; markup assembled by application code.'}`;
    const list = q('operations');
    list.replaceChildren();
    for (const operation of p.operations) {
      const li = list.ownerDocument.createElement('li');
      li.textContent = operation.label;
      list.append(li);
    }
    q('before').textContent = p.createdDocument
      ? '(New document; existing documents unchanged)'
      : p.originalSource;
    q('after').textContent = p.source;
    q('usage').textContent =
      `${p.models.join(', ')} · ${p.requests.length} Jev call(s) · ${p.usage.input_tokens.toLocaleString()} input / ${p.usage.output_tokens.toLocaleString()} output tokens. Lowest consumed Choice confidence ${(p.confidence * 100).toFixed(1)}%; selected probability ${(p.probability * 100).toFixed(1)}%. These are not correctness or permission guarantees.`;
    q('apply').disabled = !p.operations.length || !this.fresh();
    this.status(
      this.fresh()
        ? 'Review the operations and source before applying. Nothing has changed yet.'
        : 'The context changed. This proposal cannot be applied; run again.',
      !this.fresh(),
    );
  }
  apply() {
    const p = this.proposal,
      s = this.s;
    if (this.running || !p || !p.operations.length)
      throw Error('There is no completed proposal to apply.');
    if (!this.fresh() || (!p.repair && !s.prepareEdit()))
      throw Error(
        'The source, selection or document changed. Run the prompt again before applying.',
      );
    if (s.readOnly || s.blend?.animation?.record || s.htmlAnimation?.recording)
      throw Error('Leave read-only or recording mode before applying.');
    for (const operation of p.operations)
      if (operation.target && isLocked(s.doc, operation.target))
        throw Error('A target is now locked.');
    const action = p.appAction;
    if (action) {
      if (action.type === 'command') {
        const command = s.menus.commands.get(action.id);
        if (
          !JEV_COMMAND_IDS.includes(action.id) ||
          !command ||
          !s.menus.bar.value(command.enabled, true)
        )
          throw Error('The requested command is unavailable.');
        // Restore the originating source context for commands instead of treating the prompt as source.
        const result = command.run();
        if (result?.catch)
          result.catch((error) =>
            this.status('Application command failed: ' + error.message, true),
          );
      } else if (action.type === 'show_panel') {
        if (!s.docking.model.panels.has(action.id)) throw Error('The panel no longer exists.');
        s.docking.control.show(action.id);
      } else if (action.type === 'open_document') {
        if (!s.stores.some((store) => store.document.id === action.id))
          throw Error('The document no longer exists.');
        s.switchDocument(action.id);
      } else if (action.type === 'select_node') {
        if (!find(s.doc.root, action.id)) throw Error('The element no longer exists.');
        s.store.select([action.id]);
      } else throw Error('Unsupported application action.');
    } else if (p.createdDocument) {
      const done = s.solution.mutate('Jev: create document', (snapshot) => {
        const doc = clone(p.createdDocument);
        const names = new Set(snapshot.documents.map((d) => d.name));
        const original = doc.name,
          dot = original.lastIndexOf('.');
        let n = 2;
        while (names.has(doc.name))
          doc.name = original.slice(0, dot) + '-' + n++ + original.slice(dot);
        snapshot.documents.push(doc);
        snapshot.activeId = doc.id;
      });
      if (done === false) throw Error('The new document could not be created.');
    } else {
      const result = s.store.session.updateSource(p.source, {
        origin: 'jev',
        expectedRevision: p.revision,
      });
      if (!result.accepted || !result.valid)
        throw Error('The reviewed source could not be applied.');
    }
    this.discard();
    this.target();
    this.status(
      'Applied. Document edits are undoable; app and layout actions use their existing histories.',
    );
    return true;
  }
  cancel() {
    this.running?.abort();
  }
  discard() {
    this.proposal = null;
    this.captured = null;
    this.root.querySelector('[data-jev-proposal]').hidden = true;
  }
  settings({ connection = false } = {}) {
    if (this.disposed) return;
    if (this.running) {
      this.status('Cancel the active request before changing settings.', true);
      return;
    }
    const s = this.s,
      config = this.preferences.value,
      keys = this.preferences.credentials();
    const field = (name, label, type = 'text', attrs = '') =>
      `<label class="jev-field">${label}<input name="${name}" type="${type}" value="${esc(config[name] ?? '')}" ${attrs}></label>`;
    const check = (name, label) =>
      `<label class="jev-consent"><input name="${name}" type="checkbox" ${config[name] ? 'checked' : ''}>${label}</label>`;
    s.modal(
      'Jev AI settings',
      `<div class="jev-settings">
      <p>Jev evaluates typed questions; it is not a text generator. Direct TypeSafe calls may be blocked by CORS on a static site. Use your own private bridge; a GitHub Pages site cannot run the server itself.</p>
      <section class="jev-connection" aria-label="Browser connection setup">
        <strong>Connect from this Studio tab</strong><p class="jev-note" data-jev-connection-note></p>
        <div class="jev-actions"><button type="button" class="button" data-jev-local-bridge>Use local bridge</button><button type="button" class="button quiet" data-jev-same-origin>Use same-origin proxy</button><button type="button" class="button quiet" data-jev-direct>Use direct TypeSafe</button></div>
        <details data-jev-bridge-instructions ${connection ? 'open' : ''}><summary>Private bridge setup · keep this workspace</summary>
          <p>In your updated XamoraStudio repository, run:</p><pre data-jev-bridge-command></pre>
          <p>Keep the terminal running. Choose <b>Use local bridge</b>, paste its <b>Private proxy access token</b> below, and enter your TypeSafe key again (or leave it empty when <code>TYPESAFE_API_KEY</code> is set on the server). Confirm the destination, test the connection, then save.</p>
          <p class="jev-note">The bridge accepts only configured origins and an access token. Browser keys are forwarded only to TypeSafe, without storage. Local Network Access may need your permission. Keep your existing Studio tab: moving to localhost changes browser storage and is not required.</p>
          <p class="jev-note">A remotely hosted private HTTPS bridge can also be used by entering its API base URL. No proxy is auto-started or silently selected. Never use a public CORS relay, disable browser security, or clear site data to fix this.</p>
        </details>
      </section>
      ${field('endpoint', 'Jev API base URL')}<label class="jev-field">TypeSafe API key<input name="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="Leave empty when the private proxy owns the key"></label>
      ${field('model', 'Jev model / pinned version', 'text', 'list="jev-model-list"')}<datalist id="jev-model-list"><option value="jev-latest"><option value="jev-preview"></datalist>
      <button type="button" class="button quiet" data-jev-test>Test connection / list models</button><p data-jev-test-status role="status"></p>
      <label class="jev-field">Private proxy access token (required for cross-origin bridge)<input name="proxyToken" type="password" autocomplete="off"></label>
      <label class="jev-consent"><input name="remember" type="checkbox" ${this.preferences.remember ? 'checked' : ''}> Remember credentials in this tab session only (readable by same-origin scripts). Default: memory only.</label>
      <button type="button" class="button quiet" data-jev-clear-keys>Forget all stored keys now</button>
      <details open><summary>Context, confidence and request limits</summary><div class="jev-settings-grid">
      ${field('maxRequestBytes', 'Maximum request bytes', 'number', 'min="4096" max="28000" step="1000"')}
      ${field('maxSteps', 'Maximum native operations', 'number', 'min="1" max="8"')}
      ${field('minConfidence', 'Minimum consumed Choice confidence', 'number', 'min="0.5" max="1" step="0.05"')}
      ${field('minProbability', 'Minimum selected / verification probability', 'number', 'min="0.5" max="1" step="0.05"')}
      ${field('timeoutMs', 'Request timeout (milliseconds)', 'number', 'min="1000" max="120000" step="1000"')}
      ${field('retries', 'Transient-error retries', 'number', 'min="0" max="3"')}
      </div>${check('includeSource', 'Share a bounded source excerpt (required for generated edits)')}${check('includeOtherDocuments', 'Share other open document names for global document switching')}
      <p class="jev-note">The byte cap covers state plus all questions. Jev currently documents 64k tokens per request and 32k for state plus its longest question. Token estimates are not exact. No full-solution dump, credential storage or hidden browser DOM is collected.</p></details>
      <details><summary>Optional separate text generator · bespoke XAML / HTML</summary>
      ${check('generatorEnabled', 'Explicitly enable a separate text-generating provider')}
      ${field('generatorEndpoint', 'Full OpenAI-compatible chat-completions URL')}${field('generatorModel', 'Generator model identifier')}
      <label class="jev-field">Generator API key<input name="generatorKey" type="password" autocomplete="off" spellcheck="false"></label>
      ${field('generatorMaxTokens', 'Generator maximum output tokens', 'number', 'min="256" max="16000"')}
      <label class="jev-field">Generator token-limit parameter<select name="generatorTokenParameter"><option value="max_tokens" ${config.generatorTokenParameter === 'max_tokens' ? 'selected' : ''}>max_tokens</option><option value="max_completion_tokens" ${config.generatorTokenParameter === 'max_completion_tokens' ? 'selected' : ''}>max_completion_tokens</option></select></label>
      <p class="jev-note">This provider, not Jev, writes bespoke source. Only the complete requested target is shared, within the same byte limit. No silent fallback, truncation, automatic code execution, or automatic Apply. Both services may charge for requests.</p></details>
      <label class="jev-consent"><input name="trustDestination" type="checkbox"> I confirm changed endpoints are trusted to receive the credentials I entered.</label>
      <p class="jev-note">Settings and keys are not saved in project files. Scripts or sensitive source may still appear in the context: review the outbound preview before sending. For a local private proxy, run <code>npm run start:ai</code> as documented in JEV-INTEGRATION.md.</p>
      <p role="alert" data-jev-settings-error></p></div>`,
      [
        {
          label: 'Save settings',
          primary: true,
          run: () => {
            try {
              const data = read();
              this.preferences.save(data.config, data.keys, data.remember, data.trust);
              this.revokeConsent();
              this.discard();
              s.closeModal();
              this.target();
              this.status('Jev settings saved. Choose Run to review and approve sending context.');
            } catch (error) {
              body.querySelector('[data-jev-settings-error]').textContent = error.message;
            }
          },
        },
      ],
      true,
    );
    const body = s.dialogHost.body,
      signal = s.dialogHost.signal;
    const input = (name) => body.querySelector(`[name="${name}"]`);
    for (const key of ['apiKey', 'generatorKey', 'proxyToken']) input(key).value = keys[key] || '';
    const setupNote = () => {
      let endpoint;
      try {
        endpoint = new URL(jevEndpoint(input('endpoint').value, this.window.location.origin));
      } catch {}
      const note = body.querySelector('[data-jev-connection-note]');
      note.textContent =
        endpoint?.origin === 'https://api.typesafe.ai'
          ? 'Direct TypeSafe: the provider must allow this page’s origin. Public preflight rejected the GitHub Pages origin during diagnosis. Use the local/private bridge when direct access fails.'
          : endpoint?.origin === this.window.location.origin
            ? 'Same-origin proxy: this URL requires the running AI server or a reverse proxy. GitHub Pages serves static files only; /api/jev on Pages is not a server.'
            : 'Private bridge: check its allowed-origin list, access token and port. Keep credentials in memory unless you explicitly choose tab-session storage.';
    };
    const origin = this.window.location.origin;
    body.querySelector('[data-jev-bridge-command]').textContent =
      origin === 'https://wieslawsoltes.github.io'
        ? 'git pull\nnpm run start:ai:pages'
        : 'git pull\nnpm run start:ai -- --allow-origin=' +
          "'" +
          origin.replaceAll("'", "'\\''") +
          "' --allow-client-keys";
    setupNote();
    let testController = null;
    const cancelTest = () => {
      if (!testController) return;
      testController.abort();
      testController = null;
      body.querySelector('[data-jev-test]').disabled = false;
      body.querySelector('[data-jev-test-status]').textContent =
        'Connection settings changed. Test again before saving.';
    };
    body.addEventListener('input', cancelTest, { signal });
    const preset = (endpoint) => {
      cancelTest();
      input('endpoint').value = endpoint;
      input('apiKey').value = '';
      input('proxyToken').value = '';
      input('trustDestination').checked = false;
      setupNote();
      body.querySelector('[data-jev-bridge-instructions]').open = endpoint.includes('/api/jev');
      input('proxyToken').focus();
    };
    body.querySelector('[data-jev-local-bridge]').onclick = () =>
      preset('http://127.0.0.1:8080/api/jev');
    body.querySelector('[data-jev-same-origin]').onclick = () => preset('/api/jev');
    body.querySelector('[data-jev-direct]').onclick = () => preset('https://api.typesafe.ai');
    const read = () => {
      const next = { ...config };
      for (const key of Object.keys(config)) {
        const node = input(key);
        if (node)
          next[key] =
            node.type === 'checkbox'
              ? node.checked
              : node.type === 'number'
                ? Number(node.value)
                : node.value.trim();
      }
      return {
        config: jevSettings(next, this.window.location.origin),
        keys: Object.fromEntries(
          ['apiKey', 'generatorKey', 'proxyToken'].map((k) => [k, input(k).value.trim()]),
        ),
        remember: input('remember').checked,
        trust: input('trustDestination').checked,
      };
    };
    // A changed destination never quietly inherits a key from the old one.
    for (const [endpoint, key] of [
      ['endpoint', 'apiKey'],
      ['generatorEndpoint', 'generatorKey'],
    ])
      input(endpoint).addEventListener(
        'change',
        () => {
          input(key).value = '';
          input('proxyToken').value = '';
          input('trustDestination').checked = false;
          cancelTest();
          setupNote();
        },
        { signal },
      );
    body.querySelector('[data-jev-clear-keys]').onclick = () => {
      cancelTest();
      try {
        this.preferences.clearKeys();
      } catch {
        body.querySelector('[data-jev-settings-error]').textContent =
          'Browser storage could not be cleared. Clear site data in browser settings.';
      }
      for (const key of ['apiKey', 'generatorKey', 'proxyToken']) input(key).value = '';
      input('remember').checked = false;
    };
    body.querySelector('[data-jev-test]').onclick = async () => {
      if (testController || signal.aborted) return;
      const controller = new AbortController();
      testController = controller;
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const button = body.querySelector('[data-jev-test]'),
        status = body.querySelector('[data-jev-test-status]');
      button.disabled = true;
      status.textContent =
        'Checking model access; no document context or inference request is sent…';
      try {
        const data = read();
        if (data.config.endpoint !== config.endpoint && !data.trust)
          throw Error('Confirm that the changed endpoint is trusted before sending credentials.');
        const models = await new JevClient(data.config, { ...data.keys, fetch: this.fetch }).models(
          { signal: controller.signal },
        );
        if (signal.aborted || controller.signal.aborted || testController !== controller) return;
        const list = body.querySelector('#jev-model-list');
        list.replaceChildren();
        for (const model of models) {
          const option = body.ownerDocument.createElement('option');
          option.value = model.name;
          list.append(option);
        }
        status.textContent =
          'Connected. Models: ' +
          models.map((m) => m.name).join(', ') +
          '. Save settings before running your prompt.';
      } catch (error) {
        if (!signal.aborted && !controller.signal.aborted && testController === controller) {
          status.textContent = error.message;
          if (error instanceof AITransportError)
            body.querySelector('[data-jev-bridge-instructions]').open = true;
        }
      } finally {
        signal.removeEventListener('abort', abort);
        if (testController === controller) {
          testController = null;
          if (!signal.aborted) button.disabled = false;
        }
      }
    };
    signal.addEventListener(
      'abort',
      () => {
        for (const key of ['apiKey', 'generatorKey', 'proxyToken']) input(key).value = '';
      },
      { once: true },
    );
  }
  dispose() {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    this.preferences.dispose();
    this.revokeConsent();
    this.proposal = null;
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    for (const c of this.commands)
      if (this.s.menus.commands.get(c.id) === c) this.s.menus.commands.delete(c.id);
    if (this.menu) this.menu.children = this.menu.children.filter((x) => x !== this.group);
    this.s.docking.control.unmount('jev');
    this.s.docking.model.unregister('jev');
    this.root.remove();
    if (this.window.xamora.jev === this.api) delete this.window.xamora.jev;
    if (this.s.jev === this) delete this.s.jev;
  }
}
