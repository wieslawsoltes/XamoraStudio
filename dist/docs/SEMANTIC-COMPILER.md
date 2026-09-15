# Semantic XAML / HTML compiler

Xamora's compiler converts documents through the same `DesignDocument` and `DesignNode` tree used by the designer, document sessions, property panels, preview, history, and runtime. It produces a new document and readable source, with structured diagnostics and node-to-node source maps. It does not modify the input AST, execute authored code, or fetch external resources.

The compiler is available from `@wieslawsoltes/xamora-compiler` and the buildless browser module `dist/core/semantic-compiler.js`. Node applications inject an HTML `DOMParser`; the packaged CLI supplies `happy-dom`. XAML parsing and AST-to-AST compilation do not need a DOM.

```js
import { compileDocument } from '@wieslawsoltes/xamora-compiler';

const result = compileDocument(xamlSource, {
  from: 'xaml',
  to: 'html',
  sourceName: 'Views/Checkout.xaml',
  name: 'Checkout.html',
  preserveMetadata: true,
  strict: false,
});

if (!result.success) {
  console.error(result.diagnostics);
} else {
  console.log(result.source);
  console.log(result.document);
  console.table(result.sourceMap);
}
```

For reverse conversion use `{from: 'html', to: 'xaml', framework: 'WPF'}` or `framework: 'Avalonia'`. A `DesignDocument` can be passed instead of text. Other native targets require a future target adapter; the compiler rejects a framework name it cannot target. A framework label alone does not make generated WPF markup valid for MAUI or WinUI.

## Pipeline and shared infrastructure

1. Parse with the existing safe XAML parser or HTML projection. Validate the existing model's node, depth, property, and text invariants.
2. Build a concrete source index using the designer's source scanner. Index native source nodes without trusting stale import-time source hints.
3. Evaluate the supported static semantics. XAML scalar resources use the designer's owner-scoped `findResource` lookup. Explicit, implicit, and inherited styles use `resolveStyle`; local values keep precedence. HTML uses an AST-only static CSS cascade.
4. Lower layout, controls, properties, content, and supported animations into a fresh tree. Plugins can claim custom nodes before built-in lowering.
5. Preserve source-only authoring information as inert portable metadata when requested. Diagnostics distinguish source preservation from equivalent target behavior.
6. Validate the output, serialize readable markup, and map generated node ranges. Return the entire conversion result atomically.

The compiler returns `success`, `source`, `document`, `diagnostics`, `losses`, `sourceMap`, and `metadata`. Diagnostic severities are `error`, `warning`, and `info`. Diagnostic codes are stable machine-readable categories such as `UNKNOWN_CONTROL`, `CSS_VALUE`, `EXTERNAL_CSS`, `NATIVE_PROPERTY`, and `CSS_ANIMATION_TIMING`. Source ranges are UTF-16 offsets, matching code editors and `DocumentSession`.

`strict: true` rejects a conversion if any behavior is approximate or requires an adapter. A strict rejection can still contain generated preview source and a document for inspection; callers must use `success` before applying or writing the result. Syntax/validation failures return an empty source and a null document. Batch conversion preflights every result and path collision before applying the successful plan.

## Semantic mappings

| Source construct | Target representation | Qualification |
| --- | --- | --- |
| Canvas and attached offsets | Positioned container and absolutely positioned children | Left/top take precedence over right/bottom, matching preview behavior. |
| Grid definitions, attached rows/columns/spans | CSS Grid tracks and placement | Pixel, Auto, and weighted star tracks; ordinary HTML row-major auto placement becomes explicit native cells and implicit Auto rows. |
| StackPanel | Flex row/column | Fixed child sizes do not shrink. |
| WrapPanel | Wrapping flex container | Horizontal default and line alignment match the existing preview. |
| DockPanel | CSS Grid placement in docking order | The last child fills unless LastChildFill is false. Native docking information is preserved for reverse conversion. |
| Text, buttons, labels, editors, lists, selection, images and range controls | Semantic HTML elements | CheckBox/RadioButton include visible labels and native input parts. |
| Thickness, corner radius, dimensions, colors, opacity, text/alignment properties | CSS properties | XAML left/top/right/bottom thickness order and ARGB color order are converted explicitly. Relative/intrinsic values without native equivalents carry diagnostics. |
| Scalar resources and styles | Resolved static values | Resource shadowing and style/local precedence reuse designer code. Dynamic resources and triggers are snapshots with explicit loss reports. |
| Simple `{Binding Path}` and named events | Inert binding/handler attributes | Connect application objects and explicit callbacks using the interaction bridge. No code-behind translation or expression evaluation occurs. |
| WPF scalar/color/thickness and basic transform animation tracks | CSS keyframes and timing | Deterministic names, delays, repeat counts, auto-reverse cycles and supported segment interpolation. Standalone storyboards are initially paused for explicit activation. |
| Local CSS keyframes with stylesheet or inline animation bindings | WPF Storyboards and Loaded activation | Numeric, color, thickness, rotate and single translate/scale transforms; repeats/direction/fill and supported cubic timing are mapped. |

The static CSS cascade supports type, ID, class, attribute, descendant and child selectors, specificity, source order, inline declarations, `!important`, inherited text properties, and literal custom-property substitution. Conditional media/container rules, pseudo selectors, external stylesheets, complex CSS functions and intrinsic/responsive layouts remain in portable metadata with diagnostics. Compilation never fetches a stylesheet or evaluates browser state.

