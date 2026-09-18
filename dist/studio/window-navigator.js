import { locatePanel } from '../core/docking.js';
import { filePath } from '../core/solution.js';
import { esc } from './ui.js';
import { icon } from './icons.js';

const normalize = (text) =>
  String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
const scopes = [
  ['all', 'All windows'],
  ['documents', 'Documents'],
  ['tools', 'Tools'],
  ['closed', 'Closed'],
  ['browser', 'Browser windows'],
];

/** Read-only presentation of the current registry, including closed and dependent windows. */
export function windowEntries(studio) {
  const { model, control } = studio.docking;
  const docs = new Map((studio.stores || []).map((store) => [store.document.id, store.document]));
  return [...model.panels.values()].map((panel) => {
    const place = locatePanel(model.state, panel.id);
    const closed = !place || place.kind === 'hidden';
    const browser = !!(place?.floating && control.windows?.get(place.floating.id));
    const location = closed
      ? 'Closed'
      : place.kind === 'autoHide'
        ? `Auto-hidden · ${place.edge}`
        : browser
          ? 'Browser window'
          : place.floating?.browserWindow
            ? 'Main window · saved popup'
            : place.floating
              ? 'Floating panel'
              : 'Main window';
    const active = model.state.activePanel === panel.id;
    const visible = !closed && !!control.visible.has(panel.id);
    const doc = docs.get(panel.documentId);
    return {
      id: panel.id,
      title: String(panel.title || panel.id),
      icon: panel.icon || (panel.kind === 'document' ? '◇' : '▤'),
      path: doc ? filePath(doc) : panel.id === 'xaml' && studio.doc ? filePath(studio.doc) : '',
      kind: panel.kind === 'document' ? 'document' : 'tool',
      location,
      closed,
      browser,
      active,
      visible,
      status: closed
        ? 'Reopen'
        : active
          ? 'Active'
          : visible
            ? 'Visible tab'
            : place.kind === 'autoHide'
              ? 'Reveal'
              : 'Background tab',
    };
  });
}

/** Bounded, accent-insensitive search; names rank ahead of file paths and location labels. */
export function searchWindows(entries, query = '', { scope = 'all', limit = 80 } = {}) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const ranked = [];
  for (const [index, entry] of entries.entries()) {
    if (
      (scope === 'documents' && entry.kind !== 'document') ||
      (scope === 'tools' && entry.kind !== 'tool') ||
      (scope === 'closed' && !entry.closed) ||
      (scope === 'browser' && !entry.browser)
    )
      continue;
    const title = normalize(entry.title),
      context = normalize(`${entry.path} ${entry.location} ${entry.kind} ${entry.status}`);
    let score = 0;
    for (const term of terms) {
      const value =
        title === term
          ? 100
          : title.startsWith(term)
            ? 50
            : title.includes(term)
              ? 20
              : context.includes(term)
                ? 5
                : -1;
      if (value < 0) {
        score = -1;
        break;
      }
      score += value;
    }
    if (score >= 0) ranked.push({ entry, score, index });
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.entry.active) - Number(a.entry.active) ||
      Number(a.entry.closed) - Number(b.entry.closed) ||
      Number(b.entry.visible) - Number(a.entry.visible) ||
      a.index - b.index,
  );
  return {
    total: ranked.length,
    items: ranked.slice(0, Math.max(1, limit)).map(({ entry }) => entry),
  };
}

