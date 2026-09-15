# Validation report

Version 0.7.0 with document synchronization and HTML animation authoring · 15 September 2026

## Final combined verification

| Check | Result |
| --- | --- |
| `npm test` | **428 passed, 0 failed, 0 skipped**. |
| `npm run check` | **Passed**: JavaScript syntax, module linkage, and local entrypoint assets verified. |
| `node tests/browser-sync.mjs` | **Passed** in real headless Chromium. |
| `node tests/browser-html-motion.mjs` | **Passed** in real headless Chromium. |
| `node tests/browser-incremental.mjs` | **Passed**, including 12 native HTML parser contexts and 30 sequential edits. |
| `node tests/browser-language.mjs` | **Passed**, including definition/reference navigation, rename, completion and diagnostic ranges. |
| `node tests/browser-html-states.mjs` | **Passed**, including native transitions, pointer recording, exported interactions and compact controls. |
| Compact timeline inspection | Inspected at **1600 × 1100** and **1366 × 768**, including selected-key editor access after scrolling. |

The final combined Node run reported 18.11 seconds. This is an execution result for the test suite, not an application performance benchmark. The browser suites also assert that their tested workflows produce no uncaught browser errors.

These results describe the combined source synchronization and HTML animation implementation. They supersede the older release notes stating that no browser application tests had been run. They do not establish exhaustive native framework, browser, device, or production-scale qualification.

## Source, model, and editor integration

The Node suite covers document parsing and validation, canonical XAML and native HTML serialization, unknown/custom types and attributes, comments, processing instructions, CDATA, inline content, inherited whitespace, namespace handling, entity validation, transaction rollback, node insertion/movement/deletion, bounded snapshot history, and generated large-document parsing.

Synchronization regressions cover exact source preservation, stable node identities, source ranges, scope-aware matching, unchanged subtrees and moved nodes, draft diagnostics, invalid-source retention, blocked visual mutations, source recovery from saved documents, stale revision rejection, atomic commit hooks, ordinary store listeners observing matching source and model, independent document sessions, and selection/annotation targets across source reparenting. Root dimension edits from source and visual properties update artboard dimensions and participate in undo/redo without resetting unrelated design settings.

The real Chromium synchronization suite starts the complete application and exercises:

- XAML textarea edits updating the rendered canvas and preserving authored formatting.
- HTML edits through the native browser parser updating the design iframe.
- Inspector properties and CSS fields updating the same source document.
- Caret-based selection, stable selected IDs, and shared code/visual undo and redo.
- Canvas nudge commands updating source.
- Invalid source retaining the last valid preview and blocking conflicting visual changes.
- Switching files while retaining invalid drafts.
- A property action immediately following source input.
- IME composition preservation, rejected visual mutations and document switches during composition, and committing completed composition.
- Artboard width changes visible in the rendered DOM and restored through undo.

Browser testing exposed fresh-session parser-cache initialization and passive-preview resource-resolver initialization failures. Both were fixed and have focused regressions. Preview iframe focus handling and code selection also received browser-driven fixes.

See [document synchronization](DOCUMENT-SYNC.md) for APIs, source-preservation rules, and remaining parser/history boundaries.

## HTML animation verification

Node tests cover the CSS range tree, comments and quoted text, nested conditional rule groups, grouped and duplicate keyframe offsets, missing endpoints, individual frame edits, copied/moved/removed keys, easing preservation, animation shorthand and longhand lists, quoted and escaped names, negative delays, multiple effects, local reference renaming, CSS cascade handling, variable/externally defined animations, mutation validation, preserved `!important` declarations, and no-op edit identity.

Timing and recording tests cover delay, finite and infinite iteration counts, fractional iterations, reverse and alternating directions, recorded CSS values, restored base styles, removal of inline properties using resolved cascade values, and rollback of unresolved removals. Native-effect controller fixtures verify seek/disposal behavior and restoration of captured play states. These fixtures complement the browser checks; they do not independently qualify browser interpolation.

The real Chromium animation suite exercises:

