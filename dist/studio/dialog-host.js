/** Studio compatibility adapter over the reusable modal host. */
import { DialogHost } from '../controls/dialog-host.js';
import { $ } from './ui.js';
import { icon } from './icons.js';

export function modal(studio, title, body, actions = [], wide = false) {
  const root = $('#modal-root');
  if (studio.dialogHost?.host !== root || studio.dialogHost?.disposed) {
    studio.dialogHost?.dispose();
    studio.dialogHost = new DialogHost(root);
  }
  studio.modalPrevious = document.activeElement;
  const dialog = studio.dialogHost.open({ title, html: body, actions, wide });
  const close = dialog.querySelector('[data-dialog-close]');
  close.id = 'close-modal';
  close.innerHTML = icon('close');
  const cancel = dialog.querySelector('[data-dialog-cancel]');
  if (cancel) cancel.id = 'cancel-modal';
}

export function closeModal(studio) {
  if (studio.dialogHost) studio.dialogHost.close();
  else $('#modal-root')?.replaceChildren();
}
