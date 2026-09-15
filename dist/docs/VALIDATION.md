# Validation report

Version 0.7.0 with document synchronization and HTML animation authoring · 15 September 2026

## Final combined verification

| Check | Result |
| --- | --- |
| `npm test` | **330 passed, 0 failed, 0 skipped**. |
| `npm run check` | **Passed**: JavaScript syntax, module linkage, and local entrypoint assets verified. |
| `node tests/browser-sync.mjs` | **Passed** in real headless Chromium. |
| `node tests/browser-html-motion.mjs` | **Passed** in real headless Chromium. |
| Compact timeline inspection | Inspected at **1600 × 1100** and **1366 × 768**, including selected-key editor access after scrolling. |

The complete Node run reported 17.35 seconds. This is an execution result for the test suite, not an application performance benchmark. The browser suites also assert that their tested workflows produce no uncaught browser errors.

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

See [HTML animation authoring](HTML-ANIMATIONS.md) for supported workflows and source-driven cases. External keyframe definitions, arbitrary JavaScript-generated effects, scroll/view-linked timeline authoring, and transition/state authoring are outside the timeline's implemented CSS-keyframe editing scope.

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

Source and stylesheet parsing currently process full inputs; document history uses snapshots. The generated large-document test validates its parsing/serialization behavior and does not claim an interactive performance result. The browser tests establish the particular workflows described above, not complete IDE parity or universal runtime fidelity.
