# Native HTML authoring

Version 0.7.0 · 15 September 2026

## Open, create, and save

Choose **File → New → HTML page** for a responsive starter. **File → Add existing XAML / HTML files** accepts `.html` and `.htm` alongside XAML documents. Solution folders, startup view, duplicate, rename, save/reopen, docking, and Design/Code/Split/Views modes work with HTML files. Explicitly creating a XAML control while an HTML page is active uses WPF as its native default.

**Export current design** saves native HTML with its document head, CSS, scripts, attributes and comments. **Save solution** includes all HTML and XAML files in the existing project JSON. Untouched HTML returns the imported source exactly. A visual edit serializes the browser-parsed document into canonical HTML; attribute quotation, optional tags, doctype spelling, and whitespace may normalize. Undoing every change restores the original source again. This is document editing, not a byte-preserving patch engine.

## Canvas editing

- Click to select; Shift-click adds to selection; Alt-click cycles through ancestors. The Layers panel includes the complete HTML element hierarchy, including document metadata.
- Drag a flow element across another element to reorder it. Hold Alt during the drag to place it inside a container. Drag a layer onto a container in Layers to reparent it. A blue guide shows the destination.
- Drag elements with absolute or fixed CSS positioning to change left/top. Resize handles change CSS dimensions; north/west handles also adjust the origin of positioned elements.
- Double-click a simple text element for an inline editor. Mixed-content elements expose separate text segments so nested elements are retained.
- The HTML toolbox inserts standard browser elements by click or drag. Copy/paste, duplicate, grouping, ungrouping, keyboard nudge, deletion, and moving to another container use HTML structure/CSS.
- Space/pan, zoom shortcuts, source/document undo, delete, and clipboard commands remain available while the HTML frame has focus. Ctrl/⌘+wheel changes canvas zoom.

The canvas uses a native iframe at the artboard dimensions. Browser CSS performs layout, including media queries, grid and flex. The design frame pauses CSS animations and does not execute scripts. Interactive Preview runs HTML/CSS/JavaScript in a separate isolated frame with desktop, tablet, phone and artboard widths.

## Properties, styles, and source

Properties includes HTML attributes, explicit attribute removal, boolean presence toggles, layout, flex/grid, spacing, appearance, typography, transforms, and raw inline CSS. Empty strings are valid values, including `alt=""`; removal is a separate action. Raw Properties applies an attributes JSON object. Interactions edits event attributes. Inspect shows the selected HTML source. All inspector panels update together when docked side by side.

CSS grid tracks use `grid-template-columns`, `grid-template-rows`, `grid-column` and `grid-row`. Layout conversion commands create CSS grid/flex/relative containers. CSS can also be authored directly in the source. Updating an individual inline CSS property preserves unrelated declarations, including unknown properties, fallback declarations and data URLs.

Resources lists embedded styles/scripts and linked/image/media assets. Add a stylesheet or script, then edit its source. HTML documents have a dedicated CSS animation timeline for keyframe authoring, timing, recording and preview; its edits synchronize with the same HTML source. JavaScript-generated animations remain editable in source and run in Preview. See [HTML animation authoring](HTML-ANIMATIONS.md).

The source editor provides find/replace, indentation, commenting, validation and formatting. Source, visual and panel edits share the document session's undo/redo history, including invalid drafts. Valid source synchronizes automatically; Synchronize source (Ctrl/⌘+Enter) performs an explicit check. HTML element/attribute and CSS property completions use Ctrl/⌘+Space. Formatting is conservative around mixed inline content and leaves raw script/style bodies unchanged. A concrete syntax scan retains incomplete tags, attributes and comments as drafts while the last valid design remains visible; native browser HTML parsing still applies HTML repair rules to complete markup. JavaScript remains editable source; semantic JavaScript/TypeScript IntelliSense and debugging are not implemented.

## Isolation and boundaries

The design iframe uses `sandbox="allow-same-origin"` without script execution, plus a restrictive design-only CSP. The runtime preview uses `sandbox="allow-scripts"` without same-origin access. Authored CSS does not style the studio interface. Script, nested browsing/object content, navigation and refresh behavior are disabled in design rendering but retained in the authored document. Preview is an isolated origin; code that requires same-origin storage, cookies, backend authentication or an unrestricted browser context may need to be run from its exported application.

External stylesheets, scripts, fonts and media retain their URLs. Relative resources need an appropriate served origin; this release does not import an entire website folder, bundle dependencies, host a backend, execute custom-element code in the design frame, or connect HTML event scripts to the XAML data/prototype runtime. Inline assets and absolute URLs work within browser/network policy. The dedicated timeline authors CSS keyframes, while a general visual CSS selector/rule editor, browser debugger, and every SVG/path editing operation remain outside the implemented scope.

Source and model limits remain two megabytes of imported HTML, 15,000 nodes, and 150 levels. Tests exercise model/serialization/projection, CSS preservation, sandbox configuration, geometry and docking behavior with deterministic fixtures. A complete browser interaction/visual qualification was not performed.


## Live source and CSS animation editing

Code and visual edits now synchronize automatically through [DocumentSession](DOCUMENT-SYNC.md). HTML animations have a docked CSS keyframe timeline, browser-native scrubbing/playback and property/canvas recording; see [HTML animation workflows](HTML-ANIMATIONS.md). The old CSS-source-only animation guidance is superseded by that workflow.

## Interaction states and transitions

Use the **States** toolbar or **Animation → Visual states** to open the docked HTML state editor. Edit native pseudo states, named/class/data states, state CSS values and base/state transition lists; Record captures Properties/canvas changes while preserving base CSS. Preview and reset operate on the design iframe without changing source or history. Named-state bindings support eight event types and export an explicit readable runtime. **Animation → Open HTML interaction example** provides an interactive sample. See [HTML states](HTML-STATES.md) for the full workflow and priority/selector limits.
