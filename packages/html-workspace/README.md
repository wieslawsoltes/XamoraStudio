# @wieslawsoltes/xamora-html-workspace

Reusable document-aware components: **HtmlWorkspace, HtmlAnimationWorkspace, HtmlStatesWorkspace**. Canonical source lives in `dist/workspaces/`; the package does not import Studio or start an application when imported.

```js
import { HtmlWorkspace } from '@wieslawsoltes/xamora-html-workspace';
import '@wieslawsoltes/xamora-html-workspace/html-workspace.css';
```

Workspace constructors accept an application host and optional `WorkspaceOptions` (defaulting to `host.workspaceOptions`). Supply the shared document stores/session, renderer and command/panel services rather than copying their state. WorkspaceContext itself takes just the options object. MotionRuntime takes a document and optional clock services. HTML child workspaces take the HTML adapter.

Read the [host contract and composition guide](https://github.com/wieslawsoltes/XamoraStudio/blob/main/docs/WORKSPACE-COMPONENTS.md), [service inventory](https://github.com/wieslawsoltes/XamoraStudio/blob/main/docs/WORKSPACE-SERVICES.json), and [standalone example host](https://github.com/wieslawsoltes/XamoraStudio/blob/main/dist/examples/WorkspaceLab/host.js). The example has no Studio import and demonstrates ordinary store transactions and undo.

Use an explicit root with the `xamora-workspace` class, and load the exported stylesheet for this package. Optional dialog roots use the same class. Host-owned templates and commands remain the application's responsibility. Disposal releases installed hooks, subscriptions, scheduled work and owned UI; it does not destroy the application's documents or persistence. Dispose child integrations before the host. Constructor failures roll back installed ownership. Do not invoke authoring methods after disposal.

ESM and CommonJS root/subpath exports preserve shared class identity. A `./browser` bundle includes dependencies; when composing multiple workspaces use ordinary package imports or the single `@wieslawsoltes/xamora/browser` aggregate instead of mixing independent bundled model copies. Declared dependencies include shared type contracts as needed. Builds are not publication; this extraction leaves versions at 0.8.0 and does not publish npm packages.
