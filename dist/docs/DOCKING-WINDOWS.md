# Docking across browser windows

## Using the Studio

Right-click a tab and choose **Open tab in browser window**, or use **Open group in browser window** to move the entire selected tab group. The group-header **↗** button does the same for a group. A window already hosting the complete requested floating tree is focused, rather than duplicated.

A browser host can contain multiple document and tool groups, including nested splits. All hosts share the same document stores, source editor, command history and docking layout. Source edits and property changes use the same validation and transaction paths as the main window. The active design page still owns the one editable canvas; other page views remain activation-driven previews, not independent editors.

Use the **⠿ transfer grip** beside a tab or in its group header to drag it to another browser host or back into the main workspace. The dedicated grip uses native HTML drag-and-drop; ordinary tab/title dragging continues to use the existing pointer-based docking compass and split/tab-reordering behavior inside its window. Context-menu **Move to…** commands provide a keyboard-accessible alternative between all groups. Alt-dragging outside a local destination can request a new host when the browser delivers the release event; the explicit window buttons are the dependable route on touch devices or where the browser captures the drag.

The popup toolbar's **Return to main window**, the group-header **↙** button, or closing/reloading the popup returns its live panels to an in-app floating tree. **Dock back** then restores the remembered docking position. This does not close or delete the underlying project document. **Focus main window** brings the application menus and owner-hosted dialogs forward. Application dialogs open in the main window and restore the previous live field when dismissed. Docking context menus and tab lists open in the window where the action occurred.

Existing docking keyboard routes work in registered popup documents, subject to browser-reserved shortcuts. A hidden tool can still be reopened from the Window navigator. Theme, density, ordinary stylesheet nodes and host custom properties are mirrored into browser hosts. No second Studio application is booted.

## Persistence and recovery

`DockLayout` records optional `browserWindow` geometry on a floating root. Browser opening is a single layout transaction. Undo closes its physical host and restores the prior layout. Redo, layout import, startup and return from the browser back/forward cache restore **intent**, not permission to open popups. Missing hosts appear as in-app floating roots; use their **Reopen saved browser window** context action to open them explicitly.

Popup allocation occurs before layout changes. Blocking, rejected activation, invalid bounds or a failed application portal callback cannot silently remove the requested panels. Returning a host reclaims active and inactive DOM nodes before its document is released. Closing the last group or moving all its panels elsewhere releases only that host. Disposing the control returns content to its caller and closes its hosts, without deleting the caller-owned model.

Closing or navigating away from the owner closes dependent browser hosts after reclamation. Source drafts continue to use the existing Studio document-recovery mechanism. Layout JSON is **not** a backup of source text: save/export the project normally. A browser/process crash is not a transactional save guarantee.

## Reusable packages

`@wieslawsoltes/xamora-docking` exports `DockLayout`, `DockWorkspace`, `DockBrowserWindows`, their options and geometry types. `@wieslawsoltes/xamora-control-primitives` exports `DocumentScope`; its use is optional. The compatibility controls package reexports the same constructors, not copies. These changes keep the existing package version and publishing configuration; they do not publish an npm release.

```js
import { DockLayout, DockWorkspace } from '@wieslawsoltes/xamora-docking';
import { DocumentScope } from '@wieslawsoltes/xamora-control-primitives';

const host = document.querySelector('#workspace');
const scope = new DocumentScope(document, host);
const model = new DockLayout([
  { id: 'source', title: 'Source', kind: 'document' },
  { id: 'properties', title: 'Properties', kind: 'tool' },
]);
const control = new DockWorkspace(host, model, {
  browserWindows: {
    onOpen({ document, host }) {
      // Cleanup runs when that host is released. No synthetic click forwarding.
      return scope.add(document, { root: host, workspace: host });
    },
  },
});
control.mount('source', sourceElement);
control.mount('properties', propertyElement);
control.render();

// Runs for real delegated input events in the owner and registered popup hosts.
const unlisten = scope.listen(host, 'input', event => {
  // Apply your own model validation and transactions here.
  console.log(event.target.value);
});
openButton.onclick = () => control.openWindow('source', {
  rect: { width: 900, height: 700 },
});
returnButton.onclick = () => {
  for (const { id } of control.windows.list()) control.returnWindow(id);
};
// At application teardown: control.dispose(); unlisten(); scope.dispose();
```

`DocumentScope` provides reversible document/window/workspace listeners, scoped queries, current focus and frame scheduling. Explicit caller-owned roots are required; it does not patch DOM globals or discover arbitrary windows. `WorkspaceContext` accepts it through optional `domScope`; components without that option retain their original single-root isolation. Components that cache a document/window must use the node's current `ownerDocument` for event constructors, pointer gestures, clipboard and layout APIs after adoption. Studio's code editor, workspace services and application adapters are updated accordingly.

`DockBrowserWindowOptions.openWindow(features, sourceWindow)` is a testing/host-adapter seam. It must return a **new same-origin blank Window**, or `null` for blocked allocation. Do not return an existing application document. `bodyClass` can supply application ancestor classes required by scoped panel CSS. `onOpen` is for reversible portal integration, not for nested layout batches or panel registration.

The standalone **ControlsLab** exposes opening, returning and reopening browser hosts without importing Studio. The normal package build includes ESM, CommonJS, declarations and browser bundles; the clean-consumer tests assert facade identity and option types.

## Security and platform boundaries

These are real browser windows belonging to **one owner workspace**, not independently running copies, cross-origin collaboration, or transfers between unrelated Studio tabs. There is no arbitrary message-command listener. Cross-window drag accepts only the current workspace's active opaque transfer token, not source code or project payloads from another page.

Popup opening requires browser permission and a user gesture. The browser decides whether to use a window or tab, honors or adjusts requested geometry, and controls placement, focus, monitor selection and reserved shortcuts. Native desktop ownership, taskbar grouping, unrestricted multi-monitor APIs and system docking/snapping are not implemented by this browser component. Same-origin access and an available opener are required; sandbox/COOP policies that sever them are unsupported. No permission restriction is bypassed.

Live form nodes, listeners, buffers and shared undo remain owned by the existing application. Browsers can reload embedded iframe documents when their elements move between documents; arbitrary third-party iframe runtime state is not serialized. Closed-owner continuation and crash-proof persistence are not provided. Existing accessibility semantics and touch controls remain, but physical touch devices, assistive-technology audits, physical multi-monitor drags, Safari and Firefox require separate qualification.

## Automated coverage

`tests/docking-windows.test.mjs` exercises independent DOM realms, live node identity, unrelated-render stability, blocked allocation, setup rollback, active/inactive reclamation, undo/redo/reopen, split-root preservation, between-host moves, unregister/dispose cleanup, serialized bounds, routed real events, editor undo and dialog return focus.

`tests/browser-docking-windows.mjs` exercises actual Chromium popup windows with the full Studio and packaged browser bundle: source/property editing, find and docking menus, theme/density, return/close/reload, blocked-allocation simulation, undo/redo, repeated file lifecycle, owner navigation, standalone controls and deterministically dispatched cross-document `DragEvent`/`DataTransfer` operations. The latter checks the transfer handlers; it is not physical OS drag qualification. Existing browser suites continue to run unchanged.