- Creating ordinary CSS keyframes and a target animation binding.
- Native midpoint interpolation of opacity and transforms.
- Scrubbing without changing authored source, base inline styles, or document revision.
- Editing duration through the timing field and undoing/redoing it.
- Recording a CSS property through its inspector field into a keyframe while restoring the authored base value.
- Shared undo/redo of recorded frames and source edits updating the native animation preview.
- Recording removal of an inline property and undoing the result atomically.
- Pointer dragging a timeline keyframe and checking the changed CSS offset.
- Play/pause advancing preview time without adding document history.
- Opening the isolated interactive HTML preview and retaining its authored running animation state.
- Preserving unrelated stylesheet comments through those operations.

The HTML motion example and timeline were also inspected in compact desktop layouts at 1600 × 1100 and 1366 × 768. The short docked timeline retains vertical scrolling so selected-key controls can be brought into view; browser hit testing confirmed access to the key-offset input. This is a targeted layout check, not a full accessibility or device audit.

See [HTML animation authoring](HTML-ANIMATIONS.md) for supported workflows and source-driven cases. External keyframe definitions, arbitrary JavaScript-generated effects and scroll/view-linked timeline authoring remain outside the keyframe timeline scope. CSS transitions and interaction states are authored in the separate state editor described below.

## Existing regression coverage

The combined suite retains the earlier renderer, layout, docking, data, resource, and XAML animation checks:

- Renderer property mappings, thickness and colors, grids/stacks/canvas, inline text, property objects, scoped resources, templates, inherited state, and exported form values.
- Nested/deep/cycling selection with controlled geometry, locking, tree reorder, container drop plans, insertion rules, grid tracks/spans, and snapping.
- Data typing, constraints, foreign keys, joins, CSV, binding paths, navigation, TwoWay updates, context inheritance, and template item provenance.
- XAML clocks, keyframes, interpolation, transforms, state groups, native animation authoring, preview triggers, playback disposal, and MotionLab round trips.
- Dock layout presets, tab ownership/reordering, nested splits, floating and auto-hide state, document/view modes, saved layouts, focus and input retention, and invalid-operation rollback.
- Solution file/path validation, resource references and renaming, rich property editors, menu keyboard behavior, density settings, selection toolbar positioning, and tab scroll controls.

Most of these are deterministic Node/controller fixtures. `tests/dom-fixture.mjs` and `tests/docking-dom.mjs` model only the DOM operations required by their assertions. Passing a geometry fixture does not prove every physical pointer path or browser layout.

## Static verification

`npm run check` syntax-checks browser JavaScript, loads the aggregate core and key studio/control modules to verify module linkage, and checks the HTML entrypoint and referenced local assets. Both real-browser integration scripts start their own ephemeral localhost server. The GitHub workflow runs static checks, Node tests, synchronization browser tests, and HTML animation browser tests before publication.

The browser test failure artifacts include screenshots; the synchronization harness also captures the recovery-screen body, editor status, browser console argument stacks, and uncaught errors in JSON. This makes a caught application startup failure fail promptly with its underlying stack.

## Limits of this verification

The following were not established by this validation:

- Pixel-identical WPF, Avalonia, WinUI, or MAUI layout, compilation, loading, or native custom-control execution.
- Physical WebGPU device, driver, loss/recovery, or sustained rendering performance qualification.
- Exhaustive Firefox/WebKit, mobile/touch, assistive-technology, keyboard-accessibility, or WCAG qualification.
- Multi-user concurrency, server persistence, collaborative merging, or enterprise administration.
- Production-scale memory use, continuous editing latency, parser throughput, snapshot history size, or long-running session stability.
- Arbitrary CSS/JavaScript semantic IDE behavior, every CSS feature and interpolation case, or a security penetration test of HTML preview isolation.

Eligible markup attribute/text edits use localized parsing; structural markup and stylesheet processing still use full scans. Document history retains reversible deltas; transactions still clone transiently for rollback. The generated large-document test validates its parsing/serialization behavior and does not claim an interactive performance result. The browser tests establish the particular workflows described above, not complete IDE parity or universal runtime fidelity.

## Incremental engine and semantic editor validation

