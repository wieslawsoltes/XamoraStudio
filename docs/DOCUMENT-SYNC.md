# Document sessions and bidirectional source synchronization

Xamora uses one `DocumentStore` and one `DocumentSession` per open document. Code, the canvas, properties, resources, layout tools, and extension transactions edit the same semantic tree. The session maintains the exact authored XAML or HTML source, indexes its concrete syntax, and commits source and model changes atomically. A valid code edit updates the document immediately; the IDE batches rendering into an animation frame.

## User behavior

- Editing XAML or HTML synchronizes automatically. **Synchronize source** / **Ctrl+Enter** performs an explicit synchronization check; an Apply step is no longer required.
- Inspector, canvas, resource, layout, and extension edits patch the source in the same transaction. Unchanged comments, attribute spelling, quote style, whitespace, and untouched subtrees retain their authored text.
- Undo and redo use the document's shared history, including code drafts and visual edits. History retains up to 100 reversible document changes within a configurable byte budget; source strings use compact range deltas.
- Caret movement selects the corresponding semantic element. Selecting a visual element reveals its concrete source range. IDs remain stable when nodes can be matched by unique name, HTML `id`, resource key, subtree, or scope-local position.
- Switching documents retains source drafts, selection where the node still exists, and each editor's caret and scroll position during the session.
- Incomplete source remains visible and editable. Diagnostics link to the source error; the last valid design continues rendering. Visual mutations of markup are rejected while the draft is invalid. **Restore last valid source** explicitly discards the draft through an undoable change.
- **Save source** downloads the exact buffer, including an unfinished draft. Saving a solution retains the draft, last valid source, and model together. Reopening that solution reconstructs the same source state.
- IME composition is protected from background editor updates. Visual changes and undo/redo wait for composition to finish. Composition text is captured for recovery when the page closes.

HTML uses the browser's native `DOMParser`, preceded by a concrete syntax scan that identifies incomplete tags, attributes, and comments. Browser-valid optional end tags remain supported. An HTML document uses a DOM-backed design iframe; XAML uses the registered browser preview adapters.

## Data and ownership

The semantic model remains framework-neutral:

```js
{
  id: 'stable-node-id',
  kind: 'element',
  type: 'Button',
  props: { Content: 'Save' },
  children: []
}
```

Text, comments, CDATA, and processing instructions have their own node identities. Framework-specific types, attributes, property elements, and unknown custom controls remain in the tree.

The session adds this serialized document metadata:

```js
metadata.source = {
  version: 1,
  language: 'XAML', // or 'HTML'
  text: '<Button Content="Save" />',
  validText: '<Button Content="Save" />',
  diagnostics: []
};
```

`text` is the current code buffer. `validText` describes the current semantic model. They differ only while the source has errors. Saving a document as JSON preserves both. Concrete source indexes are rebuilt from the last valid source and are not serialized into the project.

`DocumentStore` owns the document, revision, selected IDs, undo history, and transactions. `DocumentSession` owns source parsing, concrete syntax indexes, source patching, ID reconciliation, and draft diagnostics. `DocumentSync` connects these services to the studio editor and panels.

## Atomic editing flow

A source edit follows this sequence:

1. Scan concrete source and parse through the document's adapter.
2. Validate the parsed semantic tree and reconcile stable node IDs against the prior tree.
3. Commit the new semantic tree, exact source, and diagnostics together. If parsing fails, commit only the draft and diagnostics while retaining the last valid tree.
4. Update the concrete source index and publish a session change. Active panels and preview redraw from that shared revision.

A visual or panel edit follows this sequence:

1. Run its existing `DocumentStore.transaction` action.
2. Before the transaction commits, compare the semantic changes against the prior model.
3. Patch concrete source ranges, reusing unchanged substrings and moved subtrees.
4. Reparse the patched source and compare the resulting semantics against the requested tree.
5. Commit source and model together, or roll back the entire change if the edit cannot be represented safely.

Commit hooks run before the store exposes a changed document. An unsuccessful source patch does not leave the inspector, code, and preview describing different versions. Metadata-only changes such as annotations and design data do not require a markup patch.

## Public core API

Import the core module directly or use the aggregate core exports:

```js
import { DocumentStore } from './core/model.js';
import { parseXaml } from './core/xaml.js';
import { DocumentSession } from './core/document-session.js';

const source = `<Grid><Button Name='Save' Content='Save' /></Grid>`;
const store = new DocumentStore(parseXaml(source));
const session = new DocumentSession(store, { source });
const buttonId = store.document.root.children[0].id;

session.addEventListener('change', event => {
  const { origin, revision, source, valid, diagnostics } = event.detail;
  // Refresh extensions from the same committed revision.
});

session.updateSource(source.replace("Content='Save'", "Content='Done'"));
store.setProperty([buttonId], 'Width', '160');
console.log(session.source); // Exact source with the property edit patched in.

session.undo();
session.redo();
```

