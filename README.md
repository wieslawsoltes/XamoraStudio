# Xamora Studio

[Open the designer](https://wieslawsoltes.github.io/XamoraStudio/) · [Standalone XAML app](https://wieslawsoltes.github.io/XamoraStudio/examples/StandaloneApp/) · [Standalone docking demo](https://wieslawsoltes.github.io/XamoraStudio/examples/DockingDemo.html)

[![Validate and publish Xamora](https://github.com/wieslawsoltes/XamoraStudio/actions/workflows/ci.yml/badge.svg)](https://github.com/wieslawsoltes/XamoraStudio/actions/workflows/ci.yml)

An extensible visual UI authoring application written in plain JavaScript, HTML, and CSS. It opens directly into a design workspace with a sample desktop application, layer tree, control toolkit, property inspector, XAML editor, and design canvas.

The canvas uses WebGPU for its infinite dot-grid surface when available. Accessible controls, text, and preview layout use the browser DOM and CSS. The source model remains independent of the preview.

## Standalone web framework and npm packages

The same document model, XAML parser, browser renderer, resources, bindings and animation engine can now run an application without loading the designer. The application host adds observable state, typed runtime properties, two-way input bindings, explicitly registered commands/events, resource and theme updates, storyboard/state playback, custom control lifecycles and a custom-element adapter.

Try the [standalone XAML application](https://wieslawsoltes.github.io/XamoraStudio/examples/StandaloneApp/) and read the [runtime API and support boundaries](docs/WEB-RUNTIME.md). This is a browser implementation of supported XAML semantics; native .NET controls and platform-specific behavior require adapters.

Granular packages under `@wieslawsoltes/xamora-*` are generated from the canonical `dist/` modules, preserving shared class identity across package boundaries. They include ESM, CommonJS, TypeScript declarations, exported assets and standalone browser bundles. The private repository root continues to run the designer directly. See [package architecture, local installation and release setup](docs/PACKAGES.md).

```sh
npm ci
npm run check
npm test
npm run test:package
npm run test:browser
```

The npm release workflow is manual and defaults to validation. No npm publication is triggered by merging a PR or deploying GitHub Pages. Packages must be built and validated locally until a separately authorized npm release is performed.

## Semantic XAML and HTML conversion

Use **Project → Convert** to convert the selected document, a folder, or an entire solution between XAML and HTML. The preview shows generated source, output paths, diagnostics and semantic losses before creating files. Originals stay editable, output collisions receive unique names by default, and one solution undo reverses the batch. Generated files immediately use the existing code/design/property synchronization.

The compiler shares the designer AST and parser/serializer services. It maps supported layouts, controls, properties, styles and animation semantics; portable metadata preserves constructs that need adapters on the target platform. Strict conversion rejects semantic losses. Ordinary JavaScript and native .NET code-behind are not mechanically interchangeable.

The separately packaged `xamora-convert` CLI handles files, folders and solution manifests, with dry runs, reports, output collision checks and local asset copying. During development:

```sh
node dist/compiler-cli/index.js examples/MainView.xaml --to html --out-dir generated --dry-run
node dist/compiler-cli/index.js pages --to xaml --framework Avalonia --out-dir generated
```

Read the [semantic compiler contract and supported mappings](docs/SEMANTIC-COMPILER.md) and [CLI guide](docs/COMPILER-CLI.md) before converting a production solution.

## HTML states and transitions

The docked **States & transitions** editor authors pseudo, named, class and data-attribute states, CSS values and transition lists. Record property/canvas changes into a state, preview native transitions, and bind named states to exported interactions. The source contains ordinary CSS and an explicit readable event runtime only when a named interaction is authored. Base styles, shared undo and the keyframe timeline are preserved.

Open **Animation → Open HTML interaction example** or read the [HTML state authoring guide](docs/HTML-STATES.md).

## Incremental editing and semantic navigation

Eligible XAML/HTML attribute and text edits now parse local fragments and update cached source ranges. A versioned source buffer maintains line mappings, and document undo/redo retains reversible deltas with compact text edits. The code editor adds AST-backed definitions, references, scoped literal rename, semantic warnings and contextual completions.

Read the [editing-engine architecture and reproducible benchmark](docs/EDITOR-ENGINE.md) for API contracts, measured parser work and remaining scaling limits. Full parsing remains the fallback for structural and contextual edits.

## HTML animation timeline

HTML pages now have an editable CSS animation timeline with presets, target bindings, animation rename, keyframe dragging and value editors, recording from properties and canvas gestures, playback/scrubbing, easing, delay, repeats, direction and fill controls. Animation edits flow through the shared source session and undo history. The browser samples native CSS animations without changing authored base styles, and exported HTML runs its own CSS animations.

See [HTML animation workflows and core API](docs/HTML-ANIMATIONS.md) and [the HTML Motion Lab example](dist/examples/HtmlMotionLab.html). External stylesheets and scroll-linked/dynamically scripted effects have explicit authoring boundaries documented there.

## Live document synchronization

The code editor, design canvas and property/tool panels now edit one document session. Valid XAML and HTML source changes update the design automatically; visual edits update source through the same undoable transaction. Incomplete markup remains visible as a recoverable draft while the canvas keeps its last valid document. Source locations connect code selection to design selection, and each open file retains its own buffer and caret.

The reusable `DocumentSession` coordinates source adapters, stable node identity, source diagnostics, revisions and history around `DocumentStore`. See [document synchronization and AST architecture](docs/DOCUMENT-SYNC.md) for the API, preservation rules and extension contract.

## New in 0.7

- Selection actions use measured, collision-aware placement beside or above the element type label.
- All dock tool/document tabs and auto-hide tabs support dragging. Tab strips expose scroll buttons, retain offsets, prioritize tab insertion over workspace edges, and show insertion markers.
- Main horizontal command bars use scroll buttons without scrollbar rows.
- Native HTML pages share solution files, docking, Design/Code/Split/Views modes, undo/redo and source recovery. Use **File → New → HTML page** or add `.html`/`.htm` files.
- HTML authoring includes a native browser canvas, element toolkit, nested selection, flow reordering/reparenting, absolute movement, resize handles, inline text, HTML attributes, CSS properties, styles/scripts and isolated interactive preview.
- The HTML source adapter preserves untouched original source; the document session patches visual changes while retaining unrelated CSS/script bodies. See [HTML workflows](docs/HTML-WORKFLOWS.md) for details and boundaries.

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

Read the [0.5 editor workflows](docs/EDITOR-WORKFLOWS.md) for gestures, behavior and current limits. The source remains dependency-free and buildless. Automated unit and integration checks cover the implemented workflows. Chromium tests now exercise document synchronization in the complete application; native framework qualification remains separate.

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
- Code highlighting, line numbers, XML validation, formatting, tag/property completion, find/replace, indentation, comment toggling, document symbols, selected-element navigation, and automatic bidirectional synchronization.
- Per-page undo/redo with up to 100 reversible entries and a bounded retained-history budget, device-local saving, project export/import, and canvas annotations.
- WPF/Avalonia namespace and common-property conversion with the original page retained; source preservation modes for WinUI and MAUI.
- XAML, standalone HTML, project JSON, and browser-compatible SVG `foreignObject` export. Registered export adapters appear in the export dialog.
- Registry APIs for toolkit controls, custom property metadata, nested scaffolds, browser renderers, and export adapters.
- Light/dark studio chrome, command palette, keyboard shortcuts, responsive panels, and optional WebMCP registrations.

## Compatibility and release status

This is version **0.7.0**, an implemented extensible designer foundation. It is **not a fully qualified replacement for Blend, Visual Studio, or native framework designers**. It does not provide complete WPF/Avalonia control, API, layout, or theme parity, and it does not execute arbitrary .NET assemblies in a browser.

| Capability                                                                       | Status                                                                                                                                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authored XML elements, attributes, namespace declarations, expressions, comments | Preserved within the supported XML subset; canonical formatting changes source trivia                                                                             |
| Common WPF/Avalonia panels and controls                                          | Editable and approximated by browser preview adapters                                                                                                             |
| WinUI / MAUI                                                                     | Source preservation and namespace selection; native semantics not validated                                                                                       |
| Unknown/custom controls                                                          | Preserved; accurate preview requires a registered renderer                                                                                                        |
| Native dependency-property engine, complete measure/arrange, text metrics        | Not implemented                                                                                                                                                   |
| Full converters, compiled bindings, arbitrary markup extensions, code-behind     | Preserved in source; not executed                                                                                                                                 |
| Styles/themes                                                                    | Scoped styles, setters, supported trigger conditions, templates and WPF state/storyboard playback; complete native property and theme semantics remain incomplete |
| Native framework compilation/loading                                             | Not performed; no native preview host is included                                                                                                                 |
| Data editor                                                                      | Typed in-project database with constraints and queries; no production SQL server or live database connector                                                       |
| Prototype                                                                        | Browser session actions and graph; native application code generation is not implemented                                                                          |
| Code IDE                                                                         | In-app editing features above; no Roslyn/LSP, debugger, project system, semantic refactoring, or folding engine                                                   |
| Collaboration                                                                    | Device-local workspace and annotations; no shared server or simultaneous coauthoring                                                                              |
| WebGPU                                                                           | Background grid implemented; control/text rasterization uses DOM/CSS                                                                                              |

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
  app.js                      Application startup and workspace recovery
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

## Reusable controls

Standalone component boundaries, compatibility imports and integration examples are documented in
[Reusable controls](docs/REUSABLE-CONTROLS.md). Try the application-independent
[Docking Lab](https://wieslawsoltes.github.io/XamoraStudio/examples/ControlsLab/),
[Code Editor Lab](https://wieslawsoltes.github.io/XamoraStudio/examples/EditorLab/) and
[Property Grid Lab](https://wieslawsoltes.github.io/XamoraStudio/examples/PropertyGridLab/).

`@wieslawsoltes/xamora-docking`, `xamora-control-primitives`, `xamora-code-editor` and
`xamora-property-grid` use the same canonical modules as Studio, with separate ESM/CommonJS
packages, declarations, CSS and opt-in browser bundles. Studio-specific language services and
property transactions remain adapters. The legacy controls package forwards to the canonical
constructors. Extraction does not publish npm packages.
