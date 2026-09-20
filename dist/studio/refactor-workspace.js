import { MarkupRefactorService } from '../core/markup-refactoring.js';
import { find, parentOf, isProperty, isXamlInline } from '../core/model.js';
import { isLocked } from '../core/design-tools.js';
import { esc, notify } from './ui.js';

/** Source and canvas commands share the same reviewed, revision-checked AST plans. */
export class RefactorWorkspace {
  constructor(studio) {
    this.s = studio;
    this.apiHost = studio.editor.host.ownerDocument.defaultView;
    this.services = new WeakMap();
    this.disposed = false;
    studio.refactoring = this;
    const specs = [
      ['language-rename-tag', 'Rename element tag…', 'rename', 'source', 'Shift+F2'],
      ['language-wrap-element', 'Wrap element…', 'wrap', 'source', ''],
      ['language-unwrap-element', 'Unwrap element…', 'unwrap', 'source', ''],
      ['designer-rename-tag', 'Rename selected element tag…', 'rename', 'designer', ''],
      ['designer-wrap-element', 'Wrap selected elements…', 'wrap', 'designer', ''],
      ['designer-unwrap-element', 'Unwrap selected element…', 'unwrap', 'designer', ''],
    ];
    this.commands = new Map(
      specs.map(([id, label, kind, scope, shortcut]) => [
        id,
        {
          id,
          label,
          shortcut,
          run: () => this.open(kind, scope),
          enabled: () =>
            !this.disposed &&
            !studio.editor.input.readOnly &&
            !studio.editor.composing &&
            studio.store.session.isValid &&
            (scope === 'source' || studio.store.selection.length > 0),
        },
      ]),
    );
    for (const [id, command] of this.commands) studio.menus.commands.set(id, command);
    this.menuEntries = [];
    for (const [menu, prefix] of [
      ['Edit', 'language-'],
      ['Designer', 'designer-'],
    ]) {
      const parent = studio.menus.menus.find((m) => m.label === menu);
      if (!parent) continue;
      const separator = { separator: true };
      const entry = {
        label: 'Refactor markup',
        children: [...this.commands.values()].filter((c) => c.id.startsWith(prefix)),
      };
      parent.children.push(separator, entry);
      this.menuEntries.push([parent, separator, entry]);
    }
    const command = studio.command.bind(studio);
    this.previousCommand = studio.command;
    this.command = studio.command = (id, event) =>
      this.commands.has(id) ? this.commands.get(id).run() : command(id, event);
    const semantic = studio.editor.onSemanticCommand;
    this.previousSemantic = semantic;
    this.semantic = studio.editor.onSemanticCommand = (id) =>
      this.commands.has(id) ? this.commands.get(id).run() : semantic?.(id);
    this.previousAPI = this.apiHost.xamora.refactoring;
    this.api = this.apiHost.xamora.refactoring = {
      open: (kind = 'rename', scope = 'source') => this.open(kind, scope),
      linkedTagRanges: (offset) => (this.disposed ? [] : this.service.linkedTagRanges(offset)),
    };
  }
  get service() {
    const session = this.s.store.session;
    if (!this.services.has(session))
      this.services.set(session, new MarkupRefactorService(session, { registry: this.s.registry }));
    return this.services.get(session);
  }
  ready() {
    if (this.disposed) throw Error('The refactoring workspace is closed.');
    if (this.s.editor.composing) throw Error('Finish composing source text before refactoring.');
    if (this.s.editor.input.readOnly) throw Error('This source editor is read-only.');
    if (this.s.sync && !this.s.sync.flush())
      throw Error('Fix source errors before refactoring. Your draft is unchanged.');
    this.service.ready();
  }
  open(kind = 'rename', scope = 'source') {
    try {
      this.ready();
      if (!['rename', 'wrap', 'unwrap'].includes(kind) || !['source', 'designer'].includes(scope))
        throw Error('Choose a supported refactoring action and scope.');
      const s = this.s,
        session = s.store.session,
        service = this.service,
        revision = session.revision,
        selection = [...s.store.selection];
      let ids;
      if (scope === 'designer') ids = selection;
      else {
        const range = s.language.service.elementAt(s.editor.input.selectionStart);
        let node = range && find(s.doc.root, range.nodeId);
        while (node && s.doc.framework !== 'HTML' && isProperty(node))
          node = parentOf(s.doc.root, node.id);
        ids = node ? [node.id] : [];
      }
      if (!ids.length || (kind !== 'wrap' && ids.length !== 1))
        throw Error('Select one element, or consecutive sibling elements to wrap.');
      const targets = ids.map((id) => service.target(id).node),
        html = s.doc.framework === 'HTML',
        first = targets[0];
      let plan = null;
      const check = (flush = false) => {
        if (flush) this.ready();
        if (this.disposed || s.editor.input.readOnly || s.editor.composing || !session.isValid)
          throw Error('The editor is not available for refactoring.');
        if (
          s.store.session !== session ||
          session.revision !== revision ||
          (scope === 'designer' && JSON.stringify(s.store.selection) !== JSON.stringify(selection))
        )
          throw Error(
            'The document or selection changed. Close this dialog and review a new proposal.',
          );
        if (s.editor.input.value !== session.source)
          throw Error('Pending source input changed. Close this dialog and review a new proposal.');
        if (ids.some((id) => isLocked(s.doc, id)))
          throw Error('Unlock the selected element before refactoring.');
      };
      const apply = () => {
        check(true);
        if (!plan) throw Error('Review a valid refactoring proposal first.');
        // Parents and descendants touched by grouping/removal must respect design locks too.
        if (plan.affectedNodeIds.some((id) => isLocked(s.doc, id)))
          throw Error('Unlock all affected elements before applying this refactor.');
        const reviewed = plan;
        const result = service.apply(reviewed);
        s.closeModal();
        s.sync?.updateEditor();
        if (scope === 'source') {
          const span = session.sourceAtNode(result.selectedId);
          if (span)
            s.language.navigate(
              {
                start: span.nameStart ?? span.start,
                end: span.nameEnd ?? span.openEnd,
                nodeId: result.selectedId,
              },
              { record: false },
            );
        }
        notify(result.changed ? reviewed.title + ' · Undo is available.' : 'The tag is unchanged.');
      };
      const defaultName =
        kind === 'rename'
          ? first.type
          : html
            ? first.namespaceURI === 'http://www.w3.org/2000/svg'
              ? 'g'
              : first.namespaceURI === 'http://www.w3.org/1998/Math/MathML'
                ? 'mrow'
                : 'div'
            : (first.type.includes(':') ? first.type.split(':')[0] + ':' : '') +
              (isXamlInline(first) ? 'Span' : ids.length > 1 ? 'StackPanel' : 'Border');
      s.modal(
        kind === 'rename'
          ? 'Rename element tag'
          : kind === 'wrap'
            ? 'Wrap elements'
            : 'Unwrap element',
        `<section class="markup-refactor" data-refactor-dialog><p>${esc(s.doc.name)} · ${esc(targets.map((n) => n.type).join(', '))}</p>
          ${kind === 'unwrap' ? '' : `<label>${kind === 'rename' ? 'New tag name' : 'Wrapper tag'}<input data-refactor-name aria-label="${kind === 'rename' ? 'New tag name' : 'Wrapper tag'}" autocomplete="off" spellcheck="false" value="${esc(defaultName)}"></label>`}
          <p class="feature-help">Only this document is changed. Review source and warnings before applying. Existing child identities and Undo are retained.</p>
          <p data-refactor-status role="status" aria-live="polite"></p><ul data-refactor-warnings></ul>
          <details open><summary>Proposed source</summary><pre data-refactor-after></pre></details>
          <details><summary>Original source</summary><pre data-refactor-before></pre></details></section>`,
        [{ label: 'Apply refactor', primary: true, run: apply }],
        true,
      );
      const dialog = (this.dialog = s.dialogHost.element),
        signal = s.dialogHost.signal,
        input = dialog.querySelector('[data-refactor-name]'),
        button = dialog.querySelector('.modal-footer .primary'),
        status = dialog.querySelector('[data-refactor-status]');
      const update = () => {
        if (signal.aborted) return;
        try {
          check();
          plan =
            kind === 'rename'
              ? service.prepareRename(ids[0], input.value.trim())
              : kind === 'wrap'
                ? service.prepareWrap(ids, input.value.trim())
                : service.prepareUnwrap(ids[0]);
          if (plan.affectedNodeIds.some((id) => isLocked(s.doc, id)))
            throw Error('Unlock all affected elements before applying this refactor.');
          status.textContent =
            plan.before === plan.after
              ? 'Enter a different tag name to change this element.'
              : 'Validated against the parser. Ready to review.';
          s.dialogHost.setActionDisabled(0, plan.before === plan.after);
          const warnings = dialog.querySelector('[data-refactor-warnings]');
          warnings.replaceChildren();
          for (const message of plan.warnings) {
            const li = dialog.ownerDocument.createElement('li');
            li.textContent = message;
            warnings.append(li);
          }
          for (const [key, source] of [
            ['before', plan.before],
            ['after', plan.after],
          ])
            dialog.querySelector(`[data-refactor-${key}]`).textContent =
              source.length > 60000
                ? source.slice(0, 60000) +
                  '\n… Preview truncated; full source is retained by the proposal.'
                : source;
        } catch (error) {
          plan = null;
          s.dialogHost.setActionDisabled(0, true);
          status.textContent = error.message;
          dialog.querySelector('[data-refactor-after]').textContent = '';
        }
      };
      input?.addEventListener('input', update, { signal });
      input?.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            if (!button.disabled) button.click();
          }
        },
        { signal },
      );
      // A change in another popup invalidates the visible proposal immediately.
      const invalidate = () => update();
      session.addEventListener('change', invalidate);
      s.store.addEventListener('selection', invalidate);
      signal.addEventListener(
        'abort',
        () => {
          session.removeEventListener('change', invalidate);
          session.store.removeEventListener('selection', invalidate);
          plan = null;
        },
        { once: true },
      );
      update();
      input?.focus();
      input?.select();
      return true;
    } catch (error) {
      notify(error.message);
      return false;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.dialog && this.s.dialogHost?.element === this.dialog) this.s.closeModal();
    this.dialog = null;
    for (const [parent, ...entries] of this.menuEntries)
      parent.children = parent.children.filter((item) => !entries.includes(item));
    this.menuEntries.length = 0;
    if (this.apiHost.xamora?.refactoring === this.api) {
      if (this.previousAPI === undefined) delete this.apiHost.xamora.refactoring;
      else this.apiHost.xamora.refactoring = this.previousAPI;
    }
    if (this.s.command === this.command) this.s.command = this.previousCommand;
    if (this.s.editor.onSemanticCommand === this.semantic)
      this.s.editor.onSemanticCommand = this.previousSemantic;
    for (const [id, command] of this.commands)
      if (this.s.menus.commands.get(id) === command) this.s.menus.commands.delete(id);
  }
}
