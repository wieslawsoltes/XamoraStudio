/** Observable application state and typed property metadata. No DOM dependency. */
import { pathParts, readPath } from './design-data.js';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const plain = (value) =>
  value !== null &&
  typeof value === 'object' &&
  (Array.isArray(value) ||
    Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);
const eventWith = (type, detail) => Object.assign(new Event(type), { detail });

/** Nested objects/arrays are observed; external raw objects must be changed through data or set(). */
export class ObservableState extends EventTarget {
  constructor(value = {}) {
    super();
    if (!plain(value)) throw new TypeError('Application data must be a plain object or array.');
    this.revision = 0;
    this.pending = new Set();
    this.depth = 0;
    this.scheduled = false;
    this.proxies = new WeakMap();
    this.targets = new WeakMap();
    this.data = this.wrap(value, '');
  }
  wrap(value, path) {
    if (!plain(value)) return value;
    if (this.targets.has(value)) return value;
    if (this.proxies.has(value)) return this.proxies.get(value);
    const proxy = new Proxy(value, {
      get: (target, key, receiver) =>
        this.wrap(
          Reflect.get(target, key, receiver),
          typeof key === 'string' ? (path ? path + '.' : '') + key : path,
        ),
      set: (target, key, next) => {
        if (forbidden.has(key)) throw new Error('Unsafe application data key.');
        next = this.targets.get(next) || next;
        const previous = target[key],
          existed = Object.hasOwn(target, key);
        const ok = Reflect.set(target, key, next);
        if (ok && (!existed || !Object.is(previous, next)))
          this.changed(path ? path + '.' + String(key) : String(key));
        return ok;
      },
      deleteProperty: (target, key) => {
        if (forbidden.has(key)) throw new Error('Unsafe application data key.');
        const existed = Object.hasOwn(target, key),
          ok = Reflect.deleteProperty(target, key);
        if (ok && existed) this.changed(path ? path + '.' + String(key) : String(key));
        return ok;
      },
      defineProperty: (target, key, descriptor) => {
        if (forbidden.has(key) || !Object.hasOwn(descriptor, 'value'))
          throw new Error('Observable data supports safe value properties.');
        const ok = Reflect.defineProperty(target, key, descriptor);
        if (ok) this.changed(path ? path + '.' + String(key) : String(key));
        return ok;
      },
      setPrototypeOf: () => {
        throw new Error('Observable data prototypes cannot be changed.');
      },
    });
    this.proxies.set(value, proxy);
    this.targets.set(proxy, value);
    return proxy;
  }
  changed(path) {
    this.pending.add(path);
    // The same object may be aliased or moved within an array. The empty path is
    // a conservative root invalidation; dotted paths are additional change hints.
    if (path.includes('.')) this.pending.add('');
    if (!this.depth && !this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        this.flush();
      });
    }
  }
  get(path = '') {
    return path ? readPath(this.data, path) : this.data;
  }
  set(path, value) {
    const parts = pathParts(path);
    if (!parts.length) throw new Error('Choose a writable data path.');
    let target = this.data;
    for (let index = 0; index < parts.length - 1; index++) {
      const key = parts[index];
      if (target[key] === undefined) target[key] = /^\d+$/.test(parts[index + 1]) ? [] : {};
      if (!plain(target[key])) throw new Error('Data path crosses a scalar value.');
      target = target[key];
    }
    target[parts.at(-1)] = value;
    return value;
  }
  batch(action) {
    this.depth++;
    try {
      return action(this.data);
    } finally {
      this.depth--;
      if (!this.depth) this.flush();
    }
  }
  flush() {
    if (this.depth || !this.pending.size) return;
    const paths = [...this.pending];
    this.pending.clear();
    this.revision++;
    this.dispatchEvent(eventWith('change', { paths, revision: this.revision }));
  }
  subscribe(listener) {
    const handler = (event) => listener(event.detail, this.data);
    this.addEventListener('change', handler);
    return () => this.removeEventListener('change', handler);
  }
  snapshot() {
    const seen = new WeakMap();
    const copy = (value) => {
      value = this.targets.get(value) || value;
      if (!plain(value)) return value instanceof Date ? new Date(value) : value;
      if (seen.has(value)) return seen.get(value);
      const out = Array.isArray(value) ? [] : {};
      seen.set(value, out);
      for (const key of Object.keys(value))
        Object.defineProperty(out, key, {
          value: copy(value[key]),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      return out;
    };
    return copy(this.data);
  }
}

export const observable = (value) => new ObservableState(value);

export const PROPERTY_PRECEDENCE = Object.freeze([
  'animation',
  'local',
  'binding',
  'trigger',
  'style',
  'inherited',
  'default',
]);

export function coerceProperty(value, metadata = {}) {
  if (value == null && metadata.nullable !== false) return value;
  if (metadata.coerce) value = metadata.coerce(value);
  else if (metadata.type === 'number') {
    if (value === 'Auto' && metadata.allowAuto) return value;
    if (
      typeof value === 'boolean' ||
      String(value).trim() === '' ||
      !Number.isFinite(Number(value))
    )
      throw new TypeError('Expected a finite number.');
    value = Number(value);
    if (
      (metadata.minimum !== undefined && value < metadata.minimum) ||
      (metadata.maximum !== undefined && value > metadata.maximum)
    )
      throw new RangeError('Property value is outside its allowed range.');
  } else if (metadata.type === 'boolean') {
    if (value === true || /^true$/i.test(String(value))) value = true;
    else if (value === false || /^false$/i.test(String(value))) value = false;
    else throw new TypeError('Expected True or False.');
  } else if (metadata.type === 'string') value = String(value);
  if (metadata.values && !metadata.values.includes(value))
    throw new RangeError('Property value must be one of: ' + metadata.values.join(', '));
  if (metadata.validate && !metadata.validate(value))
    throw new TypeError('Property validation failed.');
  return value;
}

/** Metadata is shared by application code and extension controls; registration is reversible. */
export class RuntimePropertyRegistry {
  constructor({ builtins = true } = {}) {
    this.types = new Map();
    if (builtins) {
      for (const property of ['Width', 'Height', 'MinWidth', 'MinHeight', 'MaxWidth', 'MaxHeight'])
        this.register('*', property, { type: 'number', minimum: 0, allowAuto: true });
      for (const property of [
        'Opacity',
        'Value',
        'Minimum',
        'Maximum',
        'FontSize',
        'Canvas.Left',
        'Canvas.Top',
        'Canvas.Right',
        'Canvas.Bottom',
        'Panel.ZIndex',
        'SelectedIndex',
      ])
        this.register('*', property, {
          type: 'number',
          ...(property === 'Opacity' ? { minimum: 0, maximum: 1, defaultValue: 1 } : {}),
        });
      for (const property of ['IsEnabled', 'IsVisible', 'IsReadOnly', 'IsChecked'])
        this.register('*', property, {
          type: 'boolean',
          defaultValue: ['IsEnabled', 'IsVisible'].includes(property),
        });
      for (const property of ['Foreground', 'FontFamily', 'FontSize', 'FontWeight'])
        this.register('*', property, { ...this.get('*', property), inherits: true });
      for (const [type, property] of [
        ['TextBox', 'Text'],
        ['PasswordBox', 'Text'],
        ['CheckBox', 'IsChecked'],
        ['RadioButton', 'IsChecked'],
        ['ToggleButton', 'IsChecked'],
        ['ToggleSwitch', 'IsChecked'],
        ['Slider', 'Value'],
        ['NumericUpDown', 'Value'],
        ['ComboBox', 'SelectedIndex'],
        ['ComboBox', 'SelectedValue'],
        ['ComboBox', 'SelectedItem'],
        ['DatePicker', 'SelectedDate'],
      ])
        this.register(type, property, { ...this.get('*', property), defaultBindingMode: 'TwoWay' });
    }
  }
  register(type, property, metadata) {
    if (!type || !property || forbidden.has(property))
      throw new Error('A safe control type and property name are required.');
    let properties = this.types.get(type);
    if (!properties) this.types.set(type, (properties = new Map()));
    const previous = properties.get(property),
      value = Object.freeze({ ...metadata });
    properties.set(property, value);
    return () => {
      if (properties.get(property) === value) {
        if (previous) properties.set(property, previous);
        else properties.delete(property);
      }
    };
  }
  get(type, property) {
    return (
      this.types.get(type)?.get(property) ||
      this.types.get(String(type).split(':').at(-1))?.get(property) ||
      this.types.get('*')?.get(property)
    );
  }
  list(type) {
    return new Map([
      ...(this.types.get('*') || []),
      ...(this.types.get(String(type).split(':').at(-1)) || []),
      ...(this.types.get(type) || []),
    ]);
  }
}

export class RuntimePropertyStore extends EventTarget {
  constructor(registry = new RuntimePropertyRegistry()) {
    super();
    this.registry = registry;
    this.values = new Map();
  }
  set(nodeId, type, property, value, source = 'local') {
    if (!PROPERTY_PRECEDENCE.includes(source))
      throw new Error('Unknown property precedence source.');
    value = coerceProperty(value, this.registry.get(type, property));
    let properties = this.values.get(nodeId);
    if (!properties) this.values.set(nodeId, (properties = new Map()));
    let sources = properties.get(property);
    if (!sources) properties.set(property, (sources = new Map()));
    const previous = sources.get(source);
    if (sources.has(source) && Object.is(previous, value)) return value;
    sources.set(source, value);
    this.dispatchEvent(eventWith('change', { nodeId, type, property, source, value }));
    return value;
  }
  get(nodeId, type, property, inherited) {
    const sources = this.values.get(nodeId)?.get(property);
    for (const source of PROPERTY_PRECEDENCE) if (sources?.has(source)) return sources.get(source);
    const metadata = this.registry.get(type, property);
    return metadata?.inherits && inherited !== undefined ? inherited : metadata?.defaultValue;
  }
  entries(nodeId) {
    const result = {};
    for (const [property, sources] of this.values.get(nodeId) || []) {
      for (const source of PROPERTY_PRECEDENCE)
        if (sources.has(source)) {
          result[property] = sources.get(source);
          break;
        }
    }
    return result;
  }
  clear(nodeId, property, source = 'local') {
    const properties = this.values.get(nodeId),
      sources = properties?.get(property);
    if (!sources?.delete(source)) return false;
    if (!sources.size) properties.delete(property);
    if (!properties.size) this.values.delete(nodeId);
    this.dispatchEvent(eventWith('change', { nodeId, property, source, cleared: true }));
    return true;
  }
  reset() {
    this.values.clear();
    this.dispatchEvent(eventWith('change', { reset: true }));
  }
}
