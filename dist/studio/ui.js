export const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const portalRoots = new Set();
/** Register only app-owned popup documents; explicit query roots remain strictly scoped. */
export function registerUIRoot(root) {
  portalRoots.add(root);
  return () => portalRoots.delete(root);
}
export const $ = (selector, root = document) =>
  root.querySelector(selector) ||
  (root === globalThis.document
    ? [...portalRoots].map((portal) => portal.querySelector(selector)).find(Boolean)
    : null) ||
  null;
export const $$ = (selector, root = document) => [
  ...new Set([
    ...root.querySelectorAll(selector),
    ...(root === globalThis.document
      ? [...portalRoots].flatMap((portal) => [...portal.querySelectorAll(selector)])
      : []),
  ]),
];
export function listenStudio(studio, target, type, callback, options) {
  if (studio.documentScope) return studio.documentScope.listen(target, type, callback, options);
  target.addEventListener(type, callback, options);
  return () => target.removeEventListener(type, callback, options);
}
const notices = new WeakMap();
/** Toast channels share ownership of their surface; an older timer cannot hide a newer message. */
export function createNotifier(duration = 3500) {
  function notify(message) {
    const el = $('#toast');
    if (!el) return;
    notices.get(el)?.clear();
    const state = {
      hovered: false,
      focused: false,
      timer: null,
      cleanups: [],
      previous: el.ownerDocument?.activeElement,
    };
    const clear = () => {
      clearTimeout(state.timer);
      state.cleanups.splice(0).forEach((cleanup) => cleanup());
    };
    const dismiss = () => {
      if (notices.get(el) !== state) return;
      clear();
      notices.delete(el);
      el.classList.remove('show');
      if (
        el.contains?.(el.ownerDocument?.activeElement) &&
        state.previous?.isConnected &&
        !el.contains(state.previous) &&
        !state.previous.closest('[inert],[hidden]')
      )
        state.previous.focus?.({ preventScroll: true });
    };
    const schedule = () => {
      clearTimeout(state.timer);
      if (state.hovered || state.focused) return;
      notify.timer = state.timer = setTimeout(dismiss, duration);
    };
    Object.assign(state, { clear, dismiss, owner: notify });
    notices.set(el, state);
    el.textContent = String(message ?? '');
    if (el.ownerDocument) {
      const text = el.ownerDocument.createElement('span');
      text.className = 'toast-message';
      text.textContent = String(message ?? '');
      const close = el.ownerDocument.createElement('button');
      close.type = 'button';
      close.className = 'toast-dismiss';
      close.textContent = '×';
      close.setAttribute('aria-label', 'Dismiss notification');
      close.onclick = dismiss;
      el.replaceChildren(text, close);
      const listen = (name, callback) => {
        el.addEventListener(name, callback);
        state.cleanups.push(() => el.removeEventListener(name, callback));
      };
      listen('pointerenter', () => {
        state.hovered = true;
        schedule();
      });
      listen('pointerleave', () => {
        state.hovered = false;
        schedule();
      });
      listen('focusin', () => {
        state.focused = true;
        schedule();
      });
      listen('focusout', (event) => {
        state.focused = el.contains(event.relatedTarget);
        schedule();
      });
      listen('keydown', (event) => {
        if (event.key === 'Escape') dismiss();
      });
      state.cleanups.push(() => {
        close.onclick = null;
      });
    }
    el.classList.add('show');
    schedule();
  }
  return notify;
}
export const notify = createNotifier();
export const toast = createNotifier(3400);
export function saveFile(name, content, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type: mime })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const field = (name, label, value = '', type = 'text') =>
  `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}"></label>`;
export function select(name, label, options, value = '') {
  return `<label>${esc(label)}<select name="${name}">${options
    .map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`;
    })
    .join('')}</select></label>`;
}

/** The base designer historically downloads plain text unless a type is supplied. */
export function download(name, content, type = 'text/plain') {
  return saveFile(name, content, type);
}
