# @wieslawsoltes/xamora-docking

Standalone docking model and DOM control extracted from Xamora Studio. The model is DOM-free. The view moves consumer-owned nodes rather than cloning them. No Studio, renderer, markup parser or design-document dependency is required.

```js
import { DockLayout, DockWorkspace } from '@wieslawsoltes/xamora-docking';
import '@wieslawsoltes/xamora-docking/docking.css';

const model = new DockLayout([{ id: 'editor', title: 'Editor', kind: 'document' }]);
const workspace = new DockWorkspace(document.querySelector('#workspace'), model);
workspace.mount('editor', document.createElement('textarea'));
workspace.render();
model.float('editor', { x: 60, y: 60, width: 500, height: 300 });
model.undo();
const saved = model.serialize();
model.load(saved);
// Detach and take ownership of a panel's existing content:
const node = workspace.unmount('editor');
workspace.dispose(); // detaches listeners/observers; never destroys the model
```

Give the host an explicit height. The CSS includes its own defaults and scroll-strip styles. Override `--panel`, `--text`, `--border`, `--canvas` and `--dock-active` on your page to theme it. `./browser` is an opt-in self-contained ESM bundle for direct browser use; use it consistently rather than mixing bundled and unbundled constructors.

Supports split groups, tabs, floating groups, auto-hide, minimum sizes, keyboard navigation, validated layout serialization, undo and redo. Shortcuts default to the containing workspace; `keyboardScope: 'document'` opts into application-wide shortcuts. Dialogs and other docking workspaces are not intercepted. Call `dispose()` before removing a workspace permanently. A panel node can be mounted under only one ID in a given workspace.

All existing `@wieslawsoltes/xamora-controls` docking exports remain compatibility reexports of the same constructors. Floating groups stay in-page by default. Opt into dependent same-origin browser windows with `browserWindows: true`; browser windows are not unrestricted native desktop docking or snapping.

## Browser windows

```js
const workspace = new DockWorkspace(host, model, { browserWindows: true });
workspace.mount('editor', editorElement);
workspace.render();
// Connect to a real user gesture; popup permission is required.
openButton.onclick = () => workspace.openWindow('editor');
returnButton.onclick = () => {
  for (const { id } of workspace.windows.list()) workspace.returnWindow(id);
};
// Layout loading restores intent in-page, never unsolicited popups.
reopenButton.onclick = () => {
  const [id] = workspace.windows.pending();
  if (id) workspace.windows.reopen(id);
};
```

Single tabs, complete groups and floating split trees share one model and live node registry. Transfer grips and context commands move content between hosts without copying editor buffers. Directly mounted input nodes and nested editors are both focusable through `workspace.focus(id)`. Returning an unrelated window does not cancel a drag or pointer gesture in another; group activation guards use the selected moving member, including background groups.

For delegated application events, pass reversible portal integration via `browserWindows.onOpen`; its returned cleanup runs once on release, including synchronous teardown during opening. `onClose` can explicitly reopen a live tree while the owner is available. Owner navigation and disposal reject reopening and release transfers, observers and watchers. See `docs/DOCKING-WINDOWS.md` for `DocumentScope` integration, lifecycle contracts and automated coverage.

Closing the owner closes dependent hosts. Browser permissions govern popup allocation, placement and focus. Saved layout geometry is not a backup of editor source. Iframes can reload when adopted into a different document; autonomous closed-owner sessions, native OS snapping, physical multi-monitor dragging, Firefox and Safari are not qualified by the Chromium suites.

See `dist/examples/ControlsLab/` for a source-mode browser example and `docs/REUSABLE-CONTROLS.md` for package boundaries. ESM, CommonJS, TypeScript declarations and CSS are included. MIT licensed. Publication remains a separate explicit action.
