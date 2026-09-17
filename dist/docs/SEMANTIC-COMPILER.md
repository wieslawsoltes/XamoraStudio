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

| Source construct                                                                 | Target representation                                   | Qualification                                                                                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas and attached offsets                                                      | Positioned container and absolutely positioned children | Left/top take precedence over right/bottom, matching preview behavior.                                                                                                    |
| Grid definitions, attached rows/columns/spans                                    | CSS Grid tracks and placement                           | Pixel, Auto, and weighted star tracks; ordinary HTML row-major auto placement becomes explicit native cells and implicit Auto rows.                                       |
| StackPanel                                                                       | Flex row/column                                         | Fixed child sizes do not shrink.                                                                                                                                          |
| WrapPanel                                                                        | Wrapping flex container                                 | Horizontal default and line alignment match the existing preview.                                                                                                         |
| DockPanel                                                                        | CSS Grid placement in docking order                     | The last child fills unless LastChildFill is false. Native docking information is preserved for reverse conversion.                                                       |
| Text, buttons, labels, editors, lists, selection, images and range controls      | Semantic HTML elements                                  | CheckBox/RadioButton include visible labels and native input parts.                                                                                                       |
| Thickness, corner radius, dimensions, colors, opacity, text/alignment properties | CSS properties                                          | XAML left/top/right/bottom thickness order and ARGB color order are converted explicitly. Relative/intrinsic values without native equivalents carry diagnostics.         |
| Scalar resources and styles                                                      | Resolved static values                                  | Resource shadowing and style/local precedence reuse designer code. Dynamic resources and triggers are snapshots with explicit loss reports.                               |
| Simple `{Binding Path}` and named events                                         | Inert binding/handler attributes                        | Connect application objects and explicit callbacks using the interaction bridge. No code-behind translation or expression evaluation occurs.                              |
| WPF scalar/color/thickness and basic transform animation tracks                  | CSS keyframes and timing                                | Deterministic names, delays, repeat counts, auto-reverse cycles and supported segment interpolation. Standalone storyboards are initially paused for explicit activation. |
| Local CSS keyframes with stylesheet or inline animation bindings                 | WPF Storyboards and Loaded activation                   | Numeric, color, thickness, rotate and single translate/scale transforms; repeats/direction/fill and supported cubic timing are mapped.                                    |

The static CSS cascade compiles selectors once and compares specificity as separate
ID/class/type columns. Supported selectors are type, universal, ID, class, attribute
presence/operators (including ASCII case flags), structural and functional pseudo-selectors,
filtered An+B formulas, form-state predicates, descendant, child, adjacent sibling and
general sibling selectors. See [responsive conversion](RESPONSIVE-COMPILER.md) for
interaction-state inputs and the exact environment contract. Quotes, commas and escaped identifiers are
parsed without treating their contents as combinators. Descendant matching backtracks
when an intermediate ancestor does not satisfy a preceding relationship.

Declarations stay ordered, including duplicates. Importance, inline precedence and
source order are compared without numeric specificity overflow. Margin, padding and
border-width shorthands participate as individual side declarations before conversion
to native thickness. Custom properties are case-sensitive, inherit their computed
values, support balanced nested fallbacks, and detect cycles including dependencies in
unused fallbacks. Invalid variable substitution uses unset semantics, not an earlier
cascaded declaration. Resolution is bounded to 64 levels and 65,536 characters;
`CSS_VARIABLE` diagnostics make unresolved/cyclic/over-limit values visible to strict
mode. This is a bounded static implementation, not a complete CSS tokenizer or grammar.

Absolute lengths (`px`, `in`, `cm`, `mm`, `q`, `pt`, `pc`) become native device-independent
numeric values. Legacy RGB/RGBA and modern space/slash RGB values, percentage channels
and alpha become native ARGB colors. Unsupported functional color spaces are reported
instead of copied as invalid native brush strings. Supported relative font weights are
resolved numerically, and Bold/Italic defaults are not overwritten by an inherited
normal weight/style.

Conditional media/supports/container rules, cascade layers, external stylesheet graphs
and dimensional CSS math now have explicit environment/resource APIs. Intrinsic and
responsive browser layout can be captured through a read-only live-DOM measurement
adapter with coalesced observation. The synchronous compiler still never fetches a
stylesheet or guesses browser state. [Responsive compiler contracts and native
qualification](RESPONSIVE-COMPILER.md) distinguish static environment snapshots, live
regeneration, supported native output and remaining paint/runtime adapters.

### Rich text and form controls

Mixed text is lowered as an ordered inline stream: `span`, `strong`/`b`, `em`/`i`, `u`,
`br` and WPF hyperlinks become Span, Bold, Italic, Underline, LineBreak and Hyperlink
objects rather than losing their order in one scalar Text property. Nested spans stay
inline. XAML `.Inlines`, `.Items` and rich `.Header` property syntax participate in
conversion and are not duplicated from stale metadata on the return trip.

