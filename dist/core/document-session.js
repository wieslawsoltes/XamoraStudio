/** Atomic source/model editing session. Framework adapters never execute markup. */
import {clone,find,walk,validateDocument} from './model.js';
import {parseXaml,serializeXaml,serializeNode,escapeXML} from './xaml.js';
import {parseHtml,serializeHtml,serializeHtmlNode,canonicalHtml,HTML_RAW} from './html.js';
import {scanSource,buildSourceIndex} from './source-syntax.js';

export const sourceAdapters={
 XAML:{parse:parseXaml,serialize:serializeXaml,serializeNode:(n)=>serializeNode(n,0,{lineWidth:Infinity})},
 HTML:{parse:parseHtml,serialize:serializeHtml,serializeNode:serializeHtmlNode}
};
const shape=n=>n.kind==='element'?['element',n.type,Object.entries(n.props||{}).sort(([a],[b])=>a.localeCompare(b)),(n.children||[]).map(shape)]:[n.kind,n.text];
const documentShape=doc=>JSON.stringify([doc.framework,(doc.preamble||[]).map(shape),shape(doc.root),(doc.postamble||[]).map(shape),doc.framework==='HTML'?doc.metadata?.html?.doctype||'':null]);
const sameNode=(a,b)=>!!a&&JSON.stringify(shape(a))===JSON.stringify(shape(b));
const nodes=doc=>{const out=[];for(const n of doc.preamble||[])walk(n,v=>out.push(v));walk(doc.root,v=>out.push(v));for(const n of doc.postamble||[])walk(n,v=>out.push(v));return out;};
const nodeKey=n=>n.kind==='element'?(n.props.id?'id:'+n.props.id:n.props['x:Name']?'name:'+n.props['x:Name']:n.props.Name?'name:'+n.props.Name:n.props['x:Key']?'resource:'+n.props['x:Key']:null):null;
const compatible=(a,b)=>a?.kind===b?.kind&&(a.kind!=='element'||a.type===b.type);
/** Preserve identities through edits and moves. Duplicate names never become global keys. */
export function reconcileDocumentIds(previous,next){
 const old=nodes(previous),fresh=nodes(next),used=new Set(),matched=new Map();
 const assign=(a,b)=>{if(!a||!b||used.has(a.id)||matched.has(b)||!compatible(a,b))return false;b.id=a.id;used.add(a.id);matched.set(b,a);return true;};
 const group=(list,key)=>{const map=new Map();for(const n of list){const k=key(n);if(!k)continue;if(!map.has(k))map.set(k,[]);map.get(k).push(n);}return map;};
 assign(previous.root,next.root);
 const aKeys=group(old,n=>nodeKey(n)),bKeys=group(fresh,n=>nodeKey(n));
 for(const [key,list] of bKeys)if(list.length===1&&aKeys.get(key)?.length===1)assign(aKeys.get(key)[0],list[0]);
 // Unique complete subtrees retain identity when unkeyed elements move or reorder.
 const signatures=new WeakMap();const signature=n=>{if(!signatures.has(n))signatures.set(n,JSON.stringify(shape(n)));return signatures.get(n);};
 const aExact=group(old,signature),bExact=group(fresh,signature);
 for(const [key,list] of bExact)if(list.length===1&&aExact.get(key)?.length===1)assign(aExact.get(key)[0],list[0]);
 const visited=new WeakSet();const reconcileSiblings=(a,b)=>{
  if(visited.has(b))return;visited.add(b);
  const aa=a.children||[],bb=b.children||[];
  const exact=group(aa.filter(n=>!used.has(n.id)),signature);
  for(const n of bb)if(!matched.has(n)){const q=exact.get(signature(n));while(q?.length&&used.has(q[0].id))q.shift();if(q?.length)assign(q.shift(),n);}
  // Scope-local keyed matching protects templates with repeated x:Name values.
  const scoped=group(aa.filter(n=>!used.has(n.id)),nodeKey);
  for(const n of bb)if(!matched.has(n)&&nodeKey(n)){const q=scoped.get(nodeKey(n));if(q?.length===1)assign(q[0],n);}
  const remaining=group(aa.filter(n=>!used.has(n.id)),n=>n.kind+':'+(n.type||''));
  for(const n of bb)if(!matched.has(n)){const q=remaining.get(n.kind+':'+(n.type||''));while(q?.length&&used.has(q[0].id))q.shift();if(q?.length)assign(q.shift(),n);}
  for(const n of bb){const oldNode=matched.get(n);if(oldNode)reconcileSiblings(oldNode,n);}
 };
 reconcileSiblings(previous.root,next.root);
 reconcileSiblings({children:previous.preamble||[]},{children:next.preamble||[]});reconcileSiblings({children:previous.postamble||[]},{children:next.postamble||[]});
 // A globally matched moved container still needs to reconcile edited descendants.
 for(const n of fresh)if(matched.has(n))reconcileSiblings(matched.get(n),n);
 return next;
}

