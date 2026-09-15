# Extending Xamora

## Control metadata

The Toolkit → **+ Toolkit** flow accepts JSON:

```json
{
  "name": "Acme Controls",
  "version": "1.0.0",
  "controls": [
    {
      "type": "acme:StatusCard",
      "category": "Acme toolkit",
      "namespace": "clr-namespace:Acme.Controls;assembly=Acme.Controls",
      "container": true,
      "singleChild": true,
      "defaults": { "Width": "260", "Height": "120", "Status": "Active" },
      "properties": [
        { "name": "Status", "type": "enum", "values": ["Active", "Paused", "Done"] }
      ]
    }
  ]
}
```

A descriptor has a type and category, optional defaults, properties, namespace, icon, child scaffold, `container`, `singleChild`, and `templated`. Default child descriptions can nest. Every created node receives a fresh internal ID. JSON installation validates the descriptor list before committing its registrations; up to 200 control descriptors are accepted.

Descriptors do not make native controls executable. An unknown visual without a custom renderer is shown as a labeled placeholder while its source remains intact. Built-in names are provided by `builtins()`. Registering a descriptor for the same exact type overrides its metadata; integrations should manage ownership and unregistration deliberately.

## Custom renderer

```js
window.xamora.registerControl({
  type: 'acme:StatusCard',
  category: 'Acme toolkit',
  namespace: 'clr-namespace:Acme.Controls;assembly=Acme.Controls',
  defaults: { Width: '260', Height: '120', Status: 'Active' },
  properties: [{ name: 'Status', type: 'enum', values: ['Active', 'Paused', 'Done'] }],
  render({ node, properties, renderer, interactive }) {
    const element = document.createElement('div');
    element.textContent = properties.Status;
    element.style.cssText = 'padding:24px;border-radius:12px;background:#eee7fc';
    return element;
  }
});
```

The renderer receives preview-resolved properties and the authored node. It returns a DOM Element. Common dimensions and appearance are applied by the renderer infrastructure; declared child content is appended using the normal content mapping. Avoid mutating the authoring document during rendering. Use textContent and safe DOM construction for user-controlled content.

Executable extensions are trusted JavaScript. They are registered by the host application, not evaluated from imported toolkit JSON. They are not saved into project JSON. See `dist/extensions/example-toolkit.js` for a complete example with an export adapter.

## Export adapter

```js
window.xamora.registerAdapter('My UI format', {
  async serialize(document) {
    return {
      content: JSON.stringify({ view: document.root }, null, 2),
      extension: 'myui',
      mimeType: 'application/json'
    };
  }
});
```

Registered adapters appear in the Export dialog. A serializer receives a cloned document and returns text or the result object above. The integrating application owns its target schema, mappings, validation, semantic guarantees, and licensing requirements.

## Engine embedding

```js
import { builtins, parseXaml, DocumentStore, PreviewRenderer, serializeXaml }
  from './core/index.js';

const registry = builtins();
const store = new DocumentStore(parseXaml(source));
const renderer = new PreviewRenderer(registry);
renderer.sampleData = { User: { Name: 'Ada' } };

function update() {
  renderer.render(store.document, hostElement);
  sourceEditor.setValue(serializeXaml(store.document));
}

store.addEventListener('change', update);
store.setProperty([buttonId], 'Content', 'Save');
update();
```

`DocumentStore` exposes the document for integration. Treat it as read-only outside transactions. Use explicit transactions to preserve history, revision tracking, validation, and UI notifications. Selection uses a separate `selection` event. `window.xamora.subscribe` subscribes to the currently active page's store; rebind when the integrating UI switches stores.

## Metadata extraction from native frameworks

A production .NET toolkit integration should provide a separate metadata generator that reads public control/property/content attributes and writes declarative descriptors. It should include namespace and assembly identity, framework version, default/content property, read-only properties, attached properties, enums, property editors, events, required template parts, default templates, and design data.

That generator and a native preview host are not included. A browser cannot infer arbitrary custom drawing or execute CLR types merely from the control's XAML tag. Native fidelity requires running the target framework, receiving measured bounds/rendered output, correlating it with authoring IDs, and reporting load/compile diagnostics.

Suggested future native bridge contract:

```ts
interface NativePreviewRequest {
  protocolVersion: 1;
  requestId: string;
  revision: number;
  framework: string;
  frameworkVersion: string;
  xaml: string;
  designSize: { width: number; height: number };
  toolkitAssemblies: string[];
  sampleData?: unknown;
}

interface NativePreviewResponse {
  requestId: string;
  revision: number;
  image?: { mediaType: 'image/png'; bytes: Uint8Array };
  bounds?: Array<{ sourcePath: string; x: number; y: number; width: number; height: number }>;
  diagnostics: Array<{ severity: string; message: string; line?: number; column?: number }>;
}
```

This is a proposed integration contract, not an implemented service. A native implementation must isolate untrusted markup/code, constrain assembly loading, authenticate host communication, respect browser origin rules, cancel stale revisions, and avoid forwarding local secrets or files into imported controls.