Rich inline-only button/label content uses one native TextBlock content object. An
unchanged compiler-created text host is transparent on reverse output, retaining the
original HTML child-selector structure; an edited host is retained to preserve its new
properties. Normal/nowrap whitespace collapses across inline boundaries; pre/pre-wrap
and pre-line line breaks are retained. Text layout inherited from the containing text
host does not become an invalid TextWrapping property on native Inline objects. Native
inline UI/block embedding still reports `INLINE_CONTENT` and needs a control adapter.

TextBox `AcceptsReturn` (including an effective style setter) emits a real textarea;
HTML textarea content retains newlines and read-only state. Single-select option state
maps to ComboBox SelectedIndex and ComboBoxItem IsSelected, with edited selection
surviving subsequent trips. Radio group names map to GroupName. HTML multiple selection
reports `MULTIPLE_SELECTION`; native no-selection/out-of-range indices report
`SELECTION_INDEX` rather than claiming an HTML select can reproduce them without a
runtime adapter. Input types outside the documented mappings and native toolkit-specific
inline controls remain subject to target-adapter requirements.

Native WPF and Avalonia have different property sets. The browser projection understands useful CSS-like properties beyond those native sets; `NATIVE_PROPERTY` reports cases requiring a wrapper or a target property adapter, such as Padding/Foreground on a native Grid or WPF StackPanel Spacing. Strict mode rejects those cases. This is a bounded semantic compiler with explicit extension points, not a proof of equivalence for arbitrary HTML/CSS/JavaScript or every native XAML toolkit.

## Portable preservation and round trips

By default, generated HTML carries `data-xamora-xaml` metadata containing the original node type, properties, nonvisual property children, and the generated baseline. Generated XAML carries `web:Source.Metadata` in `urn:xamora:web`, retaining original HTML tags, attributes, unrepresented styles and nonvisual content. The root declares markup compatibility and makes the metadata namespace ignorable so a native loader does not treat preservation records as application properties.

On reverse conversion the compiler compares current mapped values with the generated baseline. An edited width or caption wins over its earlier value; unchanged bindings, custom properties, types, and source-only children are restored. Inline HTML style strings remain byte-for-byte unchanged when their mapped values do
not change. A mapped property edit patches its declarations while retaining unrelated
fallback declarations, leading comments and importance. Generated HTML baselines are
captured after parent layout/selection changes so those changes are not confused with
subsequent user edits. This does not preserve arbitrary formatting of the complete document.

It does not replace the result with an old full-source snapshot. A node can be deleted or reordered in the designer without resurrecting the earlier visual tree.

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

`tests/semantic-fidelity.test.mjs` adds independent cascade, variable, rich-inline,
whitespace, form-state, color/unit, metadata-edit and input-immutability regressions.
`tests/browser-compiler-fidelity.mjs` bundles both the canonical source entrypoint and
the built package entrypoint, and compares conversion results with Chromium computed
CSS, rendered inline text and edited form state. Both run by default in the existing
browser gate. The source-only environment switch is for local development, not CI
qualification. The separate native compiler workflow now loads generated fixtures in
actual WPF and Avalonia runtimes; see [the qualification contract](RESPONSIVE-COMPILER.md#actual-native-qualification).

Semantic references: [CSS cascade](https://www.w3.org/TR/css-cascade-3/),
[custom properties](https://www.w3.org/TR/css-variables-1/),
[absolute lengths](https://www.w3.org/TR/css-values-3/#absolute-lengths),
[relative font weights](https://www.w3.org/TR/css-fonts-4/#relative-weights), and
[WPF TextBlock inlines](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/controls/textblock).

## Responsive profile batches and capture privacy

`compileResponsiveVariants(input, { variants, ...options })` returns `{ version: 1, success, profiles }`. Each profile has its `name`, independent effective `environment`, and full conversion `result`. Supply one to 32 unique portable names and positive dimensions no larger than 100000 CSS pixels. Requests are validated before compiler hooks run. Profile width/height take precedence over stale base viewport dimensions. The host selects the profile and applies the output; this API does not inject native responsive behavior.

`compileRenderedDocument` and its observer omit password input values by default, including the authored `value` attribute from round-trip metadata. `includePasswordValues: true` is an explicit opt-in. An informational `BROWSER_PASSWORD_REDACTED` diagnostic does not count as a semantic loss. Other source text is not scanned for secrets.

Observer installation is transactional, additional media listeners preserve the defaults, and document loads/ancestor scrolling also trigger recapture. CSSOM-only edits and continuous animations still need explicit `refresh()` calls as documented above. [Compiler Fidelity Lab](https://wieslawsoltes.github.io/XamoraStudio/examples/CompilerFidelityLab/) demonstrates source editing, viewport/target switching, diagnostics and export; the deployed copy uses the same library.
