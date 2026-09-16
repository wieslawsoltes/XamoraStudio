import { DENSITY_MODES } from '../controls/workspace-density.js';
import { isLocked } from '../core/design-tools.js';
import { MenuBar } from '../controls/menu-bar.js';
import { localName } from '../core/model.js';
import { esc, $, $$, notify } from './ui.js';
export class IdeMenu {
  constructor(s) {
    this.s = s;
    this.commands = new Map();
    const selected = () => s.selected.length > 0,
      canEdit = () => selected() && !s.selected.some((n) => isLocked(s.doc, n.id));
    const c = (id, label, run, options = {}) => {
        const nativeOnly = new Set([
          'new-brush',
          'new-gradient',
          'new-style',
          'new-template',
          'edit-template',
          'extract-control',
          'edit-brush',
          'edit-transforms',
          'edit-effects',
          'style-designer',
          'design-values',
          'visual-states',
          'native-trigger',
          'grid-editor',
          'grid-overlay',
          'animation-key',
          'binding',
          'add-resource',
        ]);
        const enabled = options.enabled;
        const command = { id, label, run: run || (() => this.runContext(id)), ...options };
        if (nativeOnly.has(id))
          command.enabled = () =>
            s.doc.framework !== 'HTML' &&
            (typeof enabled === 'function' ? enabled() : enabled !== false);
        this.commands.set(id, command);
        return command;
      },
      group = (label, children) => ({ label, children }),
      sep = { separator: true },
      cmd = (id, label, options) => c(id, label, null, options),
      view = (mode) =>
        c('view-' + mode, mode[0].toUpperCase() + mode.slice(1), () => s.setView(mode), {
          checked: () => s.view === mode,
        }),
      tool = (id, label) =>
        c('tool-' + id, label, () => s.setTool(id), { checked: () => s.tool === id });
    const panels = () =>
      [...s.docking.model.panels.values()].map((p) =>
        c('window:' + p.id, p.title || p.id, () => s.docking.control.show(p.id), {
          checked: () => s.docking.control.visible.has(p.id),
        }),
      );
    const controls = () =>
      [...new Set([...s.registry.controls.values()].map((d) => d.category))].map((category) =>
        group(
          category,
          [...s.registry.controls.values()]
            .filter((d) => d.category === category)
            .map((d) => c('insert:' + d.type, d.type, () => s.insertControl(d.type))),
        ),
      );
    const timeline = s.timeline,
      a = s.blend.animation;
    this.menus = [
      group('File', [
        group('New', [
          c('new-html', 'HTML page', () => s.html.newFile()),
          ...['UserControl', 'Window', 'ResourceDictionary', 'ControlTemplate', 'DataTemplate'].map(
            (type) => c('new:' + type, type, () => s.solution.newFile(type)),
          ),
        ]),
        c('open-solution', 'Open solution…', () => s.solution.openSolution(), {
          shortcut: 'Ctrl+Shift+O',
        }),
        c('add-files', 'Add existing XAML / HTML files…', () => s.solution.importFiles()),
        cmd('import', 'Import design or toolkit…', { shortcut: 'Ctrl+O' }),
        sep,
        c('save-solution', 'Save solution', () => s.solution.save(), { shortcut: 'Ctrl+S' }),
        cmd('export', 'Export current design…'),
        cmd('copy-xaml', 'Copy source'),
        sep,
        c(
          'close-editor',
          'Close active editor',
          () => {
            if (s.docking.model.state.activePanel)
              s.docking.control.hide(s.docking.model.state.activePanel);
          },
          { shortcut: 'Ctrl+F4', enabled: () => !!s.docking.model.state.activePanel },
        ),
        c('close-documents', 'Close all document editors', () => {
          for (const p of s.docking.model.panels.values())
            if (p.kind === 'document') s.docking.control.hide(p.id);
        }),
        cmd('history', 'Document history…'),
      ]),
      group('Edit', [
        cmd('undo', 'Undo', {
          shortcut: 'Ctrl+Z',
          enabled: () =>
            this.textTarget()
              ? this.textTarget() === s.editor.input
                ? !!s.editor.editHistory.length
                : true
              : !!s.store.history.length,
        }),
        cmd('redo', 'Redo', {
          shortcut: 'Ctrl+Shift+Z',
          enabled: () =>
            this.textTarget()
              ? this.textTarget() === s.editor.input
                ? !!s.editor.editFuture.length
                : true
              : !!s.store.future.length,
        }),
        sep,
        cmd('cut', 'Cut', {
          shortcut: 'Ctrl+X',
          enabled: () => (this.textTarget() ? this.canTextEdit() : canEdit()),
        }),
        cmd('copy', 'Copy', {
          shortcut: 'Ctrl+C',
          enabled: () =>
            this.textTarget()
              ? this.textTarget().selectionEnd > this.textTarget().selectionStart
              : selected(),
        }),
        cmd('paste', 'Paste', {
          shortcut: 'Ctrl+V',
          enabled: () => (this.textTarget() ? this.canTextEdit() : !!s.clipboard.length),
        }),
        cmd('duplicate', 'Duplicate selection', { shortcut: 'Ctrl+D', enabled: canEdit }),
        cmd('delete', 'Delete', {
          shortcut: 'Del',
          enabled: () => (this.textTarget() ? this.canTextEdit() : canEdit()),
        }),
        cmd('select-all', 'Select all', { shortcut: 'Ctrl+A' }),
        sep,
        c('inline-text', 'Edit text on canvas', () => s.editText(s.selected[0]), {
          enabled: () =>
            selected() &&
            (s.doc.framework === 'HTML' ||
              ['TextBlock', 'TextBox', 'Label', 'Button', 'Run'].includes(
                localName(s.selected[0].type),
              )),
        }),
        cmd('find-code', 'Find and replace…', { shortcut: 'Ctrl+F' }),
        cmd('symbols', 'Document symbols…'),
        cmd('commands', 'Command palette…', { shortcut: 'Ctrl+K' }),
      ]),
      group('View', [
        group(
          'Interface density',
          DENSITY_MODES.map((mode) =>
            c('density:' + mode.id, mode.label, () => s.density.set(mode.id), {
              checked: () => s.density.value === mode.id,
            }),
          ),
        ),
        sep,
        group('Editor mode', ['design', 'split', 'code', 'views'].map(view)),
        group('Split orientation', [
          c('split-horizontal', 'Side by side', () => s.docking.setSplitOrientation('horizontal')),
          c('split-vertical', 'Above and below', () => s.docking.setSplitOrientation('vertical')),
        ]),
        sep,
        group('Zoom', [
          cmd('fit', 'Fit artboard', { shortcut: 'Shift+1' }),
          c('focus-selection', 'Fit selection', () => s.focusSelection(), {
            shortcut: 'Shift+2',
            enabled: selected,
          }),
          cmd('zoom-in', 'Zoom in'),
          cmd('zoom-out', 'Zoom out'),
          cmd('zoom-reset', 'Actual size'),
        ]),
        group('Designer aids', [
          cmd('snap', 'Snap to grid', { checked: () => s.snap }),
          cmd('grid-overlay', 'Grid track overlay', {
            checked: () => s.features.canvas.gridEnabled,
          }),
          cmd('toggle-notes', 'Annotations', { checked: () => s.showNotes }),
          c(
            'path-handles',
            'Path anchors & tangents',
            () => {
              s.direct.pathEnabled = !s.direct.pathEnabled;
              s.drawSelection();
            },
            { checked: () => s.direct.pathEnabled },
          ),
          cmd('focus-mode', 'Focus active dock group'),
        ]),
        cmd('theme', 'Dark theme', { checked: () => s.dark }),
        group('Tool windows', panels),
      ]),
      group('Project', [
        c('solution-explorer', 'Solution Explorer', () => s.docking.control.show('solution')),
        c('new-folder', 'New folder', () => s.solution.newFolder()),
        c('rename-file', 'Rename or move selected file', () => {
          s.docking.control.show('solution');
          s.solution.selectedId ??= s.doc.id;
          s.solution.render();
          s.solution.host.querySelector('[data-solution-rename]').focus();
        }),
        c('duplicate-file', 'Duplicate file', () => s.solution.duplicate()),
        c('remove-file', 'Remove file from solution', () => s.solution.remove(), {
          enabled: () => s.stores.length > 1,
        }),
        c('set-startup', 'Set startup view', () => s.solution.setStartup()),
        sep,
        group('Convert document', [
          c(
            'convert-document-html',
            'To HTML / CSS / JavaScript…',
            () => s.compiler.show({ scope: 'document', to: 'html' }),
            { enabled: () => !!s.compiler },
          ),
          c(
            'convert-document-wpf',
            'To WPF XAML…',
            () => s.compiler.show({ scope: 'document', to: 'xaml', framework: 'WPF' }),
            { enabled: () => !!s.compiler },
          ),
          c(
            'convert-document-avalonia',
            'To Avalonia XAML…',
            () => s.compiler.show({ scope: 'document', to: 'xaml', framework: 'Avalonia' }),
            { enabled: () => !!s.compiler },
          ),
        ]),
        c('convert-folder', 'Convert folder…', () => s.compiler.show({ scope: 'folder' }), {
          enabled: () => !!s.compiler,
        }),
        c(
          'convert-solution',
          'Convert entire solution…',
          () => s.compiler.show({ scope: 'solution' }),
          { enabled: () => !!s.compiler },
        ),
        sep,
        c('undo-solution', 'Undo solution change', () => s.solution.undo(), {
          enabled: () => !!s.solution.history.length,
        }),
        c('redo-solution', 'Redo solution change', () => s.solution.redo(), {
          enabled: () => !!s.solution.future.length,
        }),
        group(
          'Framework copy',
          ['WPF', 'Avalonia', 'WinUI', 'MAUI'].map((f) =>
            c('framework:' + f, f, () => s.changeFramework(f)),
          ),
        ),
      ]),
      group('Insert', [
        group('Draw', [
          tool('select', 'Select'),
          tool('hand', 'Pan'),
          tool('frame', 'Canvas'),
          tool('rectangle', 'Rectangle'),
          tool('ellipse', 'Ellipse'),
          tool('line', 'Line'),
          tool('text', 'Text'),
          tool('comment', 'Annotation'),
        ]),
        group('Controls', controls),
        cmd('insert-image', 'Image from file…'),
        cmd('extract-control', 'UserControl from selection…', { enabled: canEdit }),
        group('Resource', [
          c('new-html-page', 'HTML page', () => s.html.newFile()),
          c('new-brush', 'Solid brush', () => s.resourcesWorkbench.create('SolidColorBrush')),
          c('new-gradient', 'Gradient brush', () =>
            s.resourcesWorkbench.create('LinearGradientBrush'),
          ),
          c('new-style', 'Style', () => s.resourcesWorkbench.create('Style')),
          c('new-template', 'ControlTemplate', () =>
            s.resourcesWorkbench.create('ControlTemplate'),
          ),
        ]),
      ]),
      group('Format', [
        group(
          'Align',
          ['left', 'center', 'right', 'top', 'middle', 'bottom'].map((direction) =>
            c(
              'align:' + direction,
              direction[0].toUpperCase() + direction.slice(1),
              () => s.align(direction),
              { enabled: canEdit },
            ),
          ),
        ),
        group('Distribute', [
          cmd('distribute-h', 'Horizontally', { enabled: () => s.selected.length >= 3 }),
          cmd('distribute-v', 'Vertically', { enabled: () => s.selected.length >= 3 }),
        ]),
        group('Order', [
          cmd('front', 'Bring to front', { enabled: canEdit }),
          cmd('move-down', 'Bring forward', { enabled: canEdit }),
          cmd('move-up', 'Send backward', { enabled: canEdit }),
          cmd('back', 'Send to back', { enabled: canEdit }),
        ]),
        group('Layout', [
          cmd('group', 'Wrap in Grid', { enabled: canEdit }),
          cmd('wrap-stack', 'Wrap in StackPanel', { enabled: canEdit }),
          cmd('ungroup', 'Ungroup', { enabled: canEdit }),
          cmd('reparent', 'Move to container…', { enabled: canEdit }),
          cmd('grid-editor', 'Grid editor…', {
            enabled: () => localName(s.selected[0]?.type || '') === 'Grid',
          }),
          group(
            'Convert container',
            ['Canvas', 'Grid', 'StackPanel', 'WrapPanel', 'DockPanel'].map((type) =>
              c('convert:' + type, type, () => s.convertLayout(type), {
                enabled: () => s.registry.get(s.selected[0]?.type || '')?.container,
              }),
            ),
          ),
        ]),
        cmd('format', 'Format XAML'),
        cmd('apply-code', 'Apply XAML'),
      ]),
      group('Designer', [
        group('Selection', [
          cmd('select-parent', 'Parent'),
          cmd('select-child', 'First child'),
          cmd('select-sibling', 'Next sibling'),
          cmd('isolate', 'Isolate selection', { enabled: selected }),
          cmd('exit-isolation', 'Exit isolation'),
          cmd('lock-selection', 'Lock / unlock selection', { enabled: selected }),
        ]),
        group('Appearance', [
          cmd('edit-brush', 'Brush & gradient', { enabled: canEdit }),
          cmd('edit-transforms', 'Transform & origin', { enabled: canEdit }),
          cmd('edit-effects', 'Effects', { enabled: canEdit }),
          cmd('style-designer', 'Style and triggers…', { enabled: canEdit }),
          cmd('path-designer', 'Advanced path editor…', { enabled: canEdit }),
        ]),
        group('Templates', [
          cmd('edit-template', 'Edit control template', { enabled: canEdit }),
          cmd('exit-template', 'Exit template'),
          cmd('extract-control', 'Extract UserControl…', { enabled: canEdit }),
          cmd('template-data', 'Template sample data…'),
        ]),
        group('Properties', [
          cmd('raw-properties', 'Raw property grid'),
          cmd('raw-json', 'Raw property JSON…'),
          cmd('custom-property', 'Add custom property…', { enabled: canEdit }),
          cmd('data-binding', 'Binding editor…', { enabled: selected }),
          cmd('design-values', 'Design-time values…', { enabled: selected }),
        ]),
      ]),
      group('Resources', [
        cmd('edit-resources', 'Resource browser'),
        group('New', [
          c('res-brush', 'Brush', () => s.resourcesWorkbench.create('SolidColorBrush')),
          c('res-gradient', 'Gradient', () => s.resourcesWorkbench.create('LinearGradientBrush')),
          c('res-style', 'Style', () => s.resourcesWorkbench.create('Style')),
          c('res-dictionary', 'Dictionary file', () => s.solution.newFile('ResourceDictionary')),
        ]),
        cmd('install-toolkit', 'Install toolkit…'),
        cmd('style-designer', 'Style and property triggers…', { enabled: selected }),
      ]),
      group('Animation', [
        cmd('motion', 'Objects & timeline'),
        c('new-storyboard', 'New Storyboard', () => timeline.newStory(), {
          enabled: () => s.doc.framework === 'WPF',
        }),
        sep,
        c(
          'animation-play',
          'Play / pause',
          () => {
            a.show();
            if (a.player.playing) a.player.pause();
            else {
              a.previewing = true;
              a.player.play();
            }
          },
          { enabled: () => !!a.story },
        ),
        c('animation-stop', 'Stop', () => a.stop()),
        c(
          'animation-record',
          'Record canvas and properties',
          () => {
            a.show();
            if (!a.story) timeline.newStory();
            a.record = !a.record;
            a.previewing = a.record;
            a.render();
          },
          { enabled: () => s.doc.framework === 'WPF', checked: () => a.record },
        ),
        c(
          'animation-key',
          'Key selected controls',
          () => {
            a.show();
            timeline.add();
          },
          { enabled: canEdit },
        ),
        group('Keyframes', [
          c('key-copy', 'Copy keys', () => timeline.copy(), {
            enabled: () => !!timeline.keys.length,
          }),
          c('key-paste', 'Paste keys', () => timeline.paste(), {
            enabled: () => !!timeline.clipboard.length,
          }),
          c('key-delete', 'Delete keys', () => timeline.remove(), {
            enabled: () => !!timeline.keys.length,
          }),
          c('key-previous', 'Previous key', () =>
            a.seek(
              Math.max(
                0,
                ...timeline.frames.filter((f) => f.time < a.player.time).map((f) => f.time),
              ),
            ),
          ),
          c('key-next', 'Next key', () =>
            a.seek(
              Math.min(
                a.duration,
                ...timeline.frames.filter((f) => f.time > a.player.time).map((f) => f.time),
              ),
            ),
          ),
        ]),
        sep,
        cmd('visual-states', 'Visual states…'),
        cmd('native-trigger', 'Native event triggers…', { enabled: canEdit }),
        cmd('motion-example', 'Open motion example'),
      ]),
      group('Data', [
        cmd('database', 'Visual database editor…'),
        cmd('data-table-new', 'New table…'),
        cmd('data-binding', 'Edit binding…', { enabled: selected }),
        cmd('sample-data', 'Sample data…'),
        cmd('interactive-demo', 'Open interactive example'),
      ]),
      group('Run', [
        cmd('preview', 'Preview current view'),
        c('run-startup', 'Run startup view', () => {
          const id = s.solution.model.startupId;
          s.solution.open(id, 'design');
          if (s.doc.id === id) s.preview();
        }),
        cmd('views-board', 'Views & connections'),
        cmd('flow-add', 'Add interaction…', { enabled: selected }),
      ]),
      group('Window', [
        group('Open window', panels),
        cmd('window-navigator', 'Window navigator…', { shortcut: 'Ctrl+Q' }),
        group(
          'Workspace preset',
          ['designer', 'coding', 'animation', 'compact'].map((name) =>
            c('preset:' + name, name[0].toUpperCase() + name.slice(1), () =>
              s.docking.preset(name),
            ),
          ),
        ),
        cmd('window-layouts', 'Save and manage layouts…'),
        cmd('layout-undo', 'Undo layout', { enabled: () => !!s.docking.model.history.length }),
        cmd('layout-redo', 'Redo layout', { enabled: () => !!s.docking.model.future.length }),
        cmd('layout-reset', 'Reset layout'),
      ]),
      group('Help', [
        cmd('help', 'Designer help & shortcuts'),
        c('help-docking', 'Docking guide', () =>
          window.open('./docs/DOCKING.md', '_blank', 'noopener'),
        ),
        c('help-architecture', 'Architecture', () =>
          window.open('./docs/ARCHITECTURE.md', '_blank', 'noopener'),
        ),
        c('help-workflows', 'Visual editing guide', () =>
          window.open('./docs/EDITOR-WORKFLOWS.md', '_blank', 'noopener'),
        ),
        cmd('reset-demo', 'Restore sample designs…'),
      ]),
    ];
    const host = document.createElement('nav');
    host.setAttribute('aria-label', 'Application menu');
    $('.topbar').after(host);
    this.bar = new MenuBar(host, this.menus, { onError: (e) => notify(e.message) });
    s.density.mount(host);
    const close = s.closeModal.bind(s);
    s.closeModal = () => {
      this.contextTarget = null;
      return close();
    };
    s.commandPalette = () => this.palette();
    const command = s.command.bind(s);
    s.command = (id, e) => {
      if (id === 'save-project') return s.solution.save();
      return command(id, e);
    };
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.target.closest('#modal-root')) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          e.stopImmediatePropagation();
          s.direct.cancelGesture?.();
          s.solution.save();
        } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
          e.preventDefault();
          e.stopImmediatePropagation();
          s.solution.openSolution();
        }
      },
      true,
    );
    window.xamora.commands = {
      list: () =>
        [...this.commands.values()].map((c) => ({
          id: c.id,
          label: c.label,
          enabled: this.bar.value(c.enabled, true),
        })),
      execute: (id) => {
        const c = this.commands.get(id);
        if (!c) throw Error('Unknown command');
        if (!this.bar.value(c.enabled, true)) return false;
        c.run();
        return true;
      },
    };
  }
  textTarget() {
    const el =
      this.contextTarget ||
      (this.bar?.stack.length || this.bar?.host.contains(document.activeElement)
        ? this.bar?.previous
        : document.activeElement);
    if (el?.closest?.('#modal-root')) return null;
    return el?.matches?.('textarea,input') && typeof el.selectionStart === 'number' ? el : null;
  }
  canTextEdit() {
    const el = this.textTarget();
    return !!el && !el.readOnly && !el.disabled;
  }
  async runContext(id) {
    const input = this.textTarget();
    if (
      !input ||
      !['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'select-all', 'duplicate'].includes(id)
    )
      return this.s.command(id);
    const source = input === this.s.editor.input;
    input.focus();
    const a = input.selectionStart,
      b = input.selectionEnd;
    if (id === 'select-all') {
      input.select();
      return;
    }
    if (id === 'undo' || id === 'redo') {
      if (source) return id === 'undo' ? this.s.editor.undoBuffer() : this.s.editor.redoBuffer();
      return document.execCommand?.(id);
    }
    if (id === 'copy' || id === 'cut') {
      await navigator.clipboard.writeText(input.value.slice(a, b));
      if (id === 'copy') return;
    }
    if (!this.canTextEdit()) return;
    const original = input.value;
    let text =
      id === 'paste'
        ? await navigator.clipboard.readText()
        : id === 'duplicate'
          ? input.value.slice(a, b)
          : '';
    if (input.value !== original) return;
    input.setRangeText(text, id === 'duplicate' ? b : a, b, 'end');
    if (source) this.s.editor.changed();
    else input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  palette() {
    this.contextTarget = document.activeElement;
    const s = this.s;
    const flatten = (entries) =>
      entries.flatMap((e) =>
        e.children
          ? flatten(typeof e.children === 'function' ? e.children() : e.children)
          : e.separator
            ? []
            : [e],
      );
    const commands = flatten(this.menus),
      unique = [...new Map(commands.map((c) => [c.id, c])).values()];
    s.modal(
      'Command palette',
      '<input id="ide-command-search" placeholder="Search commands…" aria-label="Search commands"><div class="command-list" id="ide-command-list"></div>',
      [],
      true,
    );
    const render = () => {
      const query = $('#ide-command-search').value.toLowerCase();
      $('#ide-command-list').innerHTML = unique
        .filter((c) => c.label.toLowerCase().includes(query))
        .map(
          (c) =>
            `<button data-ide-command="${esc(c.id)}" ${this.bar.value(c.enabled, true) ? '' : 'disabled'}>${esc(c.label)}<kbd>${esc(c.shortcut || '')}</kbd></button>`,
        )
        .join('');
      $$('[data-ide-command]').forEach(
        (b) =>
          (b.onclick = () => {
            const target = this.contextTarget;
            s.closeModal();
            try {
              target?.focus?.();
              const result = this.commands.get(b.dataset.ideCommand)?.run();
              this.contextTarget = null;
              Promise.resolve(result).catch((e) => notify(e.message));
            } catch (e) {
              notify(e.message);
            }
          }),
      );
    };
    $('#ide-command-search').oninput = render;
    $('#ide-command-search').onkeydown = (e) => {
      if (e.key === 'Enter') $('#ide-command-list button:not(:disabled)')?.click();
    };
    render();
  }
}
