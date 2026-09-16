export const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
/** A notifier owns its timer so existing toast channels remain independent. */
export function createNotifier(duration = 3500) {
  return function notify(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => el.classList.remove('show'), duration);
  };
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
