# Studio experience review

## Scope and design intent

This change polishes the existing visual designer rather than replacing it with a new app shell. Command discovery, keyboard navigation, interaction feedback and compact-window readability take priority over decoration. The document model, source validation, compiler semantics and package boundaries remain unchanged. Saved layout intent is restored after the complete panel registry exists; fresh workspaces start with a balanced layout rather than accumulating optional columns during registration.

The review inventories the menu registry and its command paths, Studio composition and workspaces, reusable menu/dialog controls, source editing, docking windows, density styles and existing browser test coverage. This is a code and automated-interaction review, not a claim that every possible authoring sequence has been tested by a human or that accessibility conformance has been certified.

## Findings and implemented changes

**Command discovery.** Finding: The flat label-only launcher hides menu context and is inefficient from the keyboard. Live menu-path catalog; ranked multi-term search; file/window filters; counts, category paths, shortcuts, checked and unavailable states; recent commands; Arrow keys and Enter with input focus retained. Unit and full-Studio browser regressions.

**Entry points.** Finding: New users must already know panel names and hidden menus. Visible desktop search and an optional workspace guide with real create/import, toolkit/properties, layout/window, diagnostics/export actions. No unsolicited onboarding modal or invented commands.

**Menu navigation.** Finding: Tab suppresses normal focus traversal; outside dismissal can steal focus; submenu expansion state is incomplete. Tab resumes from a connected root trigger; outside clicks do not restore old focus; current enabled state is rechecked; owner-document routing and submenu ARIA state preserved.

**Feedback.** Finding: Two notification channels race over the same surface; short messages cannot be held or dismissed. Surface-owned lifetime, hover/focus pause, accessible dismiss button, Escape and safe return focus. Plain text only, including error messages.

**Document context.** Finding: Static chrome can obscure the actual document name and local-only persistence. Current filename in topbar/browser title; local browser save status with explicit backup wording; contextual command execution retains the original editor instead of the search field.

**Selection and mode.** Finding: Active modes rely on color/class styling and can be missed. Active tab accent, clearer selected controls, and synchronized pressed state for pointer, keyboard and command-driven tools/views.

**Inspector flow.** Advanced appearance and helper actions initially consumed the first several hundred pixels, pushing the selected layer and layout fields below the fold. Native details/summary disclosures now keep basic properties in reach, remember expansion during the session, and preserve the original live action controls. No feature is removed.

**Readability.** Finding: Small secondary labels and dense controls compete visually. Stronger muted text in chrome, clearer hierarchy, restrained panel boundaries, focus rings and search feedback. Authored design node geometry and typography are not restyled.

**Narrow/touch windows.** Finding: Toolbar information competes for limited space. Hide secondary header detail, retain a reachable compact search button, wrap dialog actions, bound overlays, single-column guide, and larger coarse-pointer chrome targets without rewriting saved density.

**Startup layout.** Late Solution and Symbols registration opened extra columns on first run, leaving too little canvas at narrow widths. Startup now captures the original saved layout before registration and restores it after all workspaces are available. On a fresh workspace, Solution joins the left group (or auto-hide on narrow windows) and optional semantic tools stay available through Window/search without taking a permanent column. User-chosen extension panels and split layout are regression-tested across reload.

**Touch cascade.** The existing density selectors initially overrode the new coarse-pointer sizes. The corrected cascade and compact primary header are checked using actual Chromium media queries and element bounds, not CSS-source assertions. Search, guide, preview and export stay in reach while secondary detail remains accessible through the existing menus.

**Motion and contrast preferences.** Finding: New presentation effects must respect existing preferences. Scoped reduced-motion behavior and system-color selection outlines in forced-colors mode.

**Multiwindow.** Finding: Global command UI must not discard detached editor state. Existing owner DialogHost/DocumentScope integration retained; browser regression checks popup source values and selection across search dismissal. Existing docking lifecycle suites remain in the gate.

## Feature inventory and interaction coverage