| API | Meaning |
| --- | --- |
| `session.source` | Current buffer, including an invalid draft. |
| `session.validSource` | Exact source corresponding to the current valid model. |
| `session.isValid`, `session.diagnostics` | Current draft validity and source diagnostics. |
| `session.revision` | Current `DocumentStore` revision. |
| `applySourceEdits(edits, { origin, expectedRevision, expectedVersion })` | Commit atomic UTF-16 range edits against a document and text version. |
| `buffer`, `processingStats`, `lastUpdate` | Inspect text mapping/version and localized/full processing work. |
| `updateSource(text, { origin, expectedRevision })` | Commit code or a retained draft; return `{ accepted, valid, revision, diagnostics }`. |
| `serialize({ draft: false })` | Return the last valid source; use `draft: true` for the current buffer. |
| `discardDraft()` | Restore the last valid source as an undoable source change. |
| `sourceAtNode(id)` | Return the node's source range, line/column, and attribute ranges; `null` when absent. |
| `nodeAtOffset(offset)` | Return the innermost mapped semantic node or `null`. |
| `undo()`, `redo()` | Traverse shared document history. |
| `refresh()` | Rebuild indexes after a controlled solution snapshot replacement. |
| `dispose()` | Remove store hooks and event subscriptions. |

Source offsets use JavaScript string indices, matching textarea selection offsets. Lines and columns are one-based. Source ranges describe the last valid source while a draft is invalid.

### Extension edits and revision checks

Extensions should use store transactions or session source updates. Direct mutation of a document followed by an arbitrary render bypasses synchronization and validation.

```js
const revision = session.revision;
const updatedText = await obtainExternalEdit(session.source);
const result = session.updateSource(updatedText, {
  origin: 'extension',
  expectedRevision: revision
});
if (!result.accepted) {
  // Read current source and recompute; a newer panel/code edit won the race.
}
```

The revision check rejects stale changes without mutating the document. It is optimistic concurrency for one local document, not a collaborative merge algorithm.

Framework adapters can be supplied through `new DocumentSession(store, { adapters })`. An adapter provides `parse(source, options)`, `serialize(document)`, and optionally `serializeNode(node, parentType)`. Adapters are selected by framework name, then XAML/HTML language. The concrete scanner supports XML/XAML and HTML syntax; a different source language requires a corresponding concrete syntax implementation as well as a semantic adapter.

### Studio integration API

The running application exposes:

```js
const session = window.xamora.getSession();
const currentText = window.xamora.getSource();
const result = window.xamora.setSource(currentText);
const valid = window.xamora.flushSource();

// Existing panel and extension operations participate automatically:
const studio = window.xamora.studio;
studio.store.transaction('Extension edit', document => {
  document.root.props.Width = '900';
});
```

`getSession()` and related functions resolve the active document at call time. An extension that tracks a particular document should retain its `store.session` and subscribe there. Use the studio's guarded commands for user-facing actions so pending composition and source errors receive the standard diagnostics.

## Source preservation and boundaries

Property-only edits change attribute value ranges where possible. Adding or removing attributes preserves unrelated attributes. Structural edits reuse the concrete text of unchanged nodes. New nodes receive readable adapter-generated markup. This preserves existing authored formatting; it does not promise a preferred formatter for every newly inserted structure.

HTML can be repaired or normalized by the browser parser. Synthetic wrappers, foster-parented table contents, unusual duplicate attributes, or other ambiguous source/model mappings may prevent a safe structural patch. Such edits fail atomically with an explanation to make the relevant container explicit in code. The source buffer itself remains available for editing. CSS and JavaScript bodies are retained as text; the session is a markup AST and concrete syntax index, not a full CSS or JavaScript semantic IDE.

Eligible quoted attribute and ordinary text edits use localized parsing and cached syntax-range updates; structural and uncertain edits use the complete parser. History retains reversible document and string deltas. Rendering is coalesced. This remains an immutable-string buffer with transient transaction clones, not a rope, worker language server, CRDT, or production-scale qualification. See [editing-engine architecture](EDITOR-ENGINE.md) for measured costs and exact boundaries. Existing document import limits apply. The browser preview does not execute native WPF/Avalonia assemblies or provide exhaustive native runtime layout validation.

IDs are stable for identifiable matches. Completely identical, unkeyed siblings remain inherently ambiguous after arbitrary source rewrites. Use `x:Name`, `Name`, resource keys, or HTML `id` when integrations require a persistent logical target.

## Verification

The Node integration suite covers alternating code/inspector/canvas edits, exact source restoration through undo/redo, invalid draft persistence, blocked visual mutation, independent documents, JSON solution restoration, structural source ranges, stale revision rejection, and caret remapping. Run:

```sh
npm test
npm run check
```

The browser integration harness starts its own ephemeral localhost server and checks the real application, textarea input, XAML renderer, native HTML parser, HTML iframe geometry, property controls, history, invalid drafts, document switching, IME guards, and immediate visual edits after source input:

```sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install --with-deps chromium --only-shell
node tests/browser-sync.mjs
```

The GitHub validation workflow runs this browser harness. An unsuccessful browser run writes `test-results/browser-sync-failure.png` for inspection. A successful Node fixture run alone does not establish browser layout or interaction correctness.
