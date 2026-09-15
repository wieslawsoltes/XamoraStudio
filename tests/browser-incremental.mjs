/** Actual browser-parser differential tests for localized HTML source edits. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
let playwright;try{playwright=await import('playwright');}catch(error){if(!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)throw error;playwright=await import(pathToFileURL(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Incremental parser tests</title>');return;}const file=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}res.writeHead(200,{'Content-Type':'text/javascript'}).end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{browser=await playwright.chromium.launch({headless:true,args:['--disable-dev-shm-usage']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
 const report=await page.evaluate(async()=>{
  const {DocumentStore,walk}=await import('/core/model.js'),{DocumentSession}=await import('/core/document-session.js'),{parseHtml}=await import('/core/html.js'),{buildSourceIndex}=await import('/core/source-syntax.js');
  const assert=(ok,message)=>{if(!ok)throw Error(message);};const shape=n=>n.kind==='element'?['element',n.type,n.namespaceURI,Object.entries(n.props).sort(),n.children.map(shape)]:[n.kind,n.text];
  const make=source=>{const store=new DocumentStore(parseHtml(source)),session=new DocumentSession(store,{source});return {store,session};};
  const check=session=>{const parsed=parseHtml(session.source);assert(JSON.stringify(shape(parsed.root))===JSON.stringify(shape(session.store.document.root)),'HTML semantics differ from full parser: '+session.source);const fresh=buildSourceIndex(session.source,parsed),a=[],b=[];walk(session.store.document.root,n=>a.push(n));walk(parsed.root,n=>b.push(n));for(let i=0;i<a.length;i++){const x=session.sourceAtNode(a[i].id),y=fresh.byId.get(b[i].id);assert(!!x===!!y,'Missing source map');if(!x)continue;assert(x.start===y.start&&x.end===y.end&&x.line===y.line&&x.column===y.column,'Incorrect shifted HTML source span for '+(a[i].type||a[i].kind));if(x.attrs)assert(JSON.stringify(x.attrs)===JSON.stringify(y.attrs),'Incorrect shifted attribute range');}};
  const cases=[
   {name:'explicit attributes and entities',source:'<!doctype html>\n<html><head></head><body><button id="save" title="Before">Save</button></body></html>',before:'Before',after:'A &copy; &#x1f600;',mode:'incremental-attribute'},
   {name:'implicit wrappers',source:'<button id="save" title="Before">Save</button>',before:'Before',after:'Changed',mode:'incremental-attribute'},
   {name:'normal text with named entities',source:'<main><p>A &copy; B</p><button>Safe</button></main>',before:'A &copy; B',after:'Text &trade; &#169;',mode:'incremental-text'},
   {name:'optional closing tags',source:'<p id="a">First<p id="b">Second',before:'First',after:'Changed first',mode:'incremental-text'},
   {name:'raw CSS fallback',source:'<style>.a { color: red; }</style><p>Hello</p>',before:'red',after:'blue',mode:'full'},
   {name:'raw JS fallback',source:'<script>let value = 1;</script><p>Hello</p>',before:'value = 1',after:'value = 2',mode:'full'},
   {name:'textarea RCDATA fallback',source:'<textarea>Use &copy; and <b> literally</textarea>',before:'&copy;',after:'&trade;',mode:'full'},
   {name:'table contextual text fallback',source:'<table><tr><td>Cell</td></tr></table>',before:'Cell',after:'Edited cell',mode:'full'},
   {name:'foreign SVG fallback',source:'<svg><circle fill="red" r="10"/></svg>',before:'red',after:'blue',mode:'full'},
   {name:'duplicate attribute fallback',source:'<div title="first" title="second">Text</div>',before:'first',after:'changed',mode:'full'},
   {name:'ordinary style attribute',source:'<section style="color: red; padding: 20px">Text</section>',before:'red',after:'blue',mode:'incremental-attribute'},
   {name:'comments fallback',source:'<main><!-- before --><p>Stable</p></main>',before:'before',after:'after',mode:'full'}
  ];const results=[];
  for(const item of cases){const {session}=make(item.source),count=session.processingStats.fullParses;const result=session.updateSource(item.source.replace(item.before,item.after));assert(result.valid,item.name+': invalid '+JSON.stringify(result));assert(session.lastUpdate.mode===item.mode,item.name+': expected '+item.mode+' but got '+JSON.stringify(session.lastUpdate));if(item.mode.startsWith('incremental'))assert(session.processingStats.fullParses===count,item.name+': full parser was invoked');check(session);results.push({name:item.name,mode:session.lastUpdate.mode,charactersParsed:session.lastUpdate.charactersParsed});}
  const {store,session}=make('<html><head><title>Page</title></head><body>\n<div title="Start">Text &copy;</div>\n<footer>Stable</footer></body></html>');let div;walk(store.document.root,n=>{if(n.type==='div')div=n;});const id=div.id,stable=store.document.root;
  for(let i=0;i<30;i++){const range=session.sourceAtNode(id).attrs.find(a=>a.name==='title');const value=['short','Long &amp; longer','😀\nnew line',''][i%4];const result=session.applySourceEdits([{start:range.valueStart,end:range.valueEnd,text:value}],{expectedRevision:session.revision});assert(result.valid,'Repeated HTML edit invalid');assert(session.lastUpdate.mode==='incremental-attribute','Repeated HTML edit fell back');assert(store.document.root===stable,'Unchanged HTML root was recreated');check(session);}
  store.setProperty([id],'title','Panel value');assert(session.lastUpdate.mode==='incremental-attribute','HTML panel uses full parse');check(session);store.undo();check(session);store.redo();check(session);
  return {cases:results,alternatingEdits:30,panelUndoRedo:true};
 });assert.deepEqual(errors,[]);console.log(JSON.stringify(report,null,2));console.log('HTML incremental parser browser checks passed.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
