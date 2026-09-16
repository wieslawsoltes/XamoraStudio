import { readFile, writeFile } from 'node:fs/promises';
import * as babel from './node_modules/prettier/plugins/babel.mjs';
const file='dist/studio/studio.js';
let source=await readFile(file,'utf8');
const ast=babel.parsers.babel.parse(source,{}).program;
const studio=ast.body.find(n=>n.declaration?.id?.name==='Studio')?.declaration;
if(!studio) throw Error('Missing Studio host');
const imports=ast.body.filter(n=>n.type==='ImportDeclaration');
const groups={
  'dialog-host':['modal','closeModal'],
  'workspace-files':['chooseFile','importFile','importText','workspaceData','svgSnapshot','save'],
  'workspace-dialogs':['newDocumentDialog','renameDocumentDialog','exportDialog','resetDemoDialog','installToolkitDialog','projectMenu','commandPalette','problemsDialog','symbolsDialog','historyDialog','helpDialog'],
};
const replacements=[];
const hostImports=[];
const visit=(node,fn,parent=null,key=null)=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(n=>visit(n,fn,parent,key));return;}if(node.type)fn(node,parent,key);for(const [key,value]of Object.entries(node))if(!['loc','extra','comments','tokens'].includes(key))visit(value,fn,node,key);};
const reference=(parent,key)=>!((['MemberExpression','OptionalMemberExpression'].includes(parent?.type)&&key==='property'&&!parent.computed)||(['ObjectProperty','ObjectMethod','ClassMethod'].includes(parent?.type)&&key==='key'&&!parent.computed));
for(const [module,names]of Object.entries(groups)){
 const identifiers=new Set();
 const functions=[];
 for(const name of names){
  const method=studio.body.body.find(n=>n.key.name===name);
  if(!method||method.kind!=='method'||method.generator)throw Error(`Unsupported method ${name}`);
  const edits=[];
  visit(method.body,(node,parent,key)=>{
   if(node.type==='Identifier'){if(reference(parent,key))identifiers.add(node.name);if(['studio','arguments'].includes(node.name))throw Error(`Unexpected binding in ${name}: ${node.name}`);}
   if(node.type==='Super'||['FunctionExpression','FunctionDeclaration'].includes(node.type))throw Error(`Unexpected dynamic receiver in ${name}`);
   if(node.type==='ThisExpression')edits.push(node);
  });
  const signature=source.slice(method.start,method.body.start);
  const parameters=signature.slice(signature.indexOf('(')+1,signature.lastIndexOf(')'));
  const args=method.params.map(p=>p.type==='Identifier'?p.name:p.type==='AssignmentPattern'&&p.left.type==='Identifier'?p.left.name:null);
  if(args.some(n=>!n))throw Error(`Unsupported parameters in ${name}`);
  let body=source.slice(method.body.start,method.body.end);
  for(const node of edits.sort((a,b)=>b.start-a.start))body=body.slice(0,node.start-method.body.start)+'studio'+body.slice(node.end-method.body.start);
  functions.push(`export ${method.async?'async ':''}function ${name}(studio${parameters?', '+parameters:''}) ${body}`);
  replacements.push({start:method.start,end:method.end,text:`${signature}{ return ${name}(this${args.length?', '+args.join(', '):''}); }`});
 }
 const usedImports=[];
 for(const statement of imports){
  const used=statement.specifiers.filter(specifier=>identifiers.has(specifier.local.name));
  if(!used.length)continue;
  if(used.some(n=>n.type!=='ImportSpecifier'))throw Error('Unexpected non-named import');
  usedImports.push(`import { ${used.map(s=>s.imported.name+(s.imported.name===s.local.name?'':' as '+s.local.name)).join(', ')} } from '${statement.source.value}';`);
 }
 await writeFile(`dist/studio/${module}.js`, `/** ${module==='dialog-host'?'Accessible modal presentation and focus management.':module==='workspace-files'?'Workspace file interchange and local persistence.':'Workspace commands and dialogs, composed with the Studio host.'} */\n${usedImports.join('\n')}\n\n${functions.join('\n\n')}\n`);
 hostImports.push(`import { ${names.join(', ')} } from './${module}.js';`);
}
for(const edit of replacements.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
const updated=babel.parsers.babel.parse(source,{}).program;
const used=new Set();
for(const node of updated.body.filter(n=>n.type!=='ImportDeclaration'))visit(node,(n,parent,key)=>{if(n.type==='Identifier'&&reference(parent,key))used.add(n.name);});
const prune=updated.body.filter(n=>n.type==='ImportDeclaration').map(n=>({start:n.start,end:n.end,text:n.specifiers.filter(s=>used.has(s.local.name)).length?`import { ${n.specifiers.filter(s=>used.has(s.local.name)).map(s=>s.imported.name+(s.imported.name===s.local.name?'':' as '+s.local.name)).join(', ')} } from '${n.source.value}';`:''}));
for(const edit of prune.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
await writeFile(file,hostImports.join('\n')+'\n'+source);
for(const path of ['docs/ARCHITECTURE.md','dist/docs/ARCHITECTURE.md']){
 let text=await readFile(path,'utf8');
 text=text.replace(/^(\| `studio\/studio.js`.+)$/m,'$1\n| `studio/dialog-host.js` | Modal markup, actions, focus trapping and restoration | Browser DOM |\n| `studio/workspace-files.js` | Workspace import/export primitives and local persistence | Studio document host and browser file APIs |\n| `studio/workspace-dialogs.js` | Project, document, export and navigation dialogs | Studio host and shared UI helpers |');
 text+='\n### Studio composition boundaries\n\n`app.js` alone creates the application. `studio/studio.js` owns the base workspace and delegates modal presentation, file interchange and workspace dialogs to focused modules. Delegates receive the host explicitly; they never import or instantiate `Studio`. The original host methods remain as forwarding entry points so feature wrappers and `window.xamora.studio` integrations retain their signatures and behavior. Dialog actions use the same stores, document sessions and edit guards as the host; there is no second document model.\n';
 await writeFile(path,text);
}
