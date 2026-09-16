/** Automatic nested data editing composed from the same controlled scalar PropertyGrid. */
import { PropertyGrid } from './property-grid.js';
import {
  inspectObjectProperties,
  editObjectProperty,
  cloneObjectGraph,
  getObjectProperty,
  objectPathKey,
  objectValueKind,
} from './object-properties.js';
const owners = new WeakMap();
const defaults = {
  string: '',
  number: 0,
  boolean: false,
  null: null,
  undefined: undefined,
  object: {},
  array: [],
};
const pathLabel = (path) =>
  path.length ? path.map((key) => (/^\d+$/.test(key) ? `[${key}]` : key)).join('.') : 'Value';
const scalarValue = (node) => node.note || (node.kind === 'null' ? '(null)' : node.value);
export class ObjectPropertyGrid {
  constructor(host, options = {}) {
    if (!host?.ownerDocument) throw new TypeError('ObjectPropertyGrid requires a DOM host.');
    if (owners.has(host)) throw new Error('Dispose the existing ObjectPropertyGrid first.');
    this.host = host;
    this.options = { ...options };
    this.value = options.value;
    this.defaultValue = cloneObjectGraph(
      'defaultValue' in options ? options.defaultValue : options.value,
      options,
    );
    this.onChange = options.onChange;
    this.filter = String(options.filter || '');
    this.expanded = new Map();
    this.disposed = false;
    this.revision = 0;
    this.render();
    owners.set(host, this);
  }
  describe(value = this.value) {
    return inspectObjectProperties(value, this.options);
  }
  render() {
    if (this.disposed) return;
    const generation = (this.generation = (this.generation || 0) + 1);
    const active = () => !this.disposed && this.generation === generation;
    const tree = this.describe();
    const document = this.host.ownerDocument;
    const oldFocus = this.host.contains(document.activeElement)
      ? document.activeElement?.dataset.prop
      : null;
    this.releaseHandlers();
    this.grid?.dispose();
    this.host.replaceChildren();
    this.host.classList.add('xamora-object-property-grid');
    this.tree = tree;
    this.entries = new Map();
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.value = this.filter;
    this.search.setAttribute('aria-label', 'Filter nested properties');
    this.search.placeholder = 'Filter nested properties…';
    this.search.oninput = () => active() && this.setFilter(this.search.value);
    this.fieldsHost = document.createElement('div');
    this.fieldsHost.className = 'object-fields';
    this.host.append(this.search, this.fieldsHost);
    const properties = [];
    const collect = (node) => {
      this.entries.set(node.key, { node });
      if (['object', 'array'].includes(node.kind) && !node.note) node.children.forEach(collect);
      else
        properties.push({
          name: node.key,
          label: pathLabel(node.path),
          value: scalarValue(node),
          type:
            node.kind === 'number' && !node.note
              ? 'number'
              : node.kind === 'boolean'
                ? 'boolean'
                : 'text',
          readOnly: node.readOnly || ['null', 'undefined'].includes(node.kind),
          resettable: false,
        });
    };
    collect(tree);
    this.grid = new PropertyGrid(this.fieldsHost, {
      searchable: false,
      properties,
      onChange: (change) => {
        const node = this.entries.get(change.name).node;
        return this.change(node.path, change.value, 'set');
      },
    });
    const content = this.fieldsHost.querySelector('.property-grid-content');
    const button = (text, label, run) => {
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = text;
      control.setAttribute('aria-label', label);
      control.onclick = () => active() && run();
      return control;
    };
    const build = (node, depth = 0) => {
      const entry = this.entries.get(node.key),
        row = document.createElement('section');
      entry.element = row;
      row.dataset.objectPath = node.key;
      row.style.setProperty('--object-depth', depth);
      const header = document.createElement('div');
      header.className = 'object-row';
      row.append(header);
      const composite = ['object', 'array'].includes(node.kind) && !node.note;
      if (node.truncated) {
        const warning = document.createElement('span');
        warning.textContent = 'Property limit reached';
        header.append(warning);
      }
      if (composite) {
        const opened = this.expanded.get(node.key) ?? depth < (this.options.expandedDepth ?? 1);
        this.expanded.set(node.key, opened);
        entry.toggle = button(
          pathLabel(node.path) + (node.kind === 'array' ? ` [${node.value.length}]` : ' {}'),
          'Expand ' + pathLabel(node.path),
          () => this.setExpanded(node.path, !this.expanded.get(node.key)),
        );
        header.append(entry.toggle);
        entry.children = document.createElement('div');
        entry.children.className = 'object-children';
        row.append(entry.children);
        node.children.forEach((child) => entry.children.append(build(child, depth + 1)));
        if (
          !node.readOnly &&
          this.options.allowStructureChanges !== false &&
          Object.isExtensible(node.value)
        ) {
          header.append(
            button('+', 'Add property to ' + pathLabel(node.path), () => {
              if (node.kind === 'array')
                this.addProperty(
                  node.path,
                  String(getObjectProperty(this.value, node.path).length),
                  '',
                );
              else this.addForm(node, header);
            }),
          );
        }
      } else {
        const field = this.grid.fields.get(node.key).field;
        field.querySelector('[data-prop]').setAttribute('aria-label', pathLabel(node.path));
        header.append(field);
      }
      if (!node.readOnly && this.options.allowTypeChanges !== false) {
        const type = document.createElement('select');
        type.setAttribute('aria-label', 'Type of ' + pathLabel(node.path));
        for (const kind of Object.keys(defaults)) {
          const option = document.createElement('option');
          option.value = kind;
          option.textContent = kind;
          type.append(option);
        }
        type.value = node.kind;
        type.onchange = () => {
          if (!active()) return;
          if (!this.setProperty(node.path, defaults[type.value])) type.value = node.kind;
        };
        header.append(type);
      }
      if (!node.readOnly) {
        header.append(button('↶', 'Reset ' + pathLabel(node.path), () => this.reset(node.path)));
        if (node.path.length && this.options.allowStructureChanges !== false)
          header.append(
            button('×', 'Remove ' + pathLabel(node.path), () => this.removeProperty(node.path)),
          );
      }
      return row;
    };
    content.replaceChildren(build(tree));
    this.setFilter(this.filter);
    this.grid.fields.get(oldFocus)?.input.focus();
  }
  addForm(node, header) {
    if (this.disposed || !this.host.contains(header) || header.querySelector('form')) return;
    const generation = this.generation;
    const document = this.host.ownerDocument,
      form = document.createElement('form'),
      input = document.createElement('input'),
      submit = document.createElement('button');
    input.setAttribute('aria-label', 'New property name');
    input.required = true;
    submit.type = 'submit';
    submit.textContent = 'Add';
    form.append(input, submit);
    form.onsubmit = (event) => {
      event.preventDefault();
      if (this.disposed || generation !== this.generation) return;
      if (this.addProperty(node.path, input.value, '')) form.remove();
    };
    header.append(form);
    input.focus();
  }
  setExpanded(path, expanded) {
    if (this.disposed) return false;
    const key = objectPathKey(path),
      entry = this.entries.get(key);
    if (!entry?.children) return false;
    this.expanded.set(key, !!expanded);
    this.setFilter(this.filter);
    return true;
  }
  setFilter(filter) {
    if (this.disposed) return;
    this.filter = String(filter);
    this.search.value = this.filter;
    const needle = this.filter.toLowerCase();
    const apply = (node, inherited = false) => {
      const entry = this.entries.get(node.key);
      const matches = !needle || inherited || pathLabel(node.path).toLowerCase().includes(needle);
      let descendant = false;
      for (const child of node.children)
        descendant = apply(child, !!needle && matches) || descendant;
      entry.element.hidden = !matches && !descendant;
      if (entry.children) {
        const expanded = !!needle || this.expanded.get(node.key);
        entry.children.hidden = !expanded;
        entry.toggle.setAttribute('aria-expanded', String(expanded));
      }
      return matches || descendant;
    };
    apply(this.tree);
  }
  showError(error) {
    if (this.disposed) return;
    this.grid.error.hidden = false;
    this.grid.error.textContent = String(error?.message ?? error);
  }
  setValue(value) {
    if (this.disposed) return false;
    // Validate before replacing the current editor state.
    this.describe(value);
    this.value = value;
    this.revision++;
    this.render();
    return true;
  }
  change(path, value, operation, reset = false) {
    if (this.disposed) return false;
    const key = objectPathKey(path),
      node = this.entries.get(key)?.node;
    if (this.options.readOnly || (node?.readOnly && operation !== 'add'))
      throw new TypeError('The property is read-only.');
    if (operation !== 'add' && !node)
      throw new TypeError('The property is outside the inspected tree.');
    const previous = this.value,
      revision = this.revision;
    const next = editObjectProperty(previous, path, value, {
      operation,
      maxNodes: this.options.maxNodes,
    });
    this.describe(next);
    const event = Object.freeze({
      path: Object.freeze([...path]),
      operation,
      reset,
      value,
      previous,
      next,
      grid: this,
    });
    const result = this.onChange?.(event);
    if (typeof result?.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new TypeError('Object commit callbacks must be synchronous.');
    }
    if (result === false || typeof result === 'string')
      throw new Error(typeof result === 'string' ? result : 'Change was rejected.');
    if (this.disposed || revision !== this.revision) return true;
    this.value = next;
    this.revision++;
    if (
      operation === 'set' &&
      objectValueKind(value) === node.kind &&
      !['object', 'array'].includes(node.kind)
    ) {
      this.tree = this.describe();
      const changes = new Map();
      const update = (item) => {
        this.entries.get(item.key).node = item;
        if (!item.children.length && this.grid.fields.has(item.key))
          changes.set(item.key, scalarValue(item));
        item.children.forEach(update);
      };
      update(this.tree);
      this.grid.updateValues(changes);
      this.grid.clearError();
    } else this.render();
    this.host.dispatchEvent(
      new this.host.ownerDocument.defaultView.CustomEvent('object-property-change', {
        bubbles: true,
        detail: event,
      }),
    );
    return true;
  }
  setProperty(path, value) {
    try {
      return this.change(path, value, 'set');
    } catch (error) {
      this.showError(error);
      return false;
    }
  }
  addProperty(path, name, value) {
    try {
      if (this.options.allowStructureChanges === false)
        throw new TypeError('Structure editing is disabled.');
      const parent = this.entries.get(objectPathKey(path))?.node;
      if (!parent || parent.readOnly || !['object', 'array'].includes(parent.kind))
        throw new TypeError('The parent is not editable.');
      if (typeof name !== 'string' || !name) throw new TypeError('A property name is required.');
      return this.change([...path, name], value, 'add');
    } catch (error) {
      this.showError(error);
      return false;
    }
  }
  removeProperty(path) {
    try {
      if (this.options.allowStructureChanges === false)
        throw new TypeError('Structure editing is disabled.');
      return this.change(path, undefined, 'remove');
    } catch (error) {
      this.showError(error);
      return false;
    }
  }
  reset(path) {
    try {
      return this.change(path, getObjectProperty(this.defaultValue, path), 'set', true);
    } catch (error) {
      this.showError(error);
      return false;
    }
  }
  releaseHandlers() {
    for (const node of this.host.querySelectorAll('*')) {
      node.onclick = node.onchange = node.onsubmit = node.oninput = null;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.grid.dispose();
    this.search.oninput = null;
    // Release handlers even when a caller retains detached nodes.
    this.releaseHandlers();
    this.host.replaceChildren();
    this.host.classList.remove('xamora-object-property-grid');
    owners.delete(this.host);
    this.entries.clear();
    this.onChange = null;
    this.value = this.defaultValue = null;
  }
}