/** Search and activate existing windows; never duplicates documents or allocates unsolicited popups. */
export class WindowNavigator {
  constructor(studio) {
    this.studio = studio;
    this.previous = studio.docking.navigator;
    this.openRoute = () => this.open();
    studio.docking.navigator = this.openRoute;
    this.onPageHide = (event) => {
      if (!event.persisted) this.dispose();
    };
    studio.docking.control.window.addEventListener('pagehide', this.onPageHide);
  }
  open() {
    if (this.disposed) return;
    this.cleanup?.();
    const s = this.studio,
      { model, control } = s.docking;
    s.modal(
      'Window navigator',
      `<div class="ux-window-browser">
      <label class="ux-window-search" for="dock-window-search">${icon('search')}<input id="dock-window-search" aria-label="Find a window" placeholder="Search names, file paths, or locations…" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="dock-window-list" aria-describedby="ux-window-hint" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></label>
      <div class="ux-window-filters" role="group" aria-label="Window filters">${scopes.map(([id, label]) => `<button type="button" data-window-scope="${id}" aria-pressed="${id === 'all'}">${label}</button>`).join('')}</div>
      <div class="ux-window-summary" role="status" aria-live="polite" aria-atomic="true"></div>
      <div id="dock-window-list" class="dock-window-list ux-window-list" role="listbox" aria-label="Matching windows"></div>
      <div class="ux-window-empty" hidden><strong>No matching windows</strong><p>Try a file name, folder, or panel such as Properties.</p><button type="button" class="button" data-window-clear>Clear search and filters</button></div>
      <footer id="ux-window-hint"><span><kbd>↑</kbd> <kbd>↓</kbd> select · <kbd>Enter</kbd> open</span><span>Closed editors stay in your solution.</span></footer>
    </div>`,
      [],
      true,
    );
    const host = s.dialogHost,
      dialog = host.element,
      signal = host.signal;
    dialog.classList.add('ux-window-dialog');
    this.dialog = dialog;
    const input = dialog.querySelector('#dock-window-search'),
      list = dialog.querySelector('#dock-window-list');
    let scope = 'all',
      results = [],
      selected = -1,
      composing = false,
      disposed = false;
    const current = () => !disposed && !this.disposed && host.element === dialog;
    const select = (index, reveal = true) => {
      selected = results.length ? Math.max(0, Math.min(index, results.length - 1)) : -1;
      [...list.children].forEach((row, i) =>
        row.setAttribute('aria-selected', String(i === selected)),
      );
      const row = list.children[selected];
      if (row) {
        input.setAttribute('aria-activedescendant', row.id);
        if (reveal) row.scrollIntoView?.({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    };
    const render = () => {
      if (!current()) return;
      const previous = results[selected]?.id,
        scroll = list.scrollTop;
      const result = searchWindows(windowEntries(s), input.value, { scope });
      results = result.items;
      list.innerHTML = results
        .map(
          (entry, i) =>
            `<button type="button" id="ux-window-${i}" data-show-dock="${esc(entry.id)}" role="option" tabindex="-1" aria-selected="false"><span class="ux-window-glyph" aria-hidden="true">${esc(entry.icon)}</span><span class="ux-window-copy"><strong>${esc(entry.title)}</strong><small>${esc(entry.path || (entry.kind === 'document' ? 'Document surface' : 'Tool panel'))} · ${esc(entry.status)}</small></span><span class="ux-window-location">${esc(entry.location)}</span></button>`,
        )
        .join('');
      dialog.querySelector('.ux-window-summary').textContent =
        result.total > results.length
          ? `${results.length} of ${result.total} windows · refine your search to see more`
          : `${result.total} ${result.total === 1 ? 'window' : 'windows'}`;
      dialog.querySelector('.ux-window-empty').hidden = !!results.length;
      list.hidden = !results.length;
      input.setAttribute('aria-expanded', String(!!results.length));
      const index = results.findIndex((entry) => entry.id === previous);
      select(index < 0 ? 0 : index, index < 0);
      if (index >= 0) list.scrollTop = scroll;
    };
    const run = (id) => {
      if (!current() || composing) return;
      if (!model.panels.has(id)) {
        render();
        host.showError('This window is no longer available. Choose another window.');
        return;
      }
      try {
        // Keep the search and its context intact when source validation rejects activation.
        if (control.show(id) === false) {
          if (current())
            host.showError(
              'This window could not be opened. Fix or restore the current source draft, then try again.',
            );
          return;
        }
        // A host callback may have opened a different dialog while activating. Do not close it.
        if (!current()) return;
        host.close(false);
        control.focus(id);
      } catch (error) {
        if (current()) host.showError(error?.message || String(error));
      }
    };
    const listen = (target, type, handler) => {
      target.addEventListener(type, handler);
      cleanups.push(() => target.removeEventListener(type, handler));
    };
    const cleanups = [];
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      cleanups
        .splice(0)
        .reverse()
        .forEach((fn) => fn());
      if (this.cleanup === cleanup) this.cleanup = null;
      if (this.dialog === dialog) this.dialog = null;
    };
    this.cleanup = cleanup;
    signal.addEventListener('abort', cleanup, { once: true });
    cleanups.push(() => signal.removeEventListener('abort', cleanup));
    listen(model, 'change', render);
    for (const store of s.stores || []) listen(store, 'change', render);
    listen(input, 'compositionstart', () => {
      composing = true;
    });
    listen(input, 'compositionend', () => {
      composing = false;
      render();
    });
    listen(input, 'input', (event) => {
      if (!composing && !event.isComposing) {
        host.showError('');
        render();
      }
    });
    listen(input, 'keydown', (event) => {
      if (
        composing ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        select(selected + { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[event.key]);
      } else if (event.key === 'Enter' && !event.repeat) {
        event.preventDefault();
        event.stopPropagation();
        if (results[selected]) run(results[selected].id);
      }
    });
    listen(list, 'pointerdown', (event) => {
      // Do not cancel touch scrolling while suppressing mouse focus jumps out of search.
      if (event.pointerType === 'mouse' && event.button === 0) event.preventDefault();
    });
    listen(list, 'click', (event) => {
      const row = event.target.closest('[data-show-dock]');
      if (row && list.contains(row)) run(row.dataset.showDock);
    });
    for (const button of dialog.querySelectorAll('[data-window-scope]'))
      listen(button, 'click', () => {
        scope = button.dataset.windowScope;
        for (const b of dialog.querySelectorAll('[data-window-scope]'))
          b.setAttribute('aria-pressed', String(b === button));
        host.showError('');
        render();
        input.focus();
      });
    listen(dialog.querySelector('[data-window-clear]'), 'click', () => {
      input.value = '';
      dialog.querySelector('[data-window-scope="all"]').click();
    });
    render();
    return dialog;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const dialog = this.dialog;
    this.cleanup?.();
    if (dialog && this.studio.dialogHost.element === dialog) this.studio.dialogHost.close();
    const docking = this.studio.docking;
    if (docking.navigator === this.openRoute) docking.navigator = this.previous;
    docking.control.window.removeEventListener('pagehide', this.onPageHide);
  }
}
