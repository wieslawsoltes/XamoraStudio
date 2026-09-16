/** Standalone browser application host built on the designer's canonical AST and renderer. */
import { PreviewRenderer } from './render.js';
import { builtins } from './registry.js';
import { parseXaml, diagnostics as xamlDiagnostics } from './xaml.js';
import { clone, find, walk, element, isElement, localName, validateDocument } from './model.js';
import { parseBinding, readPath, pathParts } from './design-data.js';
import {
  ObservableState,
  RuntimePropertyRegistry,
  RuntimePropertyStore,
  coerceProperty,
} from './runtime-properties.js';
import { AnimationPlayer, listStoryboards, activeDuration, sampleStoryboard } from './animation.js';
import { VisualStateRuntime } from './states.js';
import { captureMotion, patchMotion, restoreMotion } from './motion-render.js';

export const RUNTIME_STYLES = `.xamora-application{box-sizing:border-box;font:14px system-ui,sans-serif;color:#292834;isolation:isolate}.xamora-application *{box-sizing:border-box}.xamora-application button,.xamora-application input,.xamora-application select,.xamora-application textarea{font:inherit}.xamora-application .preview-button{cursor:pointer;border:0;border-radius:4px;padding:8px 14px}.xamora-application .preview-input{padding:6px 8px;border:1px solid #c9c9d2;border-radius:4px;min-width:0}.xamora-application :focus-visible{outline:2px solid #7953e8;outline-offset:2px}.xamora-application .preview-tabs{display:flex;gap:4px}.xamora-application .preview-tabs button{padding:8px;border:0;border-radius:4px}.xamora-application .preview-tabs .active{background:#7953e8;color:white}.xamora-application .bound-data-grid{border-collapse:collapse;width:100%}.xamora-application .bound-data-grid td,.xamora-application .bound-data-grid th{padding:6px 10px;text-align:left;border-bottom:1px solid #e4e3eb}.xamora-application .bound-list-item{padding:6px 10px}.xamora-application .preview-image{display:grid;place-items:center;background:#eee}.xamora-application [disabled]{cursor:default}.xamora-application .empty-container{outline:none}`;

const eventWith = (type, detail) => Object.assign(new Event(type), { detail });
const referenceKey = (value) =>
  String(value || '')
    .match(/^\{(?:StaticResource|DynamicResource)\s+([^}]+)\}$/)?.[1]
    ?.trim();
const mergeOverrides = (target, source) => {
  for (const [id, values] of source) target.set(id, { ...target.get(id), ...values });
  return target;
};
const writable = (object, path, value) => {
  const parts = pathParts(path);
  if (!parts.length) throw new Error('Two-way bindings require a writable property path.');
  let target = object;
  for (let index = 0; index < parts.length - 1; index++) {
    if (target?.[parts[index]] === undefined)
      target[parts[index]] = /^\d+$/.test(parts[index + 1]) ? [] : {};
    target = target?.[parts[index]];
    if (!target || typeof target !== 'object')
      throw new Error('Binding path crosses a scalar value.');
  }
  target[parts.at(-1)] = value;
};

