# Validation report

Version 0.7.0 · 15 September 2026

## Executed

`npm test` for 0.7: **236 tests passed**, 0 failed.

The suite covers sample document parsing, model validation, canonical XAML round trips, comments/PI/CDATA, mixed inline content, inherited `xml:space`, prototype-looking attribute names, numeric attribute whitespace, BOM handling, prefixed framework detection, custom type identity, framework conversion metadata, visibility mapping, parser rejection cases, transaction rollback, undo/redo, insertion ownership, cycle rejection, bounded history, toolkit validation, nested scaffolds, child-cardinality diagnostics, and a 5,000-node document.

Renderer logic tests cover thickness ordering, ARGB conversion, empty-grid tracks, inline text, property-element content, scoped resources, inherited disabled state, style precedence, style templates, Canvas properties, and exported initial form state. A separate sample smoke check traversed every sample document through the renderer without exceptions.

`npm run check`: all browser JavaScript files passed Node syntax checking; the HTML entrypoint, referenced local assets, and core/motion/prototype/docking module imports were verified.

New regression groups cover logical content wrappers, inherited locks, front-to-back/deep/cycling hit selection with mocked geometry, preserve-layout tree ordering, multi-layer drop placement, drop cycle/capacity checks, transactional insertion, unequal grid tracks, track-index/span edits, draft-grid undo, named identity reconciliation, and edge/center snapping.

Data/runtime tests cover type conversion, required/unique/foreign-key constraints, restrict/cascade/setNull behavior, invalid imports and paths, date validation, query filters and indexed joins, bad query-column rejection, bounded join fanout, CSV quoting, binding parsing, navigation and rollback, typed TwoWay refresh, rejected writes, inherited contexts, query write protection, identical row IDs in different tables, and record provenance across reorder/deletion.

Renderer regressions cover repeated and nested DataTemplates, authored instance source IDs, nullable items, initial bound ComboBox and date state, rejected input event suppression, stable input provenance after a prior state action, and rejected toggle Click suppression. Language-service tests cover completion ranges, lexical context, enum metadata, resources, data paths, closing tags, and positive grid spans.

## Motion and appearance regression coverage

The additional 48 checks cover time parsing/formatting and rollover, zero/repeated/reversed/nested clocks, fill release, keyframe interpolation and typed object values, Uniform/Paced keys, transform order and resource localization, native animation conversion, undoable source authoring, independent state groups, empty-state release, explicit transition lifetime, motion completion metadata and transactionally queued preview actions.

Appearance and runtime checks exercise styles and resource ordering, design-only values, vector point edits, reversible DOM patches, measured Auto baselines, style-derived To-only animation, Loaded-once activation, ancestor SourceName triggers, two independently animated instances of one ControlTemplate, TemplateBinding updates, idle scheduling/disposal, uncommitted input preservation, controllable seek/pause/resume, and the MotionLab example's parse/serialize/render path.

## Docking workspace regression coverage

The 41 docking checks cover all four presets, tab ownership and reordering, nested split normalization, invalid-operation rollback, group floating, return locations, document/tool constraints, auto-hide, close/reopen, layout undo/redo, bounded import validation, registry reconciliation, pin/focus state, large desktop bounds, remembered floating bounds, flyout sizes, floating activation order, and a seeded sequence of 400 mixed layout operations.

Deterministic control/integration checks cover live input identity, buffer/selection/scroll/listener retention while moving windows, content-focus activation, auto-hide focus lifecycle, empty-root and split drop targets, separate Studio render hosts, singleton canvas/source preservation, invalid-XAML document switching/closing guards, passive page previews, timeline initialization, stopping hidden recording/playback including preset changes, and revealing inactive tabs. The docking fixture in `tests/docking-dom.mjs` extends the renderer fixture with controlled parent/focus/selector behavior. It is not a real browser or a physical pointer test.

The standalone docking example's inline module passed a separate JavaScript syntax check. The packaged source ZIP was checked for archive integrity.

## Editor workspace regression coverage in 0.5

