/** Controlled property editing, independent of Studio, XAML and the document model. */
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const owners = new WeakMap();
function requireSynchronous(result, message) {
  if (typeof result?.then !== 'function') return;
  // Reject unsupported asynchronous hooks without leaving rejected promises unobserved.
  Promise.resolve(result).catch(() => {});
  throw new TypeError(message);
}
const choices = (property) =>
  (property.options || []).map((option) =>
    option !== null && typeof option === 'object'
      ? option
      : { value: option, label: String(option) },
  );

/** Safe default field markup; legacy mode preserves Studio's existing event contract. */
export function renderPropertyField(property, { legacy = false } = {}) {
  const { name, label = name, value, full = true, readOnly = false, mixed = false } = property;
  const nameText = escape(name),
    labelText = escape(label);
  const disabled = readOnly ? ' disabled' : '';
  let input;
  if (property.options) {
    input = `<select data-prop="${nameText}" aria-label="${nameText}"${disabled}>`;
    input += `<option value="${legacy ? '' : '_default'}"${value === undefined || mixed ? ' selected' : ''}>${escape(mixed ? 'Mixed' : property.placeholder || 'Default')}</option>`;
    input +=
      choices(property)
        .map(
          (option, i) =>
            `<option value="${escape(legacy ? option.value : 'o' + i)}" ${!mixed && (legacy ? String(value) === String(option.value) : Object.is(value, option.value)) ? 'selected' : ''}>${escape(option.label ?? option.value)}</option>`,
        )
        .join('') + '</select>';
  } else if (property.type === 'boolean') {
    input = `<input type="checkbox" data-prop="${nameText}" aria-label="${nameText}"${value === true && !mixed ? ' checked' : ''}${disabled}>`;
  } else {
    const type =
      property.type === 'number' ? 'number' : property.type === 'color' ? 'color' : 'text';
    input = `<input${legacy ? '' : ` type="${type}"`} data-prop="${nameText}" aria-label="${nameText}" value="${escape(mixed ? '' : value)}" placeholder="${escape(mixed ? 'Mixed' : (property.placeholder ?? '—'))}"${readOnly ? (type === 'color' ? ' disabled' : ' readonly') : ''}${property.type === 'number' ? ' step="any"' : ''}>`;
  }
  const reset =
    property.resettable === false
      ? ''
      : `<button type="button" class="reset-prop" data-reset="${nameText}" title="Reset ${nameText}" aria-label="Reset ${nameText}"${disabled}>×</button>`;
  return `<div class="prop-field ${full ? 'full' : ''}"><label title="${nameText}">${labelText}</label>${input}${reset}</div>`;
}

function normalize(properties) {
  if (!Array.isArray(properties)) throw new TypeError('Properties must be an array.');
  const names = new Set();
  return properties.map((property) => {
    if (
      !property ||
      typeof property.name !== 'string' ||
      !property.name ||
      names.has(property.name)
    )
      throw new TypeError('Property names must be nonempty and unique.');
    names.add(property.name);
    if (property.type && !['text', 'number', 'boolean', 'color'].includes(property.type))
      throw new TypeError(`Unsupported editor type for ${property.name}.`);
    if (property.options !== undefined && !Array.isArray(property.options))
      throw new TypeError(`Options must be an array for ${property.name}.`);
    const options =
      property.options &&
      choices(property).map((option) => {
        if (!['string', 'number', 'boolean'].includes(typeof option.value))
          throw new TypeError('Choice values must be scalar.');
        return Object.freeze({ ...option });
      });
    return Object.freeze({ ...property, ...(options ? { options: Object.freeze(options) } : {}) });
  });
}