**File, solution, new/import, save/export, recent/open documents.** Searchable live command paths; guide entry points; current document context. Existing import/export/compiler suites retained; new guide create and unchanged-document assertions.

**Canvas selection, drawing, pan/zoom, layout/alignment, source/design modes.** Active tool/mode feedback and chrome readability only. Existing geometry and designer interaction suites retained.

**XAML/HTML source, find/replace, undo/redo, validity and diagnostics.** Preserve command text context, modal return focus and safe errors. No source rewrite from presentation preferences. Existing sync, parser, invalid-draft and compiler suites retained.

**Properties/raw inspector, toolkit, layers, bindings, resources/styles/templates.** Improved shared chrome, search discovery, reachable panel commands and working guide actions. Native-only command availability remains enforced.

**Animation/timeline, states/triggers, data, prototype/connections and authoring dialogs.** Included through live menu catalog and shared menu/modal polish; existing workspace tests retained. No claim of redesigning every specialized workspace.

**Docking, auto-hide, tab groups, floating/browser hosts, layouts/window navigator.** Existing saved state and lifecycle preserved. New visual hierarchy and popup command-context tests supplement the established multiwindow suites.

**Density/theme, settings, help, keyboard shortcuts and recovery feedback.** Search/guide entry points, dark/light chrome, touch/reduced-motion rules, scoped cleanup and explicit local-storage wording.

## Interaction contract

The launcher uses the same command objects and dynamic menu children as the menu bar. Disabled commands remain discoverable with an explanation but are checked again immediately before execution. Composition keystrokes do not run commands. Matching spans labels, menu paths and command identifiers; it is ranked multi-token search, not semantic AI search. Rendering is bounded to 60 results while exposing the full match count and inviting refinement. Recent-command persistence is bounded, tolerant of unavailable storage, and excludes window/document identifiers.

Opening or closing the guide and launcher must not mutate the design document or reset its docking layout. Modal focus continues to be managed by the existing DialogHost. Errors from asynchronous commands are surfaced without promoting failed commands into recents. Menu changes remain in the standalone reusable control; application-specific catalog and guide composition stay in Studio.

The local save label refers to browser storage on this device, not a cloud account or transactional remote backup. The guide does not claim collaboration, native runtime fidelity or capabilities absent from the underlying commands.

## Validation and visual review

`tests/experience.test.mjs` covers catalog/search semantics, live command availability, original editor context, escaped labels, IME handling, empty results, failure reporting, bounded/blocked storage, shared notification timing, hover/focus pause, menu dismissal, native Tab continuation and submenu expansion.

`tests/inspector-disclosure.test.mjs` covers live action identity, remembered native disclosures, complete first-run desktop/compact panel inventories and restoration of saved extension-panel intent.

`tests/browser-experience.mjs` runs the full Studio in Chromium, tests command and guide actions, menu/tab navigation, tool state, popup source selection, notification dismissal, document immutability, saved-layout reload and 390px coarse-pointer layouts. It checks basic inspector fields are near the top, touch targets meet the chosen 44px minimum and primary header commands fit without horizontal discovery. It records desktop, dark, command-palette, guide and touch screenshots under `test-results/ux/`. The normal CI workflow uploads `ui-review-snapshots` without bypassing or replacing existing package, browser or native compiler checks. Browser failures remain blocking.

Keyboard/combobox semantics and target-sizing decisions are informed by the primary guidance below; implementing these patterns does not alone establish WCAG conformance:

- [WAI-ARIA APG: Combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- [WAI-ARIA APG: Menu button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)
- [WCAG 2.2: Understanding target size (minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

Manual assistive-technology review, physical touch devices, native OS window placement, multi-monitor drags, Safari/Firefox and exhaustive long-session authoring scenarios remain separate qualification work. Responsive chrome does not turn a complex desktop designer into a fully qualified phone-first authoring tool. No package version or dependency is changed and no npm publication is performed by this PR.
