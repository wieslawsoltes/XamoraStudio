import { PropertyGrid } from '../../controls/property-grid.js';

const model = { Title: 'Preview card', Width: 320, Enabled: true, Theme: 'light', Accent: '#007acc', Id: 'card-1' };
let transactions = 0;
function show() {
  document.querySelector('#result').textContent = JSON.stringify(model, null, 2);
  document.querySelector('#count').textContent = `${transactions} accepted transactions`;
}
const grid = new PropertyGrid(document.querySelector('#properties'), {
  properties: [
    { name: 'Title', value: model.Title, group: 'Content', required: true, defaultValue: 'Preview card' },
    { name: 'Width', type: 'number', value: model.Width, group: 'Layout', min: 0, max: 2000, defaultValue: 320 },
    { name: 'Enabled', type: 'boolean', value: model.Enabled, group: 'Behavior', defaultValue: true },
    { name: 'Theme', value: model.Theme, group: 'Appearance', options: ['light', 'dark', 'system'], defaultValue: 'light' },
    { name: 'Accent', type: 'color', value: model.Accent, group: 'Appearance', defaultValue: '#007acc' },
    { name: 'Id', value: model.Id, group: 'Identity', readOnly: true, resettable: false },
  ],
  onChange({ name, value }) {
    if (name === 'Width' && value > 1200) return 'This application limits Width to 1200.';
    if (value === undefined) delete model[name];
    else model[name] = value;
    transactions++;
    show();
  },
});
show();
window.propertyGridLab = { grid, model };
window.addEventListener('pagehide', () => grid.dispose(), { once: true });
