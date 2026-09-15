import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentStore,element,find,clone} from '../dist/core/model.js';
import {parseXaml} from '../dist/core/xaml.js';
import {DocumentSession} from '../dist/core/document-session.js';
import {mapTextSelection} from '../dist/core/editor.js';

const original=`<Grid xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width='640'>
  <!-- preserve the designer's explanation -->
  <Button x:Name='Primary' Width='120' Content='Before' />
  <TextBlock x:Name='Caption' Text='Untouched' />
</Grid>`;
function fixture(source=original){const store=new DocumentStore(parseXaml(source));const session=new DocumentSession(store,{source});return {store,session,primary:store.document.root.children.find(n=>n.props?.['x:Name']==='Primary')};}

test('code, inspector, canvas insertion and document history share one selected model',()=>{
  const {store,session,primary}=fixture();store.select([primary.id]);
  const typed=original.replace("Content='Before'","Content='Typed'");
  assert.equal(session.updateSource(typed).valid,true);
  assert.deepEqual(store.selection,[primary.id]);
  assert.equal(find(store.document.root,primary.id).props.Content,'Typed');
  store.setProperty([primary.id],'Width','180');
  assert.match(session.source,/Width='180'/);
  assert.ok(session.source.includes("Content='Typed'"));
  assert.ok(session.source.includes("<!-- preserve the designer's explanation -->"));
  assert.ok(session.source.includes("<TextBlock x:Name='Caption' Text='Untouched' />"));
  const label=element('TextBlock',{Text:'From canvas'});
  store.insert(store.document.root.id,label);
  assert.ok(session.source.includes('From canvas'));
  store.undo();assert.equal(find(store.document.root,label.id),null);assert.ok(!session.source.includes('From canvas'));
  store.undo();assert.equal(find(store.document.root,primary.id).props.Width,'120');assert.equal(session.source,typed);
  store.undo();assert.equal(session.source,original);assert.equal(find(store.document.root,primary.id).props.Content,'Before');
  store.redo();store.redo();store.redo();assert.equal(find(store.document.root,label.id).props.Text,'From canvas');
  session.dispose();
});

test('invalid source survives unrelated document changes and visual mutation rejects without losing the draft',()=>{
  const a=fixture(),b=fixture('<Canvas Width="900"/>');
  const invalid=original.replace('</Grid>','');const before=clone(a.store.document.root);
  const result=a.session.updateSource(invalid);
  assert.equal(result.accepted,true);assert.equal(result.valid,false);assert.equal(a.session.source,invalid);
  assert.deepEqual(a.store.document.root,before);
  assert.throws(()=>a.store.setProperty([a.primary.id],'Width','999'));
  assert.equal(a.session.source,invalid);assert.deepEqual(a.store.document.root,before);
  b.store.setProperty([b.store.document.root.id],'Width','901');
  assert.equal(a.session.source,invalid);assert.ok(b.session.source.includes('901'));
  assert.equal(a.session.updateSource(original.replace("'Before'","'Corrected'")).valid,true);
  assert.equal(find(a.store.document.root,a.primary.id).props.Content,'Corrected');
  a.session.dispose();b.session.dispose();
});

test('invalid draft and explicit discard can be traversed with shared undo and redo',()=>{
  const {store,session}=fixture();const invalid=original+'<';
  session.updateSource(invalid);assert.equal(session.isValid,false);
  store.undo();assert.equal(session.isValid,true);assert.equal(session.source,original);
  store.redo();assert.equal(session.isValid,false);assert.equal(session.source,invalid);
  session.discardDraft();assert.equal(session.isValid,true);assert.equal(session.source,original);
  store.undo();assert.equal(session.isValid,false);assert.equal(session.source,invalid);
  session.dispose();
});

test('serialized solution document restores both valid syntax and an invalid draft',()=>{
  const {store,session,primary}=fixture();store.setProperty([primary.id],'Height','42');
  const valid=session.source;session.updateSource(valid.replace('</Grid>',''));
  const restoredStore=new DocumentStore(JSON.parse(JSON.stringify(store.document)));
  const restored=new DocumentSession(restoredStore);
  assert.equal(restored.source,session.source);assert.equal(restored.validSource,valid);assert.equal(restored.isValid,false);
  assert.equal(find(restoredStore.document.root,primary.id).props.Height,'42');
  restored.discardDraft();assert.equal(restored.source,valid);assert.equal(restored.isValid,true);
  session.dispose();restored.dispose();
});

