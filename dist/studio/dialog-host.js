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
  // Replacing one application dialog with another retains the original editor, not a
  // soon-to-be-detached button from the previous dialog (e.g. Layouts -> Navigator).
  const previous = studio.dialogHost.isOpen
    ? studio.modalPrevious
    : studio.documentScope?.activeElement || document.activeElement;
  studio.modalPrevious = previous;
  const restore = () => {
    if (previous?.isConnected && !previous.closest('[hidden],[inert]')) {
      previous.ownerDocument.defaultView?.focus();
      previous.focus({ preventScroll: true });
    }
  };
  root.ownerDocument.defaultView?.focus();
  const dialog = studio.dialogHost.open({ title, html: body, actions, wide, returnFocus: restore });
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
