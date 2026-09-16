import { CodeEditor } from '../../controls/code-editor.js';
let tokenizations=0;
const editor = new CodeEditor(document.querySelector('#editor'), {
  language:'Rows', virtualization:{threshold:1000,overscan:8},
  languageProvider:{tokenize:source=>{tokenizations++;return [{text:source,kind:'comment'}];}}
});
const source=Array.from({length:100000},(_,i)=>`row ${i+1}: `+(i===49999?'wide content '.repeat(200):'<safe>')).join('\n');
function update(){document.querySelector('#stats').textContent=`${editor.viewport.renderedLines} rendered rows / ${editor.viewport.lineCount} total; ${tokenizations} tokenizations`;}
function reveal(line){const at=editor.lineIndex.offsetAt(line);editor.input.setSelectionRange(at,at);editor.reveal(at);editor.focus();update();}
function reload(){editor.setValue(source,{force:true});editor.reveal(0);update();}
document.querySelector('#middle').onclick=()=>reveal(50000);
document.querySelector('#end').onclick=()=>reveal(99999);
document.querySelector('#reload').onclick=reload;
editor.input.addEventListener('scroll',()=>requestAnimationFrame(update));
editor.input.addEventListener('input',()=>requestAnimationFrame(update));
reload();window.virtualEditorLab={editor,get tokenizations(){return tokenizations;}};
