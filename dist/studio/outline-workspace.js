import { MarkupStructureIndex } from '../core/markup-structure.js';
import { SourceTextCoordinates } from '../core/source-text-coordinates.js';
import { OutlineTree } from '../controls/outline-tree.js';
import { WorkspaceContext } from '../workspaces/workspace-context.js';
import { studioComponentOptions } from './component-context.js';

/** IDE adapter: structural browsing never authors a document or replaces the source editor. */
export class OutlineWorkspace {
  constructor(studio) {
    this.s = studio;
    this.environment = new WorkspaceContext(studioComponentOptions(studio));
    this.states = new WeakMap();
    this.services = new WeakMap();
    this.follow = true;
    this.bound = [];
    this.frame = null;
    try {
      const env = this.environment,
        document = env.document;
      env.override(studio, 'outline', this);
      this.host = env.own(document.createElement('section'));
      this.host.className = 'markup-outline';
      this.host.innerHTML =
        '<header class="outline-heading"><strong></strong><span class="outline-count"></span></header><div class="outline-toolbar"><button data-outline-action="locate" title="Locate selected element">Locate</button><button data-outline-action="expand" title="Expand all outline branches">Expand all</button><button data-outline-action="collapse" title="Collapse all outline branches">Collapse all</button><label><input type="checkbox" checked data-outline-follow>Follow selection</label></div><input class="outline-filter" aria-label="Filter document outline" placeholder="Filter types, names and resource keys…"><p class="outline-message" role="status"></p><div class="outline-tree-host"></div><footer class="outline-toolbar"><button data-outline-action="source" title="Reveal source (Enter)">Reveal source</button><button data-outline-action="designer" title="Select in designer (Space)">Select in designer</button></footer>';
      this.filter = this.host.querySelector('.outline-filter');
      this.message = this.host.querySelector('.outline-message');
      this.tree = env.own(
        new OutlineTree(this.host.querySelector('.outline-tree-host'), {
          onSelect: (id) => this.selectInDesigner(id),
          onActivate: (id) => this.revealSource(id),
          onError: (error) => env.notify(error.message),
        }),
      );
      this.breadcrumbs = env.own(document.createElement('nav'));
      this.breadcrumbs.className = 'markup-breadcrumbs';
      this.breadcrumbs.setAttribute('aria-label', 'Source element breadcrumbs');
      this.breadcrumbs.innerHTML =
        '<button class="outline-open" title="Document outline (Ctrl+Shift+O)" aria-label="Open document outline">Outline</button><ol></ol>';
      studio.editor.host.insertBefore(
        this.breadcrumbs,
        studio.editor.host.querySelector('.editor-body'),
      );
      env.listen(this.breadcrumbs.querySelector('.outline-open'), 'click', () => this.show());
      env.listen(this.breadcrumbs, 'click', (event) => {
        const button = event.target.closest('[data-crumb-id]');
        if (button && this.breadcrumbs.contains(button)) this.revealSource(button.dataset.crumbId);
      });
      env.listen(this.filter, 'input', () => {
        this.tree.setFilter(this.filter.value);
        this.summary();
      });
      env.listen(this.filter, 'keydown', (event) => {
        if (event.isComposing) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          this.tree.focus();
        } else if (event.key === 'Escape' && this.filter.value) {
          event.preventDefault();
          event.stopPropagation();
          this.filter.value = '';
          this.tree.setFilter('');
          this.summary();
        }
      });
      env.listen(this.host, 'click', (event) => {
        const action = event.target.closest('[data-outline-action]')?.dataset.outlineAction;
        if (action === 'expand') this.tree.expandAll();
        if (action === 'collapse') this.tree.collapseAll();
        if (action === 'locate') this.locate();
        if (action === 'source') this.revealSource(this.tree.activeId);
        if (action === 'designer') this.selectInDesigner(this.tree.activeId, true);
      });
      env.listen(this.host.querySelector('[data-outline-follow]'), 'change', (event) => {
        this.follow = event.target.checked;
        if (this.follow) this.refreshSelection();
      });
      this.panel = env.own(
        studio.docking.registerPanel({
          id: 'document-outline',
          title: 'Document outline',
          content: this.host,
          icon: '≡',
        }),
      );
      const render = studio.render.bind(studio);
      env.override(studio, 'render', (...args) => {
        const result = render(...args);
        this.refresh();
        return result;
      });
      const selection = studio.editor.onSelection;
      env.override(studio.editor, 'onSelection', (...args) => {
        const result = selection?.(...args);
        this.refreshSelection();
        return result;
      });
      for (const event of ['input', 'compositionstart', 'compositionend', 'select'])
        env.listen(studio.editor.input, event, () => this.schedule());
      if (studio.density) env.listen(studio.density, 'change', () => this.layout());
      env.listen(env.window, 'resize', () => this.layout());
      this.installCommands();
      env.listen(env.document, 'keydown', (event) => {
        if (
          event.defaultPrevented ||
          event.isComposing ||
          studio.editor.composing ||
          event.altKey ||
          event.target.closest?.('#modal-root,[role=dialog],[role=alertdialog]')
        )
          return;
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
          event.preventDefault();
          event.stopPropagation();
          this.show();
        }
      });
      env.override(env.api, 'outline', {
        show: () => this.show(),
        entries: () => (this.ready(false) ? this.index.entries() : []),
        path: (id) => (this.ready(false) ? this.index.path(id) : []),
        reveal: (id) => this.revealSource(id),
        select: (id) => this.selectInDesigner(id, true),
      });
      env.add(() => {
        for (const remove of this.bound) remove();
        this.bound = [];
      });
      this.refresh();
    } catch (error) {
      this.environment.dispose();
      throw error;
    }
  }
  get disposed() {
    return this.environment.disposed;
  }
  get index() {
    const session = this.s.store.session;
    if (!this.services.has(session)) this.services.set(session, new MarkupStructureIndex(session));
    return this.services.get(session);
  }
  get coordinates() {
    const source = this.s.store.session.source;
    if (this.sourceCoordinates?.source !== source)
      this.sourceCoordinates = new SourceTextCoordinates(source);
    return this.sourceCoordinates;
  }
  installCommands() {
    const env = this.environment,
      s = this.s;
    const specs = [
      ['outline-show', 'Document outline', () => this.show(), 'Ctrl+Shift+O'],
      ['outline-locate', 'Locate selected element in outline', () => this.locate()],
    ];
    for (const [relation, label] of [
      ['parent', 'parent'],
      ['first-child', 'first child'],
      ['previous-sibling', 'previous sibling'],
      ['next-sibling', 'next sibling'],
    ]) {
      specs.push([
        'outline-' + relation,
        'Go to ' + label + ' element',
        () => this.navigate(relation, 'source'),
      ]);
      specs.push([
        'designer-outline-' + relation,
        'Select ' + label + ' element',
        () => this.navigate(relation, 'designer'),
      ]);
    }
    this.commands = new Map(
      specs.map(([id, label, run, shortcut]) => [
        id,
        {
          id,
          label,
          run,
          shortcut,
          enabled: () => !this.disposed && (id === 'outline-show' || this.ready(false)),
        },
      ]),
    );
    for (const [id, command] of this.commands) {
      const prior = s.menus.commands.get(id);
      s.menus.commands.set(id, command);
      env.add(() => {
        if (s.menus.commands.get(id) === command) {
          if (prior) s.menus.commands.set(id, prior);
          else s.menus.commands.delete(id);
        }
      });
    }
    for (const [name, prefix] of [
      ['View', 'outline-show'],
      ['Edit', 'outline-'],
      ['Designer', 'designer-outline-'],
    ]) {
      const menu = s.menus.menus.find((m) => m.label === name);
      if (!menu) continue;
      const commands = [...this.commands.values()].filter((c) => c.id.startsWith(prefix));
      const entry =
        name === 'View' ? commands[0] : { label: 'Structural navigation', children: commands };
      menu.children.push(entry);
      env.add(() => {
        const index = menu.children.indexOf(entry);
        if (index >= 0) menu.children.splice(index, 1);
      });
    }
    const original = s.command.bind(s);
    env.override(s, 'command', (id, event) =>
      this.commands.has(id) ? this.commands.get(id).run() : original(id, event),
    );
  }
  ready(notify = true) {
    const s = this.s;
    const message = this.disposed
      ? 'Document outline is closed.'
      : s.editor.composing
        ? 'Finish composing source text before navigating.'
        : !s.store.session.isValid
          ? 'Fix source errors before navigating the outline. Your draft is unchanged.'
          : this.coordinates.editorText !== s.editor.input.value
            ? 'Synchronize pending source before navigating the outline.'
            : '';
    if (message && notify) this.environment.notify(message);
    return !message;
  }
  refresh() {
    if (this.disposed || this.refreshing) return;
    this.refreshing = true;
    try {
      const session = this.s.store.session;
      const switched = this.session !== session;
      if (switched) {
        if (this.session) this.states.set(this.session, this.tree.getState());
        for (const remove of this.bound) remove();
        this.bound = [];
        this.session = session;
        const listen = (target, event, callback) => {
          target.addEventListener(event, callback);
          this.bound.push(() => target.removeEventListener(event, callback));
        };
        listen(session, 'change', () => this.schedule());
        listen(this.s.store, 'selection', () => this.refreshSelection());
        this.tree.setItems([]);
        this.treeEntries = null;
        this.crumbKey = null;
      }
      const valid = this.ready(false);
      this.tree.element.setAttribute('aria-disabled', String(!valid));
      if (valid) {
        const entries = this.index.entries();
        if (entries !== this.treeEntries) {
          this.treeEntries = entries;
          this.tree.setItems(
            entries.map((item) => ({
              ...item,
              detail: item.detail || (item.synthetic ? '(implied)' : ''),
            })),
          );
        }
      }
      if (switched) this.tree.restoreState(this.states.get(session) || {});
      this.filter.value = this.tree.query;
      this.host.querySelector('.outline-heading strong').textContent = this.s.doc.name;
      this.layout();
      this.summary();
      this.refreshSelection();
    } finally {
      this.refreshing = false;
    }
  }
  schedule() {
    if (this.disposed || this.frame !== null) return;
    this.frame = this.environment.frame(() => {
      this.frame = null;
      this.refresh();
    });
  }
  layout() {
    if (this.disposed) return;
    const view = this.host.ownerDocument.defaultView;
    const coarse = view.matchMedia?.('(pointer: coarse)').matches;
    const value = this.s.density?.value;
    this.tree.setRowHeight(
      coarse ? 40 : value === 'comfortable' ? 36 : value === 'standard' ? 29 : 24,
    );
    this.tree.render();
  }
  summary() {
    this.host.querySelector('.outline-count').textContent = `${this.tree.matchCount} elements`;
    const valid = this.ready(false);
    this.message.textContent = valid
      ? this.tree.matchCount
        ? 'Enter reveals source · Space selects in designer'
        : 'No matching elements. Clear the filter to show the document.'
      : this.s.editor.composing
        ? 'Composition in progress. Navigation is paused.'
        : 'Last valid outline. Navigation is paused until source is synchronized and valid.';
    for (const action of ['locate', 'source', 'designer'])
      this.host.querySelector(`[data-outline-action="${action}"]`).disabled = !valid;
  }
  current() {
    const s = this.s,
      input = s.editor.input;
    const active = s.documentScope?.activeElement || input.ownerDocument.activeElement;
    return active === input
      ? this.index.at(this.coordinates.toSource(input.selectionStart))
      : this.index.get(s.store.selection[0]);
  }
  refreshSelection() {
    if (this.disposed || this.acting) return;
    if (this.session !== this.s.store.session) {
      this.refresh();
      return;
    }
    const valid = this.ready(false);
    const item = valid ? this.current() : null;
    if (this.follow && item && this.tree.selectedId !== item.id)
      this.tree.select(item.id, { reveal: true });
    const path = item ? this.index.path(item.id) : [];
    const key = JSON.stringify([
      valid,
      ...path.map((node) => [node.id, node.label, node.detail, !!node.range]),
    ]);
    if (key === this.crumbKey) return;
    this.crumbKey = key;
    const list = this.breadcrumbs.querySelector('ol'),
      document = list.ownerDocument;
    // Replace only when the actual ancestry changes, not for every caret movement.
    const focusedId = document.activeElement?.dataset?.crumbId;
    list.replaceChildren();
    for (const node of path) {
      const li = document.createElement('li'),
        button = document.createElement('button');
      button.dataset.crumbId = node.id;
      button.textContent = node.label + (node.detail ? ' ' + node.detail : '');
      button.title = `${node.namespaceURI || this.s.doc.framework}${node.synthetic ? ' · implied element; no authored tag' : ` · ${node.range.line}:${node.range.column}`}`;
      button.disabled = !node.range;
      if (node === path.at(-1)) button.setAttribute('aria-current', 'location');
      li.append(button);
      list.append(li);
      if (focusedId === node.id && !button.disabled) button.focus({ preventScroll: true });
    }
    if (!path.length) {
      const li = document.createElement('li');
      li.className = 'outline-empty-crumb';
      li.textContent = valid
        ? 'Select an element or move the source caret'
        : 'Source navigation paused';
      list.append(li);
    }
  }
  show() {
    if (this.disposed) return false;
    if (this.s.docking.control.activate('document-outline', { focus: false }) === false)
      return false;
    this.refresh();
    this.filter.ownerDocument.defaultView?.focus();
    this.filter.focus({ preventScroll: true });
    return true;
  }
  locate() {
    if (!this.ready()) return false;
    const item = this.current();
    if (!item || !this.show()) return false;
    this.filter.value = '';
    this.tree.setFilter('');
    this.tree.select(item.id, { reveal: true });
    this.tree.focus(item.id);
    this.summary();
    return true;
  }
  target(id) {
    if (this.session !== this.s.store.session) {
      this.refresh();
      return null;
    }
    if (!this.ready()) return null;
    return this.index.get(id);
  }
  revealSource(id) {
    const item = this.target(id);
    if (!item) return false;
    if (!item.range) {
      this.environment.notify(
        'This element is implied by the HTML parser and has no authored source tag.',
      );
      return false;
    }
    return this.s.language.navigate({ ...item.range, nodeId: item.id });
  }
  selectInDesigner(id, show = false) {
    const item = this.target(id);
    if (!item) return false;
    const target = this.index.designerId(item.id);
    if (!target) return false;
    if (
      show &&
      this.s.docking.control.activate('document:' + this.s.doc.id, { focus: false }) === false
    )
      return false;
    this.acting = true;
    try {
      this.s.store.select([target]);
    } finally {
      this.acting = false;
    }
    this.refreshSelection();
    return true;
  }
  navigate(relation, scope = 'source') {
    if (!this.ready()) return false;
    const item =
      scope === 'source'
        ? this.index.at(this.coordinates.toSource(this.s.editor.input.selectionStart))
        : this.index.get(this.s.store.selection[0]);
    const next = item && this.index.related(item.id, relation);
    if (!next) return false;
    return scope === 'source' ? this.revealSource(next.id) : this.selectInDesigner(next.id);
  }
  dispose() {
    if (this.disposed) return;
    this.environment.dispose();
    this.session = this.treeEntries = this.sourceCoordinates = null;
    this.services = new WeakMap();
    this.states = new WeakMap();
  }
}
