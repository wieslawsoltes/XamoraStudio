/** Real Chromium smoke/integration tests. Run: node tests/browser-sync.mjs. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
let playwright;
try{playwright=await import('playwright');}catch(error){
  if(!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)throw error;
  playwright=await import(pathToFileURL(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright/index.mjs')).href);
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{
  let file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  if((await stat(file)).isDirectory())file=resolve(file,'index.html');
  res.writeHead(200,{'Content-Type':mime[extname(file)]||'text/plain','Cache-Control':'no-store'}).end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser,page;const runtimeErrors=[],consoleErrors=[],consoleCapture=[];
try{
  browser=await playwright.chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
  page=await browser.newPage({viewport:{width:1600,height:1100}});
  page.on('pageerror',error=>runtimeErrors.push(error.stack||error.message));
  page.on('console',message=>{
    if(message.type()!=='error')return;
    const record={text:message.text(),location:message.location(),arguments:[]};consoleErrors.push(record);
    const capture=Promise.all(message.args().map(argument=>argument.evaluate(value=>{
      if(value instanceof Error)return value.stack||value.message;
      if(typeof value==='string')return value;
      try{return JSON.stringify(value);}catch{return String(value);}
    }).catch(error=>'Unable to inspect console argument: '+error.message))).then(values=>{record.arguments=values;console.error('Browser console.error:',values.join('\n')||record.text);});
    consoleCapture.push(capture);
  });
  await page.goto(base);
  await page.waitForFunction(()=>!!window.xamora?.studio?.sync||!!document.querySelector('#recover-workspace'),null,{timeout:30000});
  const startup=await page.evaluate(()=>({recovery:!!document.querySelector('#recover-workspace'),ready:!!window.xamora?.studio?.sync,body:document.body.innerText.slice(0,12000)}));
  await Promise.allSettled(consoleCapture);
  assert.equal(startup.recovery,false,'App startup entered recovery: '+startup.body+'\n'+consoleErrors.map(error=>error.arguments.join('\n')||error.text).join('\n'));
  assert.equal(startup.ready,true,'App did not initialize synchronization: '+startup.body);
  await page.waitForFunction(()=>!!window.xamora.studio.language);
  const input=page.locator('.code-input');
  const place=async(needle,inside=needle)=>{await input.focus();await input.evaluate((el,{needle,inside})=>{const at=el.value.indexOf(needle)+needle.indexOf(inside)+1;if(at<1)throw Error('Missing token '+needle);el.setSelectionRange(at,at);}, {needle,inside});};
  const xml=`<Grid xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
 <!-- Save is literal commentary -->
 <Button x:Name='Save' Content='Save'/>
 <TextBlock Text="{Binding ElementName=Save, Path=Content}"/>
 <EventTrigger SourceName='Save'/>
</Grid>`;
  await page.evaluate(source=>{const s=window.xamora.studio;s.importText(source,'Language.xaml');s.setView('split');s.store.session.updateSource(source);},xml);
  await page.waitForFunction(()=>!window.xamora.studio.sync.renderFrame);
  await place('ElementName=Save','Save');const referenceCaret=await input.evaluate(el=>el.selectionStart);
  await input.press('F12');
  assert.equal(await input.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd)),'Save','F12 selects declaration token');
  assert.ok(await input.evaluate(el=>el.selectionStart<el.value.indexOf('ElementName=')));
  await input.press('Alt+ArrowLeft');assert.equal(await input.evaluate(el=>el.selectionStart),referenceCaret,'navigate back returns exact source position');
  await input.press('Shift+F12');
  await page.waitForFunction(()=>document.querySelectorAll('.semantic-results [data-semantic-result]').length===3);
  assert.equal(await page.locator('.semantic-summary').textContent(),'3 references · Language.xaml');
  await place('ElementName=Save','Save');const history=await page.evaluate(()=>window.xamora.studio.store.history.length);
  await input.press('F2');await page.getByLabel('New symbol name').fill('Commit');await page.locator('[data-modal-action="0"]').click();
  await page.waitForFunction(()=>window.xamora.studio.store.session.source.includes("x:Name='Commit'"));
  const renamed=await input.inputValue();assert.ok(renamed.includes('ElementName=Commit'));assert.ok(renamed.includes("SourceName='Commit'"));assert.ok(renamed.includes("Content='Save'"));assert.ok(renamed.includes('Save is literal commentary'));
  assert.equal(await page.evaluate(()=>window.xamora.studio.store.history.length),history+1,'rename adds one shared history transaction');
  await input.focus();await input.press('Control+z');assert.equal(await input.inputValue(),xml,'source undo reverses all rename edits together');
  assert.ok((await page.evaluate(()=>window.xamora.language.diagnostics())).every(issue=>issue.code!=='unresolved-local-reference'));
  console.log('PASS semantic XAML: F12, references panel, rename dialog, capture-safe local references, exact undo, back navigation');

  const html=`<!doctype html><html><head><style>#action { color: red; } /* #action stays in a comment */</style></head><body><label for='action'>Action</label><button id='action'>Run</button><a href='#action'>Jump</a><script>const text='#action';</script></body></html>`;
  await page.evaluate(source=>{const s=window.xamora.studio;s.importText(source,'Language.html');s.setView('split');s.store.session.updateSource(source);},html);
  await page.waitForFunction(()=>!window.xamora.studio.sync.renderFrame&&!!window.xamora.studio.renderer.htmlRenderer?.frame?.contentDocument.querySelector('#action'));
  await place("href='#action'",'action');await input.press('F12');assert.equal(await input.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd)),'action');
  await input.press('F2');await page.getByLabel('New symbol name').fill('submitAction');await page.locator('[data-modal-action="0"]').click();
  await page.waitForFunction(()=>!window.xamora.studio.sync.renderFrame&&!!window.xamora.studio.renderer.htmlRenderer?.frame?.contentDocument.querySelector('#submitAction'));
  const renamedHtml=await input.inputValue();assert.ok(renamedHtml.includes("for='submitAction'"));assert.ok(renamedHtml.includes("href='#submitAction'"));assert.ok(renamedHtml.includes('#submitAction {'));assert.ok(renamedHtml.includes('/* #action stays in a comment */'));assert.ok(renamedHtml.includes("const text='#action'"));
  await input.focus();await input.press('Control+z');assert.equal(await input.inputValue(),html);
  console.log('PASS semantic HTML: fragment navigation, ID and selector rename, literal-script preservation, one-step undo');

  await page.evaluate(()=>{const s=window.xamora.studio;s.registry.registerControl({type:'Meter',category:'Custom',frameworks:['WPF'],properties:[{name:'ScaleMode',values:['Linear','Logarithmic']}]});s.importText('<Meter ScaleMode="Li"/>','Completion.xaml');s.setView('split');});
  await place('ScaleMode="Li"','Li');await input.evaluate(el=>{const at=el.value.indexOf('Li')+2;el.setSelectionRange(at,at);});
  await input.press('Control+Space');await page.waitForFunction(()=>!document.querySelector('.completions').hidden&&document.querySelector('.completions').textContent.includes('Linear'));
  await input.press('Enter');await page.waitForFunction(()=>window.xamora.studio.doc.root.props.ScaleMode==='Linear');
  assert.ok(await input.evaluate(el=>el.value.includes('ScaleMode="Linear"')));
  await page.evaluate(()=>{const s=window.xamora.studio;s.editor.input.value='<Meter';s.editor.changed();});await input.focus();await input.press('F2');assert.equal(await page.locator('#semantic-rename-name').count(),0,'invalid draft cannot trigger rename');
  await page.evaluate(()=>window.xamora.studio.store.session.discardDraft());await page.waitForFunction(()=>!window.xamora.studio.sync.renderFrame);
  const diagnosticSource='<Grid>\n <Button Content="First"/>\n <UnregisteredDiagnosticWidget/>\n</Grid>';
  const oldDiagnostic=await page.evaluate(source=>{const s=window.xamora.studio;s.importText(source,'Diagnostic.xaml');s.setView('split');s.store.session.updateSource(source);const node=s.doc.root.children.find(node=>node.type==='UnregisteredDiagnosticWidget');return {id:node.id,line:s.store.session.sourceAtNode(node.id).line};},diagnosticSource);
  await input.focus();await input.evaluate(el=>{const index=el.value.indexOf('First');el.setSelectionRange(index,index+5);});await page.keyboard.insertText('First\nSecond');
  await page.waitForFunction(id=>{const s=window.xamora.studio,issue=s.issues.find(issue=>issue.id===id),span=s.store.session.sourceAtNode(id);return !s.sync.renderFrame&&issue&&issue.line===span.line;},oldDiagnostic.id);
  const movedDiagnostic=await page.evaluate(id=>{const s=window.xamora.studio;return {actual:s.issues.find(issue=>issue.id===id).line,expected:s.store.session.sourceAtNode(id).line};},oldDiagnostic.id);
  assert.equal(movedDiagnostic.actual,oldDiagnostic.line+1,'legacy diagnostic line moves after multiline attribute editing');assert.equal(movedDiagnostic.actual,movedDiagnostic.expected);
  console.log('PASS diagnostics: incremental source line changes propagate to existing designer diagnostics');
  assert.deepEqual(runtimeErrors,[],'semantic editor has no uncaught browser errors');
  console.log('PASS metadata completion: registry enum completion, accepted source transaction, invalid-draft rename guard');
  console.log('Browser semantic language integration passed.');
}catch(error){
  if(page){
    await Promise.allSettled(consoleCapture);
    const state=await page.evaluate(()=>({url:location.href,body:document.body?.innerText.slice(0,12000)||'',editorStatus:document.querySelector('.code-message')?.textContent||'',recovery:!!document.querySelector('#recover-workspace')})).catch(error=>({diagnosticError:error.message}));
    const diagnostics={error:error.stack||error.message,runtimeErrors,consoleErrors,state};
    await mkdir('test-results',{recursive:true});
    await writeFile('test-results/browser-language-failure.json',JSON.stringify(diagnostics,null,2));
    await page.screenshot({path:'test-results/browser-language-failure.png',fullPage:true}).catch(()=>{});
    console.error('Browser errors:',runtimeErrors);console.error('Browser console errors:',consoleErrors);
    console.error('Editor status:',state.editorStatus);console.error('App body:',state.body);
  }
  throw error;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
