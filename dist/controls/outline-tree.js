/** Dependency-free virtual outline. Callers own data, selection actions and navigation. */
let sequence = 0;
const owners = new WeakMap();
const text = (value) => String(value ?? '');
const normalized = (value) => text(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export class OutlineTree {
  constructor(
    host,
    {
      items = [],
      label = 'Document outline',
      rowHeight = 28,
      overscan = 4,
      onSelect,
      onActivate,
      onError = console.error,
    } = {},
  ) {
    if (!host?.ownerDocument) throw new TypeError('OutlineTree requires a DOM host.');
    if (owners.has(host)) throw new Error('This host already owns an OutlineTree.');
    if (
      !Number.isFinite(rowHeight) ||
      rowHeight < 16 ||
      rowHeight > 100 ||
      !Number.isSafeInteger(overscan) ||
      overscan < 0 ||
      overscan > 100
    )
      throw new TypeError('Invalid outline viewport settings.');
    // Validate before acquiring host ownership or installing any listeners.
    const data = this.validate(items);
    this.host = host;
    this.rowHeight = rowHeight;
    this.overscan = overscan;
    this.onSelect = onSelect;
    this.onActivate = onActivate;
    this.onError = onError;
    this.prefix = `outline-${++sequence}-`;
    this.collapsed = new Set();
    this.selectedId = null;
    this.activeId = null;
    this.query = '';
    this.listeners = [];
    this.disposed = false;
    this.frame = null;
    this.rows = new Map();
    const document = host.ownerDocument;
    this.element = document.createElement('div');
    this.element.className = 'xamora-outline-tree';
    this.element.setAttribute('role', 'tree');
    this.element.setAttribute('aria-label', label);
    this.element.tabIndex = 0;
    this.content = document.createElement('div');
    this.content.className = 'outline-tree-content';
    this.element.append(this.content);
    host.append(this.element);
    owners.set(host, this);
    this.listen(this.element, 'scroll', () => this.schedule());
    this.listen(this.element, 'keydown', (event) => this.keydown(event));
    this.listen(this.element, 'click', (event) => this.click(event));
    this.listen(this.element, 'dblclick', (event) => {
      const row = event.target.closest('[data-outline-id]');
      if (row && this.content.contains(row) && !event.target.closest('[data-outline-toggle]'))
        this.activate(row.dataset.outlineId);
    });
    this.listen(this.element, 'focus', () => {
      if (!this.activeId) this.activeId = this.selectedId || this.visible[0]?.item.id || null;
      this.reveal(this.activeId);
    });
    const window = document.defaultView;
    if (window?.ResizeObserver) {
      this.observer = new window.ResizeObserver(() => this.schedule());
      this.observer.observe(this.element);
    }
    try {
      this.install(data);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  listen(target, type, callback) {
    target.addEventListener(type, callback);
    this.listeners.push(() => target.removeEventListener(type, callback));
  }
  validate(items) {
    if (!Array.isArray(items) || items.length > 100000)
      throw new TypeError('Outline needs at most 100000 items.');
    const byId = new Map(),
      children = new Map();
    for (const value of items) {
      if (!value || typeof value.id !== 'string' || !value.id || byId.has(value.id))
        throw new TypeError('Outline IDs must be unique nonempty strings.');
      const parentId = value.parentId ?? null;
      if (parentId !== null && !byId.has(parentId))
        throw new TypeError('An outline parent must precede its children.');
      const parent = byId.get(parentId);
      const item = Object.freeze({
        id: value.id,
        parentId,
        label: text(value.label),
        detail: text(value.detail),
        kind: text(value.kind),
        depth: parent ? parent.depth + 1 : 0,
      });
      byId.set(item.id, item);
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(item.id);
    }
    return { byId, children };
  }
  install(data) {
    this.data = data;
    this.collapsed = new Set([...this.collapsed].filter((id) => data.byId.has(id)));
    if (!data.byId.has(this.selectedId)) this.selectedId = null;
    if (!data.byId.has(this.activeId)) this.activeId = null;
    this.rebuild();
  }
  getState() {
    return {
      collapsed: [...this.collapsed],
      selectedId: this.selectedId,
      activeId: this.activeId,
      query: this.query,
      scrollTop: this.element.scrollTop,
    };
  }
  restoreState(state = {}) {
    if (this.disposed) return;
    const { collapsed = [], selectedId = null, activeId = null, query = '', scrollTop = 0 } = state;
    if (
      !Array.isArray(collapsed) ||
      collapsed.length > 100000 ||
      collapsed.some((id) => typeof id !== 'string') ||
      (selectedId !== null && typeof selectedId !== 'string') ||
      (activeId !== null && typeof activeId !== 'string') ||
      typeof query !== 'string' ||
      !Number.isFinite(scrollTop) ||
      scrollTop < 0
    )
      throw new TypeError('Invalid outline view state.');
    this.collapsed = new Set(collapsed.filter((id) => this.data.byId.has(id)));
    this.selectedId = this.data.byId.has(selectedId) ? selectedId : null;
    this.activeId = this.data.byId.has(activeId) ? activeId : null;
    this.query = query.slice(0, 1000);
    this.element.scrollTop = scrollTop;
    this.rebuild();
  }
  setRowHeight(value) {
    if (!Number.isFinite(value) || value < 16 || value > 100)
      throw new TypeError('Invalid outline row height.');
    if (this.disposed || value === this.rowHeight) return;
    const line = this.element.scrollTop / this.rowHeight;
    this.rowHeight = value;
    this.element.scrollTop = line * value;
    this.render();
  }
  setItems(items) {
    if (this.disposed) return;
    const data = this.validate(items);
    try {
      this.install(data);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  setFilter(query) {
    if (this.disposed) return;
    query = text(query).slice(0, 1000);
    if (this.query === query) return;
    this.query = query;
    this.element.scrollTop = 0;
    this.rebuild();
  }
  rebuild() {
    const { byId, children } = this.data;
    const terms = normalized(this.query).trim().split(/\s+/u).filter(Boolean);
    this.filtering = terms.length > 0;
    const included = new Set();
    this.matchCount = 0;
    if (terms.length) {
      // Reverse parent-first order propagates matches to ancestors in linear time.
      for (const item of [...byId.values()].reverse()) {
        if (terms.every((term) => normalized(item.label + ' ' + item.detail).includes(term))) {
          included.add(item.id);
          this.matchCount++;
        }
        if (included.has(item.id) && item.parentId !== null) included.add(item.parentId);
      }
    } else this.matchCount = byId.size;
    this.visible = [];
    this.positions = new Map();
    const roots = children.get(null) || [];
    const stack = [
      { ids: this.filtering ? roots.filter((id) => included.has(id)) : roots, index: 0 },
    ];
    while (stack.length) {
      const frame = stack.at(-1);
      if (frame.index >= frame.ids.length) {
        stack.pop();
        continue;
      }
      const at = frame.index++,
        id = frame.ids[at];
      if (this.filtering && !included.has(id)) continue;
      const item = byId.get(id),
        childIds = children.get(id) || [];
      this.positions.set(id, this.visible.length);
      this.visible.push({
        item,
        position: at + 1,
        size: frame.ids.length,
        branch: childIds.length > 0,
      });
      if (this.filtering || !this.collapsed.has(id)) {
        const ids = this.filtering ? childIds.filter((child) => included.has(child)) : childIds;
        if (ids.length) stack.push({ ids, index: 0 });
      }
    }
    // Preserve the focused branch, not an unrelated first row, after a collapse.
    for (
      let item = byId.get(this.activeId);
      item && !this.positions.has(this.activeId);
      item = byId.get(item.parentId)
    )
      this.activeId = item.parentId;
    if (!this.positions.has(this.activeId)) this.activeId = this.visible[0]?.item.id || null;
    const max = Math.max(
      0,
      this.visible.length * this.rowHeight - (this.element.clientHeight || this.rowHeight * 12),
    );
    this.element.scrollTop = Math.min(this.element.scrollTop, max);
    this.render();
  }
  setCollapsed(id, collapsed = true) {
    if (this.disposed || !this.data.byId.has(id) || !this.data.children.has(id)) return false;
    if (collapsed) this.collapsed.add(id);
    else this.collapsed.delete(id);
    this.rebuild();
    return true;
  }
  expandAll() {
    if (this.disposed) return;
    this.collapsed.clear();
    this.rebuild();
  }
  collapseAll() {
    if (this.disposed) return;
    this.collapsed = new Set([...this.data.children.keys()].filter((id) => id !== null));
    this.rebuild();
  }
  select(id, { notify = false, reveal = false } = {}) {
    if (this.disposed || (id !== null && !this.data.byId.has(id))) return false;
    this.selectedId = id;
    if (reveal && id !== null) {
      for (let item = this.data.byId.get(id); item; item = this.data.byId.get(item.parentId))
        this.collapsed.delete(item.parentId);
      this.activeId = id;
      this.rebuild();
      this.reveal(id);
    } else this.render();
    if (notify && id !== null) this.invoke(this.onSelect, id);
    return true;
  }
  invoke(callback, id) {
    try {
      const result = callback?.(id);
      if (result?.then)
        result.catch((error) => {
          if (!this.disposed) this.onError?.(error);
        });
    } catch (error) {
      this.onError?.(error);
    }
  }
  activate(id = this.activeId) {
    if (!this.disposed && this.data.byId.has(id)) this.invoke(this.onActivate, id);
  }
  reveal(id) {
    if (this.disposed || !this.positions.has(id)) return;
    const top = this.positions.get(id) * this.rowHeight,
      height = this.element.clientHeight || this.rowHeight * 12;
    if (top < this.element.scrollTop) this.element.scrollTop = top;
    else if (top + this.rowHeight > this.element.scrollTop + height)
      this.element.scrollTop = top + this.rowHeight - height;
    this.render();
  }
  focus(id = this.activeId) {
    if (this.disposed) return;
    if (this.positions.has(id)) this.activeId = id;
    this.element.focus({ preventScroll: true });
    this.reveal(this.activeId);
  }
  schedule() {
    const window = this.element.ownerDocument.defaultView;
    if (this.frame !== null && this.frameWindow !== window) {
      this.frameWindow.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    if (this.disposed || this.frame !== null) return;
    this.frameWindow = window;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }
  render() {
    if (this.disposed) return;
    const height = this.element.clientHeight || this.rowHeight * 12;
    const first = Math.max(0, Math.floor(this.element.scrollTop / this.rowHeight) - this.overscan);
    const last = Math.min(
      this.visible.length,
      first + Math.ceil(height / this.rowHeight) + this.overscan * 2,
    );
    const indexes = new Set(Array.from({ length: Math.max(0, last - first) }, (_, n) => first + n));
    // Keep the active descendant in the accessibility tree even when pointer scrolling away.
    const active = this.positions.get(this.activeId);
    if (active !== undefined) indexes.add(active);
    for (const index of [...indexes]) {
      for (let item = this.visible[index].item; item.parentId !== null;) {
        const parentIndex = this.positions.get(item.parentId);
        if (parentIndex === undefined) break;
        indexes.add(parentIndex);
        item = this.visible[parentIndex].item;
      }
    }
    const needed = new Set([...indexes].map((i) => this.visible[i].item.id));
    for (const [id, row] of this.rows)
      if (!needed.has(id)) {
        row.remove();
        this.rows.delete(id);
      }
    const document = this.element.ownerDocument;
    for (const index of [...indexes].sort((a, b) => a - b)) {
      const { item, position, size, branch } = this.visible[index];
      let row = this.rows.get(item.id);
      if (!row) {
        row = document.createElement('div');
        row.className = 'outline-tree-row';
        row.setAttribute('role', 'treeitem');
        row.dataset.outlineId = item.id;
        const toggle = document.createElement('span');
        toggle.dataset.outlineToggle = '';
        toggle.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'outline-tree-label';
        const detail = document.createElement('span');
        detail.className = 'outline-tree-detail';
        row.append(toggle, label, detail);
        this.rows.set(item.id, row);
      }
      row.id = this.prefix + index;
      row.style.top = `${(index - (this.positions.get(item.parentId) ?? 0)) * this.rowHeight}px`;
      row.style.height = `${this.rowHeight}px`;
      row.style.paddingInlineStart = `${6 + item.depth * 14}px`;
      row.setAttribute('aria-level', String(item.depth + 1));
      row.setAttribute('aria-posinset', String(position));
      row.setAttribute('aria-setsize', String(size));
      row.setAttribute('aria-selected', String(item.id === this.selectedId));
      row.setAttribute('aria-label', item.label + (item.detail ? ' ' + item.detail : ''));
      row.classList.toggle('is-active', item.id === this.activeId);
      if (branch)
        row.setAttribute('aria-expanded', String(this.filtering || !this.collapsed.has(item.id)));
      else row.removeAttribute('aria-expanded');
      row.children[0].textContent = branch
        ? this.filtering || !this.collapsed.has(item.id)
          ? '▾'
          : '▸'
        : '·';
      row.children[1].textContent = item.label;
      row.children[2].textContent = item.detail;
      row.title = item.label + (item.detail ? ' ' + item.detail : '');
      let group = row.querySelector(':scope > [role="group"]');
      if (branch && !group) {
        group = document.createElement('div');
        group.setAttribute('role', 'group');
        group.className = 'outline-tree-group';
        row.append(group);
      } else if (!branch) group?.remove();
      const parent = this.rows.get(item.parentId);
      (parent?.querySelector(':scope > [role="group"]') || this.content).append(row);
    }
    this.content.style.height = `${this.visible.length * this.rowHeight}px`;
    if (active !== undefined)
      this.element.setAttribute('aria-activedescendant', this.prefix + active);
    else this.element.removeAttribute('aria-activedescendant');
  }
  click(event) {
    const row = event.target.closest('[data-outline-id]');
    if (!row || !this.content.contains(row)) return;
    const id = row.dataset.outlineId;
    this.activeId = id;
    this.element.focus({ preventScroll: true });
    if (event.target.closest('[data-outline-toggle]'))
      this.setCollapsed(id, !this.collapsed.has(id));
    else this.select(id, { notify: true });
  }
  keydown(event) {
    if (
      this.disposed ||
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    const at = this.positions.get(this.activeId) ?? 0,
      current = this.visible[at];
    if (!current) return;
    const { item, branch } = current;
    let next;
    if (event.key === 'ArrowDown')
      next = this.visible[Math.min(at + 1, this.visible.length - 1)]?.item.id;
    else if (event.key === 'ArrowUp') next = this.visible[Math.max(0, at - 1)]?.item.id;
    else if (event.key === 'Home') next = this.visible[0]?.item.id;
    else if (event.key === 'End') next = this.visible.at(-1)?.item.id;
    else if (event.key === 'ArrowRight') {
      if (branch && this.collapsed.has(item.id) && !this.filtering)
        this.setCollapsed(item.id, false);
      else if (this.visible[at + 1]?.item.parentId === item.id) next = this.visible[at + 1].item.id;
    } else if (event.key === 'ArrowLeft') {
      if (branch && !this.collapsed.has(item.id) && !this.filtering)
        this.setCollapsed(item.id, true);
      else next = item.parentId;
    } else if (event.key === 'Enter') this.activate(item.id);
    else if (event.key === ' ') this.select(item.id, { notify: true });
    else if (event.key === '*') {
      for (const id of this.data.children.get(item.parentId) || []) this.collapsed.delete(id);
      this.rebuild();
    } else if (event.key.length === 1 && !event.shiftKey) {
      const now = Date.now();
      this.typed = now - (this.typedAt || 0) < 800 ? (this.typed || '') + event.key : event.key;
      this.typedAt = now;
      const typed = normalized(this.typed);
      const needle = [...typed].every((c) => c === typed[0]) ? typed[0] : typed;
      const candidates = this.visible.slice(at + 1).concat(this.visible.slice(0, at + 1));
      next = candidates.find(({ item: candidate }) =>
        normalized(candidate.label + ' ' + candidate.detail).startsWith(needle),
      )?.item.id;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    if (next && this.positions.has(next)) {
      this.activeId = next;
      this.reveal(next);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame !== null) this.frameWindow.cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    for (const remove of this.listeners) remove();
    this.listeners = [];
    this.element.remove();
    this.rows.clear();
    this.collapsed.clear();
    this.selectedId = this.activeId = null;
    this.data = this.visible = this.positions = null;
    this.onSelect = this.onActivate = this.onError = null;
    if (owners.get(this.host) === this) owners.delete(this.host);
  }
}
