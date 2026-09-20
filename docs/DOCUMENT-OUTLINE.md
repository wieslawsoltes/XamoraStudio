# Structural document outline and source breadcrumbs

## Studio workflow

Use **View → Document outline**, the source editor's **Outline** button, command search, or **Ctrl/Command+Alt+O**. Ctrl/Command+Shift+O remains Open Solution. The optional outline is registered without selecting a panel or requesting focus. A new workspace keeps it closed; saved docking layouts can reopen it in the user's chosen position.

The outline shows the active document's complete element hierarchy, including unnamed controls, explicit XAML property collections, resource keys, HTML template children and foreign SVG/MathML nodes. It complements Layers and Symbols & references rather than replacing them. XML-language name/key aliases resolve by namespace. Search matches type names and element/resource names, ignores accents and case, requires all query terms, and retains ancestors of matching elements. An empty result provides a clear message; Escape in a nonempty filter clears it.

Arrow keys move tree focus without repeatedly selecting design elements. Right opens a branch or enters its first child; Left closes a branch or moves to its parent. Home/End navigate the visible outline, typing searches labels, repeated letters cycle, and `*` expands sibling branches. **Space or a row click selects in the designer**; **Enter or double-click reveals source**. Explicit XAML property collections select their logical owner in the designer while retaining their own source locations for source navigation. The footer exposes both actions without relying on shortcuts. This is a single-selection browsing control, not a multi-element refactoring selection UI.

**Follow selection** connects source caret/design selection to the outline. Turn it off to browse independently. **Locate** clears a filter and reveals the current selection. Filter, collapsed branches, active row and scroll position are retained separately for each document session while Studio is open. These view states and the follow toggle are not saved into project source or persisted as a new cross-reload preference.

The source breadcrumb bar follows the actual ancestor path. Its buttons navigate through the existing source history and keep the textarea focused, including in a detached source window. The Edit and Designer **Structural navigation** menus also expose parent, first child, and previous/next sibling actions. Breadcrumbs use native overflow scrolling without adding toolbar scroll-arrow controls.

Parser-implied HTML elements such as omitted `html`, `body`, or `tbody` remain in the hierarchy, labeled **(implied)**. They do not receive invented authored source coordinates. Source reveal is unavailable for an implied element; the message explains why. Invalid or pending source and active IME composition pause actions on the retained last-valid outline. Nothing is reset, reparsed, renamed or serialized merely by navigating the outline.

The outline and breadcrumbs move with their existing live docking nodes. Filtering, keyboard operation and source/designer navigation continue when the outline and source are in different dependent browser windows. Existing popup permission and owner-session rules still apply.

## Source newline boundary

The source session stores authored UTF-16 text, while HTML textareas expose LF-normalized strings. `SourceTextCoordinates` explicitly maps between them. `DocumentSync` preserves the canonical source on a no-change flush and maps ordinary editor edits back into the document's newline style. Language completion, caret selection, matching tags, structural selection, navigation history, refactoring and diagnostics use authored source offsets internally and map them only at the DOM boundary. Standalone CodeEditor normalizes its `setValue` snapshot to the same value that its native textarea actually exposes, preventing false dirty state and caret displacement.

CRLF, LF, lone CR, BOM and surrogate-pair offsets are covered. Unchanged source is returned byte-for-byte. For an edit, the untouched prefix and suffix retain their original spelling, including mixed endings; new/replaced lines in the changed interval use the first newline style of that document. A whole-buffer replacement or explicit formatting is not a guarantee of retaining mixed newline styles inside the replaced interval. `window.xamora.setSource` remains a canonical-source API; textarea synchronization is the converting boundary. Save source continues to download the canonical draft.

## Reusable APIs

`@wieslawsoltes/xamora-markup/markup-structure` exports `MarkupStructureIndex`. It reads the canonical `DocumentSession` AST and concrete source map, caches by root/source/revision and exposes immutable element entries, source lookup, ancestry, logical designer owners and structural relatives. Caret queries use an augmented interval tree rather than scanning all earlier siblings. Invalid/disposed sessions return no stale locations. The public offsets and line/column locations are authored UTF-16 coordinates, not DOM textarea positions.

`@wieslawsoltes/xamora-markup/source-text-coordinates` exports `SourceTextCoordinates` with `toSource`, `toEditor` and `fromEditor`. Mappings are immutable source snapshots and reject invalid offsets. Create a new snapshot when the canonical source changes.

`@wieslawsoltes/xamora-control-primitives/outline-tree` exports `OutlineTree`; import `@wieslawsoltes/xamora-control-primitives/outline-tree.css` for standalone styling. The control needs a sized host. It copies parent-first input data, does not author the application model, and supplies explicit selection/activation callbacks, filtering, expand/collapse, view-state capture/restore, row sizing and reversible disposal. It renders only viewport rows plus their ancestor paths and the active descendant, with actual treeitem/group ownership and explicit level/position/set-size semantics. IDs are unique across independent instances. Labels are rendered as text, never HTML.

```js
import { OutlineTree } from '@wieslawsoltes/xamora-control-primitives/outline-tree';
import { MarkupStructureIndex } from '@wieslawsoltes/xamora-markup/markup-structure';
import { SourceTextCoordinates } from '@wieslawsoltes/xamora-markup/source-text-coordinates';
import '@wieslawsoltes/xamora-control-primitives/outline-tree.css';

// session is your existing DocumentSession; sourceInput is its native textarea.
const index = new MarkupStructureIndex(session);
const outline = new OutlineTree(outlineHost, {
  items: index.entries(),
  onActivate(id) {
    const range = index.get(id)?.range;
    if (!range) return;
    const coordinates = new SourceTextCoordinates(session.source);
    sourceInput.focus();
    sourceInput.setSelectionRange(
      coordinates.toEditor(range.start), coordinates.toEditor(range.end),
    );
  },
});
const update = () => outline.setItems(index.entries());
session.addEventListener('change', update);
// On teardown: session.removeEventListener('change', update); outline.dispose(); index.dispose();
```

Studio's optional `window.xamora.outline` API exposes `show`, `entries`, `path`, `reveal`, and `select`. It rejects stale/pending/invalid sources and becomes inert after workspace disposal. Core APIs and the standalone control have ESM, CommonJS and declaration exports through their existing packages. No additional package or npm release is required.

## Qualification and limits

Unit regressions exercise structural source ranges, cache invalidation, 4,000-sibling lookup, virtualized 10,001-entry controls, ARIA ownership, keyboard/filter behavior, independent DOM realms, disposal, per-document UI state, startup focus, CRLF input/refactoring/history and invalid drafts. Native Chromium cases check actual HTML repair, SVG/MathML/template namespaces, actual textarea normalization, mounted-row geometry and keyboard behavior, against canonical and packaged APIs. The full Studio browser gate checks imported CRLF, command discovery, completion/refactoring/Undo, two real popup documents, restored content and synthetic HTML boundaries.

This is not editor code folding, linked typing, multi-file semantic analysis, exhaustive framework type validation or native-identical text layout. No new authored-code execution, AI requests or preview sandbox permissions are introduced. Physical touch devices, screen-reader/browser combinations, Firefox/Safari and production-scale latency still require separate qualification. Tree keyboard behavior follows the WAI-ARIA APG tree pattern; automated assertions do not replace an assistive-technology audit. Textarea newline behavior follows the HTML textarea API-value rules.

References: https://www.w3.org/WAI/ARIA/apg/patterns/treeview/ and https://html.spec.whatwg.org/multipage/form-elements.html#the-textarea-element
