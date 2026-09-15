import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentSession} from '../dist/core/document-session.js';
import {DocumentStore,element,find,walk,clone} from '../dist/core/model.js';
import {parseXaml,serializeXaml} from '../dist/core/xaml.js';

const X='http://schemas.microsoft.com/winfx/2006/xaml';
function setup(source,options={}){
  const store=new DocumentStore(parseXaml(source));
  const session=new DocumentSession(store,{source,...options});
  return {store,session};
}
function named(doc,name){let result;walk(doc.root,n=>{if(n.props?.['x:Name']===name||n.props?.Name===name||n.props?.id===name)result=n;});assert.ok(result,`Missing node ${name}`);return result;}
function semantics(node){return node.kind==='element'?{kind:node.kind,type:node.type,props:node.props,children:node.children.map(semantics)}:{kind:node.kind,text:node.text};}
function assertSourceMatchesTree(session,store){assert.deepEqual(semantics(parseXaml(session.validSource).root),semantics(store.document.root));}

test('session preserves the authored document byte for byte before editing',()=>{
  const source=`\uFEFF<?xml version='1.0'?>\r\n<!-- author -->\r\n<Grid  Width = '420'\r\n       Height="300" >\r\n  <Button Content='Save'/>\r\n</Grid>\r\n`;
  const {session,store}=setup(source);
  assert.equal(session.source,source);assert.equal(session.validSource,source);assert.equal(session.isValid,true);assert.deepEqual(session.diagnostics,[]);assertSourceMatchesTree(session,store);
});

test('property changes patch the existing value without reformatting comments, spacing, or quotes',()=>{
  const source=`<?xml version='1.0'?>\n<!-- head -->\n<Grid  Width = '420' Height="300">\n  <!-- keep -->\n  <Button Content = 'Save &amp; close' Margin="1, 2, 3, 4" />\n</Grid>\n<!-- tail -->`;
  const {session,store}=setup(source),button=store.document.root.children.find(n=>n.type==='Button');
  store.setProperty([button.id],'Content','Open & close');
  assert.equal(session.source,source.replace('Save &amp; close','Open &amp; close'));assertSourceMatchesTree(session,store);
});

test('single quoted attributes escape apostrophes while preserving quote style',()=>{
  const source="<Button Content='Save' Tag=\"unchanged\"/>";
  const {session,store}=setup(source);store.setProperty([store.document.root.id],'Content',"It's <ready> & done");
  assert.match(session.source,/Content='[^']*'/);assert.match(session.source,/Tag="unchanged"/);assert.equal(parseXaml(session.source).root.props.Content,"It's <ready> & done");
});

test('attribute additions, removals, and explicit empty values stay in sync',()=>{
  const {session,store}=setup("<Button Content = 'Save' Tag='keep'/>");const id=store.document.root.id;
  store.setProperty([id],'Width','125');assert.equal(parseXaml(session.source).root.props.Width,'125');assert.match(session.source,/Content = 'Save'/);
  store.setProperty([id],'Content','');assert.equal(parseXaml(session.source).root.props.Content,'');
  store.setProperty([id],'Width',null);assert.equal(parseXaml(session.source).root.props.Width,undefined);assert.equal(parseXaml(session.source).root.props.Tag,'keep');assertSourceMatchesTree(session,store);
});

test('code edits update model properties while retaining root and selected node identities',()=>{
  const source=`<Grid xmlns:x="${X}"><Button x:Name='Save' Content='Before'/></Grid>`;
  const {session,store}=setup(source),rootId=store.document.root.id,buttonId=named(store.document,'Save').id;
  store.select([buttonId]);const revision=session.revision;
  const result=session.updateSource(source.replace('Before','After'));
  assert.equal(result.accepted,true);assert.equal(result.valid,true);assert.ok(session.revision>revision);assert.equal(store.document.root.id,rootId);assert.equal(named(store.document,'Save').id,buttonId);assert.deepEqual(store.selection,[buttonId]);assert.equal(find(store.document.root,buttonId).props.Content,'After');
});

