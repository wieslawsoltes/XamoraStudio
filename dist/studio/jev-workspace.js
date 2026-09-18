import { JevAssistant, JEV_COMMAND_IDS } from '../core/jev-assistant.js';
import { JevClient, jevSettings } from '../core/jev-client.js';
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
      <div class="jev-actions"><button type="button" class="button primary" data-jev-run>Run · Ctrl+Enter</button><button type="button" class="button quiet" data-jev-preview>Preview context</button><button type="button" class="button quiet" data-jev-cancel disabled>Cancel</button></div>
      <div class="jev-status" role="status" aria-live="polite" data-jev-status>Configure your TypeSafe key or a private proxy to begin.</div>
      <details class="jev-context"><summary>Outbound context and typed questions</summary><p class="jev-note" data-jev-budget></p><pre data-jev-request></pre></details>
      <section data-jev-proposal hidden><h3>Review proposal</h3><p data-jev-summary></p><ol data-jev-operations></ol><p class="jev-note" data-jev-usage></p>
        <details><summary>Source changes · before / after</summary><h4>Before</h4><pre data-jev-before></pre><h4>After</h4><pre data-jev-after></pre></details>
        <div class="jev-actions"><button type="button" class="button primary" data-jev-apply>Apply reviewed proposal</button><button type="button" class="button quiet" data-jev-discard>Discard</button></div></section>`;
    const q = (selector) => this.root.querySelector(selector);
    this.prompt = q('[data-jev-prompt]');
    this.scope = q('[data-jev-scope]');
    this.scope.value = 'document';
    studio.docking.model.register({ id: 'jev', title: 'Jev assistant', kind: 'tool', icon: '✦' });
    studio.docking.control.mount('jev', this.root);
    q('[data-jev-settings]').onclick = () => this.settings();
    q('[data-jev-run]').onclick = () => this.run().catch(() => {});
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
        this.run().catch(() => {});
      }
    };
    this.scope.onchange = () => {
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
      this.cancel();
      this.discard();
    }
    this.scope.value = scope;
    this.s.docking.control.show('jev');
    this.target();
    this.prompt.focus();
  }
  target() {
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
  }
  async run() {
    if (this.running) throw Error('A Jev request is already running.');
    if (!this.root.querySelector('[data-jev-consent]').checked) {
      const error = Error('Review the endpoint/scope and allow sending context before running.');
      this.status(error.message, true);
      throw error;
    }
    this.discard();
    let controller;
    try {
      const snapshot = this.snapshot();
      this.captured = snapshot;
      controller = new AbortController();
      this.running = controller;
      this.busy(true);
      const plan = await this.assistant().plan(snapshot, this.prompt.value, {
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
  settings() {
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
      <p>Jev evaluates typed questions; it is not a text generator. A private same-origin proxy is recommended. Direct browser keys are available to scripts on this origin; never use a shared production key.</p>
      ${field('endpoint', 'Jev API base URL')}<label class="jev-field">TypeSafe API key<input name="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="Leave empty when the private proxy owns the key"></label>
      ${field('model', 'Jev model / pinned version', 'text', 'list="jev-model-list"')}<datalist id="jev-model-list"><option value="jev-latest"><option value="jev-preview"></datalist>
      <button type="button" class="button quiet" data-jev-test>Test connection / list models</button><p data-jev-test-status role="status"></p>
      <label class="jev-field">Private proxy access token (optional)<input name="proxyToken" type="password" autocomplete="off"></label>
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
              this.discard();
              s.closeModal();
              this.target();
              this.status('Jev settings saved. Preview context, then allow sending and run.');
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
        },
        { signal },
      );
    body.querySelector('[data-jev-clear-keys]').onclick = () => {
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
      const button = body.querySelector('[data-jev-test]'),
        status = body.querySelector('[data-jev-test-status]');
      button.disabled = true;
      status.textContent = 'Checking model access; no document context is sent…';
      try {
        const data = read();
        if (data.config.endpoint !== config.endpoint && !data.trust)
          throw Error('Confirm that the changed endpoint is trusted before sending credentials.');
        const models = await new JevClient(data.config, { ...data.keys, fetch: this.fetch }).models(
          { signal },
        );
        if (signal.aborted) return;
        const list = body.querySelector('#jev-model-list');
        list.replaceChildren();
        for (const model of models) {
          const option = body.ownerDocument.createElement('option');
          option.value = model.name;
          list.append(option);
        }
        status.textContent = 'Connected. Models: ' + models.map((m) => m.name).join(', ');
      } catch (error) {
        if (!signal.aborted) status.textContent = error.message;
      } finally {
        if (!signal.aborted) button.disabled = false;
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
