# Xamora Studio — editor workflows

This release adds direct canvas authoring, a solution explorer, IDE menus, richer properties/resources, and more predictable document modes to the existing docking designer. The application runs in a browser and saves Xamora solution JSON and human-readable XAML. It does not run native WPF/Avalonia code-behind, MSBuild projects, or arbitrary .NET controls.

## Interface density in 0.6

**Compact** is the default, including existing workspaces with no saved density preference. Choose another mode with the **Density** selector at the right of the menu bar, **View → Interface density**, or the command palette (search Compact, Standard or Comfortable). The preference is local to this browser and synchronizes across its open app tabs. Clearing this preference restores Compact. It is independent of saved docking layouts and exported solution documents.

| Metric | Compact | Standard | Comfortable |
| --- | --- | --- | --- |
| Title / menu / toolbar / status bars | 36 / 24 / 34 / 22 px | 44 / 28 / 40 / 25 px | 54 / 32 / 48 / 28 px |
| Combined shell bars | 116 px | 137 px | 162 px |
| Dock title / tab rows | 22 / 24 px | 25 / 28 px | 29 / 33 px |
| Standard control height | 24 px | 29 px | 35 px |
| Solution/layer row height | 24 px | 29 px | 36 px |
| Panel section padding | 8 px | 12 px | 16 px |
| UI text / secondary text | 12 / 11 px | 13 / 12 px | 14 / 12 px |
| XAML line height | 18 px | 21 px | 24 px |
| Timeline track minimum | 30 px | 38 px | 46 px |

These are configured CSS values, not measurements from a browser screenshot. Compared with the previous 160-pixel shell, Compact allocates 44 additional CSS pixels to the dock workspace. A fixed-height list can show approximately 50% more 24-pixel rows than 36-pixel rows, before accounting for headers and wrapping.

Controls, menus and dock actions stay present. Toolbars scroll horizontally when their contents exceed available space. Version 0.7 uses left/right scroll buttons on the shell bars, so no extra scrollbar row is needed. Rich properties retain variable-height rows so gradients, alpha, four-side values and expressions are not clipped. Compact timelines wider than 1080 CSS pixels put Storyboard and transport controls beside one another; smaller timeline panes keep separate scrollable rows. Timing/key labels stay inline, and both target/property label lines remain present.

Changing density updates CSS and measured overlays without rebuilding the canvas, replacing a source input, changing source text, adding document/layout undo steps, changing artboard dimensions, or resetting zoom/pan. An active direct or dock drag is canceled before its geometry becomes stale. Five-pixel splitters, floating-window bounds and auto-hide rail sizes are retained for usable docking targets.

The setting affects the application interface. Authored controls, preview typography, exported XAML and HTML dimensions keep their own metrics. Standard is the middle-density option; Comfortable adds larger controls and spacing. These are new modes, rather than an exact recreation of every old pixel measurement.

## Start with these workflows

1. Open **Project → Solution Explorer**. Select a file, then Design or Source. Rename its full relative path in the field below the tree. Drag a file onto a folder to move it.
2. Use **View → Editor mode → Split**, then choose Side by side or Above and below. Switch to Code and back to Design to restore the previous window arrangement.
3. Select a TextBlock, Button, or other simple text control. Click **T** on its canvas toolbar. Edit in place; Ctrl/Command+Enter applies and Escape cancels. Bindings and structured content remain editable through their source/data editors.
4. Expand **Brush & gradient** in Properties. Choose Linear, drag stops on the ramp, edit stop colors/offsets, and adjust opacity or direction. **Transform & origin** exposes rotation, scale, skew, translation, and a visual origin selector.
5. Choose **Animation → Open motion example**. Open Objects & timeline, select a control, enable Record, seek forward, and move/resize/rotate it. The gesture authors keyframes; Stop restores the authored base presentation.
6. Open **Run → Views & connections**. Select page checkboxes and Tile selected, or drag a purple port to another page and edit the source/event/target in the board's connection strip.

## Direct canvas editing

The selection toolbar provides text editing, rotation, path editing, and a shortcut to Properties. Existing nested selection cycling, isolation, snapping guides, grid handles, container drop plans, and insertion/cell cues continue to work.