test('keyed sibling reordering in source retains each semantic identity',()=>{
  const before=`<Grid xmlns:x="${X}"><Button x:Name='A'/><Button x:Name='B'/><Button x:Name='C'/></Grid>`;
  const after=`<Grid xmlns:x="${X}"><Button x:Name='C'/><Button x:Name='A'/><Button x:Name='B'/></Grid>`;
  const {session,store}=setup(before),ids=Object.fromEntries(['A','B','C'].map(k=>[k,named(store.document,k).id]));
  session.updateSource(after);assert.deepEqual(store.document.root.children.map(n=>n.id),[ids.C,ids.A,ids.B]);
});

test('moving a named node between containers in source preserves its identity',()=>{
  const before=`<Grid xmlns:x="${X}"><StackPanel x:Name='Left'><Button x:Name='MoveMe' Content='A'/></StackPanel><Canvas x:Name='Right'/></Grid>`;
  const after=`<Grid xmlns:x="${X}"><StackPanel x:Name='Left'/><Canvas x:Name='Right'><Button x:Name='MoveMe' Content='B'/></Canvas></Grid>`;
  const {session,store}=setup(before),id=named(store.document,'MoveMe').id;
  session.updateSource(after);assert.equal(named(store.document,'MoveMe').id,id);assert.equal(named(store.document,'Right').children[0].id,id);assert.equal(find(store.document.root,id).props.Content,'B');
});

test('unique unnamed elements keep identity when code reorders siblings',()=>{
  const before='<Grid><Button Content="Save"/><TextBlock Text="Status"/><CheckBox IsChecked="True"/></Grid>';
  const after='<Grid><CheckBox IsChecked="True"/><Button Content="Save"/><TextBlock Text="Status"/></Grid>';
  const {session,store}=setup(before),ids=Object.fromEntries(store.document.root.children.map(n=>[n.type,n.id]));
  session.updateSource(after);for(const node of store.document.root.children)assert.equal(node.id,ids[node.type]);
});

test('same-type keyed nodes do not steal IDs when a new sibling is inserted in code',()=>{
  const before=`<Grid xmlns:x="${X}"><Button x:Name='A'/><Button x:Name='B'/></Grid>`;
  const {session,store}=setup(before),a=named(store.document,'A').id,b=named(store.document,'B').id;
  session.updateSource(before.replace("<Button x:Name='A'/>","<Button x:Name='New'/><Button x:Name='A'/>"));
  assert.equal(named(store.document,'A').id,a);assert.equal(named(store.document,'B').id,b);assert.notEqual(named(store.document,'New').id,a);assert.notEqual(named(store.document,'New').id,b);
});

test('resource keys preserve identity as dictionaries reorder',()=>{
  const before=`<Grid xmlns:x="${X}"><Grid.Resources><SolidColorBrush x:Key='Accent' Color='Red'/><Style x:Key='Action' TargetType='Button'/></Grid.Resources></Grid>`;
  const after=`<Grid xmlns:x="${X}"><Grid.Resources><Style x:Key='Action' TargetType='Button'/><SolidColorBrush x:Key='Accent' Color='Blue'/></Grid.Resources></Grid>`;
  const {session,store}=setup(before),resources=store.document.root.children[0],brushId=resources.children[0].id,styleId=resources.children[1].id;
  session.updateSource(after);assert.equal(store.document.root.children[0].id,resources.id);assert.deepEqual(store.document.root.children[0].children.map(n=>n.id),[styleId,brushId]);
});

test('mixed text, comments, CDATA, and processing instructions survive unrelated property edits',()=>{
  const source=`<?xml version="1.0"?>\n<TextBlock Tag='old'>Hello <!--marker--><Run Text='world'/> <![CDATA[<literal>]]><?render mode='compact'?>!</TextBlock>\n<!--end-->`;
  const {session,store}=setup(source);store.setProperty([store.document.root.id],'Tag','new');
  assert.equal(session.source,source.replace("Tag='old'","Tag='new'"));assertSourceMatchesTree(session,store);
});

test('editing a text node patches only its original content',()=>{
  const source="<TextBlock>Hello <Run Text='there'/>!</TextBlock>";
  const {session,store}=setup(source),textId=store.document.root.children[0].id;
  store.transaction('Edit text',d=>find(d.root,textId).text='Welcome & enjoy ');
  assert.equal(session.source,"<TextBlock>Welcome &amp; enjoy <Run Text='there'/>!</TextBlock>");assertSourceMatchesTree(session,store);
});

