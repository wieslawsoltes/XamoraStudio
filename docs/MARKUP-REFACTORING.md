# Reviewed markup refactoring

The source editor and designer use the same AST-first, concrete-source-preserving refactoring service. No provider, generated script or second application instance is involved.

## Commands

**Edit → Refactor markup** offers **Rename element tag…**, **Wrap element…** and **Unwrap element…** for the source caret. **Shift+F2** opens tag rename; plain **F2** retains symbol rename. Property-element source positions select their logical XAML owner in Studio. The commands also appear in command search.

**Designer → Refactor markup** operates on the selected element, or consecutive selected siblings for wrapping. Wrapping includes intervening text and comments. A single-child container such as Border cannot wrap multiple visual children. Native inline collections accept inline wrappers such as Span or Bold, not layout panels.

Every operation opens a review dialog containing the proposed source, original source and warnings. Editing the tag field changes only the proposal. **Apply refactor** creates one undoable document transaction. **Cancel** or Escape changes nothing. The proposal selects the renamed element, new wrapper, or first remaining child; existing child IDs are retained. Unwrap explicitly warns that wrapper attributes, styles, names and inherited behavior are removed, not migrated to children.

A tag rename changes its opening and closing name and its direct, same-namespace XAML owner-property element names. For example, StackPanel.Resources becomes Grid.Resources. It does not change an unrelated attached-property provider, text, quoted values, comments, symbol names, selectors, code-behind, or other documents. Names with an equivalent declared XML namespace alias are supported. Undeclared prefixes and namespace-changing renames must be edited explicitly in source.

This is structural refactoring, **not framework API migration**: retained properties and event handlers may not be valid on a different control type. The review warns about this. Likewise, wrapping may change layout, selectors, inherited data context, resource lookup or namescopes; no native visual-equivalence guarantee is implied.

## Source fidelity and validation

The service changes the canonical AST, then asks the existing concrete-source patcher for a candidate source. Untouched descendant slices retain their quote choices, entity spelling and internal whitespace. New wrapper shells are serialized without reserializing the existing subtrees inside them. Foreign SVG/MathML attribute names are matched to their projected AST spelling while retaining their original value and quote ranges.

The candidate is parsed and compared to the intended whole document, including namespaces and text. Parser-induced extra children, moved table content or changed foreign-content namespaces reject the plan. HTML implied closing tags and synthetic document nodes cannot be used as refactoring targets. Document/template boundaries, void/non-void conversions, malformed tag names and ambiguous source restructuring are rejected.

HTML/SVG/MathML wrappers use their actual parent context, including foreignObject and MathML annotation integration points. Browser HTML recovery remains authoritative. Refactoring is not an exhaustive HTML content-model validator. In XAML, ordinary and explicit Child/Content/Inlines collections share single-child/inline checks. Namespace declarations, xml:space and property elements must be moved explicitly before removing their owning wrapper. Resource and other non-content property collections are not generalized as visual grouping targets.

Undo restores the exact previous source. Redo restores the applied source and node IDs. The preview is bounded to 60,000 characters per pane and visibly reports truncation; the full proposal remains bounded by existing document limits and is validated before Apply.

## Stale input, locks and multiwindow behavior

Invalid source drafts and active composition cannot be overwritten by refactoring. Pending input is flushed before starting or applying. A change to the captured document, revision, source-buffer version or document metadata invalidates the proposal, including an edit/undo cycle that returns to identical text. Changing the designer selection also invalidates its proposal. Source-scope operations keep their captured target regardless of unrelated selection updates.

Studio checks locks on affected ancestors and descendants. A source edit in another popup disables the current review. The final apply checks the exact reviewed source after the source-session commit hook; a failed transaction does not commit a partial refactor. Plans are immutable, single-use and owned by one service instance. Disposing the service or source session invalidates them.

The source editor can be detached into an existing browser host. Shift+F2 still opens the application-owned review dialog; applying or dismissing it restores editor focus through the existing dialog/navigation machinery. Previewing source uses textContent, not executable markup.

## Package API

```js
import { MarkupRefactorService } from '@wieslawsoltes/xamora-markup/markup-refactoring';

const refactoring = new MarkupRefactorService(documentSession, { registry });
const plan = refactoring.prepareRename(nodeId, 'Grid');
// Present plan.before, plan.after and plan.warnings for review.
const result = refactoring.apply(plan);

const wrapped = refactoring.prepareWrap([firstId, secondId], 'StackPanel');
// Review separately before applying. Plans cannot be replayed or moved to another service.
const pairedNames = refactoring.linkedTagRanges(caretOffset);
refactoring.dispose();
```

The package includes ESM, CommonJS and TypeScript declarations. Targets are authored node IDs or UTF-16 caret offsets. Linked tag-name ranges are a query API, not automatic linked typing. The standalone host owns review UI, lock policy and source-editor composition/pending-input coordination; Studio supplies those policies. No npm publication or package version bump accompanies this feature.

`window.xamora.refactoring.open(kind, scope)` exposes the Studio review UI; kind is rename/wrap/unwrap, scope is source/designer. `linkedTagRanges(offset)` returns paired name ranges only for synchronized valid source. Disposing the Studio adapter removes its menu entries, commands and owned API without deleting later replacements.

## Qualification

`markup-refactoring.test.mjs` covers engine plans, exact-source changes, IDs/history, namespaces, ownership, no-op behavior, stale proposals, disposal, content constraints and rollback. `refactor-workspace.test.mjs` covers review/apply/cancel, locks, drafts, selection changes, document switches, shortcuts and cleanup. `refactoring-native-cases.mjs` supplies native-parser foreign-content and HTML-recovery cases; the DOM test library is not substituted for browser semantics.

`browser-markup-refactoring.mjs` runs those native cases against canonical source and the built markup package, then exercises the real Studio source editor, designer grouping, Edit menu, HTML design preview, undo/redo and detached source window. These are Chromium checks, not physical-device, assistive-technology, Firefox/Safari or native WPF/Avalonia visual-equivalence qualification. Existing native fixture suites remain regression gates, not validation of every renamed control/property combination.

References: [WPF property-element syntax](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/xaml-syntax-in-detail#property-element-syntax) and [HTML parsing](https://html.spec.whatwg.org/multipage/parsing.html). Unsupported cases retain the source rather than silently guessing at an API or namespace migration.
