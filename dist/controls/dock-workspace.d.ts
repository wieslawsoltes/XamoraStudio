import {DockLayout} from '../core/docking.js';
export interface DockWorkspaceOptions { beforeActivate?:(id:string)=>boolean|void; onChange?:(label:string)=>void; onVisibility?:(id:string,visible:boolean)=>void }
export declare class DockWorkspace extends EventTarget {
  constructor(host:HTMLElement,model:DockLayout,options?:DockWorkspaceOptions);
  host:HTMLElement; model:DockLayout; contents:Map<string,HTMLElement>; visible:Set<string>; flyout:string|null;
  mount(id:string,node:HTMLElement):HTMLElement; render():void;
  activate(id:string,options?:{focus?:boolean}):boolean; show(id:string):boolean; hide(id:string):boolean;
  focus(id:string):void; title(id:string):string; closeFlyout():void; closeMenu():void; dispose():void;
}
