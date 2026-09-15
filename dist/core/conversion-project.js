import {compileDocument} from './semantic-compiler.js';
import {normalizePath,resolvePath,relativePath} from './solution.js';
import {clone,walk} from './model.js';
import {serializeHtml} from './html.js';
import {serializeXaml} from './xaml.js';
import {buildSourceIndex} from './source-syntax.js';
import {patchDocumentSource} from './document-session.js';

const key=path=>path.toLowerCase();
const issue=(code,message,severity='error')=>({code,message,severity});
const language=entry=>entry.document?.framework==='HTML'||entry.framework==='HTML'||/\.html?$/i.test(entry.path)?'html':entry.document||entry.framework||/\.(xaml|axaml|xml)$/i.test(entry.path)?'xaml':null;
const folders=path=>path.split('/').slice(0,-1).map((_,i,parts)=>parts.slice(0,i+1).join('/'));
const suffixPath=(path,index)=>path.replace(/(\.[^./]+)?$/,(_,extension='')=>'.converted'+(index>1?'-'+index:'')+extension);

function relocateReferences(entries,inputs,strict){
  const relocationIssues=new Set();
  for(const entry of entries){
    if(entry.status!=='ready')continue;
    const relocated=entry.sourcePath.split('/').slice(0,-1).join('/')!==entry.targetPath.split('/').slice(0,-1).join('/');
    walk(entry.result.document.root,node=>{
      if(node.kind!=='element')return;
      if(relocated&&(node.props.srcset||Object.values(node.props).some(value=>typeof value==='string'&&/url\s*\(/i.test(value))||['style','script'].includes(node.type)&&node.children.some(child=>child.kind==='text'&&(/url\s*\(|@import\b|\bimport\b|\bfetch\s*\(|\.src\b|\.href\b/.test(child.text)))||['href','src','poster','action','Source','NavigateUri'].some(property=>/[{}]/.test(String(node.props[property]||'')))))relocationIssues.add(entry);
      for(const property of entry.result.document.framework==='HTML'?['href','src','poster','action']:['Source','NavigateUri']){
        const value=node.props[property];if(typeof value!=='string'||!value||/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(value)||/[{}]/.test(value))continue;
        const pathname=value.match(/^([^?#]*)/)?.[1];if(!pathname)continue;
        try{if(!resolvePath(decodeURIComponent(pathname),entry.sourcePath))relocationIssues.add(entry);}catch{relocationIssues.add(entry);}
      }
    });
    if(relocationIssues.has(entry)){
      const diagnostic=issue('PROJECT_DYNAMIC_REFERENCES','Review dynamic URLs, CSS imports, srcset, script references, and URLs outside the solution after conversion. Static element URLs within the solution are relocated.','warning');
      entry.diagnostics.push(diagnostic);entry.result.losses=[...(entry.result.losses||[]),diagnostic];if(strict)entry.status='failed';
    }
  }
  const mapping=new Map(inputs.filter(input=>typeof input.path==='string').map(input=>[key(input.path),input.path]));
  for(const entry of entries)if(entry.status==='ready')mapping.set(key(entry.sourcePath),entry.targetPath);
  for(const entry of entries){
    if(entry.status!=='ready')continue;
    const result=entry.result,doc=clone(result.document),html=doc.framework==='HTML';let changed=false,unresolved=false;
    const relocated=entry.sourcePath.split('/').slice(0,-1).join('/')!==entry.targetPath.split('/').slice(0,-1).join('/');
    walk(doc.root,node=>{
      if(node.kind!=='element')return;
      for(const property of html?['href','src','poster','action']:['Source','NavigateUri']){
        const value=node.props[property];if(typeof value!=='string'||!value||/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(value))continue;
        if(/\{|\}/.test(value)){if(relocated)unresolved=true;continue;}
        if(!html&&!/[./]/.test(value))continue;
        const match=value.match(/^([^?#]*)([?#].*)?$/),pathname=match?.[1];if(!pathname)continue;
        let decoded;try{decoded=decodeURIComponent(pathname);}catch{unresolved=true;continue;}
        const resolved=resolvePath(decoded,entry.sourcePath);if(!resolved){unresolved=true;continue;}
        const target=mapping.get(key(resolved))||resolved;
        const rewritten=relativePath(target,entry.targetPath).split('/').map(encodeURIComponent).join('/')+(match[2]||'');
        if(rewritten!==value){node.props[property]=rewritten;changed=true;}
      }
    });
    if(unresolved&&!relocationIssues.has(entry)){const diagnostic=issue('PROJECT_UNRESOLVED_REFERENCE','A dynamic, malformed, or out-of-solution URL was preserved and needs review.','warning');entry.diagnostics.push(diagnostic);result.losses=[...(result.losses||[]),diagnostic];}
    if(changed){
      delete doc.metadata?.source;
      try{entry.source=patchDocumentSource(result.source,result.document,doc);}catch{entry.source=html?serializeHtml(doc):serializeXaml(doc);}
      result.document=doc;result.source=entry.source;
      try{const index=buildSourceIndex(entry.source,doc);result.sourceMap=(result.sourceMap||[]).map(item=>({...item,targetRange:index.byId.get(item.targetNodeId)?{start:index.byId.get(item.targetNodeId).start,end:index.byId.get(item.targetNodeId).end}:undefined}));}catch{result.sourceMap=(result.sourceMap||[]).map(({targetRange,...item})=>item);}
    }
  }
}

/** Plan without mutating input documents or writing files. Paths are portable, relative solution paths. */
export function planProjectConversion(inputs,options={},compiler=compileDocument){
  if(!Array.isArray(inputs))throw Error('Conversion inputs must be an array.');
  const to=String(options.to||'html').toLowerCase(),scope=options.scope||'solution',collision=options.collision||'rename';
  if(!['html','xaml'].includes(to))throw Error('Choose HTML or XAML as the conversion target.');
  if(!['document','folder','solution'].includes(scope))throw Error('Choose a document, folder, or solution scope.');
  if(!['rename','skip','error'].includes(collision))throw Error('Choose rename, skip, or error for path collisions.');
  const folder=options.folder?normalizePath(options.folder):'',outputFolder=options.outputFolder?normalizePath(options.outputFolder):'';
  const settings={...options,to,scope,collision,folder,outputFolder,framework:options.framework||'WPF',preserveMetadata:options.preserveMetadata!==false,strict:!!options.strict};
  const occupied=new Set(),directories=new Set(),entries=[];
  for(const path of [...inputs.map(entry=>entry.path),...(options.existingPaths||[])]){
    try{const normalized=normalizePath(path);occupied.add(key(normalized));for(const parent of folders(normalized))directories.add(key(parent));}catch{}
  }
  for(const path of options.existingFolders||[])directories.add(key(normalizePath(path)));
  for(const input of inputs){
    let path;
    try{path=normalizePath(input.path);}catch(error){entries.push({id:input.id,sourcePath:String(input.path||''),targetPath:null,status:'failed',diagnostics:[issue('PROJECT_INVALID_PATH',error.message)]});continue;}
    if(scope==='document'&&input.id!==options.documentId&&path!==options.documentPath)continue;
    if(scope==='folder'&&folder&&!key(path).startsWith(key(folder)+'/'))continue;
    const entry={id:input.id,sourcePath:path,targetPath:null,status:'skipped',diagnostics:[]},from=language(input);
    entries.push(entry);
    if(!from){entry.diagnostics.push(issue('PROJECT_UNSUPPORTED_FILE','This file is not a supported XAML or HTML document.','info'));continue;}
    if(from===to){entry.diagnostics.push(issue('PROJECT_SAME_LANGUAGE','The document already uses the target language.','info'));continue;}
    const draft=input.document?.metadata?.source;
    if((input.diagnostics||draft?.diagnostics||[]).some(d=>d.severity==='error')){entry.status='failed';entry.diagnostics.push(issue('PROJECT_INVALID_DRAFT','The source contains errors. Resolve the draft before converting this document.'));continue;}
    const relative=scope==='folder'&&folder?path.slice(folder.length+1):path;
    const stem=(outputFolder?outputFolder+'/'+relative:path).replace(/\.(xaml|axaml|xml|html?)$/i,'');
    let target=normalizePath(stem+(to==='html'?'.html':'.xaml'));
    const parentConflict=folders(target).find(parent=>occupied.has(key(parent)));
    if(parentConflict){entry.targetPath=target;entry.status='failed';entry.diagnostics.push(issue('PROJECT_PARENT_IS_FILE','The output folder conflicts with file '+parentConflict+'.'));continue;}
    if(occupied.has(key(target))||directories.has(key(target))){
      if(collision!=='rename'){entry.targetPath=target;entry.status=collision==='skip'?'skipped':'failed';entry.diagnostics.push(issue('PROJECT_PATH_COLLISION','The output path already exists: '+target,collision==='skip'?'info':'error'));continue;}
      const original=target;let index=1;do{target=suffixPath(original,index++);}while(occupied.has(key(target))||directories.has(key(target)));
      entry.diagnostics.push(issue('PROJECT_RENAMED_OUTPUT','The output was renamed to '+target+' to keep existing files.','info'));
    }
    entry.targetPath=target;entry.from=from;entry.to=to;
    try{
      const source=input.source??draft?.text??input.document;
      if(typeof source!=='string'&&(!source||typeof source!=='object'))throw Error('No source text or document was supplied.');
      const result=compiler(typeof source==='string'?source:clone(source),{...settings,from,to,sourceName:path.split('/').at(-1),name:target.split('/').at(-1)});
      if(!result||typeof result.success!=='boolean')throw Error('The compiler returned an invalid result.');
      entry.result=result;entry.diagnostics.push(...(result.diagnostics||[]));
      entry.status=result.success&&typeof result.source==='string'&&result.document?'ready':'failed';
      if(entry.status==='failed'&&!entry.diagnostics.some(d=>d.severity==='error'))entry.diagnostics.push(issue('PROJECT_CONVERSION_FAILED','The compiler could not produce a valid target document.'));
      if(entry.status==='ready'){entry.source=result.source;occupied.add(key(target));for(const parent of folders(target))directories.add(key(parent));}
    }catch(error){entry.status='failed';entry.diagnostics.push(issue('PROJECT_COMPILER_ERROR',error.message||String(error)));}
  }
  relocateReferences(entries,inputs,settings.strict);
  const summary={total:entries.length,ready:0,failed:0,skipped:0,diagnostics:0,losses:0};
  for(const entry of entries){summary[entry.status]++;summary.diagnostics+=entry.diagnostics.length;summary.losses+=entry.result?.losses?.length||0;}
  // Parser/plugin functions stay out of the serializable preview and conversion report.
  const {Parser,parse,plugins,...serializable}=settings;
  return {version:1,options:serializable,entries,summary};
}
