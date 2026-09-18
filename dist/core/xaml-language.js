import { MOTION_TYPES, MOTION_PROPERTIES, MOTION_VALUES } from './motion-schema.js';
import { walk, isElement, localName, isXamlInline, isXamlInlineContainer } from './model.js';
import { markupCompletionContext } from './markup-context.js';
import { propertyGroups } from './registry.js';
import { bindingPaths } from './design-data.js';
export const PROPERTY_VALUES = {
  HorizontalAlignment: ['Stretch', 'Left', 'Center', 'Right'],
  VerticalAlignment: ['Stretch', 'Top', 'Center', 'Bottom'],
  Orientation: ['Vertical', 'Horizontal'],
  Visibility: ['Visible', 'Hidden', 'Collapsed'],
  IsVisible: ['True', 'False'],
  IsEnabled: ['True', 'False'],
  IsChecked: ['True', 'False'],
  IsReadOnly: ['True', 'False'],
  LastChildFill: ['True', 'False'],
  ClipToBounds: ['True', 'False'],
  TextWrapping: ['NoWrap', 'Wrap'],
  TextAlignment: ['Left', 'Center', 'Right', 'Justify'],
  FontWeight: ['Normal', 'Medium', 'SemiBold', 'Bold', 'Light'],
  FontStyle: ['Normal', 'Italic', 'Oblique'],
  'DockPanel.Dock': ['Left', 'Top', 'Right', 'Bottom'],
  Stretch: ['None', 'Fill', 'Uniform', 'UniformToFill'],
  Mode: ['Default', 'OneWay', 'TwoWay', 'OneTime', 'OneWayToSource'],
  UpdateSourceTrigger: ['Default', 'PropertyChanged', 'LostFocus', 'Explicit'],
};
const descriptions = {
  Width: 'Explicit layout width in device-independent pixels or Auto.',
  Height: 'Explicit layout height in device-independent pixels or Auto.',
  Margin: 'Outer spacing: uniform, horizontal/vertical, or left,top,right,bottom.',
  Padding: 'Inner content spacing.',
  DataContext: 'Inherited source object for child bindings.',
  ItemsSource: 'Collection used to create items and template instances.',
  Template: 'ControlTemplate that defines a control’s visual tree.',
  'Grid.Row': 'Zero-based row index in the containing Grid.',
  'Grid.Column': 'Zero-based column index in the containing Grid.',
  'Grid.RowSpan': 'Number of grid rows occupied by the control.',
  'Grid.ColumnSpan': 'Number of grid columns occupied by the control.',
};
export function openTags(source) {
  return markupCompletionContext(source).stack.map((frame) => frame.type);
}
export function completionContext(source) {
  const { start, quote, blocked } = markupCompletionContext(source);
  return { start, quote, blocked };
}
const frameworkNamespaces = new Set([
  '',
  'http://schemas.microsoft.com/winfx/2006/xaml/presentation',
  'https://github.com/avaloniaui',
]);
const XAML_NAMESPACE = 'http://schemas.microsoft.com/winfx/2006/xaml';
const ownerProperties = {
  TextBlock: ['Text', 'Inlines', 'Resources'],
  Run: ['Text'],
  Span: ['Inlines'],
  Bold: ['Inlines'],
  Italic: ['Inlines'],
  Underline: ['Inlines'],
  Hyperlink: ['Inlines'],
  InlineUIContainer: ['Child'],
  Grid: ['Children', 'RowDefinitions', 'ColumnDefinitions', 'Resources'],
  StackPanel: ['Children', 'Resources'],
  Canvas: ['Children', 'Resources'],
  DockPanel: ['Children', 'Resources'],
  WrapPanel: ['Children', 'Resources'],
  UniformGrid: ['Children', 'Resources'],
  Border: ['Child', 'Background', 'BorderBrush', 'Resources'],
  Style: ['Setters', 'Triggers'],
  Setter: ['Value'],
  ControlTemplate: ['Resources', 'Triggers'],
  DataTemplate: ['Resources', 'Triggers'],
  ResourceDictionary: ['MergedDictionaries'],
};
export function completeXaml(source, offset, { registry, document, context = {} }) {
  if (
    typeof source !== 'string' ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > source.length
  )
    return [];
  const before = source.slice(0, offset),
    scan = markupCompletionContext(source, offset),
    last = scan.start,
    tail = last < 0 ? '' : before.slice(last),
    resources = [],
    names = [];
  if (scan.blocked) return [];
  const parent = scan.stack.at(-1),
    namespaces = scan.tag?.namespaces || parent?.namespaces || new Map(),
    native =
      !scan.tag ||
      (frameworkNamespaces.has(scan.tag.namespaceURI) &&
        (!scan.tag.type.includes(':') || namespaces.has(scan.tag.type.split(':')[0]))),
    descriptor =
      scan.tag &&
      (native || scan.tag.type.includes(':')
        ? registry.get(scan.tag.type, scan.tag.namespaceURI)
        : undefined),
    qualify = (name, language = false) => {
      const prefixes = [...namespaces].filter(([prefix, uri]) =>
        language ? prefix && uri === XAML_NAMESPACE : frameworkNamespaces.has(uri),
      );
      if (!language && !namespaces.has('') && !prefixes.length) prefixes.unshift(['', '']);
      if (language && !prefixes.length && !namespaces.has('x'))
        prefixes.push(['x', XAML_NAMESPACE]);
      return prefixes.map(([prefix]) => (prefix ? prefix + ':' + name : name));
    };
  if (document?.root)
    walk(document.root, (n) => {
      if (isElement(n)) {
        for (const [key, value] of Object.entries(n.props)) {
          const [prefix, name] = key.split(':');
          if (key === 'Name') names.push(value);
          if (name && (n.scope?.[prefix] === XAML_NAMESPACE || (prefix === 'x' && !n.scope))) {
            if (name === 'Key') resources.push(value);
            if (name === 'Name') names.push(value);
          }
        }
      }
    });
  const token = before.match(/[\w:.$[\]-]*$/)?.[0] || '',
    nameEnd = offset + (source.slice(offset).match(/^[\w:.-]*/)?.[0].length || 0);
  const result = (values, kind, start = offset - token.length, transform = (v) => v) =>
    [
      ...new Map(
        values.map((v) => {
          const obj = typeof v === 'string' ? { label: v } : v;
          return [obj.label, obj];
        }),
      ).values(),
    ]
      .filter((v) => v.label.toLowerCase().startsWith(source.slice(start, offset).toLowerCase()))
      .map((v) => ({
        label: v.label,
        detail: v.detail || kind,
        start,
        end: offset,
        insertText: transform(v.label),
        caretOffset: undefined,
        ...v,
      }));
  const quoted = scan.attribute;
  if (quoted?.quote) {
    const property = quoted.name,
      value = quoted.value,
      valueStart = quoted.start;
    if (value.startsWith('{}')) return [];
    if (/\{(?:StaticResource|DynamicResource)\s+[^}]*$/.test(value))
      return result(resources, 'Resource key');
    if (/\{Binding(?:\s+Path=|\s+)?[^,}]*$/.test(value)) {
      const path = value.replace(/^.*\{Binding\s*(?:Path=)?/, '');
      return result(bindingPaths(context), 'Data binding path', offset - path.length);
    }
    if (/ElementName\s*=\s*\w*$/.test(value)) return result(names, 'Named element');
    if (/\b(Mode|UpdateSourceTrigger)\s*=\s*\w*$/.test(value)) {
      const key = value.match(/\b(Mode|UpdateSourceTrigger)\s*=/)[1];
      return result(PROPERTY_VALUES[key], key);
    }
    if (value.startsWith('{') && !value.includes(' '))
      return result(
        [
          'Binding',
          'StaticResource',
          'DynamicResource',
          'TemplateBinding',
          'RelativeSource',
          ...qualify('Null', true),
        ],
        'Markup extension',
        valueStart + 1,
      );
    const meta = descriptor?.properties?.find((p) => typeof p === 'object' && p.name === property);
    const member =
      property.includes(':') && frameworkNamespaces.has(namespaces.get(property.split(':')[0]))
        ? localName(property)
        : property;
    if (meta?.values) return result(meta.values, 'Property value', valueStart);
    if (!native && !meta) return [];
    let values = meta?.values || PROPERTY_VALUES[member] || MOTION_VALUES[member] || [];
    if (property === 'Storyboard.TargetName' || property === 'SourceName') values = names;
    if (property === 'Storyboard.TargetProperty')
      values = [
        'Opacity',
        'Width',
        'Height',
        'Canvas.Left',
        'Canvas.Top',
        '(UIElement.RenderTransform).(RotateTransform.Angle)',
        '(Control.Background).(SolidColorBrush.Color)',
      ];
    if (['Background', 'Foreground', 'BorderBrush', 'Fill', 'Stroke'].includes(property))
      values = [
        'Transparent',
        'White',
        'Black',
        '#7953E8',
        ...resources.map((k) => `{StaticResource ${k}}`),
      ];
    if (
      ['Text', 'Content', 'DataContext', 'ItemsSource', 'Command'].includes(property) &&
      !value.startsWith('{')
    )
      values = ['{Binding }', ...resources.map((k) => `{StaticResource ${k}}`)];
    if (['Grid.Row', 'Grid.Column', 'Grid.RowSpan', 'Grid.ColumnSpan'].includes(member))
      values = Array.from({ length: 12 }, (_, i) => String(i + (member.endsWith('Span') ? 1 : 0)));
    if (['Width', 'Height'].includes(property)) values = ['Auto', '100', '240', '320', '480'];
    return result(values, 'Property value', valueStart);
  }
  if (/<\/[\w:.-]*$/.test(before))
    return result(openTags(before.slice(0, last)).reverse(), 'Closing element').map((item) => ({
      ...item,
      end: nameEnd,
    }));
  if (/<[\w:.-]*$/.test(before)) {
    const inlineOwner =
      parent &&
      (isXamlInlineContainer({
        kind: 'element',
        type: parent.type,
        namespaceURI: parent.namespaceURI,
      }) ||
        (frameworkNamespaces.has(parent.namespaceURI) &&
          localName(parent.type).endsWith('.Inlines')));
    let types = [
      ...MOTION_TYPES,
      ...registry
        .list()
        .map((c) => ({ label: c.type, detail: c.description || `${c.category} control` })),
      ...[
        'Grid.RowDefinitions',
        'Grid.ColumnDefinitions',
        'RowDefinition',
        'ColumnDefinition',
        'ControlTemplate',
        'DataTemplate',
        'Style',
        'Setter',
        'ResourceDictionary',
        'SolidColorBrush',
      ],
    ];
    if (inlineOwner)
      types = types.filter((item) =>
        isXamlInline({
          kind: 'element',
          type: typeof item === 'string' ? item : item.label,
          namespaceURI: parent.namespaceURI,
        }),
      );
    const values = types.flatMap((item) => {
      const entry = typeof item === 'string' ? { label: item } : item;
      return entry.label.includes(':')
        ? [entry]
        : qualify(entry.label).map((label) => ({ ...entry, label }));
    });
    if (
      parent &&
      frameworkNamespaces.has(parent.namespaceURI) &&
      (!parent.type.includes(':') || parent.namespaces.has(parent.type.split(':')[0])) &&
      !parent.type.includes('.')
    ) {
      const owner = localName(parent.type),
        info = registry.get(parent.type, parent.namespaceURI);
      const props = new Set([
        ...(ownerProperties[owner] || []),
        ...(info?.singleChild && !ownerProperties[owner] ? ['Content', 'Resources'] : []),
        ...(info?.properties || []).map((p) => (typeof p === 'string' ? p : p.name)),
      ]);
      for (const property of props)
        if (!parent.attributes.has(property))
          for (const label of qualify(owner + '.' + property))
            values.push({ label, detail: `${owner}.${property} property element` });
    }
    return result(values, 'Element').map((item) => ({ ...item, end: nameEnd }));
  }
  if (last >= 0 && !scan.quote) {
    const tag = scan.tag?.type,
      existing = scan.tag?.attributes || new Map(),
      assigned = /^\s*=/.test(source.slice(nameEnd));
    let props = [
      ...new Set([
        ...(native
          ? Object.values(propertyGroups)
              .flat()
              .flatMap((name) => (name.includes('.') ? qualify(name) : [name]))
          : []),
        ...(native
          ? MOTION_PROPERTIES.flatMap((name) => (name.includes('.') ? qualify(name) : [name]))
          : []),
        ...qualify('Name', true),
        ...qualify('Key', true),
        'Orientation',
        'LastChildFill',
        'Rows',
        'Columns',
        'RowDefinitions',
        'ColumnDefinitions',
        'Color',
        'TargetType',
        'Property',
        'Value',
        ...(descriptor?.properties || []).map((p) => (typeof p === 'string' ? p : p.name)),
      ]),
    ].filter(
      (p) =>
        !existing.has(p) &&
        (native ||
          p.includes(':') ||
          (descriptor?.properties || []).some((m) => (typeof m === 'string' ? m : m.name) === p)),
    );
    return result(
      props.map((label) => ({
        label,
        detail: descriptions[label] || `${tag || 'Element'}.${label}`,
        caretOffset: label.length + (assigned ? 0 : 2),
      })),
      'Property',
      offset - token.length,
      (v) => (assigned ? v : v + '=""'),
    ).map((item) => ({ ...item, end: nameEnd }));
  }
  return [];
}
