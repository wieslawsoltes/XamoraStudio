# Structural HTML and XAML source tooling

The existing SemanticLanguageService, document source index, and editor now share structural navigation. These commands consume committed source ranges rather than searching for matching strings or reparsing a second AST.

## Studio commands

Use **Edit → Code navigation** or command search:

| Command                    | Keyboard                         | Behavior                                                                                                 |
| -------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Go to matching tag         | Ctrl+Shift+\\ (Command on macOS) | Select the opposite tag name when the caret is inside an actual paired opening/closing tag.              |
| Expand syntax selection    | Alt+Shift+Right                  | Expand through attribute values, attributes, tags, text/content, elements and the document.              |
| Shrink syntax selection    | Alt+Shift+Left                   | Restore the prior selection, including its direction.                                                    |
| Select element in designer | Command menu                     | Select the authored AST element at the source caret. A XAML property wrapper selects its owning element. |

Matching-tag navigation participates in existing Alt+Left/Right navigation history. Expanding and shrinking selection do not edit source or create document undo entries. Manually changing the selection, editing source, or switching documents invalidates the previous shrink trail. These commands preserve the existing code/visual source synchronization and selected-node identities.

Pending source input is flushed before navigation. Invalid drafts stay visible and cannot accidentally navigate the last valid tree. Composition-time shortcuts are left to the input method. Generic CodeEditor consumers receive these shortcuts only when they supply an `onSemanticCommand` handler.

## Reusable API

```js
import { SemanticLanguageService } from '@wieslawsoltes/xamora-markup/language-service';

const language = new SemanticLanguageService(documentSession);
const element = language.elementAt(caretOffset);
const oppositeTag = language.matchingTagAt(caretOffset);
const largerSelections = language.selectionRanges(selectionStart, selectionEnd);
```

A returned `MarkupRange` has `start`, `end`, `line`, `column`, `kind`, and an optional `nodeId`. Offsets are zero-based UTF-16 code-unit positions; end is exclusive. Line/column positions use the document session's existing one-based convention. The API returns null or an empty list for invalid offsets or invalid drafts. Selection ranges are strictly larger than the supplied selection, ordered smallest to largest, and each contains the previous range. Results are fresh values, not mutable references to the source index.

Studio exposes the same read APIs through `window.xamora.language`. Consumers should resolve new locations after source edits; ranges are not stable bookmarks across revisions.

## Concrete source, not invented syntax

Self-closing elements, HTML void elements and omitted HTML closing tags have no opposite tag. Browser-inserted html/body/tbody wrappers do not acquire fabricated source tag positions. Comments, CDATA, script text and quoted delimiters do not become fake nested tag matches. Property-element tags and namespace-prefixed XAML names preserve their original spelling.

This increment does not add semantic JavaScript/CSS subexpression selection, multi-cursor editing, automatic linked-tag renaming, code folding, cross-file structure navigation or a replacement HTML parser. Structural selections are based on the existing concrete-source index; crossing spans in recovered HTML are filtered to a nested selection chain. Selecting template/resource content in the source does not promise that the selected object has a live canvas representation.

Tests cover pure source APIs, UTF-16 offsets, aliases, raw text, optional HTML ends, incremental updates, undo, draft guards and editor shortcut routing. The full Studio browser language suite exercises both XAML and HTML keyboard commands, selection identity, source/history preservation and immediate invalid-draft handling.
