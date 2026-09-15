import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceDensity,DENSITY_KEY} from '../dist/controls/workspace-density.js';
import {DensityWorkspace} from '../dist/studio/density-workspace.js';
import {dockMinimum,dockGroup,dockSplit,dockRatioLimits} from '../dist/core/docking.js';
import {XamlEditor} from '../dist/core/editor.js';
import {installDockDOM} from './docking-dom.mjs';

test('density defaults to Compact, validates preferences, and tolerates unavailable storage',()=>{
  const root={dataset:{}},storage={getItem(){throw Error('disabled');},setItem(){throw Error('disabled');}};
  const density=new WorkspaceDensity({root,storage});assert.equal(density.value,'compact');
  density.set('comfortable');assert.equal(root.dataset.density,'comfortable');
  assert.throws(()=>density.set('tiny'));assert.equal(density.value,'comfortable');
  assert.equal(new WorkspaceDensity({root,storage:{getItem:()=>'<script>'}}).value,'compact');
});
test('density persists and restores without duplicate change notifications',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},root={dataset:{}};
  const density=new WorkspaceDensity({root,storage});let changes=0;density.addEventListener('change',()=>changes++);
  density.set('standard');density.set('standard');assert.equal(changes,1);assert.equal(values.get(DENSITY_KEY),'standard');
  assert.equal(new WorkspaceDensity({root,storage}).value,'standard');
  density.set('comfortable',{persist:false});assert.equal(values.get(DENSITY_KEY),'standard');
});
test('switching density retains the live editor buffer, caret, scroll, and document state',()=>{
  const dom=installDockDOM();document.documentElement=dom.element('html');const input=dom.element('textarea');input.value='<Grid>pending';input.setSelectionRange(2,7);input.scrollTop=96;document.body.append(input);input.focus();
  const state={doc:{name:'Main.xaml'},history:['edit'],dock:{ratio:.64},zoom:.7,pan:{x:20,y:30}};const before=JSON.stringify(state);let resized=0;
  const studio={...state,render(){throw Error('Density must not rerender live document controls');},docking:{control:{},resize(){resized++;}},direct:{},timeline:{applyZoom(){}},features:{prototype:{drawConnections(){}}}};
  const density=new DensityWorkspace(studio),host=dom.element('nav');document.body.append(host);density.mount(host);density.set('comfortable');
  assert.equal(input.value,'<Grid>pending');assert.deepEqual([input.selectionStart,input.selectionEnd,input.scrollTop],[2,7,96]);assert.equal(document.activeElement,input);assert.equal(JSON.stringify({doc:studio.doc,history:studio.history,dock:studio.dock,zoom:studio.zoom,pan:studio.pan}),before);assert.equal(density.select.value,'comfortable');assert.equal(resized,1);assert.equal(density.select.children.length,3);density.dispose();
});
test('dock minimum sizes use density chrome metrics recursively while splitters stay five pixels',()=>{
  const panels=new Map([['a',{}],['b',{}]]),split=dockSplit('vertical',dockGroup(['a']),dockGroup(['b']));
  assert.equal(dockMinimum(split,panels,{chromeHeight:46}).height,297);
  assert.equal(dockMinimum(split,panels,{chromeHeight:62}).height,329);
  assert.deepEqual(dockRatioLimits(split,panels,405,{chromeHeight:46}),[.365,.635]);
});
test('source reveal uses the displayed code line height',()=>{
  const input={value:Array.from({length:20},()=>'<Grid/>').join('\n'),scrollTop:0},editor=Object.assign(Object.create(XamlEditor.prototype),{input,highlight:{},lines:{}}),previous=globalThis.getComputedStyle;
  try{globalThis.getComputedStyle=()=>({lineHeight:'18px'});editor.reveal(input.value.length);assert.equal(input.scrollTop,288);assert.equal(editor.highlight.scrollTop,input.scrollTop);assert.equal(editor.lines.scrollTop,input.scrollTop);}finally{if(previous)globalThis.getComputedStyle=previous;else delete globalThis.getComputedStyle;}
});
