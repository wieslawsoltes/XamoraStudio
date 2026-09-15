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


  await page.evaluate(async()=>{
    const [{compileDocument},{parseXaml},{PreviewRenderer},{builtins},{walk},{serializeHtml}]=await Promise.all([import('/core/semantic-compiler.js'),import('/core/xaml.js'),import('/core/render.js'),import('/core/registry.js'),import('/core/model.js'),import('/core/html.js')]);
    window.compilerAudit={compileDocument,parseXaml,PreviewRenderer,builtins,walk,serializeHtml};
    window.compilerAudit.render=async source=>{
      document.querySelectorAll('[data-compiler-audit]').forEach(node=>node.remove());
      const doc=parseXaml(source),result=compileDocument(source,{from:'xaml',to:'html'});if(!result.success)throw Error(result.diagnostics.map(d=>d.message).join('\n'));
      const host=document.createElement('div');host.dataset.compilerAudit='native';host.style.cssText='position:fixed;left:0;top:0;width:500px;height:400px;background:white;z-index:10000;';document.body.append(host);
      const renderer=new PreviewRenderer(builtins());renderer.render(doc,host,{interactive:true});
      const frame=document.createElement('iframe');frame.dataset.compilerAudit='compiled';frame.style.cssText='position:fixed;left:620px;top:0;width:500px;height:400px;border:0;z-index:10000;';document.body.append(frame);const loaded=new Promise(resolve=>frame.onload=resolve);frame.srcdoc=result.source;await loaded;
      const nodes=[];walk(doc.root,node=>{if(node.props?.['x:Name'])nodes.push(node);});
      const nativeRoot=renderer.elements.get(doc.root.id).getBoundingClientRect(),htmlRoot=frame.contentDocument.body.firstElementChild.getBoundingClientRect(),geometry=(element,root)=>{const rect=element.getBoundingClientRect();return {x:rect.x-root.x,y:rect.y-root.y,width:rect.width,height:rect.height};};
      return {items:nodes.map(node=>({name:node.props['x:Name'],native:geometry(renderer.elements.get(node.id),nativeRoot),html:geometry(frame.contentDocument.getElementById(node.props['x:Name']),htmlRoot)})),source:result.source,diagnostics:result.diagnostics};
    };
  });
  const fixtures={
    Grid:'<Grid Width="400" Height="240"><Grid.RowDefinitions><RowDefinition Height="80"/><RowDefinition Height="*"/></Grid.RowDefinitions><Grid.ColumnDefinitions><ColumnDefinition Width="120"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions><Border x:Name="A" Grid.Row="0" Grid.Column="0" Background="Red"/><Border x:Name="B" Grid.Row="1" Grid.Column="1" Background="Blue"/></Grid>',
    Stack:'<StackPanel Width="180" Height="100"><Border x:Name="A" Height="80" Background="Red"/><Border x:Name="B" Height="80" Background="Blue"/></StackPanel>',
    Wrap:'<WrapPanel Width="220" Height="200"><Border x:Name="A" Width="100" Height="40" Background="Red"/><Border x:Name="B" Width="100" Height="40" Background="Blue"/><Border x:Name="C" Width="100" Height="40" Background="Green"/></WrapPanel>',
    Canvas:'<Canvas Width="400" Height="240"><Border x:Name="A" Canvas.Left="20" Canvas.Top="30" Width="80" Height="50" Background="Red"/><Border x:Name="B" Canvas.Right="15" Canvas.Bottom="25" Width="70" Height="60" Background="Blue"/></Canvas>',
    Dock:'<DockPanel Width="400" Height="240"><Border x:Name="A" DockPanel.Dock="Top" Height="40" Background="Red"/><Border x:Name="B" DockPanel.Dock="Left" Width="80" Background="Blue"/><Border x:Name="C" Background="Green"/></DockPanel>'
  };
  const failures=[];
  for(const [name,markup] of Object.entries(fixtures)){
    const source=markup.replace(/^<(\w+)/,'<$1 xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"');
    const result=await page.evaluate(source=>window.compilerAudit.render(source),source);
    for(const item of result.items)for(const property of ['x','y','width','height'])if(Math.abs(item.native[property]-item.html[property])>1)failures.push(`${name}/${item.name}/${property}: preview=${item.native[property]} compiled=${item.html[property]}`);
  }
  assert.deepEqual(failures,[],'shared renderer and semantic compiler agree on representative layout geometry');
  console.log('PASS semantic compiler geometry: Grid tracks, nonshrinking Stack children, default Wrap flow, Canvas edges, ordered Dock fill');

  const captions=await page.evaluate(async()=>{
    const {compileDocument,parseXaml,walk,serializeHtml}=window.compilerAudit;
    const source='<StackPanel xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><CheckBox x:Name="Accept" Content="Accept terms" IsChecked="True"/><RadioButton x:Name="Choice" Content="Choice A" IsChecked="False"/></StackPanel>';
    const result=compileDocument(source,{from:'xaml',to:'html'}),parsed=new DOMParser().parseFromString(result.source,'text/html');
    let caption;walk(result.document.root,node=>{if(node.kind==='text'&&node.text==='Accept terms')caption=node;});if(caption)caption.text='Edited caption';
    const back=compileDocument(serializeHtml(result.document),{from:'html',to:'xaml'});const nodes=[];if(back.document)walk(back.document.root,node=>{if(['CheckBox','RadioButton'].includes(node.type))nodes.push({type:node.type,props:node.props});});
    return {text:parsed.body.textContent,checkbox:!!parsed.querySelector('input[type=checkbox]:checked'),radios:parsed.querySelectorAll('input[type=radio]').length,back:back.success,nodes};
  });
  assert.match(captions.text,/Accept terms/);assert.match(captions.text,/Choice A/);assert.equal(captions.checkbox,true);assert.equal(captions.radios,1);assert.equal(captions.back,true);assert.equal(captions.nodes.find(node=>node.type==='CheckBox').props.Content,'Edited caption');
  console.log('PASS semantic controls: visible checkbox/radio captions, checked state, caption editing and reverse conversion');

  const css=await page.evaluate(()=>{
    const {compileDocument,walk}=window.compilerAudit;
    const source='<html><head><style>.board{display:grid;grid-template-columns:120px 1fr}.board .title{color:blue}#title{color:red!important}.title{color:green} .board{--space:12px;padding:var(--space)}</style></head><body><div class="board"><p id="title" class="title">First</p><p id="second">Second</p></div></body></html>';
    const result=compileDocument(source,{from:'html',to:'xaml'}),nodes=[];walk(result.document.root,node=>{if(node.props?.['x:Name'])nodes.push({name:node.props['x:Name'],type:node.type,props:node.props});});return {success:result.success,nodes,root:result.document.root.props,source:result.source,diagnostics:result.diagnostics};
  });
  assert.equal(css.success,true);assert.equal(css.nodes.find(node=>node.name==='title').props.Foreground,'red');assert.equal(css.root.Padding,'12');
  assert.equal(css.nodes.find(node=>node.name==='second').props['Grid.Column'],'1','ordinary CSS grid auto placement becomes a nonoverlapping native grid cell');
  console.log('PASS semantic CSS: class/descendant/ID cascade, !important, custom-property resolution and automatic grid placement');

  const safety=await page.evaluate(async()=>{
    const {compileDocument}=window.compilerAudit;window.__compilerUnsafe=0;
    const original='<html onclick="parent.__compilerUnsafe++"><head><script>parent.__compilerUnsafe++<\/script></head><body><main><button onclick="parent.__compilerUnsafe++">Run</button><a href="javascript:parent.__compilerUnsafe++">Unsafe link</a><a href="java&#10;script:parent.__compilerUnsafe++">Encoded scheme</a><iframe srcdoc="&lt;script>parent.parent.__compilerUnsafe++&lt;/script>"></iframe></main></body></html>';
    const native=compileDocument(original,{from:'html',to:'xaml'}),result=compileDocument(native.source,{from:'xaml',to:'html'}),frame=document.createElement('iframe');frame.dataset.compilerAudit='safety';document.body.append(frame);const loaded=new Promise(resolve=>frame.onload=resolve);frame.srcdoc=result.source;await loaded;frame.contentDocument.documentElement.click();frame.contentDocument.querySelector('button')?.click();frame.contentDocument.querySelectorAll('a').forEach(link=>link.click());await new Promise(resolve=>setTimeout(resolve,100));
    const literal=compileDocument('<TextBlock Text="{}&lt;img src=x onerror=alert(1)&gt;"/>',{from:'xaml',to:'html'}),literalDom=new DOMParser().parseFromString(literal.source,'text/html');
    return {fired:window.__compilerUnsafe,source:result.source,literal:literalDom.body.textContent,imageCount:literalDom.querySelectorAll('img').length,success:native.success&&result.success};
  });
  assert.equal(safety.success,true);assert.equal(safety.fired,0,'script bodies, root/node handlers, javascript URLs and iframe srcdoc remain inert by default');assert.match(safety.literal,/<img src=x onerror=alert\(1\)>/);assert.equal(safety.imageCount,0);
  console.log('PASS semantic inert output: literal markup remains text and source scripts/handlers/active URLs do not execute by default');

  const maps=await page.evaluate(()=>{
    const {compileDocument,serializeHtml,walk}=window.compilerAudit,source='<Grid xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><Button x:Name="Save" Width="80" Content="Save &amp; close"/></Grid>',first=compileDocument(source,{from:'xaml',to:'html'});const button=first.document.root.children.find(n=>n.type==='body').children[0].children.find(n=>n.type==='button');button.props.style=button.props.style.replace('width: 80px','width: 125px');const edited=serializeHtml(first.document),back=compileDocument(edited,{from:'html',to:'xaml'});let width;walk(back.document.root,node=>{if(node.type==='Button')width=node.props.Width;});return {width,maps:[...first.sourceMap.map(map=>({source:map.sourceRange?source.slice(map.sourceRange.start,map.sourceRange.end):'',target:map.targetRange?first.source.slice(map.targetRange.start,map.targetRange.end):''})),...back.sourceMap.map(map=>({source:map.sourceRange?edited.slice(map.sourceRange.start,map.sourceRange.end):'',target:map.targetRange?back.source.slice(map.targetRange.start,map.targetRange.end):''}))]};
  });
  assert.equal(maps.width,'125');for(const map of maps.maps){assert.match(map.source,/^</);assert.match(map.target,/^</);assert.ok(map.target.endsWith('>'));}
  assert.deepEqual(runtimeErrors,[]);console.log('PASS semantic source maps: original and edited target spans reference actual syntax, CSS width edits survive reverse conversion');
  console.log('Browser semantic compiler correctness passed.');
}catch(error){
  if(page){
    await Promise.allSettled(consoleCapture);
    const state=await page.evaluate(()=>({url:location.href,body:document.body?.innerText.slice(0,12000)||'',editorStatus:document.querySelector('.code-message')?.textContent||'',recovery:!!document.querySelector('#recover-workspace')})).catch(error=>({diagnosticError:error.message}));
    const diagnostics={error:error.stack||error.message,runtimeErrors,consoleErrors,state};
    await mkdir('test-results',{recursive:true});
    await writeFile('test-results/browser-semantic-compiler-failure.json',JSON.stringify(diagnostics,null,2));
    await page.screenshot({path:'test-results/browser-semantic-compiler-failure.png',fullPage:true}).catch(()=>{});
    console.error('Browser errors:',runtimeErrors);console.error('Browser console errors:',consoleErrors);
    console.error('Editor status:',state.editorStatus);
  }
  throw error;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
