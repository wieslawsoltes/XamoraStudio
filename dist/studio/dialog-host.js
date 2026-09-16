/** Accessible modal presentation and focus management. */
import { $, $$, esc } from './ui.js';
import { icon } from './icons.js';

export function modal(studio, title, body, actions = [], wide = false) {
  studio.closeModal();
  const previous = document.activeElement;
  studio.modalPrevious = previous;
  $('#modal-root').innerHTML =
    `<div class="modal-overlay"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-header"><h2>${esc(title)}</h2><button class="icon-button" id="close-modal" aria-label="Close dialog">${icon('close')}</button></div><div class="modal-body">${body}</div>${actions.length ? `<div class="modal-footer"><span class="modal-error" role="alert"></span><button class="button" id="cancel-modal">Cancel</button>${actions.map((a, i) => `<button class="button ${a.primary ? 'primary' : ''}" data-modal-action="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</section></div>`;
  $('#close-modal').onclick = () => studio.closeModal();
  $('#cancel-modal')?.addEventListener('click', () => studio.closeModal());
  $('.modal-overlay').addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('modal-overlay')) studio.closeModal();
  });
  $$('[data-modal-action]').forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await actions[Number(b.dataset.modalAction)].run();
        } catch (error) {
          $('.modal-error').textContent = error.message;
        }
      }),
  );
  $('.modal').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const nodes = $$('button,input,select,textarea,a[href]', $('.modal')).filter(
      (n) => !n.disabled && !n.hidden,
    );
    if (e.shiftKey && document.activeElement === nodes[0]) {
      e.preventDefault();
      nodes.at(-1).focus();
    } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
      e.preventDefault();
      nodes[0].focus();
    }
  });
  setTimeout(
    () =>
      $(
        '.modal-body input,.modal-body textarea,.modal-body select,.modal-body button,#close-modal',
      )?.focus(),
    0,
  );
}

export function closeModal(studio) {
  $('#modal-root').replaceChildren();
  studio.modalPrevious?.focus?.();
}
