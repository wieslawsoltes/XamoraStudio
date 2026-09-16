/** Workspace commands and dialogs, composed with the Studio host. */
import { element, find, walk, clone, label, isElement, createDocument } from '../core/model.js';
import { serializeXaml, diagnostics, newRoot } from '../core/xaml.js';
import { exportHTML } from '../core/render.js';
import { samples } from '../core/samples.js';
import { $, $$, esc, toast, download } from './ui.js';
import { icon } from './icons.js';

export function newDocumentDialog(studio) {
  studio.modal(
    'New design',
    `<label for="new-name">File name</label><input id="new-name" value="NewView.xaml"><label for="new-kind">Document type</label><select id="new-kind"><option>UserControl</option><option>Window</option><option>ControlTemplate</option><option>DataTemplate</option><option>ResourceDictionary</option></select><label for="new-framework">Framework</label><select id="new-framework"><option>WPF</option><option>Avalonia</option><option>WinUI</option><option>MAUI</option></select><div style="display:grid;grid-template-columns:1fr 1fr;gap:15px"><div><label for="new-width">Width</label><input id="new-width" type="number" value="1100" min="100" max="8000"></div><div><label for="new-height">Height</label><input id="new-height" type="number" value="760" min="100" max="8000"></div></div>`,
    [
      {
        label: 'Create design',
        primary: true,
        run: () => {
          const name = $('#new-name').value.trim();
          if (!name) throw Error('Enter a file name.');
          const fw = $('#new-framework').value,
            type = $('#new-kind').value,
            root = newRoot(type, fw),
            w = Number($('#new-width').value),
            h = Number($('#new-height').value);
          if (
            !Number.isFinite(w) ||
            !Number.isFinite(h) ||
            w < 100 ||
            h < 100 ||
            w > 8000 ||
            h > 8000
          )
            throw Error('Choose dimensions between 100 and 8000.');
          if (['ResourceDictionary', 'ControlTemplate', 'DataTemplate'].includes(type)) {
            delete root.props.Width;
            delete root.props.Height;
            delete root.props.Background;
          } else {
            root.props.Width = String(w);
            root.props.Height = String(h);
          }
          if (type !== 'ResourceDictionary') root.children.push(element('Grid'));
          if (type === 'ControlTemplate') root.props.TargetType = 'Button';
          const doc = createDocument(root, fw, name.endsWith('.xaml') ? name : name + '.xaml');
          doc.design = { width: w, height: h };
          studio.addStore(doc);
          studio.closeModal();
          studio.switchDocument(studio.stores.length - 1);
        },
      },
    ],
  );
  $('#new-framework').value = studio.doc.framework === 'HTML' ? 'WPF' : studio.doc.framework;
}

export function renameDocumentDialog(studio) {
  studio.modal(
    'Rename page',
    `<label for="page-name">File name</label><input id="page-name" value="${esc(studio.doc.name)}">`,
    [
      {
        label: 'Rename',
        primary: true,
        run: () => {
          const name = $('#page-name').value.trim();
          if (!name) throw Error('Enter a name.');
          studio.store.transaction('Rename page', (d) => (d.name = name));
          studio.closeModal();
        },
      },
    ],
  );
}

