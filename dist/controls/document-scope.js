/** Explicit event/query routing across caller-owned same-origin documents. No DOM monkey patches. */
export class DocumentScope {
  constructor(document, workspace = null) {
    if (!document?.defaultView) throw new TypeError('A browser document is required.');
    this.document = document;
    this.window = document.defaultView;
    this.workspace = workspace;
    this.documents = new Map();
    this.listeners = new Set();
    this.frames = new Map();
    this.nextFrame = 0;
    this.disposed = false;
    this.focusedDocument = document;
    this.add(document, { root: document, workspace });
  }
  add(document, { root = document, workspace = root } = {}) {
    if (this.disposed) throw new Error('DocumentScope is disposed.');
    if (!document?.defaultView || (root !== document && root.ownerDocument !== document))
      throw new TypeError('The portal root must belong to its document.');
    if (this.documents.has(document)) throw new Error('Document is already registered.');
    const entry = { document, window: document.defaultView, root, workspace };
    const focus = () => {
      this.focusedDocument = document;
    };
    const remove = () => {
      // A caller may keep an old disposer after re-registering the same document.
      if (this.documents.get(document) !== entry) return;
      this.documents.delete(document);
      for (const [id, item] of this.frames)
        if (item.view === entry.window) {
          item.view.cancelAnimationFrame(item.nativeId);
          if (this.disposed || entry.window === this.window) this.frames.delete(id);
          else {
            item.view = this.window;
            this.scheduleFrame(id, item);
          }
        }
      document.removeEventListener('focusin', focus, true);
      document.removeEventListener('pointerdown', focus, true);
      for (const listener of this.listeners) this.detach(listener, entry);
      if (this.focusedDocument === document) this.focusedDocument = this.document;
    };
    entry.remove = remove;
    this.documents.set(document, entry);
    try {
      document.addEventListener('focusin', focus, true);
      document.addEventListener('pointerdown', focus, true);
      for (const listener of this.listeners) this.attach(listener, entry);
    } catch (error) {
      remove();
      throw error;
    }
    return remove;
  }
  target(kind, entry) {
    return kind === 'document'
      ? entry.document
      : kind === 'window'
        ? entry.window
        : entry.workspace;
  }
  attach(listener, entry) {
    const target = this.target(listener.kind, entry);
    if (target && !listener.targets.has(target)) {
      target.addEventListener(listener.type, listener.run, listener.options);
      listener.targets.add(target);
    }
  }
  detach(listener, entry) {
    const target = this.target(listener.kind, entry);
    if (listener.targets.delete(target))
      target.removeEventListener(listener.type, listener.run, listener.options.capture);
  }
  listen(target, type, callback, options = {}) {
    if (this.disposed || !target) return () => {};
    const kind =
      target === this.document
        ? 'document'
        : target === this.window
          ? 'window'
          : target === this.workspace
            ? 'workspace'
            : null;
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    for (const item of this.listeners)
      if (
        item.target === target &&
        item.type === type &&
        item.callback === callback &&
        item.options.capture === capture
      )
        return item.remove;
    const signal = typeof options === 'object' ? options?.signal : null;
    if (signal?.aborted) return () => {};
    const item = {
      target,
      type,
      callback,
      kind,
      targets: new Set(),
      options: { capture, passive: !!options?.passive },
    };
    const remove = () => {
      if (!this.listeners.delete(item)) return;
      for (const target of item.targets) target.removeEventListener(type, item.run, capture);
      item.targets.clear();
      signal?.removeEventListener('abort', remove);
    };
    item.remove = remove;
    item.run = function (event) {
      if (options?.once) remove();
      return typeof callback === 'function'
        ? callback.call(this, event)
        : callback.handleEvent(event);
    };
    this.listeners.add(item);
    try {
      if (kind) for (const entry of this.documents.values()) this.attach(item, entry);
      else {
        target.addEventListener(type, item.run, item.options);
        item.targets.add(target);
      }
      signal?.addEventListener('abort', remove, { once: true });
    } catch (error) {
      remove();
      throw error;
    }
    return remove;
  }
  unlisten(target, type, callback, options = {}) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    for (const item of this.listeners)
      if (
        item.target === target &&
        item.type === type &&
        item.callback === callback &&
        item.options.capture === capture
      )
        item.remove();
  }
  query(selector) {
    for (const { root } of this.documents.values()) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  all(selector) {
    return [
      ...new Set(
        [...this.documents.values()].flatMap(({ root }) => [...root.querySelectorAll(selector)]),
      ),
    ];
  }
  owns(target) {
    return [...this.documents.values()].some(({ root }) => root.contains(target));
  }
  get activeElement() {
    const doc = [...this.documents.keys()].find((doc) => doc.hasFocus?.()) || this.focusedDocument;
    return doc?.activeElement || this.document.activeElement;
  }
  scheduleFrame(id, item) {
    item.nativeId = item.view.requestAnimationFrame((time) => {
      if (!this.frames.delete(id) || this.disposed) return;
      item.callback(time);
    });
  }
  frame(callback) {
    if (this.disposed) return 0;
    const view = this.activeElement?.ownerDocument?.defaultView || this.window;
    const id = ++this.nextFrame,
      item = { view, callback, nativeId: null };
    this.frames.set(id, item);
    this.scheduleFrame(id, item);
    return id;
  }
  cancelFrame(id) {
    const item = this.frames.get(id);
    if (item) {
      item.view.cancelAnimationFrame(item.nativeId);
      this.frames.delete(id);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.frames.keys()) this.cancelFrame(id);
    for (const item of [...this.listeners]) item.remove();
    for (const entry of [...this.documents.values()]) entry.remove();
  }
}
