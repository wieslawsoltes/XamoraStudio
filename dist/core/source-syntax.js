/** Concrete markup syntax: every source byte stays owned by its original range. */
import {HTML_RAW,HTML_VOID} from './html.js';
import {SourceTextBuffer} from './source-text-buffer.js';

export class SourceSyntaxError extends Error {
  constructor(message,source,start){super(message);this.name='SourceSyntaxError';this.start=start;this.line=source.slice(0,start).split('\n').length;this.column=start-source.lastIndexOf('\n',start-1);}
}
const optionalEnd=new Set('html head body p li dt dd rt rp optgroup option colgroup thead tbody tfoot tr td th'.split(' '));
const pCloses=new Set('address article aside blockquote div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre section table ul'.split(' '));
const shouldClose=(old,next)=>old==='p'&&pCloses.has(next)||old==='li'&&next==='li'||['dt','dd'].includes(old)&&['dt','dd'].includes(next)||['td','th'].includes(old)&&['td','th','tr'].includes(next)||old==='tr'&&next==='tr'||old==='option'&&['option','optgroup'].includes(next)||old==='head'&&next==='body';
/** Lexes XML and HTML without evaluating scripts, resources or bindings. */
export function scanSource(source,{html=false}={}){
 const holder={kind:'document',start:0,end:source.length,children:[]},stack=[holder],tokens=[];
 const append=t=>{t.parent=stack.at(-1);t.parent.children.push(t);tokens.push(t);return t;};
 const fail=(message,start)=>{throw new SourceSyntaxError(message,source,start);};
 let i=source.charCodeAt(0)===0xFEFF?1:0;
 while(i<source.length){
  const parent=stack.at(-1);
  if(html&&parent.kind==='element'&&(HTML_RAW.has(parent.type)||['textarea','title'].includes(parent.type))){
   const close=new RegExp('</'+parent.type+'(?=[\\s/>])','ig');close.lastIndex=i;const match=close.exec(source);const end=match?match.index:source.length;
   if(end>i)append({kind:'text',start:i,end,raw:HTML_RAW.has(parent.type)});i=end;
   if(!match){parent.closeStart=parent.end=end;stack.pop();continue;}
  }
  if(i>=source.length)break;
  if(source.startsWith('<!--',i)){const end=source.indexOf('-->',i+4);if(end<0)fail('Unclosed comment.',i);append({kind:'comment',start:i,end:end+3});i=end+3;continue;}
  if(source.startsWith('<![CDATA[',i)){const end=source.indexOf(']]>',i+9);if(end<0)fail('Unclosed CDATA.',i);append({kind:'cdata',start:i,end:end+3});i=end+3;continue;}
  if(source.startsWith('<?',i)){const end=source.indexOf('?>',i+2);if(end<0)fail('Unclosed processing instruction.',i);append({kind:'pi',start:i,end:end+2});i=end+2;continue;}
  if(/^<!doctype\b/i.test(source.slice(i))){let p=i+2,quote='';for(;p<source.length;p++){const c=source[p];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}if(p===source.length)fail('Unclosed document type.',i);append({kind:'doctype',start:i,end:p+1});i=p+1;continue;}
  if(source.startsWith('</',i)){
   const m=source.slice(i).match(/^<\/\s*([A-Za-z_][\w:.-]*)\s*>/);if(!m)fail('Incomplete closing tag.',i);const name=html?m[1].toLowerCase():m[1];let at=stack.length-1;while(at>0&&stack[at].type!==name)at--;
   if(at>0){while(stack.length-1>at){const n=stack.pop();n.closeStart=n.end=i;}const n=stack.pop();n.closeStart=i;n.end=i+m[0].length;n.closeNameStart=i+m[0].indexOf(m[1]);n.closeNameEnd=n.closeNameStart+m[1].length;}
   else if(!html)fail('Unexpected closing tag.',i);
   i+=m[0].length;continue;
  }
  const match=source.slice(i).match(/^<([A-Za-z_][\w:.-]*)/);
  if(!match){
   if(source[i]==='<'&&(!html||i===source.length-1||/^<[!/]/.test(source.slice(i))))fail('Incomplete opening tag.',i);
   let end=source.indexOf('<',i+1);if(end<0)end=source.length;append({kind:'text',start:i,end});i=end;continue;
  }
  const start=i,type=html?match[1].toLowerCase():match[1];
  if(html)while(stack.length>1&&shouldClose(stack.at(-1).type,type)){const old=stack.pop();old.closeStart=old.end=i;}
  const n=append({kind:'element',type,start,nameStart:i+1,nameEnd:i+1+match[1].length,attrs:[],children:[]});i+=match[0].length;
  let complete=false;
  while(i<source.length){
   const fullStart=i;while(/\s/.test(source[i]||'')&&i<source.length)i++;
   if(source[i]==='>'){i++;complete=true;break;}
   if(source.startsWith('/>',i)){i+=2;n.selfClosing=true;complete=true;break;}
   const attr=source.slice(i).match(html?/^[^\s\x00"'<>/=]+/:/^[A-Za-z_][\w.:-]*/);if(!attr)fail('Incomplete attribute.',i);
   const a={name:html?attr[0].toLowerCase():attr[0],fullStart,start:i,nameEnd:i+attr[0].length};i+=attr[0].length;while(i<source.length&&/\s/.test(source[i]))i++;
   if(source[i]==='='){
    i++;while(i<source.length&&/\s/.test(source[i]))i++;
    if(source[i]==='"'||source[i]==="'"){a.quote=source[i++];a.valueStart=i;const end=source.indexOf(a.quote,i);if(end<0)fail('Unclosed '+a.name+' attribute.',a.start);a.valueEnd=end;i=end+1;}
    else {if(!html)fail('Expected a quoted attribute.',i);a.valueStart=i;while(i<source.length&&!/[\s>]/.test(source[i]))i++;if(i===a.valueStart)fail('Missing attribute value.',i);a.valueEnd=i;}
   }
   a.end=i;n.attrs.push(a);
  }
  if(!complete)fail('Unclosed opening tag.',start);
  n.openEnd=i;n.closeStart=n.end=i;n.void=html&&HTML_VOID.has(type);
  if(!n.void&&!(n.selfClosing&&(!html||stack.some(p=>['svg','math'].includes(p.type)))))stack.push(n);
 }
 while(stack.length>1){const n=stack.pop();if(!html)fail('Unclosed <'+n.type+'>.',source.length);n.closeStart=n.end=source.length;n.omittedEnd=optionalEnd.has(n.type);}
 return {source,html,root:holder,tokens};
}

const sameType=(n,t)=>n.kind===t.kind&&(n.kind!=='element'||n.type.toLowerCase()===t.type.toLowerCase());
/** Maps semantic IDs onto concrete tokens, allowing browser-inserted HTML wrappers. */
export function buildSourceIndex(source,doc,syntax=scanSource(source,{html:doc.framework==='HTML'})){
 const byId=new Map(),tokenById=new Map(),parentIds=new Map(),claimed=new Set(),elementQueues=new Map();
 for(const t of syntax.tokens)if(t.kind==='element'){const k=t.type.toLowerCase();if(!elementQueues.has(k))elementQueues.set(k,[]);elementQueues.get(k).push(t);}
 const all=[];const visit=(n,parent)=>{all.push(n);if(parent)parentIds.set(n.id,parent.id);for(const c of n.children||[])visit(c,n);};for(const n of doc.preamble||[])visit(n);visit(doc.root);for(const n of doc.postamble||[])visit(n);
 // XML semantic order matches lexical order. Never trust legacy node.source hints:
 // canonical session ranges can move while those import-time hints stay unchanged.
 // HTML's normalized tree is paired in source order and contextual edits are guarded.
 for(const n of all)if(n.kind==='element'){
  const q=elementQueues.get(n.type.toLowerCase())||[];while(q.length&&claimed.has(q[0]))q.shift();const t=q.shift();
  if(t){claimed.add(t);byId.set(n.id,{...t,nodeId:n.id});tokenById.set(n.id,t);}
 }
 const mapChildren=(n,parentToken)=>{
  const token=byId.get(n.id),container=token||parentToken||syntax.root;
  if(n.kind!=='element'&&!token){
   let candidates=container.children.filter(t=>!claimed.has(t)&&sameType(n,t));
   if(!candidates.length)candidates=syntax.tokens.filter(t=>!claimed.has(t)&&sameType(n,t));
   const exact=candidates.find(t=>tokenText(source,t,syntax.html)===n.text);
   const chosen=exact||candidates.find(t=>!(n.kind==='text'&&source.slice(t.start,t.end).trim()===''&&n.text.trim()!==''));
   if(chosen){claimed.add(chosen);byId.set(n.id,{...chosen,nodeId:n.id});tokenById.set(n.id,chosen);}
  }
  for(const child of n.children||[])mapChildren(child,container);
  if(n.kind==='element'&&!token){const spans=(n.children||[]).map(c=>byId.get(c.id)).filter(Boolean);const start=spans.length?Math.min(...spans.map(t=>t.start)):0,end=spans.length?Math.max(...spans.map(t=>t.end)):start;byId.set(n.id,{kind:'element',type:n.type,nodeId:n.id,start,end,openEnd:start,closeStart:end,attrs:[],children:[],synthetic:true});}
 };
 for(const n of doc.preamble||[])mapChildren(n,syntax.root);mapChildren(doc.root,syntax.root);for(const n of doc.postamble||[])mapChildren(n,syntax.root);
 const spans=[...byId.values()].sort((a,b)=>a.start-b.start||b.end-a.end);
 const textBuffer=new SourceTextBuffer(source),position=offset=>textBuffer.positionAt(offset);
 for(const span of spans){Object.assign(span,position(span.start));delete span.parent;}
 return {source,byId,tokenById,parentIds,nodeById:new Map(all.map(n=>[n.id,n])),spans,syntax,position,textBuffer};
}

/** Shift cached token ranges after a validated edit wholly inside one lexical token.
 * No unchanged text is lexed. Token identities and tree links are reused; numeric
 * offsets after the edit are adjusted in O(token count). Call only after commit.
 */
export function updateSourceIndex(index,edit,{nodeId,attributeName}={}){
 const token=index.tokenById.get(nodeId);if(!token)throw Error('The edited token is not indexed.');
 const delta=edit.text.length-(edit.end-edit.start),ancestors=new Set();for(let n=token;n;n=n.parent)ancestors.add(n);
 const point=(value,left=false)=>{if(value===undefined)return value;if(value<edit.start)return value;if(value>edit.end||value===edit.end&&edit.end>edit.start)return value+delta;if(value===edit.start&&left)return value;return edit.start+(left?0:edit.text.length);};
 for(const t of index.syntax.tokens){const contained=ancestors.has(t);t.start=point(t.start,contained);t.end=point(t.end);for(const key of ['nameStart','nameEnd','openEnd'])if(t[key]!==undefined)t[key]=point(t[key],true);for(const key of ['closeStart','closeNameStart','closeNameEnd'])if(t[key]!==undefined)t[key]=point(t[key]);
  for(const a of t.attrs||[]){const active=t===token&&a.name===attributeName;for(const key of ['fullStart','start','nameEnd','end','valueStart','valueEnd'])if(a[key]!==undefined)a[key]=point(a[key],active&&key==='valueStart');}
 }
 index.syntax.root.end+=delta;
 const result=index.textBuffer.applyEdits([edit]);if(!result.accepted)throw Error(result.reason||'Invalid indexed source edit.');index.source=index.textBuffer.text;index.syntax.source=index.source;
 for(const [id,span] of index.byId){const raw=index.tokenById.get(id);if(raw){Object.assign(span,raw);delete span.parent;}}
 // Browser-inserted wrappers have no lexical token; derive their extent from children.
 for(const node of [...index.nodeById.values()].reverse()){const span=index.byId.get(node.id);if(!span?.synthetic)continue;const children=(node.children||[]).map(c=>index.byId.get(c.id)).filter(Boolean);if(children.length){span.start=Math.min(...children.map(c=>c.start));span.end=Math.max(...children.map(c=>c.end));span.openEnd=span.start;span.closeStart=span.end;}}
 for(const span of index.spans)Object.assign(span,index.position(span.start));
 return index;
}
function tokenText(source,t,html){const raw=source.slice(t.start,t.end);if(t.kind==='comment')return raw.slice(4,-3);if(t.kind==='cdata')return raw.slice(9,-3);if(t.kind==='pi')return raw.slice(2,-2);if(t.raw)return raw;if(t.kind!=='text')return '';
 return raw.replace(/\r\n?/g,'\n').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(raw,key)=>{if(key[0]==='#'){const cp=parseInt(key.slice(key[1].toLowerCase()==='x'?2:1),key[1].toLowerCase()==='x'?16:10);return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):raw;}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'}[key]||raw;});
}