test('source map follows structural moves and deletion without retaining stale locations',()=>{
  const {store,session,primary}=fixture();const root=store.document.root;
  const container=element('StackPanel',{'x:Name':'Destination'});store.insert(root.id,container);
  store.move([primary.id],container.id);
  const span=session.sourceAtNode(primary.id);
  assert.ok(span);assert.ok(session.source.slice(span.start,span.end).includes("x:Name='Primary'"));
  assert.equal(session.nodeAtOffset(span.start+2)?.id,primary.id);
  store.remove([primary.id]);assert.equal(session.sourceAtNode(primary.id),null);
  store.undo();assert.equal(session.nodeAtOffset(session.sourceAtNode(primary.id).start+2)?.id,primary.id);
  session.dispose();
});

test('revision-checked extension edit rejects stale source without overwriting panel changes',()=>{
  const {store,session,primary}=fixture();const revision=session.revision;
  store.setProperty([primary.id],'Width','200');const latest=session.source;
  const result=session.updateSource(original.replace("'Before'","'Stale'"),{expectedRevision:revision});
  assert.equal(result.accepted,false);assert.equal(session.source,latest);assert.equal(find(store.document.root,primary.id).props.Width,'200');
  const fresh=session.updateSource(latest.replace("'Before'","'Fresh'"),{expectedRevision:session.revision});
  assert.equal(fresh.accepted,true);assert.equal(find(store.document.root,primary.id).props.Content,'Fresh');session.dispose();
});

test('caret mapping keeps a selected unchanged token through a remote property patch',()=>{
  const before='<Button Width="20" Content="Caret stays here" />',after=before.replace('"20"','"2000"');
  const start=before.indexOf('Caret'),end=start+5;
  const mapped=mapTextSelection(before,after,start,end);
  assert.equal(after.slice(mapped.start,mapped.end),'Caret');
  assert.equal(mapped.start,start+2);assert.equal(mapped.end,end+2);
});

test('store listeners observe matching source and tree after gesture snapshot commits',()=>{
  const {store,session,primary}=fixture();const observations=[];
  store.addEventListener('change',()=>{const parsed=parseXaml(session.validSource);observations.push({model:find(store.document.root,primary.id).props.Width,source:parsed.root.children.find(n=>n.props?.['x:Name']==='Primary').props.Width,revision:session.revision});});
  const before=clone(store.document);find(store.document.root,primary.id).props.Width='220';
  store.commitSnapshot('Resize gesture',before);
  assert.equal(observations.length,1);assert.equal(observations[0].model,'220');assert.equal(observations[0].source,'220');
  assert.equal(observations[0].revision,store.revision);store.undo();assert.equal(observations[1].model,'120');assert.equal(observations[1].source,'120');
  session.dispose();
});

test('source editing a named element across containers preserves selected ID and unrelated metadata',()=>{
  const source=`<Grid xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><StackPanel x:Name="A"><Button x:Name="Primary" Content="Before"/></StackPanel><StackPanel x:Name="B"/></Grid>`;
  const store=new DocumentStore(parseXaml(source)),session=new DocumentSession(store,{source}),id=store.document.root.children[0].children[0].id;
  store.document.annotations=[{id:'annotation',targetId:id,text:'Keep this relationship'}];store.select([id]);
  const moved=`<Grid xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><StackPanel x:Name="A"/><StackPanel x:Name="B"><Button x:Name="Primary" Content="Moved"/></StackPanel></Grid>`;
  assert.equal(session.updateSource(moved).valid,true);assert.deepEqual(store.selection,[id]);assert.equal(find(store.document.root,id).props.Content,'Moved');
  assert.equal(store.document.root.children[1].children[0].id,id);assert.equal(store.document.annotations[0].targetId,id);
  session.dispose();
});
