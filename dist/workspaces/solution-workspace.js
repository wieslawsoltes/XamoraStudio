import { ToolkitRegistry } from '../core/registry.js';
import {
  createSolution,
  validateSolution,
  filePath,
  normalizePath,
  moveSolutionPath,
  resolvePath,
  relativePath,
  resolveDictionary,
} from '../core/solution.js';
import {
  clone,
  find,
  walk,
  localName,
  element,
  createDocument,
  reidentify,
} from '../core/model.js';
import { newRoot, parseXaml, serializeXaml } from '../core/xaml.js';
import { renameResource, resourceReferences } from '../core/authoring.js';
import { WorkspaceComponent, esc } from './workspace-context.js';

export class SolutionWorkspace extends WorkspaceComponent {
  /** @param {import('./workspace-context.js').SolutionWorkspaceHost} s
   * @param {import('./workspace-context.js').WorkspaceOptions} [workspaceOptions] */
  constructor(s, workspaceOptions = s.workspaceOptions) {
    super(workspaceOptions);
    try {
      this.s = s;
      this.environment.override(s, 'solution', this);
      this.history = [];
      this.future = [];
      this.folder = '';
      this.query = '';
      this.collapsed = new Set();
      this.viewports = new Map();
      // Dock panel registration can synchronously render every document. Publish the resolver first.
      this.resolverFor = (bound) => (source, node) => {
        const docs = s.stores.map((st) => st.document);
        let owner = docs.find((d) => {
          let identity = false;
          walk(d.root, (n) => {
            if (n === node) identity = true;
          });
          return identity;
        });
        owner ??= find(bound.root, node?.id)
          ? bound
          : docs.find((d) => find(d.root, node?.id)) || bound;
        return resolveDictionary(docs, source, owner);
      };
      this.resolve = (source, node) => this.resolverFor(s.doc)(source, node);
      this.environment.override(s.renderer, 'resourceResolver', this.resolve);
      let saved;
      try {
        saved = JSON.parse(this.environment.storage.getItem('xamora-workspace-v1'))?.solution;
      } catch {}
      this.model = createSolution(
        s.stores.map((st) => st.document),
        saved,
      );
      this.host = this.environment.own(
        this.environment.track(this.environment.document.createElement('div')),
      );
      this.host.className = 'solution-explorer';
      this.panel = this.environment.own(
        s.docking.registerPanel({
          id: 'solution',
          title: 'Solution Explorer',
          content: this.host,
          icon: '▣',
        }),
      );
      const render = s.render.bind(s);
      this.environment.override(s, 'render', () => {
        render();
        this.render();
      });
      const add = s.addStore.bind(s);
      this.environment.override(s, 'addStore', (doc) => {
        const result = add(doc);
        if (this.applying) return result;
        this.model = createSolution(
          s.stores.map((st) => st.document),
          this.model,
        );
        this.render();
        return result;
      });
      const activateBase = s.docking.originalSwitch;
      this.environment.override(s.docking, 'originalSwitch', (index) => {
        const old = s.doc.id;
        this.viewports.set(old, { zoom: s.zoom, pan: { ...s.pan }, scopeId: s.scopeId });
        activateBase(index);
        const viewport = this.viewports.get(s.doc.id),
          id = s.doc.id;
        if (old !== id && viewport)
          this.environment.frame(() => {
            if (s.doc.id !== id) return;
            s.zoom = viewport.zoom;
            s.pan = { ...viewport.pan };
            s.scopeId =
              viewport.scopeId && find(s.doc.root, viewport.scopeId) ? viewport.scopeId : null;
            s.transform();
          });
      });
      const switchDocument = s.switchDocument.bind(s);
      this.environment.override(s, 'switchDocument', (index) => {
        const old = s.doc.id;
        this.viewports.set(old, { zoom: s.zoom, pan: { ...s.pan }, scopeId: s.scopeId });
        switchDocument(index);
        if (s.doc.id === old) return index === s.active;
        const viewport = this.viewports.get(s.doc.id);
        if (viewport)
          this.environment.frame(() => {
            if (s.doc.id !== s.stores[index]?.document.id) return;
            s.zoom = viewport.zoom;
            s.pan = { ...viewport.pan };
            s.scopeId =
              viewport.scopeId && find(s.doc.root, viewport.scopeId) ? viewport.scopeId : null;
            s.transform();
          });
        this.render();
        return true;
      });
      const save = s.save.bind(s);
      this.environment.override(s, 'save', () => {
        save();
        this.render();
      });
      this.render();
      s.save();
    } catch (error) {
      try {
        this.environment.dispose();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'SolutionWorkspace initialization failed.');
      }
      throw error;
    }
  }
  snapshot() {
    return {
      documents: this.s.stores.map((st) => clone(st.document)),
      solution: clone(this.model),
      activeId: this.s.doc.id,
    };
  }
  apply(snapshot) {
    validateSolution(snapshot.documents, snapshot.solution);
    const s = this.s;
    if (s.sync?.beforeSwitch() === false)
      throw Error('Finish composing the source text before changing the solution.');
    s.blend.animation.stop();
    s.docking.refreshing = true;
    this.applying = true;
    try {
      const previous = new Map(s.stores.map((st) => [st.document.id, st]));
      const next = snapshot.documents.map((doc) => {
        let store = previous.get(doc.id);
        if (store && JSON.stringify(store.document) === JSON.stringify(doc)) return store;
        if (store) {
          store.document = clone(doc);
          store.revision++;
          store.session?.refresh();
          store.history = [];
          store.future = [];
          store.selection = store.selection.filter((id) => find(doc.root, id));
        } else store = s.addStore(clone(doc));
        return store;
      });
      s.stores = next;
      this.model = clone(snapshot.solution);
      s.active = Math.max(
        0,
        next.findIndex((st) => st.document.id === snapshot.activeId),
      );
      s.scopeId = null;
      s.editor.dirty = false;
    } finally {
      s.docking.refreshing = false;
      this.applying = false;
    }
    const activeId = s.doc.id;
    s.docking.refreshing = true;
    try {
      s.docking.syncDocuments();
      s.active = Math.max(
        0,
        s.stores.findIndex((st) => st.document.id === activeId),
      );
      s.docking.control.activate('document:' + activeId);
    } finally {
      s.docking.refreshing = false;
    }
    s.render();
    s.editor.setValue(s.store?.session?.source ?? serializeXaml(s.doc), { force: true });
    s.sync?.afterSwitch();
    s.docking.control.activate('document:' + s.doc.id);
    s.save();
  }

  mutate(label, fn) {
    if (!this.s.prepareEdit()) return false;
    const before = this.snapshot(),
      next = clone(before);
    try {
      fn(next);
      validateSolution(next.documents, next.solution);
      this.apply(next);
      this.history.push({ label, before, after: this.snapshot() });
      if (this.history.length > 30) this.history.shift();
      this.future = [];
      return true;
    } catch (e) {
      this.environment.notify(e.message);
      return false;
    }
  }
  undo() {
    if (!this.s.prepareEdit()) return;
    const step = this.history.at(-1);
    if (!step) return;
    if (
      JSON.stringify({ ...this.snapshot(), activeId: null }) !==
      JSON.stringify({ ...step.after, activeId: null })
    ) {
      this.environment.notify('Undo later document edits before undoing this solution change.');
      return;
    }
    this.history.pop();
    this.apply(step.before);
    this.future.push(step);
  }
  redo() {
    if (!this.s.prepareEdit()) return;
    const step = this.future.at(-1);
    if (!step) return;
    if (
      JSON.stringify({ ...this.snapshot(), activeId: null }) !==
      JSON.stringify({ ...step.before, activeId: null })
    ) {
      this.environment.notify('The solution changed after undo.');
      return;
    }
    this.future.pop();
    this.apply(step.after);
    this.history.push(step);
  }
  open(id, mode = 'design') {
    const i = this.s.stores.findIndex((st) => st.document.id === id);
    if (i < 0) return;
    if (this.s.switchDocument(i) !== false && this.s.doc.id === id) this.s.setView(mode);
  }
  newFile(type = 'UserControl') {
    if (!this.s.prepareEdit()) return;
    const s = this.s,
      framework = s.doc.framework === 'HTML' ? 'WPF' : s.doc.framework,
      root = newRoot(type, framework);
    if (type === 'ResourceDictionary') {
      delete root.props.Width;
      delete root.props.Height;
      delete root.props.Background;
    } else root.children.push(element('Grid'));
    if (type === 'ControlTemplate') root.props.TargetType = 'Button';
    const names = new Set(s.stores.map((st) => filePath(st.document).toLowerCase()));
    let name = type === 'ResourceDictionary' ? 'Resources.xaml' : 'New' + type + '.xaml',
      i = 2;
    while (names.has(((this.folder ? this.folder + '/' : '') + name).toLowerCase()))
      name = 'New' + type + i++ + '.xaml';
    const doc = createDocument(root, framework, name);
    doc.metadata.solutionPath = (this.folder ? this.folder + '/' : '') + name;
    if (
      !this.mutate('Add ' + name, (snap) => {
        snap.documents.push(doc);
        snap.activeId = doc.id;
      })
    )
      return;
    s.setView(type === 'ResourceDictionary' ? 'code' : 'split');
    this.selectedId = doc.id;
    this.render();
    this.host.querySelector('[data-solution-rename]')?.focus();
  }
  newFolder() {
    let name = (this.folder ? this.folder + '/' : '') + 'NewFolder',
      i = 2;
    while (this.model.folders.includes(name))
      name = (this.folder ? this.folder + '/' : '') + 'NewFolder' + i++;
    if (this.mutate('Create folder', (snap) => snap.solution.folders.push(name))) {
      this.folder = name;
      this.selectedId = null;
      this.render();
      this.host.querySelector('[data-solution-rename]')?.focus();
    }
  }
  rename(path) {
    const doc = this.s.stores.find(
      (st) => st.document.id === (this.selectedId || this.s.doc.id),
    )?.document;
    const from = this.selectedId ? filePath(doc) : this.folder;
    if (!from) {
      this.environment.notify('Select a file or folder.');
      return;
    }
    const to = normalizePath(path);
    if (to === from) return;
    if (
      !this.mutate('Move or rename ' + from, (snap) =>
        Object.assign(snap, moveSolutionPath(snap.documents, snap.solution, from, to)),
      )
    )
      return;
    if (!this.selectedId) this.folder = to;
    this.render();
  }
  duplicate() {
    if (this.folder && !this.selectedId) {
      this.environment.notify('Select a file to duplicate.');
      return;
    }
    const doc =
      this.s.stores.find((st) => st.document.id === this.selectedId)?.document || this.s.doc;
    let copy = clone(doc);
    copy.id = crypto.randomUUID();
    copy.root = reidentify(copy.root);
    const extension = doc.framework === 'HTML' ? '.html' : '.xaml';
    copy.name = doc.name.replace(/\.(xaml|html?)$/i, '') + 'Copy' + extension;
    copy.metadata.solutionPath = (this.folder ? this.folder + '/' : '') + copy.name;
    copy.metadata.interactions = [];
    delete copy.metadata.lockedIds;
    delete copy.metadata.locked;
    delete copy.metadata.hidden;
    const existing = new Set(this.s.stores.map((st) => filePath(st.document).toLowerCase()));
    const stem = copy.name.replace(/\.(xaml|html?)$/i, '');
    let suffix = 2;
    while (existing.has(copy.metadata.solutionPath.toLowerCase())) {
      copy.name = stem + suffix++ + extension;
      copy.metadata.solutionPath = (this.folder ? this.folder + '/' : '') + copy.name;
    }
    this.mutate('Duplicate file', (snap) => {
      snap.documents.push(copy);
      snap.activeId = copy.id;
    });
  }
  remove() {
    if (this.folder && !this.selectedId) {
      this.environment.notify('Select a file to remove.');
      return;
    }
    const id = this.selectedId || this.s.doc.id;
    this.mutate('Remove file', (snap) => {
      if (snap.documents.length === 1) throw Error('Keep at least one file in the solution.');
      const removed = snap.documents.find((d) => d.id === id);
      if (!removed) throw Error('Select a file.');
      for (const d of snap.documents.filter((d) => d.id !== id))
        walk(d.root, (n) => {
          if (
            n.props?.Source &&
            resolvePath(n.props.Source, filePath(d))?.toLowerCase() ===
              filePath(removed).toLowerCase()
          )
            throw Error('Remove merged dictionary references before removing this file.');
        });
      snap.documents = snap.documents.filter((d) => d.id !== id);
      for (const d of snap.documents)
        for (const c of d.metadata.interactions || [])
          c.actions = c.actions.filter((a) => a.targetViewId !== id);
      for (const d of snap.documents)
        d.metadata.interactions = (d.metadata.interactions || []).filter((c) => c.actions.length);
      if (snap.solution.startupId === id) snap.solution.startupId = snap.documents[0].id;
      if (snap.activeId === id) snap.activeId = snap.documents[0].id;
    });
    this.selectedId = null;
  }
  setStartup() {
    if (this.folder && !this.selectedId) {
      this.environment.notify('Select a startup file.');
      return;
    }
    this.mutate(
      'Set startup view',
      (snap) => (snap.solution.startupId = this.selectedId || snap.activeId),
    );
  }
  renameKey(docId, id, key) {
    this.mutate('Rename resource', (snap) => {
      const result = renameResource(snap.documents, docId, id, key, this.resolve);
      snap.documents = result.documents;
    });
  }
  references(docId, id) {
    const resource = find(this.s.stores.find((st) => st.document.id === docId)?.document.root, id);
    return resource
      ? resourceReferences(
          this.s.stores.map((st) => st.document),
          resource,
          this.resolve,
        )
      : [];
  }
  importFiles() {
    if (!this.s.prepareEdit()) return;
    const input = this.environment.track(this.environment.document.createElement('input'));
    input.type = 'file';
    input.multiple = true;
    input.accept = '.xaml,.xml,.html,.htm';
    this.environment.handler(input, 'onchange', async () => {
      try {
        const docs = [];
        for (const file of input.files) {
          if (file.size > 15e6) throw Error('Files must be smaller than 15 MB.');
          const text = await file.text();
          if (this.disposed) return;
          const doc = parseXaml(text, { name: file.name });
          doc.metadata.solutionPath = (this.folder ? this.folder + '/' : '') + file.name;
          docs.push(doc);
        }
        this.mutate('Add existing files', (snap) => {
          snap.documents.push(...docs);
          snap.activeId = docs[0]?.id || snap.activeId;
        });
      } catch (e) {
        this.environment.notify(e.message);
      }
    });
    input.click();
  }
  openSolution() {
    if (!this.s.prepareEdit()) return;
    this.s.chooseFile('.json,.xamora', async (file) => {
      if (file.size > 15e6) throw Error('Solution files must be smaller than 15 MB.');
      const text = await file.text();
      if (this.disposed) return;
      const data = JSON.parse(text);
      if (data.format !== 'xamora-workspace' || !data.documents?.length)
        throw Error('Choose an exported Xamora solution.');
      const model = createSolution(data.documents, data.solution);
      validateSolution(data.documents, model);
      const registry = new ToolkitRegistry();
      for (const toolkit of data.toolkits || []) registry.install(toolkit);
      const opened = this.mutate('Open solution', (snap) => {
        snap.documents = data.documents;
        snap.solution = model;
        snap.activeId = data.activeId || data.documents[0].id;
      });
      if (opened) {
        for (const toolkit of data.toolkits || []) this.s.registry.install(toolkit);
        this.s.save();
      }
    });
  }
  save() {
    if (this.s.editor.composing) {
      this.environment.notify('Finish composing the source text before saving the solution.');
      return;
    }
    this.s.sync?.flush();
    this.s.save();
    this.environment.saveFile(
      this.model.name.replace(/[^\w.-]+/g, '-') + '.xamora.json',
      JSON.stringify(this.s.workspaceData(), null, 2),
    );
  }
  render() {
    if (!this.host || this.rendering) return;
    this.rendering = true;
    const focused = this.host.contains(this.environment.activeElement),
      focusKey =
        this.environment.activeElement?.dataset.solutionRename !== undefined
          ? 'rename'
          : this.environment.activeElement?.dataset.solutionSearch !== undefined
            ? 'search'
            : null,
      selection = focused && this.environment.activeElement?.selectionStart;
    const scroll = this.host.querySelector('.solution-tree')?.scrollTop || 0;
    try {
      const docs = this.s.stores.map((st) => st.document),
        query = this.query.toLowerCase(),
        folderRows = this.model.folders.filter(
          (f) =>
            !query ||
            f.toLowerCase().includes(query) ||
            docs.some(
              (d) => filePath(d).startsWith(f + '/') && filePath(d).toLowerCase().includes(query),
            ),
        ),
        items = [
          ...folderRows.map((path) => ({ path, folder: true })),
          ...docs
            .filter((d) => !query || filePath(d).toLowerCase().includes(query))
            .map((doc) => ({ path: filePath(doc), doc })),
        ].sort((a, b) => a.path.localeCompare(b.path));
      this.host.innerHTML = `<header class="solution-header"><input data-solution-name value="${esc(this.model.name)}" aria-label="Solution name"><span>${docs.length} files</span></header><div class="solution-actions"><button data-sol="new" title="New UserControl">+ File</button><button data-sol="folder">+ Folder</button><button data-sol="add" title="Add existing XAML or HTML files">Add existing</button></div><input data-solution-search placeholder="Search solution…" value="${esc(this.query)}" aria-label="Search solution"><div class="solution-tree" role="tree" aria-label="Solution files">${items
        .filter(
          (item) =>
            !item.path
              .split('/')
              .slice(0, -1)
              .some((_, i, parts) => this.collapsed.has(parts.slice(0, i + 1).join('/'))),
        )
        .map(
          (item) =>
            `<button role="treeitem" ${item.folder ? `aria-expanded="${!this.collapsed.has(item.path)}"` : ''} aria-selected="${item.folder ? this.folder === item.path && !this.selectedId : item.doc.id === (this.selectedId || this.s.doc.id)}" draggable="true" data-solution-path="${esc(item.path)}" ${item.folder ? 'data-solution-folder' : `data-solution-id="${item.doc.id}"`} style="padding-left:${10 + (item.path.split('/').length - 1) * 16}px"><span>${item.folder ? (this.collapsed.has(item.path) ? '▸' : '▾') : '◇'}</span><span>${esc(item.path.split('/').at(-1))}</span>${item.doc?.id === this.model.startupId ? '<small>Start</small>' : ''}</button>`,
        )
        .join(
          '',
        )}</div><div class="solution-selection"><input data-solution-rename aria-label="Selected file or folder path" value="${esc(this.selectedId ? filePath(docs.find((d) => d.id === this.selectedId) || this.s.doc) : this.folder || filePath(this.s.doc))}"><div><button data-sol="open">Design</button><button data-sol="source">Source</button><button data-sol="startup">Set startup</button><button data-sol="remove">Remove file</button><button data-sol="convert" title="Convert selected document or folder">Convert…</button></div><small>Drag files into folders. Closing an editor keeps its file here.</small></div>`;
      this.host.querySelector('.solution-tree').scrollTop = scroll;
      this.environment.handler(
        this.host.querySelector('[data-solution-search]'),
        'oninput',
        (e) => {
          this.query = e.target.value;
          this.render();
        },
      );
      this.environment.handler(this.host.querySelector('[data-solution-name]'), 'onchange', (e) =>
        this.mutate('Rename solution', (snap) => (snap.solution.name = e.target.value.trim())),
      );
      this.environment.handler(
        this.host.querySelector('[data-solution-rename]'),
        'onchange',
        (e) => {
          try {
            if (!this.selectedId && !this.folder) this.selectedId = this.s.doc.id;
            this.rename(e.target.value);
          } catch (error) {
            this.environment.notify(error.message);
          }
        },
      );
      this.host.querySelectorAll('[data-sol]').forEach((b) =>
        this.environment.handler(b, 'onclick', () => {
          const action = b.dataset.sol;
          if (action === 'new') this.newFile();
          if (action === 'folder') this.newFolder();
          if (action === 'add') this.importFiles();
          if (action === 'open' || action === 'source')
            this.open(this.selectedId || this.s.doc.id, action === 'source' ? 'code' : 'design');
          if (action === 'startup') this.setStartup();
          if (action === 'remove') this.remove();
          if (action === 'convert')
            this.s.compiler?.show({
              scope: this.folder && !this.selectedId ? 'folder' : 'document',
            });
        }),
      );
      this.host.querySelectorAll('[data-solution-path]').forEach((row) => {
        this.environment.handler(row, 'onclick', () => {
          if (row.dataset.solutionId) {
            this.selectedId = row.dataset.solutionId;
            this.folder = row.dataset.solutionPath.split('/').slice(0, -1).join('/');
          } else {
            this.selectedId = null;
            this.folder = row.dataset.solutionPath;
          }
          this.render();
        });
        this.environment.handler(row, 'ondblclick', () => {
          if (row.dataset.solutionId) this.open(row.dataset.solutionId);
          else {
            const p = row.dataset.solutionPath;
            this.collapsed.has(p) ? this.collapsed.delete(p) : this.collapsed.add(p);
            this.render();
          }
        });
        this.environment.handler(row, 'ondragstart', (e) => {
          e.stopPropagation();
          e.dataTransfer.setData('application/x-xamora-file', row.dataset.solutionPath);
        });
        this.environment.handler(row, 'ondragover', (e) => {
          if (!row.dataset.solutionId) {
            e.preventDefault();
            row.classList.add('drop-target');
          }
        });
        this.environment.handler(row, 'ondragleave', () => row.classList.remove('drop-target'));
        this.environment.handler(row, 'ondrop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove('drop-target');
          const from = e.dataTransfer.getData('application/x-xamora-file');
          if (from && !row.dataset.solutionId)
            this.mutate('Move file', (snap) =>
              Object.assign(
                snap,
                moveSolutionPath(
                  snap.documents,
                  snap.solution,
                  from,
                  row.dataset.solutionPath + '/' + from.split('/').at(-1),
                ),
              ),
            );
        });
        this.environment.handler(row, 'onkeydown', (e) => {
          if (
            [
              'Delete',
              'Backspace',
              'ArrowUp',
              'ArrowDown',
              'ArrowLeft',
              'ArrowRight',
              'Enter',
              'F2',
            ].includes(e.key)
          ) {
            e.preventDefault();
            e.stopPropagation();
            if (e.key === 'Enter') row.ondblclick();
            if (e.key === 'F2') {
              this.selectedId = row.dataset.solutionId || null;
              this.folder = row.dataset.solutionPath;
              this.render();
              this.host.querySelector('[data-solution-rename]').focus();
            }
            if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
              const rows = [...this.host.querySelectorAll('[role=treeitem]')],
                index = rows.indexOf(row);
              rows[
                Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
              ]?.focus();
            }
            if (e.key === 'ArrowLeft') {
              this.collapsed.add(row.dataset.solutionPath);
              this.render();
            }
            if (e.key === 'ArrowRight') {
              this.collapsed.delete(row.dataset.solutionPath);
              this.render();
            }
          }
        });
      });
      if (focused && focusKey) {
        const el = this.host.querySelector(
          focusKey === 'rename' ? '[data-solution-rename]' : '[data-solution-search]',
        );
        el.focus();
        if (Number.isInteger(selection)) el.setSelectionRange(selection, selection);
      }
      this.environment.query('.file-folder').textContent = this.model.name;
    } finally {
      this.rendering = false;
    }
  }
  dispose() {
    if (this.disposed) return;
    try {
      this.host.remove();
      this.viewports.clear();
    } finally {
      super.dispose();
    }
  }
}
