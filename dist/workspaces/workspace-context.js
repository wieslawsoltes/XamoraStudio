/** Scoped browser services and reversible host integration for document-aware components. */
const patches = new WeakMap();
const owners = new WeakMap();
export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const field = (name, label, value = '', type = 'text') =>
  `<label>${esc(label)}<input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}"></label>`;
export const select = (name, label, options, value = '') =>
  `<label>${esc(label)}<select name="${esc(name)}">${options
    .map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`;
    })
    .join('')}</select></label>`;

/** Isolated in-memory storage is the default. Persistence is an application decision. */
export function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => {
      values.set(String(key), String(value));
    },
    removeItem: (key) => {
      values.delete(String(key));
    },
  };
}

export class WorkspaceContext {
  constructor(options = {}) {
    const { root, dialogRoot = null } = options;
    if (!root?.querySelector || !(root.ownerDocument || root.documentElement))
      throw new TypeError('A workspace root Element or Document is required.');
    this.root = root;
    this.document = root.ownerDocument || root;
    this.window = this.document.defaultView;
    if (!this.window) throw new TypeError('The workspace document needs a browser window.');
    if (dialogRoot && dialogRoot.ownerDocument !== this.document)
      throw new TypeError('Dialog and workspace roots must share a document.');
    this.options = {
      ...options,
      root,
      dialogRoot,
      api: options.api || {},
      storage: options.storage || createMemoryStorage(),
    };
    this.dialogRoot = dialogRoot;
    this.api = this.options.api;
    this.storage = this.options.storage;
    this.disposed = false;
    this.cleanups = [];
    this.listeners = new Set();
    this.handlers = new Set();
    this.handlerStates = new WeakMap();
    this.nodes = new Set();
    this.finalizer = new FinalizationRegistry((ref) => this.nodes.delete(ref));
    this.frames = new Set();
    this.timers = new Set();
  }
  query(selector, root) {
    if (root) return root.querySelector(selector);
    const mapped = this.options.elements?.[selector];
    if (mapped) return typeof mapped === 'function' ? mapped() : mapped;
    return (
      this.root.querySelector(selector) ||
      this.dialogRoot?.querySelector(selector) ||
      this.options.domScope?.query(selector) ||
      null
    );
  }
  all(selector, root) {
    if (root) return [...root.querySelectorAll(selector)];
    return [
      ...new Set([
        ...this.root.querySelectorAll(selector),
        ...(this.dialogRoot?.querySelectorAll(selector) || []),
        ...(this.options.domScope?.all(selector) || []),
      ]),
    ];
  }
  get activeElement() {
    return this.options.domScope?.activeElement || this.document.activeElement;
  }
  notify(message) {
    if (this.disposed) return;
    if (this.options.notify) return this.options.notify(String(message));
    this.root.dispatchEvent(
      new this.window.CustomEvent('workspace-notification', {
        detail: String(message),
        bubbles: true,
      }),
    );
  }
  saveFile(name, content, mime = 'application/json') {
    if (this.disposed) return;
    if (this.options.saveFile) return this.options.saveFile(name, content, mime);
    const url = this.window.URL.createObjectURL(new this.window.Blob([content], { type: mime }));
    const a = this.document.createElement('a');
    a.download = name;
    a.href = url;
    a.click();
    // URL cleanup must still run after component disposal.
    this.window.setTimeout(() => this.window.URL.revokeObjectURL(url), 1000);
  }
  add(cleanup) {
    if (typeof cleanup !== 'function') throw new TypeError('Cleanup must be a function.');
    if (this.disposed) {
      cleanup();
      return cleanup;
    }
    this.cleanups.push(cleanup);
    return cleanup;
  }
  own(value) {
    this.add(() => (value?.dispose ? value.dispose() : value?.remove?.()));
    return value;
  }
  /** Track library-created markup without retaining old, detached render trees. */
  track(node) {
    if (this.disposed) {
      node.remove();
      return node;
    }
    const ref = new WeakRef(node);
    this.nodes.add(ref);
    this.finalizer.register(node, ref, ref);
    return node;
  }
  override(target, key, value) {
    if (this.disposed) throw new Error('The workspace component is disposed.');
    let entries = patches.get(target);
    if (!entries) patches.set(target, (entries = new Map()));
    let state = entries.get(key);
    if (!state || target[key] !== state.current) {
      state = {
        original: Object.getOwnPropertyDescriptor(target, key),
        inherited: target[key],
        stack: [],
        current: target[key],
      };
      entries.set(key, state);
    }
    const previous = target[key],
      record = { active: true, installed: value };
    if (typeof value === 'function')
      record.installed = function (...args) {
        return record.active
          ? value.apply(this, args)
          : typeof previous === 'function'
            ? previous.apply(this, args)
            : undefined;
      };
    target[key] = record.installed;
    state.current = record.installed;
    state.stack.push(record);
    this.add(() => {
      record.active = false;
      if (entries.get(key) !== state || target[key] !== state.current) return;
      const top = state.stack.findLast((item) => item.active);
      if (top) target[key] = state.current = top.installed;
      else {
        if (state.original) Object.defineProperty(target, key, state.original);
        else delete target[key];
        entries.delete(key);
      }
    });
    return value;
  }
  listen(target, type, callback, options) {
    if (!target || this.disposed) return () => {};
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    for (const entry of this.listeners)
      if (
        entry.target === target &&
        entry.type === type &&
        entry.callback === callback &&
        entry.capture === capture
      )
        return entry.remove;
    const entry = { target, type, callback, capture };
    entry.remove = () => {
      if (entry.routed) entry.routed();
      else target.removeEventListener(type, entry.listener, capture);
      this.listeners.delete(entry);
    };
    entry.listener = (event) => {
      if (options?.once) entry.remove();
      if (this.disposed) return;
      if (
        /^(keydown|keyup|keypress)$/.test(type) &&
        (target === this.document || target === this.window) &&
        this.root !== this.document &&
        !this.root.contains(event.target) &&
        !this.dialogRoot?.contains(event.target) &&
        !this.options.domScope?.owns(event.target)
      )
        return;
      return typeof callback === 'function'
        ? callback.call(target, event)
        : callback.handleEvent(event);
    };
    this.listeners.add(entry);
    if (this.options.domScope && (target === this.document || target === this.window))
      entry.routed = this.options.domScope.listen(target, type, entry.listener, options);
    else target.addEventListener(type, entry.listener, options);
    return entry.remove;
  }
  unlisten(target, type, callback, options) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    for (const entry of this.listeners)
      if (
        entry.target === target &&
        entry.type === type &&
        entry.callback === callback &&
        entry.capture === capture
      )
        entry.remove();
  }
  handler(target, key, callback) {
    if (!target || this.disposed) return callback;
    let states = this.handlerStates.get(target);
    if (!states) {
      this.handlerStates.set(target, (states = new Map()));
      this.handlers.add(new WeakRef(target));
    }
    const old = states.get(key);
    const original = old && target[key] === old.listener ? old.original : target[key];
    const context = this;
    const listener = function (...args) {
      if (!context.disposed) return callback?.apply(this, args);
    };
    target[key] = listener;
    // Originals remain alive while their target does, but detached render trees are not retained.
    states.set(key, { original, listener });
    return callback;
  }
  frame(callback) {
    if (this.disposed) return 0;
    const schedule =
      this.options.scheduleFrame || this.window.requestAnimationFrame.bind(this.window);
    const id = schedule((time) => {
      this.frames.delete(id);
      if (!this.disposed) callback(time);
    });
    this.frames.add(id);
    return id;
  }
  cancelFrame(id) {
    (this.options.cancelFrame || this.window.cancelAnimationFrame.bind(this.window))(id);
    this.frames.delete(id);
  }
  timeout(callback, duration) {
    if (this.disposed) return 0;
    const id = this.window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) callback();
    }, duration);
    this.timers.add(id);
    return id;
  }
  clearTimeout(id) {
    this.window.clearTimeout(id);
    this.timers.delete(id);
  }
  stylesheet(name) {
    const href = this.options.styles?.[name];
    if (!href) return;
    const link = this.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    this.document.head.append(link);
    this.own(link);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const errors = [];
    const run = (fn) => {
      try {
        fn();
      } catch (error) {
        errors.push(error);
      }
    };
    for (const entry of this.listeners) run(entry.remove);
    for (const id of this.frames) run(() => this.cancelFrame(id));
    for (const id of this.timers) this.window.clearTimeout(id);
    for (const ref of this.handlers) {
      const node = ref.deref();
      if (!node) continue;
      for (const [key, { original, listener }] of this.handlerStates.get(node) || [])
        run(() => {
          if (node[key] === listener) node[key] = original;
        });
      this.handlerStates.delete(node);
    }
    this.handlers.clear();
    for (const cleanup of this.cleanups.reverse()) run(cleanup);
    for (const ref of this.nodes) {
      this.finalizer.unregister(ref);
      run(() => ref.deref()?.remove());
    }
    this.nodes.clear();
    this.cleanups.length = 0;
    this.listeners.clear();
    this.frames.clear();
    this.timers.clear();
    if (errors.length) throw new AggregateError(errors, 'Workspace cleanup failed.');
  }
}
export class WorkspaceComponent {
  constructor(options) {
    this.environment = new WorkspaceContext(options);
    const root = this.environment.root;
    let owned = owners.get(root);
    if (!owned) owners.set(root, (owned = new Map()));
    if (owned.has(this.constructor)) {
      this.environment.dispose();
      throw new Error('This root already owns a ' + this.constructor.name + '.');
    }
    owned.set(this.constructor, this);
    this.environment.add(() => {
      if (owned.get(this.constructor) === this) owned.delete(this.constructor);
    });
  }
  get disposed() {
    return this.environment.disposed;
  }
  dispose() {
    this.environment.dispose();
  }
}
