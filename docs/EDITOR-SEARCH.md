# Editor find and replace

Use **Ctrl/Command+F** or **Edit → Find in source…**. **Ctrl/Command+H** and **Edit → Replace in source…** expose replacement controls. **F3 / Shift+F3** select the next / previous occurrence and wrap at the ends; the status announces wrapping. In the Find field, Enter / Shift+Enter navigate without moving typing focus. Escape closes search and restores focus to the source selection. Buttons retain their own native Enter/Space behavior. Browser/OS-reserved shortcuts may require using the menu instead.

Find seeds a nonempty single-line source selection. The query and options remain local to the editor; they are never sent to Jev or stored in project markup. **Match case**, **Whole word**, and **In selection** are explicit toggles. Whole word treats Unicode letters, numbers, combining marks, connector punctuation and join controls as word characters; it is not a framework identifier or natural-language tokenizer. Only accepted occurrences consume their full range: a rejected whole-word phrase does not hide a later overlapping valid occurrence. Incomplete UTF-16 surrogate characters are handled without treating an unrelated preceding letter as part of the boundary. Case-insensitive matching uses Unicode simple folding without lowercasing the source or shifting UTF-16 offsets. Full locale-sensitive or multi-character folding is not implemented.

The match count is independent of the source validation status. Syntax-colored match highlights paint in the existing read-only overlay, never into authored DOM. The native textarea remains the sole editable text and selection authority. Find does not add document revisions or history. Invalid drafts can be searched and repaired; replacement that introduces a syntax error remains a source draft through the existing session and last-valid-AST mechanisms.

## Replacement and scope

**Replace** acts only on an exactly selected occurrence. Otherwise its first invocation selects the next occurrence without changing text. It then advances to the next match after an applied replacement. **Replace all** plans nonoverlapping matches from one source snapshot and applies them together, never recursively searching its own replacement output. Replacement text is literal: `$&`, `$1`, braces and backslashes are not executed as substitutions.

Enable **In selection** after opening Find from a source selection. The range is captured rather than following successive match selections. Controlled replacements resize that range. Other source changes, Undo/Redo that changes text, or switching document sessions clear it with feedback instead of reusing stale offsets. A document-identity change clears a captured range even when both documents contain the same text. Asking for selection scope without selected text explains the missing selection; it does not pretend to have enabled a scoped search.

Studio maps all edit ranges from textarea LF coordinates into canonical source coordinates and applies one `DocumentSession.applySourceEdits` batch. Untouched intervals, BOMs and mixed newline spellings are preserved between disjoint replacements. Inserted newlines use the document's first newline style. Undo/Redo uses the shared document history, including when the source panel is detached into a browser window. An existing unsynchronized edit is captured before the replacement transaction; it is not silently discarded or merged with older match offsets.

Read-only and disabled inputs cannot replace. Search-field and source-field IME composition defer navigation/replacement. Replacement proposals verify the current source snapshot. Rejected document adapters do not fall back to local text mutation. If another operation changes source during a rejected adapter call, captured scope is cleared and search highlights are rebuilt for the new source. Studio rechecks document identity, source, revision, buffer version and editable state after each designer gesture-cleanup callback, before committing the mapped ranges. Cleanup cannot redirect replacements into a different document or apply obsolete offsets. Returning a popup preserves the same editor and search UI; switching documents resets the context range, not the whole workspace.

## Standalone code-editor package

The existing `@wieslawsoltes/xamora-code-editor` package includes the search UI, `TextSearchIndex`, `applyEditorTextEdits`, ESM/CommonJS/types, CSS, and its self-contained browser bundle. No Studio, parser or framework dependency is introduced.

```js
import { CodeEditor, TextSearchIndex } from '@wieslawsoltes/xamora-code-editor';
import '@wieslawsoltes/xamora-code-editor/code-editor.css';
const editor = new CodeEditor(host, { language: 'Text' });
editor.setValue('Alpha alpha');
editor.setSearchContext(documentIdentity); // Change identity when the editor switches documents.
editor.find({ replace: true });
editor.findNext(true); // previous occurrence

const index = new TextSearchIndex('Alpha alpha', 'alpha', { wholeWord: true });
const proposal = index.replacement('$&'); // literal replacement, not a regex substitution
editor.applyTextEdits(proposal.edits, { expectedValue: index.source });
```

Without a document adapter, applying a batch creates one editor-buffer undo entry and invokes `onChange` once. A host with its own document transaction system can supply `onTextEdits(edits, expectedValue)`. This is synchronous: validate/commit the complete batch, update the surface with `setValue`, then return true. Return false to reject without any fallback, and never partially mutate the document. Studio implements this through DocumentSync. The callback is trusted host code, not a security sandbox. The generic control does not parse or sanitize replacement text.

`editor.search` exposes the live query/replacement fields and explicit refresh, move, replace, close and replace-visibility methods. `setValue` updates results without forcibly moving focus. `dispose` removes listeners and releases search snapshot references. The standalone engine subpath is `@wieslawsoltes/xamora-code-editor/text-search`.

## Limits and qualification

This increment is **literal search**, not a user-supplied regex engine, replace-across-files operation or semantic rename. Find inputs are single-line; the standalone engine and batch APIs also accept multiline strings. No remote provider or network access is involved.

The default index stores at most **20,000** occurrences, adjustable to **100,000** through `TextSearchIndex`. A truncated result is labeled with `+`, and Replace all is refused until the search is narrowed. Navigation uses the bounded result set. Snapshots and replacement output are limited to **8 million UTF-16 code units** by this control; Studio's parser limits remain independently enforced. Queries are limited to **10,000** code units. Search highlights are viewport-line scoped and capped at **1,000 painted spans per repaint**, including long single-line documents; native selection still exposes the current result beyond that paint cap.

Tests cover literal matching, Unicode offsets, whole-word boundaries, ranges, limits, atomic plans, exact batch Undo, mixed newlines, invalid draft repair, selection scope, document identity, composition, read-only/rejection/disposal, native keyboard behavior and bounded highlighting. The browser gate repeats native cases for source and the built package, then exercises full Studio XAML/HTML and a real detached source panel. No non-Chromium, physical mobile-device or assistive-technology qualification is claimed.

Reference contracts: WHATWG HTML textarea API value and text-control selection APIs (https://html.spec.whatwg.org/multipage/form-elements.html#the-textarea-element; https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#textFieldSelection), and W3C status-message guidance (https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html). Search result feedback uses a polite status region without stealing focus.
