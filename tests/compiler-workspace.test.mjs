import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument,element,textNode,clone,DocumentStore} from '../dist/core/model.js';
import {createSolution} from '../dist/core/solution.js';
import {planProjectConversion} from '../dist/core/conversion-project.js';
import {planSolutionConversion,applySolutionConversion} from '../dist/studio/compiler-workspace.js';
import {SolutionWorkspace} from '../dist/studio/solution-workspace.js';

function documentAt(path,framework='WPF'){
  const doc=createDocument(element(framework==='HTML'?'html':'Grid'),framework,path.split('/').at(-1));doc.metadata.solutionPath=path;return doc;
}
function compiler(source,options){
  const document=createDocument(options.to==='html'?element('html',{},[element('head'),element('body',{},[element('p',{},[textNode('Converted')])])]):element('Grid'),options.to==='html'?'HTML':options.framework,options.name);
  return {success:true,source:options.to==='html'?'<html><head></head><body><p>Converted</p></body></html>':'<Grid />',document,diagnostics:[],losses:[],sourceMap:[],metadata:{}};
}
function snapshot(documents){const solution=createSolution(documents);return {documents,solution,activeId:documents[0].id};}

test('batch scopes select exactly a document or descendants of a folder',()=>{
  const docs=[documentAt('Views/Home.xaml'),documentAt('Views/Nested/Other.xaml'),documentAt('Views2/Outside.xaml')],entries=docs.map(document=>({id:document.id,path:document.metadata.solutionPath,document}));
  assert.equal(planProjectConversion(entries,{scope:'document',documentId:docs[1].id,to:'html'},compiler).entries[0].sourcePath,'Views/Nested/Other.xaml');
  const plan=planProjectConversion(entries,{scope:'folder',folder:'Views',to:'html',outputFolder:'Generated'},compiler);
  assert.deepEqual(plan.entries.map(entry=>entry.targetPath),['Generated/Home.html','Generated/Nested/Other.html']);
});
test('mixed solutions skip files already using the target language and non-markup entries',()=>{
  const plan=planProjectConversion([{path:'Home.xaml',document:documentAt('Home.xaml')},{path:'index.html',document:documentAt('index.html','HTML')},{path:'notes.txt',source:'notes'}],{to:'html'},compiler);
  assert.deepEqual(plan.entries.map(entry=>entry.status),['ready','skipped','skipped']);assert.equal(plan.summary.ready,1);assert.equal(plan.summary.skipped,2);
});
test('renaming is case insensitive and deterministic across existing and newly planned outputs',()=>{
  const inputs=[{path:'Page.xaml',document:documentAt('Page.xaml')},{path:'Page.axaml',document:documentAt('Page.axaml')}];
  const plan=planProjectConversion(inputs,{to:'html',existingPaths:['PAGE.HTML','page.converted.html']},compiler);
  assert.deepEqual(plan.entries.map(entry=>entry.targetPath),['Page.converted-2.html','Page.converted-3.html']);
});
test('collisions support fail or skip and cannot create a child beneath an existing file',()=>{
  const entries=[{path:'View.xaml',document:documentAt('View.xaml')}];
  assert.equal(planProjectConversion(entries,{to:'html',existingPaths:['view.html'],collision:'error'},compiler).entries[0].status,'failed');
  assert.equal(planProjectConversion(entries,{to:'html',existingPaths:['view.html'],collision:'skip'},compiler).entries[0].status,'skipped');
  const parent=planProjectConversion(entries,{to:'html',outputFolder:'Build/output',existingPaths:['BUILD']},compiler);
  assert.equal(parent.entries[0].diagnostics[0].code,'PROJECT_PARENT_IS_FILE');
  assert.equal(planProjectConversion(entries,{to:'html',existingFolders:['view.html']},compiler).entries[0].targetPath,'View.converted.html');
});
test('invalid paths are reported and dangerous output paths are rejected without compiling',()=>{
  let calls=0;const run=(...args)=>{calls++;return compiler(...args);};
  const plan=planProjectConversion([{path:'../outside.xaml',source:'<Grid/>'},{path:undefined,source:'<Grid/>'}],{},run);
  assert.equal(plan.summary.failed,2);assert.equal(calls,0);
  assert.throws(()=>planProjectConversion([],{outputFolder:'../outside'},run),/relative|folder/i);
});
test('exact current source is compiled and invalid inactive drafts remain failed entries',()=>{
  const a=documentAt('a.xaml'),b=documentAt('b.xaml');a.metadata.source={text:"<Grid  Width='123' />",diagnostics:[]};b.metadata.source={text:'<Grid',validText:'<Grid/>',diagnostics:[{severity:'error',message:'unfinished'}]};
  const seen=[];const plan=planSolutionConversion(snapshot([a,b]),{to:'html'},(source,options)=>{seen.push(source);return compiler(source,options);});
  assert.deepEqual(seen,["<Grid  Width='123' />"]);assert.equal(plan.summary.ready,1);assert.equal(plan.summary.failed,1);assert.equal(b.metadata.source.text,'<Grid');
});
test('compiler exceptions become file failures and parser/plugin options pass through',()=>{
  const Parser=class {},plugin={name:'custom'},received=[];
  const plan=planProjectConversion([{path:'A.xaml',source:'bad'},{path:'B.xaml',source:'good'}],{to:'html',Parser,plugins:[plugin],strict:true},(source,options)=>{received.push(options);if(source==='bad')throw Error('Unsupported custom syntax');return compiler(source,options);});
  assert.equal(plan.entries[0].status,'failed');assert.match(plan.entries[0].diagnostics[0].message,/custom syntax/);assert.equal(plan.entries[1].status,'ready');assert.equal(received[1].Parser,Parser);assert.equal(received[1].plugins[0],plugin);assert.equal(received[1].strict,true);assert.equal(Object.hasOwn(plan.options,'Parser'),false);
});
test('mutating compiler plugins do not alter input documents',()=>{
  const doc=documentAt('A.xaml'),before=clone(doc);planProjectConversion([{path:'A.xaml',document:doc}],{to:'html'},(source,options)=>{source.root.props.Width='900';return compiler(source,options);});assert.deepEqual(doc,before);
});
test('static links follow converted output names and assets remain relative to the original location',()=>{
  const entries=['Views/Home.xaml','Views/About.xaml'].map(path=>({path,document:documentAt(path)}));
  const plan=planProjectConversion(entries,{to:'html',outputFolder:'Generated',existingPaths:['Generated/Views/About.html']},(source,options)=>{const result=compiler(source,options);if(source.name==='Home.xaml')result.document.root.children[1].children=[element('a',{href:'About.xaml#details'}),element('img',{src:'../images/logo.png'}),element('a',{href:'https://example.com/remote'})];return result;});
  const nodes=plan.entries[0].result.document.root.children[1].children;
  assert.equal(nodes[0].props.href,'About.converted.html#details');assert.equal(nodes[1].props.src,'../../images/logo.png');assert.equal(nodes[2].props.href,'https://example.com/remote');assert.match(plan.entries[0].source,/About.converted.html#details/);
});
test('relocated CSS/script URLs are explicit losses, with strict mode failing before linked-file remapping',()=>{
  const entries=['Views/A.xaml','Views/B.xaml'].map(path=>({path,document:documentAt(path)}));
  const run=(source,options)=>{const result=compiler(source,options);result.document.root.children[1].children=source.name==='B.xaml'?[element('img',{style:'background: url(../images/bg.png)'})]:[element('a',{href:'B.xaml'})];return result;};
  const loose=planProjectConversion(entries,{to:'html',outputFolder:'Out'},run);assert.equal(loose.summary.ready,2);assert.equal(loose.summary.losses,1);
  const strict=planProjectConversion(entries,{to:'html',outputFolder:'Out',strict:true},run);assert.equal(strict.entries[1].status,'failed');assert.equal(strict.entries[0].result.document.root.children[1].children[0].props.href,'../../Views/B.xaml');
});
test('relative URL relocation preserves encoded spaces, reserved filename characters, fragments, and queries',()=>{
  const entries=['Views/Home.xaml','Views/Chapter #1.xaml'].map(path=>({path,document:documentAt(path)}));
  const plan=planProjectConversion(entries,{to:'html',outputFolder:'Generated'},(source,options)=>{const result=compiler(source,options);if(source.name==='Home.xaml')result.document.root.children[1].children=[element('a',{href:'Chapter%20%231.xaml?mode=read#anchor'}),element('img',{src:'../images/a%20b.png'})];return result;});
  const nodes=plan.entries[0].result.document.root.children[1].children;assert.equal(nodes[0].props.href,'Chapter%20%231.html?mode=read#anchor');assert.equal(nodes[1].props.src,'../../images/a%20b.png');
});
test('URL relocation patches generated source without discarding indentation, comments, or quote style',()=>{
  const source="<!DOCTYPE html>\n<html>\n  <head></head>\n  <body>\n    <!-- Keep review formatting -->\n    <a href='../assets/help.html'>Help</a>\n  </body>\n</html>\n";
  const plan=planProjectConversion([{path:'Views/Home.xaml',document:documentAt('Views/Home.xaml')}],{to:'html',outputFolder:'Generated'},(_,options)=>{const result=compiler(_,options);result.source=source;result.document.root.children[1].children=[{id:'comment',kind:'comment',text:' Keep review formatting '},element('a',{href:'../assets/help.html'},[textNode('Help')])];return result;});
  assert.equal(plan.entries[0].source,source.replace("href='../assets/help.html'","href='../../assets/help.html'"));
});
test('application preserves originals and active document and creates one validated solution snapshot',()=>{
  const original=snapshot([documentAt('Views/Original.xaml')]),before=clone(original),plan=planSolutionConversion(original,{to:'html'},compiler),result=applySolutionConversion(original,plan);
  assert.deepEqual(original,before);assert.deepEqual(result.snapshot.documents[0],before.documents[0]);assert.equal(result.snapshot.activeId,before.activeId);assert.equal(result.snapshot.documents.length,2);assert.equal(result.snapshot.documents[1].metadata.source.text,plan.entries[0].source);assert.notEqual(result.snapshot.documents[1].id,before.documents[0].id);
  const opened=applySolutionConversion(original,plan,{openResult:true});assert.equal(opened.snapshot.activeId,opened.created[0].documentId);
});
test('stale plans reject source, metadata, and solution path changes while allowing active-tab changes',()=>{
  const state=snapshot([documentAt('A.xaml'),documentAt('B.xaml')]),plan=planSolutionConversion(state,{to:'html'},compiler);
  for(const mutate of [s=>s.documents[0].root.props.Width='22',s=>s.documents[0].metadata.source={text:'draft'},s=>s.solution.name='Changed']){const changed=clone(state);mutate(changed);assert.throws(()=>applySolutionConversion(changed,plan),/changed after this preview/);}
  const switched=clone(state);switched.activeId=switched.documents[1].id;assert.equal(applySolutionConversion(switched,plan).snapshot.activeId,switched.activeId);
});
test('failed files require explicit partial apply; selection and empty-plan validation prevent accidental output',()=>{
  const state=snapshot([documentAt('A.xaml'),documentAt('B.xaml')]),plan=planSolutionConversion(state,{to:'html'},(source,options)=>{if(source.name==='B.xaml')throw Error('cannot convert');return compiler(source,options);});
  assert.throws(()=>applySolutionConversion(state,plan),/successful files only/);assert.equal(applySolutionConversion(state,plan,{allowPartial:true}).created.length,1);assert.throws(()=>applySolutionConversion(state,plan,{allowPartial:true,selected:[]}),/Select at least/);
});
test('solution application reuses unchanged stores, sessions, selections, and history',()=>{
  const a=new DocumentStore(documentAt('A.xaml')),b=new DocumentStore(documentAt('B.xaml'));a.setProperty([a.document.root.id],'Width','123');a.select([a.document.root.id]);const sourceSession={source:'exact A source',refresh(){throw Error('unchanged session must not refresh');}};a.session=sourceSession;b.session={source:'exact B source',refresh(){throw Error('unchanged session must not refresh');}};
  const history=a.history,selection=a.selection,stores=[a,b];let editorSource;
  const s={stores,active:0,blend:{animation:{stop(){}}},docking:{control:{activate(){}},syncDocuments(){}},editor:{setValue(value){editorSource=value;}},sync:{beforeSwitch(){return true;},afterSwitch(){}},render(){},save(){},addStore(doc){return new DocumentStore(doc);}};
  Object.defineProperties(s,{doc:{get:()=>s.stores[s.active].document},store:{get:()=>s.stores[s.active]}});
  const state=snapshot(stores.map(store=>clone(store.document))),workspace={s,model:state.solution};SolutionWorkspace.prototype.apply.call(workspace,state);
  assert.equal(s.stores[0],a);assert.equal(s.stores[1],b);assert.equal(a.session,sourceSession);assert.equal(a.history,history);assert.equal(a.selection,selection);assert.equal(editorSource,'exact A source');
});