class ApplicationRenderer extends PreviewRenderer {
  constructor(application) {
    super(application.registry);
    this.application = application;
  }
  coerceValue(value, property, node) {
    // Grid definitions use GridLength rather than FrameworkElement dimensions.
    if (
      ((localName(node.type) === 'ColumnDefinition' && property === 'Width') ||
        (localName(node.type) === 'RowDefinition' && property === 'Height')) &&
      /\*$/.test(String(value))
    )
      return value;
    const metadata = this.application.propertyRegistry.get(node.type, property);
    if (!metadata) return value;
    try {
      return coerceProperty(value, metadata);
    } catch (error) {
      this.application.report(
        'error',
        'property-value',
        `${node.type}.${property}: ${error.message}`,
        node.id,
      );
      return metadata.defaultValue;
    }
  }
  contextFor(node) {
    if (!node) return this.sampleData;
    if (this.contexts?.has(node.id)) return this.contexts.get(node.id);
    const parent = this.parents.get(node.id),
      inherited = parent ? this.contextFor(parent) : this.sampleData;
    const context =
      node.props?.DataContext !== undefined
        ? this.application.resolveBinding(node.props.DataContext, node, inherited)
        : inherited;
    this.contexts?.set(node.id, context);
    return context;
  }
  value(value, templated, node) {
    const binding = parseBinding(value),
      app = this.application;
    if (binding) {
      const key = node?.id + ':' + value;
      if (binding.options.Mode === 'OneTime' && app.oneTime.has(key)) return app.oneTime.get(key);
      const result = app.resolveBinding(value, node, this.contextFor(node), templated);
      if (binding.options.Mode === 'OneTime') app.oneTime.set(key, result);
      return result;
    }
    if (referenceKey(value)) {
      const resource = this.lookupResource(node, referenceKey(value));
      if (resource)
        return (
          resource.props?.Color ??
          resource.props?.Value ??
          resource.children
            ?.filter((child) => ['text', 'cdata'].includes(child.kind))
            .map((child) => child.text)
            .join('') ??
          value
        );
      app.report(
        'warning',
        'resource-not-found',
        `Resource ${referenceKey(value)} was not found.`,
        node?.id,
      );
      return undefined;
    }
    if (value === '{x:Null}') return null;
    if (typeof value === 'string' && value.startsWith('{}')) return value.slice(2);
    return super.value(value, templated, node);
  }
  node(node, parent, templated) {
    if (!isElement(node)) return super.node(node, parent, templated);
    const app = this.application;
    const properties = app.properties.entries(node.id),
      defaults = {},
      styled = this.styleProperties(node);
    const parentNode = this.parents.get(node.id),
      parentValues = parentNode && this.effectiveProperties.get(parentNode.id);
    for (const [property, metadata] of app.propertyRegistry.list(node.type)) {
      if (Object.hasOwn(styled, property)) continue;
      if (metadata.inherits && parentValues?.[property] !== undefined)
        defaults[property] = parentValues[property];
      else if (metadata.defaultValue !== undefined) defaults[property] = metadata.defaultValue;
    }
    if (Object.keys(properties).length || Object.keys(defaults).length)
      node = { ...node, props: { ...defaults, ...node.props, ...properties } };
    const result = super.node(node, parent, templated);
    if (result.nodeType !== 1) return result;
    const effective = this.effectiveProperties.get(node.id) || node.props;
    const name =
      effective['AutomationProperties.Name'] || effective['AutomationProperties.LabeledBy'];
    if (name) result.setAttribute('aria-label', String(name));
    if (effective.TabIndex !== undefined) result.tabIndex = Number(effective.TabIndex);
    if (effective['x:Name'] || effective.Name)
      result.dataset.runtimeName = effective['x:Name'] || effective.Name;
    if (effective.ToolTip) result.title = String(effective.ToolTip);
    result.classList.remove('empty-container');
    const descriptor = this.registry.get(node.type, node.namespaceURI);
    if (typeof descriptor?.mount === 'function')
      app.controlMounts.push({ descriptor, node, element: result, properties: effective });
    const command = node.props.Command;
    if (command !== undefined) {
      const name = parseBinding(command)
        ? app.resolveBinding(command, node, this.contextFor(node))
        : command;
      const registered = app.commands.get(String(name));
      if (!registered)
        app.report(
          'warning',
          'command-not-registered',
          `Command ${String(name)} is not registered.`,
          node.id,
        );
      const parameter = this.value(node.props.CommandParameter, templated, node);
      if (registered?.canExecute && !app.canExecute(registered, parameter, node)) {
        if ('disabled' in result) result.disabled = true;
        result.setAttribute('aria-disabled', 'true');
      }
    }
    return result;
  }
  renderItems(node, host, items, type) {
    if (items.length > 500)
      this.application.report(
        'warning',
        'items-limit',
        `${type} displays the first 500 items. Use a custom virtualizing control for larger collections.`,
        node.id,
      );
    return super.renderItems(node, host, items, type);
  }
}

