/** Framework-neutral, loss-aware document tree. No DOM or framework dependency. */
import {
  createHistoryPatch,
  applyHistoryPatch,
  estimateHistoryBytes,
  validateHistoryValue,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_HISTORY_BYTE_LIMIT,
} from './history.js';
export const VERSION = 1;
let sequence = 0;
export const uid = () => `n${Date.now().toString(36)}${(++sequence).toString(36)}`;
export const clone = (value) => structuredClone(value);
export const localName = (type) => (type || '').split(':').pop();
export const isElement = (n) => n?.kind === 'element';
export const isProperty = (n) => isElement(n) && localName(n.type).includes('.');
export const element = (type, props = {}, children = []) => ({
  id: uid(),
  kind: 'element',
  type,
  props: { ...props },
  children,
});
export const textNode = (text) => ({ id: uid(), kind: 'text', text });
export function walk(node, visit, parent = null) {
  visit(node, parent);
  for (const c of node.children || []) walk(c, visit, node);
}
export function find(root, id) {
  if (root.id === id) return root;
  for (const c of root.children || []) {
    const found = find(c, id);
    if (found) return found;
  }
  return null;
}
export function parentOf(root, id) {
  for (const c of root.children || []) {
    if (c.id === id) return root;
    const p = parentOf(c, id);
    if (p) return p;
  }
  return null;
}
export function descendants(node) {
  const ids = [];
  walk(node, (n) => ids.push(n.id));
  return ids;
}
export function visualChildren(node) {
  return (node?.children || []).filter(
    (n) =>
      isElement(n) &&
      !isProperty(n) &&
      ![
        'Style',
        'Setter',
        'ControlTheme',
        'ResourceDictionary',
        'ControlTemplate',
        'DataTemplate',
        'RowDefinition',
        'ColumnDefinition',
        'Storyboard',
        'ParallelTimeline',
        'Animation',
        'KeyFrame',
        'VisualStateGroup',
        'VisualState',
        'VisualTransition',
        'Trigger',
        'MultiTrigger',
        'DataTrigger',
        'MultiDataTrigger',
        'EventTrigger',
        'BeginStoryboard',
        'SolidColorBrush',
        'LinearGradientBrush',
        'RadialGradientBrush',
        'GradientStop',
        'TransformGroup',
        'ScaleTransform',
        'RotateTransform',
        'TranslateTransform',
        'SkewTransform',
        'MatrixTransform',
        'DropShadowEffect',
        'BlurEffect',
      ].includes(localName(n.type)),
  );
}
export function label(node) {
  return (
    node?.props?.id ||
    node?.props?.['x:Name'] ||
    node?.props?.Name ||
    node?.props?.['x:Key'] ||
    localName(node?.type || '')
  );
}
export function reidentify(node) {
  const n = clone(node);
  walk(n, (c) => (c.id = uid()));
  return n;
}
export function createDocument(root, framework = 'WPF', name = 'MainView.xaml') {
  return {
    version: VERSION,
    id: uid(),
    name,
    framework,
    root,
    annotations: [],
    design: { width: 1100, height: 760 },
    metadata: {},
  };
}
export function validateDocument(doc) {
  if (!doc || doc.version !== VERSION || !isElement(doc.root))
    throw Error('Unsupported or invalid Xamora document.');
  if (typeof doc.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(doc.id))
    throw Error('Invalid document identity.');
  const html = doc.framework === 'HTML';
  const seen = new Set();
  let count = 0;
  function inspect(n, depth) {
    if (depth > 150 || ++count > 15000) throw Error('Document exceeds the safety limit.');
    if (typeof n.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(n.id) || seen.has(n.id))
      throw Error('Every node must have a unique ID.');
    seen.add(n.id);
    if (isElement(n)) {
      if (!/^[A-Za-z_][\w.:-]*$/.test(n.type) || !n.props || !Array.isArray(n.children))
        throw Error('Invalid element.');
      for (const [k, v] of Object.entries(n.props)) {
        if (
          !(html ? /^[^\s\x00"'<>/=]+$/.test(k) : /^[A-Za-z_][\w.:-]*$/.test(k)) ||
          (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')
        )
          throw Error('Invalid property.');
      }
      n.children.forEach((c) => inspect(c, depth + 1));
    } else if (!['text', 'comment', 'cdata', 'pi'].includes(n.kind) || typeof n.text !== 'string')
      throw Error('Invalid node.');
  }
  inspect(doc.root, 0);
  for (const n of [...(doc.preamble || []), ...(doc.postamble || [])]) {
    if (!['comment', 'pi'].includes(n.kind)) throw Error('Invalid top-level node.');
    inspect(n, 0);
  }
  if (html)
    walk(doc.root, (n, p) => {
      if (
        ['text', 'cdata'].includes(n.kind) &&
        (!p?.namespaceURI || p.namespaceURI === 'http://www.w3.org/1999/xhtml') &&
        ['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'].includes(
          p?.type,
        ) &&
        new RegExp('</' + p.type + '(?:[\\s/>])', 'i').test(n.text)
      )
        throw Error('Escape the closing ' + p.type + ' tag in its source text.');
    });
  if (!html) {
    walk(doc.root, checkText);
    [...(doc.preamble || []), ...(doc.postamble || [])].forEach(checkText);
  }
  return doc;
}
export class DocumentStore extends EventTarget {
  constructor(
    doc,
    { historyLimit = DEFAULT_HISTORY_LIMIT, historyByteLimit = DEFAULT_HISTORY_BYTE_LIMIT } = {},
  ) {
    super();
    if (
      !Number.isSafeInteger(historyLimit) ||
      historyLimit < 0 ||
      !Number.isSafeInteger(historyByteLimit) ||
      historyByteLimit < 0
    )
      throw Error('History limits must be nonnegative safe integers.');
    this.document = validateHistoryValue(validateDocument(clone(doc)));
    this.history = [];
    this.future = [];
    this.selection = [];
    this.revision = 0;
    this.commitHooks = new Set();
    this.historyLimit = historyLimit;
    this.historyByteLimit = historyByteLimit;
    this.historyDropped = 0;
  }
  /** Estimate retained deltas; materialized compatibility snapshots are never cached here. */
  get historyBytes() {
    return [...this.history, ...this.future].reduce(
      (bytes, entry) => bytes + this._entryBytes(entry),
      0,
    );
  }
  historyStats() {
    return {
      entries: this.history.length + this.future.length,
      pastEntries: this.history.length,
      futureEntries: this.future.length,
      estimatedBytes: this.historyBytes,
      entryLimit: this.historyLimit,
      byteLimit: this.historyByteLimit,
      droppedEntries: this.historyDropped,
    };
  }
  _entryBytes(entry) {
    return entry.patch
      ? (entry.estimatedBytes ??
          entry.patch.estimatedBytes + estimateHistoryBytes(entry.label) + 128)
      : estimateHistoryBytes(entry);
  }
  _entry(label, patch, side) {
    const entry = {
      label,
      patch,
      estimatedBytes: patch.estimatedBytes + estimateHistoryBytes(label) + 128,
    };
    Object.defineProperty(entry, 'document', {
      enumerable: false,
      get: () => this._historyDocument(patch, side),
    });
    return entry;
  }
  _historyDocument(patch, side) {
    let current = this.document,
      index = this.history.findIndex((entry) => entry.patch === patch);
    if (index >= 0) {
      const end = side === 'before' ? index : index + 1;
      for (let i = this.history.length - 1; i >= end; i--)
        current = this.history[i].patch
          ? applyHistoryPatch(current, this.history[i].patch, { direction: 'backward' })
          : clone(this.history[i].document);
      return clone(current);
    }
    index = this.future.findIndex((entry) => entry.patch === patch);
    if (index >= 0) {
      const end = side === 'after' ? index : index + 1;
      for (let i = this.future.length - 1; i >= end; i--)
        current = this.future[i].patch
          ? applyHistoryPatch(current, this.future[i].patch)
          : clone(this.future[i].document);
      return clone(current);
    }
    throw Error('This document history entry is no longer retained.');
  }
  _trimHistory() {
    let bytes = this.historyBytes;
    while (
      this.history.length + this.future.length > this.historyLimit ||
      bytes > this.historyByteLimit
    ) {
      const entry = this.history.length ? this.history.shift() : this.future.shift();
      if (!entry) break;
      bytes -= this._entryBytes(entry);
      this.historyDropped++;
    }
  }

  emit(type = 'change') {
    this.dispatchEvent(new Event(type));
  }
  select(ids) {
    this.selection = [...new Set(ids)].filter((id) => isElement(find(this.document.root, id)));
    this.emit('selection');
  }
  transaction(label, action) {
    const before = clone(this.document);
    try {
      action(this.document);
      validateDocument(this.document);
      this.commitSnapshot(label, before);
    } catch (e) {
      this.document = before;
      throw e;
    }
  }
  /** Hooks run atomically before a reversible edit becomes visible, including pointer gestures. */
  addCommitHook(hook) {
    this.commitHooks.add(hook);
    return () => this.commitHooks.delete(hook);
  }
  commitSnapshot(label, before) {
    let patch;
    try {
      validateDocument(this.document);
      for (const hook of this.commitHooks)
        hook({ store: this, label, before, document: this.document });
      validateDocument(this.document);
      patch = createHistoryPatch(before, this.document);
    } catch (error) {
      this.document = clone(before);
      throw error;
    }
    if (!patch) return;
    this.history.push(this._entry(label, patch, 'before'));
    this.future = [];
    this._trimHistory();
    this.revision++;
    this.selection = this.selection.filter((id) => find(this.document.root, id));
    this.emit();
  }
  setProperty(ids, key, value) {
    if (
      !(this.document.framework === 'HTML'
        ? /^[^\s\x00"'<>/=]+$/.test(key)
        : /^[A-Za-z_][\w.:-]*$/.test(key))
    )
      throw Error('Enter a valid XAML property name.');
    this.transaction(`Set ${key}`, (d) =>
      ids.forEach((id) => {
        const n = find(d.root, id);
        if (n) {
          if (d.framework !== 'HTML')
            n.children = n.children.filter((c) => !(c.type === key || c.type?.endsWith('.' + key)));
          if (value === null || value === undefined) delete n.props[key];
          else
            Object.defineProperty(n.props, key, {
              value: String(value),
              enumerable: true,
              writable: true,
              configurable: true,
            });
        }
      }),
    );
  }
  insert(parentId, node, index) {
    this.transaction(`Insert ${localName(node.type)}`, (d) => {
      const p = find(d.root, parentId);
      if (!p?.children) throw Error('Choose a container.');
      p.children.splice(index ?? p.children.length, 0, clone(node));
    });
    this.select([node.id]);
    return node.id;
  }
  move(ids, parentId, index) {
    this.transaction('Move layers', (d) => {
      const p = find(d.root, parentId);
      if (!p?.children) throw Error('Choose a container.');
      const moving = ids
        .filter(
          (id) =>
            id !== d.root.id &&
            !ids.some(
              (other) => other !== id && descendants(find(d.root, other) || {}).includes(id),
            ),
        )
        .map((id) => find(d.root, id))
        .filter(Boolean);
      if (moving.some((n) => descendants(n).includes(parentId)))
        throw Error('A layer cannot contain itself.');
      moving.forEach((n) => {
        const old = parentOf(d.root, n.id);
        old.children = old.children.filter((c) => c.id !== n.id);
      });
      p.children.splice(index ?? p.children.length, 0, ...moving);
    });
  }
  remove(ids) {
    this.transaction('Delete layers', (d) =>
      ids.forEach((id) => {
        const p = parentOf(d.root, id);
        if (p) p.children = p.children.filter((c) => c.id !== id);
      }),
    );
    this.select([]);
  }
  undo() {
    if (!this.history.length) return;
    const previous = this.history.at(-1),
      next = previous.patch
        ? applyHistoryPatch(this.document, previous.patch, { direction: 'backward' })
        : clone(previous.document);
    validateHistoryValue(validateDocument(next));
    const patch = previous.patch || createHistoryPatch(next, this.document);
    this.history.pop();
    if (patch) this.future.push(this._entry(previous.label, patch, 'after'));
    this.document = next;
    this._trimHistory();
    this.revision++;
    this.selection = this.selection.filter((id) => find(this.document.root, id));
    this.emit();
  }
  redo() {
    if (!this.future.length) return;
    const following = this.future.at(-1),
      next = following.patch
        ? applyHistoryPatch(this.document, following.patch)
        : clone(following.document);
    validateHistoryValue(validateDocument(next));
    const patch = following.patch || createHistoryPatch(this.document, next);
    this.future.pop();
    if (patch) this.history.push(this._entry(following.label, patch, 'before'));
    this.document = next;
    this._trimHistory();
    this.revision++;
    this.selection = this.selection.filter((id) => find(this.document.root, id));
    this.emit();
  }
}

function checkText(n) {
  const valid = (s) =>
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(s) &&
    ![...s].some((c) => c.codePointAt(0) >= 0xd800 && c.codePointAt(0) <= 0xdfff);
  for (const value of Object.values(n.props || {}))
    if (!valid(String(value))) throw Error('Invalid XML character.');
  if (n.text !== undefined && !valid(n.text)) throw Error('Invalid XML character.');
  if (n.kind === 'comment' && (n.text.includes('--') || n.text.endsWith('-')))
    throw Error('Invalid comment.');
  if (n.kind === 'cdata' && n.text.includes(']]>')) throw Error('Invalid CDATA.');
  if (n.kind === 'pi' && (!/^[A-Za-z_][\w.-]*(?:\s|$)/.test(n.text) || n.text.includes('?>')))
    throw Error('Invalid processing instruction.');
}
