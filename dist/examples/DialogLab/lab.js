import { DialogHost } from '../../controls/dialog-host.js';
const dialog = new DialogHost(document.querySelector('#dialog-root'));
const details = new DialogHost(document.querySelector('#details-root'));
const profile = document.querySelector('#profile');
const input = document.querySelector('#name');
const result = document.querySelector('#result');
document.querySelector('#open').onclick = () => {
  dialog.open({
    title: 'Edit profile',
    content: profile,
    actions: [
      { label: 'Details', run: () => details.open({ title: 'Independent dialog', content: 'Closing this dialog restores the profile editor below it.' }) },
      { label: 'Save', primary: true, closeOnSuccess: true, run() {
        const name = input.value.trim();
        if (!name) throw Error('A profile name is required.');
        result.textContent = 'Saved profile: ' + name;
      } },
    ],
  });
};
window.dialogLab = { dialog, details };
window.addEventListener('pagehide', () => { details.dispose(); dialog.dispose(); });
