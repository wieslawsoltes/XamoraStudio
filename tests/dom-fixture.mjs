/** Minimal deterministic DOM fixture for renderer logic tests; not a browser/layout simulator. */
const encode=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
class Style {constructor(){this.cssText='';}}
class FakeClassList {constructor(node){this.node=node;this.set=new Set();}add(...names){names.forEach(n=>this.set.add(n));}remove(...names){names.forEach(n=>this.set.delete(n));}contains(n){return this.set.has(n);}toggle(n,force){const on=force??!this.set.has(n);on?this.set.add(n):this.set.delete(n);return on;}toString(){return [...this.set].join(' ');}}
export class FakeElement {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.style=new Style();this.attributes={};this.dataset={};this.children=[];this.classList=new FakeClassList(this);this._text='';this.listeners={};this.disabled=false;this.checked=false;this.selected=false;this.value='';}
  set className(v){this.classList.set=new Set(v.split(/\s+/));}get className(){return this.classList.toString();}
  set textContent(v){this._text=String(v??'');this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent||'').join('');}
  append(...nodes){for(let n of nodes){if(typeof n==='string')n={textContent:n};n.parentElement=this;this.children.push(n);}}
  replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
  setAttribute(k,v){this.attributes[k]=String(v);if(k==='disabled')this.disabled=true;}
  getAttribute(k){return this.attributes[k]??null;}
  removeAttribute(k){delete this.attributes[k];if(k.startsWith('data-'))delete this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())];}
  addEventListener(name,listener){(this.listeners[name]??=[]).push(listener);}
  dispatchEvent(e){let stopped=false;e.stopImmediatePropagation??=()=>stopped=true;e.stopPropagation??=()=>{};for(const listener of this.listeners[e.type]||[]){listener(e);if(stopped)break;}}
  matches(selector){return selector.split(',').some(s=>{s=s.trim();return s.startsWith('.')?this.classList.contains(s.slice(1)):s==='[data-node-id]'?this.dataset.nodeId!==undefined:s.startsWith('[')?Object.hasOwn(this.attributes,s.slice(1,-1)):this.tagName.toLowerCase()===s;});}
  closest(selector){let n=this;while(n){if(n.matches?.(selector))return n;n=n.parentElement;}return null;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selectors){const out=[],list=selectors.split(',').map(s=>s.trim());const matches=(n,s)=>s.startsWith('.')?n.classList?.contains(s.slice(1)):s.startsWith('[')?s==='[data-node-id]'?n.dataset?.nodeId!==undefined:Object.hasOwn(n.attributes||{},s.slice(1,-1)):n.tagName?.toLowerCase()===s;const visit=n=>{for(const c of n.children||[]){if(list.some(s=>matches(c,s)))out.push(c);visit(c);}};visit(this);return out;}
  get innerHTML(){return encode(this._text)+this.children.map(n=>n instanceof FakeElement?n.outerHTML:encode(n.textContent)).join('');}
  get outerHTML(){const props={...this.attributes};if(this.className)props.class=this.className;for(const [key,value] of Object.entries(this.dataset))props['data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())]=value;const attrs=Object.entries(props).map(([k,v])=>` ${k}="${encode(v)}"`).join('');return `<${this.tagName.toLowerCase()}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;}
}
export function installDOM(){globalThis.Element=FakeElement;globalThis.document={createElement:tag=>new FakeElement(tag),createElementNS:(namespace,tag)=>new FakeElement(tag),createTextNode:text=>({textContent:String(text)})};}