export function exportDialog(studio) {
  if (studio.editor.composing) return;
  studio.sync?.flush();
  let format = 'xaml';
  studio.modal(
    'Export your design',
    `<p>Export the current page, or save all pages as an editable project.</p><div class="export-options">${[['xaml', 'code', 'XAML', 'Human-readable framework markup'], ['html', 'file', 'HTML', 'Portable browser layout'], ['project', 'layers', 'Project JSON', 'All pages, notes, and toolkit metadata'], ['svg', 'image', 'SVG snapshot', 'Canvas image with embedded HTML'], ...[...studio.registry.adapters.keys()].map((name) => [name, 'export', name, 'Registered export adapter'])].map(([id, ico, name, desc]) => `<button class="export-option ${id === 'xaml' ? 'active' : ''}" data-export-format="${id}">${icon(ico)}<span>${name}<small>${desc}</small></span></button>`).join('')}</div><label for="export-name">File name</label><input id="export-name" value="${esc(studio.doc.name)}"><p id="export-note" style="font-size:11px">${esc(studio.doc.framework)} markup. Review diagnostics and verify in the target framework.</p>`,
    [
      {
        label: 'Export file',
        primary: true,
        run: async () => {
          const base = $('#export-name').value.replace(/\.(xaml|html|json|svg)$/i, '') || 'design';
          let content, mime, ext;
          if (!['xaml', 'project'].includes(format) && !studio.prepareEdit()) return;
          if (studio.registry.adapters.has(format)) {
            const result = await studio.registry.adapters.get(format).serialize(clone(studio.doc));
            content = typeof result === 'string' ? result : result.content;
            mime = result.mimeType || 'text/plain';
            ext = result.extension || 'txt';
            if (typeof content !== 'string')
              throw Error('Adapter must return text or an object containing content.');
          } else if (format === 'xaml') {
            content = studio.store.session?.source ?? serializeXaml(studio.doc);
            mime = 'application/xml';
            ext = 'xaml';
          } else if (format === 'html') {
            content = exportHTML(studio.doc, studio.registry, studio.features?.context(), {
              resourceResolver: studio.solution?.resolverFor(studio.doc),
            });
            mime = 'text/html';
            ext = 'html';
          } else if (format === 'project') {
            content = JSON.stringify(studio.workspaceData(), null, 2);
            mime = 'application/json';
            ext = 'json';
          } else {
            content = studio.svgSnapshot();
            mime = 'image/svg+xml';
            ext = 'svg';
          }
          download(base + '.' + ext, content, mime);
          studio.closeModal();
          toast('Design exported');
        },
      },
    ],
  );
  $$('[data-export-format]').forEach(
    (b) =>
      (b.onclick = () => {
        format = b.dataset.exportFormat;
        $$('[data-export-format]').forEach((n) => n.classList.toggle('active', n === b));
        $('#export-note').textContent =
          {
            xaml: `${studio.doc.framework} markup. Review diagnostics and verify in the target framework.`,
            html: 'Standalone HTML includes browser controls and inline layout. .NET bindings and event handlers require application integration.',
            project:
              'Editable project with all documents, resources, annotations, and declarative toolkit descriptors.',
            svg: 'ForeignObject SVG snapshot for browser use. External images and fonts remain external; some vector tools do not support embedded HTML.',
          }[format] || 'Export through the registered ' + format + ' adapter.';
      }),
  );
}

export function resetDemoDialog(studio) {
  studio.modal(
    'Open sample project',
    `<p>Open fresh Lumio sample pages alongside your current work.</p>`,
    [
      {
        label: 'Open sample pages',
        primary: true,
        run: () => {
          const start = studio.stores.length;
          samples().forEach((d) => studio.addStore(d));
          studio.closeModal();
          studio.switchDocument(start);
        },
      },
    ],
  );
}

export function installToolkitDialog(studio) {
  const example = {
    name: 'Acme Controls',
    version: '1.0.0',
    controls: [
      {
        type: 'acme:StatusCard',
        category: 'Acme toolkit',
        namespace: 'clr-namespace:Acme.Controls;assembly=Acme.Controls',
        container: true,
        singleChild: true,
        defaults: { Width: '240', Height: '120', Background: '#EEF6F1' },
        properties: [{ name: 'Status', type: 'enum', values: ['Active', 'Paused', 'Done'] }],
      },
    ],
  };
  studio.modal(
    'Extend your toolkit',
    `<p>Install declarative control metadata as JSON. Code integrations can register custom renderers and exporters through <code>window.xamora.registry</code>.</p><textarea id="toolkit-manifest" style="height:275px">${esc(JSON.stringify(example, null, 2))}</textarea><p style="font-size:11px">Metadata describes controls and properties. Native .NET assemblies are not executed by the browser.</p><button class="button" id="load-toolkit-file">${icon('upload')}Load JSON file</button>`,
    [
      {
        label: 'Install toolkit',
        primary: true,
        run: () => {
          const manifest = JSON.parse($('#toolkit-manifest').value);
          studio.registry.install(manifest);
          studio.save();
          studio.leftTab = 'toolkit';
          studio.renderLeft();
          studio.closeModal();
          toast(manifest.name + ' installed');
        },
      },
    ],
    true,
  );
  $('#load-toolkit-file').onclick = () =>
    studio.chooseFile('.json', async (f) => {
      $('#toolkit-manifest').value = await f.text();
    });
}

