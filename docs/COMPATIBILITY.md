# Framework and preview compatibility

The compatibility level for a control is the combination of four separate facts:

1. Its source can be retained and re-exported.
2. Its descriptor is known to the toolkit/property system.
3. Its browser layout and visuals have a preview implementation.
4. Its exported source has been validated in the actual target runtime.

Only the first three are implemented in this release, with the limits below. No native runtime validation was performed.

| Area | Implemented | Current boundary |
| --- | --- | --- |
| Docking | Nested splits, tabs, floating groups, auto-hide, saved layouts, keyboard routes and extension windows | In-page windows; native OS/multi-monitor hosting requires a desktop adapter; one active editable page canvas |
| WPF | Namespace, common properties, explicit grid definitions, controls/panels, styles/templates and supported WPF motion/state/trigger authoring | Not full WPF API, theme, layout, or dependency-property parity |
| Avalonia | Namespace detection, compact and explicit grids, Spacing, IsVisible, common controls, basic styles/themes | No complete selector engine, pseudo-class resolution, native rendering or toolkit runtime |
| WinUI | Framework selection, preservation and namespace output | Shared WPF namespace does not establish API compatibility; no full semantic adapter |
| MAUI | Namespace detection/selection and preservation | Browser mappings do not implement MAUI layout/control semantics |
| Other XAML | Unknown XML elements/attributes retained | Requires descriptors, namespace mappings, preview and export adapters |
| Custom controls | Declarative metadata, nested scaffolds, browser render callback | No assembly loading, custom .NET drawing, reflection or constructor execution |
| Canvas | Left/Top/Right/Bottom, dimensions, layering, drag and resize | Native measure/arrange and all alignment edge cases not replicated |
| Grid | Fixed/Auto/star tracks, rows/columns, attached cells and spans | Definition min/max/shared-size metadata preserved but not fully evaluated; cell drops use resolved browser track sizes and gaps |
| StackPanel | Orientation, margins, Avalonia gap | Native desired-size and infinite-measure semantics differ |
| DockPanel | Ordered docking, LastChildFill | Browser intrinsic sizing can differ from framework layout |
| WrapPanel / UniformGrid | Browser flex/grid approximation | Framework-specific edge cases, uniform-grid first-column and virtualizing behavior not implemented |
| Viewbox | Content preserved/editable | Actual Viewbox scaling not implemented |
| Text | TextBlock, Label, basic Run/Span formatting | No native shaping/text metrics, rich text editor, glyph-level design, or full inline model |
| Inputs | Basic button, textbox, password, checkbox/radio, combo, slider, date, numeric preview | Framework-specific templates, validation, routed events and input policies not replicated |
| Collections | Basic list/tree/tab/menu containers | Repeated DataTemplates and basic bound DataGrid text columns implemented; native virtualization, tree expansion, and advanced cell editing remain incomplete |
| Resources | Scoped brushes/styles, BasedOn, merged ordering and workspace Source resolver | Arbitrary external asset loading, theme variants and complete dependency-property precedence not implemented |
| Templates | Visual template scope, direct templates, basic style template setters, TemplateBinding preview | Unique preview instance namescopes for supported motion; required native parts, full binding modes and complete item-state contracts not enforced |
| Bindings | Authored strings preserved; inherited contexts, table/query paths, basic formatting, and typed session-local TwoWay input | No native converters, code-behind, compiled binding, or full native data engine; input supports explicit PropertyChanged and change/commit behavior |
| Design data | Typed local tables, object tree, constraints, foreign keys, saved queries, CSV/JSON | No remote SQL/database connection, production migrations, authentication, or data synchronization |
| Prototype | Multi-view board and action connectors; navigation, overlays, state and record operations | Browser session only; no generation of native code-behind from prototype actions |
| Raw properties / completion | Authored attributes and JSON map edits; contextual suggestions from registry, resources and data | No semantic LSP, native project analysis, full refactoring, or native property precedence |
| Visual states | WPF group/state editors, state Storyboards, generated/explicit transitions, isolated group playback | Full native control state contracts and Avalonia state adapters remain incomplete |
| Animation | WPF timeline, record, typed keys, spline/easing, nested clocks, repeat/reverse/fill, trigger and prototype playback | Additive/cumulative composition, all clock actions/types, native timing parity and other framework motion adapters remain incomplete |
| Appearance | Native brush, transform, effect, clip and path authoring with browser preview mappings | Brush/shadow opacity, radial GradientOrigin, rounded clip corners, SVG path gradient fills/strokes, full brush/geometry semantics and native shaders are not previewed completely |
| HTML | Inline layout, basic form state, tabs | Native commands and application logic require integration; not an automatic full application port |
| SVG | Browser foreignObject snapshot | Not a vector reconstruction; tool support and external asset handling vary |

