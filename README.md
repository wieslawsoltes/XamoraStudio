# Xamora Studio

[Open the designer](https://wieslawsoltes.github.io/XamoraStudio/) · [Standalone docking demo](https://wieslawsoltes.github.io/XamoraStudio/examples/DockingDemo.html)

[![Validate and publish Xamora](https://github.com/wieslawsoltes/XamoraStudio/actions/workflows/ci.yml/badge.svg)](https://github.com/wieslawsoltes/XamoraStudio/actions/workflows/ci.yml)

An extensible visual UI authoring application written in plain JavaScript, HTML, and CSS. It opens directly into a design workspace with a sample desktop application, layer tree, control toolkit, property inspector, XAML editor, and design canvas.

The canvas uses WebGPU for its infinite dot-grid surface when available. Accessible controls, text, and preview layout use the browser DOM and CSS. The source model remains independent of the preview.

## New in 0.7

- Selection actions use measured, collision-aware placement beside or above the element type label.
- All dock tool/document tabs and auto-hide tabs support dragging. Tab strips expose scroll buttons, retain offsets, prioritize tab insertion over workspace edges, and show insertion markers.
- Main horizontal command bars use scroll buttons without scrollbar rows.
- Native HTML pages share solution files, docking, Design/Code/Split/Views modes, undo/redo and source recovery. Use **File → New → HTML page** or add `.html`/`.htm` files.
- HTML authoring includes a native browser canvas, element toolkit, nested selection, flow reordering/reparenting, absolute movement, resize handles, inline text, HTML attributes, CSS properties, styles/scripts and isolated interactive preview.
- The HTML source adapter preserves untouched original source; visual changes produce canonical HTML while retaining CSS/script bodies. See [HTML workflows](docs/HTML-WORKFLOWS.md) for details and boundaries.

## New in 0.6 — compact workspace

Compact is the default interface density. Use the **Density** selector at the right of the menu bar or **View → Interface density** to choose Compact, Standard or Comfortable. Your preference survives reload and synchronizes between open tabs.

The density system adjusts shell bars, dock headers/tabs, solution and layer rows, property fields, resources, toolkit cards, code line spacing, timeline controls, dialogs and database rows. Wide compact timelines place the Storyboard and transport controls on one row; inline timing/key fields leave more space for tracks. Every command and editor remains available; narrow command bars scroll.

Density changes preserve the live code buffer/caret, document history, dock arrangement, artboard size and canvas zoom. Existing light/dark themes work with every mode. See [editor workflows](docs/EDITOR-WORKFLOWS.md#interface-density-in-06) and [extension guidance](docs/EXTENDING.md#workspace-density-in-06).

## New in 0.5

- Direct canvas text, rotation and path-handle editing; ellipse/line drawing; numeric scrubbing; visual gradients, transforms, effects and Grid track lengths.
- Distinct Design/Code/Split/Views modes with saved tiled/floating arrangements, one-step layout undo and source-buffer recovery.
- Solution Explorer with folders, relative-path moves, imports, dictionary resolution, startup view and solution undo/redo.
- Thirteen IDE menus with nested command groups, focus-aware Edit commands, keyboard navigation and a searchable command palette.
- Inline timeline/key editing, multiple-key moves/copy/paste, frame snapping, timeline zoom and canvas/property animation recording.
- Solution resource browser with swatches, merge controls, scoped reference renaming and visual property-editor extensions.
- Retained view cards, filters, card sizing, selected-view tiling and inline navigation connections.

Read the [0.5 editor workflows](docs/EDITOR-WORKFLOWS.md) for gestures, behavior and current limits. The source remains dependency-free and buildless. **236 automated tests pass**; browser and native framework qualification are still separate work.

## New in 0.4

- Visual Studio-style docking integrated across all designer panels and page tabs.
- Nested split groups, tab reordering/pinning, docking compass and drop previews, floating/resizable groups, auto-hide flyouts and dock-back restoration.
- Window navigator, keyboard docking controls, focus mode, layout undo/redo, named layouts, JSON import/export and Designer/Coding/Animation/Compact presets.
- Live editor/canvas preservation, separate inspector and tool windows, dockable Error List and retained timeline/prototype integration.
- Reusable DOM-free DockLayout model, DockWorkspace control and extension panel API.

See [docking workflows and API](docs/DOCKING.md). The [standalone docking demo](dist/examples/DockingDemo.html) is also available [on GitHub Pages](https://wieslawsoltes.github.io/XamoraStudio/examples/DockingDemo.html). Floating windows are browser-contained; native multi-monitor OS windows need a desktop adapter.

## New in 0.3

- Docked WPF Storyboard timeline with property tracks, recording, keyframe editing, scrubbing, timing and playback.
- Visual states, generated/explicit transitions and native event-trigger playback connected to prototype actions.
- Brush, ordered transform, effect, clipping, style/trigger and design-time value editors.
- SVG path display and point/curve editing, plus control-template motion instance identities.
- Expanded XAML motion completions and diagnostics.

Try **Ctrl/Command+K → Open motion example**, then **Motion** or **Run preview**.
Read the [motion workflows](docs/MOTION-WORKFLOWS.md) and [Blend comparison](docs/BLEND-COMPARISON.md). Full native Blend/Visual Studio parity remains unfinished; the comparison records concrete boundaries.

## New in 0.2

- Nested and overlapping selection cycling, deeper hit testing, isolation, locks, parent/child/sibling navigation, and ancestor breadcrumbs.
- Container drag/drop with insertion/cell cues, multi-layer Canvas movement, edge/center guides, and undoable reordering.
- Visual Grid track editor with row/column constraints, add/remove, cell-span adjustment, and draggable dividers.
- Raw authored-property table and JSON editing, with multi-selection mixed values.
- Contextual XAML completions for controls, properties, enum values, resources, bindings, and current data paths.
- Typed visual data editor: records, schema, relationships, query builder, objects, CSV/JSON, and undo/redo.
- Multiple view artboards, responsive comparison, editable connector graph, and isolated interactive preview sessions.
- Inherited data contexts, repeated item templates, typed TwoWay writes, and record-driven navigation.

Start with **Data → Open connected example**, then **Run preview**. Select a project, open its detail view, edit its name, and navigate back. Read the [designer workflows](docs/DESIGNER-WORKFLOWS.md) for gesture and panel details.

## Run locally

Requires Node.js 20 or newer. No package installation or build is necessary.

```sh
npm start
```

Open `http://localhost:8080`. ES modules must be served over HTTP; opening `index.html` with a `file:` URL is not supported. WebGPU requires a secure context and compatible browser/device; the app automatically retains a CSS canvas when unavailable.

```sh
npm test
npm run check
```

To deploy on a static host, upload the contents of `dist/`. There are no runtime CDN dependencies, analytics scripts, application servers, or native .NET dependencies in the browser app.

## What is implemented

- Multi-page local workspace; import XAML, XML, project JSON, and declarative toolkit JSON.
- Canvas selection, Shift multiselection, marquee selection, drag, resize handles, pan, zoom, 8-pixel snapping, keyboard nudging, alignment, layer ordering, grouping, and reparenting.
- Grid rows/columns, Auto/pixel/star definitions, cell placement and spans; StackPanel, Canvas, DockPanel, WrapPanel, UniformGrid, Border, and common input/content controls.
- Designer property inspector with named and attached properties, color controls, enum metadata, bindings, reset-to-unset, custom properties, and resource references.
- Template editing in a separate visual scope, template preview properties, reusable UserControl extraction, brush resources, style setters, and basic keyed/implicit style preview.
- Code highlighting, line numbers, XML validation, formatting, tag/property completion, find/replace, indentation, comment toggling, document symbols, selected-element navigation, and explicit Apply to canvas.
- Per-page undo/redo with 100 snapshots, device-local saving, project export/import, and canvas annotations.
- WPF/Avalonia namespace and common-property conversion with the original page retained; source preservation modes for WinUI and MAUI.
- XAML, standalone HTML, project JSON, and browser-compatible SVG `foreignObject` export. Registered export adapters appear in the export dialog.
- Registry APIs for toolkit controls, custom property metadata, nested scaffolds, browser renderers, and export adapters.
- Light/dark studio chrome, command palette, keyboard shortcuts, responsive panels, and optional WebMCP registrations.

## Compatibility and release status

This is version **0.4.0**, an implemented extensible designer foundation. It is **not a fully qualified replacement for Blend, Visual Studio, or native framework designers**. It does not provide complete WPF/Avalonia control, API, layout, or theme parity, and it does not execute arbitrary .NET assemblies in a browser.

| Capability | Status |
| --- | --- |
| Authored XML elements, attributes, namespace declarations, expressions, comments | Preserved within the supported XML subset; canonical formatting changes source trivia |
| Common WPF/Avalonia panels and controls | Editable and approximated by browser preview adapters |
| WinUI / MAUI | Source preservation and namespace selection; native semantics not validated |
| Unknown/custom controls | Preserved; accurate preview requires a registered renderer |
| Native dependency-property engine, complete measure/arrange, text metrics | Not implemented |
| Full converters, compiled bindings, arbitrary markup extensions, code-behind | Preserved in source; not executed |
| Styles/themes | Scoped styles, setters, supported trigger conditions, templates and WPF state/storyboard playback; complete native property and theme semantics remain incomplete |
| Native framework compilation/loading | Not performed; no native preview host is included |
| Data editor | Typed in-project database with constraints and queries; no production SQL server or live database connector |
| Prototype | Browser session actions and graph; native application code generation is not implemented |
| Code IDE | In-app editing features above; no Roslyn/LSP, debugger, project system, semantic refactoring, or folding engine |
| Collaboration | Device-local workspace and annotations; no shared server or simultaneous coauthoring |
| WebGPU | Background grid implemented; control/text rasterization uses DOM/CSS |

See [architecture](docs/ARCHITECTURE.md), [compatibility](docs/COMPATIBILITY.md), [extension guide](docs/EXTENDING.md), and [validation report](docs/VALIDATION.md) for exact contracts and limitations.

## Core reuse

```js
import {
  parseXaml, serializeXaml, DocumentStore,
  builtins, PreviewRenderer,
} from './dist/core/index.js';

const document = parseXaml('<Grid><Button Content="Hello" /></Grid>');
const store = new DocumentStore(document);
const registry = builtins();
const preview = new PreviewRenderer(registry);

store.addEventListener('change', () => {
  preview.render(store.document, documentHost);
});
preview.render(store.document, documentHost);

const xaml = serializeXaml(store.document);
```

`model.js`, `xaml.js`, and `registry.js` can be imported in Node. Rendering, WebGPU, the studio, and the editor require a browser DOM. Public TypeScript declarations are supplied in `dist/core/index.d.ts`.

## Project layout

```text
dist/
  index.html                  Static application entrypoint
  app.js                      Studio orchestration and interactions
  styles/studio.css           Light/dark UI and responsive layouts
  core/
    model.js                  Document AST, IDs, transactions, undo/redo
    xaml.js                   XML parser, XAML serializer, diagnostics
    registry.js               Control and export adapter registry
    render.js                 DOM preview, layout mapping, HTML export
    gpu.js                    Optional WebGPU canvas background
    editor.js                 In-app XAML editor
    design-tools.js           Hit testing, drop planning, grids, snapping
    design-data.js            Typed data, queries, paths and bindings
    prototype.js              Isolated action/input runtime
    xaml-language.js          Contextual completion service
    samples.js                Sample documents
    index.js / index.d.ts      Reusable module entrypoint and types
  studio/                     Canvas, data, flow and property UI modules
  extensions/                 Executable extension example
  docs/                       Documentation available from the app
docs/                         Architecture, compatibility, validation
examples/                     Sample XAML and toolkit manifest
scripts/                      Local HTTP server and static checks
tests/                        Node tests and deterministic DOM fixture
```

## Data ownership

Work is saved in this browser's local storage. Export a project JSON for a portable backup. XAML export contains runtime markup; annotations and design sample data remain project-only. XAML/source import does not activate .NET code. Executable JavaScript extensions are trusted application code and must be installed explicitly by the integrating application.

## License

MIT. See [LICENSE](LICENSE).

## GitHub Pages deployment

Pushes to `main` run validation and publish the contents of `dist/`. The workflow verifies the deployed HTML, JavaScript, CSS and docking example against the source commit. See [GitHub Pages hosting](docs/GITHUB-PAGES.md).