const escapeAttr=(value,quote,html)=>{let out=String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;');out=out.replace(quote==="'"?/'/g:/"/g,quote==="'"?'&apos;':'&quot;');return html?out:out.replace(/\t/g,'&#9;').replace(/\r/g,'&#13;').replace(/\n/g,'&#10;');};
function replaceRanges(source,edits,start=0,end=source.length){let text='',cursor=start;for(const e of edits.sort((a,b)=>a.start-b.start||a.end-b.end)){if(e.start<cursor||e.end>end)throw Error('Overlapping source edits.');text+=source.slice(cursor,e.start)+e.text;cursor=e.end;}return text+source.slice(cursor,end);}

/** Patch concrete source while reusing untouched attributes, comments and moved subtrees. */
export function patchDocumentSource(source,before,after,{adapter=sourceAdapters[after.framework==='HTML'?'HTML':'XAML'],index=buildSourceIndex(source,before)}={}){
 if(documentShape(before)===documentShape(after))return source;
 const html=after.framework==='HTML',oldById=new Map(nodes(before).map(n=>[n.id,n]));
 const render=(n,parentType='')=>{
  const old=oldById.get(n.id),span=index.byId.get(n.id);
  if(old&&span&&sameNode(old,n))return source.slice(span.start,span.end);
  if(!old||!span)return adapter.serializeNode?adapter.serializeNode(n,parentType):html?serializeHtmlNode(n,parentType):serializeNode(n,0,{lineWidth:Infinity});
  if(n.kind!=='element'){
   if(n.kind==='text')return html&&HTML_RAW.has(parentType)?n.text:html?String(n.text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):escapeXML(n.text);
   return html?serializeHtmlNode(n,parentType):serializeNode(n,0,{lineWidth:Infinity});
  }
  if(old.kind!=='element')return html?serializeHtmlNode(n,parentType):serializeNode(n,0,{lineWidth:Infinity});
  if(span.synthetic){
   if(n.type!==old.type||JSON.stringify(n.props)!==JSON.stringify(old.props))return html?serializeHtmlNode(n,parentType):serializeNode(n,0,{lineWidth:Infinity});
   return renderChildren(old,n,span.start,span.end);
  }
  const edits=[];
  if(n.type!==old.type)edits.push({start:span.nameStart,end:span.nameEnd,text:n.type});
  const seen=new Set();
  for(const a of span.attrs){seen.add(a.name);if(!Object.hasOwn(n.props,a.name)){edits.push({start:a.fullStart,end:a.end,text:''});continue;}
   if(String(old.props[a.name])===String(n.props[a.name]))continue;
   if(a.valueStart!==undefined&&a.quote)edits.push({start:a.valueStart,end:a.valueEnd,text:escapeAttr(n.props[a.name],a.quote,html)});
   else edits.push({start:a.start,end:a.end,text:a.name+'="'+escapeAttr(n.props[a.name],'"',html)+'"'});
  }
  const additions=Object.keys(n.props).filter(k=>!seen.has(k)).map(k=>' '+k+'="'+escapeAttr(n.props[k],'"',html)+'"').join('');
  const rawOpening=source.slice(span.start,span.openEnd);const suffix=rawOpening.match(/\s*\/?\s*>$/)?.[0]||'>';const insertion=span.openEnd-suffix.length;
  if(additions)edits.push({start:insertion,end:insertion,text:additions});
  let opening=replaceRanges(source,edits,span.start,span.openEnd);
  if(!n.children.length){
   if(span.selfClosing||span.void)return opening;
   return opening+closing(n,span);
  }
  if(span.void)throw Error('Void HTML elements cannot contain children.');
  if(span.selfClosing)opening=opening.replace(/\/\s*>$/,'>');
  return opening+renderChildren(old,n,span.openEnd,span.closeStart)+(span.selfClosing?'</'+n.type+'>':closing(n,span));
 };
 const closing=(n,span)=>{const raw=source.slice(span.closeStart,span.end);if(span.closeNameStart!==undefined&&n.type!==oldById.get(n.id)?.type)return replaceRanges(source,[{start:span.closeNameStart,end:span.closeNameEnd,text:n.type}],span.closeStart,span.end);return raw;};
 const renderChildren=(old,n,start,end)=>{
  const aa=old.children||[],bb=n.children||[],oldOrder=aa.map(c=>c.id).join('|'),newOrder=bb.map(c=>c.id).join('|');
  if(oldOrder===newOrder){const edits=[];for(const c of bb){const span=index.byId.get(c.id);if(span&&span.start>=start&&span.end<=end){if(!sameNode(oldById.get(c.id),c))edits.push({start:span.start,end:span.end,text:render(c,n.type)});}else if(!sameNode(oldById.get(c.id),c))throw Error('This browser-repaired node has no unambiguous source range. Edit its code to make its container explicit.');}return replaceRanges(source,edits,start,end);}
  const spans=aa.map(c=>index.byId.get(c.id)).filter(s=>s&&s.start>=start&&s.end<=end).sort((a,b)=>a.start-b.start);
  if(spans.length!==aa.length)throw Error('This browser-repaired container has ambiguous source ranges. Make its HTML tags explicit before restructuring it.');
  const leading=new Map();let cursor=start;for(const s of spans){leading.set(s.nodeId,source.slice(cursor,s.start));cursor=s.end;}
  const trailing=source.slice(cursor,end);const separators=spans.map(s=>leading.get(s.nodeId)).filter(s=>/^\s*$/.test(s)&&s.includes('\n'));
  if(!html&&!aa.length&&bb.length&&bb.every(c=>!['text','cdata'].includes(c.kind))&&!trailing){const parentSpan=index.byId.get(n.id),at=parentSpan?.start??start,lineStart=source.lastIndexOf('\n',at-1)+1,pad=source.slice(lineStart,at).match(/^\s*/)?.[0]||'',unit=source.match(/\n([ \t]+)<[^/]/)?.[1]||'    ',eol=source.includes('\r\n')?'\r\n':'\n';return eol+bb.map(c=>pad+unit+render(c,n.type)).join(eol)+eol+pad;}
  const separator=html?'':separators[0]||((source.slice(start,end).includes('\n'))?'\n    ':'');
  return bb.map((c,i)=>(leading.has(c.id)?leading.get(c.id):separator)+render(c,n.type)).join('')+trailing;
 };
 const oldTop=[...(before.preamble||[]),before.root,...(before.postamble||[])],newTop=[...(after.preamble||[]),after.root,...(after.postamble||[])];
 if(oldTop.map(n=>n.id).join('|')!==newTop.map(n=>n.id).join('|'))return renderChildren({children:oldTop},{children:newTop},0,source.length);
 const edits=[];for(const n of newTop){const span=index.byId.get(n.id);if(!span){if(!sameNode(oldById.get(n.id),n))throw Error('The changed node has no source range.');continue;}if(!sameNode(oldById.get(n.id),n))edits.push({start:span.start,end:span.end,text:render(n)});}
 if(html&&before.metadata?.html?.doctype!==after.metadata?.html?.doctype){const token=index.syntax.tokens.find(t=>t.kind==='doctype');edits.push({start:token?.start||0,end:token?.end||0,text:after.metadata?.html?.doctype||''});}
 return replaceRanges(source,edits);
}

