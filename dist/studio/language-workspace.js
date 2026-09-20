import { SourceTextCoordinates } from '../core/source-text-coordinates.js';
import { find, parentOf, isProperty } from '../core/model.js';
import { SemanticLanguageService } from '../core/language-service.js';
import { esc, notify, $ } from './ui.js';

/** IDE navigation and refactoring backed by the active document session. */
export class LanguageWorkspace {
  constructor(studio) {
    this.s = studio;
    studio.language = this;
    this.services = new WeakMap();
    this.mode = 'symbols';
    this.results = [];
    this.back = [];
    this.forward = [];
    this.query = '';
    this.resultDocumentId = null;
    this.host = document.createElement('section');
    this.host.className = 'semantic-workspace';
    studio.docking.registerPanel({
      id: 'code-intelligence',
      title: 'Symbols & references',
      content: this.host,
      icon: '⌘',
    });
    const editor = studio.editor;
    editor.getCompletions = (source, offset, context = {}) => {
      const canonical = this.coordinates.fromEditor(source),
        coordinates = new SourceTextCoordinates(canonical);
      return this.service
        .completions(canonical, coordinates.toSource(offset), context.context || context)
        .map((item) => ({
          ...item,
          start: coordinates.toEditor(item.start),
          end: coordinates.toEditor(item.end),
        }));
    };
    editor.onSemanticCommand = (command) => this.command(command);
    const baseCommand = studio.command.bind(studio);
    studio.command = (command, event) =>
      this.handles(command) ? this.command(command) : baseCommand(command, event);
    const render = studio.render.bind(studio);
    studio.render = () => {
      render();
      if (studio.docking.control.visible.has('code-intelligence')) this.render();
    };
    const problems = studio.docking.refreshProblems.bind(studio.docking);
    studio.docking.refreshProblems = () => {
      const semantic = this.service
        .diagnostics()
        .map((issue) => ({ ...issue, id: issue.nodeId, semantic: true }));
      studio.issues = [
        ...(studio.issues || [])
          .filter((issue) => !issue.semantic)
          .map((issue) => {
            if (issue.sourceSync) return issue;
            const span = studio.store.session.sourceAtNode(issue.id);
            return span ? { ...issue, line: span.line, column: span.column } : issue;
          }),
        ...semantic,
      ];
      problems();
      for (const button of studio.docking.problemsHost.querySelectorAll('[data-dock-issue]')) {
        const issue = studio.issues[Number(button.dataset.dockIssue)];
        if (issue?.semantic) button.onclick = () => this.navigate(issue);
      }
    };
    const commands = [
      ['language-definition', 'Go to definition', 'F12'],
      ['language-references', 'Find all references', 'Shift+F12'],
      ['language-rename', 'Rename symbol…', 'F2'],
      ['language-matching-tag', 'Go to matching tag', 'Ctrl+Shift+\\'],
      ['language-expand-selection', 'Expand syntax selection', 'Alt+Shift+Right'],
      ['language-shrink-selection', 'Shrink syntax selection', 'Alt+Shift+Left'],
      ['language-select-designer', 'Select element in designer', ''],
      ['language-back', 'Navigate back', 'Alt+Left'],
      ['language-forward', 'Navigate forward', 'Alt+Right'],
    ].map(([id, label, shortcut]) => ({
      id,
      label,
      shortcut,
      run: () => this.command(id),
      enabled: () =>
        id === 'language-back'
          ? !!this.back.length
          : id === 'language-forward'
            ? !!this.forward.length
            : this.ready(false),
    }));
    for (const command of commands) studio.menus.commands.set(command.id, command);
    studio.menus.menus
      .find((menu) => menu.label === 'Edit')
      ?.children.push({ separator: true }, { label: 'Code navigation', children: commands });
    const symbols = studio.menus.commands.get('symbols');
    if (symbols) {
      symbols.label = 'Document symbols';
      symbols.run = () => this.command('symbols');
    }
    this.render();
    studio.docking.refreshProblems();
    window.xamora.language = {
      symbols: () => this.service.symbols(),
      elementAt: (offset) => this.service.elementAt(offset),
      matchingTagAt: (offset) => this.service.matchingTagAt(offset),
      selectionRanges: (start, end) => this.service.selectionRanges(start, end),
      definitionAt: (offset) => this.service.definitionAt(offset),
      referencesAt: (offset) => this.service.referencesAt(offset),
      rename: (offset, name, options) => {
        if (!this.ready()) return false;
        return this.service.rename(offset, name, options);
      },
      diagnostics: () => this.service.diagnostics(),
    };
  }
  get coordinates() {
    const source = this.s.store.session.source ?? this.s.editor.input.value;
    if (this.textCoordinates?.source !== source)
      this.textCoordinates = new SourceTextCoordinates(source);
    return this.textCoordinates;
  }
  get service() {
    const session = this.s.store.session;
    if (!this.services.has(session))
      this.services.set(
        session,
        new SemanticLanguageService(session, {
          registry: this.s.registry,
          context: this.s.features?.context?.() || {},
        }),
      );
    return this.services.get(session);
  }
  handles(command) {
    return command === 'symbols' || command.startsWith('language-');
  }
  ready(show = true) {
    const ready = !this.s.editor.composing && this.s.store.session.isValid;
    if (!ready && show)
      notify(
        this.s.editor.composing
          ? 'Finish composing source text before navigating or renaming.'
          : 'Fix source errors before navigating or renaming.',
      );
    return ready;
  }
  command(command) {
    try {
      // Flush pending valid input before consuming source coordinates. Never navigate stale syntax.
      if (this.s.editor.composing || (this.s.sync && !this.s.sync.flush())) {
        this.ready();
        return false;
      }
      if (command === 'language-back' || command === 'language-forward')
        return this.history(command === 'language-forward');
      if (!this.ready()) return false;
      const offset = this.coordinates.toSource(this.s.editor.input.selectionStart);
      if (command === 'symbols') {
        this.mode = 'symbols';
        this.results = [];
        this.show();
        return true;
      }
      if (command === 'language-definition') {
        const matches = this.service.definitionAt(offset);
        if (matches.length === 1) return this.navigate(matches[0]);
        this.mode = 'definitions';
        this.results = matches;
        this.resultDocumentId = this.s.doc.id;
        this.resultRevision = this.s.store.revision;
        this.show();
        if (!matches.length) notify('No local definition at the caret.');
        return !!matches.length;
      }
      if (command === 'language-references') {
        this.mode = 'references';
        this.results = this.service.referencesAt(offset);
        this.resultDocumentId = this.s.doc.id;
        this.resultRevision = this.s.store.revision;
        this.show();
        return true;
      }
      if (command === 'language-rename') return this.rename(offset);
      if (command === 'language-matching-tag') {
        const target = this.service.matchingTagAt(offset);
        if (!target) {
          notify('Place the caret in a paired opening or closing tag.');
          return false;
        }
        return this.navigate(target);
      }
      if (command === 'language-expand-selection') return this.syntaxSelection(false);
      if (command === 'language-shrink-selection') return this.syntaxSelection(true);
      if (command === 'language-select-designer') {
        const target = this.service.elementAt(offset);
        let node = target && find(this.s.doc.root, target.nodeId);
        while (node && this.s.doc.framework !== 'HTML' && isProperty(node))
          node = parentOf(this.s.doc.root, node.id);
        if (!node) {
          notify('No authored element at the caret.');
          return false;
        }
        this.s.store.select([node.id]);
        return true;
      }
    } catch (error) {
      notify(error.message);
      return false;
    }
  }
  syntaxSelection(shrink) {
    const input = this.s.editor.input,
      session = this.s.store.session;
    const current = {
      start: this.coordinates.toSource(input.selectionStart),
      end: this.coordinates.toSource(input.selectionEnd),
      direction: input.selectionDirection,
    };
    let trail = this.selectionTrail;
    if (
      !trail ||
      trail.session !== session ||
      trail.revision !== session.revision ||
      trail.expected.start !== current.start ||
      trail.expected.end !== current.end
    )
      trail = this.selectionTrail = {
        session,
        revision: session.revision,
        expected: current,
        entries: [],
      };
    const next = shrink
      ? trail.entries.pop()
      : this.service.selectionRanges(current.start, current.end)[0];
    if (!next) return false;
    if (!shrink) trail.entries.push(current);
    trail.expected = next;
    input.focus();
    input.setSelectionRange(
      this.coordinates.toEditor(next.start),
      this.coordinates.toEditor(next.end),
      next.direction || current.direction,
    );
    this.s.editor.reveal(this.coordinates.toEditor(next.start));
    this.s.editor.cursor(true);
    return true;
  }
  show() {
    this.s.docking.control.show('code-intelligence');
    this.render();
  }
  current() {
    const input = this.s.editor.input;
    return {
      documentId: this.s.doc.id,
      start: this.coordinates.toSource(input.selectionStart),
      end: this.coordinates.toSource(input.selectionEnd),
    };
  }
  navigate(location, { record = true } = {}) {
    if (!this.ready()) return false;
    const target = { ...location, documentId: location.documentId || this.s.doc.id },
      previous = record ? this.current() : null;
    if (target.documentId !== this.s.doc.id) {
      const index = this.s.stores.findIndex((store) => store.document.id === target.documentId);
      if (index < 0) return false;
      this.s.switchDocument(index);
      if (this.s.doc.id !== target.documentId) return false;
    }
    // Navigation owns the exact text target. show() would queue generic panel focus
    // and later move focus to the source toolbar's first button, especially in popups.
    if (this.s.docking.control.activate('xaml', { focus: false }) === false) return false;
    if (record) {
      this.back.push(previous);
      if (this.back.length > 100) this.back.shift();
      this.forward = [];
    }
    const editor = this.s.editor;
    editor.input.ownerDocument.defaultView?.focus();
    editor.input.focus({ preventScroll: true });
    const coordinates = this.coordinates;
    const start = coordinates.toEditor(
        Math.min(coordinates.source.length, Math.max(0, target.start)),
      ),
      end = coordinates.toEditor(
        Math.min(coordinates.source.length, Math.max(0, target.end ?? target.start)),
      );
    editor.input.setSelectionRange(start, end);
    editor.reveal(start);
    editor.cursor(true);
    return true;
  }
  history(forward) {
    const from = forward ? this.forward : this.back,
      to = forward ? this.back : this.forward;
    if (!from.length || !this.ready()) return false;
    const target = from.at(-1),
      previous = this.current();
    if (!this.navigate(target, { record: false })) return false;
    from.pop();
    to.push(previous);
    return true;
  }
  rename(offset) {
    const definitions = this.service.definitionAt(offset);
    if (definitions.length !== 1) {
      notify(
        definitions.length
          ? 'Rename is ambiguous in this scope.'
          : 'Place the caret on a named element, resource key, HTML id, or a supported reference.',
      );
      return false;
    }
    const symbol = definitions[0],
      revision = this.s.store.revision,
      documentId = this.s.doc.id,
      session = this.s.store.session,
      locations = this.service.referencesAt(offset),
      html = this.s.doc.framework === 'HTML';
    this.s.modal(
      'Rename symbol',
      `<label>New name<input id="semantic-rename-name" value="${esc(symbol.name)}" aria-label="New symbol name" autocomplete="off"></label><p>${locations.length} declaration and literal reference${locations.length === 1 ? '' : 's'} in this document will be updated together.</p><p class="feature-help">${html ? 'Includes supported HTML id references and CSS selectors. JavaScript and external files are not rewritten.' : 'Namescopes and local resource lookup determine which references are changed. External files and runtime-generated references are not rewritten.'}</p><div class="semantic-rename-preview">${locations
        .slice(0, 30)
        .map(
          (item) =>
            `<div>${item.line}:${item.column} · ${item.declaration ? 'declaration' : 'reference'} <code>${esc(item.name)}</code></div>`,
        )
        .join('')}</div>`,
      [
        {
          label: 'Rename',
          primary: true,
          run: () => {
            if (this.s.doc.id !== documentId || this.s.store.session !== session)
              throw Error('The active document changed. Run Rename again.');
            if (!this.ready()) return;
            const result = this.service.rename(offset, $('#semantic-rename-name').value.trim(), {
              expectedRevision: revision,
            });
            this.s.closeModal();
            if (result.declaration) this.navigate(result.declaration);
            this.mode = 'symbols';
            this.render();
            notify(`Renamed ${result.count} occurrence${result.count === 1 ? '' : 's'}.`);
          },
        },
      ],
    );
    const input = $('#semantic-rename-name');
    input.focus();
    input.select();
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        document.querySelector('#modal-root .modal-footer .primary')?.click();
      }
    });
    return true;
  }
  render() {
    if (this.rendering) return;
    this.rendering = true;
    try {
      if (
        this.mode !== 'symbols' &&
        this.resultDocumentId &&
        (this.resultDocumentId !== this.s.doc.id || this.resultRevision !== this.s.store.revision)
      ) {
        this.mode = 'symbols';
        this.results = [];
      }
      const entries = this.mode === 'symbols' ? this.service.symbols() : this.results,
        filtered = entries.filter((item) =>
          (item.name + ' ' + (item.type || '')).toLowerCase().includes(this.query.toLowerCase()),
        );
      this.host.innerHTML = `<header class="semantic-toolbar"><button data-semantic="symbols">Symbols</button><button data-semantic="language-definition" title="Go to definition (F12)">Definition</button><button data-semantic="language-references" title="Find references (Shift+F12)">References</button><button data-semantic="language-rename" title="Rename symbol (F2)">Rename</button></header><input class="semantic-filter" value="${esc(this.query)}" placeholder="Filter ${this.mode}" aria-label="Filter symbols and references"><div class="semantic-summary">${filtered.length} ${this.mode} · ${esc(this.s.doc.name)}</div><div class="semantic-results" role="list">${filtered.map((item, index) => `<button role="listitem" data-semantic-result="${index}" title="${esc(item.kind)} · ${item.line}:${item.column}"><span>${item.declaration ? '◇' : '↳'}</span><span><strong>${esc(item.name)}</strong><small>${esc(item.type || item.kind)}${item.declaration ? ' · declaration' : ''}</small></span><code>${item.line}:${item.column}</code></button>`).join('') || '<p class="feature-help">No matching local symbols or references.</p>'}</div>`;
      this.host
        .querySelectorAll('[data-semantic]')
        .forEach((button) => (button.onclick = () => this.command(button.dataset.semantic)));
      this.host
        .querySelectorAll('[data-semantic-result]')
        .forEach(
          (button) =>
            (button.onclick = () => this.navigate(filtered[Number(button.dataset.semanticResult)])),
        );
      this.host.querySelector('.semantic-filter').oninput = (event) => {
        const caret = event.target.selectionStart;
        this.query = event.target.value;
        this.render();
        const input = this.host.querySelector('.semantic-filter');
        input.focus();
        input.setSelectionRange(caret, caret);
      };
    } finally {
      this.rendering = false;
    }
  }
}
