# Contextual HTML and XAML completion

The source editor, standalone markup package and semantic language service share a bounded lexical context scanner for unfinished markup. Completion does not create a replacement AST, execute scripts, load assemblies or change document history. The normal parser and DocumentSession still validate accepted source changes.

## XAML

Completion follows inherited and locally overridden namespace declarations, including declarations on the unfinished start tag. Framework prefixes resolve registered property metadata, so `<ui:Meter ScaleMode="Li` can offer a registered `Linear` value. Explicitly custom namespaces no longer acquire native Button/FontStyle values just because their local names match a built-in type. Registered qualified toolkit types remain supported.

Native element and attached-property suggestions use available namespace prefixes. XAML-language attributes and `Null` extensions follow their declared alias: a document using `xmlns:q="http://schemas.microsoft.com/winfx/2006/xaml"` gets `q:Name`, `q:Key` and `q:Null`, not an undeclared `x:` alias. Unqualified legacy documents retain no-namespace completion and the conventional `x:` fallback when that prefix has not been rebound.

TextBlock and Span-like content containers, including explicit `.Inlines`, offer inline controls instead of layout panels. Known owner-property forms such as `TextBlock.Inlines`, `Run.Text`, `Grid.RowDefinitions` and `ResourceDictionary.MergedDictionaries` are available in child-element context. A property already supplied on its owner as an attribute is not offered again as an owner-property element.

Existing attributes are excluded, including a fully typed duplicate. Quoted text containing `Width=`, tag-like strings, comments, CDATA and processing instructions cannot fabricate attribute or element contexts. Escaped XAML literals starting with `{}` do not trigger binding/resource completion. Closing-element suggestions use the same lexical stack.

## HTML, SVG and MathML

Element completion distinguishes ordinary HTML, SVG and MathML. SVG suggestions retain adjusted element spellings such as `linearGradient` and case-sensitive attribute names such as `viewBox`, `preserveAspectRatio` and `gradientUnits`. Shape-specific attributes, presentation attributes and selected enumerated values are available. MathML includes common layout/token elements, attributes and values.

Child contexts account for SVG foreignObject, desc and title, MathML text integration points and annotation-xml HTML encoding. These namespace transitions are tested against Chromium's actual DOMParser. This is not a claim of exhaustive HTML5 tree-construction recovery: complex invalid nesting and foreign-content breakout recovery remain the responsibility of the document parser.

HTML void elements do not appear in closing suggestions. A slash in an HTML non-void start tag does not falsely close it; an SVG self-closing element does. Common optional-end contexts are retained. Script and RCDATA bodies do not offer tags found inside their text, but an unfinished real closing tag can be completed. CSS property/value completion remains available in style bodies and style attributes. Custom element names are discovered from actual preceding start tags, not string matches inside scripts or comments.

The semantic service reads the current unfinished buffer for tag/attribute context, rather than trusting an older valid AST node at the same offset. Existing name/resource lookup still uses the semantic model of the last valid document; this increment is not speculative compilation of an arbitrary invalid draft.

## Reusable API

```js
import { markupCompletionContext, htmlChildNamespace }
  from '@wieslawsoltes/xamora-markup/markup-context';
import { completeHtml } from '@wieslawsoltes/xamora-markup/html';

const source = '<svg><linearGradient gradientU';
const context = markupCompletionContext(source, source.length, { html: true });
const items = completeHtml(source, source.length, { context });
// items includes gradientUnits="" with a caret offset inside the quotes.
```

Offsets and replacement ranges use UTF-16 code units. The optional reusable context must correspond to the same source/caret. Namespace and attribute maps are new, caller-owned values. Input limits are 2 MB, 15,000 completed tags and bounded nesting; invalid offsets or exceeded limits return no completion. The scanner has no DOM or external dependencies. Existing completeXaml, completeHtml and SemanticLanguageService entrypoints remain compatible; declarations and the new subpath ship through the existing markup package in ESM and CommonJS.

## Qualification and boundaries

Unit tests cover namespaces, aliases, custom metadata, inline/owner contexts, quote/comment handling, escapes, duplicates, foreign integration points, stale buffers, limits and prototype-looking prefixes. The browser suite compares twelve namespace transitions with DOMParser for both canonical source and the built ESM package. Full-Studio tests accept an aliased XAML enum, an SVG attribute and a MathML element through the editor's normal completion transaction. Clean installed-consumer checks include the typed context API.

This is not native assembly/type-system discovery, exhaustive framework member validation, complete HTML content-model validation, arbitrary JavaScript/CSS language services, speculative semantic namescopes for invalid drafts or declarative shadow-root tooling. Common XAML property suggestions remain metadata-driven hints, not proof that every suggested property is valid on every framework type. No runtime sandbox, navigation or script policy changes.

Reference semantics: Microsoft Learn “XAML Syntax In Detail” and “XAML language overview”; WHATWG HTML Standard, parsing integration points and foreign content. Parsing/serialization remains separate from completion and remains responsible for authoritative document semantics.