| Gesture | Result |
| --- | --- |
| Text toolbar button or existing double-click text gesture | Canvas-anchored text editor |
| Drag the rotation button | Rotate around the configured origin; Shift snaps to 15° |
| Enable Path anchors & tangents on a Path | Drag SVG path endpoints or curve control points; Shift uses an 8-unit grid |
| Insert → Draw → Rectangle / Ellipse / Line | Drag a shape into the selected container; Shift constrains equal extents |
| Scrub a numeric property label horizontally | Transient preview; one authored edit on release; Shift reduces the step |
| Escape, pointer cancellation, or lost window focus during new direct gestures | Restore the presentation and cancel the pending gesture |

Literal text beginning with `{` is encoded with XAML's `{}` escape. A bound Text or Content expression is not overwritten by the text overlay. For mixed inline content, select the actual text child. Text and path editing, gradient editing, and brush-type conversion are ordinary authored edits; they are not all animatable recording channels.

Canvas resizing in recording mode uses logical layout dimensions and inverse CSS transform vectors. This supports the implemented 2D transform mapping. It has not been qualified against native layout, 3D transforms, CSS perspective, all transform-origin combinations, or physical pointer devices.

## Document modes and docking

- **Design** shows the active editable canvas and hides source/board.
- **Code** shows the shared source editor and temporarily hides document canvases/board.
- **Split** shows source beside or below the active canvas. Selecting an already matching split keeps its ratio.
- **Views** shows the page/connection board and temporarily hides document canvases/source.

Entering Code or Views saves the current **whole window arrangement** in the serialized docking state. Returning to Design or Split restores that arrangement, including tiled pages, floating groups, and previously closed pages, then applies the requested mode. Consequently, temporary tool-window rearrangements made during Code/Views also return to the saved arrangement. Use named layouts for distinct long-lived workspaces.

One mode change makes one layout undo step. Layout undo/redo restores its mode snapshot. Manually docking a mixture of surfaces may produce a custom arrangement with no preset mode highlighted. All tabs in a group are accessible from its list button. Revealing a window outside the focused group exits group focus; the active tab scrolls into view. Extension panels may specify minimum-size hints, with a compact fallback when the viewport cannot accommodate them.

The browser still owns one editable canvas and one source editor. Other visible document groups display passive previews; activate one to move the live canvas to that document. Per-document pan, zoom, and isolation state are retained for the session. Floating groups remain inside the application window.

## Solution Explorer

A solution contains a name, relative file/folder paths, a startup file, documents, and installed declarative toolkit manifests. Existing flat workspaces migrate to this structure. File identity survives renames and moves.

Create Window, UserControl, ResourceDictionary, ControlTemplate, or DataTemplate files from File → New. Add existing XAML files together, create folders, search paths, rename/move a selection, duplicate a file, set the startup view, or remove a file. Closing an editor keeps the file in the solution. File-only actions reject a folder selection. Referenced dictionary files cannot be removed until their merge references are removed.

Moving files rewrites relative Source paths to preserve their targets, including differently cased dictionary references and relative image assets. Absolute, data, pack, and avares URIs remain unchanged. File-path lookup is case-insensitive; resource-key lookup follows the resource resolver's existing semantics. External asset bytes are not imported merely by rebasing their paths.

**File → Save solution** exports `.xamora.json`. Open solution validates document structure, paths, and toolkit manifests before applying the replacement. Installed manifests are additive; opening or undoing a solution does not unload previously installed toolkit registrations.

Solution-wide operations keep up to 30 snapshots. They establish a new document-history boundary because prior per-file edits can contain obsolete paths or resource names. To undo a solution operation after subsequent document edits, first undo those edits. Simply switching documents does not prevent solution undo. This is not a native `.sln`/`.csproj` build system, multi-project dependency graph, file watcher, or Git client.

## Menus and source editing

The menu bar contains File, Edit, View, Project, Insert, Format, Designer, Resources, Animation, Data, Run, Window, and Help. Its actions route to implemented commands, editors, dialogs, and extension inventories. Context-dependent commands are disabled when unavailable. Advanced triggers, state contracts, data schemas, bindings, and some resource structures still use dedicated dialogs or source.

F10 focuses the menu bar; Alt plus a menu's initial opens the first matching menu. Arrow keys navigate and open submenus; Home/End select the first/last enabled item; Escape returns focus. Duplicate menu initials use the first match; other menus remain accessible with arrows.

Edit Cut/Copy/Paste/Delete/Select all follow the focused text input when appropriate. XAML buffer Undo/Redo is separate from canvas/document undo and includes typed edits, completion, indentation, comments, replace, and formatting. Clipboard actions use the browser clipboard API. Generic non-XAML text-input undo remains dependent on browser support.

