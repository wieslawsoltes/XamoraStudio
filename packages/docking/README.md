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

All existing `@wieslawsoltes/xamora-controls` docking exports remain compatibility reexports of the same constructors. Native operating-system windows are not created: floating windows stay inside the browser page.

See `dist/examples/ControlsLab/` for a source-mode browser example and `docs/REUSABLE-CONTROLS.md` for package boundaries. ESM, CommonJS, TypeScript declarations and CSS are included. MIT licensed. Publication remains a separate explicit action.