## Conversion rules requiring attention

- WPF `Hidden` consumes layout space; Avalonia `IsVisible=false` collapses it. Xamora retains `Visibility="Hidden"` rather than silently mapping it to false. Resolve the target behavior explicitly.
- WPF and Avalonia styling models differ. `ControlTheme`, selector styles, WPF triggers, and resources cannot be converted by renaming attributes.
- Compact grid definition support is framework/version dependent. Explicit property elements provide the conservative WPF export path. Existing definition metadata is kept.
- Custom namespace conventions, assembly references, `pack://` and `avares://` asset URIs remain authored. They are not automatically rewritten or loaded by the browser.
- Local namespace scopes are recorded on import; the registry is not yet a complete normalized QName/name-scope refactoring system. Rebinding namespace prefixes or reparenting elements across shadowed namespaces requires source review.
- Duplicate operations rename colliding element names and simple `ElementName=` references. This is not a complete semantic rename across templates, markup extensions, namescopes, and external files.
- Visual group/conversion operations are undoable and may change layout semantics. Imported invalid child cardinality is preserved and diagnosed; visual insertion prevents common single-child violations.

## Primary references

- [Microsoft panels and layout](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/controls/panel)
- [Microsoft Grid.ColumnDefinitions](https://learn.microsoft.com/en-us/dotnet/api/system.windows.controls.grid.columndefinitions?view=windowsdesktop-9.0)
- [Microsoft XAML resource overview](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/systems/xaml-resources-overview)
- [Microsoft TemplateBinding](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/templatebinding-markup-extension)
- [Microsoft control authoring](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/controls/control-authoring-overview)
- [Avalonia layout migration](https://docs.avaloniaui.net/docs/migration/wpf/layout)
- [Avalonia migration cheat sheet](https://docs.avaloniaui.net/docs/migration/wpf/cheat-sheet)
- [Avalonia styles](https://docs.avaloniaui.net/docs/styling/styles)
- [Avalonia control themes](https://docs.avaloniaui.net/docs/styling/control-themes)
- [Avalonia templated controls](https://docs.avaloniaui.net/docs/custom-controls/templated-controls)

These references informed the adapter boundaries. The project has not imported proprietary designer source or claimed native runtime certification.


## 0.5 additions and precise boundaries

| Area | Added behavior | Remaining boundary |
| --- | --- | --- |
| Solution | Files/folders, relative path/refactoring, startup, import/export and solution snapshots | One logical solution; no native build graph, file watcher or project system |
| IDE menus | Thirteen implemented menu families, nested keyboard routing and command palette | Native IDE debugger, terminal, language service and source-control integration are not supplied |
| Modes/docks | Surface modes, whole-layout restoration, batched undo, overflow tab list and size hints | One editable canvas/source; browser-contained floating windows |
| Canvas/properties | Inline text, rotation, path points, shape drawing, scrub/color/thickness/gradient/transform/effect/Grid editors | Browser geometry, limited recordable channels, raw/source route for unknown types |
| Resources | Solution resolver, swatches, merge controls and scoped literal-resource refactoring | Nested markup/implicit/native-code references are outside reference analysis |
| Animation | Grouped keys, clipboard, inline timing, snapping and canvas/property recording | WPF-oriented; local-time shared ruler; incomplete nested clock visualization/cross-framework conversion |
| Views | Retained cards, filters, sizing, pagination, tiling and inline connectors | Full virtualization and simultaneous independent editable canvases are not implemented |

See [Editor workflows](EDITOR-WORKFLOWS.md) for detailed semantics. No browser-native or framework-native parity certification is implied.


## Density in 0.6

Compact, Standard and Comfortable affect editor chrome, including code line spacing and timeline rows. Compact is the default. Browser storage retains the preference; storage denial still permits session changes. Light/dark theme tokens are shared across modes. Density does not change authored document values or exports. CSS container queries combine wide compact timeline bars; browsers without container query support retain the separate-row arrangement. Density controller and docking/code geometry tests do not constitute browser visual, touch or accessibility qualification.

## Native HTML in 0.7

HTML is now an editable document format with native browser layout, source/CSS/script editing, attributes, tree manipulation, and isolated interactive preview. Untouched source is preserved exactly; visual edits normalize HTML serialization. CSS/scripts are retained in export. External relative resources are not bundled; custom-element scripts run only in interactive preview. JavaScript semantic IntelliSense/debugging, a visual CSS keyframe timeline, backend execution, full website-folder import and HTML-to-XAML conversion are not provided. [HTML workflows](HTML-WORKFLOWS.md) documents the complete behavior and limitations.