export function projectMenu(studio) {
  studio.modal(
    'Workspace',
    `<div class="command-list">${[
      ['new-document', 'New design', 'plus'],
      ['rename-document', 'Rename current page', 'file'],
      ['import', 'Import XAML or project', 'upload'],
      ['save-project', 'Save workspace as JSON', 'download'],
      ['install-toolkit', 'Install toolkit', 'grid'],
      ['sample-data', 'Edit sample data', 'binding'],
      ['focus-mode', 'Toggle focus mode', 'fit'],
      ['reset-demo', 'Open fresh sample pages', 'layers'],
      ['help', 'Help and architecture', 'help'],
    ]
      .map(
        ([action, name, i]) =>
          `<button class="command-item" data-menu-command="${action}">${icon(i)}${name}</button>`,
      )
      .join('')}</div>`,
  );
  $$('[data-menu-command]').forEach(
    (b) =>
      (b.onclick = () => {
        studio.closeModal();
        studio.command(b.dataset.menuCommand);
      }),
  );
}

export function commandPalette(studio) {
  const commands = [
    ['Window layout manager', 'window-layouts', ''],
    ['Reset window layout', 'layout-reset', ''],
    ['Window navigator', 'window-navigator', 'Ctrl Q'],
    ['Motion timeline', 'motion', ''],
    ['Open motion example', 'motion-example', ''],
    ['Visual states', 'visual-states', ''],
    ['Brush designer', 'edit-brush', ''],
    ['Transform designer', 'edit-transforms', ''],
    ['Effects and clipping', 'edit-effects', ''],
    ['Style designer', 'style-designer', ''],
    ['Design-time values', 'design-values', ''],
    ['Vector path editor', 'path-designer', ''],
    ['Native event trigger', 'native-trigger', ''],
    ['Visual data editor', 'database', ''],
    ['All views & connections', 'views-board', ''],
    ['Visual grid editor', 'grid-editor', ''],
    ['Raw properties', 'raw-properties', ''],
    ['Connect preview interaction', 'flow-add', ''],
    ['Connect data binding', 'data-binding', ''],
    ['Isolate selection', 'isolate', ''],
    ['Lock / unlock selection', 'lock-selection', ''],
    ['Distribute horizontally', 'distribute-h', ''],
    ['Distribute vertically', 'distribute-v', ''],
    ['New design', 'new-document', ''],
    ['Import XAML / project', 'import', 'Ctrl O'],
    ['Export design', 'export', ''],
    ['Save project', 'save-project', 'Ctrl S'],
    ['Preview design', 'preview', ''],
    ['Insert control', 'add', ''],
    ['Edit template', 'edit-template', ''],
    ['Theme & resources', 'edit-resources', ''],
    ['Install toolkit', 'install-toolkit', ''],
    ['Fit artboard', 'fit', 'Shift 1'],
    ['Focus mode', 'focus-mode', ''],
    ['Undo', 'undo', 'Ctrl Z'],
    ['Redo', 'redo', 'Ctrl Shift Z'],
    ['Duplicate selection', 'duplicate', 'Ctrl D'],
    ['Wrap in Grid', 'group', 'Ctrl G'],
    ['Wrap in StackPanel', 'wrap-stack', ''],
    ['Move to container', 'reparent', ''],
    ['Document diagnostics', 'problems', ''],
    ['Find / replace XAML', 'find-code', 'Ctrl F'],
    ['Document symbols', 'symbols', ''],
    ['Format XAML', 'format', 'Alt Shift F'],
    ['Synchronize source', 'apply-code', 'Ctrl Enter'],
    ['Toggle theme', 'theme', ''],
    ['Keyboard shortcuts', 'help', ''],
  ];
  studio.modal(
    'Command palette',
    `<div class="command-search"><input id="command-query" placeholder="What would you like to do?" aria-label="Search commands"></div><div class="command-list" id="command-list"></div>`,
  );
  const render = () => {
    const q = $('#command-query').value.toLowerCase();
    $('#command-list').innerHTML = commands
      .filter(([name]) => name.toLowerCase().includes(q))
      .map(
        ([name, action, key]) =>
          `<button class="command-item" data-command="${action}">${icon('bolt')}${name}<kbd>${key}</kbd></button>`,
      )
      .join('');
    $$('[data-command]').forEach(
      (b) =>
        (b.onclick = () => {
          studio.closeModal();
          studio.command(b.dataset.command);
        }),
    );
  };
  $('#command-query').oninput = render;
  $('#command-query').onkeydown = (e) => {
    if (e.key === 'Enter') $('[data-command]')?.click();
  };
  render();
}