Native WPF and Avalonia have different property sets. The browser projection understands useful CSS-like properties beyond those native sets; `NATIVE_PROPERTY` reports cases requiring a wrapper or a target property adapter, such as Padding/Foreground on a native Grid or WPF StackPanel Spacing. Strict mode rejects those cases. This is a bounded semantic compiler with explicit extension points, not a proof of equivalence for arbitrary HTML/CSS/JavaScript or every native XAML toolkit.

## Portable preservation and round trips

By default, generated HTML carries `data-xamora-xaml` metadata containing the original node type, properties, nonvisual property children, and the generated baseline. Generated XAML carries `web:Source.Metadata` in `urn:xamora:web`, retaining original HTML tags, attributes, unrepresented styles and nonvisual content. The root declares markup compatibility and makes the metadata namespace ignorable so a native loader does not treat preservation records as application properties.

On reverse conversion the compiler compares current mapped values with the generated baseline. An edited width or caption wins over its earlier value; unchanged bindings, custom properties, types, and source-only children are restored. It does not replace the result with an old full-source snapshot. A node can be deleted or reordered in the designer without resurrecting the earlier visual tree.

Metadata makes source larger. Choose `preserveMetadata: false` for clean target markup when source-only constructs do not need to return. Loss diagnostics are still generated. Neither mode guarantees identical formatting after conversion; ordinary code/visual editing should continue through `DocumentSession` for exact local source patches.

HTML scripts, event attributes, active URL schemes, iframe source documents, and active embedded objects are inert on default reverse output. Original authoring information remains in preservation records. `allowScripts: true` explicitly restores authored active HTML content; this is a source restoration option and does not compile JavaScript into XAML. Compiler plugins are trusted host code.

## Explicit interaction bridge

```js
import { attachCompiledInteractions } from '@wieslawsoltes/xamora-compiler';

const data = { title: 'Draft' };
const bridge = attachCompiledInteractions(document.querySelector('main'), {
  data,
  handlers: {
    save(event, { refresh }) {
      data.title = 'Saved';
      refresh();
    },
  },
});

// Refresh after application-side changes; dispose when removing the view.
bridge.refresh();
bridge.dispose();
```

The bridge supports literal dotted binding paths, text/content/value/check/enabled state and mapped scalar CSS values. It never traverses prototype-related path segments and never evaluates source strings. More advanced bindings, converters, commands, validation and application lifecycles belong to the standalone runtime or a custom semantic plugin.

## Extending control semantics

```js
import { compileDocument } from '@wieslawsoltes/xamora-compiler';
import { element, textNode } from '@wieslawsoltes/xamora-model';

const badgePlugin = {
  name: 'company-badge',
  xamlToHtml(node, context) {
    if (node.type !== 'company:Badge') return null;
    return element('mark', { class: 'company-badge' }, [
      textNode(node.props.Text || ''),
    ]);
  },
  htmlToXaml(node, context) {
    if (node.type !== 'mark' || node.props.class !== 'company-badge') return null;
    return element('company:Badge', {
      'xmlns:company': 'urn:company:controls',
      Text: node.children.filter(child => child.kind === 'text')
        .map(child => child.text).join(''),
    });
  },
};

const result = compileDocument(source, { plugins: [badgePlugin] });
```

A plugin returns a valid shared AST node or declines with null/undefined. It can report its own diagnostics and behavioral losses. The model's final validation still applies, and plugin output participates in source maps. Namespace declarations for custom target XAML remain the plugin's responsibility.

## Animation boundaries

Supported CSS animations are imported from local style definitions using the same CSS rule parser as the HTML animation editor. Inline bindings and static selector bindings both participate. WPF tracks use the existing storyboard/keyframe/property-path helpers, so imported transforms have a real transform tree and resolved target path.

Negative delays, scroll-driven timelines, unresolved custom-property animation values, arbitrary CSS transform compositions, additive clocks, nested timing compositions, native spring/easing objects, and arbitrary script-generated WAAPI graphs require adapters. Avalonia native `Animation` lowering is currently preserved with `TARGET_ANIMATION_ADAPTER`; it is not mislabeled WPF Storyboard syntax. When a compiled HTML view also carries its original native storyboard metadata, the native tree is retained rather than creating duplicate clocks. CSS edits to those generated tracks remain in HTML preservation data and produce `STORYBOARD_ROUNDTRIP`; reconciling them into the retained native timeline requires an explicit track adapter. Unsupported behavior is reported even when the authored source can be recovered later.

## Validation

`tests/semantic-compiler.test.mjs` covers layout mappings, scoped resource shadowing, styles, CSS cascade, UTF-16 source-map ranges, strict failure, unknown metadata, two-way scalar/caption edits, visible checkbox/radio labels, input values, plugin controls, deterministic keyframes, inline CSS animation import, native rotation paths, inert HTML restoration and the explicit interaction bridge.

`tests/browser-semantic-compiler.mjs` compares actual Chromium geometry against `PreviewRenderer` for Grid, Stack, Wrap, Canvas and Dock, tests caption edits, CSS auto placement and source-map ranges, and verifies that default restored HTML does not activate authored scripts/handlers/URLs. The IDE and CLI suites independently verify preview/commit behavior, collision handling, filesystem boundaries, dry runs and atomic failure.
