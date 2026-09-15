import {clone,walk} from './model.js';
import {serializeHtml,canonicalHtml,htmlHead} from './html.js';
import {element,textNode} from './model.js';
/** Native browser layout isolated from the studio; design and runtime use separate sandboxes. */
export class HtmlRenderer {
 constructor(){this.elements=new Map();}
 render(doc,host,{interactive=false,onReady}={}){
  this.dispose();this.elements.clear();this.document=doc;this.frame=document.createElement('iframe');const frame=this.frame;
  frame.className='html-design-frame';frame.title=interactive?'Interactive HTML preview':'HTML design surface';frame.setAttribute('sandbox',interactive?'allow-scripts':'allow-same-origin');frame.setAttribute('referrerpolicy','no-referrer');frame.style.cssText='display:block;border:0;width:100%;height:100%;background:white;color-scheme:normal';
  if(interactive)frame.srcdoc=serializeHtml(doc);
  else{const safe=clone(doc);walk(safe.root,n=>{if(n.kind!=='element')return;n.props['data-xamora-id']=n.id;delete n.props.contenteditable;for(const key of Object.keys(n.props))if(/^on/i.test(key))delete n.props[key];n.children=n.children.filter(c=>!['script','iframe','object','embed','base'].includes(c.type)&&!(c.type==='meta'&&/refresh|content-security-policy/i.test(c.props['http-equiv']||'')));});htmlHead(safe).children.unshift(element('meta',{'http-equiv':'Content-Security-Policy',content:"script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"}));htmlHead(safe).children.push(element('style',{},[textNode('* { animation-play-state: paused !important; transition: none !important; }')]));frame.srcdoc=canonicalHtml(safe);frame.onload=()=>{if(this.frame!==frame)return;const document=frame.contentDocument;if(!document)return;for(const el of document.querySelectorAll('[data-xamora-id]'))this.elements.set(el.getAttribute('data-xamora-id'),el);document.addEventListener('click',e=>e.preventDefault(),true);document.addEventListener('submit',e=>e.preventDefault(),true);this.observer=new ResizeObserver(()=>this.onLayout?.());this.observer.observe(document.documentElement);document.addEventListener('scroll',()=>this.onLayout?.(),true);onReady?.(this);this.onLayout?.();};}
  host.replaceChildren(frame);return this.elements;
 }
 getClientRect(id){const el=this.elements.get(id);if(!el||!this.frame)return null;const r=el.getBoundingClientRect(),f=this.frame.getBoundingClientRect(),sx=f.width/(this.frame.clientWidth||1),sy=f.height/(this.frame.clientHeight||1);return {left:f.left+r.left*sx,top:f.top+r.top*sy,right:f.left+r.right*sx,bottom:f.top+r.bottom*sy,width:r.width*sx,height:r.height*sy};}
 elementsAtPoint(x,y){const f=this.frame?.getBoundingClientRect();if(!f||!f.width||!f.height)return [];return (this.frame.contentDocument?.elementsFromPoint((x-f.left)*this.frame.clientWidth/f.width,(y-f.top)*this.frame.clientHeight/f.height)||[]).filter(el=>el.hasAttribute('data-xamora-id'));}
 dispose(){this.observer?.disconnect();if(this.frame)this.frame.onload=null;this.frame=null;this.elements.clear();}
}
