# Window discovery and dialog continuity

Open **Window navigator** from the Window menu or command search. **Window → Windows and layouts → All windows** reaches the same navigator. It does not create a second workspace or change layout until a result is explicitly activated.

## Finding and switching

Search matches window names, solution-relative file paths, document/tool kinds and location labels, including accent-insensitive multi-word queries. Exact names rank ahead of path-only matches. Active and visible windows are preferred when scores are equal. The list renders at most 80 results and reports the complete match count so large registries remain searchable.

Use **All windows**, **Documents**, **Tools**, **Closed**, and **Browser windows** filters. A closed editor is still part of the solution and can be reopened. Location labels distinguish main-window tabs, auto-hidden panels, in-app floating panels, actual dependent browser hosts, and saved popup intent currently displayed in the main window. Filtering never opens a popup.

A changed query or filter selects the highest-ranked match; unrelated live registry updates preserve the selected window by identity. Up/Down and Page Up/Page Down select a result while typing focus stays in search. Enter opens the selected result, not automatically the first result. Escape dismisses without changing the selection or layout. Home/End, selection shortcuts and IME composition remain native text-input operations. Pointer selection preserves touch scrolling.

Rejected source-validation guards keep the navigator open with the query and selected result intact and a text error in the dialog's alert region. Successful activation closes without returning focus to a stale old editor. A callback-created replacement dialog is never dismissed by the old action. Opening and filtering are read-only; the existing DockWorkspace guard and activation paths handle actual changes.

Registry/layout changes update open results while retaining selection by panel ID. Closing the dialog immediately removes its model/store and DOM subscriptions. Retained controls from a previous dialog cannot trigger navigation. No names or search queries are sent to a remote service or persisted in new storage.

## Reusable dialog lifecycle

`DialogHost.signal` is the current dialog's `AbortSignal`, or `null` when closed. It aborts on close, replacement and disposal, and can release body-owned subscriptions independently of action callbacks. The next dialog gets a distinct signal. ESM, CommonJS and declaration builds expose the same property.

Studio dialog replacement also retains the original editor return target across sequences such as **Layouts → Navigator**; it does not capture a button that will be detached with the prior dialog. Return focus avoids scrolling the editor. Dialog keyboard handling ignores both `isComposing` and the legacy composition key code.

## Coverage and boundaries

`tests/window-navigator.test.mjs` covers catalog locations, bounded search, filters, keyboard and IME behavior, live registry updates, rejected/throwing guards, escaping, source focus, touch pointer defaults, dialog replacement and resource cleanup. `tests/browser-window-navigator.mjs` exercises the full Studio with actual Chromium popups, invalid drafts, keyboard selection, relative-path discovery, dialog chains and 390px coarse-pointer sizing. CI captures desktop, dark, browser-window and touch views in the existing UI artifact.

The work follows the [WAI-ARIA combobox guidance](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) for input-owned active-descendant selection and preservation of native editing keys. Coarse-pointer filters use a chosen 44px minimum; [WCAG target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) informs this design but automated bounds alone do not establish conformance.

Physical touch devices, assistive-technology audits and non-Chromium browsers remain separate qualification. Browser windows still depend on the owner workspace. No package version, compiler behavior, dependency or npm publication changes are part of this work.
