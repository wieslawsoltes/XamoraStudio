import { modal, closeModal } from './dialog-host.js';
import {
  chooseFile,
  importFile,
  importText,
  workspaceData,
  svgSnapshot,
  save,
} from './workspace-files.js';
import {
  newDocumentDialog,
  renameDocumentDialog,
  exportDialog,
  resetDemoDialog,
  installToolkitDialog,
  projectMenu,
  commandPalette,
  problemsDialog,
  symbolsDialog,
  historyDialog,
  helpDialog,
} from './workspace-dialogs.js';
import { DocumentSession } from '../core/document-session.js';
import {
  DocumentStore,
  element,
  find,
  parentOf,
  walk,
  clone,
  uid,
  localName,
  label,
  visualChildren,
  isElement,
  isProperty,
  reidentify,
  validateDocument,
  createDocument,
  descendants,
} from '../core/model.js';
import { parseXaml, serializeXaml, serializeNode, diagnostics, newRoot } from '../core/xaml.js';
import { builtins, propertyGroups } from '../core/registry.js';
import { PreviewRenderer, gridDefinitions, color, thickness } from '../core/render.js';
import { GridSurface } from '../core/gpu.js';
import { XamlEditor } from '../core/editor.js';
import { samples } from '../core/samples.js';
import {
  reconcileIdentities,
  contentChildren,
  contentHost,
  isLocked,
} from '../core/design-tools.js';
import { $, $$, esc, toast, download } from './ui.js';
import { icon, button } from './icons.js';

const nval = (v, f = 0) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : f);

