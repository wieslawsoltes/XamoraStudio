# Xamora 0.4 docking workspace

The designer now uses an IDE docking workspace instead of a fixed three-column panel layout. The implementation follows the window interactions described in Microsoft's [Customize window layouts and personalize tabs](https://learn.microsoft.com/en-us/visualstudio/ide/customizing-window-layouts-in-visual-studio?view=visualstudio) and [application patterns](https://learn.microsoft.com/en-us/visualstudio/extensibility/ux-guidelines/application-patterns-for-visual-studio?view=visualstudio).

## Daily workflow

- Drag a **tab** to move one window. Drag a **title bar** to move its tab group.
- Move over a group to see the docking compass and blue destination preview. Drop at an edge to create a split; drop in the middle to join tabs. Move to the outer workspace edges to split the full workspace.
- Drag within a tab strip to reorder tabs. The tab context menu provides horizontal and vertical groups, moving between groups, floating, docking back, pinning document tabs, closing other unpinned tabs and closing a group.
- Hold **Ctrl/Command while dragging** to suppress docking and float. Floating windows move and resize within the browser workspace. Their title-bar maximize button toggles full-workspace size while retaining restore bounds.
- Use a tool window's **pin/auto-hide button** or context menu to move it to an edge strip. Hover or click its strip tab to reveal a flyout. Focus remains usable inside the flyout; outside focus/click or Escape dismisses it. Resize its inside edge and pin it to restore docking.
- Double-click a tool title bar or Ctrl/Command-double-click a document title/tab to switch between docking and floating. Double-click a floating title bar to maximize it. Double-click a document tab to pin or unpin it.
- Choose **Window → All windows** to reopen closed windows. Closing a document tab closes its workspace view; it does not delete the design page.
- Click **Window** to open **Windows and layouts** to save, load, delete, export, import, reset or undo window layouts. Built-in presets are Designer, Coding, Animation and Compact.

The top Window button opens the layout manager directly. “All windows…” opens the searchable navigator.

## Integrated windows

| Window                                                                | Integration                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document tabs                                                         | Each workspace page has a stable document tab. Tabs can be reordered, pinned, floated or split into multiple document groups.                                                                                                   |
| Designer                                                              | The active page owns the original live canvas, hit testing, selection, grid editor, pan/zoom and GPU grid surface. Other visible page groups show scaled previews; activating a page moves the live canvas to it.               |
| XAML source                                                           | The existing editor instance and textarea are retained when docking changes. Dirty source, selection, scroll, completion state and listeners are preserved across panel moves. The tab marks unapplied source with an asterisk. |
| Layers                                                                | Page list, tree, selection, locks, layer drag/drop and search remain connected to the active design document.                                                                                                                   |
| Toolbox                                                               | Separate search and control insertion surface, including drag from the toolbox to the canvas.                                                                                                                                   |
| Resources                                                             | Separate brush, template, style and theme resource navigation.                                                                                                                                                                  |
| Data sources                                                          | Independent table/query/binding-source browser; its editing dialogs remain available.                                                                                                                                           |
| Properties, Raw properties, Interactions, XAML inspector, Annotations | Separate dockable tools that update with the active selection and retain the existing editing behavior.                                                                                                                         |
| Views & connections                                                   | Independent multi-view board with prototype connections and responsive comparisons. It can remain visible alongside the canvas.                                                                                                 |
| Objects & timeline                                                    | Independent timeline; showing it initializes the active page's storyboard. Hiding it stops recording and preview playback.                                                                                                      |
| Error list                                                            | Dockable diagnostics list connected to document selection and XAML source.                                                                                                                                                      |

Tools may join document wells. Document windows use document groups and cannot auto-hide. Selecting a different design page keeps the designer's existing XAML validation guard: pending invalid XAML must be fixed before switching; the docking operation does not discard it.

## Keyboard and accessibility

| Action                                  | Shortcut / control                                                      |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Next / previous visible window          | F6 / Shift+F6                                                           |
| Next / previous open tab                | Ctrl/Command+Tab / Ctrl/Command+Shift+Tab, when the browser delivers it |
| Window navigator                        | Ctrl/Command+Q; also always available from Window                       |
| Close active window                     | Ctrl/Command+F4                                                         |
| Maximize / restore active group         | Alt+Shift+Enter; title-bar button and context menu                      |
| Tab-strip navigation                    | Arrow keys, Home and End                                                |
| Tab context menu                        | Shift+F10 or right-click                                                |
| Keyboard splitter resizing              | Arrow keys; Shift for larger steps; Home/End; Enter for equal split     |
| Cancel drag/resize; dismiss flyout/menu | Escape                                                                  |

The docking chrome includes tablist/tab/tabpanel semantics, selected states, labels, focus indicators, keyboard separators and live docking announcements. The browser or OS may reserve Ctrl+Tab, Command+Q or other combinations, so menu routes are provided. This release has not undergone an accessibility audit.

## State and persistence

`DockLayout` owns a serializable tree of binary splits and tab groups. Floating roots, edge strips, closed panel IDs, active/pinned tabs, focus mode, remembered dock/float locations and flyout sizes are stored alongside it. Panel content and callbacks live in a registry outside the serialized data.

Each operation clones the layout, edits the candidate, collapses empty groups/splits, validates identifiers and panel ownership, and only then commits. A panel appears exactly once in a group, floating tree, auto-hide strip or closed list. Invalid destinations and invalid imports cannot partially remove panels. Layout undo has 60 snapshots and is independent of XAML document undo. Registering/removing an extension panel clears incompatible layout history.

