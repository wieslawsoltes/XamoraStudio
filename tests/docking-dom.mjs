/** Deterministic docking DOM fixture. No browser, CSS layout or pointer geometry qualification. */
import {FakeElement} from './dom-fixture.mjs';
let doc;
const parts=s=>s.trim().split(/\s+(?![^[]*\])/);
export class DockElement extends FakeElement {
  constructor(tag='div'){super(tag);this.hidden=false;this.clientWidth=1000;this.clientHeight=650;this.scrollTop=0;this.scrollLeft=0;}
  append(...nodes){for(const node of nodes){if(node.parentElement)node.remove();node.parentElement=this;this.children.push(node);}}
  appendChild(node){this.append(node);return node;}
  insertBefore(node,before){node.remove();node.parentElement=this;const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,node);return node;}
  replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...nodes);}
  remove(){if(this.parentElement){const p=this.parentElement;p.children=p.children.filter(n=>n!==this);this.parentElement=null;}}
  contains(node){return node===this||this.children.some(c=>c.contains?.(node));}
  get childNodes(){return this.children;}
  get isConnected(){return doc.body.contains(this);}
  get parentNode(){return this.parentElement;}
  set textContent(value){this.replaceChildren();this._text=String(value??'');}
  get textContent(){return this._text+this.children.map(n=>n.textContent||'').join('');}
  set innerHTML(value){this.replaceChildren();this._html=String(value);}
  get innerHTML(){return this._html||super.innerHTML;}
  getAttribute(key){if(key==='id')return this.id||null;if(key==='class')return this.className;if(key==='hidden')return this.hidden?'':null;if(key==='tabindex')return this.tabIndex===undefined?null:String(this.tabIndex);if(key.startsWith('data-'))return this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]??null;return super.getAttribute(key);}
  setAttribute(key,value){super.setAttribute(key,value);if(key==='id')this.id=String(value);if(key==='tabindex')this.tabIndex=Number(value);}
  matches(selectors){return selectors.split(/,(?![^[]*\])/).some(selector=>{selector=selector.trim();if(!selector)return false;const tokens=parts(selector);if(tokens.length>1){const last=tokens.pop();if(!this.matches(last))return false;let n=this.parentElement;const parent=tokens.join(' ');while(n){if(n.matches(parent))return true;n=n.parentElement;}return false;}const not=[...selector.matchAll(/:not\(([^)]+)\)/g)];for(const m of not)if(this.matches(m[1]))return false;selector=selector.replace(/:not\([^)]+\)/g,'');const attrs=[...selector.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']*)["']?)?\]/g)];for(const [,name,value] of attrs){const actual=this.getAttribute(name);if(value===undefined?actual===null:actual!==value)return false;}selector=selector.replace(/\[[^\]]+\]/g,'');const id=selector.match(/#([\w:-]+)/)?.[1];if(id&&this.id!==id)return false;for(const [,cls] of selector.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(cls))return false;const tag=selector.match(/^[a-z][\w-]*/i)?.[0];return !tag||this.tagName.toLowerCase()===tag.toLowerCase();});}
  querySelectorAll(selector){const out=[];const visit=node=>{for(const child of node.children){if(child.matches?.(selector))out.push(child);visit(child);}};visit(this);return out;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  focus(){doc.activeElement=this;}
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  removeEventListener(name,listener){this.listeners[name]=(this.listeners[name]||[]).filter(fn=>fn!==listener);}
  getBoundingClientRect(){return {left:0,top:0,x:0,y:0,width:this.clientWidth,height:this.clientHeight,right:this.clientWidth,bottom:this.clientHeight};}
  get offsetWidth(){return this.clientWidth;}get offsetHeight(){return this.clientHeight;}
}
export function installDockDOM(){
 const listeners={},frames=new Map();let frame=0;
 doc={createElement:tag=>new DockElement(tag),createElementNS:(ns,tag)=>new DockElement(tag),createTextNode:text=>{const n=new DockElement('text');n.textContent=text;return n;},activeElement:null,addEventListener(name,fn){(listeners[name]??=[]).push(fn);},removeEventListener(name,fn){listeners[name]=(listeners[name]||[]).filter(f=>f!==fn);},querySelector(s){return this.body.matches(s)?this.body:this.body.querySelector(s);},querySelectorAll(s){return this.body.querySelectorAll(s);},getElementById(id){return this.querySelector('#'+id);},elementFromPoint(){return this.hit||this.body;}};doc.body=new DockElement('body');doc.activeElement=doc.body;const toast=new DockElement();toast.id='toast';doc.body.append(toast);
 globalThis.document=doc;globalThis.Element=globalThis.HTMLElement=DockElement;globalThis.window={innerWidth:1440,innerHeight:900,xamora:{},addEventListener(){},removeEventListener(){}};globalThis.ResizeObserver=class {constructor(callback){this.callback=callback;}observe(){}disconnect(){}};globalThis.requestAnimationFrame=callback=>{frames.set(++frame,callback);return frame;};globalThis.cancelAnimationFrame=id=>frames.delete(id);const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
 return {document:doc,frames,storage,element(tag='div',id,cls){const n=new DockElement(tag);if(id)n.id=id;if(cls)n.className=cls;return n;},emit(name,event){for(const fn of listeners[name]||[])fn({type:name,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){},...event});}};
}
