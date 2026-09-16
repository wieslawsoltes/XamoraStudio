/** Standalone, DOM-free docking tree. All operations are atomic and undoable. */
const copy = (value) => structuredClone(value);
const edges = ['left', 'right', 'top', 'bottom'];
const safeId = (id) =>
  typeof id === 'string' &&
  /^[A-Za-z0-9_.:-]{1,180}$/.test(id) &&
  !['__proto__', 'constructor', 'prototype'].includes(id);
let sequence = 0;
const uid = () => `dock-${Date.now().toString(36)}-${++sequence}`;
export const dockGroup = (panels = [], kind = 'tool', id = uid()) => ({
  type: 'group',
  id,
  kind,
  panels: [...panels],
  active: panels[0] || null,
});
export const dockSplit = (axis, first, second, ratio = 0.5, id = uid()) => ({
  type: 'split',
  id,
  axis,
  ratio,
  first,
  second,
});
export function walkDock(node, visit, parent = null) {
  if (!node) return;
  visit(node, parent);
  if (node.type === 'split') {
    walkDock(node.first, visit, node);
    walkDock(node.second, visit, node);
  }
}
export function findDock(layout, id) {
  let result = null;
  for (const root of [layout.root, ...layout.floating.map((f) => f.root)])
    walkDock(root, (node) => {
      if (node.id === id) result = node;
    });
  return result;
}
export function dockGroups(layout) {
  const groups = [];
  for (const root of [layout.root, ...layout.floating.map((f) => f.root)])
    walkDock(root, (n) => {
      if (n.type === 'group') groups.push(n);
    });
  return groups;
}
export function locatePanel(layout, id) {
  for (const group of dockGroups(layout))
    if (group.panels.includes(id))
      return {
        kind: 'group',
        group,
        index: group.panels.indexOf(id),
        floating:
          layout.floating.find((f) => {
            let found = false;
            walkDock(f.root, (n) => {
              if (n.id === group.id) found = true;
            });
            return found;
          }) || null,
      };
  for (const edge of edges)
    if (layout.autoHide[edge].includes(id))
      return { kind: 'autoHide', edge, index: layout.autoHide[edge].indexOf(id) };
  return layout.hidden.includes(id) ? { kind: 'hidden' } : null;
}
function normalizeNode(node) {
  if (!node) return null;
  if (node.type === 'group') {
    if (!node.panels.length) return null;
    if (!node.panels.includes(node.active)) node.active = node.panels[0];
    return node;
  }
  node.first = normalizeNode(node.first);
  node.second = normalizeNode(node.second);
  if (!node.first) return node.second;
  if (!node.second) return node.first;
  return node;
}
function normalize(layout) {
  layout.root = normalizeNode(layout.root);
  layout.floating = layout.floating.filter((f) => {
    f.root = normalizeNode(f.root);
    return !!f.root;
  });
  const located = layout.activePanel && locatePanel(layout, layout.activePanel);
  if (!located || located.kind === 'hidden')
    layout.activePanel = dockGroups(layout)[0]?.active || null;
  if (layout.zoomedGroup && !findDock(layout, layout.zoomedGroup)) layout.zoomedGroup = null;
  return layout;
}
function replaceNode(layout, id, replacement) {
  const replace = (node) => {
    if (!node) return node;
    if (node.id === id) return replacement;
    if (node.type === 'split') {
      node.first = replace(node.first);
      node.second = replace(node.second);
    }
    return node;
  };
  layout.root = replace(layout.root);
  for (const f of layout.floating) f.root = replace(f.root);
}
function detach(layout, ids) {
  for (const group of dockGroups(layout)) {
    const before = group.panels,
      at = before.indexOf(group.active);
    group.panels = before.filter((id) => !ids.includes(id));
    if (!group.panels.includes(group.active))
      group.active = group.panels[Math.min(Math.max(0, at), group.panels.length - 1)] || null;
  }
  for (const edge of edges)
    layout.autoHide[edge] = layout.autoHide[edge].filter((id) => !ids.includes(id));
  layout.hidden = layout.hidden.filter((id) => !ids.includes(id));
}
function remember(layout, id) {
  const place = locatePanel(layout, id);
  if (place?.floating)
    layout.placements[id] = {
      ...(layout.placements[id] || { groupId: '', index: 0, edge: 'right' }),
      floatingRect: { ...place.floating.rect },
    };
  else if (place?.kind === 'group')
    layout.placements[id] = {
      ...layout.placements[id],
      groupId: place.group.id,
      index: place.index,
      edge: layout.placements[id]?.edge || 'right',
      kind: place.group.kind,
    };
}
export function clampFloat(rect, width = 1200, height = 800) {
  width = Math.max(160, Number(width) || 1200);
  height = Math.max(100, Number(height) || 800);
  const w = Math.min(width, Math.max(180, Number(rect.width) || 420)),
    h = Math.min(height, Math.max(100, Number(rect.height) || 300));
  return {
    x: Math.min(Math.max(0, Number(rect.x) || 0), Math.max(0, width - w)),
    y: Math.min(Math.max(0, Number(rect.y) || 0), Math.max(0, height - h)),
    width: w,
    height: h,
  };
}
export function validateDockLayout(layout, known) {
  if (
    !layout ||
    layout.version !== 1 ||
    !Array.isArray(layout.floating) ||
    !Array.isArray(layout.hidden) ||
    !layout.autoHide ||
    !layout.placements ||
    !Array.isArray(layout.pinned)
  )
    throw Error('Invalid docking layout format.');
  if (layout.modeRestore) {
    if (layout.modeRestore.modeRestore) throw Error('Nested editor mode snapshots are invalid.');
    validateDockLayout(layout.modeRestore);
  }
  const seen = new Set(),
    nodes = new Set();
  let count = 0;
  const panel = (id) => {
    if (!safeId(id) || seen.has(id)) throw Error('A panel must appear exactly once: ' + id);
    if (known && !known.has(id)) throw Error('Unknown docking panel: ' + id);
    seen.add(id);
  };
  const visit = (node, depth = 0) => {
    if (!node) return;
    if (++count > 1024 || depth > 48 || !safeId(node.id) || nodes.has(node.id))
      throw Error('Docking tree is too deep or contains duplicate nodes.');
    nodes.add(node.id);
    if (node.type === 'group') {
      if (
        !['tool', 'document'].includes(node.kind) ||
        !Array.isArray(node.panels) ||
        !node.panels.length ||
        !node.panels.includes(node.active)
      )
        throw Error('Invalid tab group.');
      node.panels.forEach(panel);
    } else if (node.type === 'split') {
      if (
        !['horizontal', 'vertical'].includes(node.axis) ||
        !Number.isFinite(node.ratio) ||
        node.ratio <= 0 ||
        node.ratio >= 1 ||
        !node.first ||
        !node.second
      )
        throw Error('Invalid docking split.');
      visit(node.first, depth + 1);
      visit(node.second, depth + 1);
    } else throw Error('Unknown docking node.');
  };
  visit(layout.root);
  if (layout.floating.length > 128) throw Error('Too many floating groups.');
  for (const f of layout.floating) {
    if (
      !safeId(f.id) ||
      nodes.has(f.id) ||
      !f.root ||
      !f.rect ||
      !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(f.rect[k])) ||
      f.rect.width < 1 ||
      f.rect.height < 1
    )
      throw Error('Invalid floating group.');
    nodes.add(f.id);
    visit(f.root);
  }
  for (const edge of edges) {
    if (!Array.isArray(layout.autoHide[edge])) throw Error('Invalid auto-hide strip.');
    layout.autoHide[edge].forEach(panel);
  }
  layout.hidden.forEach(panel);
  if (known && [...known].some((id) => !seen.has(id)))
    throw Error('A registered panel is missing from the layout.');
  if (layout.activePanel && !seen.has(layout.activePanel)) throw Error('Invalid active panel.');
  if (
    new Set(layout.pinned).size !== layout.pinned.length ||
    layout.pinned.some((id) => !seen.has(id))
  )
    throw Error('Invalid pinned tabs.');
  for (const [id, p] of Object.entries(layout.placements)) {
    if (
      !safeId(id) ||
      !p ||
      !edges.includes(p.edge) ||
      !Number.isInteger(p.index) ||
      p.index < 0 ||
      typeof p.groupId !== 'string'
    )
      throw Error('Invalid panel return location.');
  }
  return layout;
}
export function createDockLayout(panelIds, { documents = [], preset = 'designer' } = {}) {
  documents = documents.filter((id) => !['xaml', 'views'].includes(id));
  const all = new Set(panelIds),
    take = (ids) => ids.filter((id) => all.has(id)),
    group = (ids, kind, id) => {
      const p = take(ids);
      return p.length ? dockGroup(p, kind, id) : null;
    };
  const doc = group(documents, 'document', 'documents'),
    code = group(['xaml'], 'document', 'source'),
    left = group(['layers', 'toolkit', 'assets', 'data'], 'tool', 'tools'),
    right = group(['properties', 'raw', 'flow', 'inspect', 'notes'], 'tool', 'properties');
  const split = (axis, a, b, ratio) => (a && b ? dockSplit(axis, a, b, ratio) : a || b);
  let root;
  if (preset === 'coding')
    root = split('horizontal', left, split('horizontal', code, doc, 0.64), 0.19);
  else if (preset === 'animation')
    root = split(
      'horizontal',
      left,
      split(
        'horizontal',
        split('vertical', doc, group(['timeline', 'xaml', 'problems'], 'document', 'bottom'), 0.65),
        right,
        0.76,
      ),
      0.18,
    );
  else if (preset === 'compact') root = split('vertical', doc, code, 0.7);
  else
    root = split(
      'horizontal',
      left,
      split('horizontal', split('vertical', doc, code, 0.69), right, 0.76),
      0.19,
    );
  const used = new Set();
  walkDock(root, (n) => {
    if (n.type === 'group') n.panels.forEach((id) => used.add(id));
  });
  const autoHide = { left: [], right: [], top: [], bottom: [] };
  if (preset === 'compact') {
    autoHide.left = take(['layers', 'toolkit', 'assets', 'data']);
    autoHide.right = take(['properties', 'raw', 'flow', 'inspect', 'notes']);
    Object.values(autoHide)
      .flat()
      .forEach((id) => used.add(id));
  }
  const layout = {
    version: 1,
    root,
    floating: [],
    autoHide,
    hidden: [...all].filter((id) => !used.has(id)),
    activePanel:
      documents.find((id) => used.has(id)) || dockGroups({ root, floating: [] })[0]?.active || null,
    placements: {},
    pinned: [],
    zoomedGroup: null,
  };
  for (const id of all) {
    const p = locatePanel(layout, id);
    layout.placements[id] = {
      groupId:
        p?.group?.id || (['timeline', 'problems', 'xaml'].includes(id) ? 'source' : 'properties'),
      index: Math.max(0, p?.index || 0),
      edge: ['layers', 'toolkit', 'assets', 'data'].includes(id)
        ? 'left'
        : ['timeline', 'problems', 'xaml'].includes(id)
          ? 'bottom'
          : 'right',
      kind: documents.includes(id) || id === 'xaml' ? 'document' : 'tool',
    };
  }
  return validateDockLayout(layout, all);
}
/** Layout mutation is independent from document history and document save state. */
export class DockLayout extends EventTarget {
  constructor(panels = [], layout = null) {
    super();
    this.panels = new Map(
      panels.map((p) => [
        typeof p === 'string' ? p : p.id,
        typeof p === 'string' ? { id: p, kind: 'tool' } : p,
      ]),
    );
    for (const id of this.panels.keys()) if (!safeId(id)) throw Error('Invalid panel identifier.');
    this.history = [];
    this.future = [];
    this.state = layout
      ? copy(layout)
      : createDockLayout([...this.panels.keys()], {
          documents: [...this.panels.values()]
            .filter((p) => p.kind === 'document')
            .map((p) => p.id),
        });
    validateDockLayout(this.state, new Set(this.panels.keys()));
    this.validateKinds(this.state);
  }
  validateKinds(layout) {
    for (const id of Object.values(layout.autoHide).flat())
      if (this.panels.get(id)?.kind === 'document')
        throw Error('Document windows cannot auto-hide.');
    for (const group of dockGroups(layout))
      if (
        group.kind !== 'document' &&
        group.panels.some((id) => this.panels.get(id)?.kind === 'document')
      )
        throw Error('Document windows require a document group.');
  }
  emit(label) {
    const event = new Event('change');
    event.label = label;
    this.dispatchEvent(event);
  }
  transaction(label, fn, { history = true } = {}) {
    const before = copy(this.state),
      draft = copy(this.state);
    fn(draft);
    normalize(draft);
    validateDockLayout(draft, new Set(this.panels.keys()));
    this.validateKinds(draft);
    if (JSON.stringify(before) === JSON.stringify(draft)) return false;
    if (history) {
      this.history.push(before);
      if (this.history.length > 60) this.history.shift();
      this.future = [];
    }
    this.state = draft;
    this.emit(label);
    return true;
  }
  batch(label, action) {
    if (this.batchActive) throw Error('Nested layout batches are not supported.');
    this.batchActive = true;
    const before = copy(this.state),
      history = [...this.history],
      future = [...this.future],
      emit = this.emit;
    this.emit = () => {};
    try {
      action(this);
      validateDockLayout(this.state, new Set(this.panels.keys()));
      this.validateKinds(this.state);
    } catch (error) {
      this.state = before;
      this.history = history;
      this.future = future;
      throw error;
    } finally {
      this.emit = emit;
      this.batchActive = false;
    }
    if (JSON.stringify(before) === JSON.stringify(this.state)) {
      this.history = history;
      this.future = future;
      return false;
    }
    this.history = [...history, before].slice(-60);
    this.future = [];
    this.emit(label);
    return true;
  }
  register(panel) {
    if (this.batchActive) throw Error('Register panels outside a layout batch.');
    if (!safeId(panel.id) || this.panels.has(panel.id))
      throw Error('Panel identifier is invalid or already registered.');
    this.panels.set(panel.id, panel);
    this.state.hidden.push(panel.id);
    this.history = [];
    this.future = [];
    this.emit('Register panel');
    return panel.id;
  }
  unregister(id) {
    if (this.batchActive) throw Error('Unregister panels outside a layout batch.');
    if (!this.panels.has(id)) return;
    this.transaction('Remove panel', (d) => {
      detach(d, [id]);
      d.hidden.push(id);
      d.pinned = d.pinned.filter((p) => p !== id);
      delete d.placements[id];
    });
    this.panels.delete(id);
    this.state.hidden = this.state.hidden.filter((p) => p !== id);
    this.history = [];
    this.future = [];
    normalize(this.state);
    this.emit('Unregister panel');
  }
  require(ids) {
    const result = [...new Set(Array.isArray(ids) ? ids : [ids])];
    if (!result.length || result.some((id) => !this.panels.has(id)))
      throw Error('Choose registered panels.');
    return result;
  }
  activate(id) {
    this.require(id);
    if (locatePanel(this.state, id)?.kind === 'hidden') return this.show(id);
    return this.transaction(
      'Activate panel',
      (d) => {
        const p = locatePanel(d, id);
        if (p.kind === 'group') p.group.active = id;
        d.activePanel = id;
      },
      { history: false },
    );
  }
  hide(ids) {
    ids = this.require(ids);
    return this.transaction('Close panel', (d) => {
      const active = locatePanel(d, d.activePanel);
      for (const id of ids) remember(d, id);
      detach(d, ids);
      d.hidden.push(...ids);
      if (ids.includes(d.activePanel) && active?.group?.active) d.activePanel = active.group.active;
    });
  }
  show(id) {
    this.require(id);
    const p = locatePanel(this.state, id);
    if (p?.kind !== 'hidden') return this.activate(id);
    const saved = this.state.placements[id],
      target = saved && findDock(this.state, saved.groupId);
    return this.dock(
      id,
      target?.id || this.state.root?.id || null,
      target?.type === 'group' ? 'center' : saved?.edge || 'right',
      saved?.index,
    );
  }
  dock(ids, targetId, position = 'center', index) {
    ids = this.require(ids);
    if (!['center', ...edges].includes(position)) throw Error('Invalid dock position.');
    return this.transaction('Dock panels', (d) => {
      let target = targetId ? findDock(d, targetId) : null;
      if (targetId && !target) throw Error('Dock target no longer exists.');
      if (position === 'center' && target?.type !== 'group' && target)
        throw Error('Tabs can only join a tab group.');
      if (
        target?.type === 'group' &&
        position !== 'center' &&
        target.panels.every((id) => ids.includes(id))
      )
        throw Error('A group cannot split against itself.');
      if (
        position === 'center' &&
        target?.kind === 'tool' &&
        ids.some((id) => this.panels.get(id).kind === 'document')
      )
        throw Error('Document tabs require a document group; dock beside this tool group instead.');
      const targetBefore = target?.type === 'group' ? [...target.panels] : [],
        requested =
          index === undefined
            ? targetBefore.length
            : Math.max(0, Math.min(targetBefore.length, index));
      for (const id of ids) remember(d, id);
      detach(d, ids);
      if (!target) {
        d.root = dockGroup(
          ids,
          ids.some((id) => this.panels.get(id).kind === 'document') ? 'document' : 'tool',
        );
        target = d.root;
      } else if (position === 'center') {
        let at =
          requested - targetBefore.slice(0, requested).filter((id) => ids.includes(id)).length;
        target.panels.splice(Math.max(0, at), 0, ...ids);
        target.active = ids[0];
      } else {
        const group = dockGroup(
          ids,
          ids.some((id) => this.panels.get(id).kind === 'document') ? 'document' : 'tool',
        );
        const first = ['left', 'top'].includes(position),
          split = dockSplit(
            ['left', 'right'].includes(position) ? 'horizontal' : 'vertical',
            first ? group : target,
            first ? target : group,
            first ? 0.3 : 0.7,
          );
        replaceNode(d, target.id, split);
        target = group;
      }
      if (!locatePanel(d, ids[0])?.floating)
        for (const id of ids)
          d.placements[id] = {
            ...d.placements[id],
            groupId: target.id,
            index: target.panels.indexOf(id),
            edge: edges.includes(position) ? position : d.placements[id]?.edge || 'right',
            kind: target.kind,
          };
      d.activePanel = ids[0];
      d.zoomedGroup = null;
    });
  }
  float(ids, rect) {
    ids = this.require(ids);
    rect = rect ||
      this.state.placements[ids[0]]?.floatingRect || { x: 100, y: 70, width: 440, height: 330 };
    return this.transaction('Float panels', (d) => {
      for (const id of ids) remember(d, id);
      detach(d, ids);
      const root = dockGroup(
        ids,
        ids.some((id) => this.panels.get(id).kind === 'document') ? 'document' : 'tool',
      );
      d.floating.push({
        id: uid(),
        root,
        rect: {
          x: Math.max(0, rect.x),
          y: Math.max(0, rect.y),
          width: Math.max(180, rect.width),
          height: Math.max(100, rect.height),
        },
        maximized: false,
      });
      d.activePanel = ids[0];
      d.zoomedGroup = null;
    });
  }
  autoHide(ids, edge = 'right') {
    ids = this.require(ids);
    if (!edges.includes(edge) || ids.some((id) => this.panels.get(id).kind === 'document'))
      throw Error('Only tool windows can auto-hide.');
    return this.transaction('Auto-hide panels', (d) => {
      for (const id of ids) {
        remember(d, id);
        d.placements[id] = {
          ...(d.placements[id] || { groupId: 'properties', index: 0, kind: 'tool' }),
          edge,
        };
      }
      detach(d, ids);
      d.autoHide[edge].push(...ids);
    });
  }
  dockBack(id) {
    const p = this.state.placements[id];
    let target = null;
    walkDock(this.state.root, (n) => {
      if (n.id === p?.groupId) target = n;
    });
    return this.dock(
      id,
      target?.type === 'group' ? target.id : this.state.root?.id,
      target?.type === 'group' ? 'center' : p?.edge || 'right',
      p?.index,
    );
  }
  resizeSplit(id, ratio) {
    return this.transaction('Resize split', (d) => {
      const n = findDock(d, id);
      if (n?.type !== 'split' || !Number.isFinite(ratio)) throw Error('Invalid splitter.');
      n.ratio = Math.max(0.05, Math.min(0.95, ratio));
    });
  }
  setFloatRect(id, rect) {
    return this.transaction('Resize floating window', (d) => {
      const f = d.floating.find((f) => f.id === id);
      if (!f) throw Error('Floating window no longer exists.');
      if (!['x', 'y', 'width', 'height'].every((k) => Number.isFinite(rect[k])))
        throw Error('Invalid floating bounds.');
      f.rect = { ...rect, width: Math.max(100, rect.width), height: Math.max(80, rect.height) };
      f.maximized = false;
    });
  }
  raiseFloat(id) {
    return this.transaction(
      'Raise floating window',
      (d) => {
        const index = d.floating.findIndex((f) => f.id === id);
        if (index >= 0 && index < d.floating.length - 1)
          d.floating.push(...d.floating.splice(index, 1));
      },
      { history: false },
    );
  }
  setAutoHideSize(edge, size) {
    if (!edges.includes(edge) || !Number.isFinite(size)) throw Error('Invalid auto-hide size.');
    return this.transaction('Resize auto-hidden window', (d) => {
      d.autoHideSize ??= {};
      d.autoHideSize[edge] = Math.max(140, Math.min(2400, size));
    });
  }
  maximizeFloat(id) {
    return this.transaction('Maximize floating window', (d) => {
      const f = d.floating.find((f) => f.id === id);
      if (f) f.maximized = !f.maximized;
    });
  }
  zoomGroup(id) {
    return this.transaction('Focus tab group', (d) => {
      if (id && findDock(d, id)?.type !== 'group') throw Error('Group no longer exists.');
      d.zoomedGroup = d.zoomedGroup === id ? null : id;
    });
  }
  pin(id) {
    this.require(id);
    return this.transaction('Pin document tab', (d) => {
      d.pinned = d.pinned.includes(id) ? d.pinned.filter((p) => p !== id) : [...d.pinned, id];
    });
  }
  undo() {
    if (!this.history.length) return false;
    this.future.push(copy(this.state));
    this.state = this.history.pop();
    this.emit('Undo layout');
    return true;
  }
  redo() {
    if (!this.future.length) return false;
    this.history.push(copy(this.state));
    this.state = this.future.pop();
    this.emit('Redo layout');
    return true;
  }
  serialize() {
    return JSON.stringify(this.state, null, 2);
  }
  load(layout, { reconcile = false } = {}) {
    if (typeof layout === 'string') {
      if (layout.length > 1000000) throw Error('Layout file is too large.');
      layout = JSON.parse(layout);
    }
    const d = copy(layout);
    validateDockLayout(d);
    if (reconcile) {
      const keep = new Set(this.panels.keys()),
        old = new Set([
          ...dockGroups(d).flatMap((g) => g.panels),
          ...Object.values(d.autoHide).flat(),
          ...d.hidden,
        ]);
      detach(
        d,
        [...old].filter((id) => !keep.has(id)),
      );
      for (const id of keep) if (!old.has(id)) d.hidden.push(id);
      d.pinned = d.pinned.filter((id) => keep.has(id));
      for (const id of Object.keys(d.placements)) if (!keep.has(id)) delete d.placements[id];
      normalize(d);
    }
    validateDockLayout(d, new Set(this.panels.keys()));
    return this.transaction('Load window layout', (state) => {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, d);
    });
  }
}

/** Minimum-size bounds use descriptor hints; compact hosts fall back to a safe ratio range. */
export function dockMinimum(node, panels, { chromeHeight = 52 } = {}) {
  if (!node) return { width: 0, height: 0 };
  if (node.type === 'group')
    return {
      width: Math.max(140, ...node.panels.map((id) => Number(panels.get(id)?.minWidth) || 180)),
      height:
        Math.max(80, ...node.panels.map((id) => Number(panels.get(id)?.minHeight) || 100)) +
        chromeHeight,
    };
  const a = dockMinimum(node.first, panels, { chromeHeight }),
    b = dockMinimum(node.second, panels, { chromeHeight });
  return node.axis === 'horizontal'
    ? { width: a.width + b.width + 5, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + 5 };
}
export function dockRatioLimits(node, panels, size, options = {}) {
  const key = node.axis === 'horizontal' ? 'width' : 'height',
    a = dockMinimum(node.first, panels, options)[key],
    b = dockMinimum(node.second, panels, options)[key],
    available = Math.max(1, size - 5);
  return a + b <= available
    ? [Math.max(0.05, a / available), Math.min(0.95, 1 - b / available)]
    : [0.08, 0.92];
}
