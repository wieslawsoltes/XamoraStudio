import {HtmlWorkspace} from './html-workspace.js';
import {ChromeScroll} from './chrome-scroll.js';
import {DensityWorkspace} from './density-workspace.js';
import {SolutionWorkspace} from './solution-workspace.js';
import {ViewBoard} from './view-board.js';
import {DirectAuthoring} from './direct-authoring.js';
import {RichProperties} from './rich-properties.js';
import {ResourceWorkspace} from './resource-workspace.js';
import {TimelineWorkspace} from './timeline-workspace.js';
import {IdeMenu} from './ide-menu.js';
import {locatePanel} from '../core/docking.js';
import {serializeXaml} from '../core/xaml.js';
import {find} from '../core/model.js';
import {$,notify} from './ui.js';
export class EditorWorkspace {
  constructor(s){const savedLayout=localStorage.getItem('xamora-dock-layout-v1');s.editorWorkspace=this;new DensityWorkspace(s);new SolutionWorkspace(s);s.direct=new DirectAuthoring(s);s.rich=new RichProperties(s);s.resourcesWorkbench=new ResourceWorkspace(s);s.timeline=new TimelineWorkspace(s);s.viewBoard=new ViewBoard(s);s.menus=new IdeMenu(s);new HtmlWorkspace(s);new ChromeScroll(s);
    let restored=false;try{if(savedLayout&&savedLayout.includes('\"solution\"')){s.docking.model.load(savedLayout,{reconcile:true});restored=true;}}catch{}if(!restored){const layers=locatePanel(s.docking.model.state,'layers');if(layers?.group&&!layers.floating)s.docking.model.dock('solution',layers.group.id,'center');}
    const changed=s.docking.layoutChanged.bind(s.docking);s.docking.layoutChanged=label=>{changed(label);if(s.docking.refreshing)return;const visible=s.docking.control.visible,design=visible.has('document:'+s.doc.id),code=visible.has('xaml'),views=visible.has('views');const mode=views?(design||code?'custom':'views'):design?(code?'split':'design'):code?'code':'custom';s.view=mode;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===mode));};
    const oldProperty=s.propertyChanged.bind(s);s.propertyChanged=e=>{if(e.target.id==='inspector-name'&&s.selected[0]?.props['x:Key']){s.solution.renameKey(s.doc.id,s.selected[0].id,e.target.value);return;}oldProperty(e);};
    const renderCanvas=s.renderCanvas.bind(s);s.renderCanvas=()=>{s.renderer.resourceResolver=s.solution.resolve;renderCanvas();};
    const input=s.editor.input;if(input){const flush=()=>{clearTimeout(this.sourceTimer);if(this.pending)try{localStorage.setItem('xamora-pending-source',JSON.stringify(this.pending));}catch{}};const capture=()=>{this.pending={documentId:s.doc.id,text:input.value,base:serializeXaml(s.doc)};clearTimeout(this.sourceTimer);this.sourceTimer=setTimeout(flush,250);};const changed=s.editor.changed.bind(s.editor);s.editor.changed=(...args)=>{changed(...args);capture();};window.addEventListener('pagehide',flush);const apply=s.applyCode.bind(s);s.applyCode=text=>{apply(text);clearTimeout(this.sourceTimer);this.pending=null;try{localStorage.removeItem('xamora-pending-source');}catch{}};try{const pending=JSON.parse(localStorage.getItem('xamora-pending-source'));if(pending?.documentId===s.doc.id&&pending.base===serializeXaml(s.doc)&&pending.text!==pending.base){s.editor.setValue(pending.text,{force:true});s.editor.dirty=true;this.pending=pending;notify('Recovered unapplied XAML source. Apply it when ready.');}}catch{}}
    s.render();const mode=localStorage.getItem('xamora-document-mode');if(!restored&&['design','code','split','views'].includes(mode)&&!s.editor.dirty)s.docking.setView(mode);else s.docking.layoutChanged('Restore document mode');s.save();
    const command=s.command.bind(s);s.command=(action,e)=>{s.direct.cancelGesture?.();if(action==='path-edit-mode'){s.direct.pathEnabled=!s.direct.pathEnabled;s.drawSelection();return;}return command(action,e);};
  }
}
