import { ObjectPropertyGrid } from '../../controls/object-property-grid.js';
const undo = [], redo = [];
let value = {name:'Xamora', theme:{accent:'#4688e8', spacing:8}, items:[{label:'First', enabled:true}, {label:'Second', enabled:false}]};
const render = () => {document.querySelector('#output').textContent = JSON.stringify(value,null,2);};
const grid = new ObjectPropertyGrid(document.querySelector('#grid'), {value, expandedDepth:2, onChange(change){undo.push(value);redo.length=0;value=change.next;render();}});
document.querySelector('#undo').onclick = () => {if(undo.length){redo.push(value);value=undo.pop();grid.setValue(value);render();}};
document.querySelector('#redo').onclick = () => {if(redo.length){undo.push(value);value=redo.pop();grid.setValue(value);render();}};
render();
window.nestedPropertiesLab = {grid, get value(){return value;}};