export function problemsDialog(studio) {
  const issues = diagnostics(studio.doc, studio.registry);
  studio.modal(
    'Document diagnostics',
    `<p>${issues.length ? `${issues.length} item${issues.length === 1 ? '' : 's'} to review.` : 'No errors in the supported validation rules.'} Native framework compilation is a separate validation step.</p><div class="problems-list">${issues.map((d, i) => `<button class="problem ${d.severity}" data-problem="${i}" style="width:100%;text-align:left"><span>${icon(d.severity === 'error' ? 'code' : d.severity === 'warning' ? 'bolt' : 'help')}</span><span><strong>${esc(d.severity)} · line ${d.line}</strong><br>${esc(d.message)}</span></button>`).join('')}</div>`,
    [],
    true,
  );
  $$('[data-problem]').forEach(
    (b) =>
      (b.onclick = () => {
        const issue = issues[Number(b.dataset.problem)];
        studio.store.select([issue.id]);
        studio.closeModal();
        studio.setView('split');
      }),
  );
}

export function symbolsDialog(studio) {
  const items = [];
  walk(studio.doc.root, (n) => {
    if (isElement(n) && (n.props['x:Name'] || n.props.Name || n.props['x:Key'])) items.push(n);
  });
  studio.modal(
    'Document symbols',
    `<p>Jump to a named element, template, or resource.</p><div class="command-list">${items.map((n) => `<button class="command-item" data-symbol-id="${n.id}">${icon('diamond')}<span>${esc(label(n))}</span><kbd>${esc(n.type)}</kbd></button>`).join('') || '<p>No named elements.</p>'}</div>`,
  );
  $$('[data-symbol-id]').forEach(
    (b) =>
      (b.onclick = () => {
        studio.closeModal();
        studio.store.select([b.dataset.symbolId]);
        studio.setView('split');
        const n = find(studio.doc.root, b.dataset.symbolId);
        studio.editor.revealName(label(n));
        studio.focusSelection();
      }),
  );
}

export function historyDialog(studio) {
  studio.modal(
    'Undo history',
    `<p>Up to 100 document edits are retained in this session. Saved project files contain the latest document state.</p>${
      studio.store.history.length
        ? `<button class="button" id="history-undo">${icon('undo')}Undo latest edit</button><div style="margin-top:15px">${[
            ...studio.store.history,
          ]
            .reverse()
            .map(
              (h, i) =>
                `<div class="history-item"><span style="color:var(--muted);margin-right:12px">${studio.store.history.length - i}</span>${esc(h.label)}</div>`,
            )
            .join('')}</div>`
        : '<p>Make your first edit to start the history.</p>'
    }`,
  );
  $('#history-undo')?.addEventListener('click', () => {
    studio.store.undo();
    studio.historyDialog();
  });
}

export function helpDialog(studio) {
  studio.modal(
    'Design with Xamora',
    `<p>Use the toolkit to add controls, the layer tree to organize them, and the inspector to edit their authored properties. Double-click text to edit it.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:18px"><div><strong>Canvas</strong><p>V — Select<br>H / Space — Pan<br>F — Draw a Canvas<br>R — Draw a rectangle<br>T — Add text<br>C — Add annotation<br>Shift+1 — Fit artboard<br>Shift+2 — Focus selection<br>Ctrl/⌘ + wheel — Zoom<br>Arrow keys — Nudge; Shift for 10 px</p></div><div><strong>Editing</strong><p>Ctrl/⌘ Z — Undo<br>Ctrl/⌘ Shift Z — Redo<br>Ctrl/⌘ D — Duplicate<br>Ctrl/⌘ G — Wrap in Grid<br>Ctrl/⌘ Shift G — Ungroup<br>Ctrl/⌘ K — Command palette<br>Ctrl/⌘ Enter — Apply XAML<br>Ctrl/⌘ Space — Code completion<br>Alt Shift F — Format XAML<br>Ctrl/⌘ F — Find and replace</p></div></div><p><strong>Layout behavior.</strong> Canvas dragging edits absolute coordinates. Grid dragging uses measured track sizes. Drag within stacks to reorder or over another container to reparent. Colored cues show the destination before you release. Hold Shift to keep the current container. Alt-click cycles overlapping layers; Ctrl/⌘-click selects deeply nested content. Enter selects a child, Shift+Enter a parent, and Tab cycles siblings.</p><p><strong>Extensions.</strong> Register descriptors, renderers, and serializers with <code>window.xamora.registry</code>. Unknown elements and properties stay in the document. Native .NET controls require a framework preview integration.</p><p><strong>Storage.</strong> This is a local workspace. Export a project JSON to back up all pages and embedded assets. XAML export excludes design annotations and sample data.</p><a href="./docs/ARCHITECTURE.md" target="_blank" rel="noopener" style="color:var(--accent)">Read architecture documentation</a>`,
    [],
    true,
  );
}