The incremental-engine regression subset includes 13 localized source-processing tests, eight source-buffer tests (including 600 deterministic randomized edit batches), 16 compact-history tests and 27 semantic-service tests. Differential tests compare semantic output and concrete node/attribute ranges against full parsing. Stale revisions, invalid drafts, namespaces, raw HTML text, contextual parsing and repeated element types have explicit regression coverage.

The additional Chromium suites use the browser's actual DOMParser and full application. They verify native HTML context fallback, repeated local edits, canvas/property transactions and history, F12 definition navigation, references, F2 rename with exact undo, preserved JavaScript/comments, accepted toolkit enum completions, and Error List line remapping after a multiline edit. Existing synchronization and HTML keyframe suites also passed with the new engine.

The [recorded 1,000-control benchmark](benchmarks/document-edits-1000.json) verifies exact undo/redo and reports localized parser work, observed edit time and estimated history retention. The benchmark excludes DOM rendering and its timing is not a cross-device performance claim. A separate 100-entry history regression retained an estimated 666,368 bytes versus 90,445,800 bytes for snapshots and verified all 100 undo/redo operations.

See [editing-engine contracts](EDITOR-ENGINE.md) for the optimized cases, fallback rules, retention budget and remaining linear work.

## HTML interaction states and transition validation

The final combined suite passed 428 Node tests, including 31 dedicated HTML state/transition core tests and three state-workspace tests. Coverage includes selector tokenization, conditional CSS preservation, transition list repetition/timing/negative delay/discrete behavior, inline priority handling, state value recording, native preview restoration, eight-event runtime generation, malformed configuration preservation, and deletion/undo of the last named-state rule without deleting shared rules or unrelated actions.

The real Chromium state suite passed with the incremental engine and compact history enabled. It checks state creation and value editing, source-driven updates, recorded Properties edits, atomic undo/redo, live pointer dragging despite state-rule priority, exact authored base-position preservation, native CSS transition interpolation, exported click bindings, and the interaction example command. The preexisting keyframe animation suite also passed against the combined runtime.

Independent browser QA at 1366×768 and 1600×1100 verified that all ten selected control centers are reachable, with no horizontal panel overflow. It exposed and verified fixes for a footer covering scrolled controls and malformed interaction JSON interrupting panel rendering. Invalid action JSON now remains editable source and displays a diagnostic without uncaught errors.

Closing the state panel or switching from HTML to XAML restores original preview stylesheet text and temporary attributes/control state, clears recording, and leaves exact source and revision unchanged. Imported selectors, nested media conditions, comments and unrelated declarations were preserved. A conflicting inline-important state value was rejected atomically, preserving source and revision. These checks produced zero uncaught browser errors.

See [HTML states and transitions](HTML-STATES.md) for the authored CSS/runtime ownership model and supported selector boundaries.


## 0.8 standalone framework and packages

The isolated framework/package change passed 444 Node tests, static syntax/module/asset checks, and all seven applicable Chromium suites (five established designer suites plus runtime and standalone-example suites). Twelve actual npm tarballs passed isolated dependency-closure installation, ESM/CommonJS module imports and constructor-identity checks, and strict TypeScript consumer programs without `skipLibCheck`.

The standalone browser bundle test mounts the application with exactly two requests: its host HTML and the runtime bundle. It verifies two-way input, commands, resource updates, a custom control, and custom-element disposal without studio modules. The larger example adds template collections, state/storyboard sampling, keyboard access, narrow viewport handling, load races and repeated reconnection.

Focused runtime checks include invalid-source/render-failure retention, async source/dictionary races, focus and caret restoration, typed property defaults/inheritance/coercion, forward ElementName binding, remount lifecycle and restoration after animation disposal. Existing source/canvas/property synchronization, HTML motion/states and semantic-navigation tests remain passing.

No npm release was performed. Packaging, consumer installation and artifact integrity are validated separately from future publication authorization. The browser implementation retains the support and scaling boundaries documented in WEB-RUNTIME.md and WEB-FRAMEWORK-ARCHITECTURE.md.
