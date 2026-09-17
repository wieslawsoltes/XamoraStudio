import { InspectorDisclosure } from './inspector-disclosure.js';
import { CommandPalette } from './command-palette.js';
import { commandCatalog } from './command-search.js';
import { notify } from './ui.js';
import { icon } from './icons.js';

/** Presentation-only Studio workspace: no changes to authored markup or saved docking layouts. */
export class ExperienceWorkspace {
  constructor(studio) {
    this.studio = studio;
    studio.experience = this;
    this.cleanups = [];
    this.palette = new CommandPalette(studio);
    this.inspector = new InspectorDisclosure();
    const renderInspector = studio.renderInspector;
    const decorateInspector = (...args) => {
      const result = renderInspector.apply(studio, args);
      this.inspector.decorate(studio.docking.control.contents.get('properties'));
      return result;
    };
    studio.renderInspector = decorateInspector;
    this.inspector.decorate(studio.docking.control.contents.get('properties'));
    this.cleanups.push(() => {
      if (studio.renderInspector === decorateInspector) studio.renderInspector = renderInspector;
      this.inspector.restore(studio.docking.control.contents.get('properties'));
    });
    const palette = studio.commandPalette;
    const open = () => {
      const target = this.commandTarget;
      this.commandTarget = null;
      this.palette.open(target);
    };
    studio.commandPalette = open;
    this.cleanups.push(() => {
      if (studio.commandPalette === open) studio.commandPalette = palette;
    });
    const command = document.querySelector('.top-command');
    if (command) {
      command.classList.add('ux-command-trigger');
      command.innerHTML = `${icon('search')}<span>Search commands…</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} K</kbd>`;
      command.setAttribute('aria-label', 'Search commands, files, and windows');
      command.setAttribute('aria-haspopup', 'dialog');
      this.listen(command, 'pointerdown', () => {
        this.commandTarget = studio.documentScope?.activeElement || document.activeElement;
      });
      this.listen(command, 'pointercancel', () => {
        this.commandTarget = null;
      });
      this.listen(command, 'blur', () => {
        this.commandTarget = null;
      });
    }
    for (const [id, label] of [
      ['preview', 'Preview design'],
      ['export', 'Export design'],
    ]) {
      const button = document.querySelector(`.topbar [data-action="${id}"]`);
      button?.setAttribute('aria-label', label);
      button?.setAttribute('title', label);
    }
    const guide = document.createElement('button');
    guide.className = 'icon-button ux-guide-trigger';
    guide.type = 'button';
    guide.innerHTML = icon('help');
    guide.title = 'Workspace guide';
    guide.setAttribute('aria-label', guide.title);
    guide.setAttribute('aria-haspopup', 'dialog');
    document.querySelector('.top-command')?.after(guide);
    this.listen(guide, 'click', () => this.guide());
    this.cleanups.push(() => guide.remove());
    const helpMenu = studio.menus.menus.find((menu) => menu.label === 'Help');
    this.guideCommand = {
      id: 'experience:guide',
      label: 'Workspace guide',
      run: () => this.guide(),
    };
    helpMenu?.children.unshift(this.guideCommand);
    studio.menus.commands.set(this.guideCommand.id, this.guideCommand);
    this.cleanups.push(() => {
      const index = helpMenu?.children.indexOf(this.guideCommand);
      if (index >= 0) helpMenu.children.splice(index, 1);
      studio.menus.commands.delete(this.guideCommand.id);
    });
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'ux-skip';
    skip.textContent = 'Skip to active editor';
    this.listen(skip, 'click', () => {
      const id = studio.docking.model.state.activePanel;
      if (id) studio.docking.control.focus(id);
    });
    document.querySelector('#app').prepend(skip);
    this.cleanups.push(() => skip.remove());
    for (const name of ['setTool', 'setView']) {
      const previous = studio[name];
      const update = (...args) => {
        const result = previous.apply(studio, args);
        this.sync();
        return result;
      };
      studio[name] = update;
      this.cleanups.push(() => {
        if (studio[name] === update) studio[name] = previous;
      });
    }
    const original = studio.renderStatus;
    const renderStatus = (...args) => {
      const result = original.apply(studio, args);
      this.sync();
      return result;
    };
    studio.renderStatus = renderStatus;
    this.cleanups.push(() => {
      if (studio.renderStatus === renderStatus) studio.renderStatus = original;
    });
    this.listen(studio.docking.model, 'change', () => this.schedule());
    this.listen(document.querySelector('.toolbar'), 'click', () => this.schedule());
    this.listen(window, 'pagehide', (event) => {
      if (!event.persisted) this.dispose();
    });
    this.sync();
  }
  listen(target, event, fn) {
    target?.addEventListener(event, fn);
    this.cleanups.push(() => target?.removeEventListener(event, fn));
  }
  schedule() {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.sync();
    });
  }
  sync() {
    if (this.disposed) return;
    const s = this.studio;
    for (const button of document.querySelectorAll('.toolbar [data-tool]'))
      button.setAttribute('aria-pressed', String(s.tool === button.dataset.tool));
    for (const button of document.querySelectorAll('.toolbar [data-view]'))
      button.setAttribute('aria-pressed', String(s.view === button.dataset.view));
    document.querySelector('.view-toggle')?.setAttribute('aria-label', 'Editor mode');
    document.querySelector('.view-toggle')?.setAttribute('role', 'group');
    document.querySelector('#snap-state')?.setAttribute('aria-pressed', String(s.snap));
    const title = document.querySelector('.file-title');
    if (title) {
      title.textContent = s.doc.name;
      title.title = s.doc.name;
    }
    document.title = `${s.doc.name} — Xamora Studio`;
    const save = document.querySelector('#save-state');
    if (save) {
      save.setAttribute('role', 'status');
      save.setAttribute('aria-live', 'polite');
      save.setAttribute('aria-atomic', 'true');
      save.title =
        'Stored in this browser on this device. Save or export a project file for a portable backup.';
    }
    const problems = document.querySelector('#problems-button');
    if (problems) {
      problems.title = 'Open problems and diagnostics';
      problems.setAttribute('aria-label', `Open problems: ${problems.textContent.trim()}`);
    }
  }
  guide() {
    const s = this.studio;
    const catalog = new Map(commandCatalog(s.menus.menus).map((command) => [command.id, command]));
    const cards = [
      [
        'file',
        'Start with a document',
        'Create a XAML view or HTML page, or add existing files to your solution.',
        'new:UserControl',
        'New XAML view',
        'new-html',
        'New HTML page',
      ],
      [
        'pointer',
        'Build visually',
        'Insert controls, select a layer, then edit its properties. Design and source share the same document.',
        'window:toolkit',
        'Open toolkit',
        'window:properties',
        'Open properties',
      ],
      [
        'layers',
        'Make room for your work',
        'Choose a layout, find a hidden panel, or detach a tab using its window actions.',
        'window-navigator',
        'Find a window',
        'window-layouts',
        'Manage layouts',
      ],
      [
        'code',
        'Validate and deliver',
        'Check source errors, then export your design and save a portable project backup.',
        'problems',
        'Review problems',
        'export',
        'Export design',
      ],
    ];
    s.modal(
      'Your workspace, your way',
      `<div class="ux-guide"><div class="ux-guide-intro"><span class="badge">WORKSPACE GUIDE</span><h3>From an idea to a working interface.</h3><p>A few useful starting points. Every command is also available from search.</p></div><div class="ux-guide-grid">${cards.map(([glyph, title, description, first, firstLabel, second, secondLabel]) => `<section class="ux-guide-card">${icon(glyph)}<h4>${title}</h4><p>${description}</p><div><button type="button" class="button" data-guide-command="${first}">${firstLabel}</button><button type="button" class="button quiet" data-guide-command="${second}">${secondLabel}</button></div></section>`).join('')}</div><div class="ux-guide-note"><strong>Local by design.</strong> Your workspace is stored in this browser, not synced to a cloud account. Export your project to keep a portable backup.</div><div class="ux-guide-footer"><button type="button" class="button primary" data-guide-command="commands">Search all commands</button><button type="button" class="button" data-guide-command="add-files">Add existing files</button><button type="button" class="button" data-guide-command="help">Keyboard shortcuts</button></div></div>`,
      [],
      true,
    );
    const root = s.dialogHost.element;
    root.classList.add('ux-guide-dialog');
    for (const button of root.querySelectorAll('[data-guide-command]'))
      button.onclick = () => {
        const id = button.dataset.guideCommand;
        s.closeModal();
        const command = catalog.get(id);
        try {
          if (command && !s.menus.bar.value(command.enabled, true)) {
            notify('This command is unavailable in the current context.');
            return;
          }
          Promise.resolve(command ? command.run() : s.command(id)).catch((error) =>
            notify(error.message || String(error)),
          );
        } catch (error) {
          notify(error.message || String(error));
        }
      };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.cleanups
      .splice(0)
      .reverse()
      .forEach((cleanup) => cleanup());
    this.commandTarget = null;
  }
}
