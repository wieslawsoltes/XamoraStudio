import {
  clone,
  find,
  parentOf,
  walk,
  isElement,
  isProperty,
  localName,
  element,
  visualChildren,
} from './model.js';

export function contentChildren(node) {
  return (node.children || []).flatMap((child) =>
    isProperty(child) && /\.(Children|Child|Content|Items)$/.test(child.type)
      ? visualChildren(child)
      : visualChildren({ children: [child] }),
  );
}
export function contentHost(node) {
  return (
    node.children.find((c) => isProperty(c) && /\.(Children|Child|Content|Items)$/.test(c.type)) ||
    node
  );
}
export function logicalParent(root, id) {
  let parent = parentOf(root, id);
  while (parent && isProperty(parent)) parent = parentOf(root, parent.id);
  return parent;
}
export function ancestry(root, id) {
  const result = [];
  let node = find(root, id);
  while (node) {
    result.push(node);
    node = parentOf(root, node.id);
  }
  return result;
}
export function isLocked(doc, id) {
  return ancestry(doc.root, id).some((n) =>
    Array.isArray(doc.metadata?.locked)
      ? doc.metadata.locked.includes(n.id)
      : !!doc.metadata?.locked?.[n.id],
  );
}
export function orderedSelection(root, ids) {
  const selected = new Set(ids),
    result = [];
  walk(root, (n) => {
    if (
      selected.has(n.id) &&
      !ancestry(root, n.id)
        .slice(1)
        .some((p) => selected.has(p.id))
    )
      result.push(n);
  });
  return result;
}
export function contains(rect, x, y) {
  return (
    !!rect && x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height
  );
}
export function gridTrackIndex(sizes, position, gap = 0) {
  let offset = 0;
  for (let i = 0; i < sizes.length; i++) {
    offset += sizes[i];
    if (position <= offset + gap / 2) return i;
    offset += gap;
  }
  return Math.max(0, sizes.length - 1);
}
export function parseResolvedTracks(value, fallbackLength, total) {
  const values =
    String(value)
      .match(/[-+]?\d*\.?\d+px/g)
      ?.map(parseFloat) || [];
  return values.length === fallbackLength
    ? values
    : Array.from(
        { length: Math.max(1, fallbackLength) },
        () => total / Math.max(1, fallbackLength),
      );
}
export class HitTestService {
  constructor(studio, { document: ownerDocument } = {}) {
    this.studio = studio;
    this.document = ownerDocument;
    this.cycle = null;
  }
  stack(clientX, clientY, { includeLocked = false, exclude = [] } = {}) {
    const s = this.studio,
      document = this.document || globalThis.document,
      getComputedStyle =
        document.defaultView?.getComputedStyle.bind(document.defaultView) ||
        globalThis.getComputedStyle,
      root = s.doc.root,
      scope = s.scopeId || s.features?.isolationId,
      seen = new Set(),
      result = [];
    const blocked = new Set(
      exclude.flatMap((id) => {
        const out = [];
        const n = find(root, id);
        if (n) walk(n, (c) => out.push(c.id));
        return out;
      }),
    );
    const add = (id) => {
      if (!id || seen.has(id) || blocked.has(id)) return;
      seen.add(id);
      const n = find(root, id);
      if (!n || !isElement(n) || isProperty(n)) return;
      if (scope && !ancestry(root, id).some((p) => p.id === scope)) return;
      if (!includeLocked && isLocked(s.doc, id)) return;
      const el = s.renderer.elements.get(id);
      if (!el) return;
      const box = el.getBoundingClientRect();
      if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom)
        return;
      let current = el;
      while (current && current !== document.body) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || current.hidden) return;
        if (/hidden|clip|scroll|auto/.test(style.overflow + style.overflowX + style.overflowY)) {
          const r = current.getBoundingClientRect();
          if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom)
            return;
        }
        current = current.parentElement;
      }
      result.push(n);
    };
    document
      .elementsFromPoint(clientX, clientY)
      .forEach((el) => add(el.closest?.('[data-node-id]')?.dataset.nodeId));
    // Geometry fallback covers transparent authoring targets and disabled native inputs.
    [...s.renderer.elements.keys()].reverse().forEach((id) => {
      const previous = result.length;
      add(id);
      if (result.length > previous) {
        const node = result.pop(),
          ancestors = new Set(
            ancestry(root, id)
              .slice(1)
              .map((n) => n.id),
          ),
          index = result.findIndex((n) => ancestors.has(n.id));
        if (index < 0) result.push(node);
        else result.splice(index, 0, node);
      }
    });
    return result;
  }
  pick(x, y, { cycle = false, reverse = false, deep = false } = {}) {
    const hits = this.stack(x, y),
      s = this.studio;
    if (!hits.length) return null;
    if (cycle) {
      const signature =
        hits.map((n) => n.id).join(',') + ':' + s.store.revision + ':' + (s.scopeId || '');
      let index;
      if (
        this.cycle &&
        this.cycle.signature === signature &&
        Math.hypot(x - this.cycle.x, y - this.cycle.y) < 5
      )
        index = this.cycle.index;
      else index = hits.findIndex((n) => s.store.selection.includes(n.id));
      index = (index + (reverse ? -1 : 1) + hits.length) % hits.length;
      this.cycle = { signature, x, y, index };
      return hits[index];
    }
    this.cycle = null;
    if (!deep) {
      const selected = hits.find((n) => s.store.selection.includes(n.id));
      if (selected) return selected;
    }
    return hits[0];
  }
}
export function planDrop({
  root,
  registry,
  ids,
  parentId,
  beforeId = null,
  point = { x: 0, y: 0 },
  originalRects = {},
  parentRect,
  grid,
  grab = { x: 0, y: 0 },
  dock,
  preserveLayout = false,
}) {
  const nodes = orderedSelection(root, ids),
    parent = find(root, parentId),
    descriptor = registry.get(parent?.type || '', parent?.namespaceURI);
  if (!nodes.length) return { allowed: false, reason: 'Select at least one movable layer.' };
  if (
    !parent ||
    (!descriptor?.container &&
      !['ControlTemplate', 'DataTemplate'].includes(localName(parent.type)))
  )
    return { allowed: false, reason: 'This layer cannot contain controls.' };
  if (nodes.some((n) => n.id === root.id || ancestry(root, parentId).some((p) => p.id === n.id)))
    return { allowed: false, reason: 'A layer cannot move into itself or its descendants.' };
  const host = contentHost(parent),
    existing = contentChildren(parent).filter((c) => !ids.includes(c.id));
  if (
    (descriptor?.singleChild ||
      ['ControlTemplate', 'DataTemplate'].includes(localName(parent.type))) &&
    existing.length + nodes.length > 1
  )
    return { allowed: false, reason: `${parent.type} accepts one child. Wrap its content first.` };
  if (beforeId && !host.children.some((c) => c.id === beforeId))
    return { allowed: false, reason: 'The insertion anchor is no longer in this container.' };
  const updates = {},
    kind = localName(parent.type),
    first = nodes[0],
    firstRect = originalRects[first?.id];
  const rowBase = Number(first?.props['Grid.Row']) || 0,
    colBase = Number(first?.props['Grid.Column']) || 0;
  for (const node of nodes) {
    const props = {};
    if (preserveLayout) {
      updates[node.id] = props;
      continue;
    }
    if (kind === 'Canvas') {
      const r = originalRects[node.id];
      props['Canvas.Left'] = String(
        Math.round(point.x - grab.x + (r && firstRect ? r.x - firstRect.x : 0)),
      );
      props['Canvas.Top'] = String(
        Math.round(point.y - grab.y + (r && firstRect ? r.y - firstRect.y : 0)),
      );
      if (r) {
        props.Width = String(Math.round(r.width));
        props.Height = String(Math.round(r.height));
      }
      props.Margin = '0';
    }
    if (kind === 'Grid') {
      props['Grid.Row'] = String(
        Math.max(
          0,
          Math.min(
            (grid?.rows.length || 1) - 1,
            (grid?.row || 0) + (Number(node.props['Grid.Row']) || 0) - rowBase,
          ),
        ),
      );
      props['Grid.Column'] = String(
        Math.max(
          0,
          Math.min(
            (grid?.columns.length || 1) - 1,
            (grid?.column || 0) + (Number(node.props['Grid.Column']) || 0) - colBase,
          ),
        ),
      );
    }
    if (kind === 'DockPanel')
      props['DockPanel.Dock'] = dock || node.props['DockPanel.Dock'] || 'Left';
    updates[node.id] = props;
  }
  return {
    allowed: true,
    preserveLayout,
    parentId,
    hostId: host.id,
    beforeId,
    updates,
    kind,
    nodeIds: nodes.map((n) => n.id),
  };
}
export function applyDropPlan(document, plan) {
  if (!plan.allowed) throw Error(plan.reason || 'Drop is not allowed.');
  const nodes = plan.nodeIds.map((id) => find(document.root, id));
  if (nodes.some((n) => !n)) throw Error('A moved layer no longer exists.');
  const host = find(document.root, plan.hostId);
  if (!host) throw Error('Drop target no longer exists.');
  let anchor = plan.beforeId;
  if (anchor && plan.nodeIds.includes(anchor)) {
    const index = host.children.findIndex((c) => c.id === anchor);
    anchor = host.children.slice(index + 1).find((c) => !plan.nodeIds.includes(c.id))?.id || null;
  }
  nodes.forEach((node) => {
    const parent = parentOf(document.root, node.id);
    if (!parent) throw Error('Cannot move root.');
    parent.children = parent.children.filter((c) => c.id !== node.id);
    if (!plan.preserveLayout) {
      for (const key of [
        'Canvas.Left',
        'Canvas.Top',
        'Canvas.Right',
        'Canvas.Bottom',
        'Grid.Row',
        'Grid.Column',
        'DockPanel.Dock',
      ])
        delete node.props[key];
      if (plan.kind !== 'Grid') {
        delete node.props['Grid.RowSpan'];
        delete node.props['Grid.ColumnSpan'];
      }
    }
    Object.assign(node.props, plan.updates[node.id]);
  });
  const index = anchor ? host.children.findIndex((c) => c.id === anchor) : host.children.length;
  if (index < 0) throw Error('Drop anchor was removed.');
  host.children.splice(index, 0, ...nodes);
}
export function definitions(node, axis) {
  const property = node.children.find((c) => localName(c.type) === `Grid.${axis}Definitions`),
    key = axis === 'Row' ? 'Height' : 'Width';
  if (property) return property.children.filter(isElement);
  return String(node.props[`${axis}Definitions`] || '*')
    .split(',')
    .map((v) => element(`${axis}Definition`, { [key]: v.trim() }));
}
export function writeDefinitions(node, axis, list) {
  const name = `Grid.${axis}Definitions`;
  let property = node.children.find((c) => localName(c.type) === name);
  if (!property) {
    property = element(name);
    node.children.unshift(property);
  }
  property.children = [...property.children.filter((c) => !isElement(c)), ...list];
  delete node.props[`${axis}Definitions`];
}
export function insertTrack(node, axis, index, value = '*') {
  const list = definitions(node, axis);
  list.splice(
    index,
    0,
    element(`${axis}Definition`, { [axis === 'Row' ? 'Height' : 'Width']: value }),
  );
  writeDefinitions(node, axis, list);
  const key = `Grid.${axis}`,
    span = key + 'Span';
  for (const child of contentChildren(node)) {
    const position = Number(child.props[key]) || 0,
      length = Number(child.props[span]) || 1;
    if (position >= index) child.props[key] = String(position + 1);
    else if (position + length > index) child.props[span] = String(length + 1);
  }
}
export function removeTrack(node, axis, index) {
  const list = definitions(node, axis);
  if (list.length <= 1) throw Error('Keep at least one grid track.');
  list.splice(index, 1);
  writeDefinitions(node, axis, list);
  const key = `Grid.${axis}`,
    span = key + 'Span';
  for (const child of contentChildren(node)) {
    let position = Number(child.props[key]) || 0,
      length = Number(child.props[span]) || 1;
    if (position > index) position--;
    else if (position <= index && position + length > index && length > 1) length--;
    child.props[key] = String(Math.min(position, list.length - 1));
    child.props[span] = String(Math.max(1, Math.min(length, list.length - position)));
  }
}
/** Preserve stable authoring identities for named or structurally unchanged elements after code edits. */
export function reconcileIdentities(oldRoot, newRoot) {
  const names = new Map(),
    used = new Set();
  walk(oldRoot, (n) => {
    const name = n.props?.['x:Name'] || n.props?.Name || n.props?.['x:Key'];
    if (name) {
      const key = n.type + '|' + name;
      if (names.has(key)) names.set(key, null);
      else names.set(key, n);
    }
  });
  const match = (old, n) => {
    const name = n.props?.['x:Name'] || n.props?.Name || n.props?.['x:Key'];
    const named = name ? names.get(n.type + '|' + name) : null;
    let source = named || (!name && old?.type === n.type && old?.kind === n.kind ? old : null);
    if (source && !used.has(source.id)) {
      n.id = source.id;
      used.add(source.id);
    }
    const children = source?.children || old?.children || [];
    (n.children || []).forEach((c, i) => match(children[i], c));
  };
  match(oldRoot, newRoot);
  return newRoot;
}

/** Align moving bounds with the nearest sibling/parent edge or center on each axis. */
export function snapBounds(rect, targets, threshold = 5) {
  const output = { ...rect, guides: [] };
  for (const axis of ['x', 'y']) {
    const size = axis === 'x' ? 'width' : 'height',
      other = axis === 'x' ? 'y' : 'x',
      otherSize = axis === 'x' ? 'height' : 'width';
    let best = null;
    for (const target of targets)
      for (const fraction of [0, 0.5, 1])
        for (const targetFraction of [0, 0.5, 1]) {
          const at = target[axis] + target[size] * targetFraction,
            delta = at - (rect[axis] + rect[size] * fraction);
          if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta)))
            best = {
              delta,
              axis,
              at,
              from: Math.min(rect[other], target[other]),
              to: Math.max(rect[other] + rect[otherSize], target[other] + target[otherSize]),
            };
        }
    if (best) {
      output[axis] += best.delta;
      output.guides.push(best);
    }
  }
  return output;
}