test('namespace declarations and custom prefixes survive visual attribute changes',()=>{
  const source=`<a:Grid xmlns:a='https://github.com/avaloniaui' xmlns:custom="clr-namespace:Custom.Controls"><custom:Chart Value = '12' custom:Hints='keep'/></a:Grid>`;
  const {session,store}=setup(source),chart=store.document.root.children[0];store.setProperty([chart.id],'Value','15');
  assert.equal(session.source,source.replace("Value = '12'","Value = '15'"));assert.equal(parseXaml(session.source).root.children[0].namespaceURI,'clr-namespace:Custom.Controls');assert.equal(store.document.framework,'Avalonia');
});

test('property-element edits retain the surrounding resource and template source',()=>{
  const source=`<Grid>\n  <Grid.ColumnDefinitions><!-- sizes --><ColumnDefinition Width = 'Auto'/><ColumnDefinition Width='*'/></Grid.ColumnDefinitions>\n  <Button Content='Save'/>\n</Grid>`;
  const {session,store}=setup(source),column=store.document.root.children[0].children.find(n=>n.type==='ColumnDefinition');
  store.setProperty([column.id],'Width','160');assert.equal(session.source,source.replace("Width = 'Auto'","Width = '160'"));assertSourceMatchesTree(session,store);
});

test('setting an attribute over a property element removes the property subtree in code',()=>{
  const source="<Button Tag='keep'><Button.Content><TextBlock Text='Old'/></Button.Content></Button>";
  const {session,store}=setup(source);store.setProperty([store.document.root.id],'Content','New');
  assert.doesNotMatch(session.source,/<Button.Content>/);assert.equal(parseXaml(session.source).root.props.Content,'New');assert.match(session.source,/Tag='keep'/);assertSourceMatchesTree(session,store);
});

test('visual insertion expands an empty container without reformatting existing sibling markup',()=>{
  const source="<Grid><StackPanel Name='Target'/><Button  Content = 'untouched' /></Grid>";
  const {session,store}=setup(source),target=named(store.document,'Target');const inserted=element('TextBlock',{Text:'Added & safe'});
  store.insert(target.id,inserted);assert.match(session.source,/<Button  Content = 'untouched' \/>/);assert.equal(parseXaml(session.source).root.children[0].children[0].props.Text,'Added & safe');assertSourceMatchesTree(session,store);
});

test('visual removal preserves unaffected siblings and comments',()=>{
  const source="<Grid><!-- keep --><Button Name='Remove'/><TextBlock  Text = 'untouched' /></Grid>";
  const {session,store}=setup(source);store.remove([named(store.document,'Remove').id]);
  assert.equal(session.source,"<Grid><!-- keep --><TextBlock  Text = 'untouched' /></Grid>");assertSourceMatchesTree(session,store);
});

test('visual reparenting retains the moved subtree spelling and attribute formatting',()=>{
  const source="<Grid><StackPanel Name='From'><Button  Name = 'Move' Content='A &amp; B' /></StackPanel><Canvas Name='To'/></Grid>";
  const {session,store}=setup(source),id=named(store.document,'Move').id;store.move([id],named(store.document,'To').id);
  assert.match(session.source,/<Button  Name = 'Move' Content='A &amp; B' \/>/);assert.equal(named(parseXaml(session.source),'To').children[0].props.Name,'Move');assert.equal(named(store.document,'Move').id,id);assertSourceMatchesTree(session,store);
});

test('source ranges locate nested elements including the entire closing tag',()=>{
  const source="<Grid>\n  <StackPanel><Button Content='😀 > safe'/></StackPanel>\n</Grid>";
  const {session,store}=setup(source),stack=store.document.root.children[0],button=stack.children[0];
  const range=session.sourceAtNode(button.id);assert.equal(source.slice(range.start,range.end),"<Button Content='😀 > safe'/>");
  const rootRange=session.sourceAtNode(store.document.root.id);assert.equal(source.slice(rootRange.start,rootRange.end),source);
  assert.equal(session.nodeAtOffset(source.indexOf('😀')).id,button.id);assert.equal(session.nodeAtOffset(source.indexOf('</StackPanel>')+3).id,stack.id);
});