Source recovery records the current file ID, text, and synchronized model baseline after both native and programmatic edits. A pending write is flushed on page exit. Recovery is local to this browser and only applies when the file and baseline still match. Browser storage denial or clearing prevents recovery. Source remains unapplied until Apply/Ctrl+Enter; invalid source blocks dependent document/mode changes.

The existing completion provider covers registered types/properties, enum values, resources, names, binding/data paths, and motion metadata. The editor is a textarea with a highlighted mirror. It does not include semantic compiler IntelliSense, a language server, debugger, refactor engine, or code folding.

## Typed properties and resources

Properties now adds color plus alpha, linked/unlinked four-side values, segmented enum choices, numeric scrubbing, gradient stops, transforms/origin, basic effects, scalar style setters, and inline Grid track lengths. Grid lengths accept Auto, pixels, and star sizing; adding/removing tracks updates child cell indexes/spans through the existing grid model.

Changing a local solid brush color preserves its opacity and transforms. Converting its brush type is explicit. Editing a shared brush's local opacity clones the resolved brush before editing. Scalar replacement/reset removes a competing property-object element so exported XAML does not contain duplicate authored forms.

The Resources browser searches the solution or current file. It provides swatches, creation, duplication, visual editing, application to a selection, reference navigation, and merge ordering/removal. Applying a resource checks whether the key resolves to the chosen resource and can merge its dictionary into the active file. Renaming updates supported StaticResource/DynamicResource attribute references that actually resolve to that resource; it rejects collisions and new shadowing. Nested markup expressions, arbitrary strings, native implicit keys, compiled bindings, and code-behind references are outside that rename analysis. Reference-free deletion is checked against this supported reference set.

Gradient stop manipulation is intended for a single selected brush; general scalar/transform operations can apply to multiple selected objects. Unknown property types retain their raw/source editing route. Host extensions can register their own property editors.

## Animation authoring

The timeline adds inline Storyboard name/duration, property selection, frame snapping at 24/30/60/120 fps, timeline zoom, and an inline key inspector. Ctrl/Command-click toggles keys; Shift-click selects a time range within a track. Drag selected keys together, nudge with arrows, duplicate, copy/paste into their original Storyboard tracks, or delete. Collision checks reject overlapping destination keys atomically. Value-only edits and duplication preserve authored spline/easing metadata.

Record supported canvas movement, resizing, rotation, numeric property scrubs, transform fields, and solid brush colors at the playhead. New tracks get a base key at zero; existing From/To tracks convert through the existing native animation authoring logic. Nested BeginTime/SpeedRatio clocks map recording to local key time, and finite edited tracks extend their ancestor clocks even when a sibling repeats forever. Inactive clocks reject recording.

The ruler and key positions expose track-local key times on a shared ruler. Complex nested/repeating clocks are not a full hierarchical timeline editor; use source/advanced timing controls for those structures. Native Storyboard authoring is WPF-oriented. Cross-framework animation conversion, advanced property converters, automatic native transition contracts, and additive/handoff animation composition remain incomplete.

## Views and prototype connections

Cards retain their DOM when unchanged, with filtering, adjustable size, selected-page mode, responsive comparison, and incremental batches of 40. Up to eight selected pages can be tiled into docking groups. Thumbnail refreshes include document data and solution resource changes. A blocked source/document switch cancels tiling.

Drag a connection port to create a Click navigation action. The inline strip edits source, supported prototype event, target, and enabled state; All actions opens the existing ordered-action editor. Undo/removal/replacement invalidates stale editors. Selected-page mode shows connections between visible cards; breakpoint comparison omits them. Runtime data and navigation continue to use isolated preview sessions.

For the underlying database/query/binding workflows see [Designer workflows](DESIGNER-WORKFLOWS.md). For model, extension, and validation details see [Architecture](ARCHITECTURE.md), [Extending](EXTENDING.md), and [Validation](VALIDATION.md).

## Selection actions and HTML in 0.7

Selection actions are placed beside the type label when space permits, with an above/below fallback near viewport edges. They no longer share the type-label rectangle. Dock tabs and shell command bars use scroll buttons. See [Docking](DOCKING.md) for drag/reorder behavior and [HTML workflows](HTML-WORKFLOWS.md) for native HTML creation, source editing, visual authoring and preview.