/** An application never loads code from XAML: handlers, converters and controls are explicit registrations. */
export class XamlApplication extends EventTarget {
  constructor(options = {}) {
    super();
    this.options = options;
    this.registry = options.registry || builtins();
    this.propertyRegistry = options.propertyRegistry || new RuntimePropertyRegistry();
    this.properties = new RuntimePropertyStore(this.propertyRegistry);
    this.state =
      options.data instanceof ObservableState
        ? options.data
        : new ObservableState(options.data || {});
    this.commands = new Map(Object.entries(options.commands || {}));
    this.events = new Map(Object.entries(options.events || {}));
    this.converters = new Map(Object.entries(options.converters || {}));
    this.resources = new Map(Object.entries(options.resources || {}));
    this.dictionaries = new Map();
    this.theme = this.parseDictionary(options.theme);
    this.diagnostics = [];
    this.diagnosticKeys = new Set();
    this.oneTime = new Map();
    this.bindingStack = new Set();
    this.pendingBindings = new Map();
    this.controlMounts = [];
    this.controlDisposers = [];
    this.pluginDisposers = [];
    this.players = new Set();
    this.queued = false;
    this.disposed = false;
    this.clockStarted = 0;
    this.stateFrame = null;
    this.loadGeneration = 0;
    this.dictionaryGenerations = new Map();
    this.source = options.source || '';
    this.document = options.document
      ? validateDocument(clone(options.document))
      : this.source
        ? parseXaml(this.source, { name: options.name || 'App.xaml', framework: options.framework })
        : null;
    this.renderer = this.createRenderer();
    this.unsubscribe = this.state.subscribe(() => this.invalidate());
    this.propertyChanged = () => this.invalidate();
    this.properties.addEventListener('change', this.propertyChanged);
    this.registryChanged = () => this.invalidate();
    this.registry.addEventListener('change', this.registryChanged);
    for (const plugin of options.plugins || []) this.use(plugin);
  }
  get data() {
    return this.state.data;
  }
  createRenderer() {
    const renderer = new ApplicationRenderer(this);
    renderer.resourceResolver = (source) =>
      this.dictionaries.get(source) || this.options.resourceResolver?.(source);
    renderer.onInput = (detail) => this.acceptInput(detail);
    renderer.onEvent = (detail) => this.handleEvent(detail);
    return renderer;
  }
  assertAlive() {
    if (this.disposed) throw new Error('The application has been disposed.');
  }
  emit(type, detail) {
    this.dispatchEvent(eventWith(type, detail));
  }
  report(severity, code, message, nodeId) {
    const key = code + ':' + nodeId + ':' + message;
    if (this.diagnosticKeys.has(key)) return;
    this.diagnosticKeys.add(key);
    const diagnostic = { severity, code, message, ...(nodeId ? { nodeId } : {}) };
    this.diagnostics.push(diagnostic);
    this.emit('diagnostic', diagnostic);
    this.options.onDiagnostic?.(diagnostic);
  }
  parseDictionary(value) {
    if (!value) return null;
    const root =
      typeof value === 'string'
        ? parseXaml(value, { name: 'Resources.xaml' }).root
        : value.root || value;
    if (localName(root.type) !== 'ResourceDictionary')
      throw new Error('A theme must be a ResourceDictionary.');
    return clone(root);
  }
  resourceNode(key, value) {
    if (value?.kind === 'element') {
      const node = clone(value);
      node.props['x:Key'] = key;
      return node;
    }
    if (!['string', 'number', 'boolean'].includes(typeof value))
      throw new TypeError('Resources must be primitive values or AST elements.');
    const type =
      typeof value === 'number' ? 'Double' : typeof value === 'boolean' ? 'Boolean' : 'String';
    return element(type, { 'x:Key': key, Value: String(value) }, []);
  }
  runtimeDocument() {
    const doc = clone(this.document);
    if (this.theme || this.resources.size) {
      let property = doc.root.children.find((child) => /\.Resources$/.test(child.type || ''));
      if (!property) {
        property = element(localName(doc.root.type) + '.Resources');
        doc.root.children.unshift(property);
      }
      const dictionary = property.children.find(
        (child) => localName(child.type) === 'ResourceDictionary',
      );
      const container = dictionary || property;
      if (this.theme) container.children.unshift(...clone(this.theme.children));
      // Application values are fallbacks; a view's local resources take precedence.
      container.children.unshift(
        ...[...this.resources].map(([key, value]) => this.resourceNode(key, value)),
      );
    }
    return doc;
  }
  mount(host) {
    this.assertAlive();
    if (!host?.ownerDocument || typeof host.replaceChildren !== 'function')
      throw new TypeError('mount() requires a DOM element or shadow root.');
    if (!this.document) throw new Error('Provide source or a document before mounting.');
    if (this.host) this.unmount();
    this.host = host;
    const owner = host.ownerDocument;
    this.surface = owner.createElement('div');
    this.surface.className = 'xamora-application';
    this.surface.style.minHeight = '0';
    const style = owner.createElement('style');
    style.textContent = RUNTIME_STYLES;
    style.dataset.xamoraRuntime = '';
    host.replaceChildren(style, this.surface);
    this.refresh();
    this.emit('mounted', { host });
    return this;
  }
  unmount() {
    if (!this.host) return;
    for (const [id] of this.renderer.elements)
      this.invokeEvent(this.renderer.effectiveNodes?.get(id), 'Unloaded', { nodeId: id });
    this.stopAnimations();
    this.disposeControls();
    this.renderer.htmlRenderer?.dispose();
    this.renderer.elements.clear();
    this.renderer.effectiveNodes?.clear();
    this.renderer.effectiveProperties?.clear();
    this.oneTime.clear();
    this.pendingBindings.clear();
    this.host.replaceChildren();
    this.host = null;
    this.surface = null;
    this.emit('unmounted', {});
  }
  invalidate() {
    if (this.disposed || this.queued || !this.host) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (!this.disposed && this.host)
        try {
          this.refresh();
        } catch (error) {
          this.report('error', 'render-failed', error.message);
        }
    });
  }
  refresh() {
    this.assertAlive();
    if (!this.host) return this;
    this.queued = false;
    let focused = this.host.getRootNode?.().activeElement || this.host.ownerDocument.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    focused = this.host.activeElement || focused;
    const focusedId = focused?.closest?.('[data-node-id]')?.dataset.nodeId;
    const selection =
      focused && typeof focused.selectionStart === 'number'
        ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection]
        : null;
    const previousRenderer = this.renderer,
      previousDocument = this.renderDocument;
    const known = new Set(previousRenderer.elements.keys());
    const previousMounts = this.controlMounts;
    this.controlMounts = [];
    this.diagnostics = [];
    this.diagnosticKeys.clear();
    const staging = this.host.ownerDocument.createElement('div');
    try {
      this.renderDocument = this.runtimeDocument();
      this.renderer = this.createRenderer();
      this.renderer.sampleData = this.data;
      for (const diagnostic of xamlDiagnostics(this.renderDocument, this.registry))
        this.report(diagnostic.severity, 'xaml-validation', diagnostic.message, diagnostic.id);
      if (['WinUI', 'MAUI'].includes(this.document.framework))
        this.report(
          'warning',
          'framework-adapter',
          `${this.document.framework} uses the shared web control subset. Register adapters for platform-specific controls.`,
        );
      this.renderer.render(this.renderDocument, staging, { interactive: true, designTime: false });
    } catch (error) {
      this.renderer.htmlRenderer?.dispose();
      this.renderer = previousRenderer;
      this.renderDocument = previousDocument;
      this.controlMounts = previousMounts;
      throw error;
    }
    for (const id of known)
      if (!this.renderer.elements.has(id))
        this.invokeEvent(previousRenderer.effectiveNodes?.get(id), 'Unloaded', { nodeId: id });
    const mounts = this.controlMounts;
    this.disposeControls();
    this.controlMounts = mounts;
    previousRenderer.htmlRenderer?.dispose();
    this.surface.replaceChildren(...staging.childNodes);
    this.motionBaseline = captureMotion(this.renderer);
    if (this.visualStates) {
      this.visualStates.doc = this.renderDocument;
      this.visualStates.baseDocument = this.renderDocument;
    }
    for (const mount of this.controlMounts) {
      try {
        const dispose = mount.descriptor.mount({
          ...mount,
          application: this,
          data: this.renderer.contextFor(mount.node),
        });
        if (typeof dispose === 'function') this.controlDisposers.push(dispose);
      } catch (error) {
        this.report('error', 'control-mount', error.message, mount.node.id);
      }
    }
    this.controlMounts = [];
    this.applyMotion();
    if (focusedId) {
      const element = this.renderer.elements.get(focusedId);
      const input = element?.matches?.('input,textarea,select,button')
        ? element
        : element?.querySelector('input,textarea,select,button');
      if (input && !input.disabled) {
        input.focus({ preventScroll: true });
        if (selection && input.setSelectionRange)
          try {
            input.setSelectionRange(...selection);
          } catch {}
      }
    }
    for (const [id] of this.renderer.elements)
      if (!known.has(id))
        this.invokeEvent(this.renderer.effectiveNodes?.get(id), 'Loaded', { nodeId: id });
    this.emit('rendered', { document: this.document, diagnostics: this.diagnostics });
    return this;
  }
  disposeControls() {
    for (const dispose of this.controlDisposers.splice(0))
      try {
        dispose();
      } catch (error) {
        this.report('error', 'control-dispose', error.message);
      }
    this.controlMounts = [];
  }
  updateSource(source, options = {}) {
    this.assertAlive();
    try {
      const document = parseXaml(source, {
        name: options.name || this.document?.name || this.options.name || 'App.xaml',
        framework: options.framework || this.options.framework,
      });
      this.updateDocument(document);
      this.source = source;
      return { valid: true, diagnostics: this.diagnostics };
    } catch (error) {
      this.report('error', 'source-invalid', error.message);
      return {
        valid: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'source-invalid',
            message: error.message,
            line: error.line,
            column: error.column,
          },
        ],
      };
    }
  }
  updateDocument(document) {
    this.assertAlive();
    const next = validateDocument(clone(document)),
      previous = this.document;
    this.document = next;
    this.oneTime.clear();
    this.pendingBindings.clear();
    try {
      if (this.host) this.refresh();
    } catch (error) {
      this.document = previous;
      throw error;
    }
    this.stopAnimations();
    this.properties.reset();
    return this;
  }
  async load(url, options = {}) {
    this.assertAlive();
    const generation = ++this.loadGeneration;
    const response = await (options.fetch || this.options.fetch || globalThis.fetch)(url, {
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}`);
    const source = await response.text();
    this.assertAlive();
    if (generation !== this.loadGeneration) return this;
    const result = this.updateSource(source, options);
    if (!result.valid) throw new Error(result.diagnostics[0].message);
    return this;
  }
  setData(path, value) {
    this.assertAlive();
    return this.state.set(path, value);
  }
  setResource(key, value) {
    this.assertAlive();
    if (!key || typeof key !== 'string') throw new Error('A resource key is required.');
    if (value === undefined) this.resources.delete(key);
    else {
      this.resourceNode(key, value);
      this.resources.set(key, value);
    }
    this.invalidate();
    return this;
  }
  setTheme(dictionary) {
    this.assertAlive();
    this.theme = this.parseDictionary(dictionary);
    this.invalidate();
    return this;
  }
  registerDictionary(source, dictionary) {
    this.assertAlive();
    const root = this.parseDictionary(dictionary);
    this.dictionaries.set(source, root);
    this.invalidate();
    return () => {
      if (this.dictionaries.get(source) === root) {
        this.dictionaries.delete(source);
        this.invalidate();
      }
    };
  }
  async loadDictionary(
    url,
    { signal, fetch: fetcher = this.options.fetch || globalThis.fetch } = {},
  ) {
    this.assertAlive();
    const generation = (this.dictionaryGenerations.get(url) || 0) + 1;
    this.dictionaryGenerations.set(url, generation);
    const response = await fetcher(url, { signal });
    if (!response.ok) throw new Error(`Could not load dictionary ${url}: HTTP ${response.status}`);
    const source = await response.text();
    this.assertAlive();
    if (this.dictionaryGenerations.get(url) !== generation) return () => {};
    return this.registerDictionary(url, source);
  }
  findNode(nameOrId) {
    const direct =
      this.renderer.effectiveNodes?.get(nameOrId) ||
      (this.document && find(this.document.root, nameOrId));
    if (direct) return direct;
    const candidates = [...(this.renderer.effectiveNodes?.values() || [])];
    const rendered = candidates.find(
      (node) => (node.props['x:Name'] || node.props.Name) === nameOrId,
    );
    if (rendered) return rendered;
    const search = (node) => {
      if (
        !isElement(node) ||
        ['ControlTemplate', 'DataTemplate', 'ResourceDictionary'].includes(localName(node.type))
      )
        return null;
      if ((node.props['x:Name'] || node.props.Name) === nameOrId) return node;
      for (const child of node.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    };
    return this.document ? search(this.document.root) : null;
  }
  findBindingNode(name, node) {
    // Instantiated template names resolve inside their instance before the view.
    if (node?.id.includes('~')) {
      let scope = node,
        parent = this.renderer.parents.get(scope.id);
      while (parent?.id.includes('~')) {
        scope = parent;
        parent = this.renderer.parents.get(scope.id);
      }
      let match;
      walk(scope, (candidate) => {
        if (!match && (candidate.props?.['x:Name'] || candidate.props?.Name) === name)
          match = candidate;
      });
      if (match) return this.renderer.effectiveNodes.get(match.id) || match;
    }
    return this.findNode(name);
  }
  findName(name) {
    const node = this.findNode(name);
    return node ? this.renderer.elements.get(node.id) || null : null;
  }
  getValue(nameOrId, property) {
    const node = this.findNode(nameOrId);
    if (!node) throw new Error(`Control ${nameOrId} was not found.`);
    const explicit = this.properties.entries(node.id);
    if (Object.hasOwn(explicit, property)) return explicit[property];
    const value =
      this.renderer.effectiveProperties?.get(node.id)?.[property] ?? node.props[property];
    return value === undefined
      ? this.properties.get(node.id, node.type, property)
      : this.renderer.value(value, null, node);
  }
  setValue(nameOrId, property, value) {
    this.assertAlive();
    const node = this.findNode(nameOrId);
    if (!node) throw new Error(`Control ${nameOrId} was not found.`);
    return this.properties.set(node.id, node.type, property, value);
  }
  clearValue(nameOrId, property) {
    const node = this.findNode(nameOrId);
    return node ? this.properties.clear(node.id, property) : false;
  }
  bindingContext(binding, node, context) {
    const { options, path } = binding;
    if (path.startsWith('$root.')) return { object: this.data, path: path.slice(6) };
    if (options.ElementName) {
      const target = this.findBindingNode(options.ElementName, node);
      return {
        node: target,
        object: target ? this.renderer.effectiveProperties?.get(target.id) || target.props : null,
        path,
      };
    }
    if (options.RelativeSource) {
      if (/Self/.test(options.RelativeSource))
        return {
          node,
          object: this.renderer.effectiveProperties?.get(node.id) || node.props,
          path,
        };
      if (/TemplatedParent/.test(options.RelativeSource)) {
        const target = this.findNode(this.renderer.templateOwners?.get(node.id));
        return {
          node: target,
          object: target ? this.renderer.effectiveProperties?.get(target.id) || target.props : null,
          path,
        };
      }
      this.report(
        'warning',
        'binding-relative-source',
        'Only Self and TemplatedParent RelativeSource are supported by the browser runtime.',
        node?.id,
      );
    }
    if (options.Source) {
      const key = referenceKey(options.Source);
      if (key && this.resources.has(key)) return { object: this.resources.get(key), path };
      this.report(
        'warning',
        'binding-source',
        'Binding Source requires a registered resource.',
        node?.id,
      );
      return { object: null, path };
    }
    return { object: context, path };
  }
  converter(binding, node) {
    const name = referenceKey(binding.options.Converter) || binding.options.Converter;
    if (!name) return null;
    const converter = this.converters.get(name);
    if (!converter)
      this.report(
        'warning',
        'converter-not-registered',
        `Converter ${name} is not registered.`,
        node?.id,
      );
    return converter;
  }
  resolveBinding(expression, node, context = this.data) {
    const binding = parseBinding(expression);
    if (!binding) return expression;
    const stackKey = node?.id + ':' + expression;
    if (this.bindingStack.has(stackKey)) {
      this.report('error', 'binding-cycle', 'A binding refers back to itself.', node?.id);
      return binding.options.FallbackValue ?? '';
    }
    this.bindingStack.add(stackKey);
    try {
      if (binding.options.Mode === 'OneWayToSource')
        return this.propertyRegistry.get(localName(node?.type), 'Text')?.defaultValue ?? '';
      const target = this.bindingContext(binding, node, context);
      let value = target.path ? readPath(target.object, target.path) : target.object;
      if (target.node && typeof value === 'string' && value.startsWith('{'))
        value = this.renderer.value(value, null, target.node);
      const converter = this.converter(binding, node);
      if (converter)
        value = (typeof converter === 'function' ? converter : converter.convert)?.(
          value,
          binding.options.ConverterParameter,
          this,
        );
      if (value === undefined) {
        if (binding.options.FallbackValue !== undefined) value = binding.options.FallbackValue;
        else {
          this.report(
            'warning',
            'binding-unresolved',
            `Binding ${binding.path || '(context)'} could not be resolved.`,
            node?.id,
          );
          value = '';
        }
      }
      if (value === null && binding.options.TargetNullValue !== undefined)
        value = binding.options.TargetNullValue;
      if (binding.options.StringFormat && value !== undefined)
        value = binding.options.StringFormat.replace(/^\{\}|^['"]|['"]$/g, '').replace(
          /\{0(?::[^}]+)?}/g,
          String(value),
        );
      return value;
    } catch (error) {
      this.report('error', 'binding-evaluation', error.message, node?.id);
      return binding.options.FallbackValue ?? '';
    } finally {
      this.bindingStack.delete(stackKey);
    }
  }
  acceptInput(detail, explicit = false) {
    const { node, property, value, context, expression } = detail;
    const binding = parseBinding(expression);
    try {
      if (!binding) {
        this.properties.set(node.id, node.type, property, value);
        return true;
      }
      const mode =
        binding.options.Mode ||
        this.propertyRegistry.get(node.type, property)?.defaultBindingMode ||
        'OneWay';
      if (!['TwoWay', 'OneWayToSource'].includes(mode)) return false;
      if (!explicit && binding.options.UpdateSourceTrigger === 'Explicit') {
        this.pendingBindings.set(node.id + ':' + property, detail);
        return true;
      }
      const target = this.bindingContext(binding, node, context),
        converter = this.converter(binding, node);
      let next = value;
      if (converter) {
        if (typeof converter.convertBack !== 'function') {
          this.report(
            'error',
            'converter-not-reversible',
            'Two-way converter requires convertBack().',
            node.id,
          );
          return false;
        }
        next = converter.convertBack(value, binding.options.ConverterParameter, this);
      }
      if (target.node) this.properties.set(target.node.id, target.node.type, target.path, next);
      else writable(target.object, target.path, next);
      this.pendingBindings.delete(node.id + ':' + property);
      this.invalidate();
      return true;
    } catch (error) {
      this.report('error', 'binding-write', error.message, node.id);
      return false;
    }
  }
  updateSourceBinding(nameOrId, property) {
    const node = this.findNode(nameOrId),
      pending = node && this.pendingBindings.get(node.id + ':' + property);
    return pending ? this.acceptInput(pending, true) : false;
  }
  registerCommand(name, command) {
    if (!name || !(typeof command === 'function' || typeof command?.execute === 'function'))
      throw new TypeError('A named command requires execute().');
    this.commands.set(name, command);
    this.invalidate();
    return () => {
      this.commands.delete(name);
      this.invalidate();
    };
  }
  registerEvent(name, handler) {
    if (typeof handler !== 'function') throw new TypeError('An event handler must be a function.');
    this.events.set(name, handler);
    return () => this.events.delete(name);
  }
  registerConverter(name, converter) {
    if (!(typeof converter === 'function' || typeof converter?.convert === 'function'))
      throw new TypeError('A converter requires convert().');
    this.converters.set(name, converter);
    this.invalidate();
    return () => {
      this.converters.delete(name);
      this.invalidate();
    };
  }
  canExecute(command, parameter, node) {
    try {
      return !command.canExecute || Boolean(command.canExecute(parameter, this.eventContext(node)));
    } catch (error) {
      this.report('error', 'command-can-execute', error.message, node?.id);
      return false;
    }
  }
  eventContext(node, detail = {}) {
    return {
      application: this,
      data: this.data,
      context: this.renderer.contextFor(node),
      node,
      element: node && this.renderer.elements.get(node.id),
      ...detail,
    };
  }
  invokeEvent(node, name, detail) {
    const handlerName = node?.props?.[name];
    if (!handlerName) return;
    const handler = this.events.get(handlerName);
    if (!handler) {
      this.report(
        'warning',
        'event-not-registered',
        `Event handler ${handlerName} is not registered.`,
        node.id,
      );
      return;
    }
    this.invoke(
      () => handler(this.eventContext(node, { ...detail, event: name })),
      'event-handler',
      node.id,
    );
  }
  invoke(action, code, nodeId) {
    try {
      const result = action();
      if (result?.then) result.catch((error) => this.report('error', code, error.message, nodeId));
    } catch (error) {
      this.report('error', code, error.message, nodeId);
    }
  }
  handleEvent(detail) {
    const node =
      this.renderer.effectiveNodes.get(detail.runtimeNodeId) || this.findNode(detail.nodeId);
    if (!node) return;
    this.invokeEvent(node, detail.event, detail);
    const aliases = {
      PointerEnter: ['MouseEnter'],
      PointerLeave: ['MouseLeave'],
      PointerDown: ['PointerPressed'],
      PointerUp: ['PointerReleased'],
      Change: ['TextBox', 'PasswordBox'].includes(localName(node.type))
        ? ['TextChanged']
        : ['CheckBox', 'RadioButton', 'ToggleSwitch'].includes(localName(node.type))
          ? [detail.value ? 'Checked' : 'Unchecked']
          : [],
    };
    for (const name of aliases[detail.event] || []) this.invokeEvent(node, name, detail);
    if (detail.event === 'Click' && node.props.Command !== undefined) {
      const name = this.renderer.value(node.props.Command, null, node),
        command = this.commands.get(String(name));
      const parameter = this.renderer.value(node.props.CommandParameter, null, node);
      if (command && this.canExecute(command, parameter, node))
        this.invoke(
          () =>
            (typeof command === 'function' ? command : command.execute)(
              parameter,
              this.eventContext(node, detail),
            ),
          'command-execution',
          node.id,
        );
    }
    this.emit('interaction', this.eventContext(node, detail));
  }
  use(plugin) {
    this.assertAlive();
    const setup = typeof plugin === 'function' ? plugin : plugin?.setup;
    if (typeof setup !== 'function')
      throw new TypeError('An application plugin requires setup(application).');
    const cleanup = setup(this);
    if (typeof cleanup === 'function') this.pluginDisposers.push(cleanup);
    return this;
  }
  playStoryboard(nameOrId, options = {}) {
    this.assertAlive();
    if (!this.host) throw new Error('Mount the application before playing animations.');
    const story = listStoryboards(this.renderDocument).find(
      (value) => value.id === nameOrId || value.name === nameOrId,
    );
    if (!story) throw new Error(`Storyboard ${nameOrId} was not found.`);
    const player = new AnimationPlayer({
      duration: activeDuration(story.node),
      rate: options.rate ?? 1,
      loop: options.loop ?? false,
      ...options,
    });
    player.storyboard = story.node;
    player.addEventListener('frame', () => this.applyMotion());
    const release = () => {
      player.pause();
      this.players.delete(player);
      this.applyMotion();
    };
    player.dispose = release;
    this.players.add(player);
    if (options.autoplay !== false) player.play();
    return player;
  }
  goToState(group, state, { transitions = true } = {}) {
    this.assertAlive();
    if (!this.host) throw new Error('Mount the application before changing visual states.');
    if (!this.visualStates) {
      this.visualStates = new VisualStateRuntime(this.renderDocument);
      this.clockStarted = performance.now();
    }
    const entry = this.visualStates.go(
      group,
      state,
      (performance.now() - this.clockStarted) / 1000,
      transitions,
    );
    const tick = () => {
      this.stateFrame = null;
      if (!this.host || this.disposed || !this.visualStates) return;
      this.applyMotion();
      const elapsed = (performance.now() - this.clockStarted) / 1000;
      const running = [...this.visualStates.active.values()].some((active) => {
        const story = active.state.children
          .flatMap((child) => (/\.Storyboard$/.test(child.type || '') ? child.children : [child]))
          .find((child) => localName(child.type) === 'Storyboard');
        return elapsed < active.start + active.duration + (story ? activeDuration(story) : 0);
      });
      if (running) this.stateFrame = requestAnimationFrame(tick);
    };
    if (this.stateFrame === null) tick();
    return entry;
  }
  applyMotion() {
    if (!this.renderDocument || !this.motionBaseline) return;
    if (!this.players.size && !this.visualStates) {
      restoreMotion(this.renderer, this.motionBaseline, { inputs: false });
      return;
    }
    const overrides = new Map();
    if (this.visualStates)
      mergeOverrides(
        overrides,
        this.visualStates.sample((performance.now() - this.clockStarted) / 1000),
      );
    for (const player of this.players) {
      const sample = sampleStoryboard(this.renderDocument, player.storyboard, player.time);
      mergeOverrides(overrides, sample.overrides);
      for (const message of sample.warnings) this.report('warning', 'animation-sample', message);
    }
    patchMotion(this.renderer, this.renderDocument, overrides, this.motionBaseline);
  }
  stopAnimations() {
    for (const player of this.players) player.pause();
    this.players.clear();
    if (this.stateFrame !== null) cancelAnimationFrame(this.stateFrame);
    this.stateFrame = null;
    this.visualStates = null;
    if (this.motionBaseline) restoreMotion(this.renderer, this.motionBaseline);
  }
  dispose() {
    if (this.disposed) return;
    this.unmount();
    this.disposed = true;
    this.unsubscribe();
    this.properties.removeEventListener('change', this.propertyChanged);
    this.registry.removeEventListener('change', this.registryChanged);
    for (const dispose of this.pluginDisposers.splice(0).reverse())
      this.invoke(dispose, 'plugin-dispose');
    this.pendingBindings.clear();
    this.oneTime.clear();
    this.emit('disposed', {});
  }
}

export function createApplication(options = {}) {
  return new XamlApplication(options);
}
export function mountXaml(host, source, options = {}) {
  return createApplication({ ...options, source }).mount(host);
}
