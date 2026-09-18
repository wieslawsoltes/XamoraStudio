# XAML inline text in the designer and runtime

TextBlock can contain Run, Span, Bold, Italic, Underline, Hyperlink, LineBreak and InlineUIContainer. These controls are registered in the Text toolbox, retain AST identities and source locations, and participate in the regular rendering and runtime paths rather than a separate text-only renderer.

```xml
<TextBlock xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
           xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
           FontSize="24" TextWrapping="Wrap">
  <TextBlock.Inlines>
    <Run Text="Hello "/>
    <Bold><Run Text="{Binding Name}"/></Bold>
    <LineBreak/>
    <Run><Run.Text><!-- keep this note -->{literal text}</Run.Text></Run>
    <InlineUIContainer><Button Content="Action" Click="HandleAction"/></InlineUIContainer>
  </TextBlock.Inlines>
</TextBlock>
```

Direct inline children and explicit owner `.Inlines` collections preserve content order. Alternate XML prefixes for the same presentation namespace work for owned properties. Run.Text and TextBlock.Text scalar property-element content is literal; comments are retained without appearing in the rendered text. Attribute literals beginning with braces use the existing `{}` escape. Object-valued Text properties remain in the AST but are not interpreted as arbitrary markup extensions by this increment.

## Editing

Select a TextBlock or Span-like container and insert inline controls from the Text toolbox. Inserting or pasting an inline into a literal TextBlock converts existing Text into the first Run in the same undoable document transaction, without losing its literal escape. Explicit inline collections remain the insertion target. Duplicating an inline uses its logical owner rather than treating the property wrapper as a visual control. Canvas/tree drop planning uses the same content rules.

Run participates in the property inspector and direct text editor. Select a Run and use Edit text on canvas (or double-click it). Editing a scalar Run.Text property updates the original property element and keeps its comments. Structured inline content is not flattened by the direct text editor: select the actual Run instead. Bound text must be edited through its binding/data rather than overwritten by inline insertion. A non-inline visual control belongs in InlineUIContainer, not directly inside a text container; an inline cannot be placed directly inside a layout panel.

## Rendering and runtime

Inlines now resolve styles, resources and data contexts through PreviewRenderer.node, so template instances, binding values and effective-property maps stay connected to the original nodes. Font properties, text decorations, baseline alignment, flow direction and nested formatting render with browser text layout. Empty spans no longer receive layout-panel minimum sizes or empty-container outlines.

Standalone applications share the same renderer. Named Run bindings and runtime property updates work, inherited font values cross explicit property wrappers, and Bold establishes a bold weight while explicit local/style overrides still win. InlineUIContainer renders an actual child control, including its registered events.

Hyperlink never navigates automatically. It is keyboard-focusable in interactive runtime and sends a Click through the existing preview event/registered handler mechanism; the host owns navigation and URL policy. Design-mode links and disabled links do not execute activation. Importing a NavigateUri therefore does not navigate Studio or execute an imported URL. This is intentionally not an unrestricted browser link loader.

The canonical model/design-tools exports and declarations include isPropertyOf, isXamlInline, isXamlInlineContainer, inlineContentError and prepareInlineContent. prepareInlineContent mutates the AST and must be called inside the host's document transaction. The existing package build carries these through the model and designer packages; no separate duplicate engine is added.

## Qualification and boundaries

Unit tests cover explicit collections, scalar property text, namespace aliases, literal escapes, style/resource/binding resolution, template identities, safe hyperlinks, InlineUIContainer, content guards, undo and runtime inheritance. The browser suite exercises full Studio insertion/editing/duplication and canonical plus built-package applications.

This does not establish native text shaping, font metrics, pagination, FlowDocument/RichTextBox parity, arbitrary TextPointer editing, exhaustive XAML content-model validation, unrestricted custom markup extensions or native WPF/Avalonia inline typography qualification. Imported unknown nodes and unsupported properties remain retained; browser output is not a promise of native-identical typography.

Reference semantics: Microsoft Learn TextBlock.Inlines and System.Windows.Documents.Bold. Bold is the inline shorthand for a Span with bold font weight. The browser runtime's host-owned hyperlink behavior is an explicit policy difference, not claimed native navigation parity.
