# Reusable document workspaces

The remaining named authoring implementations now live in `dist/workspaces/`, not in the application. The old `dist/studio/` module paths re-export the exact same constructors. Studio supplies its browser services once, through `workspaceOptions`; standalone applications supply their own host. There is no second document tree, history stack, language compiler or renderer inside a panel.

## Packages

| Package (under `@wieslawsoltes/`) | Canonical components                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `xamora-workspace-context`        | `WorkspaceContext`, `WorkspaceComponent`, host interfaces and scoped browser services                                                                  |
| `xamora-canvas-workspace`         | `CanvasController`: selection cycling, hit testing, drop plans, guides and grid editing                                                                |
| `xamora-motion-workspace`         | `AnimationEditor`, `TimelineWorkspace`, `BlendFeatures`, `MotionRuntime`: XAML storyboards, keyframes, states, triggers, brushes, vectors and previews |
| `xamora-html-workspace`           | `HtmlWorkspace`, `HtmlAnimationWorkspace`, `HtmlStatesWorkspace`: HTML authoring and CSS motion/state UI                                               |
| `xamora-resource-workspace`       | `ResourceWorkspace`, `RichProperties`: resources, references, brushes, transforms and effects                                                          |
| `xamora-solution-workspace`       | `SolutionWorkspace`: explorer, file/folder operations, resource resolution and solution history                                                        |
| `xamora-data-workspace`           | `DataEditor`: typed records, schema, relationships, queries, object data and bindings                                                                  |

These are **document-aware authoring components**, not model-free widgets. They consume the existing public document/registry/rendering APIs and host services. Package manifests declare the actual dependencies. The context runtime uses no other runtime module; its host declarations use the shared contracts package.

Every package has ESM, CommonJS, declarations and a standalone browser bundle. Load its exported CSS asset explicitly. Normal ESM/CommonJS imports preserve shared constructor identity. An individual browser bundle includes its dependency closure; compose several workspaces through the single `@wieslawsoltes/xamora/browser` aggregate bundle or normal package imports, rather than mixing separate copies of document/model classes.

## Host contract

Each component constructor accepts `(host, workspaceOptions = host.workspaceOptions)`. HTML motion/state child constructors accept the HTML authoring adapter instead of the outer host. The shared TypeScript interfaces document the common document, mutation and rendering services. The generated [service inventory](WORKSPACE-SERVICES.json) lists direct host-member reads and selectors used by each implementation; it is an integration checklist, not a list of new framework semantics.

`host.store`, `host.stores`, `host.doc`, `host.selected` and `host.registry` are the application-owned document model. `prepareEdit()` is the application's pending-source/read-only guard. Mutation goes through the existing store/session APIs. `setProps`, `propertyChanged`, `renderCanvas`, `renderInspector`, `drawSelection` and `command` are extensible host operations. Workspace hooks are reversible, including out-of-order teardown. A host's later external replacement is never overwritten by cleanup.

`WorkspaceOptions.root` is an explicit element or document. Queries stay within it; `dialogRoot` optionally adds a separate application-owned dialog container. `elements` can map an implementation selector to an application element or resolver. Pass `api` for extension API registration, `storage` for persistence, `notify` and `saveFile` for application feedback/file delivery. Without storage the context uses its own in-memory store. Without a notifier it emits a bubbling `workspace-notification` event. No workspace looks up `window.xamora` or imports Studio.

Global keyboard listeners route only events originating in the owning root/dialog. Drag capture still observes pointer movement outside that root until completion. The root document supplies its own window and scheduling services. Optional `scheduleFrame`/`cancelFrame` overrides support deterministic hosts/tests.

The optional docking service is a **panel adapter**: `registerPanel` returns idempotent `show`, `close`, `dispose` operations; `timelineHost`, document switching and panel visibility remain host-owned. The standalone lab demonstrates a simple panel adapter; a DockWorkspace-based application can provide the same operations. CanvasController builds on the host's existing pointer/resize policy; it does not silently replace that policy with a second gesture implementation.

## Composition example

```js
import { BlendFeatures, TimelineWorkspace } from '@wieslawsoltes/xamora-motion-workspace';
import { SolutionWorkspace } from '@wieslawsoltes/xamora-solution-workspace';
import { RichProperties, ResourceWorkspace } from '@wieslawsoltes/xamora-resource-workspace';
import { DataEditor } from '@wieslawsoltes/xamora-data-workspace';
import { HtmlWorkspace } from '@wieslawsoltes/xamora-html-workspace';
import '@wieslawsoltes/xamora-motion-workspace/motion-workspace.css';

host.workspaceOptions = { root, dialogRoot, notify, storage, api: {} };
root.classList.add('xamora-workspace');
dialogRoot.classList.add('xamora-workspace');
const parts = [];
const own = (part) => (parts.push(part), part);
own(new BlendFeatures(host));
own(new TimelineWorkspace(host));
own(new SolutionWorkspace(host));
host.rich = own(new RichProperties(host));
host.resources = own(new ResourceWorkspace(host));
host.data = own(new DataEditor(host));
own(new HtmlWorkspace(host));
// Close application-owned dialogs, then tear down children before the host.
for (const part of parts.reverse()) part.dispose();
```

Use the fully runnable `dist/examples/WorkspaceLab/` application to see the corresponding host implementation, selectors, preview renderer, source editor, document sessions and panel adapter. It contains no Studio import. Its base canvas policy selects elements; production hosts provide their own drag/resize behavior. The lab's persistence is an explicit in-memory snapshot, not an unadvertised server or cloud database.

## Lifecycle and verification

Dispose is idempotent. It releases subscriptions, event properties, timers, animation-frame work, preview effects, owned markup, panel registrations and installed host/API/menu hooks. Failed constructors roll back the ownership they installed. Only one instance of a component constructor may own a root at a time. Other component kinds may share the root; independent roots can run separate applications. Do not call authoring methods after disposal. Application-owned document stores, DOM roots, persistence, file picker operations and dialogs are not destroyed by a workspace; the host owns their lifetimes.

Source/installed-package tests cover the same implementations. Regression tests exercise standalone construction and actual authoring/undo; independent roots; original-handler restoration; constructor rollback; and legacy constructor identity. Chromium exercises the standalone application and a package-only aggregate bundle with no Studio/source-module requests, in addition to the unchanged Studio integration suites. Package tests install actual tarballs and check dependency closure and strict TypeScript declarations.

This extraction preserves existing supported XAML/HTML semantics; it does not make every framework feature supported. Nested-object property editing, code-editor viewport virtualization and native desktop-window docking are separate changes rather than claims inferred from moving workspace code. Browser automation is not assistive-technology certification or native Windows/macOS qualification.