test('source ranges are recomputed after source and visual edits',()=>{
  const source="<Grid><Button Name='One' Content='A'/><Button Name='Two'/></Grid>";
  const {session,store}=setup(source),second=named(store.document,'Two').id;
  store.setProperty([named(store.document,'One').id],'Content','A much longer string');let range=session.sourceAtNode(second);assert.equal(session.source.slice(range.start,range.end),"<Button Name='Two'/>");
  session.updateSource(session.source.replace('<Grid>','<Grid>\n\n'));range=session.sourceAtNode(second);assert.equal(session.source.slice(range.start,range.end),"<Button Name='Two'/>");assert.equal(session.nodeAtOffset(range.start+2).id,second);
});

test('invalid source is retained as a draft while the last valid visual tree survives',()=>{
  const source="<Grid><Button Content='Before'/></Grid>";
  const {session,store}=setup(source),before=semantics(store.document.root),invalid="<Grid><Button Content='in progress";
  const result=session.updateSource(invalid);assert.equal(result.valid,false);assert.equal(session.source,invalid);assert.equal(session.validSource,source);assert.equal(session.isValid,false);assert.ok(session.diagnostics.length>0);assert.deepEqual(semantics(store.document.root),before);
});

test('invalid drafts block every visual transaction without changing source or history',()=>{
  const {session,store}=setup('<Grid><Button/></Grid>');session.updateSource('<Grid><Button');
  const before=clone(store.document),history=store.history.length,source=session.source;
  assert.throws(()=>store.setProperty([store.document.root.children[0].id],'Content','overwrite'));
  assert.throws(()=>store.insert(store.document.root.id,element('TextBlock')));
  assert.deepEqual(store.document,before);assert.equal(store.history.length,history);assert.equal(session.source,source);
});

test('fixing an invalid draft resumes bidirectional edits using the same node identities',()=>{
  const before="<Grid><Button Name='Save' Content='A'/></Grid>";
  const {session,store}=setup(before),id=named(store.document,'Save').id;
  session.updateSource("<Grid><Button Name='Save'");session.updateSource(before.replace("Content='A'","Content='B'"));
  assert.equal(session.isValid,true);assert.deepEqual(session.diagnostics,[]);assert.equal(named(store.document,'Save').id,id);store.setProperty([id],'Content','C');assert.equal(parseXaml(session.source).root.children[0].props.Content,'C');
});

test('discard draft restores the exact last valid source and enables visual edits',()=>{
  const source="<Button  Content = 'Saved'/>";
  const {session,store}=setup(source);session.updateSource('<Button Content=');session.discardDraft();
  assert.equal(session.source,source);assert.equal(session.validSource,source);assert.equal(session.isValid,true);store.setProperty([store.document.root.id],'Content','Next');assert.equal(session.source,source.replace('Saved','Next'));
});

test('stale code revisions cannot overwrite a more recent panel edit',()=>{
  const source="<Button Content='A'/>";
  const {session,store}=setup(source),revision=session.revision;store.setProperty([store.document.root.id],'Content','Panel value');const current=session.source;
  const result=session.updateSource("<Button Content='Stale code'/>",{expectedRevision:revision});assert.equal(result.accepted,false);assert.equal(session.source,current);assert.equal(store.document.root.props.Content,'Panel value');
});

test('code and panel edits share one ordered undo and redo history with exact source restoration',()=>{
  const source="<Button  Content = 'A'/>";
  const {session,store}=setup(source);session.updateSource(source.replace("'A'","'B'"));store.setProperty([store.document.root.id],'Content','C');
  session.undo();assert.equal(session.source,source.replace("'A'","'B'"));assert.equal(store.document.root.props.Content,'B');
  store.undo();assert.equal(session.source,source);assert.equal(store.document.root.props.Content,'A');
  session.redo();assert.equal(session.source,source.replace("'A'","'B'"));store.redo();assert.equal(session.source,source.replace("'A'","'C'"));assert.equal(store.document.root.props.Content,'C');
});

test('document save and reopen retain authored source and an invalid draft',()=>{
  const source="<Button  Content = 'Saved'/>";
  const {session,store}=setup(source);session.updateSource('<Button Content=');const saved=JSON.parse(JSON.stringify(store.document));session.dispose();
  const reopenedStore=new DocumentStore(saved),reopened=new DocumentSession(reopenedStore);
  assert.equal(reopened.source,'<Button Content=');assert.equal(reopened.validSource,source);assert.equal(reopened.isValid,false);assert.equal(reopenedStore.document.root.props.Content,'Saved');
});