## Data, prototype and language services in 0.2

The new services are also exported from `dist/core/index.js`. They do not depend on the Studio UI.

```js
import {DesignDatabase, PrototypeSession, completeXaml} from './dist/core/index.js';

const database = new DesignDatabase();
const projects = database.addTable('Projects', [
  {name: 'Name', type: 'string', required: true, unique: true},
  {name: 'Progress', type: 'number', default: 0},
]);
const row = database.insert(projects, {Name: 'Launch', Progress: 25});
database.update(projects, row, {Progress: '50'}); // converts and validates

const session = new PrototypeSession(viewDocuments, database.data);
renderer.sampleData = session.context;
renderer.describeContext = context => session.describeContext(context);
renderer.onInput = change => session.writeBinding(change);
renderer.onEvent = event => session.dispatch(
  event.viewId, event.nodeId, event.event, event
);
session.addEventListener('change', () => {
  renderer.sampleData = session.context;
  renderer.render(session.document(), host, {interactive: true});
});
```

Catch rejected input/action errors at the host boundary and present them to the user. The Studio host returns `false` for rejected input, which suppresses Change events and restores the displayed bound value. A production host should batch rendering and preserve focus during event-driven updates.

A custom renderer can emit `renderer.emitPreview(node, 'Click', value)` or set the renderer's `onEvent` contract. Keep authored node identity separate from item instance identity. For editable controls, obtain context provenance during rendering and supply it with `onInput`; this ensures later events still address the same table/record after state changes.

Interactions are declarative entries in `document.metadata.interactions`:

```js
view.metadata.interactions = [{
  id: 'open_details',
  sourceId: button.id,
  event: 'Click',
  enabled: true,
  actions: [
    {type: 'setData', path: 'App.IsOpen', value: true},
    {type: 'navigate', targetViewId: detailsView.id},
  ],
}];
```

The built-in action names are enumerated in `ACTION_TYPES`. The current implementation does not provide a dynamic action-registration registry; add an execution adapter or extend `PrototypeSession.execute` in a host subclass for additional action types. Registry control renderers and export adapters remain dynamically extensible. Native data services, SQL providers, and real .NET handlers require explicit host integration.

The language service produces replacement ranges and insertion text rather than editing a particular widget:

```js
const completions = completeXaml(source, caretOffset, {
  registry,
  document: currentDocument,
  context: session.context,
});
```

This makes the same contextual suggestions reusable in a richer editor host. A native semantic language server can supplement it; none is bundled here.

`HitTestService`, `planDrop`, `applyDropPlan`, `snapBounds`, and the grid-definition helpers are separate from panel UI. Drop application belongs inside `DocumentStore.transaction`. Use `preserveLayout: true` for tree order changes; supply measured rectangles and a grid cell for canvas gestures. IDs use letters, digits, underscores, or hyphens; XAML names remain separate authored properties.

The live host additionally exposes `window.xamora.data`, `.prototype`, `.hitTest`, and `.completeXaml`. Studio-specific methods are convenience integration points and may change between releases; prefer the core exports for embedded applications.


## Motion services (0.3)

```js
import {
  createStoryboard, addTrack, setKeyframe, sampleStoryboard,
  VisualStateRuntime, ensureTransformPath, TRANSFORM_PATHS
} from './dist/core/index.js';

store.transaction('Animate selected object', doc => {
  const story = createStoryboard(doc, 'Entrance', 2);
  const track = addTrack(doc, story, selectedId, 'Opacity', 'Double');
  setKeyframe(track, 0, '0');
  setKeyframe(track, 1.2, '1', {interpolation: 'Easing', easing: 'CubicEase', mode: 'EaseOut'});
});

const sample = sampleStoryboard(document, storyboardNode, 0.6);
// sample.overrides: Map<nodeId, Record<propertyPath, string>>
// sample.warnings: unsupported or unresolved preview details
```

Use named property paths for transforms and brushes; ensureTransformPath localizes resource transforms and returns a path matching the actual existing transform order. Never assume a fixed child index in an imported TransformGroup.

VisualStateRuntime owns transient group state. Call go(groupId, stateName, timeInSeconds, useTransitions) and sample(timeInSeconds); apply the returned Map to an evaluation copy. Empty states must not acquire authored Storyboards merely because they were sampled.

Studio MotionRuntime requires a PreviewRenderer and manages browser input/clock lifecycle. Dispose it when removing a view. Custom animation types and framework-specific state models need a separate adapter and native validation; the current evaluator is intentionally bounded.


## Docking extensions in 0.4

`DockLayout` is exported by `dist/core/index.js`; the DOM control is exported separately by `dist/controls/index.js`. Both have TypeScript declarations. The docking model has no Studio or DOM dependency. See [DOCKING.md](DOCKING.md) for standalone construction, lifecycle and serialization contracts.

