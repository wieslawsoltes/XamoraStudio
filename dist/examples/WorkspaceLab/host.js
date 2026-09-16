/** A small application adapter. No Studio imports; documents, persistence and commands stay here. */
import { DocumentStore, createDocument, element, find, walk, clone } from '../../core/model.js';
import { DocumentSession } from '../../core/document-session.js';
import { builtins } from '../../core/registry.js';
import { PreviewRenderer } from '../../core/render.js';
import { parseXaml, serializeXaml } from '../../core/xaml.js';
import { parseHtml, isHtml, serializeHtml } from '../../core/html.js';
import { XamlEditor } from '../../core/editor.js';
import { renderPropertyField } from '../../controls/property-grid.js';
import { DialogHost } from '../../controls/dialog-host.js';
import { WorkspaceContext, esc } from '../../workspaces/workspace-context.js';

export class LabHost {
  constructor(root, dialogRoot, { notify = () => {}, ...services } = {}) {
    this.root = root;
    this.workspaceOptions = { root, dialogRoot, notify, ...services };
    this.lifecycle = new WorkspaceContext(this.workspaceOptions);
    const $ = (s) => root.querySelector(s);
    root.classList.add('xamora-workspace');
    dialogRoot.classList.add('xamora-workspace');
    root.innerHTML = `<div id="studio"><nav class="toolbar"><button data-lab="new-story">New animation</button><button data-lab="states">States</button><button data-lab="brush">Brush</button><button data-lab="data">Data</button><button data-lab="resource">New resource</button><button data-lab="html">HTML example</button><button data-lab="undo">Undo</button><button data-lab="redo">Redo</button><span class="view-toggle"></span><span class="file-folder"></span><select id="framework-select"><option>WPF</option></select></nav><div class="workspace"><aside><div id="left-content"><section data-left-host="layers"></section><section data-left-host="toolkit"></section><section data-left-host="assets"></section><section data-left-host="data"></section></div><section data-panels></section></aside><section class="center"><div id="scope-banner" hidden></div><div id="canvas-viewport"><div id="world"><div id="artboard"></div></div><div id="selection-overlay"></div></div><div id="code-editor"></div><section data-timeline></section></section><aside><div id="inspector" data-inspector-host="design"></div><div data-inspector-host="raw"></div><div data-inspector-host="flow"></div><div data-inspector-host="inspect"></div><div data-inspector-host="notes"></div></aside></div><output data-status></output></div>`;
    this.registry = builtins();
    this.stores = [];
    this.active = 0;
    this.leftTab = 'layers';
    this.rightTab = 'design';
    this.scopeId = null;
    this.zoom = 1;
    this.pan = { x: 16, y: 16 };
    this.tool = 'select';
    this.view = 'split';
    this.snap = true;
    this.collapsed = new Set();
    this.clipboard = [];
    this.readOnly = false;
    this.notifications = [];
    this.dialogHost = this.lifecycle.own(new DialogHost(dialogRoot));
    this.renderer = new PreviewRenderer(this.registry);
    this.lifecycle.add(() => this.renderer.dispose?.());
    this.editor = this.lifecycle.own(new XamlEditor($('#code-editor'), {
      registry: this.registry,
      onApply: (text) => this.applyCode(text),
    }));
    this.menus = { commands: new Map(), menus: [{ label: 'Animation', children: [] }] };
    this.panels = new Map();
    const timeline = $('[data-timeline]');
    this.docking = {
      timelineHost: timeline,
      originalSwitch: (i) => this.switchDocument(i),
      registerPanel: ({ id, title, content }) => {
        if (this.panels.has(id)) throw Error('Duplicate panel: ' + id);
        const section = root.ownerDocument.createElement('section');
        section.setAttribute('aria-label', title);
        section.append(content);
        $('[data-panels]').append(section);
        this.panels.set(id, section);
        return { show: () => { section.hidden = false; }, close: () => { section.hidden = true; }, dispose: () => { section.remove(); this.panels.delete(id); } };
      },
      control: {
        show: (id) => { if (id === 'timeline') timeline.hidden = false; const p = this.panels.get(id); if (p) p.hidden = false; },
        hide: (id) => { if (id === 'timeline') timeline.hidden = true; const p = this.panels.get(id); if (p) p.hidden = true; },
        activate: () => {},
      },
      visibility: (id, visible) => { const p = this.panels.get(id); if (p) p.hidden = !visible; },
      showTimeline: () => { timeline.hidden = false; this.blend.animation.open = true; this.blend.animation.render(); },
      syncDocuments: () => {},
    };
    this.features = { editable: () => this.prepareEdit(), refreshData: () => this.data?.sidebar() };
    this.addStore(createDocument(element('Canvas', { 'xmlns:x': 'http://schemas.microsoft.com/winfx/2006/xaml', Width: '500', Height: '300' }, [
      element('Button', { 'x:Name': 'Action', Content: 'Select me', Width: '120', Height: '40', 'Canvas.Left': '20', 'Canvas.Top': '20', Background: '#7953E8' }),
    ]), 'WPF', 'Workspace.xaml'));
    this.lifecycle.listen(root, 'click', (event) => {
      const button = event.target.closest('[data-lab]');
      if (!button) return;
      const actions = {
        'new-story': () => this.blend.animation.newStoryboard(),
        states: () => this.blend.states(), brush: () => { this.rich.expanded.add('brush'); this.renderInspector(); },
        data: () => this.data.open(), resource: () => this.resources.create('SolidColorBrush'),
        html: () => this.html.motion.openExample(), undo: () => this.command('undo'), redo: () => this.command('redo'),
      };
      try { actions[button.dataset.lab]?.(); } catch (error) { notify(error.message); }
    });
    this.lifecycle.listen($('#canvas-viewport'), 'pointerdown', (event) => this.pointerDown(event));
    this.lifecycle.listen(root, 'change', (event) => { if (event.target.matches('[data-prop]')) this.propertyChanged(event); });
    this.render();
  }
  get store() { return this.stores[this.active]; }
  get doc() { return this.store.document; }
  get selected() { return this.store.selection.map(id => find(this.doc.root, id)).filter(Boolean); }
  get scope() { return this.scopeId ? find(this.doc.root, this.scopeId) : null; }
  leftHost(tab = this.leftTab) { return this.root.querySelector(`[data-left-host="${tab}"]`); }
  inspectorHost(tab = this.rightTab) { return this.root.querySelector(`[data-inspector-host="${tab}"]`); }
  addStore(document) {
    const store = new DocumentStore(document);
    store.session = new DocumentSession(store);
    this.stores.push(store);
    this.lifecycle.listen(store, 'change', () => { if (store === this.store) this.render(); this.save(); });
    this.lifecycle.listen(store, 'selection', () => { if (store === this.store) { this.renderInspector(); this.drawSelection(); } });
    return store;
  }
  switchDocument(index) {
    if (!this.prepareEdit() || !this.stores[index]) return false;
    this.active = index;
    this.scopeId = null;
    this.editor.dirty = false;
    this.render();
    return true;
  }
  prepareEdit() { return !this.readOnly && !this.editor?.composing && (this.store?.session.isValid ?? true); }
  render() { if (!this.store) return; this.renderCanvas(); this.renderTree(); this.renderInspector(); this.editor.setValue(this.store.session.source); }
  renderCanvas() {
    const board = this.root.querySelector('#artboard');
    board.style.width = this.doc.design.width + 'px'; board.style.height = this.doc.design.height + 'px';
    this.renderer.render(this.doc, board);
    this.transform();
  }
  renderTree() {
    const nodes = []; walk(this.doc.root, node => nodes.push(node));
    const host = this.leftHost('layers');
    host.innerHTML = nodes.filter(n => n.kind === 'element').map(n => `<button data-tree-node="${n.id}">${esc(n.props['x:Name'] || n.type)}</button>`).join('');
    for (const button of host.querySelectorAll('[data-tree-node]')) this.lifecycle.handler(button, 'onclick', () => this.store.select([button.dataset.treeNode]));
  }
  renderInspector() {
    const node = this.selected[0], host = this.inspectorHost('design');
    host.innerHTML = node ? Object.entries(node.props).map(([k,v]) => this.field(k,k,v)).join('') : 'Select an element';
  }
  field(name, label, value, options, full = false) { return renderPropertyField({ name, label, value, options, full }, { legacy: true }); }
  renderAssets() { this.leftHost('assets').textContent = 'Resources'; }
  renderToolkitResults() { this.leftHost('toolkit').textContent = 'Toolbox'; }
  drawSelection() {
    const overlay = this.root.querySelector('#selection-overlay'); overlay.replaceChildren();
    for (const id of this.store.selection) { const r = this.rectFor(id); if (!r) continue; const el = this.root.ownerDocument.createElement('div'); el.className='selection-box'; Object.assign(el.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'}); overlay.append(el); }
  }
  rectFor(id) { const r=this.renderer.elements.get(id)?.getBoundingClientRect(), v=this.root.querySelector('#canvas-viewport').getBoundingClientRect(); return r ? {x:r.left-v.left,y:r.top-v.top,width:r.width,height:r.height} : null; }
  setProps(ids,key,value) { if(this.prepareEdit()) this.store.setProperty(ids,key,value); }
  propertyChanged(event) { this.setProps(this.store.selection,event.target.dataset.prop,event.target.type==='checkbox' ? event.target.checked ? 'True':'False' : event.target.value); }
  applyCode(text) { this.store.session.updateSource(text); this.editor.dirty=false; this.render(); }
  importText(source,name='Imported.xaml') { const doc=/\.html$/i.test(name) ? parseHtml(source,{name}) : parseXaml(source,{name}); this.addStore(doc); this.switchDocument(this.stores.length-1); return doc.id; }
  transform() { this.root.querySelector('#world').style.transform=`translate(${this.pan.x}px,${this.pan.y}px) scale(${this.zoom})`; this.drawSelection(); }
  fit() { this.zoom=.8; this.transform(); }
  setView(view) { this.view=view; }
  changeFramework(framework) { this.store.transaction('Framework', doc => {doc.framework=framework;}); }
  canContain(node) { return ['Grid','Canvas','StackPanel','Border','DockPanel'].includes(node.type); }
  snapValue(value) { return this.snap ? Math.round(value/8)*8 : value; }
  pointerDown(event) { const id=event.target.closest('[data-node-id]')?.dataset.nodeId; if(id) this.store.select([id]); }
  pointerMove() {} // This host provides selection only; applications can inject their drag/resize policies.
  pointerUp() {}
  drop() {}
  contextMenu(x,y) { const menu=this.root.ownerDocument.createElement('div');menu.className='context-menu';Object.assign(menu.style,{left:x+'px',top:y+'px'});this.root.append(menu); }
  modal(title,html,actions=[],wide=false) { this.dialogHost.open({title,html,actions,wide}); }
  closeModal() { this.dialogHost.close(); }
  command(action) { if(action==='undo')this.store.undo();else if(action==='redo')this.store.redo();else this.workspaceOptions.notify('Application command: '+action); }
  save() { this.snapshot={ documents:this.stores.map(s=>clone(s.document)), active:this.active, solution:this.solution?.model }; this.root.querySelector('[data-status]').textContent='Saved to the application snapshot'; }
  dispose() { this.lifecycle.dispose();this.root.replaceChildren(); }
}
