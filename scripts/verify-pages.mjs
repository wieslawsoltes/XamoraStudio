/** Verify the published static bytes, including the nested HTML authoring module. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=process.env.PAGES_URL||'https://wieslawsoltes.github.io/XamoraStudio/';
const files=['index.html','app.js','studio/html-workspace.js','core/html.js','styles/density.css','examples/DockingDemo.html','core/document-session.js','core/source-syntax.js','studio/document-sync.js','core/html-animation.js','studio/html-animation-workspace.js','styles/html-animation.css'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const expected=new Map(await Promise.all(files.map(async path=>[path,digest(await readFile(new URL('../dist/'+path,import.meta.url)))])));
let failure='';
for(let attempt=0;attempt<30;attempt++){
 try{
  for(const path of files){const url=new URL(path,base);url.searchParams.set('verify',process.env.GITHUB_SHA||String(Date.now()));const response=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{'cache-control':'no-cache'}});if(!response.ok)throw Error(path+': HTTP '+response.status);if(digest(Buffer.from(await response.arrayBuffer()))!==expected.get(path))throw Error(path+': published bytes do not match this commit');}
  console.log('Verified '+files.length+' deployed files at '+base);process.exit(0);
 }catch(error){failure=error.message;console.log('Waiting for Pages ('+(attempt+1)+'/30): '+failure);if(attempt<29)await new Promise(resolve=>setTimeout(resolve,10000));}
}
throw Error('Pages publication did not match: '+failure);
