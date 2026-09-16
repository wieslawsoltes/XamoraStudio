/** Native property/layout lowering, opt-in so legacy browser-projection output stays stable. */
import { element, localName } from './model.js';
const panels = new Set(['Grid', 'StackPanel', 'WrapPanel', 'DockPanel', 'Canvas']);
const inlines = new Set(['Run', 'Span', 'Bold', 'Italic', 'Underline', 'Hyperlink', 'LineBreak']);
const fonts = ['Foreground', 'FontFamily', 'FontSize', 'FontWeight', 'FontStyle'];
const outer =
  /^(?:x:Name|Name|Width|Height|MinWidth|MinHeight|MaxWidth|MaxHeight|Margin|HorizontalAlignment|VerticalAlignment|Opacity|Visibility|IsVisible|IsEnabled|ToolTip|TabIndex|Grid\.|Canvas\.|Panel\.|ZIndex|AutomationProperties\.)/;
const sides = (value = '0') => {
  const items = String(value).split(/[ ,]+/).map(Number);
  if (!items.every(Number.isFinite)) return null;
  if (items.length === 1) return [items[0], items[0], items[0], items[0]];
  if (items.length === 2) return [items[0], items[1], items[0], items[1]];
  return items.length === 4 ? items : null;
};

export function lowerNativeHtmlNode(node, css, framework, report) {
  const type = localName(node.type),
    props = node.props;
  const loss = (message) => report('warning', 'NATIVE_LAYOUT_ADAPTER', message, true);
  if (props.FontStyle)
    props.FontStyle =
      { normal: 'Normal', italic: 'Italic', oblique: 'Oblique' }[props.FontStyle.toLowerCase()] ||
      props.FontStyle;
  if (props.FontWeight)
    props.FontWeight =
      { normal: 'Normal', bold: 'Bold' }[props.FontWeight.toLowerCase()] || props.FontWeight;
  if (props.TextAlignment === 'Start')
    props.TextAlignment = css.direction === 'rtl' ? 'Right' : 'Left';
  if (props.TextAlignment === 'End')
    props.TextAlignment = css.direction === 'rtl' ? 'Left' : 'Right';
  if (props.TextDecorations === 'None') delete props.TextDecorations;
  if (framework === 'Avalonia') {
    if (props.ToolTip !== undefined) {
      props['ToolTip.Tip'] = props.ToolTip;
      delete props.ToolTip;
    }
    if (type === 'Grid' && props.Spacing !== undefined) {
      props.RowSpacing ??= props.Spacing;
      props.ColumnSpacing ??= props.Spacing;
      delete props.Spacing;
    }
    if (type === 'StackPanel') {
      const axis = props.Orientation === 'Horizontal' ? 'ColumnSpacing' : 'RowSpacing';
      if (props[axis] !== undefined) props.Spacing = props[axis];
      delete props.RowSpacing;
      delete props.ColumnSpacing;
    }
    if (type === 'WrapPanel') {
      const horizontal = props.Orientation !== 'Vertical';
      const item = props[horizontal ? 'ColumnSpacing' : 'RowSpacing'] ?? props.Spacing;
      const line = props[horizontal ? 'RowSpacing' : 'ColumnSpacing'] ?? props.Spacing;
      if (item !== undefined) props.ItemSpacing = item;
      if (line !== undefined) props.LineSpacing = line;
      delete props.Spacing;
      delete props.RowSpacing;
      delete props.ColumnSpacing;
    }
    if (props['Panel.ZIndex'] !== undefined) {
      props.ZIndex = props['Panel.ZIndex'];
      delete props['Panel.ZIndex'];
    }
    if (type === 'Hyperlink') {
      node.type = 'Span';
      delete props.NavigateUri;
      loss(
        'Avalonia inline hyperlinks require an explicit navigation handler; the text is retained as a Span.',
      );
    }
  }
  if (inlines.has(type)) {
    for (const key of Object.keys(props))
      if (
        (outer.test(key) && !['x:Name', 'Name'].includes(key)) ||
        [
          'Padding',
          'BorderThickness',
          'BorderBrush',
          'CornerRadius',
          'TextWrapping',
          'TextAlignment',
        ].includes(key)
      ) {
        delete props[key];
        loss(
          `Inline ${type}.${key} has no native layout slot; use measured capture for positioned inline content.`,
        );
      }
    return node;
  }
  if (panels.has(type)) {
    const textProps = Object.fromEntries(
      fonts.filter((key) => props[key] !== undefined).map((key) => [key, props[key]]),
    );
    for (const key of fonts) delete props[key];
    node.children = node.children.flatMap((child) =>
      child.kind === 'text'
        ? child.text.trim()
          ? [
              element('TextBlock', {
                ...textProps,
                Text: child.text.startsWith('{') ? '{}' + child.text : child.text,
                TextWrapping: 'Wrap',
              }),
            ]
          : []
        : [child],
    );
    delete props.TextWrapping;
    delete props.TextAlignment;
  }
  if (framework === 'WPF' && ['StackPanel', 'WrapPanel'].includes(type)) {
    const horizontal = props.Orientation === 'Horizontal',
      gap = Number(props.Spacing ?? (horizontal ? props.ColumnSpacing : props.RowSpacing) ?? 0);
    if (gap && type === 'StackPanel' && Number.isFinite(gap)) {
      const children = node.children.filter(
        (child) => child.kind === 'element' && !child.type.includes('.'),
      );
      for (const child of children.slice(1)) {
        const margin = sides(child.props.Margin);
        if (margin) {
          margin[horizontal ? 0 : 1] += gap;
          child.props.Margin = margin.join(',');
        } else loss('A nonnumeric child margin prevents native StackPanel gap lowering.');
      }
    } else if (gap)
      loss('Wrapping inter-item gaps require a native wrap-layout adapter or measured capture.');
  }
  if (framework === 'WPF' && type === 'Grid') {
    for (const [axis, property] of [
      ['Column', 'Width'],
      ['Row', 'Height'],
    ]) {
      const gap = Number(props[axis + 'Spacing'] ?? props.Spacing ?? 0);
      if (!gap || !Number.isFinite(gap)) continue;
      const definitions = node.children.find(
        (child) => child.type === 'Grid.' + axis + 'Definitions',
      );
      if (!definitions || definitions.children.length < 2) continue;
      definitions.children = definitions.children.flatMap((child, index) =>
        index ? [element(axis + 'Definition', { [property]: String(gap) }), child] : [child],
      );
      for (const child of node.children.filter(
        (child) => child.kind === 'element' && !child.type.includes('.'),
      )) {
        child.props['Grid.' + axis] = String(Number(child.props['Grid.' + axis] || 0) * 2);
        if (child.props['Grid.' + axis + 'Span'])
          child.props['Grid.' + axis + 'Span'] = String(
            Number(child.props['Grid.' + axis + 'Span']) * 2 - 1,
          );
      }
    }
  }
  if (framework === 'WPF')
    for (const key of ['Spacing', 'RowSpacing', 'ColumnSpacing']) delete props[key];
  if (
    panels.has(type) &&
    ['Padding', 'BorderThickness', 'BorderBrush', 'CornerRadius'].some(
      (key) => props[key] !== undefined,
    )
  ) {
    const wrapper = element('Border', {}, [node]);
    wrapper.id = node.id;
    node.id = element(type).id;
    for (const key of Object.keys(props))
      if (
        outer.test(key) ||
        ['Padding', 'BorderThickness', 'BorderBrush', 'CornerRadius', 'Background'].includes(key)
      ) {
        wrapper.props[key] = props[key];
        delete props[key];
      }
    return wrapper;
  }
  return node;
}
