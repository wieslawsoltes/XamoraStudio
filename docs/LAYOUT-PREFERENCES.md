# Document panel and chrome preferences

Studio keeps docked document panels in place after their last editor closes. An empty panel
retains its group identifier, split ratio and position and remains a tab drop target. Reopening
an editor returns it to its saved group; a newly created document can reuse a vacant document
panel. Closing an editor still preserves its document, source buffer and document history.

Use the **View** menu or command search:

- **Keep empty document panels** is enabled by default. Turn it off to collapse empty document
  groups. Disabling it also removes empty groups from layout undo/redo and editor-mode return
  snapshots, so layout undo cannot silently re-enable this preference.
- **Show canvas navigation tips** is disabled by default. Enable it to display the bottom
  Space-to-pan / modifier-and-scroll hint again. Canvas gestures and the Help shortcuts remain
  available while the hint is hidden.

Both preferences are saved in `xamora-layout-preferences-v1` in this browser. They do not modify
any authored XAML/HTML or document history. Blocked storage falls back to defaults and a failed
save leaves the current session setting usable. Empty wells themselves are part of the existing
saved docking tree, not fake registered documents. Changing the preference does not resurrect
previously collapsed groups. Deliberate Design / Code / Split / Views mode changes remove unused
wells rather than leaving blank areas where a mode intentionally hides an editor.

Tool groups and floating/browser windows still close when emptied. This prevents a retained
main-window document area from keeping an unnecessary detached browser window alive.

## Standalone docking

Standalone consumers retain the previous collapsing default. Opt in with the shared model:

```js
import { DockLayout, DockWorkspace } from '@wieslawsoltes/xamora-docking';

const model = new DockLayout(panels, savedLayout ?? null, {
  keepEmptyDocumentGroups: true,
});
const workspace = new DockWorkspace(host, model);

model.setKeepEmptyDocumentGroups(false); // collapse existing empty wells
model.setKeepEmptyDocumentGroups(true); // retain future emptied document wells
```

`createDockLayout(ids, { documents, keepEmptyDocumentGroups: true })` can create an empty main
well even before a document is registered. Pass the same option to `DockLayout` to retain it.
The runtime option is intentionally independent of serialized layout data; importing a layout
cannot overwrite a host's preference. The constructor, setter and layout factory require a
boolean. `pruneEmptyGroups()` explicitly removes unused wells in one layout-undoable operation
without changing the preference; Studio uses this for deliberate editor-mode changes.

## Scroll controls

Only document/tool docking tab strips receive arrow buttons. Topbar, menu bar, toolbar and
statusbar keep native horizontal scrolling and have no arrow controls. Docking tab arrows are
hidden until the tabs actually exceed the full available strip width. The visibility decision
includes the space the arrows themselves occupy, preventing a fitting tab row from keeping
unnecessary arrows or flickering near the overflow threshold. Resize, text and DOM changes
refresh the result. Hidden buttons are excluded from layout even in standalone consumers that
have no global `[hidden]` stylesheet. At either end of an overflowing row, the corresponding
arrow is disabled.

## Regression coverage

`tests/layout-preferences.test.mjs` covers retained identity/ratios, close/reopen, layout
serialization, strict empty-group validation, registry reconciliation, undo/redo migration,
explicit mode cleanup, empty drop targets, overflow thresholds and preference lifecycle.

`tests/browser-layout-preferences.mjs` is automatically part of the normal Chromium gate. It
exercises real View-menu switches, saved-layout reload, new documents in vacant wells, editor
modes, narrow chrome, and both source and packaged standalone docking with actual overflow.
Snapshots are written to the existing `ui-review-snapshots` artifact directory. Existing unit,
package, browser and native gates remain unchanged. Physical-device and additional-browser
qualification remain separate from these automated checks.
