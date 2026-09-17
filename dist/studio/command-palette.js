import {
  commandCatalog,
  searchCommands,
  readRecentCommands,
  rememberCommand,
} from './command-search.js';
import { esc, notify } from './ui.js';
import { icon } from './icons.js';

/** Studio command launcher, backed by the same live commands as the application menus. */
export class CommandPalette {
  constructor(studio, { storage } = {}) {
    this.studio = studio;
    if (storage === undefined) {
      try {
        storage = globalThis.localStorage;
      } catch {
        storage = null;
      }
    }
    this.storage = storage;
    this.recent = readRecentCommands(storage);
  }
  open(previous) {
    const s = this.studio,
      menus = s.menus;
    const target = previous || s.documentScope?.activeElement || document.activeElement;
    menus.contextTarget = target;
    const catalog = commandCatalog(menus.menus);
    s.modal(
      'Command palette',
      `
      <div class="ux-palette">
        <label class="ux-command-search" for="ide-command-search">${icon('search')}<input id="ide-command-search" placeholder="Search commands, files, or tools…" aria-label="Search commands" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="ide-command-list" aria-describedby="ux-command-hint" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></label>
        <div class="ux-palette-filters" role="group" aria-label="Command filters"><button type="button" data-command-scope="all" aria-pressed="true">All commands</button><button type="button" data-command-scope="files" aria-pressed="false">Files</button><button type="button" data-command-scope="windows" aria-pressed="false">Windows</button><span id="ux-command-count" role="status" aria-live="polite" aria-atomic="true"></span></div>
        <div class="command-list ux-command-list" id="ide-command-list" role="listbox" aria-label="Matching commands"></div>
        <div class="ux-palette-empty" hidden><strong>No commands found</strong><p>Try a menu name such as “layout”, “export”, or “animation”.</p><button type="button" class="button" data-command-clear>Clear search and filters</button></div>
        <footer class="ux-command-hint" id="ux-command-hint"><span><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>Enter</kbd> run</span><span>Commands use the current selection</span></footer>
      </div>`,
      [],
      true,
    );
    const dialog = s.dialogHost.element;
    dialog.classList.add('ux-command-dialog');
    const input = dialog.querySelector('#ide-command-search'),
      list = dialog.querySelector('#ide-command-list'),
      count = dialog.querySelector('#ux-command-count'),
      hint = dialog.querySelector('#ux-command-hint');
    let scope = 'all',
      results = [],
      active = -1;
    const enabled = (command) => menus.bar.value(command.enabled, true);
    const select = (index) => {
      active = results.length ? (index + results.length) % results.length : -1;
      [...list.children].forEach((row, i) =>
        row.setAttribute('aria-selected', String(i === active)),
      );
      const row = list.children[active];
      if (row) {
        input.setAttribute('aria-activedescendant', row.id);
        row.scrollIntoView?.({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    };
    const render = () => {
      const previousId = results[active]?.id;
      const result = searchCommands(catalog, input.value, { scope, recent: this.recent });
      results = result.items;
      list.innerHTML = results
        .map((command, i) => {
          const available = enabled(command),
            checked = menus.bar.value(command.checked, false);
          const recent = !input.value.trim() && this.recent.includes(command.id);
          return `<button type="button" id="ux-command-${i}" role="option" tabindex="-1" aria-selected="false" aria-disabled="${!available}" data-ide-command="${esc(command.id)}"><span class="ux-command-glyph" aria-hidden="true">${icon(command.id.startsWith('window:') ? 'layers' : command.category === 'File' ? 'file' : 'bolt')}</span><span class="ux-command-copy"><strong>${esc(command.label)}</strong><small>${esc(command.path)}${!available ? ' · Unavailable in this context' : recent ? ' · Recently used' : ''}</small></span>${checked ? '<span class="ux-command-check" aria-label="Enabled">✓</span>' : ''}<kbd>${esc(command.shortcut || '')}</kbd></button>`;
        })
        .join('');
      count.textContent =
        result.total > results.length
          ? `${results.length} of ${result.total} · refine to see more`
          : `${result.total} ${result.total === 1 ? 'command' : 'commands'}`;
      list.hidden = !results.length;
      dialog.querySelector('.ux-palette-empty').hidden = !!results.length;
      const old = results.findIndex((command) => command.id === previousId);
      select(old >= 0 ? old : Math.max(0, results.findIndex(enabled)));
    };
    const run = async (index) => {
      const command = results[index];
      if (!command || s.dialogHost.element !== dialog) return;
      if (!enabled(command)) {
        hint.textContent =
          'This command is unavailable for the current selection or document. Choose another command.';
        return;
      }
      // Menu context must remain the original editor, not the search field or its result.
      s.closeModal();
      menus.contextTarget = target;
      try {
        if (target?.isConnected) target.focus?.({ preventScroll: true });
        const result = command.run();
        menus.contextTarget = null;
        if ((await result) !== false && !command.id.startsWith('window:'))
          this.recent = rememberCommand(this.storage, this.recent, command.id);
      } catch (error) {
        notify(error.message || String(error));
      } finally {
        if (menus.contextTarget === target) menus.contextTarget = null;
      }
    };
    input.oninput = render;
    input.onkeydown = (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        select(active + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        void run(active);
      }
    };
    list.onpointerdown = (event) => event.preventDefault();
    list.onclick = (event) => {
      const row = event.target.closest('[data-ide-command]');
      if (row) void run(results.findIndex((command) => command.id === row.dataset.ideCommand));
    };
    for (const button of dialog.querySelectorAll('[data-command-scope]'))
      button.onclick = () => {
        scope = button.dataset.commandScope;
        for (const b of dialog.querySelectorAll('[data-command-scope]'))
          b.setAttribute('aria-pressed', String(b === button));
        render();
        input.focus();
      };
    dialog.querySelector('[data-command-clear]').onclick = () => {
      input.value = '';
      dialog.querySelector('[data-command-scope="all"]').click();
    };
    render();
  }
}
