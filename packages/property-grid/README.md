# @wieslawsoltes/xamora-property-grid

A standalone property-grid control extracted from Xamora Studio. No Studio instance, XAML parser, document store or runtime dependency is required. Includes ESM, CommonJS, TypeScript declarations, scoped CSS and an optional standalone browser bundle.

```js
import { PropertyGrid } from '@wieslawsoltes/xamora-property-grid';
import '@wieslawsoltes/xamora-property-grid/property-grid.css';

const model = { Width: 320, Enabled: true };
const grid = new PropertyGrid(document.querySelector('#properties'), {
  properties: [
    { name: 'Width', type: 'number', value: model.Width, group: 'Layout', min: 0, defaultValue: 320 },
    { name: 'Enabled', type: 'boolean', value: model.Enabled, group: 'Behavior' },
  ],
  onChange({ name, value, reset }) {
    // Validate and commit to your store here; false/string/throw rejects the change.
    if (value === undefined) delete model[name];
    else model[name] = value;
    console.log(reset ? 'reset' : 'edit', name, value);
  },
});
// Reconcile external application changes:
grid.setValue('Width', 640);
grid.setFilter('Layout');
// At teardown: grid.dispose();
```

With no CSS-aware bundler, link the CSS asset and import the `browser` entry from a package-serving host. The source example is `dist/examples/PropertyGridLab/`.

## Editing contract

The control accepts property descriptors, not arbitrary object reflection. Text, finite numbers, booleans, colors and typed choices have built-in editors. Fields can be grouped, filtered, read-only, mixed, required, range-constrained and resettable. Reset intent is explicit and distinct from entering an empty string; `defaultValue` is used when provided, otherwise the value becomes `undefined`. Choices preserve string, numeric and boolean types, including `''`, `0` and `false`.

The application owns persistence and transactions. `onChange` runs synchronously before the control accepts a value; `onReset` optionally overrides it for resets. Returning false or an error string, or throwing, restores the committed display and exposes an accessible error. Property validators follow the same synchronous contract. Asynchronous hooks are unsupported: do asynchronous work outside the control and reconcile with `setProperties` or `setValue`. A callback that synchronously replaces the schema or disposes the control remains authoritative.

`setProperties` replaces the descriptor set after validation without mutating caller objects. Accepted user edits update the existing input without recreating it; filtering also preserves input identity and drafts. Programmatic schema/value replacement rebuilds the fields. Use `dispose()` before permanently removing or replacing a grid; each host belongs to one live instance.

## Custom fields and Studio

`renderPropertyField` is the exported default field renderer and escapes all property names, labels and values. A custom `fieldRenderer` is trusted application code returning one root element containing a `data-prop` input. For custom widgets or nonstandard value conversion, use `eventMode: 'external'`: the host handles native changes and reset clicks itself, then reconciles the control from its model.

Studio's existing All Properties inspector uses this control in external mode. The same extracted field renderer serves its standard inspector fields. Studio retains its existing XAML/HTML value semantics, specialized property editors, edit guards and shared document undo/redo instead of creating a second model. The generic library does not implement Studio's brush/resource editors, object reflection, automatic nested-object expansion or a virtualized row surface.

Legacy `@wieslawsoltes/xamora-controls` exports forward to the same constructor. Package preparation and tests do not publish npm releases. MIT licensed.

## Automatic nested-object editing

```js
import { ObjectPropertyGrid } from '@wieslawsoltes/xamora-property-grid';
import '@wieslawsoltes/xamora-property-grid/property-grid.css';
let model = { user: { name: 'Ada' }, items: [1, 2] };
const control = new ObjectPropertyGrid(host, {
  value: model,
  onChange({ previous, next, path, operation, reset }) {
    // Validate and commit to your application's transaction/history system.
    model = next;
    return true; // false, a message, or a thrown Error rejects the proposal.
  },
});
control.setProperty(['user', 'name'], 'Grace');
control.addProperty(['items'], '2', 3);
control.removeProperty(['items', 0]);
// Application undo: control.setValue(previousSnapshot).
// control.dispose();
```

Own enumerable properties of plain data objects and arrays are discovered automatically. The UI provides expansion, filtering, scalar editing, type selectors, add/remove and reset. String path segments are literal: a key containing dots or `__proto__` is not evaluated or assigned through a prototype. Accessors, unsupported instances, circular references and depth-limited nodes appear as read-only markers. Getters are never called by inspection/cloning. JavaScript proxies are application code and are not a security boundary.

Edits produce a cloned proposal without mutating the original, preserving cycles and shared references among supported data objects. Non-data instances remain references and are not edited. Read-only/non-configurable descriptors are respected. Array removal rejects affected accessor/read-only items rather than invoking them. Synchronous callbacks retain transaction ownership; asynchronous callbacks are rejected. Scalar commits retain field identity and text selection. Schema replacement/add/remove rebuilds the nested tree; this is not tree virtualization.

`maxDepth` (default 16), `maxEntries` (5000), `maxNodes` (100000 for graph cloning), `expandedDepth`, `readOnly`, `allowStructureChanges`, `allowTypeChanges` and `defaultValue` configure the control. Search temporarily opens matching ancestors and restores expansion afterward. `setValue` applies external snapshots without a commit callback. `reset(path)` restores the construction-time default at that path. Added paths have no default and report an error on reset.

The data workspace uses this control for its Objects view and commits through its existing owning-document history. That adapter requires JSON values; the generic control also represents null/undefined, aliases and cycles. See the standalone `examples/NestedPropertiesLab/`.