test('annotation edits remain in the unified document without touching markup',()=>{
  const source="<Grid  Width = '600'/>";
  const {session,store}=setup(source);store.transaction('Add annotation',d=>d.annotations.push({id:'note-1',text:'Review spacing',x:20,y:30}));
  assert.equal(session.source,source);assert.equal(store.document.annotations[0].text,'Review spacing');
  session.updateSource(source.replace("'600'","'640'"));assert.equal(store.document.annotations[0].text,'Review spacing');assert.equal(store.document.root.props.Width,'640');
});

test('custom HTML adapters participate in the same visual and source transaction system',()=>{
  const source="<html><head></head><body><button id='save' class='primary'>Save</button></body></html>";
  let parsed=0;
  const adapter={parse(text){parsed++;const doc=parseXaml(text);doc.framework='HTML';doc.name='index.html';return doc;},serialize(doc){return serializeXaml({...doc,framework:'WPF'});}};
  const store=new DocumentStore(adapter.parse(source)),session=new DocumentSession(store,{source,adapters:{HTML:adapter}}),id=named(store.document,'save').id;
  session.updateSource(source.replace('Save</button>','Send</button>'));assert.ok(parsed>1);assert.equal(named(store.document,'save').id,id);assert.equal(find(store.document.root,id).children[0].text,'Send');
  store.setProperty([id],'aria-label','Send message');assert.equal(adapter.parse(session.source).root.children[1].children[0].props['aria-label'],'Send message');assert.match(session.source,/class='primary'/);
  session.undo();assert.equal(find(store.document.root,id).props['aria-label'],undefined);assert.match(session.source,/Send<\/button>/);
});

test('draft edits are accepted into history and can be undone and redone without losing the valid tree',()=>{
  const source="<Button Content='A'/>";
  const {session,store}=setup(source);const invalid='<Button Content=';
  const result=session.updateSource(invalid);assert.equal(result.accepted,true);assert.equal(result.valid,false);assert.equal(store.document.metadata.source.text,invalid);assert.equal(store.document.metadata.source.validText,source);
  session.undo();assert.equal(session.source,source);assert.equal(session.isValid,true);assert.equal(store.document.root.props.Content,'A');
  session.redo();assert.equal(session.source,invalid);assert.equal(session.isValid,false);assert.equal(store.document.root.props.Content,'A');
});

test('resubmitting identical source does not add a no-op undo entry',()=>{
  const source="<Button Content='A'/>";
  const {session,store}=setup(source),revision=session.revision,history=store.history.length;
  const result=session.updateSource(source,{expectedRevision:revision});assert.equal(result.accepted,true);assert.equal(result.valid,true);assert.equal(session.revision,revision);assert.equal(store.history.length,history);
});

test('disposed sessions release the invalid-draft visual edit guard',()=>{
  const {session,store}=setup('<Button/>');session.updateSource('<Button');session.dispose();
  assert.doesNotThrow(()=>store.setProperty([store.document.root.id],'Content','After dispose'));assert.equal(store.document.root.props.Content,'After dispose');
});

test('source maps keep original IDs attached to their own markup after same-type sibling insertion and removal',()=>{
  const source="<Grid><Button Name='Original'/><Button Name='Second'/></Grid>";
  const {session,store}=setup(source),original=named(store.document,'Original').id,second=named(store.document,'Second').id,inserted=element('Button',{Name:'New'});
  store.insert(store.document.root.id,inserted,0);
  for(const [id,name] of [[original,'Original'],[second,'Second'],[inserted.id,'New']]){const range=session.sourceAtNode(id);assert.equal(parseXaml(session.source.slice(range.start,range.end)).root.props.Name,name);}
  store.remove([inserted.id]);for(const [id,name] of [[original,'Original'],[second,'Second']]){const range=session.sourceAtNode(id);assert.equal(parseXaml(session.source.slice(range.start,range.end)).root.props.Name,name);}
});