The 34 added tests cover solution path migration and validation, atomic collision rejection, relative asset rebasing, case-insensitive dictionary moves, scope-aware resource renaming and shadow rejection, property-object replacement/reset, literal text/CDATA/binding protection, ARGB/thickness conversion, inverse transform vectors, multi-property recording, inactive/nested clocks, grouped keyframe moves, spline retention, finite clock extension beside Forever tracks, and key clipboard validation.

Controller fixtures cover nested menu navigation and focus restoration, source-buffer undo/redo, source-focused menu Cut/Undo without canvas mutation, brush structure preservation, folder/file action separation, replacing every solution document with a nonzero prior active index, blocked view tiling, size-hint composition, batched layout rollback, bounded mode snapshots, exclusive surface modes, tiled/floating document restoration through serialization/undo, manually closed documents, preserved split ratios and invalid-source mode guards.

The 0.5 full suite passed 215 tests with zero failures. Static checks verified the added EditorWorkspace module linkage and all JavaScript/entrypoint assets. DOM fixtures do not instantiate and visually qualify the complete application. Inverse-vector tests verify the coordinate algorithm, not every browser transform or handle geometry.

## Density verification in 0.6

The final 0.6 full suite passed **220 tests** with zero failures, and `npm run check` passed. The 56 existing docking/editor controller tests also passed after the geometry changes. Five focused checks cover Compact fallback, preference validation and persistence, storage denial, retained live input/caret/scroll and document state, recursive density-aware dock minimums, and source reveal with an 18-pixel line height. The submitted screenshot was inspected to identify oversized shell/panel/timeline regions; a post-change browser screenshot and physical interaction test were not performed.

Static checks verify JavaScript syntax, module linkage and entrypoint assets. The source archive is checked for integrity. Configured density metrics and derived space comparisons are CSS calculations, not measured browser results.

## Test method and limits

Renderer tests use the explicit deterministic fixture in `tests/dom-fixture.mjs`. It implements only enough DOM operations to inspect emitted element trees, property values, attributes, and CSS mapping decisions. It is **not** a browser or layout engine and does not establish pixel accuracy, successful pointer interactions, or accessible behavior.

Not performed:

- Browser-driven application startup/end-to-end interaction tests or screenshot-based visual QA.
- Physical WebGPU device initialization, rendering, loss/recovery, performance, or driver qualification.
- Native WPF, Avalonia, WinUI, or MAUI compilation/loading of exported projects.
- Native custom-control/plugin execution or framework-specific template/state qualification.
- Mobile/touch/device accessibility qualification or a WCAG audit.
- Multi-user concurrency, server persistence, or collaboration testing; this implementation is local-only.
- Production-scale memory, history, editor, or continuous-pointer performance testing.
- WebMCP registration/execution in a supported browser context.

The 5,000-node test establishes parsing/serialization behavior for that generated input, not an interactive performance claim. Snapshot history and full-tree preview updates are documented scaling boundaries.

## Release interpretation

Passing these tests supports the implemented model, serialization, and tested preview mapping logic. It does not certify complete native framework fidelity, production readiness, full IDE behavior, or the absence of browser-specific issues.

## HTML and tab navigation verification in 0.7

The complete suite passed **236 tests** with zero failures. Static checks passed for JavaScript syntax, module exports/imports, and entrypoint assets.

The 16 new checks cover raw script/style serialization, void and empty attributes, original-source restoration through undo, HTML attribute edits retaining similarly named children, relaxed HTML attributes alongside strict XML validation, raw closing-tag rollback, preformatted leading newlines, template-content projection, CSS fallback/unknown/data-URL preservation, cycle rejection and reparent undo, HTML/CSS completions, diagnostics dispatch, separate design/runtime sandbox capabilities, frame geometry with zoom, toolbar/type-label collision avoidance, scroll-button key isolation, tab offset retention and insertion precedence, and auto-hide drag wiring.

The parser projection test supplies a parsed DOM fixture; it does not run a browser HTML parser. Sandbox tests verify configuration and emitted design source, not a penetration test. Browser-driven interaction and screenshot qualification were not performed. The source ZIP is checked for archive integrity before delivery.