Current layout persistence uses `xamora-dock-layout-v1`; named layouts use `xamora-dock-presets-v1`. Layout import validates a bounded JSON file and reconciles unknown/missing panel IDs with the current registry. New panels absent from a saved layout begin closed. The design project remains authoritative for pages, controls, data and annotations. Layout JSON contains only window arrangement, not document contents or unsaved editor text.

## Standalone control

The core and control are independent of the Studio application:

- `dist/core/docking.js` and `docking.d.ts`: model, operations, validation, serialization and history; no DOM dependency.
- `dist/controls/dock-workspace.js` and declarations: docking DOM control and input handling.
- `dist/styles/docking.css`: docking presentation plus scoped Studio adapters.
- `dist/studio/docking-studio.js`: designer panel registration, document activation, host routing and layout management.
- `dist/examples/DockingDemo.html`: runnable standalone example. With `npm start`, open [standalone docking demo](https://wieslawsoltes.github.io/XamoraStudio/examples/DockingDemo.html).

```js
import {DockLayout} from './dist/core/docking.js';
import {DockWorkspace} from './dist/controls/dock-workspace.js';

const panels = [
  {id: 'editor', title: 'Editor', kind: 'document'},
  {id: 'properties', title: 'Properties', kind: 'tool'},
];
const model = new DockLayout(panels);
const workspace = new DockWorkspace(document.querySelector('#workspace'), model);
workspace.mount('editor', existingEditorElement);
workspace.mount('properties', existingPropertyGridElement);
model.show('editor');
model.dock('properties', model.state.root.id, 'right');

model.addEventListener('change', event => {
  // Layout changes are separate from your document transactions.
  console.log(event.label);
});
const saved = model.serialize();
model.load(saved);
```

The host must have a definite height. Include `docking.css` and define its optional panel/text/border theme variables. Use `beforeActivate` to guard document transitions, `onVisibility` to suspend expensive previews, and the control's `resize` event to invalidate geometry. Call `dispose()` when removing the control.

In the designer, an extension registers a live element:

```js
const content = document.createElement('div');
content.textContent = 'Custom inspection tools';
const panel = window.xamora.docking.registerPanel({
  id: 'my-toolkit:inspector',
  title: 'My toolkit inspector',
  content,
  kind: 'tool',
});
panel.show();
panel.close();
panel.dispose();
```

## Explicit boundaries

This is an in-page docking host. Floating panels stay within the browser workspace; they are not independent operating-system windows. Cross-monitor native windows, taskbar ownership, OS snapping, independent application menus and Visual Studio's native window manager require a desktop host adapter. Arbitrary cross-origin iframe docking and cross-browser-window document transfer are not implemented.

Multiple design pages can be displayed together, but one page at a time owns the fully editable canvas and shared XAML editor. The inactive page previews are activated before editing. Window layout persistence is device-local, separate from project export, and does not implement shared or server-synchronized workspaces.

Validation covers the model and deterministic DOM/integration behavior. No browser-driven drag/drop, visual layout, touch device, physical GPU or native Windows qualification was performed. See VALIDATION.md for the executed suite.

## Refinements in 0.5

Design/Code/Split/Views are now explicit surface modes. Code and Views retain a serialized snapshot of the preceding whole window arrangement, including tiled/floating pages and closed tabs. Design/Split restore that snapshot before applying their visibility. Tool-window changes made in the temporary mode also return to that arrangement. Mode changes are a single layout undo step. Re-selecting a matching split preserves its ratio.

The group header's tab list exposes overflowed tabs. Revealing a window outside a focused group exits focus, and activation scrolls its tab into view. Panel descriptors accept minimum width/height hints for pointer split limits. Registration changes are excluded from synchronous layout batches. See [Editor workflows](EDITOR-WORKFLOWS.md) for source-buffer recovery, multi-view tiling and the shared-canvas model.

## Density in 0.6

The Density selector and View → Interface density change title/tab spacing without changing dock tree, visibility, floating bounds or layout history. Compact uses 22-pixel titles and 24-pixel tab rows; Standard uses 25/28; Comfortable uses 29/33. Pointer splitter limits account for these metrics. Splitters and auto-hide rails retain their original hit areas. Density is a separate browser preference, so loading a named layout does not overwrite it.

## Tab navigation in 0.7

All tool/document tabs, including floating groups and auto-hide rails, can be dragged. Drag a tab to move one window; drag a title bar to move its group. Tab-strip hits take precedence over outer workspace edges, blank tab-strip space appends, and a blue insertion line shows ordering. Hover near either edge during dragging to scroll overflowing tabs. Ctrl/⌘ continues to force a floating drop.

Horizontal tab strips and the shell command bars have left/right scroll buttons. Scrollbars are hidden while touchpad scrolling, keyboard tab navigation, and active-tab reveal remain available. Navigation buttons isolate editing keys from the design canvas. Tab offsets persist when other windows are docked or a strip is rebuilt. The reusable `ScrollButtons` control and its CSS are available outside the app.

## Selection and document lifecycle invariants

Opening a background document registers and docks it without changing the active document,
selected tool tabs, or keyboard target. `DockLayout.dock(..., { activate: false })` is the
explicit background-insertion API. Studio switches documents only after insertion completes.
Full document refreshes do not interpret temporary inspector/sidebar rendering modes as
requests to show another tool window.

Deferred focus and auto-hide hover callbacks are revision-checked: a later activation,
layout change, removal or disposal invalidates earlier requests. Focus from an independent
workspace with the same panel identifiers cannot activate this workspace. Whole-group moves
retain their selected member; closing a document prefers the adjacent document or another
document group before falling back to a tool group.

Registry changes publish one coherent model snapshot. Layout undo/redo survives document
registration/removal through reconciliation, including saved editor-mode snapshots. Undo
cannot resurrect an unregistered panel or discard a newly registered one. These layout
operations remain separate from document content history and pending-source validation.