test('repeated names in separate template scopes retain distinct IDs when keyed templates reorder',()=>{
  const before=`<Grid xmlns:x="${X}"><Grid.Resources><ControlTemplate x:Key='First'><Button x:Name='Part' Content='One'/></ControlTemplate><ControlTemplate x:Key='Second'><Button x:Name='Part' Content='Two'/></ControlTemplate></Grid.Resources></Grid>`;
  const after=`<Grid xmlns:x="${X}"><Grid.Resources><ControlTemplate x:Key='Second'><Button x:Name='Part' Content='Two'/></ControlTemplate><ControlTemplate x:Key='First'><Button x:Name='Part' Content='One'/></ControlTemplate></Grid.Resources></Grid>`;
  const {session,store}=setup(before),[first,second]=store.document.root.children[0].children,ids=[first.children[0].id,second.children[0].id];session.updateSource(after);
  const templates=store.document.root.children[0].children;assert.deepEqual(templates.map(n=>n.children[0].id),[ids[1],ids[0]]);assert.notEqual(ids[0],ids[1]);
});

test('root code dimensions update the artboard without resetting unrelated design settings',()=>{
 const {session,store}=setup('<Grid Width="400" Height="300"/>');store.document.design.width=700;store.document.design.customZoom=2;
 session.updateSource('<Grid Width="400" Height="300" Background="Red"/>');assert.equal(store.document.design.width,700);
 session.updateSource('<Grid Width="500" Height="300" Background="Red"/>');assert.equal(store.document.design.width,500);assert.equal(store.document.design.customZoom,2);
});

test('source scanner treats HTML RCDATA and JavaScript as text rather than markup',async()=>{
 const {scanSource}=await import('../dist/core/source-syntax.js');
 const text='<html><head><title>A <b> &amp; B</title></head><body><textarea>Use <b> literally &amp; safely</textarea><script>if (a < b) { x = "<div>"; }</script><b>Actual</b></body></html>';
 const syntax=scanSource(text,{html:true});assert.equal(syntax.tokens.filter(n=>n.kind==='element'&&n.type==='b').length,1);assert.equal(syntax.tokens.filter(n=>n.kind==='element'&&n.type==='div').length,0);
 const textarea=syntax.tokens.find(n=>n.kind==='element'&&n.type==='textarea');assert.equal(textarea.children.length,1);assert.equal(textarea.children[0].kind,'text');assert.equal(text.slice(textarea.children[0].start,textarea.children[0].end),'Use <b> literally &amp; safely');
});

test('direct gesture commit rolls back invalid source edits atomically',()=>{
 const {session,store}=setup('<Button Content="Safe"/>');session.updateSource('<Button');const before=structuredClone(store.document);store.document.root.props.Content='Dragged';
 assert.throws(()=>store.commitSnapshot('Gesture',before),/source|draft/i);assert.equal(store.document.root.props.Content,'Safe');assert.equal(session.source,'<Button');assert.equal(store.history.length,1);
});

test('a direct document snapshot swap rebuilds source mappings for replacement node identities',()=>{
 const {session,store}=setup('<Grid><Button Content="Same"/></Grid>');const original=store.document.root.children[0].id;const replacement=parseXaml(session.source);replacement.metadata.source=structuredClone(store.document.metadata.source);store.document=replacement;session.refresh();
 assert.equal(session.sourceAtNode(original),null);const id=store.document.root.children[0].id;assert.ok(session.sourceAtNode(id));assert.equal(session.nodeAtOffset(session.source.indexOf('<Button')).id,id);
});

test('root property panel dimensions synchronize the artboard, code, and shared undo history',()=>{
 const {session,store}=setup('<Grid Width="400" Height="300"/>');
 store.setProperty([store.document.root.id],'Width','620');assert.equal(store.document.design.width,620);assert.match(session.source,/Width="620"/);assert.equal(store.history.length,1);
 store.undo();assert.equal(store.document.design.width,400);assert.equal(store.document.root.props.Width,'400');assert.match(session.source,/Width="400"/);
 store.redo();assert.equal(store.document.design.width,620);assert.equal(store.document.root.props.Width,'620');
 store.setProperty([store.document.root.id],'Width','Auto');assert.equal(store.document.design.width,620);
 store.transaction('Set root and explicit artboard',d=>{d.root.props.Height='450';d.design.height=900;});assert.equal(store.document.design.height,900);assert.match(session.source,/Height="450"/);
});