export class PropertyGrid {
  constructor(
    host,
    {
      properties = [],
      onChange,
      onReset,
      fieldRenderer = renderPropertyField,
      eventMode = 'managed',
      searchable = true,
      filter = '',
    } = {},
  ) {
    if (!host?.ownerDocument) throw new TypeError('PropertyGrid requires a DOM host.');
    if (owners.has(host)) throw new Error('Dispose the existing PropertyGrid before replacing it.');
    if (!['managed', 'external'].includes(eventMode)) throw new TypeError('Invalid event mode.');
    if (typeof fieldRenderer !== 'function')
      throw new TypeError('fieldRenderer must be a function.');
    this.host = host;
    this.onChange = onChange;
    this.onReset = onReset;
    this.fieldRenderer = fieldRenderer;
    this.eventMode = eventMode;
    this.searchable = searchable;
    this.filter = String(filter);
    this.properties = normalize(properties);
    this.disposed = false;
    this.listeners = [];
    this.render();
    owners.set(host, this);
    this.listen('input', (event) => {
      if (event.target === this.search) this.setFilter(this.search.value);
    });
    if (eventMode === 'managed') {
      this.listen('change', (event) => {
        const target = event.target.closest?.('[data-prop]');
        if (!target || !this.host.contains(target)) return;
        event.stopPropagation();
        this.commit(target.dataset.prop, target);
      });
      this.listen('click', (event) => {
        const target = event.target.closest?.('[data-reset]');
        if (!target || !this.host.contains(target)) return;
        event.preventDefault();
        event.stopPropagation();
        this.reset(target.dataset.reset);
      });
    }
  }
  listen(type, handler) {
    this.host.addEventListener(type, handler);
    this.listeners.push(() => this.host.removeEventListener(type, handler));
  }
  getProperty(name) {
    return this.properties.find((property) => property.name === name);
  }
  getValue(name) {
    return this.getProperty(name)?.value;
  }
  setProperties(properties) {
    if (this.disposed) return false;
    const next = normalize(properties);
    this.render(next);
    this.properties = next;
    return true;
  }
  setValue(name, value) {
    if (!this.getProperty(name)) throw new Error(`Unknown property ${name}.`);
    return this.setProperties(
      this.properties.map((property) =>
        property.name === name ? { ...property, value, mixed: false } : property,
      ),
    );
  }
  /** Update values without rebuilding fields or losing input focus/selection. */
  updateValues(values) {
    if (this.disposed) return false;
    if (!(values instanceof Map)) throw new TypeError('Values must be a Map.');
    const current = new Map(this.properties.map((property) => [property.name, property]));
    for (const [name, value] of values) {
      if (!current.has(name)) throw new Error(`Unknown property ${name}.`);
      if (value !== undefined && !['string', 'number', 'boolean'].includes(typeof value))
        throw new TypeError('Property values must be scalar.');
    }
    const next = normalize(
      this.properties.map((property) =>
        values.has(property.name)
          ? { ...property, value: values.get(property.name), mixed: false }
          : property,
      ),
    );
    this.properties = next;
    for (const property of next)
      if (values.has(property.name)) {
        const entry = this.fields.get(property.name);
        entry.property = property;
        this.syncInput(entry);
      }
    return true;
  }
  render(properties = this.properties) {
    const doc = this.host.ownerDocument;
    const root = doc.createElement('div');
    root.className = 'property-grid-content';
    const fields = new Map(),
      headings = [];
    let previousGroup, section;
    for (const property of properties) {
      if (property.group && property.group !== previousGroup) {
        const heading = doc.createElement('div');
        heading.className = 'property-group';
        heading.textContent = property.group;
        heading.setAttribute('role', 'heading');
        heading.setAttribute('aria-level', '3');
        root.append(heading);
        section = { heading, group: property.group, fields: [] };
        headings.push(section);
      }
      if (!property.group) section = null;
      previousGroup = property.group;
      const template = doc.createElement('template');
      // A custom renderer is trusted application code; built-in values are always escaped.
      template.innerHTML = this.fieldRenderer(property);
      const field = template.content.firstElementChild;
      if (!field || template.content.children.length !== 1)
        throw new TypeError('A field renderer must return one root element.');
      const input = field.querySelector('[data-prop]');
      if (!input) throw new TypeError('A field renderer must include an input with data-prop.');
      input.dataset.prop = property.name;
      if (property.mixed && property.type === 'boolean') input.indeterminate = true;
      fields.set(property.name, { field, input, property });
      section?.fields.push(field);
      root.append(field);
    }
    const search = this.searchable ? doc.createElement('input') : null;
    if (search) {
      search.type = 'search';
      search.className = 'property-search';
      search.setAttribute('aria-label', 'Filter properties');
      search.placeholder = 'Filter properties…';
      search.value = this.filter;
    }
    const error = doc.createElement('div');
    error.className = 'property-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    this.host.replaceChildren(...(search ? [search] : []), root, error);
    this.host.classList.add('xamora-property-grid');
    this.nodes = [...this.host.children];
    this.fields = fields;
    this.headings = headings;
    this.search = search;
    this.error = error;
    this.setFilter(this.filter);
  }
  setFilter(filter) {
    if (this.disposed) return;
    this.filter = String(filter);
    if (this.search && this.search.value !== this.filter) this.search.value = this.filter;
    const needle = this.filter.toLowerCase();
    for (const { field, property } of this.fields.values())
      field.hidden = ![property.name, property.label, property.group].some((part) =>
        String(part ?? '')
          .toLowerCase()
          .includes(needle),
      );
    for (const { heading, fields } of this.headings)
      heading.hidden = !fields.some((field) => !field.hidden);
  }
  read(property, input) {
    if (property.options) {
      if (input.value === '_default') return undefined;
      const choice = property.options[Number(input.value.slice(1))];
      if (!/^o\d+$/.test(input.value) || !choice) throw new Error('Choose a listed value.');
      return choice.value;
    }
    if (property.type === 'boolean') return input.checked;
    if (property.type === 'number') {
      if (input.validity?.badInput) throw new Error('Enter a finite number.');
      if (!input.value.trim()) return undefined;
      const number = Number(input.value);
      if (!Number.isFinite(number)) throw new Error('Enter a finite number.');
      return number;
    }
    return input.value;
  }
  commit(name, input, reset = false) {
    if (this.disposed) return false;
    const property = this.getProperty(name);
    if (!property || property.readOnly || (reset && property.resettable === false)) return false;
    const previous = this.properties;
    try {
      const value = reset ? property.defaultValue : this.read(property, input);
      if (property.required && (value === undefined || value === ''))
        throw new Error('A value is required.');
      if (
        typeof value === 'number' &&
        ((property.min !== undefined && value < property.min) ||
          (property.max !== undefined && value > property.max))
      )
        throw new Error('Value is outside the allowed range.');
      const valid = property.validate?.(value, property);
      if (valid === false || typeof valid === 'string')
        throw new Error(typeof valid === 'string' ? valid : 'Invalid value.');
      requireSynchronous(valid, 'Validators must be synchronous.');
      if (!reset && !property.mixed && Object.is(value, property.value)) {
        this.clearError();
        return true;
      }
      const change = Object.freeze({
        property,
        name,
        value,
        previous: property.value,
        reset,
        grid: this,
      });
      const accepted = (reset && this.onReset ? this.onReset : this.onChange)?.(change);
      if (accepted === false || typeof accepted === 'string')
        throw new Error(typeof accepted === 'string' ? accepted : 'Change was rejected.');
      requireSynchronous(accepted, 'Commit callbacks must be synchronous.');
      // An application transaction may synchronously replace the grid or its data.
      if (this.disposed || this.properties !== previous) return true;
      this.properties = previous.map((item) =>
        item === property ? Object.freeze({ ...item, value, mixed: false }) : item,
      );
      const entry = this.fields.get(name);
      entry.property = this.getProperty(name);
      this.syncInput(entry);
      this.clearError();
      return true;
    } catch (error) {
      if (!this.disposed && this.properties === previous) {
        const entry = this.fields.get(name);
        this.syncInput(entry);
        entry.input.setAttribute('aria-invalid', 'true');
        this.error.textContent = String(error?.message ?? error);
        this.error.hidden = false;
      }
      return false;
    }
  }
  syncInput({ input, property }) {
    if (property.options) {
      const index = property.options.findIndex((option) => Object.is(option.value, property.value));
      input.value = property.mixed || index < 0 ? '_default' : 'o' + index;
    } else if (property.type === 'boolean') {
      input.checked = property.value === true && !property.mixed;
      input.indeterminate = !!property.mixed;
    } else input.value = property.mixed ? '' : (property.value ?? '');
    if (!property.mixed && input.placeholder === 'Mixed')
      input.placeholder = property.placeholder ?? '—';
  }
  clearError() {
    this.error.hidden = true;
    this.error.textContent = '';
    for (const { input } of this.fields.values()) input.removeAttribute('aria-invalid');
  }
  reset(name) {
    return this.commit(name, null, true);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const remove of this.listeners) remove();
    this.listeners.length = 0;
    for (const node of this.nodes) node.remove();
    this.host.classList.remove('xamora-property-grid');
    owners.delete(this.host);
    this.fields.clear();
    this.headings = [];
    this.onChange = this.onReset = this.fieldRenderer = null;
  }
}