export class Studio {
  constructor() {
    this.registry = builtins();
    this.stores = [];
    this.active = 0;
    this.leftTab = 'layers';
    this.rightTab = 'design';
    this.zoom = 0.65;
    this.pan = { x: 50, y: 50 };
    this.tool = 'select';
    this.view = 'split';
    this.collapsed = new Set();
    this.scopeId = null;
    this.clipboard = [];
    this.snap = true;
    this.showNotes = true;
    this.readOnly = false;
    this.toolkitSearch = '';
    this.layerSearch = '';
    this.drag = null;
    this.dark = localStorage.getItem('xamora-theme') === 'dark';
    document.body.classList.toggle('dark', this.dark);
    let docs;
    try {
      const saved = JSON.parse(localStorage.getItem('xamora-workspace-v1'));
      if (saved?.documents?.length) {
        docs = saved.documents.map(validateDocument);
        this.active = Math.min(saved.active || 0, docs.length - 1);
        (saved.toolkits || []).forEach((m) => this.registry.install(m));
      }
    } catch (error) {
      console.warn('Workspace recovery failed', error.message);
    }
    (docs || samples()).forEach((d) => this.addStore(d));
    this.build();
    this.renderer = new PreviewRenderer(this.registry);
    this.gpu = new GridSurface($('#gpu-grid'));
    this.gpu.init().then(() => {
      this.drawGrid();
      this.renderStatus();
    });
    this.editor = new XamlEditor($('#code-editor'), {
      registry: this.registry,
      onApply: (text) => this.applyCode(text),
    });
    this.bind();
    this.render();
    const preferred = [];
    walk(this.doc.root, (node) => {
      if (node.props?.['x:Name'] === 'ProjectsCard') preferred.push(node.id);
    });
    if (preferred.length) this.store.select(preferred);
    requestAnimationFrame(() => this.fit());
    this.resizeObserver = new ResizeObserver(() => {
      this.drawGrid();
      this.drawSelection();
    });
    this.resizeObserver.observe($('#canvas-viewport'));
    this.registerAgentTools();
    window.xamora = {
      studio: this,
      registry: this.registry,
      getDocument: () => clone(this.doc),
      getSelection: () => [...this.store.selection],
      exportXaml: () => this.store.session?.source ?? serializeXaml(this.doc),
      importXaml: (text) => this.importText(text),
      registerControl: (d) => {
        this.registry.registerControl(d);
        this.render();
      },
      registerAdapter: (name, adapter) => this.registry.registerAdapter(name, adapter),
      subscribe: (listener) => {
        this.store.addEventListener('change', listener);
        return () => this.store.removeEventListener('change', listener);
      },
    };
  }
  leftHost(tab = this.leftTab) {
    return (
      document.querySelector(`[data-left-host="${tab}"]`) || document.querySelector('#left-content')
    );
  }
  inspectorHost(tab = this.rightTab) {
    return (
      document.querySelector(`[data-inspector-host="${tab}"]`) ||
      document.querySelector('#inspector')
    );
  }
  get store() {
    return this.stores[this.active];
  }
  get doc() {
    return this.store.document;
  }
  get selected() {
    return this.store.selection.map((id) => find(this.doc.root, id)).filter(Boolean);
  }
  get scope() {
    return this.scopeId ? find(this.doc.root, this.scopeId) : null;
  }
  addStore(doc) {
    if (this.stores.some((s) => s.document.id === doc.id)) {
      doc = clone(doc);
      const oldId = doc.id;
      doc.id = uid();
      for (const c of doc.metadata?.interactions || [])
        for (const a of c.actions || []) if (a.targetViewId === oldId) a.targetViewId = doc.id;
    }
    const store = new DocumentStore(doc);
    store.session = new DocumentSession(store);
    store.addEventListener('change', () => {
      if (store === this.store) this.render();
      this.save();
    });
    store.addEventListener('selection', () => {
      if (store === this.store) {
        this.renderTree();
        this.renderInspector();
        this.drawSelection();
        this.renderStatus();
        if (this.sync) this.sync.revealSelection();
        else {
          const name = this.selected[0]?.props?.['x:Name'];
          if (name) this.editor?.revealName(name);
        }
      }
    });
    this.stores.push(store);
    return store;
  }
  build() {
    $('#app').innerHTML = `<main class="studio" id="studio">
    <header class="topbar"><div class="brand"><div class="brand-mark">✕</div>Xamora<span style="font-weight:400;color:#92919e;font-size:12px;letter-spacing:0">Studio</span></div><div class="divider"></div>${button('menu', 'Project menu', 'down')}<span class="file-folder">My workspace</span><span class="muted">/</span><span class="file-title">Lumio · Workspace dashboard</span><span class="save-state" id="save-state">Saved on this device</span><div class="spacer"></div>${button('commands', 'Command palette (Ctrl+K)', 'search', 'icon-button top-command')}${button('history', 'Version history', 'history', 'icon-button history-button')}<span class="avatar" title="Local workspace">WS</span><button class="button" data-action="preview">${icon('play')}Preview</button><button class="button primary" data-action="export">Export${icon('export')}</button></header>
    <nav class="toolbar" aria-label="Design tools">${button('toggle-layers', 'Toggle layers panel', 'layers', 'icon-button mobile-panel-toggle')}<button class="tool active" data-tool="select" title="Move / select (V)" aria-label="Move / select">${icon('pointer')}</button><button class="tool" data-tool="hand" title="Pan (H or hold Space)" aria-label="Pan">${icon('hand')}</button><div class="divider"></div><button class="tool" data-tool="frame" title="Draw a Canvas (F)" aria-label="Draw a Canvas">${icon('frame')}</button><button class="tool" data-tool="rectangle" title="Draw rectangle (R)" aria-label="Draw rectangle">${icon('square')}</button><button class="tool" data-tool="text" title="Insert text (T)" aria-label="Insert text">${icon('text')}</button><button class="tool secondary-tool" data-action="insert-image" title="Insert image" aria-label="Insert image">${icon('image')}</button><div class="divider"></div><button class="tool" data-tool="comment" title="Add annotation (C)" aria-label="Add annotation">${icon('comment')}</button><div class="divider"></div>${button('undo', 'Undo (Ctrl+Z)', 'undo', 'icon-button secondary-tool')}${button('redo', 'Redo (Ctrl+Shift+Z)', 'redo', 'icon-button secondary-tool')}<div class="spacer"></div><div class="view-toggle"><button data-view="design">Design</button><button data-view="split" class="active">Split</button><button data-view="code">Code</button><button data-view="views">Views</button></div><div class="spacer"></div><select class="framework-select" id="framework-select" aria-label="XAML framework"><option>WPF</option><option>Avalonia</option><option>WinUI</option><option>MAUI</option></select><div class="divider"></div>${button('theme', 'Toggle theme', 'moon')}${button('toggle-inspector', 'Toggle property inspector', 'settings', 'icon-button mobile-panel-toggle')}</nav>
    <div class="workspace"><aside class="left-panel"><div class="panel-tabs"><button class="active" data-left="layers">Layers</button><button data-left="toolkit">Toolkit</button><button data-left="assets">Assets</button><button data-left="data">Data</button><div class="spacer"></div>${button('add', 'Insert control', 'plus')}</div><div id="left-content" class="panel-content"></div><div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted)">${icon('bolt')}Universal design model<span class="spacer"></span>${button('help', 'Help and shortcuts', 'help')}</div></aside>
    <section class="center"><div class="canvas-header">${icon('file')}<span id="canvas-file">MainView.xaml</span>${icon('chevron')}<span id="canvas-breadcrumb">UserControl</span><span class="spacer"></span><span id="artboard-dimensions">1100 × 760</span></div><div class="scope-banner" id="scope-banner" hidden></div><div class="canvas-viewport" id="canvas-viewport"><canvas class="gpu-grid" id="gpu-grid" aria-hidden="true"></canvas><div class="world" id="world"><div class="artboard-caption"><span id="artboard-name">MainView</span><span id="artboard-framework">WPF · Desktop</span></div><div class="artboard editing" id="artboard" aria-label="Visual design canvas"></div></div><div class="selection-overlay" id="selection-overlay"></div><div class="canvas-hint">${icon('hand')}Hold <kbd>Space</kbd> to pan<span style="margin:0 4px">·</span><kbd>⌘</kbd> + scroll to zoom</div><div class="canvas-tools">${button('fit', 'Fit artboard (Shift+1)', 'fit')}<button data-action="zoom-out" aria-label="Zoom out">−</button><button data-action="zoom-reset" id="zoom-label" title="Reset zoom to 100%">65%</button><button data-action="zoom-in" aria-label="Zoom in">+</button></div></div><section class="code-panel" id="code-panel"><div class="code-resize" id="code-resize"></div><div class="code-header"><span class="file-tab">${icon('code')}<span id="code-file">MainView.xaml</span></span><span class="muted" id="source-language">XAML</span><span class="spacer"></span><button class="button quiet format-button" data-action="format">Format</button><button class="button quiet" data-action="apply-code" title="Synchronize source now (Ctrl+Enter)">${icon('check')}Sync</button>${button('symbols', 'Document symbols', 'list')}${button('find-code', 'Find and replace (Ctrl+F)', 'search')}${button('toggle-code', 'Collapse code editor', 'down')}</div><div class="code-editor" id="code-editor"></div></section></section>
    <aside class="right-panel"><div class="panel-tabs"><button class="active" data-right="design">Design</button><button data-right="raw">Raw</button><button data-right="flow">Flow</button><button data-right="inspect">Inspect</button><button data-right="notes">Notes <span id="notes-count" class="tiny">1</span></button></div><div id="inspector"></div></aside></div>
    <footer class="statusbar"><span class="status-dot"></span><span id="status-selection">Ready</span><span style="opacity:.35">|</span><button data-action="problems" id="problems-button">${icon('check')}No errors</button><div class="status-right"><button data-action="snap" id="snap-state">Snap: 8 px</button><span id="renderer-status">CSS canvas · DOM controls</span><span class="status-accent">${icon('binding')} XAML ↔ Design</span><button data-action="help">${icon('help')}Help</button></div></footer></main>`;
  }
  bind() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) $('.context-menu')?.remove();
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action) this.command(action, e);
      const tool = e.target.closest('[data-tool]')?.dataset.tool;
      if (tool) this.setTool(tool);
      const view = e.target.closest('[data-view]')?.dataset.view;
      if (view) this.setView(view);
      const left = e.target.closest('[data-left]')?.dataset.left;
      if (left) {
        this.leftTab = left;
        this.renderLeft();
      }
      const right = e.target.closest('[data-right]')?.dataset.right;
      if (right) {
        this.rightTab = right;
        this.renderInspector();
      }
      const page = e.target.closest('[data-page]')?.dataset.page;
      if (page !== undefined) this.switchDocument(Number(page));
      const insert = e.target.closest('[data-insert]')?.dataset.insert;
      if (insert) this.insertControl(insert);
    });
    $('#framework-select').addEventListener('change', (e) => this.changeFramework(e.target.value));
    $('.workspace').addEventListener('input', (e) => {
      if (e.target.id === 'toolkit-search') {
        this.toolkitSearch = e.target.value;
        this.renderToolkitResults();
      }
      if (e.target.id === 'layer-search') {
        this.layerSearch = e.target.value;
        this.renderTree();
      }
    });
    $('.workspace').addEventListener('click', (e) => {
      const row = e.target.closest('[data-node]');
      if (!row) return;
      const id = row.dataset.node;
      if (e.target.closest('[data-collapse]')) {
        this.collapsed.has(id) ? this.collapsed.delete(id) : this.collapsed.add(id);
        this.renderTree();
        return;
      }
      if (e.target.closest('[data-hide]')) {
        const n = find(this.doc.root, id);
        this.setProps(
          [id],
          this.doc.framework === 'Avalonia' ? 'IsVisible' : 'Visibility',
          this.doc.framework === 'Avalonia'
            ? n.props.IsVisible === 'False'
              ? 'True'
              : 'False'
            : n.props.Visibility === 'Collapsed'
              ? 'Visible'
              : 'Collapsed',
        );
        return;
      }
      this.store.select(e.shiftKey ? [...this.store.selection, id] : [id]);
    });
    $('.workspace').addEventListener('dblclick', (e) => {
      const id = e.target.closest('[data-node]')?.dataset.node;
      if (id) {
        this.store.select([id]);
        $('#inspector-name')?.focus();
        $('#inspector-name')?.select();
      }
    });
    $('.workspace').addEventListener('dragstart', (e) => {
      const ctl = e.target.closest('[data-insert]'),
        row = e.target.closest('[data-node]');
      if (ctl) e.dataTransfer.setData('application/x-xamora-control', ctl.dataset.insert);
      else if (row) {
        if (!this.store.selection.includes(row.dataset.node)) this.store.select([row.dataset.node]);
        e.dataTransfer.setData('application/x-xamora-nodes', JSON.stringify(this.store.selection));
      }
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    $('.workspace').addEventListener('dragover', (e) => {
      const row = e.target.closest('[data-node]');
      if (row) {
        e.preventDefault();
        $$('.drop-target').forEach((n) => n.classList.remove('drop-target'));
        row.classList.add('drop-target');
      }
    });
    $('.workspace').addEventListener('dragleave', (e) =>
      e.target.closest('.drop-target')?.classList.remove('drop-target'),
    );
    $('.workspace').addEventListener('drop', (e) => {
      e.preventDefault();
      const row = e.target.closest('[data-node]');
      $$('.drop-target').forEach((n) => n.classList.remove('drop-target'));
      if (row) this.drop(e, find(this.doc.root, row.dataset.node));
    });
    $('.workspace').addEventListener('change', (e) => {
      if (e.target.matches('[data-prop],#inspector-name')) this.propertyChanged(e);
    });
    $('.workspace').addEventListener('click', (e) => {
      const reset = e.target.closest('[data-reset]');
      if (reset) this.setProps(this.store.selection, reset.dataset.reset, null);
      const mode = e.target.closest('[data-layout]')?.dataset.layout;
      if (mode) this.convertLayout(mode);
      const align = e.target.closest('[data-align]')?.dataset.align;
      if (align) this.align(align);
      const binding = e.target.closest('[data-bind]')?.dataset.bind;
      if (binding) this.bindingDialog(binding);
      const note = e.target.closest('[data-note-action]');
      if (note) this.noteAction(note.dataset.noteAction, note.dataset.id);
    });
    const vp = $('#canvas-viewport');
    vp.addEventListener('pointerdown', (e) => this.pointerDown(e));
    vp.addEventListener('pointermove', (e) => this.pointerMove(e));
    vp.addEventListener('pointerup', (e) => this.pointerUp(e));
    vp.addEventListener('pointercancel', (e) => this.pointerUp(e, true));
    vp.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          const rect = vp.getBoundingClientRect();
          this.setZoom(
            this.zoom * Math.exp(-e.deltaY * 0.004),
            e.clientX - rect.left,
            e.clientY - rect.top,
          );
        } else {
          this.pan.x -= e.deltaX;
          this.pan.y -= e.deltaY;
          this.transform();
        }
      },
      { passive: false },
    );
    vp.addEventListener('dragover', (e) => e.preventDefault());
    vp.addEventListener('drop', (e) => {
      e.preventDefault();
      const hit = e.target.closest('[data-node-id]');
      this.drop(e, hit ? find(this.doc.root, hit.dataset.nodeId) : null, true);
    });
    vp.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const selectedHit = this.features?.canvas.hit.stack(e.clientX, e.clientY, {
        includeLocked: true,
      })[0];
      const hit = this.features
        ? selectedHit
          ? { dataset: { nodeId: selectedHit.id } }
          : null
        : e.target.closest('[data-node-id]');
      if (hit && !this.store.selection.includes(hit.dataset.nodeId))
        this.store.select([hit.dataset.nodeId]);
      this.contextMenu(e.clientX, e.clientY);
    });
    vp.addEventListener('dblclick', (e) => {
      const selectedHit = this.features?.canvas.hit.stack(e.clientX, e.clientY)[0];
      const hit = this.features
        ? selectedHit
          ? { dataset: { nodeId: selectedHit.id } }
          : null
        : e.target.closest('[data-node-id]');
      if (!hit) return;
      const node = find(this.doc.root, hit.dataset.nodeId);
      if (['TextBlock', 'Label', 'Button'].includes(localName(node.type))) this.editText(node);
    });
    document.addEventListener('keydown', (e) => this.keydown(e));
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceHeld = false;
        $('#canvas-viewport').style.cursor = this.tool === 'hand' ? 'grab' : '';
      }
    });
    window.addEventListener('blur', () => (this.spaceHeld = false));
    $('#code-resize').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const y = e.clientY,
        h = $('#code-panel').offsetHeight;
      const move = (ev) => {
        $('#code-panel').style.height =
          Math.max(105, Math.min($('.center').clientHeight - 120, h + y - ev.clientY)) + 'px';
        this.drawSelection();
      };
      const end = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', end);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', end);
    });
    window.addEventListener('beforeunload', (e) => {
      if (this.editor?.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    this.registry.addEventListener('change', () => {
      if (this.editor) this.renderLeft();
    });
  }
  render() {
    if (!this.doc) return;
    this.editor?.setLanguage(this.doc.framework === 'HTML' ? 'HTML' : 'XAML');
    $('#framework-select').value = this.doc.framework;
    $('#canvas-file').textContent = this.doc.name;
    $('#code-file').textContent = this.doc.name;
    const sourceLanguage = $('#source-language');
    if (sourceLanguage)
      sourceLanguage.textContent = this.doc.framework === 'HTML' ? 'HTML' : 'XAML';
    $('#canvas-breadcrumb').textContent = this.scope
      ? 'ControlTemplate'
      : localName(this.doc.root.type);
    $('#artboard-name').textContent = this.doc.name.replace(/\.(xaml|html?)$/i, '');
    $('#artboard-framework').textContent = this.doc.framework + ' · Desktop';
    this.renderLeft();
    this.renderInspector();
    this.renderCanvas();
    this.editor?.setValue(this.store.session?.source ?? serializeXaml(this.doc));
    this.renderStatus();
    $$('[data-action="undo"]').forEach((b) => (b.disabled = !this.store.history.length));
    $$('[data-action="redo"]').forEach((b) => (b.disabled = !this.store.future.length));
  }
  renderLeft() {
    $$('[data-left]').forEach((b) => b.classList.toggle('active', b.dataset.left === this.leftTab));
    const content = this.leftHost();
    if (this.leftTab === 'layers') {
      content.innerHTML = `<section class="panel-section"><div class="section-heading">Pages<div class="spacer"></div>${button('new-document', 'Add page', 'plus')}</div>${this.stores.map((s, i) => `<button class="page-row ${i === this.active ? 'active' : ''}" data-page="${i}">${icon(localName(s.document.root.type) === 'ResourceDictionary' ? 'diamond' : 'file')}<span>${esc(s.document.name.replace(/\.xaml$/i, ''))}</span>${i === this.active ? '<span class="page-dot"></span>' : ''}</button>`).join('')}</section><div class="tree-toolbar">Layers<span class="spacer"></span>${button('collapse-all', 'Collapse all layers', 'layers')}${button('tree-search', 'Search layers', 'search')}</div><div id="layer-search-wrap" ${this.layerSearch ? '' : 'hidden'} style="padding:0 12px"><label class="search-box">${icon('search')}<input id="layer-search" placeholder="Find a layer…" value="${esc(this.layerSearch)}"></label></div><div id="layer-tree" role="tree" aria-label="Document layers"></div>`;
      this.renderTree();
    } else if (this.leftTab === 'toolkit') {
      content.innerHTML = `<div class="panel-section"><label class="search-box" style="margin-bottom:9px">${icon('search')}<input id="toolkit-search" placeholder="Search controls…" value="${esc(this.toolkitSearch)}"></label><div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--muted)"><span>${this.registry.list().length} controls</span><button data-action="install-toolkit" style="color:var(--accent);font-size:11px">＋ Toolkit</button></div></div><div id="toolkit-results"></div>`;
      this.renderToolkitResults();
    } else this.renderAssets();
  }
  renderTree() {
    const host = $('#layer-tree');
    if (!host) return;
    let rows = '';
    const search = this.layerSearch.toLowerCase();
    const root = this.scope || this.doc.root;
    const matches = (n) =>
      label(n).toLowerCase().includes(search) ||
      n.type.toLowerCase().includes(search) ||
      n.children?.some((c) => isElement(c) && matches(c));
    const add = (n, depth) => {
      if (!isElement(n) || (search && !matches(n))) return;
      const children = n.children.filter(isElement),
        collapsed = this.collapsed.has(n.id) && !search;
      rows += `<div class="tree-row ${this.store.selection.includes(n.id) ? 'selected' : ''}" data-node="${n.id}" role="treeitem" aria-selected="${this.store.selection.includes(n.id)}" ${children.length ? `aria-expanded="${!collapsed}"` : ''} draggable="${n !== this.doc.root && !isLocked(this.doc, n.id)}" style="padding-left:${8 + depth * 13}px" title="${esc(n.type)}"><button class="disclosure" data-collapse="1" aria-label="${collapsed ? 'Expand' : 'Collapse'} ${esc(label(n))}">${children.length ? (collapsed ? '›' : '⌄') : ''}</button>${icon(this.registry.get(n.type)?.icon || (isProperty(n) ? 'settings' : ['ControlTemplate', 'Style', 'ResourceDictionary'].includes(localName(n.type)) ? 'diamond' : 'square'))}<span class="node-title">${esc(label(n))}${isLocked(this.doc, n.id) ? ' · 🔒' : ''}</span><button class="layer-eye" data-hide="1" title="Toggle visibility" aria-label="Toggle layer visibility">${icon('eye')}</button></div>`;
      if (!collapsed) children.forEach((c) => add(c, depth + 1));
    };
    add(root, 0);
    host.innerHTML = rows || '<div class="layer-empty">No matching layers</div>';
  }
  renderToolkitResults() {
    const host = $('#toolkit-results');
    if (!host) return;
    const groups = {};
    this.registry
      .list()
      .filter((c) =>
        (c.type + ' ' + c.category + ' ' + (c.toolkit || ''))
          .toLowerCase()
          .includes(this.toolkitSearch.toLowerCase()),
      )
      .forEach((c) => (groups[c.category] ??= []).push(c));
    host.innerHTML =
      Object.entries(groups)
        .map(
          ([name, cs]) =>
            `<section class="toolkit-group"><h4>${esc(name)}</h4><div class="toolkit-grid">${cs.map((c) => `<button class="control-card" draggable="true" data-insert="${esc(c.type)}" title="Add ${esc(c.type)}">${icon(c.icon || 'square')}${esc(c.type)}</button>`).join('')}</div></section>`,
        )
        .join('') || '<div class="layer-empty">No controls found</div>';
  }
  resources() {
    const list = [];
    walk(this.doc.root, (n) => {
      if (n.props?.['x:Key']) list.push(n);
    });
    return list;
  }
  renderAssets() {
    const resources = this.resources();
    this.leftHost().innerHTML = `<div class="panel-section"><div class="section-heading">Document assets<div class="spacer"></div>${button('add-resource', 'Add resource', 'plus')}</div><p style="font-size:11px;color:var(--muted);line-height:1.6;margin:0">Reusable brushes, styles, and templates.</p></div>${resources.map((n) => `<button class="resource-row" style="width:100%;text-align:left" data-resource-select="${n.id}"><span class="swatch" style="background:${esc(color(n.props.Color) || 'var(--accent-soft)')};display:grid;place-items:center">${n.props.Color ? '' : icon('diamond')}</span><span><div class="resource-name">${esc(n.props['x:Key'])}</div><div class="resource-value">${esc(n.props.Color || n.type)}</div></span></button>`).join('') || '<div class="layer-empty">Add your first resource.</div>'}<div class="panel-section"><button class="button" data-action="edit-resources">${icon('diamond')}Theme editor</button></div>`;
    $$('[data-resource-select]').forEach(
      (b) =>
        (b.onclick = () => {
          this.store.select([b.dataset.resourceSelect]);
          this.rightTab = 'design';
          this.renderInspector();
        }),
    );
  }
  renderCanvas() {
    const artboard = $('#artboard');
    const template =
      this.scope ||
      (['ControlTemplate', 'DataTemplate'].includes(localName(this.doc.root.type))
        ? this.doc.root
        : null);
    const width = template ? 420 : this.doc.design.width,
      height = template ? 180 : this.doc.design.height;
    this.artSize = { width, height };
    artboard.style.width = width + 'px';
    artboard.style.height = height + 'px';
    $('#artboard-dimensions').textContent = `${width} × ${height}`;
    const banner = $('#scope-banner');
    banner.hidden = !template;
    banner.innerHTML = template
      ? `${icon('diamond')}Editing template: ${esc(label(template))}<span class="spacer"></span>${this.scope ? '<button data-action="exit-template">Back to document</button>' : '<button data-action="template-data">Preview values</button>'}`
      : '';
    if (localName(this.doc.root.type) === 'ResourceDictionary') {
      this.renderResourceBoard(artboard);
    } else if (template) {
      artboard.style.background = '#f4f1fa';
      artboard.style.padding = '55px 45px';
      this.renderer.render(this.doc, artboard, { scope: visualChildren(template)[0] || template });
      const sample = this.doc.metadata?.templateSample || {
        Content: this.selected[0]?.props.Content || 'Button preview',
        Background: '#7953E8',
        Foreground: '#FFFFFF',
        BorderBrush: '#7953E8',
      };
      this.renderer.elements.clear();
      artboard.replaceChildren(
        this.renderer.node(visualChildren(template)[0] || template, null, sample),
      );
    } else {
      artboard.style.padding = '';
      artboard.style.background = 'white';
      this.renderer.sampleData = this.features?.context() || this.doc.metadata?.sampleData || {};
      this.renderer.render(this.doc, artboard);
    }
    this.transform();
    requestAnimationFrame(() => this.drawSelection());
  }
  renderResourceBoard(host) {
    this.renderer.elements.clear();
    host.innerHTML = `<div class="token-board">${this.resources()
      .filter((n) => n.props.Color)
      .map(
        (n) =>
          `<button class="token-card" data-node-id="${n.id}" style="text-align:left"><div class="token-swatch" style="background:${esc(color(n.props.Color))}"></div><h4>${esc(n.props['x:Key'])}</h4><span>${esc(n.props.Color)}</span></button>`,
      )
      .join('')}</div>`;
    $$('[data-node-id]', host).forEach((el) => this.renderer.elements.set(el.dataset.nodeId, el));
  }
  transform() {
    $('#world').style.transform = `translate(${this.pan.x}px,${this.pan.y}px) scale(${this.zoom})`;
    $('#zoom-label').textContent = Math.round(this.zoom * 100) + '%';
    this.drawGrid();
    this.drawSelection();
  }
  drawGrid() {
    this.gpu?.draw({ zoom: this.zoom, panX: this.pan.x, panY: this.pan.y, dark: this.dark });
  }
  fit() {
    const vp = $('#canvas-viewport');
    if (!vp.clientWidth || !this.artSize) return;
    this.zoom = Math.min(
      1,
      (vp.clientWidth - 90) / this.artSize.width,
      (vp.clientHeight - 85) / this.artSize.height,
    );
    this.zoom = Math.max(0.1, this.zoom);
    this.pan = {
      x: (vp.clientWidth - this.artSize.width * this.zoom) / 2,
      y: (vp.clientHeight - this.artSize.height * this.zoom) / 2 + 7,
    };
    this.transform();
  }
  setZoom(zoom, cx, cy) {
    const vp = $('#canvas-viewport');
    cx ??= vp.clientWidth / 2;
    cy ??= vp.clientHeight / 2;
    zoom = Math.max(0.1, Math.min(4, zoom));
    const ratio = zoom / this.zoom;
    this.pan = { x: cx - (cx - this.pan.x) * ratio, y: cy - (cy - this.pan.y) * ratio };
    this.zoom = zoom;
    this.transform();
  }
  rectFor(id) {
    const el = this.renderer.elements.get(id);
    if (!el || el.style.display === 'none') return null;
    const rect = el.getBoundingClientRect(),
      view = $('#canvas-viewport').getBoundingClientRect();
    return {
      x: rect.left - view.left,
      y: rect.top - view.top,
      width: rect.width,
      height: rect.height,
    };
  }
  drawSelection() {
    const overlay = $('#selection-overlay');
    if (!overlay || !this.renderer) return;
    let markup = '';
    for (const n of this.selected) {
      const r = this.rectFor(n.id);
      if (!r || (r.width === 0 && r.height === 0)) continue;
      markup += `<div class="selection-box" data-selection-id="${n.id}" style="left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px">${this.selected.length === 1 ? `<div class="selection-label">${esc(localName(n.type))}</div><div class="selection-size">${Math.round(r.width / this.zoom)} × ${Math.round(r.height / this.zoom)}</div>` : ''}${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<div class="handle" data-h="${h}" data-id="${n.id}" role="button" aria-label="Resize ${h}"></div>`).join('')}</div>`;
    }
    if (this.showNotes && !this.scope)
      markup += (this.doc.annotations || [])
        .filter((a) => !a.resolved)
        .map(
          (a, i) =>
            `<button class="annotation-pin" data-annotation="${a.id}" title="${esc(a.text)}" style="left:${this.pan.x + a.x * this.zoom}px;top:${this.pan.y + a.y * this.zoom}px">${i + 1}</button>`,
        )
        .join('');
    overlay.innerHTML = markup;
    $$('[data-annotation]').forEach(
      (b) =>
        (b.onclick = () => {
          this.rightTab = 'notes';
          this.renderInspector();
          this.editAnnotation(b.dataset.annotation);
        }),
    );
  }
  renderStatus() {
    if (!this.renderer) return;
    $('#status-selection').textContent = this.selected.length
      ? this.selected.length === 1
        ? `${label(this.selected[0])} · ${localName(this.selected[0].type)}`
        : `${this.selected.length} layers selected`
      : 'Select a layer to start designing';
    this.issues = diagnostics(this.doc, this.registry);
    const errors = this.issues.filter((d) => d.severity === 'error').length,
      warnings = this.issues.filter((d) => d.severity === 'warning').length;
    $('#problems-button').innerHTML =
      icon(errors ? 'code' : 'check') +
      (errors ? `${errors} errors` : warnings ? `${warnings} warnings` : 'No errors');
    $('#renderer-status').textContent = `${this.gpu?.mode || 'CSS'} canvas · DOM controls`;
    $('#notes-count').textContent = (this.doc.annotations || []).filter((a) => !a.resolved).length;
    $('#snap-state').textContent = this.snap ? 'Snap: 8 px' : 'Snap: off';
  }
  field(key, title, value, options, full = false) {
    if (!options) {
      const descriptor = this.registry.get(this.selected[0]?.type || '');
      const property = descriptor?.properties?.find((p) => typeof p === 'object' && p.name === key);
      if (property?.values) options = property.values;
    }
    return `<div class="prop-field ${full ? 'full' : ''}"><label title="${esc(key)}">${esc(title)}</label>${options ? `<select data-prop="${esc(key)}" aria-label="${esc(key)}"><option value="">Default</option>${options.map((o) => `<option value="${esc(o)}" ${String(value) === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : `<input data-prop="${esc(key)}" aria-label="${esc(key)}" value="${esc(value ?? '')}" placeholder="${['Width', 'Height'].includes(key) ? 'Auto' : '—'}">`}<button class="reset-prop" data-reset="${esc(key)}" title="Reset ${esc(key)}" aria-label="Reset ${esc(key)}">×</button></div>`;
  }
  renderInspector() {
    $$('[data-right]').forEach((b) =>
      b.classList.toggle('active', b.dataset.right === this.rightTab),
    );
    const host = this.inspectorHost();
    if (this.rightTab === 'notes') {
      this.renderNotes();
      return;
    }
    if (this.rightTab === 'inspect') {
      this.renderInspect();
      return;
    }
    const ns = this.selected,
      n = ns[0];
    if (!n) {
      host.innerHTML = `<div class="empty-inspector">${icon('pointer')}<p>Select any layer to edit its properties.</p></div><section class="panel-section"><div class="section-heading">Artboard</div><div class="property-grid">${this.field('$width', 'W', this.doc.design.width)}${this.field('$height', 'H', this.doc.design.height)}</div><div class="property-line"><span>Framework</span><span class="badge">${this.doc.framework}</span></div></section><section class="panel-section"><button class="button" data-action="add">${icon('plus')}Add a control</button></section>`;
      return;
    }
    const p = n.props,
      type = localName(n.type),
      descriptor = this.registry.get(n.type),
      isLayout = ['Grid', 'Canvas', 'StackPanel', 'DockPanel', 'WrapPanel', 'UniformGrid'].includes(
        type,
      ),
      parent = parentOf(this.doc.root, n.id);
    const name = p['x:Name'] || p.Name || p['x:Key'] || '';
    host.innerHTML = `<section class="panel-section"><div class="inspector-name">${icon(descriptor?.icon || 'diamond')}<input id="inspector-name" aria-label="Element name" value="${esc(ns.length > 1 ? ns.length + ' selected layers' : name)}" placeholder="${esc(type)}" ${ns.length > 1 ? 'disabled' : ''}></div><div class="inspector-type">${esc(n.type)}${ns.length > 1 ? ' · shared properties' : ''}</div></section><div class="align-tools">${['left', 'center', 'right', 'top', 'middle', 'bottom'].map((a) => `<button class="icon-button" data-align="${a}" title="Align ${a}" aria-label="Align ${a}">${icon(a)}</button>`).join('')}</div>
      <section class="panel-section"><div class="section-heading">Layout<span class="spacer"></span>${isLayout ? '<span class="badge">Auto layout</span>' : button('wrap-stack', 'Wrap in stack', 'plus')}</div>${
        isLayout
          ? `<div class="layout-modes" style="margin-bottom:13px">${[
              ['Grid', 'grid'],
              ['StackPanel', 'stack'],
              ['Canvas', 'frame'],
              ['DockPanel', 'dock'],
            ]
              .map(
                ([t, i]) =>
                  `<button data-layout="${t}" class="${t === type ? 'active' : ''}" title="Convert to ${t}">${icon(i)}</button>`,
              )
              .join('')}</div>`
          : ''
      }<div class="property-grid">${this.field('Canvas.Left', 'X', p['Canvas.Left'])}${this.field('Canvas.Top', 'Y', p['Canvas.Top'])}${this.field('Width', 'W', p.Width)}${this.field('Height', 'H', p.Height)}${this.field('HorizontalAlignment', '↔', p.HorizontalAlignment, ['Stretch', 'Left', 'Center', 'Right'])}${this.field('VerticalAlignment', '↕', p.VerticalAlignment, ['Stretch', 'Top', 'Center', 'Bottom'])}</div>${type === 'StackPanel' || type === 'WrapPanel' ? `<div class="property-line"><span>Direction</span><select data-prop="Orientation" aria-label="Orientation"><option ${p.Orientation !== 'Horizontal' ? 'selected' : ''}>Vertical</option><option ${p.Orientation === 'Horizontal' ? 'selected' : ''}>Horizontal</option></select></div>${this.doc.framework !== 'WPF' ? `<div class="property-grid" style="margin-top:9px">${this.field('Spacing', 'Gap', p.Spacing)}</div>` : ''}` : ''}${type === 'Grid' ? `<div style="margin-top:12px"><div class="prop-label">Rows</div><div class="property-grid">${this.field('$rows', '↕', gridDefinitions(n, 'Row').join(', '), null, true)}</div><div class="prop-label" style="margin-top:9px">Columns</div><div class="property-grid">${this.field('$columns', '↔', gridDefinitions(n, 'Column').join(', '), null, true)}</div><div style="font-size:10px;color:var(--muted);margin-top:7px">Separate with commas · Auto, pixels, or *</div></div>` : ''}${type === 'DockPanel' ? `<div class="property-line"><span>Last child fills</span><input data-prop="LastChildFill" type="checkbox" aria-label="Last child fills" ${p.LastChildFill !== 'False' ? 'checked' : ''}></div>` : ''}${parent && localName(parent.type) === 'Grid' ? `<div class="property-grid" style="margin-top:10px">${this.field('Grid.Row', 'Row', p['Grid.Row'] || '0')}${this.field('Grid.Column', 'Col', p['Grid.Column'] || '0')}${this.field('Grid.RowSpan', 'Rows', p['Grid.RowSpan'] || '1')}${this.field('Grid.ColumnSpan', 'Cols', p['Grid.ColumnSpan'] || '1')}</div>` : ''}${parent && localName(parent.type) === 'DockPanel' ? `<div class="property-grid" style="margin-top:10px">${this.field('DockPanel.Dock', 'Dock', p['DockPanel.Dock'] || 'Left', ['Left', 'Top', 'Right', 'Bottom'], true)}</div>` : ''}<div class="prop-label" style="margin-top:13px">Spacing</div><div class="property-grid">${this.field('Margin', 'M', p.Margin)}${this.field('Padding', 'P', p.Padding)}</div></section>
      <section class="panel-section"><div class="section-heading">Appearance<span class="spacer"></span>${button('edit-resources', 'Theme resources', 'diamond')}</div><div class="property-grid">${this.field('Opacity', '◒', p.Opacity ?? '1')}${this.field('CornerRadius', '⌜', p.CornerRadius || '0')}</div>${['Background', 'Foreground', ...(['Rectangle', 'Ellipse'].includes(type) ? ['Fill'] : [])].map((k) => this.colorField(k, p[k])).join('')}</section>
      <section class="panel-section"><div class="section-heading">Stroke</div>${this.colorField('BorderBrush', p.BorderBrush)}<div class="property-grid" style="margin-top:9px">${this.field('BorderThickness', 'Size', p.BorderThickness || '0')}${this.field('Visibility', 'Visible', p.Visibility, ['Visible', 'Hidden', 'Collapsed'])}</div></section>
      ${['TextBlock', 'TextBox', 'Label', 'Button', 'CheckBox', 'RadioButton', 'ContentPresenter'].includes(type) ? `<section class="panel-section"><div class="section-heading">Typography</div><div class="property-grid">${this.field(['TextBlock', 'TextBox'].includes(type) ? 'Text' : 'Content', 'Text', p.Text ?? p.Content, null, true)}${this.field('FontFamily', 'Aa', p.FontFamily, null, true)}${this.field('FontSize', 'Size', p.FontSize || '14')}${this.field('FontWeight', 'Weight', p.FontWeight, ['Normal', 'Medium', 'SemiBold', 'Bold'])}${this.field('TextAlignment', 'Align', p.TextAlignment, ['Left', 'Center', 'Right', 'Justify'])}${this.field('TextWrapping', 'Wrap', p.TextWrapping, ['NoWrap', 'Wrap'])}</div></section>` : ''}
      <section class="panel-section"><div class="section-heading">Data & interactions${button('binding', 'Add binding', 'binding')}</div><div class="property-grid">${this.field('DataContext', 'Data', p.DataContext, null, true)}${this.field('Command', 'Cmd', p.Command, null, true)}</div><div class="property-line"><span>Enabled</span><input type="checkbox" data-prop="IsEnabled" aria-label="IsEnabled" ${p.IsEnabled !== 'False' ? 'checked' : ''}></div></section>
      <details class="expanded-props"><summary>All properties & attached properties</summary><div style="padding:10px 13px"><label class="search-box">${icon('search')}<input id="property-search" placeholder="Filter properties…"></label><div class="property-grid" id="all-properties">${[
        ...new Set([
          ...Object.values(propertyGroups).flat(),
          ...Object.keys(p),
          ...(descriptor?.properties || []).map((p) => (typeof p === 'string' ? p : p.name)),
        ]),
      ]
        .filter((k) => k && !k.startsWith('xmlns'))
        .map((k) => this.field(k, k, p[k], null, true))
        .join(
          '',
        )}</div><button class="button" data-action="custom-property" style="margin-top:12px">${icon('plus')}Custom property</button></div></details><section class="panel-section"><button class="button" data-action="edit-template" style="width:100%">${icon('diamond')}Edit control template</button><button class="button quiet" data-action="extract-control" style="width:100%;margin-top:7px">Create user control</button></section>`;
    $('#property-search')?.addEventListener('input', (e) => {
      $$('#all-properties .prop-field').forEach(
        (f) =>
          (f.hidden = !f
            .querySelector('[data-prop]')
            .dataset.prop.toLowerCase()
            .includes(e.target.value.toLowerCase())),
      );
    });
  }
  colorField(key, value) {
    const c = color(value) || '#ffffff';
    return `<div class="color-field"><input type="color" data-prop="${key}" value="${/^#[\da-f]{6}$/i.test(c) ? c : '#ffffff'}" aria-label="${key} color"><input type="text" data-prop="${key}" value="${esc(value || '')}" placeholder="None" aria-label="${key}"><button class="resource-button" data-bind="${key}" title="Bind ${key} to a resource" aria-label="Bind ${key} to a resource">◇</button></div>`;
  }
  renderInspect() {
    const n = this.selected[0];
    this.inspectorHost().innerHTML = `<section class="panel-section"><div class="section-heading">Code inspector<span class="spacer"></span><span class="badge">${this.doc.framework}</span></div><p style="font-size:11px;color:var(--muted);line-height:1.7">${n ? 'Selected element and its authored properties.' : 'Select an element on the canvas.'}</p>${n ? `<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.7 ui-monospace,monospace;background:var(--input);padding:12px;border-radius:6px">${esc(serializeNode(n))}</pre><button class="button" data-action="copy-xaml">${icon('duplicate')}Copy XAML</button>` : ''}</section><section class="panel-section"><div class="section-heading">Preview details</div><div class="property-line"><span>Surface</span><span>${this.gpu?.mode || 'CSS'}</span></div><div class="property-line"><span>Control layout</span><span>Browser DOM / CSS</span></div><div class="property-line"><span>Document model</span><span>v1</span></div><p style="font-size:11px;line-height:1.7;color:var(--muted);margin-top:18px">Browser previews approximate framework layout. Native templates, converters, event handlers, and custom drawing need framework integration.</p><button class="button" data-action="problems">View diagnostics</button></section>`;
  }
  propertyChanged(e) {
    try {
      if (!this.prepareEdit()) return;
      if (e.target.id === 'inspector-name') {
        const n = this.selected[0];
        if (!n) return;
        const key = n.props['x:Key'] ? 'x:Key' : n.props.Name ? 'Name' : 'x:Name';
        if (key !== 'x:Key' && e.target.value && !/^[A-Za-z_][\w]*$/.test(e.target.value))
          throw Error('Use letters, digits, and underscores for element names.');
        this.store.setProperty([n.id], key, e.target.value || null);
        return;
      }
      const key = e.target.dataset.prop;
      if (!key) return;
      let value =
        e.target.type === 'checkbox' ? (e.target.checked ? 'True' : 'False') : e.target.value;
      if (key === '$width' || key === '$height') {
        const size = Number(value);
        if (!Number.isFinite(size) || size < 100 || size > 8000)
          throw Error('Artboard size must be between 100 and 8000.');
        this.store.transaction('Resize artboard', (d) => {
          d.design[key === '$width' ? 'width' : 'height'] = size;
          if (d.root.props[key === '$width' ? 'Width' : 'Height'])
            d.root.props[key === '$width' ? 'Width' : 'Height'] = String(size);
        });
        return;
      }
      if (key === '$rows' || key === '$columns') {
        this.editGrid(key === '$rows' ? 'Row' : 'Column', value);
        return;
      }
      if (
        [
          'Width',
          'Height',
          'MinWidth',
          'MinHeight',
          'MaxWidth',
          'MaxHeight',
          'FontSize',
          'Opacity',
          'Grid.Row',
          'Grid.Column',
          'Grid.RowSpan',
          'Grid.ColumnSpan',
        ].includes(key) &&
        value &&
        !value.startsWith('{') &&
        value !== 'Auto' &&
        (!Number.isFinite(Number(value)) || Number(value) < 0)
      )
        throw Error('Enter a nonnegative number, Auto, or a binding.');
      this.store.setProperty(this.store.selection, key, value);
    } catch (error) {
      toast(error.message);
      this.renderInspector();
    }
  }
  setProps(ids, key, value) {
    if (!this.prepareEdit()) return;
    try {
      this.store.setProperty(ids, key, value);
    } catch (e) {
      toast(e.message);
    }
  }
  prepareEdit() {
    if (this.sync) return this.sync.prepareEdit();
    if (this.editor?.dirty) {
      if (!this.editor.apply()) {
        toast('Fix the source error before editing the canvas.');
        return false;
      }
    }
    return true;
  }
  applyCode(text) {
    const parsed = parseXaml(text, { name: this.doc.name, framework: this.doc.framework });
    reconcileIdentities(this.doc.root, parsed.root);
    this.scopeId = null;
    this.store.transaction('Apply XAML', (d) => {
      d.root = parsed.root;
      d.preamble = parsed.preamble;
      d.postamble = parsed.postamble;
      d.design = parsed.design;
    });
    this.store.select([]);
    this.editor.dirty = false;
    this.editor.setValue(serializeXaml(this.doc), { force: true });
    toast('XAML applied to the canvas');
  }
  editGrid(axis, text) {
    const values = text.split(',').map((v) => v.trim());
    if (
      values.length > 50 ||
      !values.length ||
      values.some((v) => !/^(Auto|(?:\d*\.?\d+)?\*|\d+(?:\.\d+)?)$/i.test(v))
    )
      throw Error('Use comma-separated values such as Auto, 120, *.');
    this.store.transaction(`Edit grid ${axis.toLowerCase()}s`, () => {
      for (const n of this.selected) {
        const propName = `Grid.${axis}Definitions`;
        const existing = n.children.find((c) => c.type === propName),
          old = existing?.children.filter(isElement) || [];
        const definitions = values.map((v, i) => {
          const item = old[i] || element(`${axis}Definition`);
          item.props[axis === 'Row' ? 'Height' : 'Width'] = /^auto$/i.test(v) ? 'Auto' : v;
          return item;
        });
        if (
          old.length > values.length &&
          old.slice(values.length).some((n) => Object.keys(n.props).length > 1 || n.children.length)
        )
          throw Error(
            'Removed definitions contain metadata. Edit them in XAML to remove them explicitly.',
          );
        const comments = existing?.children.filter((c) => !isElement(c)) || [];
        if (existing) existing.children = [...comments, ...definitions];
        else n.children.unshift(element(propName, {}, definitions));
        delete n.props[`${axis}Definitions`];
      }
    });
  }
  parentForInsert(candidate) {
    const isolated = this.features?.isolationId
      ? find(this.doc.root, this.features.isolationId)
      : null;
    let n = candidate || this.selected[0] || this.scope || isolated || this.doc.root;
    if (isolated && !descendants(isolated).includes(n.id)) n = isolated;
    while (n) {
      const d = this.registry.get(n.type);
      if (d?.container || ['ControlTemplate', 'DataTemplate'].includes(localName(n.type))) {
        if (!d?.singleChild || !contentChildren(n).length) return n;
      }
      n = parentOf(this.doc.root, n.id);
    }
    const root = this.scope || this.doc.root;
    return (
      visualChildren(root).find(
        (n) => this.registry.get(n.type)?.container && !this.registry.get(n.type)?.singleChild,
      ) || root
    );
  }
  canContain(parent, nodes) {
    if (
      this.features?.isolationId &&
      !descendants(find(this.doc.root, this.features.isolationId)).includes(parent.id)
    )
      throw Error('Choose a destination inside the isolated container.');
    const d = this.registry.get(parent.type);
    if (!d?.container && !['ControlTemplate', 'DataTemplate'].includes(localName(parent.type)))
      throw Error('Choose a layout container in the layer tree.');
    if (isLocked(this.doc, parent.id)) throw Error('Destination is locked.');
    const existing = contentChildren(parent).filter((n) => !nodes.some((c) => c.id === n.id));
    if (
      (d?.singleChild || ['ControlTemplate', 'DataTemplate'].includes(localName(parent.type))) &&
      existing.length + nodes.length > 1
    )
      throw Error(
        `${parent.type} accepts one child. Wrap its content in a Grid or StackPanel first.`,
      );
  }
  insertControl(type, parent, point) {
    if (!this.prepareEdit()) return;
    try {
      const n = this.registry.create(type);
      parent = this.parentForInsert(parent);
      this.canContain(parent, [n]);
      if (localName(parent.type) === 'Canvas') {
        n.props['Canvas.Left'] = String(point ? this.snapValue(point.x) : 32);
        n.props['Canvas.Top'] = String(point ? this.snapValue(point.y) : 32);
      } else if (localName(parent.type) === 'Grid') {
        n.props['Grid.Row'] = '0';
        n.props['Grid.Column'] = '0';
        if (point) {
          const p = this.renderer.elements.get(parent.id)?.getBoundingClientRect();
          if (p) {
            n.props['Grid.Column'] = String(
              Math.min(
                gridDefinitions(parent, 'Column').length - 1,
                Math.floor(
                  (point.x / (p.width / this.zoom)) * gridDefinitions(parent, 'Column').length,
                ),
              ),
            );
            n.props['Grid.Row'] = String(
              Math.min(
                gridDefinitions(parent, 'Row').length - 1,
                Math.floor(
                  (point.y / (p.height / this.zoom)) * gridDefinitions(parent, 'Row').length,
                ),
              ),
            );
          }
        }
      }
      const d = this.registry.get(type);
      this.store.transaction(`Insert ${type}`, () => {
        if (d?.namespace) {
          const prefix = type.includes(':') ? type.split(':')[0] : null;
          if (prefix) this.doc.root.props['xmlns:' + prefix] = d.namespace;
        }
        contentHost(parent).children.push(n);
      });
      this.store.select([n.id]);
      toast(`${localName(type)} added to ${label(parent)}`);
    } catch (error) {
      toast(error.message);
    }
  }
  drop(e, target, onCanvas = false) {
    try {
      if (!this.prepareEdit()) return;
      const type = e.dataTransfer.getData('application/x-xamora-control');
      const ids = e.dataTransfer.getData('application/x-xamora-nodes');
      const parent = this.parentForInsert(target);
      let point;
      if (onCanvas) {
        const r = this.renderer.elements.get(parent.id)?.getBoundingClientRect();
        if (r) point = { x: (e.clientX - r.left) / this.zoom, y: (e.clientY - r.top) / this.zoom };
      }
      if (type) this.insertControl(type, parent, point);
      else if (ids) {
        const nodes = JSON.parse(ids)
          .map((id) => find(this.doc.root, id))
          .filter(Boolean);
        this.canContain(parent, nodes);
        this.store.move(
          nodes.map((n) => n.id),
          parent.id,
        );
        toast('Layers moved');
      } else if (e.dataTransfer.files.length) this.importFile(e.dataTransfer.files[0]);
    } catch (error) {
      toast(error.message);
    }
  }
  snapValue(v) {
    return this.snap ? Math.round(v / 8) * 8 : Math.round(v);
  }
  pointerDown(e) {
    if ((e.button !== 0 && e.button !== 1) || e.target.closest('.canvas-tools,.annotation-pin'))
      return;
    const vp = $('#canvas-viewport'),
      rect = vp.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    if (this.tool === 'hand' || this.spaceHeld || e.button === 1) {
      e.preventDefault();
      this.drag = { kind: 'pan', x: e.clientX, y: e.clientY, pan: { ...this.pan } };
      vp.setPointerCapture(e.pointerId);
      vp.style.cursor = 'grabbing';
      return;
    }
    const handle = e.target.closest('[data-h]');
    if (handle) {
      if (!this.prepareEdit()) return;
      const node = find(this.doc.root, handle.dataset.id),
        r = this.rectFor(node.id);
      this.drag = {
        kind: 'resize',
        nodeId: node.id,
        h: handle.dataset.h,
        x: e.clientX,
        y: e.clientY,
        rect: r,
        before: clone(this.doc),
        width: r.width / this.zoom,
        height: r.height / this.zoom,
        left: nval(node.props['Canvas.Left']),
        top: nval(node.props['Canvas.Top']),
      };
      vp.setPointerCapture(e.pointerId);
      return;
    }
    if (this.tool === 'comment') {
      this.newAnnotation((x - this.pan.x) / this.zoom, (y - this.pan.y) / this.zoom);
      return;
    }
    const hit = e.target.closest('[data-node-id]');
    if (['rectangle', 'frame', 'text'].includes(this.tool)) {
      if (!this.prepareEdit()) return;
      const parent = this.parentForInsert(hit ? find(this.doc.root, hit.dataset.nodeId) : null);
      const r = this.renderer.elements.get(parent.id)?.getBoundingClientRect();
      if (this.tool === 'text') {
        this.insertControl(
          'TextBlock',
          parent,
          r ? { x: (e.clientX - r.left) / this.zoom, y: (e.clientY - r.top) / this.zoom } : null,
        );
        this.setTool('select');
        return;
      }
      this.drag = {
        kind: 'draw',
        type: this.tool === 'frame' ? 'Canvas' : 'Rectangle',
        parentId: parent.id,
        x: e.clientX,
        y: e.clientY,
        start: { x, y },
        r,
      };
      vp.setPointerCapture(e.pointerId);
      return;
    }
    if (hit) {
      const id = hit.dataset.nodeId,
        node = find(this.doc.root, id);
      if (node?.props?.['xamora:Locked'] === 'True') return;
      if (e.shiftKey) {
        this.store.select(
          this.store.selection.includes(id)
            ? this.store.selection.filter((i) => i !== id)
            : [...this.store.selection, id],
        );
      } else if (!this.store.selection.includes(id)) this.store.select([id]);
      if (this.prepareEdit()) {
        const parent = parentOf(this.doc.root, id);
        if (parent) {
          const ids = this.store.selection.filter(
            (id) =>
              !this.store.selection.some(
                (other) =>
                  other !== id && descendants(find(this.doc.root, other) || {}).includes(id),
              ),
          );
          this.drag = {
            kind: 'move',
            ids,
            x: e.clientX,
            y: e.clientY,
            before: clone(this.doc),
            changed: false,
            parentId: parent.id,
          };
          vp.setPointerCapture(e.pointerId);
        }
      }
    } else {
      if (!e.shiftKey) this.store.select([]);
      this.drag = { kind: 'marquee', x, y, base: e.shiftKey ? [...this.store.selection] : [] };
      vp.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
  }
  pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const dx = (e.clientX - d.x) / this.zoom,
      dy = (e.clientY - d.y) / this.zoom;
    if (d.kind === 'pan') {
      this.pan = { x: d.pan.x + e.clientX - d.x, y: d.pan.y + e.clientY - d.y };
      this.transform();
      return;
    }
    if (d.kind === 'resize') {
      const n = find(this.doc.root, d.nodeId);
      const w = Math.max(
          8,
          this.snapValue(d.width + (d.h.includes('w') ? -dx : d.h.includes('e') ? dx : 0)),
        ),
        h = Math.max(
          8,
          this.snapValue(d.height + (d.h.includes('n') ? -dy : d.h.includes('s') ? dy : 0)),
        );
      if (d.h.includes('w') || d.h.includes('e')) n.props.Width = String(w);
      if (d.h.includes('n') || d.h.includes('s')) n.props.Height = String(h);
      const parent = parentOf(this.doc.root, n.id);
      if (localName(parent?.type || '') === 'Canvas') {
        if (d.h.includes('w'))
          n.props['Canvas.Left'] = String(this.snapValue(d.left + d.width - w));
        if (d.h.includes('n')) n.props['Canvas.Top'] = String(this.snapValue(d.top + d.height - h));
      }
      this.renderCanvas();
      return;
    }
    if (d.kind === 'move') {
      if (Math.abs(dx) + Math.abs(dy) < 4 && !d.changed) return;
      d.changed = true;
      for (const id of d.ids) {
        const node = find(this.doc.root, id),
          original = find(d.before.root, id),
          p = parentOf(this.doc.root, id);
        if (!node || !original || !p) continue;
        if (localName(p.type) === 'Canvas') {
          node.props['Canvas.Left'] = String(
            this.snapValue(nval(original.props['Canvas.Left']) + dx),
          );
          node.props['Canvas.Top'] = String(
            this.snapValue(nval(original.props['Canvas.Top']) + dy),
          );
          delete node.props['Canvas.Right'];
          delete node.props['Canvas.Bottom'];
        } else if (localName(p.type) === 'Grid') {
          const r = this.renderer.elements.get(p.id)?.getBoundingClientRect();
          if (r) {
            node.props['Grid.Column'] = String(
              Math.max(
                0,
                Math.min(
                  gridDefinitions(p, 'Column').length - 1,
                  Math.floor(
                    ((e.clientX - r.left) / r.width) * gridDefinitions(p, 'Column').length,
                  ),
                ),
              ),
            );
            node.props['Grid.Row'] = String(
              Math.max(
                0,
                Math.min(
                  gridDefinitions(p, 'Row').length - 1,
                  Math.floor(((e.clientY - r.top) / r.height) * gridDefinitions(p, 'Row').length),
                ),
              ),
            );
          }
        } else {
          const margins = thickness(original.props.Margin);
          margins[0] = this.snapValue(margins[0] + dy);
          margins[3] = this.snapValue(margins[3] + dx);
          node.props.Margin = [margins[3], margins[0], margins[1], margins[2]].join(',');
        }
      }
      this.renderCanvas();
      return;
    }
    if (d.kind === 'marquee' || d.kind === 'draw') {
      const r = $('#canvas-viewport').getBoundingClientRect(),
        ex = e.clientX - r.left,
        ey = e.clientY - r.top,
        start = d.kind === 'draw' ? d.start : { x: d.x, y: d.y };
      let mark = $('.marquee');
      if (!mark) {
        mark = document.createElement('div');
        mark.className = 'marquee';
        $('#canvas-viewport').append(mark);
      }
      d.box = {
        x: Math.min(start.x, ex),
        y: Math.min(start.y, ey),
        width: Math.abs(ex - start.x),
        height: Math.abs(ey - start.y),
      };
      Object.assign(mark.style, {
        left: d.box.x + 'px',
        top: d.box.y + 'px',
        width: d.box.width + 'px',
        height: d.box.height + 'px',
      });
    }
  }
  pointerUp(e, cancel = false) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    try {
      $('#canvas-viewport').releasePointerCapture(e.pointerId);
    } catch {}
    $('#canvas-viewport').style.cursor = this.tool === 'hand' ? 'grab' : '';
    $('.marquee')?.remove();
    if (cancel) {
      if (d.before) {
        this.store.document = d.before;
        this.render();
      }
      return;
    }
    if (d.kind === 'resize' || d.kind === 'move') {
      this.store.commitSnapshot(d.kind === 'resize' ? 'Resize layer' : 'Move layers', d.before);
      return;
    }
    if (d.kind === 'marquee' && d.box) {
      const box = d.box;
      const ids = [];
      for (const [id] of this.renderer.elements) {
        if (id === this.doc.root.id) continue;
        const r = this.rectFor(id);
        if (
          find(this.doc.root, id) &&
          !isLocked(this.doc, id) &&
          (!this.features?.isolationId ||
            descendants(find(this.doc.root, this.features.isolationId)).includes(id)) &&
          r &&
          r.x >= box.x &&
          r.y >= box.y &&
          r.x + r.width <= box.x + box.width &&
          r.y + r.height <= box.y + box.height
        )
          ids.push(id);
      }
      this.store.select([
        ...d.base,
        ...ids.filter(
          (id) =>
            !ids.some(
              (other) => other !== id && descendants(find(this.doc.root, other)).includes(id),
            ),
        ),
      ]);
    }
    if (d.kind === 'draw') {
      const box = d.box || {
        width: 120 * this.zoom,
        height: 80 * this.zoom,
        x: d.start.x,
        y: d.start.y,
      };
      try {
        const parent = find(this.doc.root, d.parentId),
          node = this.registry.create(d.type);
        this.canContain(parent, [node]);
        node.props.Width = String(Math.max(8, this.snapValue(box.width / this.zoom)));
        node.props.Height = String(Math.max(8, this.snapValue(box.height / this.zoom)));
        if (localName(parent.type) === 'Canvas') {
          const vr = $('#canvas-viewport').getBoundingClientRect();
          node.props['Canvas.Left'] = String(
            this.snapValue((box.x + vr.left - d.r.left) / this.zoom),
          );
          node.props['Canvas.Top'] = String(this.snapValue((box.y + vr.top - d.r.top) / this.zoom));
        }
        this.store.insert(contentHost(parent).id, node);
        this.setTool('select');
      } catch (error) {
        toast(error.message);
      }
    }
  }
  setTool(tool) {
    this.tool = tool;
    $$('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    $('#canvas-viewport').style.cursor =
      tool === 'hand'
        ? 'grab'
        : ['frame', 'rectangle', 'text', 'comment'].includes(tool)
          ? 'crosshair'
          : '';
  }
  setView(view) {
    this.view = view;
    $('#studio').classList.toggle('design-only', view === 'design');
    $('#studio').classList.toggle('code-only', view === 'code');
    $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    requestAnimationFrame(() => this.drawSelection());
  }
  switchDocument(index) {
    if (index === this.active || !this.stores[index]) return;
    if (this.sync?.beforeSwitch() === false) return;
    this.active = index;
    this.scopeId = null;
    this.editor.dirty = false;
    this.render();
    this.editor.setValue(this.store.session?.source ?? serializeXaml(this.doc), { force: true });
    this.sync?.afterSwitch();
    requestAnimationFrame(() => this.fit());
    this.save();
  }
  save() {
    return save(this);
  }
  changeFramework(name) {
    if (!this.prepareEdit()) return;
    this.modal(
      'Change framework',
      `<p>Convert the common properties to ${esc(name)}. Custom controls, bindings, assets, and framework-specific styles remain authored and may need changes for the target runtime.</p><p>Your current page will be kept. A converted page will open beside it.</p>`,
      [
        {
          label: 'Create converted page',
          primary: true,
          run: () => {
            const converted = parseXaml(serializeXaml(this.doc, { framework: name }), {
              name: this.doc.name.replace('.xaml', `.${name.toLowerCase()}.xaml`),
              framework: name,
            });
            converted.annotations = clone(this.doc.annotations);
            this.addStore(converted);
            this.switchDocument(this.stores.length - 1);
            this.closeModal();
            toast(`${name} copy created. Review diagnostics before native use.`);
          },
        },
      ],
    );
    $('#framework-select').value = this.doc.framework;
  }
  keydown(e) {
    const input = e.target.closest('input,textarea,select,[contenteditable]'),
      mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if ($('#modal-root').children.length) {
        this.closeModal();
        return;
      }
      $('.context-menu')?.remove();
      if (this.scopeId) {
        this.scopeId = null;
        this.render();
        this.fit();
      }
      this.setTool('select');
      return;
    }
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.commandPalette();
      return;
    }
    if (input) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.spaceHeld = true;
      $('#canvas-viewport').style.cursor = 'grab';
    }
    const k = e.key.toLowerCase();
    if (mod) {
      const actions = {
        z: e.shiftKey ? 'redo' : 'undo',
        y: 'redo',
        c: 'copy',
        v: 'paste',
        x: 'cut',
        d: 'duplicate',
        g: e.shiftKey ? 'ungroup' : 'group',
        s: 'save-project',
        a: 'select-all',
        f: 'find-code',
        o: 'import',
      };
      if (actions[k]) {
        e.preventDefault();
        this.command(actions[k]);
        return;
      }
    }
    if (e.shiftKey && e.key === '1') {
      e.preventDefault();
      this.fit();
      return;
    }
    if (e.shiftKey && e.key === '2') {
      this.focusSelection();
      return;
    }
    if (['Delete', 'Backspace'].includes(e.key)) {
      e.preventDefault();
      this.command('delete');
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      this.nudge(e.key, e.shiftKey ? 10 : 1);
      return;
    }
    const shortcuts = {
      v: 'select',
      h: 'hand',
      f: 'frame',
      r: 'rectangle',
      t: 'text',
      c: 'comment',
    };
    if (shortcuts[k]) this.setTool(shortcuts[k]);
    if (k === '+' || k === '=') this.setZoom(this.zoom * 1.15);
    if (k === '-') this.setZoom(this.zoom / 1.15);
  }
  command(action, e) {
    try {
      const editing = [
        'undo',
        'redo',
        'delete',
        'cut',
        'paste',
        'duplicate',
        'group',
        'ungroup',
        'wrap-stack',
        'move-up',
        'move-down',
        'front',
        'back',
        'edit-template',
        'extract-control',
        'add-resource',
        'custom-property',
        'binding',
      ];
      if (editing.includes(action) && !this.prepareEdit()) return;
      switch (action) {
        case 'undo':
          this.store.undo();
          break;
        case 'redo':
          this.store.redo();
          break;
        case 'delete':
          this.store.remove(this.store.selection);
          break;
        case 'copy':
          this.copy();
          break;
        case 'cut':
          this.copy();
          this.store.remove(this.store.selection);
          break;
        case 'paste':
          this.paste();
          break;
        case 'duplicate':
          this.copy(false);
          this.paste(true);
          break;
        case 'group':
          this.group('Grid');
          break;
        case 'wrap-stack':
          this.group('StackPanel');
          break;
        case 'ungroup':
          this.ungroup();
          break;
        case 'select-all':
          this.store.select(
            visualChildren(this.scope || visualChildren(this.doc.root)[0] || this.doc.root).map(
              (n) => n.id,
            ),
          );
          break;
        case 'new-document':
          this.newDocumentDialog();
          break;
        case 'import':
          this.chooseFile('.xaml,.xml,.html,.htm,.json,.xamora', (file) => this.importFile(file));
          break;
        case 'export':
          this.exportDialog();
          break;
        case 'save-project':
          this.sync?.flush();
          this.save();
          download(
            'workspace.xamora.json',
            JSON.stringify(this.workspaceData(), null, 2),
            'application/json',
          );
          toast('Project exported');
          break;
        case 'preview':
          this.preview();
          break;
        case 'commands':
          this.commandPalette();
          break;
        case 'menu':
          this.projectMenu();
          break;
        case 'add':
          this.leftTab = 'toolkit';
          this.renderLeft();
          $('#studio').classList.add('show-layers');
          $('#toolkit-search')?.focus();
          break;
        case 'theme':
          this.dark = !this.dark;
          document.body.classList.toggle('dark', this.dark);
          localStorage.setItem('xamora-theme', this.dark ? 'dark' : 'light');
          this.drawGrid();
          break;
        case 'fit':
          this.fit();
          break;
        case 'zoom-out':
          this.setZoom(this.zoom / 1.2);
          break;
        case 'zoom-in':
          this.setZoom(this.zoom * 1.2);
          break;
        case 'zoom-reset':
          this.setZoom(1);
          break;
        case 'toggle-code':
          this.setView(this.view === 'design' ? 'split' : 'design');
          break;
        case 'format':
          this.editor.format();
          break;
        case 'apply-code':
          this.editor.apply();
          break;
        case 'find-code':
          if (this.view === 'design') this.setView('split');
          this.editor.find();
          break;
        case 'toggle-layers':
          $('#studio').classList.toggle('show-layers');
          break;
        case 'toggle-inspector':
          $('#studio').classList.toggle('show-inspector');
          break;
        case 'focus-mode':
          $('#studio').classList.toggle('focus-mode');
          this.fit();
          break;
        case 'snap':
          this.snap = !this.snap;
          this.renderStatus();
          toast(this.snap ? 'Snap to 8 px grid enabled' : 'Grid snapping disabled');
          break;
        case 'collapse-all':
          if (this.collapsed.size) this.collapsed.clear();
          else
            walk(this.doc.root, (n) => {
              if (n.id !== this.doc.root.id) this.collapsed.add(n.id);
            });
          this.renderTree();
          break;
        case 'tree-search':
          $('#layer-search-wrap').hidden = !$('#layer-search-wrap').hidden;
          $('#layer-search').focus();
          break;
        case 'symbols':
          this.symbolsDialog();
          break;
        case 'problems':
          this.problemsDialog();
          break;
        case 'help':
          this.helpDialog();
          break;
        case 'history':
          this.historyDialog();
          break;
        case 'install-toolkit':
          this.installToolkitDialog();
          break;
        case 'edit-resources':
          this.resourcesDialog();
          break;
        case 'add-resource':
          this.addResourceDialog();
          break;
        case 'custom-property':
          this.customPropertyDialog();
          break;
        case 'binding':
          this.bindingDialog('Text');
          break;
        case 'copy-xaml':
          this.copyXaml();
          break;
        case 'edit-template':
          this.editTemplate();
          break;
        case 'exit-template':
          this.scopeId = null;
          this.render();
          this.fit();
          break;
        case 'extract-control':
          this.extractControl();
          break;
        case 'template-data':
          this.sampleDataDialog(true);
          break;
        case 'sample-data':
          this.sampleDataDialog(false);
          break;
        case 'insert-image':
          this.chooseFile('image/png,image/jpeg,image/webp,image/svg+xml', (f) =>
            this.insertImage(f),
          );
          break;
        case 'move-up':
          this.reorder(-1);
          break;
        case 'move-down':
          this.reorder(1);
          break;
        case 'front':
          this.reorder(10000);
          break;
        case 'back':
          this.reorder(-10000);
          break;
        case 'reparent':
          this.reparentDialog();
          break;
        case 'reset-demo':
          this.resetDemoDialog();
          break;
        case 'rename-document':
          this.renameDocumentDialog();
          break;
        case 'toggle-notes':
          this.showNotes = !this.showNotes;
          this.drawSelection();
          break;
      }
    } catch (error) {
      console.error(error);
      toast(error.message);
    }
  }
  topSelection() {
    return this.selected.filter(
      (n) => !this.selected.some((other) => other !== n && descendants(other).includes(n.id)),
    );
  }
  copy(notify = true) {
    this.clipboard = this.topSelection().map(clone);
    if (notify)
      toast(`${this.clipboard.length} layer${this.clipboard.length === 1 ? '' : 's'} copied`);
  }
  uniqueClone(source) {
    const n = reidentify(source),
      names = new Set();
    walk(this.doc.root, (c) => {
      if (c.props?.['x:Name'] || c.props?.Name) names.add(c.props['x:Name'] || c.props.Name);
    });
    const remap = {};
    walk(n, (c) => {
      if (!c.props) return;
      const key = c.props['x:Name'] ? 'x:Name' : c.props.Name ? 'Name' : null;
      if (!key) return;
      const old = c.props[key];
      let name = old,
        i = 2;
      while (names.has(name)) name = old + i++;
      names.add(name);
      remap[old] = name;
      c.props[key] = name;
    });
    walk(n, (c) => {
      for (const [k, v] of Object.entries(c.props || {})) {
        if (typeof v !== 'string') continue;
        c.props[k] = v.replace(
          /(ElementName\s*=\s*)([A-Za-z_]\w*)/g,
          (s, p, name) => p + (remap[name] || name),
        );
      }
    });
    return n;
  }
  paste(duplicate = false) {
    if (!this.clipboard.length) {
      toast('Copy a layer first.');
      return;
    }
    const selected = this.selected[0],
      parent =
        duplicate && selected ? parentOf(this.doc.root, selected.id) : this.parentForInsert();
    if (!parent) throw Error('The document root cannot be duplicated here.');
    const nodes = this.clipboard.map((n) => this.uniqueClone(n));
    this.canContain(parent, nodes);
    this.store.transaction(duplicate ? 'Duplicate layers' : 'Paste layers', () => {
      for (const n of nodes) {
        if (localName(parent.type) === 'Canvas') {
          n.props['Canvas.Left'] = String(nval(n.props['Canvas.Left']) + 16);
          n.props['Canvas.Top'] = String(nval(n.props['Canvas.Top']) + 16);
        }
        parent.children.push(n);
      }
    });
    this.store.select(nodes.map((n) => n.id));
    toast(`${nodes.length} layer${nodes.length === 1 ? '' : 's'} added`);
  }
  group(type) {
    const nodes = this.topSelection();
    if (!nodes.length) throw Error('Select one or more layers to group.');
    const parent = parentOf(this.doc.root, nodes[0].id);
    if (!parent || nodes.some((n) => parentOf(this.doc.root, n.id) !== parent))
      throw Error('Select layers with the same parent.');
    const group = element(type);
    const originalRects = nodes.map((n) => ({ node: n, rect: this.rectFor(n.id) }));
    const origin = originalRects
      .filter((x) => x.rect)
      .reduce(
        (r, x) => ({
          x: Math.min(r.x, x.rect.x),
          y: Math.min(r.y, x.rect.y),
          right: Math.max(r.right, x.rect.x + x.rect.width),
          bottom: Math.max(r.bottom, x.rect.y + x.rect.height),
        }),
        { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity },
      );
    this.store.transaction(`Wrap in ${type}`, () => {
      const index = parent.children.indexOf(nodes[0]);
      if (localName(parent.type) === 'Canvas' && Number.isFinite(origin.x)) {
        const pr = this.rectFor(parent.id);
        group.props['Canvas.Left'] = String(Math.round((origin.x - pr.x) / this.zoom));
        group.props['Canvas.Top'] = String(Math.round((origin.y - pr.y) / this.zoom));
        group.props.Width = String(Math.round((origin.right - origin.x) / this.zoom));
        group.props.Height = String(Math.round((origin.bottom - origin.y) / this.zoom));
        if (type === 'Grid')
          originalRects.forEach(({ node, rect }) => {
            if (!rect) return;
            node.props.Margin = `${Math.round((rect.x - origin.x) / this.zoom)},${Math.round((rect.y - origin.y) / this.zoom)},0,0`;
            node.props.HorizontalAlignment = 'Left';
            node.props.VerticalAlignment = 'Top';
            delete node.props['Canvas.Left'];
            delete node.props['Canvas.Top'];
          });
      } else if (localName(parent.type) === 'Grid') {
        for (const key of ['Grid.Row', 'Grid.Column', 'Grid.RowSpan', 'Grid.ColumnSpan'])
          if (nodes[0].props[key]) group.props[key] = nodes[0].props[key];
      }
      parent.children = parent.children.filter((n) => !nodes.includes(n));
      group.children = nodes;
      parent.children.splice(index, 0, group);
    });
    this.store.select([group.id]);
  }
  ungroup() {
    const n = this.selected[0];
    if (!n || !this.registry.get(n.type)?.container)
      throw Error('Select a layout container to ungroup.');
    const parent = parentOf(this.doc.root, n.id);
    if (!parent) throw Error('The root cannot be ungrouped.');
    const children = visualChildren(n);
    if (this.registry.get(parent.type)?.singleChild && children.length > 1)
      throw Error('The parent accepts only one child.');
    this.store.transaction('Ungroup layout', () => {
      const i = parent.children.indexOf(n);
      parent.children.splice(i, 1, ...children);
    });
    this.store.select(children.map((n) => n.id));
  }
  convertLayout(type) {
    if (!this.prepareEdit()) return;
    const n = this.selected[0];
    if (!n) return;
    const old = n.type,
      rects = visualChildren(n).map((c) => ({ id: c.id, rect: this.rectFor(c.id) })),
      parentRect = this.rectFor(n.id);
    this.store.transaction(`Convert ${old} to ${type}`, () => {
      n.type = type;
      if (type === 'Canvas') {
        for (const { id, rect } of rects) {
          const c = find(n, id);
          if (rect && parentRect) {
            c.props['Canvas.Left'] = String(Math.round((rect.x - parentRect.x) / this.zoom));
            c.props['Canvas.Top'] = String(Math.round((rect.y - parentRect.y) / this.zoom));
            c.props.Width = String(Math.round(rect.width / this.zoom));
            c.props.Height = String(Math.round(rect.height / this.zoom));
          }
          for (const k of [
            'Grid.Row',
            'Grid.Column',
            'Grid.RowSpan',
            'Grid.ColumnSpan',
            'DockPanel.Dock',
          ])
            delete c.props[k];
        }
        if (parentRect) {
          n.props.Width = String(Math.round(parentRect.width / this.zoom));
          n.props.Height = String(Math.round(parentRect.height / this.zoom));
        }
      } else {
        visualChildren(n).forEach((c, i) => {
          for (const key of ['Canvas.Left', 'Canvas.Top', 'Canvas.Right', 'Canvas.Bottom'])
            delete c.props[key];
          if (type === 'Grid') c.props['Grid.Row'] = String(i);
        });
      }
      if (type === 'Grid' && !n.children.some((c) => c.type === 'Grid.RowDefinitions'))
        n.children.unshift(
          element(
            'Grid.RowDefinitions',
            {},
            visualChildren(n).map(() => element('RowDefinition', { Height: 'Auto' })),
          ),
        );
      if (type === 'StackPanel') n.props.Orientation = 'Vertical';
      if (type !== old) {
        n.children = n.children.filter(
          (c) =>
            !isProperty(c) ||
            !c.type.startsWith(old + '.') ||
            !['RowDefinitions', 'ColumnDefinitions'].includes(c.type.split('.').pop()),
        );
        if (type !== 'StackPanel' && type !== 'WrapPanel') delete n.props.Orientation;
        delete n.props.Spacing;
      }
    });
    toast(`Layout converted to ${type}`);
  }
  align(direction) {
    if (!this.prepareEdit() || !this.selected.length) return;
    const horizontal = ['left', 'center', 'right'].includes(direction);
    this.store.transaction('Align ' + direction, () => {
      const nodes = this.topSelection();
      const rects = nodes.map((n) => ({ n, r: this.rectFor(n.id) })).filter((x) => x.r);
      if (!rects.length) return;
      const bounds = rects.reduce(
        (b, { r }) => ({
          left: Math.min(b.left, r.x),
          top: Math.min(b.top, r.y),
          right: Math.max(b.right, r.x + r.width),
          bottom: Math.max(b.bottom, r.y + r.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
      );
      for (const { n, r } of rects) {
        const parent = parentOf(this.doc.root, n.id);
        if (localName(parent?.type || '') === 'Canvas') {
          const pr = this.rectFor(parent.id);
          if (nodes.length === 1) {
            bounds.left = pr.x;
            bounds.top = pr.y;
            bounds.right = pr.x + pr.width;
            bounds.bottom = pr.y + pr.height;
          }
          const target =
            direction === 'left'
              ? bounds.left
              : direction === 'center'
                ? (bounds.left + bounds.right - r.width) / 2
                : direction === 'right'
                  ? bounds.right - r.width
                  : direction === 'top'
                    ? bounds.top
                    : direction === 'middle'
                      ? (bounds.top + bounds.bottom - r.height) / 2
                      : bounds.bottom - r.height;
          n.props[horizontal ? 'Canvas.Left' : 'Canvas.Top'] = String(
            Math.round((target - (horizontal ? pr.x : pr.y)) / this.zoom),
          );
        } else
          n.props[horizontal ? 'HorizontalAlignment' : 'VerticalAlignment'] = {
            left: 'Left',
            center: 'Center',
            right: 'Right',
            top: 'Top',
            middle: 'Center',
            bottom: 'Bottom',
          }[direction];
      }
    });
  }
  nudge(key, amount) {
    if (!this.prepareEdit() || !this.selected.length) return;
    this.store.transaction('Nudge layers', () => {
      this.topSelection().forEach((n) => {
        const p = parentOf(this.doc.root, n.id),
          axis = key === 'ArrowLeft' || key === 'ArrowRight' ? 'x' : 'y',
          delta = (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1) * amount;
        if (localName(p?.type || '') === 'Canvas') {
          const prop = axis === 'x' ? 'Canvas.Left' : 'Canvas.Top';
          n.props[prop] = String(nval(n.props[prop]) + delta);
        } else {
          const m = thickness(n.props.Margin);
          m[axis === 'x' ? 3 : 0] += delta;
          n.props.Margin = [m[3], m[0], m[1], m[2]].join(',');
        }
      });
    });
  }
  reorder(delta) {
    const nodes = this.topSelection();
    this.store.transaction('Reorder layers', () => {
      for (const n of delta > 0 ? [...nodes].reverse() : nodes) {
        const p = parentOf(this.doc.root, n.id);
        if (!p) continue;
        const i = p.children.indexOf(n);
        p.children.splice(i, 1);
        p.children.splice(Math.max(0, Math.min(p.children.length, i + delta)), 0, n);
      }
    });
  }
  focusSelection() {
    const rects = this.selected.map((n) => this.rectFor(n.id)).filter(Boolean);
    if (!rects.length) {
      this.fit();
      return;
    }
    const bounds = rects.reduce(
      (a, r) => ({
        x: Math.min(a.x, r.x),
        y: Math.min(a.y, r.y),
        right: Math.max(a.right, r.x + r.width),
        bottom: Math.max(a.bottom, r.y + r.height),
      }),
      { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity },
    );
    const vp = $('#canvas-viewport'),
      width = (bounds.right - bounds.x) / this.zoom,
      height = (bounds.bottom - bounds.y) / this.zoom,
      docX = (bounds.x - this.pan.x) / this.zoom,
      docY = (bounds.y - this.pan.y) / this.zoom;
    this.zoom = Math.max(
      0.1,
      Math.min(3, (vp.clientWidth - 100) / width, (vp.clientHeight - 100) / height),
    );
    this.pan = {
      x: (vp.clientWidth - width * this.zoom) / 2 - docX * this.zoom,
      y: (vp.clientHeight - height * this.zoom) / 2 - docY * this.zoom,
    };
    this.transform();
  }
  contextMenu(x, y) {
    $('.context-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = Math.min(x, innerWidth - 220) + 'px';
    menu.style.top = Math.max(5, Math.min(y, innerHeight - 420)) + 'px';
    menu.innerHTML = [
      ['copy', 'Copy', 'Ctrl C'],
      ['paste', 'Paste', 'Ctrl V'],
      ['duplicate', 'Duplicate', 'Ctrl D'],
      ['group', 'Wrap in Grid', 'Ctrl G'],
      ['wrap-stack', 'Wrap in StackPanel', ''],
      ['ungroup', 'Ungroup', '⇧ Ctrl G'],
      ['reparent', 'Move to container…', ''],
      ['front', 'Bring to front', ''],
      ['back', 'Send to back', ''],
      ['edit-template', 'Edit template', ''],
      ['delete', 'Delete', 'Del'],
    ]
      .map(
        ([action, name, key]) =>
          `<button data-action="${action}">${name}<kbd>${key}</kbd></button>`,
      )
      .join('');
    document.body.append(menu);
    menu.addEventListener('click', () => menu.remove());
  }
  modal(title, body, actions = [], wide = false) {
    return modal(this, title, body, actions, wide);
  }
  closeModal() {
    return closeModal(this);
  }
  newDocumentDialog() {
    return newDocumentDialog(this);
  }
  renameDocumentDialog() {
    return renameDocumentDialog(this);
  }
  chooseFile(accept, callback) {
    return chooseFile(this, accept, callback);
  }
  async importFile(file) {
    return importFile(this, file);
  }
  importText(text, name = 'Imported.xaml') {
    return importText(this, text, name);
  }
  workspaceData() {
    return workspaceData(this);
  }
  exportDialog() {
    return exportDialog(this);
  }
  svgSnapshot() {
    return svgSnapshot(this);
  }
  async copyXaml() {
    const text = this.selected[0] ? serializeNode(this.selected[0]) : serializeXaml(this.doc);
    try {
      await navigator.clipboard.writeText(text);
      toast('XAML copied');
    } catch {
      download('selection.xaml', text, 'application/xml');
      toast('Clipboard unavailable. Selection downloaded.');
    }
  }
  preview() {
    if (!this.prepareEdit()) return;
    this.modal(
      'Interactive preview',
      `<div style="display:flex;gap:8px;margin-bottom:15px;align-items:center"><label for="preview-device" style="margin:0">Viewport</label><select id="preview-device" style="margin:0;width:180px"><option value="1100">Desktop · 1100 px</option><option value="768">Tablet · 768 px</option><option value="390">Phone · 390 px</option><option value="custom">Artboard size</option></select><span class="spacer"></span><button class="button" id="preview-data">${icon('binding')}Sample data</button></div><div class="preview-host"><div class="preview-device" id="preview-device-host"></div></div><p style="font-size:11px;margin-top:14px;margin-bottom:0">Browser controls are interactive. Bindings use design data; .NET event handlers and converters are preserved in source.</p>`,
      [],
      true,
    );
    const renderer = new PreviewRenderer(this.registry);
    renderer.sampleData = this.doc.metadata?.sampleData || this.renderer.sampleData;
    const doc = clone(this.doc),
      host = $('#preview-device-host');
    const draw = (width) => {
      host.style.width = width + 'px';
      host.style.height = this.doc.design.height + 'px';
      doc.root.props.Width = String(width);
      doc.root.props.Height = String(doc.design.height);
      renderer.render(doc, host, { interactive: true });
    };
    draw(this.doc.design.width);
    $('#preview-device').value = 'custom';
    $('#preview-device').onchange = (e) =>
      draw(e.target.value === 'custom' ? this.doc.design.width : Number(e.target.value));
    $('#preview-data').onclick = () => this.sampleDataDialog(false);
    host.addEventListener('xamora:preview-event', (e) =>
      toast(
        e.detail.handler
          ? `Click → ${e.detail.handler} (native handler not executed)`
          : 'Button clicked',
      ),
    );
  }
  sampleDataDialog(template) {
    const value = template
      ? this.doc.metadata?.templateSample || {
          Content: 'Create project',
          Background: '#7953E8',
          Foreground: '#FFFFFF',
          BorderBrush: '#7953E8',
        }
      : this.doc.metadata?.sampleData || this.renderer.sampleData;
    this.modal(
      template ? 'Template preview values' : 'Design sample data',
      `<p>${template ? 'Properties of the sample templated parent.' : 'A JSON object for previewing simple Binding paths. These values are stored in the project, not in exported XAML.'}</p><textarea id="sample-data" style="height:240px">${esc(JSON.stringify(value, null, 2))}</textarea>`,
      [
        {
          label: 'Apply preview data',
          primary: true,
          run: () => {
            const data = JSON.parse($('#sample-data').value);
            if (!data || typeof data !== 'object' || Array.isArray(data))
              throw Error('Enter a JSON object.');
            this.store.transaction('Set design data', (d) => {
              d.metadata ??= {};
              d.metadata[template ? 'templateSample' : 'sampleData'] = data;
            });
            if (!template) this.renderer.sampleData = data;
            this.renderCanvas();
            this.closeModal();
          },
        },
      ],
    );
  }
  editText(n) {
    const key =
      n.props.Text !== undefined || localName(n.type) === 'TextBlock' ? 'Text' : 'Content';
    this.modal(
      'Edit ' + localName(n.type),
      `<label for="inline-text">${key}</label><textarea id="inline-text" style="min-height:90px">${esc(n.props[key] || '')}</textarea>`,
      [
        {
          label: 'Update text',
          primary: true,
          run: () => {
            this.setProps([n.id], key, $('#inline-text').value);
            this.closeModal();
          },
        },
      ],
    );
  }
  editTemplate() {
    const n = this.selected[0];
    if (!n) throw Error('Select a control to edit its template.');
    if (localName(n.type) === 'ControlTemplate') {
      this.scopeId = n.id;
      this.store.select([]);
      this.render();
      this.fit();
      return;
    }
    let property = n.children.find((c) => isProperty(c) && c.type.endsWith('.Template')),
      template = property?.children.find((c) => localName(c.type) === 'ControlTemplate');
    if (!template) {
      if (
        ![
          'Button',
          'ToggleButton',
          'CheckBox',
          'RadioButton',
          'TextBox',
          'ContentControl',
          'UserControl',
          'ListBoxItem',
          'TabItem',
        ].includes(localName(n.type)) &&
        !this.registry.get(n.type)?.templated
      )
        throw Error(
          'Select a templated control, or register templated: true in its toolkit descriptor.',
        );
      template = element('ControlTemplate', { TargetType: n.type }, [
        element(
          'Border',
          {
            'x:Name': 'PART_Border',
            Background: '{TemplateBinding Background}',
            BorderBrush: '{TemplateBinding BorderBrush}',
            BorderThickness: '1',
            CornerRadius: '8',
            Padding: '16,10',
          },
          [
            element('ContentPresenter', {
              'x:Name': 'PART_Content',
              Content: '{TemplateBinding Content}',
              HorizontalAlignment: 'Center',
              VerticalAlignment: 'Center',
            }),
          ],
        ),
      ]);
      this.store.transaction('Create control template', () => {
        property = element(`${n.type}.Template`, {}, [template]);
        n.children.push(property);
      });
    }
    this.doc.metadata.templateSample = {
      Content: n.props.Content || 'Button',
      Background: n.props.Background || '#7953E8',
      Foreground: n.props.Foreground || '#FFFFFF',
      BorderBrush: n.props.BorderBrush || '#7953E8',
    };
    this.scopeId = template.id;
    this.store.select([visualChildren(template)[0]?.id].filter(Boolean));
    this.render();
    this.fit();
  }
  extractControl() {
    const n = this.selected[0];
    if (!n) throw Error('Select a layer to create a user control.');
    this.modal(
      'Create user control',
      `<p>Create a reusable UserControl from the selected subtree. The original design is kept.</p><label for="control-name">Control name</label><input id="control-name" value="${esc(label(n))}View"><label for="control-namespace">CLR namespace</label><input id="control-namespace" value="MyApp.Controls">`,
      [
        {
          label: 'Create control',
          primary: true,
          run: () => {
            const name = $('#control-name').value.trim(),
              ns = $('#control-namespace').value.trim();
            if (!/^[A-Za-z_]\w*$/.test(name) || !/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(ns))
              throw Error('Use valid C# type and namespace names.');
            const root = newRoot('UserControl', this.doc.framework);
            Object.entries(this.doc.root.props)
              .filter(([k]) => k.startsWith('xmlns'))
              .forEach(([k, v]) => (root.props[k] = v));
            root.props['x:Class'] = ns + '.' + name;
            const selected = clone(n);
            const resources = this.doc.root.children.find(
              (c) => isProperty(c) && c.type.endsWith('.Resources'),
            );
            if (resources)
              root.children.push(
                element('UserControl.Resources', {}, resources.children.map(reidentify)),
              );
            root.children.push(reidentify(selected));
            const doc = createDocument(root, this.doc.framework, name + '.xaml');
            this.addStore(doc);
            this.registry.install({
              name: 'Project control ' + ns + '.' + name,
              controls: [
                {
                  type: 'local:' + name,
                  category: 'My controls',
                  namespace: 'clr-namespace:' + ns,
                  container: true,
                  singleChild: true,
                  defaults: { Width: '300', Height: '200' },
                  description:
                    'Extracted user control; register a renderer to instantiate its view.',
                },
              ],
            });
            this.closeModal();
            this.switchDocument(this.stores.length - 1);
            toast('UserControl created. Wire its CLR partial class in your native project.');
          },
        },
      ],
    );
  }
  resourcesContainer() {
    if (localName(this.doc.root.type) === 'ResourceDictionary') return this.doc.root;
    let p = this.doc.root.children.find((c) => isProperty(c) && c.type.endsWith('.Resources'));
    if (!p) {
      p = element(this.doc.root.type + '.Resources');
      this.doc.root.children.unshift(p);
    }
    return p;
  }
  resourcesDialog() {
    const resources = this.resources();
    this.modal(
      'Theme & resources',
      `<p>Edit resources in the current document. Existing resource references update in the canvas.</p><div id="theme-resources">${resources.map((n) => `<div class="resource-row" style="padding:10px 0"><span class="swatch" style="background:${esc(color(n.props.Color) || '#eee')}"></span><div style="flex:1"><div class="resource-name">${esc(n.props['x:Key'])}</div><div class="resource-value">${esc(n.type)}</div></div>${n.props.Color ? `<input type="color" data-theme-color="${n.id}" value="${esc(color(n.props.Color) || '#000000')}">` : `<button class="button" data-edit-resource="${n.id}">Edit XAML</button>`}</div>`).join('') || '<p>No resources in this document yet.</p>'}</div><button class="button" id="theme-add" style="margin-top:20px">${icon('plus')}Add resource</button>`,
      [{ label: 'Done', primary: true, run: () => this.closeModal() }],
    );
    $$('[data-theme-color]').forEach(
      (input) =>
        (input.onchange = () => {
          this.setProps([input.dataset.themeColor], 'Color', input.value);
          input.closest('.resource-row').querySelector('.swatch').style.background = input.value;
        }),
    );
    $$('[data-edit-resource]').forEach(
      (b) =>
        (b.onclick = () => {
          this.store.select([b.dataset.editResource]);
          this.closeModal();
          this.setView('split');
          this.editor.revealName(find(this.doc.root, b.dataset.editResource).props['x:Key']);
        }),
    );
    $('#theme-add').onclick = () => this.addResourceDialog();
  }
  addResourceDialog() {
    this.modal(
      'New resource',
      `<label for="resource-key">Resource key</label><input id="resource-key" value="BrandAccent"><label for="resource-type">Type</label><select id="resource-type"><option>SolidColorBrush</option><option>Style</option><option>ControlTemplate</option><option>DataTemplate</option></select><label for="resource-value">Color or target type</label><input id="resource-value" value="#7953E8">`,
      [
        {
          label: 'Add resource',
          primary: true,
          run: () => {
            if (!this.prepareEdit()) return;
            const key = $('#resource-key').value.trim(),
              type = $('#resource-type').value,
              value = $('#resource-value').value;
            if (!key) throw Error('Enter a resource key.');
            if (this.resources().some((n) => n.props['x:Key'] === key))
              throw Error('A resource with this key already exists.');
            const props = { 'x:Key': key };
            if (type === 'SolidColorBrush') {
              if (!color(value)) throw Error('Enter a valid color.');
              props.Color = value;
            } else if (type !== 'DataTemplate') props.TargetType = value || 'Button';
            const n = element(
              type,
              props,
              type === 'ControlTemplate' || type === 'DataTemplate'
                ? [
                    element('Border', { Background: '#7953E8', CornerRadius: '8', Padding: '15' }, [
                      element('ContentPresenter', { Content: '{TemplateBinding Content}' }),
                    ]),
                  ]
                : [],
            );
            this.store.transaction('Add resource', () =>
              this.resourcesContainer().children.push(n),
            );
            this.closeModal();
            this.leftTab = 'assets';
            this.store.select([n.id]);
            this.renderLeft();
          },
        },
      ],
    );
    $('#resource-type').onchange = (e) => {
      $('#resource-value').value = e.target.value === 'SolidColorBrush' ? '#7953E8' : 'Button';
    };
  }
  bindingDialog(defaultProperty) {
    if (!this.selected.length) {
      toast('Select a control to add a binding.');
      return;
    }
    const resources = this.resources();
    this.modal(
      'Property expression',
      `<label for="binding-property">Property</label><input id="binding-property" value="${esc(defaultProperty)}"><label for="binding-kind">Expression</label><select id="binding-kind"><option>Binding</option><option>StaticResource</option><option>DynamicResource</option><option>TemplateBinding</option></select><label for="binding-path">Path or resource key</label><input id="binding-path" list="resource-keys" placeholder="User.Name"><datalist id="resource-keys">${resources.map((n) => `<option value="${esc(n.props['x:Key'])}">`).join('')}</datalist><label for="binding-mode">Binding mode</label><select id="binding-mode"><option value="">Default</option><option>OneWay</option><option>TwoWay</option><option>OneTime</option><option>OneWayToSource</option></select><label for="binding-fallback">Fallback value (optional)</label><input id="binding-fallback" placeholder="Preview text"><p style="font-size:11px">The expression is preserved in XAML. Preview supports simple paths and color resources.</p>`,
      [
        {
          label: 'Apply expression',
          primary: true,
          run: () => {
            const property = $('#binding-property').value.trim(),
              kind = $('#binding-kind').value,
              path = $('#binding-path').value.trim(),
              mode = $('#binding-mode').value,
              fallback = $('#binding-fallback').value;
            if (!path || /[{}]/.test(path))
              throw Error('Enter a path or resource key without braces.');
            const value = `{${kind} ${path}${kind === 'Binding' && mode ? ', Mode=' + mode : ''}${kind === 'Binding' && fallback ? ', FallbackValue=' + fallback : ''}}`;
            this.setProps(this.store.selection, property, value);
            this.closeModal();
          },
        },
      ],
    );
    if (resources.length && ['Background', 'Foreground', 'BorderBrush'].includes(defaultProperty)) {
      $('#binding-kind').value = 'StaticResource';
      $('#binding-path').value = resources.find((n) => n.props.Color)?.props['x:Key'] || '';
    }
  }
  customPropertyDialog() {
    this.modal(
      'Custom property',
      `<label for="custom-key">Property or attached property</label><input id="custom-key" placeholder="AutomationProperties.Name"><label for="custom-value">Value</label><input id="custom-value" placeholder="Accessible name">`,
      [
        {
          label: 'Set property',
          primary: true,
          run: () => {
            const key = $('#custom-key').value.trim();
            if (!key) throw Error('Enter a property name.');
            this.setProps(this.store.selection, key, $('#custom-value').value);
            this.closeModal();
          },
        },
      ],
    );
  }
  installToolkitDialog() {
    return installToolkitDialog(this);
  }
  async insertImage(file) {
    if (file.size > 3_000_000) throw Error('Choose an image under 3 MB.');
    if (file.type === 'image/svg+xml')
      throw Error(
        'Use PNG, JPEG, or WebP for inline image assets. SVG sources can be authored in XAML.',
      );
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    if (!this.prepareEdit()) return;
    const node = this.registry.create('Image');
    node.props.Source = source;
    const parent = this.parentForInsert();
    this.canContain(parent, [node]);
    this.store.insert(contentHost(parent).id, node);
    toast('Image embedded. Export native asset paths before using in WPF or Avalonia.');
  }
  newAnnotation(x, y) {
    this.modal(
      'Add design annotation',
      `<label for="note-text">Your note</label><textarea id="note-text" placeholder="Leave a note about this part of the design…"></textarea>`,
      [{ label: 'Add annotation', primary: true, run: () => {} }].map((a) => ({
        ...a,
        run: () => {
          const text = $('#note-text').value.trim();
          if (!text) throw Error('Write a note first.');
          if (!this.prepareEdit()) return;
          this.store.transaction('Add annotation', (d) => {
            d.annotations ??= [];
            d.annotations.push({
              id: uid(),
              x: Math.max(0, x),
              y: Math.max(0, y),
              text,
              author: 'Design note',
              resolved: false,
            });
          });
          this.closeModal();
          this.setTool('select');
          this.rightTab = 'notes';
          this.renderInspector();
        },
      })),
    );
  }
  renderNotes() {
    this.inspectorHost().innerHTML = `<section class="panel-section"><div class="section-heading">Design notes<span class="spacer"></span>${button('toggle-notes', 'Toggle canvas pins', 'eye')}</div><p style="font-size:11px;color:var(--muted);line-height:1.6;margin:0">Use the comment tool or press C to add a note anywhere on the artboard.</p></section>${(this.doc.annotations || []).map((a) => `<article class="note-card" style="${a.resolved ? 'opacity:.6' : ''}"><div class="note-title"><span>${esc(a.author || 'Design note')}</span><button data-note-action="resolve" data-id="${a.id}">${a.resolved ? 'Reopen' : 'Resolve'}</button></div><div>${esc(a.text)}</div><div style="display:flex;justify-content:space-between;margin-top:10px"><span style="font-size:10px;color:var(--muted)">${a.resolved ? 'Resolved' : 'Open'} · ${Math.round(a.x)}, ${Math.round(a.y)}</span><button data-note-action="edit" data-id="${a.id}">Edit</button></div></article>`).join('') || '<div class="empty-inspector">No annotations yet.</div>'}`;
  }
  editAnnotation(id) {
    const note = this.doc.annotations.find((a) => a.id === id);
    if (!note) return;
    this.modal('Edit annotation', `<textarea id="note-edit">${esc(note.text)}</textarea>`, [
      {
        label: 'Delete',
        run: () => {
          this.store.transaction(
            'Delete annotation',
            (d) => (d.annotations = d.annotations.filter((a) => a.id !== id)),
          );
          this.closeModal();
        },
      },
      {
        label: 'Save note',
        primary: true,
        run: () => {
          const text = $('#note-edit').value.trim();
          if (!text) throw Error('A note cannot be empty.');
          this.store.transaction('Edit annotation', () => (note.text = text));
          this.closeModal();
        },
      },
    ]);
  }
  noteAction(action, id) {
    if (!this.prepareEdit()) return;
    if (action === 'edit') this.editAnnotation(id);
    else
      this.store.transaction('Resolve annotation', (d) => {
        const n = d.annotations.find((a) => a.id === id);
        n.resolved = !n.resolved;
      });
  }
  reparentDialog() {
    const nodes = this.topSelection(),
      ids = new Set(nodes.flatMap(descendants));
    const candidates = [];
    walk(this.doc.root, (n) => {
      if (this.registry.get(n.type)?.container && !ids.has(n.id)) candidates.push(n);
    });
    this.modal(
      'Move layers to container',
      `<label for="move-parent">Container</label><select id="move-parent">${candidates.map((n) => `<option value="${n.id}">${esc(label(n))} · ${esc(n.type)}</option>`).join('')}</select>`,
      [
        {
          label: 'Move layers',
          primary: true,
          run: () => {
            const parent = find(this.doc.root, $('#move-parent').value);
            this.canContain(parent, nodes);
            this.store.move(
              nodes.map((n) => n.id),
              parent.id,
            );
            this.closeModal();
          },
        },
      ],
    );
  }
  problemsDialog() {
    return problemsDialog(this);
  }
  symbolsDialog() {
    return symbolsDialog(this);
  }
  historyDialog() {
    return historyDialog(this);
  }
  projectMenu() {
    return projectMenu(this);
  }
  commandPalette() {
    return commandPalette(this);
  }
  helpDialog() {
    return helpDialog(this);
  }
  resetDemoDialog() {
    return resetDemoDialog(this);
  }
  registerAgentTools() {
    const ctx = document.modelContext;
    if (!ctx?.registerTool) return;
    const lifecycle = new AbortController();
    this.agentLifecycle = lifecycle;
    const register = (tool) =>
      Promise.resolve(ctx.registerTool(tool, { signal: lifecycle.signal })).catch((e) =>
        console.warn('Agent tool registration unavailable', e.message),
      );
    register({
      name: 'xamora_read_document',
      title: 'Read design document',
      description: 'Read the current page, selected IDs, and XAML.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => ({
        name: this.doc.name,
        framework: this.doc.framework,
        selection: [...this.store.selection],
        xaml: this.store.session?.source ?? serializeXaml(this.doc),
      }),
    });
    register({
      name: 'xamora_set_properties',
      title: 'Set design properties',
      description:
        'Apply a batch of property edits to existing elements using the same undoable document store as the inspector.',
      inputSchema: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                property: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['id', 'property', 'value'],
              additionalProperties: false,
            },
            maxItems: 100,
          },
        },
        required: ['edits'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input) => {
        if (!input || !Array.isArray(input.edits) || input.edits.length > 100)
          throw Error('Supply up to 100 edits.');
        for (const e of input.edits)
          if (
            !find(this.doc.root, e.id) ||
            !/^[A-Za-z_][\w.:-]*$/.test(e.property) ||
            typeof e.value !== 'string'
          )
            throw Error('Invalid element, property, or value.');
        if (!this.prepareEdit()) throw Error('Resolve the pending XAML error first.');
        this.store.transaction('Agent property edits', (d) => {
          for (const e of input.edits)
            Object.defineProperty(find(d.root, e.id).props, e.property, {
              value: e.value,
              writable: true,
              enumerable: true,
              configurable: true,
            });
        });
        return { updated: input.edits.length, revision: this.store.revision };
      },
    });
  }
}
