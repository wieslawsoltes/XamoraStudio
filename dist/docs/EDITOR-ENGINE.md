# Document editing engine

The editor combines a semantic document tree, exact source text and concrete syntax ranges. `DocumentSession` is the transaction boundary between source and visual tools. This iteration adds localized parsing, indexed text edits, reversible history deltas, and source-backed language services without introducing a runtime framework dependency.

## Text edits and localized parsing

`SourceTextBuffer` accepts UTF-16 range edits against one source version. A batch is validated before it changes text: stale versions, overlapping edits and invalid ranges are rejected atomically. Its sorted line index rescans changed text and adjacent newline boundaries, and shifts subsequent offsets. It supports CR, LF and CRLF, including edits that join or split line endings. Positions are one-based; offsets use the same UTF-16 units as browser textarea selections.

```js
import {SourceTextBuffer} from '../dist/core/index.js';

const buffer = new SourceTextBuffer('First\r\nSecond');
buffer.applyEdits([{start: 7, end: 13, text: 'Updated'}], {
  expectedVersion: buffer.version,
});
console.log(buffer.positionAt(7)); // {line: 2, column: 1}
```

Use `session.applySourceEdits(edits, {expectedRevision, expectedVersion})` for document edits. The document revision guards concurrent model changes; the text version guards the source snapshot used to calculate ranges. `session.updateSource(text)` remains available to editors that provide a complete string.

For eligible quoted attribute values and ordinary text tokens, the session parses a small fragment with the required namespace context. It updates the corresponding semantic value and shifts cached syntax ranges. Unchanged markup is not lexed or parsed again. Node identity is preserved directly for these local edits. `session.sourceAtNode(id)` is the canonical current location; legacy `node.source` fields are import-time hints and may be stale after edits. Studio diagnostics remap node IDs through the current session index.

Changes involving tag structure, contextual HTML parsing, namespace declarations, raw text, or uncertain syntax use the full parser. Incomplete source remains a recoverable draft, retains the last valid design, and blocks conflicting visual mutations. Local processing has the same validation and transaction behavior as the full path; it is an optimization, not a second permissive language.

`session.processingStats` records full/local parses and scans, code units processed, and update counts. `session.lastUpdate` reports the chosen mode, reason and changed range. Pass `{incremental: false}` when constructing a session for differential validation or investigation.

## Reversible document history

Document history stores reversible differences instead of retaining a complete document for each edit. String values use range replacements; object properties use additions, removals and nested differences; arrays use identity-aware edits where node IDs are available and positional changes otherwise. Undo and redo restore only the changed paths and share unchanged values.

The store still clones the document transiently before a transaction. That clone provides rollback when a tool, validator or source commit hook fails. Compact retained history does not eliminate this transient cost or the validation walk.

The default history limits are 100 entries and an estimated 32 MiB of retained payload. The byte estimate is a deterministic accounting aid, not a measurement of the JavaScript heap. An edit larger than the configured history budget establishes a new history boundary; it never leaves an undo action that silently skips the oversized edit. `historyStats()` exposes retention and dropped-entry information. Tools that inspect the legacy history entry's `document` property receive a lazily reconstructed snapshot.

Source drafts, exact valid source, semantic properties, annotations and document metadata all participate in the same reversible transaction. Window arrangements and whole-solution operations retain their separately owned histories.

## Semantic editor services

`SemanticLanguageService` reads the session's valid AST and concrete source ranges. It provides document symbols, local definitions and references, safe literal-symbol rename, semantic warnings and context-sensitive completions. Named XAML elements use namescope boundaries; resource references use local resource scopes; HTML IDs connect supported attribute, fragment URL and CSS references.

Use **F12** for definition, **Shift+F12** for references, **F2** for rename, and **Alt+Left/Right** for navigation history. These commands are also in **Edit → Code navigation**. The **Symbols & references** dock window provides filtered source locations.

Renames use one batch of source edits and one shared undo entry. The service rejects invalid drafts, stale revisions, ambiguous declarations and names that would change reference resolution. Existing source spelling outside the edited ranges is preserved. Registry-backed completion uses installed control metadata alongside framework and language context.

These services cover literal document references. They do not resolve arbitrary bindings, execute custom markup extensions, compile .NET projects, refactor JavaScript, or provide an unrestricted CSS/JavaScript language server. Unsupported or ambiguous spellings remain in source and require explicit editing.

## Reproduce validation and measurements

Run `npm test` for the regression suite and `npm run check` for syntax and module linkage. Browser integration verifies the complete editor, navigation, shared history and HTML rendering.

```sh
node scripts/benchmark-document-edits.mjs
XAMORA_BENCH_NODES=2000 XAMORA_BENCH_EDITS=50 node scripts/benchmark-document-edits.mjs
```

The benchmark performs the same sequence with full and localized parsing, reports parser work and history retention, and verifies exact undo/redo restoration. Wall-clock values depend on machine load and are not CI thresholds. It deliberately excludes rendering, so its results must not be presented as whole-application latency.

### Recorded local workload

The [recorded result](benchmarks/document-edits-1000.json) uses Node 24.19.0, 1,000 controls, 61,860 source code units and 40 attribute edits. Both paths used the same compact-history implementation.

| Observation                        |    Full parsing | Localized parsing |
| ---------------------------------- | --------------: | ----------------: |
| Full document parses during edits  |              40 |                 0 |
| Local fragment parses during edits |               0 |                40 |
| Code units parsed/scanned          |       2,474,440 |             4,680 |
| Total edit time on this run        |     7,435.50 ms |       2,000.69 ms |
| Estimated retained history payload | 1,203,062 bytes |     267,314 bytes |
| Exact undo and redo restoration    |          Passed |            Passed |

For the localized path, retaining serialized whole-document snapshots for the same edits was estimated at 40,148,234 bytes. This comparison illustrates retention for this workload; neither estimate is a measured heap allocation. The recorded timing is one local observation under shared machine load, not a cross-device performance guarantee.

## Remaining scaling boundaries

The text buffer uses immutable JavaScript strings and a sorted line index. It is not a rope or piece table: replacing text copies strings and shifts later line offsets. Concrete syntax range shifts and validation can still walk the document. Structural or uncertain edits still parse the whole document, and rendering can rebuild the preview. Language indexes are rebuilt when their source revision changes. These bounds are exposed separately from the reduced parser and retained-history costs.

See [document-session contracts](DOCUMENT-SYNC.md) for source preservation, adapter integration and error recovery, and [the architecture](ARCHITECTURE.md) for the wider studio.
