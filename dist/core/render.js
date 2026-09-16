import { HtmlRenderer } from './html-render.js';
import { serializeHtml } from './html.js';
import {
  applyAppearance,
  designProperties,
  isDesignElement,
  sampleDesignData,
} from './appearance.js';
import { resolveStyle, selectStyles, findResource, resourceEntries } from './styling.js';
import { resolveBinding, readPath } from './design-data.js';
import { localName, visualChildren, isElement, isProperty, walk, clone, element } from './model.js';
const num = (v, d = 0) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
const bool = (v, d = false) => (v == null ? d : String(v).toLowerCase() === 'true');
const px = (v) =>
  /^[-+]?\d*\.?\d+$/.test(String(v)) ? `${v}px` : v === 'Auto' ? 'auto' : undefined;
export function thickness(value) {
  const a = String(value ?? 0)
    .split(/[, ]+/)
    .map((n) => num(n));
  return a.length === 1
    ? [a[0], a[0], a[0], a[0]]
    : a.length === 2
      ? [a[1], a[0], a[1], a[0]]
      : [a[1] || 0, a[2] || 0, a[3] || 0, a[0] || 0];
}
const box = (v) =>
  thickness(v)
    .map((n) => n + 'px')
    .join(' ');
export function color(value) {
  if (typeof value !== 'string') return '';
  if (/^#[\da-f]{8}$/i.test(value)) return '#' + value.slice(3) + value.slice(1, 3);
  return /^(#[\da-f]{3,8}|[a-z]+|rgba?\([\d.,% ]+\))$/i.test(value) ? value : '';
}
const align = (v) =>
  ({
    Left: 'start',
    Top: 'start',
    Right: 'end',
    Bottom: 'end',
    Center: 'center',
    Stretch: 'stretch',
  })[v];
const gridTrack = (v) => {
  v = String(v).trim();
  return v === 'Auto' ? 'auto' : v.includes('*') ? `minmax(0,${num(v, 1) || 1}fr)` : px(v) || '1fr';
};
export function gridDefinitions(node, axis) {
  const shorthand = node.props[`${axis}Definitions`];
  if (shorthand)
    return String(shorthand)
      .split(',')
      .map((v) => v.trim());
  const prop = node.children.find((c) => c.type === `Grid.${axis}Definitions`);
  const values = prop
    ? prop.children
        .filter(isElement)
        .map((c) => c.props[axis === 'Row' ? 'Height' : 'Width'] || '*')
    : ['*'];
  return values.length ? values : ['*'];
}
export class PreviewRenderer {
  constructor(registry) {
    this.registry = registry;
    this.elements = new Map();
    this.interactive = false;
    this.sampleData = {
      User: { Name: 'Alex Morgan', Email: 'alex@studio.design' },
      Title: 'Your project',
      Count: 24,
    };
    this.resources = {};
    this.warnings = [];
    this.parents = new Map();
  }
  value(v, templated, node) {
    if (typeof v !== 'string' || !v.startsWith('{')) return v;
    let m = v.match(/^\{(?:StaticResource|DynamicResource)\s+([^}]+)\}$/);
    if (m) {
      const resource = this.lookupResource(node, m[1]);
      return resource?.props?.Color ?? resource?.children?.map((c) => c.text || '').join('') ?? v;
    }
    m = v.match(/^\{TemplateBinding\s+([^,}]+)/);
    if (m) return templated?.[m[1]] ?? m[1];
    if (/^\{Binding(?:\s|,|})/.test(v)) {
      const value = resolveBinding(v, this.contextFor(node), this.sampleData);
      return value === undefined ? `[${v.slice(1, -1)}]` : value;
    }
    return v;
  }
  render(doc, host, { scope = null, interactive = false, designTime = !interactive } = {}) {
    if (doc.framework === 'HTML') {
      this.htmlRenderer ??= new HtmlRenderer();
      this.document = doc;
      this.elements = this.htmlRenderer.render(doc, host, {
        interactive,
        onReady: () => this.onHtmlReady?.(this.htmlRenderer),
      });
      return this.elements;
    }
    this.htmlRenderer?.dispose();
    this.document = doc;
    this.interactive = interactive;
    this.designTime = designTime;
    this.effectiveNodes = new Map();
    this.effectiveProperties = new Map();
    this.runtimeTemplates = [];
    this.templateOwners = new Map();
    this.elements.clear();
    this.contexts = new Map();
    this.instances = new Map();
    this.bindingProvenance = new Map();
    this.resources = {};
    this.warnings = [];
    this.parents = new Map();
    walk(doc.root, (n, parent) => {
      if (parent) this.parents.set(n.id, parent);
    });
    walk(doc.root, (n) => {
      if (
        n.props?.['x:Key'] &&
        ['SolidColorBrush', 'Color', 'Double', 'String'].includes(localName(n.type))
      )
        this.resources[n.props['x:Key']] =
          n.props.Color || n.children?.map((c) => c.text || '').join('') || '';
    });
    host.replaceChildren();
    const root = scope || doc.root;
    host.append(this.node(root, null));
    return this.elements;
  }
  node(n, parent, templated) {
    if (!isElement(n)) return document.createTextNode(n.text || '');
    if (isDesignElement(n) && !this.designTime) return document.createTextNode('');
    const design = this.designTime ? designProperties(n, this.document) : {},
      styled = resolveStyle(this.document, n, {
        context: this.contextFor(n),
        root: this.sampleData,
        resolveSource: this.resourceResolver,
      });
    n = { ...styled.node, props: { ...styled.properties, ...design } };
    const d = this.registry.get(
        isDesignElement(n) ? localName(n.type) : n.type,
        isDesignElement(n) ? undefined : n.namespaceURI,
      ),
      type = d
        ? localName(n.type)
        : ['Path', 'Line', 'Polygon', 'Polyline'].includes(localName(n.type))
          ? localName(n.type)
          : n.type.includes(':')
            ? 'Unknown'
            : localName(n.type),
      p = Object.fromEntries(
        Object.entries(n.props).map(([k, v]) => {
          const value = this.value(v, templated, n);
          return [k, this.coerceValue ? this.coerceValue(value, k, n) : value];
        }),
      );
    if (this.designTime && /\{\w+:SampleData/.test(String(n.props.ItemsSource)))
      p.ItemsSource = sampleDesignData(
        n,
        Number(String(n.props.ItemsSource).match(/ItemCount\s*=\s*(\d+)/)?.[1] || 5),
      );
    this.effectiveNodes.set(n.id, n);
    this.effectiveProperties.set(n.id, p);
    let el;
    if (d?.render) {
      el = d.render({ node: n, properties: p, renderer: this, interactive: this.interactive });
      if (!(el instanceof Element)) throw Error(`Renderer for ${n.type} must return an Element.`);
    } else
      el = document.createElement(
        type === 'Button' || type === 'ToggleButton'
          ? 'button'
          : type === 'TextBox' || type === 'PasswordBox' || type === 'NumericUpDown'
            ? 'input'
            : type === 'TextBlock' || type === 'Label'
              ? 'div'
              : 'div',
      );
    el.classList.add('design-node');
    el.dataset.nodeId = n.id;
    el.dataset.sourceNodeId = n.sourceId || n.id;
    el.dataset.instanceId = n.instanceId || n.id;
    if (n.rowId) el.dataset.rowId = n.rowId;
    el.dataset.type = type;
    this.elements.set(n.id, el);
    el.style.boxSizing = 'border-box';
    el.style.position = 'relative';
    el.style.minWidth = '0';
    el.style.minHeight = '0';
    const s = el.style;
    for (const [key, css] of [
      ['Width', 'width'],
      ['Height', 'height'],
      ['MinWidth', 'minWidth'],
      ['MinHeight', 'minHeight'],
      ['MaxWidth', 'maxWidth'],
      ['MaxHeight', 'maxHeight'],
    ])
      if (p[key] !== undefined && px(p[key])) s[css] = px(p[key]);
    if (p.Margin) s.margin = box(p.Margin);
    if (p.Padding) s.padding = box(p.Padding);
    if (p.Background && color(p.Background)) s.background = color(p.Background);
    if (p.Foreground && color(p.Foreground)) s.color = color(p.Foreground);
    if (p.Opacity !== undefined && p.Opacity !== null)
      s.opacity = String(Math.max(0, Math.min(1, num(p.Opacity, 1))));
    if (p.BorderThickness) {
      s.borderWidth = box(p.BorderThickness);
      s.borderStyle = 'solid';
      s.borderColor = color(p.BorderBrush) || '#d9d7e2';
    }
    if (p.CornerRadius)
      s.borderRadius = String(p.CornerRadius)
        .split(',')
        .map((v) => num(v) + 'px')
        .join(' ');
    if (p.FontSize !== undefined && p.FontSize !== null) s.fontSize = num(p.FontSize, 14) + 'px';
    if (p.FontFamily) s.fontFamily = p.FontFamily;
    if (p.FontWeight)
      s.fontWeight =
        { Normal: '400', Medium: '500', SemiBold: '600', Bold: '700', Light: '300' }[
          p.FontWeight
        ] || p.FontWeight;
    if (p.FontStyle) s.fontStyle = String(p.FontStyle).toLowerCase();
    if (p.LineHeight) s.lineHeight = num(p.LineHeight) + 'px';
    if (p.TextAlignment) s.textAlign = String(p.TextAlignment).toLowerCase();
    if (p.ToolTip) el.title = p.ToolTip;
    if (p['Panel.ZIndex']) s.zIndex = p['Panel.ZIndex'];
    if (p.IsEnabled !== undefined && !bool(p.IsEnabled, true)) {
      el.setAttribute('disabled', '');
      s.opacity = '.5';
    }
    if (p.HorizontalAlignment) s.justifySelf = align(p.HorizontalAlignment);
    if (p.VerticalAlignment) s.alignSelf = align(p.VerticalAlignment);
    if (p.ClipToBounds === 'True') s.overflow = 'hidden';
    if (parent) {
      const pt = localName(parent.type);
      if (pt === 'Canvas') {
        s.position = 'absolute';
        for (const [key, css] of [
          ['Canvas.Left', 'left'],
          ['Canvas.Top', 'top'],
          ['Canvas.Right', 'right'],
          ['Canvas.Bottom', 'bottom'],
        ])
          if (p[key] !== undefined) s[css] = num(p[key]) + 'px';
        if (p['Canvas.Left'] !== undefined && p['Canvas.Right'] !== undefined) s.right = 'auto';
        if (p['Canvas.Top'] !== undefined && p['Canvas.Bottom'] !== undefined) s.bottom = 'auto';
        if (p['Canvas.Left'] === undefined && p['Canvas.Right'] === undefined) s.left = '0';
        if (p['Canvas.Top'] === undefined && p['Canvas.Bottom'] === undefined) s.top = '0';
      }
      if (pt === 'Grid') {
        const rows = gridDefinitions(parent, 'Row').length,
          cols = gridDefinitions(parent, 'Column').length;
        const row = Math.min(rows - 1, Math.max(0, num(p['Grid.Row']))),
          col = Math.min(cols - 1, Math.max(0, num(p['Grid.Column'])));
        s.gridRow = `${row + 1} / span ${Math.min(rows - row, Math.max(1, num(p['Grid.RowSpan'], 1)))}`;
        s.gridColumn = `${col + 1} / span ${Math.min(cols - col, Math.max(1, num(p['Grid.ColumnSpan'], 1)))}`;
      }
      if (pt === 'StackPanel') {
        s.flexShrink = '0';
        s.alignSelf =
          align(
            parent.props.Orientation === 'Horizontal' ? p.VerticalAlignment : p.HorizontalAlignment,
          ) || 'stretch';
      }
    }
    let children = this.contentChildren(n),
      addChildren = true;
    switch (type) {
      case 'Grid':
        s.display = 'grid';
        s.gridTemplateRows = gridDefinitions(n, 'Row').map(gridTrack).join(' ');
        s.gridTemplateColumns = gridDefinitions(n, 'Column').map(gridTrack).join(' ');
        break;
      case 'StackPanel':
        s.display = 'flex';
        s.flexDirection = p.Orientation === 'Horizontal' ? 'row' : 'column';
        if (this.document.framework !== 'WPF' && p.Spacing) s.gap = num(p.Spacing) + 'px';
        break;
      case 'WrapPanel':
        s.display = 'flex';
        s.flexWrap = 'wrap';
        s.flexDirection = p.Orientation === 'Vertical' ? 'column' : 'row';
        s.alignContent = 'start';
        break;
      case 'UniformGrid':
        s.display = 'grid';
        s.gridTemplateColumns = `repeat(${Math.max(1, num(p.Columns, Math.ceil(Math.sqrt(children.length || 1))))},minmax(0,1fr))`;
        if (p.Rows) s.gridTemplateRows = `repeat(${Math.max(1, num(p.Rows, 1))},minmax(0,1fr))`;
        break;
      case 'DockPanel':
        s.display = 'flex';
        s.flexDirection = 'column';
        addChildren = false;
        this.dock(n, el, children, templated);
        break;
      case 'Canvas':
        s.display = 'block';
        break;
      case 'Border':
      case 'UserControl':
      case 'Window':
      case 'ContentControl':
      case 'ContentPresenter':
      case 'Viewbox':
        s.display = 'grid';
        if (!children.length && p.Content) el.textContent = p.Content;
        break;
      case 'ScrollViewer':
        s.overflow = 'auto';
        break;
      case 'TextBlock':
      case 'Label':
        s.whiteSpace = p.TextWrapping === 'Wrap' ? 'pre-wrap' : 'pre';
        s.lineHeight = s.lineHeight || '1.45';
        if (p.Text !== undefined || p.Content !== undefined) el.textContent = p.Text ?? p.Content;
        else this.appendInline(el, n.children, templated);
        addChildren = false;
        break;
      case 'Button':
      case 'ToggleButton':
        el.classList.add('preview-button');
        el.textContent = p.Content ?? '';
        if (type === 'ToggleButton') {
          el.classList.toggle('toggled', bool(p.IsChecked, false));
          el.setAttribute('aria-pressed', String(bool(p.IsChecked, false)));
        }
        if (this.interactive && type === 'ToggleButton')
          el.addEventListener('click', (event) => {
            const value = !el.classList.contains('toggled');
            if (
              this.onInput?.({
                node: n,
                property: 'IsChecked',
                value,
                context: this.contextFor(n),
                expression: n.props.IsChecked,
                viewId: this.document.id,
                ...this.bindingProvenance?.get(n.id),
              }) === false
            ) {
              event.stopImmediatePropagation();
              return;
            }
            el.classList.toggle('toggled', value);
            el.setAttribute('aria-pressed', String(value));
          });
        break;
      case 'TextBox':
      case 'PasswordBox':
      case 'NumericUpDown':
        el.classList.add('preview-input');
        el.type =
          type === 'PasswordBox' ? 'password' : type === 'NumericUpDown' ? 'number' : 'text';
        el.value = p.Text ?? p.Value ?? '';
        el.placeholder = p.Watermark || p.PlaceholderText || '';
        el.readOnly = !this.interactive || bool(p.IsReadOnly);
        addChildren = false;
        break;
      case 'CheckBox':
      case 'RadioButton':
      case 'ToggleSwitch': {
        s.display = 'flex';
        s.alignItems = 'center';
        s.gap = '9px';
        const input = document.createElement('input');
        input.type = type === 'RadioButton' ? 'radio' : 'checkbox';
        input.name = p.GroupName || n.id;
        input.checked = bool(p.IsChecked);
        input.tabIndex = this.interactive ? 0 : -1;
        input.style.accentColor = '#7953e8';
        if (type === 'ToggleSwitch') input.className = 'preview-switch';
        el.append(input, document.createTextNode(p.Content || p.Header || ''));
        addChildren = false;
        break;
      }
      case 'ComboBox': {
        const select = document.createElement('select');
        select.className = 'preview-input';
        select.style.width = '100%';
        select.style.height = '100%';
        children.forEach((c, i) => {
          const opt = document.createElement('option');
          opt.textContent = c.props.Content || c.props.Header || 'Item';
          opt.selected = i === num(p.SelectedIndex);
          select.append(opt);
        });
        el.append(select);
        addChildren = false;
        break;
      }
      case 'Slider': {
        const input = document.createElement('input');
        input.type = 'range';
        input.min = p.Minimum || '0';
        input.max = p.Maximum || '100';
        input.value = p.Value || '0';
        input.style.width = '100%';
        input.style.accentColor = color(p.Foreground) || '#7953e8';
        el.append(input);
        addChildren = false;
        break;
      }
      case 'ProgressBar': {
        s.background = s.background || '#eeecf3';
        s.borderRadius = '99px';
        s.overflow = 'hidden';
        const bar = document.createElement('div');
        bar.style.cssText = `height:100%;width:${Math.max(0, Math.min(100, ((num(p.Value) - num(p.Minimum)) / (num(p.Maximum, 100) - num(p.Minimum) || 1)) * 100))}%;background:${color(p.Foreground) || '#7953e8'};border-radius:inherit`;
        el.append(bar);
        addChildren = false;
        break;
      }
      case 'Path':
      case 'Line':
      case 'Polygon':
      case 'Polyline': {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
          shape = document.createElementNS('http://www.w3.org/2000/svg', type.toLowerCase());
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.style.overflow = 'visible';
        if (type === 'Path') {
          shape.setAttribute('d', String(p.Data || '').replace(/^F[01]\s*/, ''));
          shape.setAttribute(
            'fill-rule',
            String(p.Data || '').startsWith('F0') ? 'evenodd' : 'nonzero',
          );
        } else if (type === 'Line') {
          for (const key of ['X1', 'Y1', 'X2', 'Y2'])
            shape.setAttribute(key.toLowerCase(), p[key] || '0');
        } else shape.setAttribute('points', p.Points || '');
        shape.setAttribute('fill', color(p.Fill) || 'none');
        shape.setAttribute('stroke', color(p.Stroke) || 'none');
        shape.setAttribute('stroke-width', p.StrokeThickness || '1');
        if (p.StrokeDashArray) shape.setAttribute('stroke-dasharray', p.StrokeDashArray);
        svg.append(shape);
        el.append(svg);
        addChildren = false;
        break;
      }
      case 'Rectangle':
      case 'Ellipse':
        s.background = color(p.Fill) || '#c5b4ef';
        s.borderRadius = type === 'Ellipse' ? '50%' : num(p.RadiusX) + 'px';
        if (p.Stroke) {
          s.borderColor = color(p.Stroke);
          s.borderStyle = 'solid';
          s.borderWidth = num(p.StrokeThickness, 1) + 'px';
        }
        break;
      case 'Image': {
        const src = p.Source;
        if (src && /^(https?:|data:image\/(png|jpeg|webp|gif);base64,|blob:)/i.test(src)) {
          const img = document.createElement('img');
          img.src = src;
          img.alt = p['AutomationProperties.Name'] || 'Design image';
          img.style.cssText = 'width:100%;height:100%;object-fit:contain';
          el.append(img);
        } else {
          el.classList.add('preview-image');
          el.textContent = src ? 'Asset: ' + src : 'Image';
        }
        addChildren = false;
        break;
      }
      case 'DatePicker': {
        const input = document.createElement('input');
        input.type = 'date';
        input.value = p.SelectedDate || '';
        input.className = 'preview-input';
        input.style.width = '100%';
        el.append(input);
        addChildren = false;
        break;
      }
      case 'GroupBox':
      case 'Expander': {
        const h = document.createElement('div');
        h.textContent = (type === 'Expander' ? '⌄  ' : '') + (p.Header || '');
        h.style.cssText = 'font-weight:600;padding:10px 0';
        el.append(h);
        if (type === 'Expander' && this.interactive)
          h.addEventListener('click', () => {
            [...el.children].slice(1).forEach((c) => (c.hidden = !c.hidden));
          });
        break;
      }
      case 'TabControl': {
        const tabs = document.createElement('div');
        tabs.className = 'preview-tabs';
        children.forEach((c, i) => {
          const b = document.createElement('button');
          b.textContent = c.props.Header || 'Tab';
          b.classList.toggle('active', i === num(p.SelectedIndex));
          if (this.interactive)
            b.onclick = () => {
              el.querySelectorAll('.preview-tabs button').forEach((e) =>
                e.classList.remove('active'),
              );
              b.classList.add('active');
              [...el.children].slice(1).forEach((e, j) => (e.hidden = i !== j));
            };
          tabs.append(b);
        });
        el.append(tabs);
        children.forEach((c, i) => {
          const body = this.node(c, n, templated);
          body.hidden = i !== num(p.SelectedIndex);
          el.append(body);
        });
        addChildren = false;
        break;
      }
      case 'ListBox':
      case 'ListView':
      case 'TreeView':
        s.display = 'flex';
        s.flexDirection = 'column';
        s.gap = '4px';
        break;
      case 'ListBoxItem':
      case 'ListViewItem':
      case 'TreeViewItem':
      case 'MenuItem':
        el.textContent = p.Content || p.Header || '';
        s.padding = s.padding || '8px 12px';
        break;
      case 'Menu':
      case 'ToolBar':
        s.display = 'flex';
        s.gap = '12px';
        break;
      case 'DataGrid':
        el.classList.add('preview-unknown');
        if (!children.length) el.textContent = 'DataGrid · set ItemsSource in XAML';
        break;
      default:
        if (!d) {
          el.classList.add('preview-unknown');
          const caption = document.createElement('span');
          caption.className = 'unknown-caption';
          caption.textContent = n.type;
          el.append(caption);
        }
    }
    if (
      Array.isArray(p.ItemsSource) &&
      ['ItemsControl', 'ListBox', 'ListView', 'TreeView', 'DataGrid', 'ComboBox'].includes(type)
    ) {
      el.replaceChildren();
      this.renderItems(n, el, p.ItemsSource, type);
      addChildren = false;
    }
    if (addChildren) for (const child of children) el.append(this.node(child, n, templated));
    if (
      !children.length &&
      d?.container &&
      !el.textContent &&
      !['Canvas', 'ContentPresenter'].includes(type)
    ) {
      el.classList.add('empty-container');
      s.minHeight = s.minHeight || '48px';
    }
    const templateProperty = n.children.find((c) => isProperty(c) && c.type.endsWith('.Template'));
    const templateKey = n.props.Template?.match(
      /^\{(?:StaticResource|DynamicResource)\s+([^}]+)}/,
    )?.[1];
    const template =
      templateProperty?.children.find((c) => localName(c.type) === 'ControlTemplate') ||
      (templateKey ? this.lookupResource(n, templateKey) : null) ||
      this.styleTemplate(n);
    if (template) {
      const content = visualChildren(template)[0];
      if (content) {
        el.replaceChildren(this.node(this.instantiateControlTemplate(template, n), n, p));
        s.padding = '0';
      }
    }
    applyAppearance(el, n, this.document, p);
    if (['Path', 'Line', 'Polygon', 'Polyline'].includes(type)) {
      s.background = '';
      s.borderColor = '';
    }
    if (p.Visibility === 'Collapsed' || (p.IsVisible !== undefined && !bool(p.IsVisible, true)))
      s.display = 'none';
    if (p.Visibility === 'Hidden') s.visibility = 'hidden';
    if (!this.interactive)
      el.querySelectorAll('input,select,button').forEach((c) => (c.tabIndex = -1));
    let ancestor = n;
    while (ancestor) {
      if (
        ancestor.props?.IsEnabled !== undefined &&
        !bool(this.value(ancestor.props.IsEnabled, null, ancestor), true)
      ) {
        el.querySelectorAll('input,select,button,textarea').forEach((c) => (c.disabled = true));
        if (['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(el.tagName)) el.disabled = true;
        break;
      }
      ancestor = this.parents.get(ancestor.id);
    }
    if (this.interactive) this.attachEvents(n, el, type);
    return el;
  }
  contextFor(n) {
    if (!n) return this.sampleData;
    if (this.contexts?.has(n.id)) return this.contexts.get(n.id);
    const parent = this.parents.get(n.id),
      inherited = parent ? this.contextFor(parent) : this.sampleData;
    let context = inherited;
    const design = this.designTime ? designProperties(n, this.document) : {},
      expression = design.DataContext ?? n.props?.DataContext;
    if (expression !== undefined) {
      const resolved = resolveBinding(expression, inherited, this.sampleData);
      if (resolved !== undefined) context = resolved;
    }
    this.contexts?.set(n.id, context);
    return context;
  }
  instantiate(source, item, index, owner) {
    const node = clone(source);
    walk(node, (n, parent) => {
      const original = n.sourceId || n.id;
      n.sourceId = original;
      n.instanceId = owner.id + ':' + String(item?._id ?? index) + ':' + original;
      n.id = original + '~' + owner.id + '~' + String(item?._id ?? index);
      n.rowId = item?._id || String(index);
      if (parent) this.parents.set(n.id, parent);
    });
    this.parents.set(node.id, owner);
    this.contexts.set(
      node.id,
      source.props?.DataContext !== undefined
        ? resolveBinding(source.props.DataContext, item, this.sampleData)
        : item,
    );
    return node;
  }
  instantiateControlTemplate(template, owner) {
    const tree = this.instantiate(template, this.contextFor(owner), 0, owner);
    walk(tree, (n) => this.templateOwners.set(n.id, owner.id));
    this.runtimeTemplates.push({ tree, ownerId: owner.id });
    return visualChildren(tree)[0];
  }
  renderItems(n, host, items, type) {
    const limit = items.slice(0, 500),
      template = n.children
        .find((c) => isProperty(c) && c.type.endsWith('.ItemTemplate'))
        ?.children.find((c) => localName(c.type) === 'DataTemplate'),
      visual = template && visualChildren(template)[0];
    host.classList.remove('preview-unknown');
    if (type === 'DataGrid') {
      const table = document.createElement('table');
      table.className = 'bound-data-grid';
      const columns = n.children
        .find((c) => isProperty(c) && c.type.endsWith('.Columns'))
        ?.children.filter(isElement);
      const fields = columns?.length
        ? columns.map((c) => ({ header: c.props.Header || '', binding: c.props.Binding }))
        : Object.keys(items[0] || {})
            .filter((k) => k !== '_id')
            .map((k) => ({ header: k, binding: '{Binding ' + k + '}' }));
      const thead = document.createElement('thead'),
        header = document.createElement('tr');
      for (const c of fields) {
        const th = document.createElement('th');
        th.textContent = c.header;
        header.append(th);
      }
      thead.append(header);
      table.append(thead);
      const tbody = document.createElement('tbody');
      limit.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.dataset.rowId = item?._id || String(index);
        for (const field of fields) {
          const td = document.createElement('td'),
            value = resolveBinding(field.binding, item, this.sampleData);
          td.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
          tr.append(td);
        }
        if (this.interactive)
          tr.onclick = (e) => {
            e.stopPropagation();
            this.emitPreview(n, 'SelectionChanged', item, item?._id || String(index), n.id);
          };
        tbody.append(tr);
      });
      table.append(tbody);
      host.append(table);
      return;
    }
    if (type === 'ComboBox') {
      const select = document.createElement('select');
      select.className = 'preview-input';
      select.style.width = '100%';
      select._xamoraItems = limit;
      const selectedValue = this.value(n.props.SelectedValue, null, n),
        selectedItem = this.value(n.props.SelectedItem, null, n),
        selectedIndex = this.value(n.props.SelectedIndex, null, n);
      limit.forEach((item, index) => {
        const option = document.createElement('option');
        option.value = String(
          n.props.SelectedValuePath
            ? (readPath(item, n.props.SelectedValuePath) ?? '')
            : (item?._id ?? index),
        );
        option.dataset.rowId = String(item?._id ?? index);
        option.dataset.itemIndex = String(index);
        option.selected =
          n.props.SelectedValue !== undefined
            ? String(selectedValue) === option.value
            : n.props.SelectedItem !== undefined
              ? selectedItem === item || (selectedItem?._id && selectedItem._id === item?._id)
              : Number(selectedIndex ?? 0) === index;
        option.textContent = String(
          typeof item === 'object'
            ? (item?.[n.props.DisplayMemberPath] ?? item?.Name ?? item?.Title ?? item?._id ?? index)
            : item,
        );
        select.append(option);
      });
      host.append(select);
      return;
    }
    host.style.display = 'flex';
    host.style.flexDirection = 'column';
    limit.forEach((item, index) => {
      let child;
      if (visual) {
        const instance = this.instantiate(visual, item, index, n);
        child = this.node(instance, n);
        this.instances.set(instance.instanceId, child);
        if (this.interactive)
          child.addEventListener('click', () =>
            this.emitPreview(n, 'SelectionChanged', item, item?._id || String(index), n.id),
          );
      } else {
        child = document.createElement('div');
        child.className = 'bound-list-item';
        child.textContent = String(
          typeof item === 'object'
            ? (item?.Name ?? item?.Title ?? (item == null ? '' : JSON.stringify(item)))
            : item,
        );
        child.dataset.rowId = item?._id || String(index);
        if (this.interactive)
          child.onclick = (e) => {
            e.stopPropagation();
            this.emitPreview(n, 'SelectionChanged', item, item?._id || String(index), n.id);
          };
      }
      host.append(child);
    });
  }
  emitPreview(n, event, value, rowId = n.rowId, instanceId = n.instanceId || n.id) {
    const detail = {
      viewId: this.document.id,
      id: n.sourceId || n.id,
      nodeId: n.sourceId || n.id,
      instanceId,
      runtimeNodeId: n.id,
      rowId,
      event,
      value,
      context: this.contextFor(n),
    };
    this.onEvent?.(detail);
    return detail;
  }
  attachEvents(n, el, type) {
    const provenance = this.describeContext?.(this.contextFor(n)) || {};
    this.bindingProvenance.set(n.id, provenance);
    if (
      ['Button', 'ToggleButton', 'CheckBox', 'RadioButton', 'ToggleSwitch', 'MenuItem'].includes(
        type,
      )
    )
      el.addEventListener('click', (event) => {
        if (el.disabled) return;
        this.emitPreview(
          n,
          'Click',
          type === 'ToggleButton' ? el.classList.contains('toggled') : undefined,
        );
      });
    el.addEventListener('dblclick', (event) => {
      if (event.target.closest('[data-node-id]') === el) this.emitPreview(n, 'DoubleClick');
    });
    el.addEventListener('pointerenter', () => this.emitPreview(n, 'PointerEnter'));
    el.addEventListener('pointerleave', () => this.emitPreview(n, 'PointerLeave'));
    el.addEventListener('pointerdown', () => this.emitPreview(n, 'PointerDown'));
    el.addEventListener('pointerup', () => this.emitPreview(n, 'PointerUp'));
    el.addEventListener('focusin', () => this.emitPreview(n, 'GotFocus'));
    el.addEventListener('focusout', () => this.emitPreview(n, 'LostFocus'));
    const inputs = ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
      ? [el]
      : [...el.querySelectorAll('input,select,textarea')].filter(
          (input) => input.closest('[data-node-id]') === el,
        );
    for (const input of inputs) {
      const change = () => {
        let value =
          input.type === 'checkbox' || input.type === 'radio'
            ? input.checked
            : input.type === 'number' || input.type === 'range'
              ? Number(input.value)
              : input.value;
        const property =
          type === 'CheckBox' || type === 'RadioButton' || type === 'ToggleSwitch'
            ? 'IsChecked'
            : type === 'TextBox' || type === 'PasswordBox'
              ? 'Text'
              : type === 'ComboBox'
                ? n.props.SelectedValue !== undefined
                  ? 'SelectedValue'
                  : n.props.SelectedItem !== undefined
                    ? 'SelectedItem'
                    : n.props.SelectedIndex !== undefined
                      ? 'SelectedIndex'
                      : 'SelectedValue'
                : type === 'DatePicker'
                  ? 'SelectedDate'
                  : 'Value';
        if (type === 'ComboBox') {
          if (property === 'SelectedIndex') value = input.selectedIndex;
          else if (property === 'SelectedItem') value = input._xamoraItems?.[input.selectedIndex];
        }
        if (
          this.onInput?.({
            node: n,
            property,
            value,
            context: this.contextFor(n),
            expression: n.props[property],
            viewId: this.document.id,
            rowId: n.rowId,
            ...provenance,
          }) === false
        ) {
          const previous = this.value(n.props[property], null, n);
          if (input.type === 'checkbox' || input.type === 'radio')
            input.checked = bool(previous, false);
          else input.value = previous ?? '';
          return;
        }
        this.emitPreview(n, 'Change', value);
        if (type === 'ComboBox')
          this.emitPreview(
            n,
            'SelectionChanged',
            value,
            input.selectedOptions?.[0]?.dataset.rowId || value,
          );
      };
      input.addEventListener('change', change);
      if (
        /UpdateSourceTrigger\s*=\s*PropertyChanged/.test(
          String(n.props.Text || n.props.Value || ''),
        )
      )
        input.addEventListener('input', change);
    }
  }
  contentChildren(n) {
    const children = visualChildren(n);
    for (const property of n.children || [])
      if (isProperty(property) && /\.(Content|Child|Children|Items|Header)$/.test(property.type))
        children.push(...visualChildren(property));
    return children;
  }
  appendInline(host, children, templated) {
    for (const child of children) {
      if (child.kind === 'text' || child.kind === 'cdata') {
        host.append(document.createTextNode(child.text));
        continue;
      }
      if (!isElement(child) || isProperty(child)) continue;
      const type = localName(child.type);
      if (type === 'LineBreak') {
        host.append(document.createElement('br'));
        continue;
      }
      const span = document.createElement('span');
      if (['Bold', 'Italic', 'Underline'].includes(type))
        span.style[
          type === 'Bold' ? 'fontWeight' : type === 'Italic' ? 'fontStyle' : 'textDecoration'
        ] = type === 'Bold' ? 'bold' : type === 'Italic' ? 'italic' : 'underline';
      if (child.props.Foreground)
        span.style.color = color(this.value(child.props.Foreground, templated, child));
      if (child.props.FontSize) span.style.fontSize = num(child.props.FontSize) + 'px';
      if (child.props.FontWeight) span.style.fontWeight = child.props.FontWeight.toLowerCase();
      if (child.props.Text !== undefined)
        span.textContent = this.value(child.props.Text, templated, child);
      else this.appendInline(span, child.children, templated);
      span.dataset.nodeId = child.id;
      this.elements.set(child.id, span);
      host.append(span);
    }
  }
  scopeResources(n) {
    return resourceEntries(n, this.resourceResolver);
  }
  lookupResource(node, key) {
    return findResource(this.document, node, key, this.resourceResolver);
  }
  applicableStyles(n) {
    return selectStyles(this.document, n, this.resourceResolver);
  }
  styleProperties(n) {
    return resolveStyle(this.document, n, {
      context: this.contextFor(n),
      root: this.sampleData,
      resolveSource: this.resourceResolver,
    }).properties;
  }
  styleTemplate(n) {
    for (const style of this.applicableStyles(n).reverse()) {
      const setter = style.children.find(
        (c) => localName(c.type || '') === 'Setter' && c.props.Property === 'Template',
      );
      if (setter) {
        const value = setter.children.flatMap((c) => (isProperty(c) ? c.children : [c]));
        const template = value.find((c) => localName(c.type || '') === 'ControlTemplate');
        if (template) return template;
      }
    }
    return null;
  }
  dock(parent, host, children, templated) {
    if (!children.length) return;
    let region = host;
    children.forEach((child, index) => {
      const dock = child.props['DockPanel.Dock'] || 'Left';
      const isLast = index === children.length - 1 && parent.props.LastChildFill !== 'False';
      if (isLast) {
        const e = this.node(child, parent, templated);
        e.style.flex = '1';
        region.append(e);
        return;
      }
      region.style.display = 'flex';
      region.style.flexDirection = ['Top', 'Bottom'].includes(dock) ? 'column' : 'row';
      const e = this.node(child, parent, templated);
      e.style.flexShrink = '0';
      const rest = document.createElement('div');
      rest.className = 'dock-remainder';
      rest.style.cssText = 'flex:1;min-width:0;min-height:0;display:flex';
      if (['Right', 'Bottom'].includes(dock)) region.append(rest, e);
      else region.append(e, rest);
      region = rest;
    });
  }
}
/** HTML export reuses the exact DOM renderer and removes editor-only identity. */
export function exportHTML(doc, registry, data, { resourceResolver } = {}) {
  if (doc.framework === 'HTML') return serializeHtml(doc);
  const host = document.createElement('div'),
    renderer = new PreviewRenderer(registry);
  renderer.resourceResolver = resourceResolver;
  renderer.sampleData = data || doc.metadata?.sampleData || renderer.sampleData;
  renderer.render(doc, host, { interactive: true });
  host.querySelectorAll('input').forEach((el) => {
    el.setAttribute('value', el.value);
    if (el.checked) el.setAttribute('checked', '');
    else el.removeAttribute('checked');
    if (el.disabled) el.setAttribute('disabled', '');
  });
  host.querySelectorAll('option').forEach((el) => {
    if (el.selected) el.setAttribute('selected', '');
    else el.removeAttribute('selected');
  });
  host.querySelectorAll('[data-node-id]').forEach((el) => {
    el.removeAttribute('data-node-id');
    el.removeAttribute('data-type');
    el.removeAttribute('data-source-node-id');
    el.removeAttribute('data-instance-id');
  });
  return `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${String(doc.name).replace(/[<>&"]/g, '')}</title>\n  <style>body{margin:0;font:14px system-ui;color:#292834}*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;border:0;border-radius:6px}input,select{padding:8px;border:1px solid #ddd;border-radius:4px}.preview-image{background:#eee;display:grid;place-items:center}.preview-tabs{display:flex;gap:8px}.preview-tabs button{padding:8px}.preview-tabs .active{background:#7953e8;color:white}</style>\n</head>\n<body>\n${host.innerHTML}\n<script>document.querySelectorAll('.preview-tabs').forEach(tabs=>{[...tabs.children].forEach((button,index)=>button.addEventListener('click',()=>{[...tabs.children].forEach(b=>b.classList.toggle('active',b===button));[...tabs.parentElement.children].slice(1).forEach((panel,i)=>panel.hidden=i!==index);}));});</script>\n</body>\n</html>\n`;
}
