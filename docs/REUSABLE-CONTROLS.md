# Reusable controls

## Boundaries and compatibility

The standalone controls use the same canonical `dist/` source modules as Studio; they are not parallel implementations. `@wieslawsoltes/xamora-control-primitives` owns menus, scroll strips and density preferences. `@wieslawsoltes/xamora-docking` owns the DOM-free docking model and the DOM workspace. Docking depends only on the primitives package, not the application, parser, renderer or document model.

`@wieslawsoltes/xamora-controls` retains its original exports as generated compatibility reexports. A canonical module has one package owner, so old and new package paths resolve the same constructors. Normal package imports are unbundled. Opt-in `./browser` bundles include their dependency closure; do not mix those bundles with unbundled constructors in the same object graph.

CSS is packaged beside its declared dependencies. The build rewrites source-relative stylesheet imports to the flattened package asset directory and rejects missing imports. Studio-specific layout rules remain in `dist/styles/`; reusable control styles live in `dist/controls/` and include standalone defaults.

## Docking integration

Create a `DockLayout`, construct a `DockWorkspace` with a sized host, mount your own panel nodes and call `render()`. The application retains ownership of the model and document data. `unmount(id)` returns a detached content node; `dispose()` releases observers and listeners, returns remaining content to the host and leaves the model usable.

Shortcuts are scoped to the owning workspace by default, allowing two independent workspaces in one page. Studio explicitly selects document-wide keyboard routing to retain its original behavior. Dialogs and another workspace's content are excluded from routing.

See `packages/docking/README.md`, `packages/control-primitives/README.md` and the runnable `dist/examples/ControlsLab/` example. APIs, CSS, ESM/CommonJS entry points and TypeScript declarations are included in package artifacts. No npm publication is performed by extraction or validation.

## Code editor

`@wieslawsoltes/xamora-code-editor` owns the editing surface, buffer history, find/replace, selection mapping, completion UI and lifecycle. A synchronous language provider supplies language semantics; the default is plain text with no parser dependency. `dist/core/editor.js` now keeps only the compatible XAML/HTML adapter and imports the same control used by standalone consumers. Existing Studio document-session hooks remain authoritative for shared undo/redo and validation.

The package README documents providers, dirty-buffer guards, read-only mode and disposal. `dist/examples/EditorLab/` runs a JSON editor without Studio. Browser tests also load the generated standalone bundle and CSS with no core/Studio requests.

## Property grid

`@wieslawsoltes/xamora-property-grid` owns reusable property fields, grouping/filtering, synchronous validation and controlled commit/reset events. It has no runtime dependencies. The application supplies descriptors and remains responsible for persistence and transaction history. Accepted user edits preserve input identity; schema replacement is explicit. See `packages/property-grid/README.md` and `dist/examples/PropertyGridLab/`.

Studio now uses `PropertyGrid` for All Properties and the shared `renderPropertyField` renderer for standard inspector fields. Its adapter uses external event mode so existing property transactions, specialized brush/resource editors, invalid-draft guards and shared undo/redo remain unchanged. Framework semantics belong to the adapter, not the generic control.

## Dialog hosting

`@wieslawsoltes/xamora-dialogs` extracts the existing modal presentation/focus responsibilities from `dist/studio/dialog-host.js`. Studio keeps a small adapter for its trusted templates, close-button icon and legacy element IDs. Both consumers run the same `DialogHost` implementation; workspace actions and persistence remain application-owned.

The package includes literal-text and live-element content, explicit trusted HTML, focus wrapping, inert-background restoration, nested host ownership, pending-action suppression, abort signals and stale-result guards. It supplies its own scoped CSS; Studio retains its existing presentation overrides. See `packages/dialogs/README.md` and `dist/examples/DialogLab/`. No npm release is performed.

## Choosing an entry point

| Package                     | Responsibility                                      | Runtime dependency         |
| --------------------------- | --------------------------------------------------- | -------------------------- |
| `xamora-control-primitives` | Menu bar, scroll buttons and density preferences    | None                       |
| `xamora-docking`            | DockLayout and DockWorkspace                        | Control primitives         |
| `xamora-code-editor`        | Language-neutral editor and provider hooks          | None                       |
| `xamora-property-grid`      | Property descriptors, fields and controlled editing | None                       |
| `xamora-dialogs`            | Modal lifecycle, focus and controlled async actions | None                       |
| `xamora-controls`           | Compatibility and convenience reexports             | Canonical control packages |

All names above use the `@wieslawsoltes/` scope. For existing XAML/HTML code-editor behavior use `XamlEditor` from `xamora-designer/editor`. Source examples import canonical files directly; installed-package tests verify the package dependency closures and constructor identity through ESM and CommonJS reexports. Browser tests exercise each standalone bundle and its own CSS without Studio/core requests.

The editor is textarea-based with synchronous providers, not a Monaco-equivalent editor or a line-virtualized renderer. The property grid handles explicitly supplied scalar descriptors, not automatic reflection of arbitrary object graphs. Docking floats within the browser page, not native OS windows. Existing richer Studio features remain in their application adapters; this extraction does not claim they all became standalone controls.

## Extraction status and remaining boundaries

The named docking, primitive controls, code-editor and property-grid extractions are integrated into Studio. The property-grid integration gate also covers separate docked inspector hosts and disposal of replaced/shared hosts. Dialog presentation is a further reusable package, rather than an app-specific copy.

The named canvas, animation/state, resource/brush, solution and data workspaces now have canonical implementations and packages under `dist/workspaces/`. They are document-aware authoring libraries with an explicit application host, not generic model-free controls. See [Workspace components](WORKSPACE-COMPONENTS.md) and the standalone WorkspaceLab for ownership, service contracts, package composition and lifecycle tests. Nested-object editing, editor viewport virtualization and desktop-window docking remain separate feature changes.