Use `window.xamora.docking.registerPanel({id, title, content, kind, icon, onClose})` to add an independently dockable extension tool. `content` is a live HTMLElement and is moved rather than cloned. The returned handle exposes `show()`, `close()` and `dispose()`. Choose a stable namespaced ID such as `my-toolkit:inspector`; exported layout JSON stores that ID, not executable callbacks or content markup.

The model's `change` event carries the operation label. The control emits `resize` for renderer invalidation and offers visibility/activation callbacks. Keep costly work paused when its window is invisible, and keep document edits inside document transactions instead of docking transactions. Avoid assuming a fixed side, size or parent for extension content.


## Editor extensions in 0.5

A property descriptor may name a host-provided editor. Register the editor before using that descriptor's visual inspector:

```js
window.xamora.propertyEditors.register('rating', ({ value, commit }) => {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '5';
  input.step = '1';
  input.value = String(value ?? 0);
  input.addEventListener('change', () => commit(input.value));
  return input;
});
window.xamora.registerControl({
  type: 'acme:Rating',
  category: 'Acme',
  namespace: 'clr-namespace:Acme.Controls;assembly=Acme.Controls',
  properties: [{ name: 'Rating', type: 'number', editor: 'rating' }],
  defaults: { Rating: '3' }
});
```

The editor callback receives `studio`, `node`, selected `ids`, `key`, `value` and `commit`. Return a DOM HTMLElement. The host owns trusted executable code; imported JSON descriptors only name editors and do not execute scripts. Prefer the supplied commit callback to preserve property/animation routing. Avoid retaining node objects across transactions or solution replacement; resolve current IDs when handling asynchronous work.

`window.xamora.commands.list()` returns registered command IDs/labels/current enabled state; `execute(id)` invokes an enabled command. Dynamic control/window inventories are materialized when their menu or palette is enumerated. Commands may open dialogs and some clipboard actions require browser support. The registry is a UI command surface, not an authorization or RPC boundary.

The new DOM-free `solution.js`, `authoring.js` and `timeline-editing.js` modules are exported through `core/index.js`, with corresponding TypeScript declarations. Use `moveSolutionPath` and `renameResource` for staged operations; validate and apply their returned documents in your own workspace transaction. Wrap in-place timeline helpers in `DocumentStore.transaction` to preserve undo and event delivery.

Dock descriptors may supply `minWidth` and `minHeight`; `dockMinimum` and `dockRatioLimits` expose the size calculation. `DockLayout.batch('Arrange windows', model => { ... })` combines layout-only operations into one event and undo step. Do not register/unregister panels, nest batches, or perform asynchronous work inside its synchronous callback.


## Workspace density in 0.6

```js
window.xamora.appearance.setDensity('compact'); // standard | comfortable
const current = window.xamora.appearance.getDensity();
const options = window.xamora.appearance.densityModes;
```

For an embedded application, import `WorkspaceDensity` from `controls/workspace-density.js` and load `styles/density.css` with the appropriate application classes. The controller accepts a root HTMLElement and an optional storage implementation exposing `getItem`/`setItem`; pass null for session-only behavior. `set(mode)` validates the mode and emits `change` only when its value changes. The corresponding declaration file is provided.

Use `--ui-control`, `--ui-row`, `--ui-gap`, `--ui-pad`, `--ui-section`, `--ui-font` and `--ui-small` in extension panel chrome. Keep authored preview values separate from these tokens. Density must not alter the application's document model. If an extension implements measurement-dependent handles, refresh them on the controller's change event after layout.

`dockMinimum(node, panels, {chromeHeight})` and `dockRatioLimits(node, panels, size, {chromeHeight})` accept the combined group header/tab height. Omitting this option retains the earlier standalone default of 52 pixels. Splitters remain five pixels.

## HTML adapter and scrolling controls in 0.7

```js
import {parseHtml, serializeHtml, HtmlRenderer} from './dist/core/index.js';
import {ScrollButtons} from './dist/controls/index.js';
const doc = parseHtml(source, {name: 'index.html'});
const renderer = new HtmlRenderer();
renderer.render(doc, host, {onReady: r => console.log(r.elements)});
const exportedSource = serializeHtml(doc);
// Include dist/controls/scroll-buttons.css for standalone strip styling.
const strip = new ScrollButtons(tabViewport, {label: 'documents'});
container.append(strip.host);
strip.reveal(activeTab);
```

The parser uses browser DOMParser; `projectHtmlDocument` accepts an already parsed HTML document for host integration. Use `HtmlRenderer.getClientRect` for parent-coordinate overlays and `elementsAtPoint` for native-frame selection. Dispose renderer/scroll observers when removing a host. The studio exposes `window.xamora.html.newDocument()`, `.import(source)` and `.export()`.

HTML custom tags and arbitrary attributes are preserved. Custom-element JavaScript runs in runtime preview only. The model and serializer do not execute it. Cross-format conversion is not implied by the common document API.
