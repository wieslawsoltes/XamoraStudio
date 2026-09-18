# Contextual HTML, SVG and MathML authoring

## Insert markup into an existing document

Open an HTML document, select its target element and choose **Edit → Insert HTML fragment…**, use the same command in search, or use **Insert HTML fragment…** in the HTML toolbox. Enter markup for that container. Insertion is one document transaction and selects the inserted elements. Text-only fragments select their parent. Undo restores the previous source, including the original spelling and whitespace of an otherwise untouched imported document; redo retains the inserted AST identities.

The target is captured when the dialog opens. A document switch, removed target, rejected source edit, empty result or invalid placement does not redirect the insertion to another document or reset the workspace. The dialog stays open on failure and the normal notification explains the error. Animation/state recording continues through the workspace's existing mutation path.

The native browser fragment parser supplies container rules: rows inserted in a table acquire a `tbody`; cells inserted in a row stay cells; select options remain options; nested template content stays inside the template's inert content. Ancestor context includes forms so nested-form recovery is not guessed by a string wrapper. HTML parser error recovery is intentional: malformed HTML is normalized, not diagnosed like XML. This is not an exhaustive HTML content-model validator.

## Foreign content and the toolbox

SVG and MathML roots and basic children are available in the HTML toolbox. SVG creation includes a viewBox and a visible rectangle; shapes include basic geometry and can be styled in Properties. Select an SVG container before inserting a shape or a MathML container before inserting a mathematical child. Existing `svg`, `path`, `circle` and `rect` support now uses the actual namespace rather than unqualified HTML elements.

Contextual parsing handles SVG `foreignObject`, `desc` and `title` integration points, MathML text integration points, and `annotation-xml` HTML encoding. It preserves adjusted SVG names and case-sensitive attributes. An HTML element cannot be inserted directly into an ordinary SVG container; use `foreignObject`. Non-whitespace table text must go in a cell. Imported template children remain authorable in the AST and source but do not appear as live canvas content.

After a visual edit, serialization retains namespace-sensitive text behavior: foreign `style`/`script` text is escaped, HTML script/style bodies stay raw, void-looking foreign names receive closing tags, and only HTML pre/textarea/listing receive leading-newline compensation. SVG elements named `template` use their real child nodes, not the HTML template-content property. Native CDATA characters are projected as text, so serialization preserves their content even when CDATA spelling is normalized after editing. Unchanged imports still return their original source verbatim.

## Engine API

The existing markup package and `dist/core/html.js` export the APIs and declarations; no duplicate parser or new package is introduced.

```js
import {
  parseHtml, parseHtmlFragment, insertHtmlFragment,
  HTML_NAMESPACE, SVG_NAMESPACE, MATHML_NAMESPACE,
} from '@wieslawsoltes/xamora-markup/html';

import { DocumentStore } from '@wieslawsoltes/xamora-model';

const doc = parseHtml('<table id="rows"></table>');
const store = new DocumentStore(doc);
// Locate the target by its AST identity, not its HTML id attribute.
const table = doc.root.children.find(n => n.type === 'body').children[0];
const nodes = parseHtmlFragment('<tr><td>Value</td></tr>', { context: table });

// Use your DocumentStore.transaction() for undo/history integration.
store.transaction('Insert row', draft => {
  insertHtmlFragment(draft, table.id, '<tr><td>Value</td></tr>');
});
```

`parseHtmlFragment(source, { context, ancestors, Parser })` returns newly identified AST nodes, not a fabricated html/body document. Its default context is body. `ancestors` is root-to-parent order; `insertHtmlFragment` computes it from the actual tree. Parsing accepts at most 2 MB and projection retains the existing node/depth limits. Only HTML, SVG and MathML contexts are accepted. Detached parser documents have no browsing context. Integration-point encoding is copied; ancestor URLs and event handlers are not.

`insertHtmlFragment(document, parentId, source, { index, Parser })` validates the insertion index, target and a complete candidate document before mutating the caller's tree. Failure leaves the AST untouched. It returns the exact inserted nodes, or an empty list for a parser result with no nodes. Studio treats that empty result as a non-insertion with feedback.

`projectHtmlNodes` exposes the shared DOM-to-AST projector for node lists and fragments. `isHtmlElement`, `isHtmlVoid` and `canContainHtmlChildren` provide namespace-aware checks. `serializeHtmlNode` accepts an AST parent to preserve its namespace; its legacy parent-tag string parameter remains supported as HTML context. Missing namespace metadata still means HTML for older programmatically created documents.

Studio exposes `window.xamora.html.insertFragment(source, parentId?)`. It routes through source validation and document history, returns inserted nodes on success and null on failure. Omitted parent selects the current usable container or body; an explicit missing parent is rejected. Callbacks retained after workspace disposal cannot author changes.

## Safety and boundaries

Fragment parsing is **not sanitization**. Scripts, event attributes and custom elements remain in authored source. Parsing does not insert native nodes into the Studio document, execute scripts or run custom-element constructors. Design preview retains the existing script-free sandbox and filtering. Interactive Preview deliberately permits authored scripts in its existing separate sandbox; it is not same-origin Studio execution. Importing a fragment does not add privileges or change the preview sandbox configuration.

The fragment context is a detached representation, not the live page DOM. This increment does not implement custom-element lifecycle/state preservation, declarative shadow-root authoring, closed-shadow selection, a browser-independent HTML5 parser, exhaustive SVG/MathML property editors, general XML namespace authoring, native typography parity, or preservation of arbitrary JavaScript state when an iframe is rebuilt. Existing arbitrary AST reparenting remains separate from contextual source insertion. Physical devices, assistive technology and non-Chromium engines require separate qualification.

## Tests

Unit tests cover namespace-sensitive serialization and diagnostics, projection of foreign templates and CDATA records, table/template/SVG fragments, input limits, atomic errors, whole-document limits, source-exact undo, workspace integration, command disposal and visible SVG defaults. The local DOM test library does not model every foreign integration point; the browser suite checks those with the actual native parser instead of changing expected semantics.

`tests/browser-html-fragments.mjs` runs native parsing/round trips against canonical source and the built standalone markup browser bundle. It also exercises the full Studio menu/dialog, table source and preview, undo/redo, selectable SVG and MathML nodes, attribute edits and inert templates. Browser behavior follows the WHATWG HTML parsing and serialization algorithms; no claim of full standard coverage is made.
