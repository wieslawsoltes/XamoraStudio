import {
  DockLayout,
  createDockLayout,
  locatePanel,
  dockGroups,
  findDock,
  walkDock,
} from '../core/docking.js';
import { DockWorkspace } from '../controls/dock-workspace.js';
import { PreviewRenderer } from '../core/render.js';
import { listStoryboards } from '../core/animation.js';
import { clone, find } from '../core/model.js';
import { esc, $, $$, notify } from './ui.js';
const LEFT = { layers: 'Layers', toolkit: 'Toolbox', assets: 'Resources', data: 'Data sources' };
const RIGHT = {
  design: 'Properties',
  raw: 'Raw properties',
  flow: 'Interactions',
  inspect: 'XAML inspector',
  notes: 'Annotations',
};
const rightId = (key) => (key === 'design' ? 'properties' : key);
const docId = (doc) => 'document:' + doc.id;
const STORAGE = 'xamora-dock-layout-v1',
  SAVED = 'xamora-dock-presets-v1';
const make = (cls) => {
  const n = document.createElement('div');
  n.className = cls;
  return n;
};

/** Studio adapter. Docking has its own history and never edits the design model. */
export class DockingStudio {
  constructor(studio) {
    const s = (this.s = studio);
    s.docking = this;
    this.refreshing = true;
    this.switching = false;
    this.named = {};
    this.lastLeft = s.leftTab;
    this.lastRight = s.rightTab;
    this.documentHosts = new Map();
    this.passiveRenderers = new Map();
    this.workspace = $('.workspace');
    this.canvas = $('.center');
    this.code = $('#code-panel');
    this.code.remove();
    this.viewsHost = make('dock-view-content');
    this.timelineHost = make('dock-timeline-content');
    this.problemsHost = make('dock-problems-content');
    const existingTimeline = $('#animation-panel');
    if (existingTimeline) this.timelineHost.append(existingTimeline);
    const existingViews = $('#views-board');
    if (existingViews) this.viewsHost.append(existingViews);
    const content = new Map();
    const left = $('#left-content'),
      inspector = $('#inspector'),
      notes = $('#notes-count');
    for (const [id, title] of Object.entries(LEFT)) {
      const host = id === 'layers' ? left : make('panel-content');
      host.dataset.leftHost = id;
      host.classList.add('dock-sidebar-content');
      if (id !== 'layers') host.id = 'dock-' + id + '-content';
      content.set(id, host);
    }
    for (const [mode, title] of Object.entries(RIGHT)) {
      const host = mode === 'design' ? inspector : make('');
      host.dataset.inspectorHost = mode;
      host.classList.add('dock-inspector-content');
      content.set(rightId(mode), host);
    }
    content.set('xaml', this.code);
    content.set('views', this.viewsHost);
    content.set('timeline', this.timelineHost);
    content.set('problems', this.problemsHost);
    const panels = [
      ...Object.entries(LEFT).map(([id, title]) => ({
        id,
        title,
        kind: 'tool',
        icon: id === 'layers' ? '▱' : id === 'toolkit' ? '⊞' : id === 'assets' ? '◇' : '▤',
      })),
      ...Object.entries(RIGHT).map(([mode, title]) => ({
        id: rightId(mode),
        title,
        kind: 'tool',
        icon: mode === 'design' ? '⚙' : '▤',
      })),
      { id: 'xaml', title: 'XAML source', kind: 'document', icon: '〈〉' },
      { id: 'views', title: 'Views & connections', kind: 'document', icon: '▦' },
      {
        id: 'timeline',
        title: 'Objects & timeline',
        kind: 'tool',
        icon: '◇',
        onClose: () => {
          s.blend.animation.stop();
          s.blend.animation.open = false;
        },
      },
      { id: 'problems', title: 'Error list', kind: 'tool', icon: '⚑' },
    ];
    for (const store of s.stores) {
      const doc = store.document,
        host = make('dock-document-content');
      this.documentHosts.set(doc.id, host);
      content.set(docId(doc), host);
      panels.push({
        id: docId(doc),
        title: doc.name,
        kind: 'document',
        icon: '◇',
        documentId: doc.id,
        onClose: () => s.prepareEdit(),
      });
    }
    const initial = createDockLayout(
      panels.map((p) => p.id),
      {
        documents: s.stores.map((st) => docId(st.document)),
        preset: window.innerWidth < 900 ? 'compact' : 'designer',
      },
    );
    this.model = new DockLayout(panels, initial);
    try {
      const saved = localStorage.getItem(STORAGE);
      if (saved) this.model.load(saved, { reconcile: true });
      const named = JSON.parse(localStorage.getItem(SAVED) || '{}');
      if (named && typeof named === 'object' && !Array.isArray(named))
        this.named = Object.fromEntries(
          Object.entries(named).filter(([name]) => name !== '__proto__' && name !== 'constructor'),
        );
    } catch (error) {
      notify('The saved window layout could not be restored. Using the default layout.');
    }
    // Preserve the singleton status element before removing old sidebar wrappers.
    const status = make('dock-legacy-status');
    status.hidden = true;
    status.append(notes);
    this.workspace.append(status);
    this.canvas.classList.add('dock-live-canvas');
    for (const node of content.values()) this.workspace.append(node);
    this.workspace.append(this.canvas);
    $('.left-panel')?.remove();
    $('.right-panel')?.remove();
    $('#studio').classList.add('docking-enabled');
    $('#studio').classList.remove(
      'design-only',
      'code-only',
      'multi-view',
      'focus-mode',
      'show-layers',
      'show-inspector',
    );
    this.control = new DockWorkspace(this.workspace, this.model, {
      keyboardScope: 'document',
      beforeActivate: (id) => this.beforeActivate(id),
      onChange: (label) => this.layoutChanged(label),
      onVisibility: (id, visible) => this.visibility(id, visible),
    });
    for (const [id, node] of content) this.control.mount(id, node);
    this.canvasParking = make('dock-canvas-parking');
    this.canvasParking.hidden = true;
    this.workspace.append(this.canvasParking);
    this.canvasParking.append(this.canvas);
    this.installRenderers();
    this.installCommands();
    this.installWindowMenu();
    this.control.addEventListener('resize', () => this.resize());
    s.editor.input?.addEventListener('input', () => this.updateTitles());
    window.addEventListener('pagehide', () => {
      try {
        localStorage.setItem(STORAGE, this.model.serialize());
      } catch {}
    });
    this.refreshing = false;
    this.syncDocuments();
    s.renderLeft();
    s.renderInspector();
    this.refreshProblems();
    this.syncCanvas();
    this.control.render();
    this.control.activate(docId(s.doc));
    this.persist();
    this.splitOrientation = localStorage.getItem('xamora-split-orientation') || 'vertical';
    Object.assign(window.xamora, {
      docking: {
        model: this.model,
        control: this.control,
        registerPanel: (descriptor) => this.registerPanel(descriptor),
        show: (id) => this.control.show(id),
        close: (id) => this.control.hide(id),
        saveLayout: () => this.model.serialize(),
        loadLayout: (layout) => this.model.load(layout, { reconcile: true }),
        reset: () => this.preset('designer'),
      },
    });
  }
  beforeActivate(id) {
    const descriptor = this.model.panels.get(id);
    if (descriptor?.documentId && descriptor.documentId !== this.s.doc.id) {
      const index = this.s.stores.findIndex((st) => st.document.id === descriptor.documentId);
      if (index < 0) return false;
      this.switching = true;
      try {
        this.originalSwitch(index);
      } finally {
        this.switching = false;
      }
      if (this.s.doc.id !== descriptor.documentId) return false;
    }
    return true;
  }
  installRenderers() {
    const s = this.s,
      left = s.renderLeft.bind(s),
      right = s.renderInspector.bind(s),
      render = s.render.bind(s);
    this.originalSwitch = s.switchDocument.bind(s);
    s.renderLeft = () => {
      if (this.renderingLeft) return;
      this.renderingLeft = true;
      const selected = s.leftTab,
        changed = selected !== this.lastLeft;
      try {
        for (const mode of Object.keys(LEFT)) {
          s.leftTab = mode;
          left();
        }
      } finally {
        s.leftTab = selected;
        this.lastLeft = selected;
        this.renderingLeft = false;
      }
      if (changed && !this.refreshing) this.control.show(selected);
    };
    s.renderInspector = () => {
      if (this.renderingRight) return;
      this.renderingRight = true;
      const selected = s.rightTab,
        changed = selected !== this.lastRight;
      try {
        for (const mode of Object.keys(RIGHT)) {
          s.rightTab = mode;
          right();
        }
      } finally {
        s.rightTab = selected;
        this.lastRight = selected;
        this.renderingRight = false;
      }
      if (changed && !this.refreshing) this.control.show(rightId(selected));
    };
    s.render = () => {
      render();
      if (!this.refreshing) {
        this.syncDocuments();
        this.refreshProblems();
        this.syncCanvas();
        this.updateTitles();
        if (this.control.visible.has('timeline') && !s.blend.animation.story)
          this.visibility('timeline', true);
      }
    };
    s.switchDocument = (index) => {
      if (this.switching) return this.originalSwitch(index);
      this.switching = true;
      try {
        this.originalSwitch(index);
      } finally {
        this.switching = false;
      }
      this.syncDocuments();
      this.syncCanvas();
      if (this.s.stores[index] && s.active === index) this.control.activate(docId(s.doc));
    };
    const addStore = s.addStore.bind(s);
    s.addStore = (doc) => {
      const result = addStore(doc);
      if (!this.refreshing) this.syncDocuments();
      return result;
    };
    s.setView = (view) => this.setView(view);
    const board = s.features.prototype.board.bind(s.features.prototype);
    s.features.prototype.board = () => {
      board();
      this.resize();
    };
  }
  syncDocuments() {
    if (this.syncingDocuments) return;
    this.syncingDocuments = true;
    try {
      const ids = new Set(this.s.stores.map((st) => st.document.id));
      for (const [id, host] of this.documentHosts)
        if (!ids.has(id)) {
          const panel = 'document:' + id;
          this.control.contents.delete(panel);
          host.remove();
          this.documentHosts.delete(id);
          this.passiveRenderers.delete(id);
          this.model.unregister(panel);
        }
      for (const store of this.s.stores) {
        const doc = store.document,
          id = docId(doc);
        if (!this.documentHosts.has(doc.id)) {
          const host = make('dock-document-content');
          this.documentHosts.set(doc.id, host);
          this.model.register({
            id,
            title: doc.name,
            kind: 'document',
            icon: '◇',
            documentId: doc.id,
            onClose: () => this.s.prepareEdit(),
          });
          this.control.mount(id, host);
          const target = dockGroups(this.model.state).find(
            (g) => g.kind === 'document' && g.panels.some((p) => p.startsWith('document:')),
          );
          this.model.dock(id, target?.id || this.model.state.root?.id, target ? 'center' : 'left');
        }
      }
    } finally {
      this.syncingDocuments = false;
    }
  }
  syncCanvas() {
    const s = this.s,
      current = this.documentHosts.get(s.doc.id);
    if (!current) return;
    for (const store of s.stores) {
      const doc = store.document,
        host = this.documentHosts.get(doc.id);
      if (!host) continue;
      if (doc.id === s.doc.id) {
        if (!host.contains(this.canvas)) {
          host.replaceChildren(this.canvas);
          this.canvas.hidden = false;
        }
      } else {
        if (host.contains(this.canvas)) this.canvasParking.append(this.canvas);
        this.renderPassive(doc, host);
      }
    }
  }
  renderPassive(doc, host) {
    const signature = JSON.stringify([
      doc,
      this.s.features.data?.context?.() || {},
      this.s.stores
        .map((st) => st.document.root)
        .filter((root) => root.type?.endsWith('ResourceDictionary')),
    ]);
    let entry = this.passiveRenderers.get(doc.id);
    if (entry?.signature === signature && host.querySelector('.dock-passive-document')) return;
    host.replaceChildren();
    const wrapper = make('dock-passive-document'),
      surface = make('dock-passive-surface'),
      label = make('dock-passive-label');
    label.textContent = 'Click to edit ' + doc.name;
    wrapper.append(surface, label);
    host.append(wrapper);
    const renderer = new PreviewRenderer(this.s.registry);
    renderer.sampleData = {
      ...(doc.metadata.sampleData || {}),
      ...(this.s.features.data?.context?.() || {}),
    };
    renderer.resourceResolver =
      this.s.solution?.resolverFor(doc) || this.s.renderer.resourceResolver;
    renderer.render(doc, surface, { interactive: false, designTime: true });
    const activate = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.control.activate(docId(doc))) requestAnimationFrame(() => this.s.drawSelection());
    };
    wrapper.addEventListener('pointerdown', activate);
    if (doc.framework === 'HTML')
      renderer.onHtmlReady = (r) =>
        r.frame.contentDocument.addEventListener('pointerdown', activate);
    entry = { signature, renderer, surface, wrapper, doc };
    this.passiveRenderers.set(doc.id, entry);
    this.scalePassive(entry);
  }
  scalePassive(entry) {
    if (!entry.wrapper.isConnected || !entry.wrapper.clientWidth) return;
    const width = entry.doc.design.width || 1100,
      height = entry.doc.design.height || 760,
      scale = Math.max(
        0.05,
        Math.min(
          (entry.wrapper.clientWidth - 40) / width,
          (entry.wrapper.clientHeight - 50) / height,
          1,
        ),
      );
    Object.assign(entry.surface.style, {
      width: width + 'px',
      height: height + 'px',
      transform: `translate(-50%,-50%) scale(${scale})`,
    });
  }
  updateTitles() {
    for (const store of this.s.stores) {
      const p = this.model.panels.get(docId(store.document));
      if (p) p.title = store.document.name;
    }
    const source = this.model.panels.get('xaml');
    source.title =
      this.s.doc.name +
      (this.s.editor.dirty ? ' *' : '') +
      ' · ' +
      (this.s.doc.framework === 'HTML' ? 'HTML' : 'XAML');
    for (const tab of this.control.shell.querySelectorAll('[data-dock-panel]')) {
      const id = tab.dataset.dockPanel,
        title = this.control.title(id);
      const text = tab.querySelector('.dock-tab-text');
      if (text) text.textContent = title;
      tab.title = title;
    }
    for (const strip of this.control.strips.values()) strip.update();
  }
  layoutChanged(label) {
    if (this.refreshing) return;
    const id = this.model.state.activePanel;
    if (LEFT[id]) {
      this.s.leftTab = id;
      this.lastLeft = id;
    }
    const mode = Object.keys(RIGHT).find((mode) => rightId(mode) === id);
    if (mode) {
      this.s.rightTab = mode;
      this.lastRight = mode;
    }
    const active = this.model.panels.get(id);
    if (
      active?.documentId &&
      active.documentId !== this.s.doc.id &&
      !this.switching &&
      this.beforeActivate(id) === false
    ) {
      this.control.activate(docId(this.s.doc));
      return;
    }
    this.syncCanvas();
    this.updateTitles();
    this.persist();
    this.resize();
  }
  visibility(id, visible) {
    if (this.refreshing) return;
    if (id === 'timeline') {
      if (visible) {
        const animation = this.s.blend.animation;
        animation.open = true;
        if (!animation.story) animation.storyId = listStoryboards(this.s.doc)[0]?.id || null;
        animation.player.duration = animation.duration;
        animation.render();
      } else {
        this.s.blend.animation.stop();
      }
    }
    if (id === 'views' && visible && !this.viewsHost.querySelector('#views-board'))
      this.s.features.prototype.board();
  }
  resize() {
    cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(() => {
      this.s.drawGrid();
      this.s.drawSelection();
      for (const entry of this.passiveRenderers.values()) this.scalePassive(entry);
      if (this.viewsHost.querySelector('#views-board')) this.s.features.prototype.drawConnections();
    });
  }
  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE, this.model.serialize());
      } catch {
        notify('Window layout could not be saved on this device.');
      }
    }, 180);
  }
  setView(view) {
    if (!['design', 'split', 'code', 'views'].includes(view)) return false;
    const s = this.s;
    if (!s.prepareEdit()) return false;
    const id = docId(s.doc),
      pages = [...this.model.panels.values()].filter((p) => p.documentId).map((p) => p.id),
      exclusive = view === 'code' || view === 'views',
      previousVisible = new Set(this.control.visible);
    this.refreshing = true;
    try {
      this.model.batch('Change document mode', () => {
        if (exclusive && !this.model.state.modeRestore) {
          const saved = clone(this.model.state);
          delete saved.modeRestore;
          this.model.transaction('Remember editor arrangement', (d) => (d.modeRestore = saved));
        }
        if (!exclusive && this.model.state.modeRestore)
          this.model.load(this.model.state.modeRestore, { reconcile: true });
        this.model.zoomGroup(null);
        const preferred = view === 'code' ? 'xaml' : view === 'views' ? 'views' : id;
        if (exclusive) {
          const current = [id, 'xaml', 'views']
              .map((p) => locatePanel(this.model.state, p))
              .find((p) => p?.kind === 'group' && !p.floating && p.group.kind === 'document'),
            place = locatePanel(this.model.state, preferred);
          if (current && (!place?.group || place.floating || place.group.id !== current.group.id))
            this.model.dock(preferred, current.group.id, 'center');
          else this.model.show(preferred);
          for (const panel of pages)
            if (locatePanel(this.model.state, panel)?.kind !== 'hidden') this.model.hide(panel);
          this.model.hide(view === 'code' ? 'views' : 'xaml');
        } else {
          this.model.show(id);
          this.model.hide('views');
          if (view === 'design') this.model.hide('xaml');
          else {
            const target = locatePanel(this.model.state, id).group,
              source = locatePanel(this.model.state, 'xaml'),
              axis = this.splitOrientation === 'horizontal' ? 'horizontal' : 'vertical';
            let paired = false;
            for (const root of [
              this.model.state.root,
              ...this.model.state.floating.map((f) => f.root),
            ])
              walkDock(root, (n) => {
                if (
                  n.type === 'split' &&
                  n.axis === axis &&
                  ((n.first.id === target.id && n.second.id === source?.group?.id) ||
                    (n.second.id === target.id && n.first.id === source?.group?.id))
                )
                  paired = true;
              });
            if (!paired)
              this.model.dock('xaml', target.id, axis === 'horizontal' ? 'right' : 'bottom');
          }
        }
        this.model.activate(preferred);
      });
      s.view = view;
      $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
      if (view === 'views') s.features.prototype.board();
      try {
        localStorage.setItem('xamora-document-mode', view);
      } catch {}
    } finally {
      this.refreshing = false;
    }
    this.syncCanvas();
    this.control.render();
    for (const panel of previousVisible)
      if (!this.control.visible.has(panel)) this.visibility(panel, false);
    for (const panel of this.control.visible)
      if (!previousVisible.has(panel)) this.visibility(panel, true);
    this.layoutChanged('Change document mode');
    return true;
  }
  setSplitOrientation(axis) {
    this.splitOrientation = axis;
    localStorage.setItem('xamora-split-orientation', axis);
    this.setView('split');
  }

  showTimeline() {
    if (this.revealingTimeline) return;
    this.revealingTimeline = true;
    try {
      this.s.blend.animation.open = true;
      this.s.blend.animation.render();
      this.control.show('timeline');
    } finally {
      this.revealingTimeline = false;
    }
  }
  toggleTimeline() {
    if (!this.control.visible.has('timeline')) this.s.blend.animation.show();
    else this.control.hide('timeline');
  }
  refreshProblems() {
    const host = this.problemsHost,
      issues = this.s.issues || [];
    host.innerHTML = `<div class="dock-error-toolbar"><strong>${issues.length} diagnostics</strong><button class="button" data-action="symbols">Document symbols</button></div><div class="dock-error-list">${issues.map((d, index) => `<button class="dock-error-row ${d.severity}" data-dock-issue="${index}"><span>${d.severity === 'error' ? '●' : '▲'}</span><span>${esc(d.message)}</span><span>${esc(this.s.doc.name)}:${d.line}</span></button>`).join('') || '<div class="dock-empty">No diagnostics from the supported validation rules.</div>'}</div>`;
    $$('[data-dock-issue]', host).forEach(
      (b) =>
        (b.onclick = () => {
          const issue = issues[Number(b.dataset.dockIssue)];
          if (find(this.s.doc.root, issue.id)) this.s.store.select([issue.id]);
          this.control.show('xaml');
        }),
    );
  }
  installCommands() {
    const s = this.s,
      command = s.command.bind(s);
    s.command = (action, e) => {
      try {
        if (action === 'window-layouts' || action === 'window-menu') return this.layouts();
        if (action === 'window-navigator') return this.navigator();
        if (action === 'layout-reset') return this.preset('designer');
        if (action === 'layout-undo') return this.model.undo();
        if (action === 'layout-redo') return this.model.redo();
        if (action === 'toggle-layers') return this.toggle('layers');
        if (action === 'toggle-inspector') return this.toggle('properties');
        if (action === 'toggle-code') return this.toggle('xaml');
        if (action === 'focus-mode') {
          const p = locatePanel(this.model.state, this.model.state.activePanel);
          if (p?.group) this.model.zoomGroup(p.group.id);
          return;
        }
        if (action === 'problems') {
          this.refreshProblems();
          return this.control.show('problems');
        }
        if (action === 'find-code' || action === 'format' || action === 'apply-code')
          this.control.show('xaml');
        if (action === 'add') this.control.show('toolkit');
        if (action === 'raw-properties') this.control.show('raw');
        if (action === 'tree-search') this.control.show('layers');
        return command(action, e);
      } catch (error) {
        notify(error.message);
      }
    };
    this.shortcuts = (e) => {
      if (e.target.closest('#modal-root')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.navigator();
      } else if (e.shiftKey && e.altKey && e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        s.command('focus-mode');
      }
    };
    document.addEventListener('keydown', this.shortcuts, true);
  }
  toggle(id) {
    return !this.control.visible.has(id) ? this.control.show(id) : this.control.hide(id);
  }
  preset(name) {
    const previousVisible = new Set(this.control.visible);
    this.refreshing = true;
    try {
      this.model.load(
        createDockLayout([...this.model.panels.keys()], {
          documents: this.s.stores.map((st) => docId(st.document)),
          preset: name,
        }),
      );
    } finally {
      this.refreshing = false;
    }
    this.syncCanvas();
    this.control.render();
    for (const id of previousVisible) if (!this.control.visible.has(id)) this.visibility(id, false);
    for (const id of this.control.visible) this.visibility(id, true);
    this.control.activate(docId(this.s.doc));
    this.layoutChanged('Apply preset');
    notify(
      'Applied ' +
        ({ designer: 'Designer', coding: 'Coding', animation: 'Animation', compact: 'Compact' }[
          name
        ] || name) +
        ' window layout',
    );
  }
  installWindowMenu() {
    const b = document.createElement('button');
    b.className = 'button dock-window-menu';
    b.dataset.action = 'window-menu';
    b.textContent = 'Window ▾';
    b.title = 'Windows and saved layouts';
    $('.topbar').insertBefore(b, $('.topbar .top-command'));
  }
  navigator() {
    const s = this.s;
    s.modal(
      'Window navigator',
      `<input id="dock-window-search" placeholder="Find a document or tool window…" aria-label="Find a window"><div id="dock-window-list" class="dock-window-list"></div>`,
      [],
      true,
    );
    const render = () => {
      const query = $('#dock-window-search').value.toLowerCase();
      $('#dock-window-list').innerHTML = [...this.model.panels.values()]
        .filter((p) => p.title.toLowerCase().includes(query))
        .map((p) => {
          const place = locatePanel(this.model.state, p.id),
            state =
              place?.kind === 'hidden'
                ? 'Closed'
                : place?.kind === 'autoHide'
                  ? 'Auto-hide'
                  : place?.floating
                    ? 'Floating'
                    : 'Docked';
          return `<button data-show-dock="${p.id}"><span>${esc(p.icon || '▤')}</span><strong>${esc(p.title)}</strong><small>${state}</small></button>`;
        })
        .join('');
      $$('[data-show-dock]').forEach(
        (b) =>
          (b.onclick = () => {
            s.closeModal();
            this.control.show(b.dataset.showDock);
          }),
      );
    };
    $('#dock-window-search').oninput = render;
    $('#dock-window-search').onkeydown = (e) => {
      if (e.key === 'Enter') $('[data-show-dock]')?.click();
    };
    render();
  }
  layouts() {
    const s = this.s;
    s.modal(
      'Windows and layouts',
      `<div class="dock-layout-actions"><button class="button" id="dock-open-navigator">All windows…</button><button class="button" id="dock-layout-undo" ${this.model.history.length ? '' : 'disabled'}>Undo layout</button><button class="button" id="dock-layout-redo" ${this.model.future.length ? '' : 'disabled'}>Redo layout</button></div><h3>Workspace presets</h3><div class="dock-presets">${[
        ['designer', 'Designer', 'Canvas, XAML, tools and properties'],
        ['coding', 'Coding', 'Source and designer side by side'],
        ['animation', 'Animation', 'Canvas with Objects & Timeline'],
        ['compact', 'Compact', 'Auto-hidden tools for smaller screens'],
      ]
        .map(
          ([id, title, description]) =>
            `<button data-dock-preset="${id}"><strong>${title}</strong><span>${description}</span></button>`,
        )
        .join(
          '',
        )}</div><h3>Saved layouts</h3><div class="dock-save-layout"><input id="dock-layout-name" placeholder="Layout name" maxlength="80"><button class="button primary" id="dock-save-layout">Save current</button></div><div class="dock-saved-layouts">${
        Object.keys(this.named)
          .map(
            (name) =>
              `<div><button data-load-layout="${esc(name)}">${esc(name)}</button><button data-delete-layout="${esc(name)}" aria-label="Delete ${esc(name)}">×</button></div>`,
          )
          .join('') || '<p>No named layouts saved yet.</p>'
      }</div><div class="dock-layout-actions"><button class="button" id="dock-export-layout">Export layout JSON</button><button class="button" id="dock-import-layout">Import layout JSON</button><button class="button" id="dock-reset-layout">Reset window layout</button></div><p class="feature-help">Drag a tab to move one window, or a title bar to move its group. Hold Ctrl/⌘ while dragging to float. Use the pin button for auto-hide. Right-click a tab for docking actions. F6 cycles visible windows; Ctrl/⌘+Q opens the navigator.</p>`,
      [],
      true,
    );
    $('#dock-open-navigator').onclick = () => this.navigator();
    $('#dock-layout-undo').onclick = () => {
      this.model.undo();
      this.layouts();
    };
    $('#dock-layout-redo').onclick = () => {
      this.model.redo();
      this.layouts();
    };
    $$('[data-dock-preset]').forEach(
      (b) =>
        (b.onclick = () => {
          s.closeModal();
          this.preset(b.dataset.dockPreset);
        }),
    );
    $('#dock-save-layout').onclick = () => {
      const name = $('#dock-layout-name').value.trim();
      if (!name || ['__proto__', 'constructor', 'prototype'].includes(name)) {
        notify('Enter a layout name.');
        return;
      }
      this.named[name] = clone(this.model.state);
      this.saveNamed();
      this.layouts();
    };
    $$('[data-load-layout]').forEach(
      (b) =>
        (b.onclick = () => {
          this.model.load(this.named[b.dataset.loadLayout], { reconcile: true });
          s.closeModal();
        }),
    );
    $$('[data-delete-layout]').forEach(
      (b) =>
        (b.onclick = () => {
          delete this.named[b.dataset.deleteLayout];
          this.saveNamed();
          this.layouts();
        }),
    );
    $('#dock-reset-layout').onclick = () => {
      s.closeModal();
      this.preset('designer');
    };
    $('#dock-export-layout').onclick = () => {
      const url = URL.createObjectURL(
          new Blob([this.model.serialize()], { type: 'application/json' }),
        ),
        a = document.createElement('a');
      a.href = url;
      a.download = 'Xamora-window-layout.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    $('#dock-import-layout').onclick = () =>
      s.chooseFile('.json', async (file) => {
        if (file.size > 1000000) throw Error('Layout files must be smaller than 1 MB.');
        this.model.load(await file.text(), { reconcile: true });
        s.closeModal();
      });
  }
  saveNamed() {
    try {
      localStorage.setItem(SAVED, JSON.stringify(this.named));
    } catch {
      notify('Named layouts could not be saved on this device.');
    }
  }
  registerPanel({ id, title, content, kind = 'tool', icon = '▤', onClose }) {
    if (!(content instanceof HTMLElement))
      throw Error('Provide a live HTMLElement for panel content.');
    this.model.register({ id, title, kind, icon, onClose });
    this.control.mount(id, content);
    this.control.show(id);
    return {
      show: () => this.control.show(id),
      close: () => this.control.hide(id),
      dispose: () => {
        this.control.contents.delete(id);
        content.remove();
        this.model.unregister(id);
      },
    };
  }
}