export class DocumentSession extends EventTarget {
 constructor(store,{source,adapters={}}={}){
  super();if(!store?.addCommitHook)throw Error('DocumentSession requires a DocumentStore with atomic commit hooks.');this.store=store;this.adapters={...sourceAdapters,...adapters};this.origin='visual';this._applying=false;this._lastShape='';
  const existing=store.document.metadata?.source;
  if(source!==undefined&&!existing){store.document.metadata??={};store.document.metadata.source={version:1,language:this.language,text:String(source),validText:String(source),diagnostics:[]};}
  this.refresh({emit:false});
  this._removeHook=store.addCommitHook(change=>this._beforeCommit(change));
  this._onStoreChange=()=>{this.refresh({emit:false});this._emit();};store.addEventListener('change',this._onStoreChange);
 }
 get language(){return this.store.document.framework==='HTML'?'HTML':'XAML';}
 get adapter(){return this.adapters[this.store.document.framework]||this.adapters[this.language];}
 get source(){return this.store.document.metadata?.source?.text??'';}
 get validSource(){return this.store.document.metadata?.source?.validText??this.source;}
 get isValid(){return !(this.store.document.metadata?.source?.diagnostics||[]).some(d=>d.severity==='error');}
 get diagnostics(){return clone(this.store.document.metadata?.source?.diagnostics||[]);}
 get revision(){return this.store.revision;}
 _parse(source){if(typeof source!=='string'||source.length>2_000_000)throw Error('Source must be text smaller than 2 MB.');const syntax=scanSource(source,{html:this.language==='HTML'});const doc=this.adapter.parse(source,{name:this.store.document.name,framework:this.store.document.framework});validateDocument(doc);return {doc,syntax};}
 _record(doc,text,validText,diagnostics=[]){doc.metadata??={};doc.metadata.source={version:1,language:doc.framework==='HTML'?'HTML':'XAML',text,validText,diagnostics};if(doc.framework==='HTML'){doc.metadata.html??={};doc.metadata.html.originalSource=validText;doc.metadata.html.originalMarkup=canonicalHtml(doc);}}
 _diagnostic(error,text){const line=error.line||1,column=error.column||1;let start=error.start;if(start===undefined){start=0;for(let l=1;l<line;l++){const p=text.indexOf('\n',start);start=p<0?text.length:p+1;}start=Math.min(text.length,start+column-1);}return {severity:'error',message:error.message,line,column,start,end:Math.min(text.length,start+1)};}
 _emit(){const event=new Event('change');event.detail={origin:this.origin,revision:this.revision,source:this.source,valid:this.isValid,diagnostics:this.diagnostics};this.dispatchEvent(event);this.origin='visual';}
 _beforeCommit({before,document:after}){
  if(this._applying)return;
  const changed=documentShape(before)!==documentShape(after);
  if(!changed)return;
  if((before.metadata?.source?.diagnostics||[]).some(d=>d.severity==='error'))throw Error('Fix the source errors or discard the source draft before editing the design. Your draft has been preserved.');
  // Literal root dimensions drive the artboard across property panels and gestures.
  // An explicit artboard adjustment in the same transaction takes precedence.
  if(after.framework!=='HTML')for(const [property,dimension] of [['Width','width'],['Height','height']]){const value=after.root.props[property];if(value!==before.root.props[property]&&after.design[dimension]===before.design[dimension]&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>0)after.design[dimension]=Number(value);}
  const oldSource=before.metadata?.source?.validText||this.adapter.serialize(before);
  let index=this.index;if(index?.source!==oldSource){const parsedOld=this._parse(oldSource).doc;reconcileDocumentIds(before,parsedOld);index=buildSourceIndex(oldSource,parsedOld);}
  const text=patchDocumentSource(oldSource,before,after,{adapter:this.adapter,index});
  const parsed=this._parse(text);if(documentShape(parsed.doc)!==documentShape(after))throw Error('This visual edit would change additional markup during parsing. Make the affected source container explicit before editing it.');
  this._record(after,text,text);this._pendingParsed={source:text,...parsed,document:after};this.origin='visual';
 }
 updateSource(text,{origin='code',expectedRevision}={}){
  text=String(text);
  if(expectedRevision!==undefined&&expectedRevision!==this.revision)return {accepted:false,valid:this.isValid,revision:this.revision,diagnostics:[{severity:'error',code:'revision-conflict',message:'The document changed since this source edit was created.'}]};
  if(text===this.source)return {accepted:true,valid:this.isValid,revision:this.revision,diagnostics:this.diagnostics};
  let parsed,errors=[];try{parsed=this._parse(text);}catch(error){errors=[this._diagnostic(error,text)];}
  this.origin=origin;this._applying=true;
  try{this.store.transaction(errors.length?'Edit source draft':'Edit '+this.language+' source',doc=>{
   if(parsed){reconcileDocumentIds(doc,parsed.doc);if(this.language==='XAML')for(const [property,dimension] of [['Width','width'],['Height','height']]){const value=parsed.doc.root.props[property];if(value!==doc.root.props[property]&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>0)doc.design[dimension]=Number(value);}doc.root=parsed.doc.root;doc.preamble=parsed.doc.preamble||[];doc.postamble=parsed.doc.postamble||[];if(this.language==='HTML')doc.metadata.html={...doc.metadata.html,...parsed.doc.metadata.html};this._record(doc,text,text);this._pendingParsed={source:text,...parsed,document:doc};}
   else this._record(doc,text,this.validSource,errors);
  });}finally{this._applying=false;}
  return {accepted:true,valid:!errors.length,revision:this.revision,diagnostics:this.diagnostics};
 }
 discardDraft(){if(this.isValid)return false;const text=this.validSource;return this.updateSource(text,{origin:'discard'}).valid;}
 serialize({draft=false}={}){return draft?this.source:this.validSource;}
 sourceAtNode(id){const span=this.index?.byId.get(id);if(!span)return null;const {children,...copy}=span;return copy;}
 nodeAtOffset(offset){if(!Number.isFinite(offset))return null;let best;for(const span of this.index?.spans||[])if(!span.synthetic&&span.start<=offset&&offset<span.end&&(!best||span.end-span.start<best.end-best.start))best=span;return best?find(this.store.document.root,best.nodeId)||nodes(this.store.document).find(n=>n.id===best.nodeId)||null:null;}
 undo(){this.origin='undo';this.store.undo();}
 redo(){this.origin='redo';this.store.redo();}
 /** Restore sessions after solution snapshot swaps, without creating history. */
 refresh({emit=true}={}){
  const doc=this.store.document;let saved=doc.metadata?.source,source=saved?.validText;let parsed;
  if(this._pendingParsed?.source===source&&this._pendingParsed.document===doc){parsed=this._pendingParsed;this._pendingParsed=null;}
  if(!parsed&&this.index?.source===source&&this._lastRoot===doc.root&&this._lastShape===documentShape(doc)){if(emit)this._emit();return this;}
  if(!parsed&&typeof source==='string'){try{parsed=this._parse(source);if(documentShape(parsed.doc)!==documentShape(doc))parsed=null;}catch{parsed=null;}}
  if(!parsed){source=this.adapter.serialize(doc);parsed=this._parse(source);this._record(doc,source,source);saved=doc.metadata.source;}
  reconcileDocumentIds(doc,parsed.doc);this.index=buildSourceIndex(source,parsed.doc,parsed.syntax);this._lastShape=documentShape(doc);this._lastRoot=doc.root;
  if(!saved)this._record(doc,source,source);if(emit)this._emit();return this;
 }
 dispose(){this._removeHook?.();this.store.removeEventListener('change',this._onStoreChange);}
}
