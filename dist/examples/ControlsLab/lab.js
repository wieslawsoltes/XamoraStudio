import { DockLayout, DockWorkspace, dockGroup, dockSplit } from '../../controls/docking.js';
const model = new DockLayout([
  { id: 'editor', title: 'Code editor', kind: 'document' },
  { id: 'properties', title: 'Properties', kind: 'tool' },
  { id: 'outline', title: 'Outline', kind: 'tool' },
]);
model.transaction('Initial layout', state => {
  state.root = dockSplit('horizontal', dockGroup(['outline']), dockSplit('horizontal', dockGroup(['editor'], 'document'), dockGroup(['properties']), 0.7), 0.2);
  state.hidden = []; state.activePanel = 'editor';
});
const control = new DockWorkspace(document.querySelector('#workspace'), model);
const editor = document.createElement('textarea'); editor.className = 'lab-text'; editor.value = 'Dock this live editor. Its text and selection are retained.'; editor.setAttribute('aria-label', 'Example text');
control.mount('editor', editor);
for (const id of ['outline', 'properties']) {
  const panel = document.createElement('div'); panel.className = 'lab-panel';
  panel.textContent = id === 'outline' ? 'Your application owns the content of every panel.' : 'Each panel is an ordinary DOM node, not a Studio instance.';
  control.mount(id, panel);
}
control.render();
let saved = model.serialize();
const status = document.querySelector('#status');
model.addEventListener('change', event => { status.textContent = event.label; });
document.querySelector('#float').onclick = () => model.float('editor', { x: 120, y: 80, width: 500, height: 260 });
document.querySelector('#dock').onclick = () => model.dockBack('editor');
document.querySelector('#undo').onclick = () => model.undo();
document.querySelector('#save').onclick = () => { saved = model.serialize(); status.textContent = 'Layout saved'; };
document.querySelector('#restore').onclick = () => model.load(saved);
window.controlsLab = { model, control, editor };
