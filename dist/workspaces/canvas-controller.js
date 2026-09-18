import { clone, find, parentOf, walk, element, label, localName } from '../core/model.js';
import {
  HitTestService,
  snapBounds,
  ancestry,
  isLocked,
  orderedSelection,
  contentChildren,
  contentHost,
  prepareInlineContent,
  logicalParent,
  parseResolvedTracks,
  gridTrackIndex,
  planDrop,
  applyDropPlan,
  definitions,
  writeDefinitions,
  insertTrack,
  removeTrack,
} from '../core/design-tools.js';
import { WorkspaceComponent, esc, field, select } from './workspace-context.js';

export class CanvasController extends WorkspaceComponent {
  /** @param {import('./workspace-context.js').CanvasWorkspaceHost} studio
   * @param {import('./workspace-context.js').WorkspaceOptions} [workspaceOptions] */
  constructor(studio, workspaceOptions = studio.workspaceOptions) {
    super(workspaceOptions);
    try {
      this.s = studio;
      this.hit = new HitTestService(studio, { document: this.environment.document });
      this.gesture = null;
      this.gridEnabled = false;
      const down = studio.pointerDown.bind(studio),
        move = studio.pointerMove.bind(studio),
        up = studio.pointerUp.bind(studio);
      this.legacy = { down, move, up };
      this.environment.override(studio, 'pointerDown', (e) => this.pointerDown(e));
      this.environment.override(studio, 'pointerMove', (e) => this.pointerMove(e));
      this.environment.override(studio, 'pointerUp', (e, cancel) => this.pointerUp(e, cancel));
      const draw = studio.drawSelection.bind(studio);
      this.environment.override(studio, 'drawSelection', () => {
        draw();
        this.drawGridOverlay();
      });
      const context = studio.contextMenu.bind(studio);
      this.environment.override(studio, 'contextMenu', (x, y) => {
        context(x, y);
        const menu = this.environment.query('.context-menu');
        menu.insertAdjacentHTML(
          'afterbegin',
          '<button data-advanced-pick>Select layer at pointer… <kbd>Alt click</kbd></button><button data-action="select-parent">Select parent <kbd>Shift Enter</kbd></button><button data-action="isolate">Isolate selection</button><button data-action="lock-selection">Lock / unlock</button><hr>',
        );
        this.environment.handler(
          this.environment.query('[data-advanced-pick]', menu),
          'onclick',
          () => {
            menu.remove();
            this.pickMenu(x, y);
          },
        );
      });
      const drop = studio.drop.bind(studio);
      this.environment.override(studio, 'drop', (e, target, canvas) => {
        const type = e.dataTransfer?.getData('application/x-xamora-control');
        if (type && canvas) {
          this.insertDrop(e, type);
          return;
        }
        const raw = e.dataTransfer?.getData('application/x-xamora-nodes');
        if (raw) {
          this.treeDrop(e, target, canvas);
          return;
        }
        drop(e, target, canvas);
      });
      for (const selector of ['#canvas-viewport', '#left-content']) {
        const node = this.environment.query(selector),
          previous = node.getAttribute('tabindex');
        node.tabIndex = 0;
        this.environment.add(() => {
          if (node.getAttribute('tabindex') !== '0') return;
          if (previous === null) node.removeAttribute('tabindex');
          else node.setAttribute('tabindex', previous);
        });
      }
      this.environment.listen(this.environment.query('#left-content'), 'dragover', (e) =>
        this.treeCue(e),
      );
      this.environment.listen(this.environment.query('.workspace'), 'dragend', () => {
        this.dragControlType = null;
        this.clearCue();
      });
      this.environment.listen(
        this.environment.query('.workspace'),
        'dragstart',
        (e) => (this.dragControlType = e.target.closest('[data-insert]')?.dataset.insert || null),
      );
      this.environment.listen(this.environment.query('#canvas-viewport'), 'dragover', (e) => {
        if (!this.dragControlType) return;
        const parent = this.parentTarget(e.clientX, e.clientY, []);
        if (!parent) return this.clearCue();
        const plan = this.createPlan(parent, [], e);
        plan.allowed = true;
        this.showCue(plan);
      });
      this.environment.listen(this.environment.query('#canvas-viewport'), 'dragleave', (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) this.clearCue();
      });
      this.environment.listen(
        this.environment.document,
        'keydown',
        (e) => {
          if (
            this.environment.root !== this.environment.document &&
            !this.environment.root.contains(e.target)
          )
            return;
          if (e.key === 'Escape' && (this.gesture || studio.drag)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (this.gesture) this.cancel();
            else this.legacy.up(e, true);
          }
          if (
            e.target.closest('input,textarea,select,[contenteditable]') ||
            this.environment.query('#modal-root')?.children.length ||
            !e.target.closest('#canvas-viewport,#left-content')
          )
            return;
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.shiftKey ? this.selectParent() : this.selectChild();
          }
          if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && studio.selected.length) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.selectSibling(e.shiftKey ? -1 : 1);
          }
        },
        { capture: true },
      );
      this.environment.listen(this.environment.query('#canvas-viewport'), 'pointermove', (e) => {
        if (!this.gesture && !studio.drag && !e.buttons) this.hover(e);
      });
    } catch (error) {
      try {
        this.environment.dispose();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'CanvasController initialization failed.');
      }
      throw error;
    }
  }
  point(e) {
    const r = this.environment.query('#canvas-viewport').getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  parentTarget(x, y, ids) {
    const s = this.s,
      hits = this.hit.stack(x, y, { exclude: ids });
    const containers = hits.filter((n) => s.registry.get(n.type, n.namespaceURI)?.container);
    return (
      containers.find((n) => {
        const d = s.registry.get(n.type, n.namespaceURI);
        return !d.singleChild || contentChildren(n).every((c) => ids.includes(c.id));
      }) ||
      containers[0] ||
      null
    );
  }
  gridGeometry(node) {
    const s = this.s,
      el = s.renderer.elements.get(node.id);
    if (!el) return null;
    const style = this.environment.window.getComputedStyle(el),
      r = el.getBoundingClientRect(),
      num = (k) => parseFloat(style[k]) || 0,
      l = num('borderLeftWidth') + num('paddingLeft'),
      t = num('borderTopWidth') + num('paddingTop'),
      w = Math.max(0, r.width / s.zoom - l - num('borderRightWidth') - num('paddingRight')),
      h = Math.max(0, r.height / s.zoom - t - num('borderBottomWidth') - num('paddingBottom'));
    const columns = parseResolvedTracks(
        style.gridTemplateColumns,
        definitions(node, 'Column').length,
        w,
      ),
      rows = parseResolvedTracks(style.gridTemplateRows, definitions(node, 'Row').length, h);
    return {
      rows,
      columns,
      columnGap: parseFloat(style.columnGap) || 0,
      rowGap: parseFloat(style.rowGap) || 0,
      left: r.left + (l - (el.scrollLeft || 0)) * s.zoom,
      top: r.top + (t - (el.scrollTop || 0)) * s.zoom,
      width: w,
      height: h,
      rect: r,
    };
  }
  createPlan(parent, ids, e, originals = {}, grab = { x: 0, y: 0 }, beforeId = null) {
    const s = this.s,
      el = s.renderer.elements.get(parent.id),
      r = el?.getBoundingClientRect();
    if (!r) return { allowed: false, reason: 'Target has no visible geometry.' };
    const style = this.environment.window.getComputedStyle(el),
      point = {
        x: (e.clientX - r.left) / s.zoom - (parseFloat(style.borderLeftWidth) || 0),
        y: (e.clientY - r.top) / s.zoom - (parseFloat(style.borderTopWidth) || 0),
      };
    let grid,
      dock,
      cue,
      guides = [],
      kind = localName(parent.type);
    if (kind === 'Grid') {
      grid = this.gridGeometry(parent);
      grid.column = gridTrackIndex(grid.columns, (e.clientX - grid.left) / s.zoom, grid.columnGap);
      grid.row = gridTrackIndex(grid.rows, (e.clientY - grid.top) / s.zoom, grid.rowGap);
      const x = grid.columns.slice(0, grid.column).reduce((a, b) => a + b + grid.columnGap, 0),
        y = grid.rows.slice(0, grid.row).reduce((a, b) => a + b + grid.rowGap, 0);
      cue = {
        x: grid.left + x * s.zoom,
        y: grid.top + y * s.zoom,
        width: grid.columns[grid.column] * s.zoom,
        height: grid.rows[grid.row] * s.zoom,
        label: `${label(parent)} · row ${grid.row}, column ${grid.column}`,
      };
    } else if (
      ['StackPanel', 'WrapPanel', 'UniformGrid', 'DockPanel', 'ItemsControl', 'ListBox'].includes(
        kind,
      )
    ) {
      const candidates = contentChildren(parent)
        .filter((n) => !ids.includes(n.id))
        .map((n) => ({ n, r: s.renderer.elements.get(n.id)?.getBoundingClientRect() }))
        .filter((c) => c.r);
      const horizontal = parent.props.Orientation === 'Horizontal' || kind === 'WrapPanel';
      let target;
      if (kind === 'WrapPanel' || kind === 'UniformGrid') {
        target =
          candidates.find((c) => e.clientY < c.r.bottom && e.clientX < c.r.left + c.r.width / 2) ||
          candidates.find((c) => e.clientY < c.r.top);
      } else
        target = candidates.find(
          (c) =>
            (horizontal ? e.clientX : e.clientY) <
            (horizontal ? c.r.left + c.r.width / 2 : c.r.top + c.r.height / 2),
        );
      beforeId ??= target?.n.id || null;
      const anchor = beforeId ? candidates.find((c) => c.n.id === beforeId) : null,
        last = candidates.at(-1);
      const edge = anchor
        ? horizontal
          ? anchor.r.left
          : anchor.r.top
        : last
          ? horizontal
            ? last.r.right
            : last.r.bottom
          : horizontal
            ? r.left
            : r.top;
      cue = horizontal
        ? {
            x: edge,
            y: r.top,
            width: 2,
            height: r.height,
            line: true,
            label: `Insert in ${label(parent)}`,
          }
        : {
            x: r.left,
            y: edge,
            width: r.width,
            height: 2,
            line: true,
            label: `Insert in ${label(parent)}`,
          };
      if (kind === 'DockPanel') {
        const edges = [
          ['Left', point.x],
          ['Right', r.width / s.zoom - point.x],
          ['Top', point.y],
          ['Bottom', r.height / s.zoom - point.y],
        ].sort((a, b) => a[1] - b[1]);
        dock = edges[0][0];
        cue.label = `${label(parent)} · dock ${dock}`;
      }
    }
    if (kind === 'Canvas') {
      point.x = s.snapValue(point.x - grab.x) + grab.x;
      point.y = s.snapValue(point.y - grab.y) + grab.y;
      const first = originals[ids[0]],
        targets = contentChildren(parent)
          .filter((n) => !ids.includes(n.id))
          .map((n) => s.renderer.elements.get(n.id)?.getBoundingClientRect())
          .filter(Boolean)
          .map((b) => ({
            x: (b.left - r.left) / s.zoom,
            y: (b.top - r.top) / s.zoom,
            width: b.width / s.zoom,
            height: b.height / s.zoom,
          }));
      targets.push({ x: 0, y: 0, width: r.width / s.zoom, height: r.height / s.zoom });
      if (s.snap && first) {
        const snapped = snapBounds(
          { x: point.x - grab.x, y: point.y - grab.y, width: first.width, height: first.height },
          targets,
          5 / s.zoom,
        );
        point.x = snapped.x + grab.x;
        point.y = snapped.y + grab.y;
        guides = snapped.guides.map((g) => ({ ...g, origin: r }));
      }
    }
    const plan = planDrop({
      root: s.doc.root,
      registry: s.registry,
      ids,
      parentId: parent.id,
      beforeId,
      point,
      originalRects: originals,
      grab,
      grid,
      dock,
    });
    plan.guides = guides;
    plan.cue = cue || {
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
      label: `Move into ${label(parent)}`,
    };
    return plan;
  }
  pointerDown(e) {
    const s = this.s;
    if (e.target.closest('.canvas-tools,.annotation-pin,.grid-track-label,.grid-track-handle'))
      return;
    if (e.target.closest('[data-h]')) {
      if (s.selected.some((n) => isLocked(s.doc, n.id))) {
        this.environment.notify('Unlock the selected layer before editing.');
        return;
      }
      return this.legacy.down(e);
    }
    if (e.button !== 0 || s.spaceHeld || s.tool !== 'select') return this.legacy.down(e);
    if (!s.prepareEdit()) return;
    this.environment.query('#canvas-viewport').focus({ preventScroll: true });
    const node = this.hit.pick(e.clientX, e.clientY, {
      cycle: e.altKey,
      reverse: e.altKey && e.shiftKey,
      deep: e.ctrlKey || e.metaKey,
    });
    if (!node) {
      if (!e.shiftKey) s.store.select([]);
      const point = this.point(e);
      s.drag = {
        kind: 'marquee',
        x: point.x,
        y: point.y,
        base: e.shiftKey ? [...s.store.selection] : [],
      };
      this.environment.query('#canvas-viewport').setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    e.preventDefault();
    if (e.altKey) {
      s.store.select([node.id]);
      this.environment.notify(`Selected ${label(node)} · Alt-click to cycle`);
      return;
    }
    if (e.shiftKey)
      s.store.select(
        s.store.selection.includes(node.id)
          ? s.store.selection.filter((id) => id !== node.id)
          : [...s.store.selection, node.id],
      );
    else if (!s.store.selection.includes(node.id)) s.store.select([node.id]);
    const nodes = orderedSelection(s.doc.root, s.store.selection).filter(
      (n) => n.id !== s.doc.root.id && !isLocked(s.doc, n.id),
    );
    if (!nodes.length) return;
    const originals = {};
    for (const n of nodes) {
      const r = s.renderer.elements.get(n.id)?.getBoundingClientRect();
      if (r)
        originals[n.id] = {
          x: r.left / s.zoom,
          y: r.top / s.zoom,
          width: r.width / s.zoom,
          height: r.height / s.zoom,
        };
    }
    const first = originals[nodes[0].id];
    this.gesture = {
      kind: 'move',
      x: e.clientX,
      y: e.clientY,
      ids: nodes.map((n) => n.id),
      originals,
      before: clone(s.doc),
      grab: first
        ? { x: e.clientX / s.zoom - first.x, y: e.clientY / s.zoom - first.y }
        : { x: 0, y: 0 },
      started: false,
    };
    this.environment.query('#canvas-viewport').setPointerCapture(e.pointerId);
  }
  pointerMove(e) {
    const g = this.gesture,
      s = this.s;
    if (!g) return this.legacy.move(e);
    if (g.kind === 'track') {
      this.resizeTrack(e);
      return;
    }
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4 && !g.started) return;
    g.started = true;
    const parent = e.shiftKey
      ? logicalParent(s.doc.root, g.ids[0])
      : this.parentTarget(e.clientX, e.clientY, g.ids);
    g.plan = parent
      ? this.createPlan(parent, g.ids, e, g.originals, g.grab)
      : { allowed: false, reason: 'Move over an unlocked layout container.' };
    if (parent && isLocked(s.doc, parent.id))
      g.plan = { allowed: false, reason: 'This container is locked.' };
    this.showCue(g.plan);
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    let ghosts = this.environment.query('#drag-ghosts');
    if (!ghosts) {
      ghosts = this.environment.track(this.environment.document.createElement('div'));
      ghosts.id = 'drag-ghosts';
      this.environment.query('#canvas-viewport').append(ghosts);
    }
    const vr = this.environment.query('#canvas-viewport').getBoundingClientRect();
    ghosts.innerHTML = g.ids
      .map((id) => {
        const r = g.originals[id];
        return r
          ? `<div style="left:${r.x * s.zoom + dx - vr.left}px;top:${r.y * s.zoom + dy - vr.top}px;width:${r.width * s.zoom}px;height:${r.height * s.zoom}px"></div>`
          : '';
      })
      .join('');
  }
  pointerUp(e, cancel = false) {
    const g = this.gesture;
    if (!g) return this.legacy.up(e, cancel);
    this.gesture = null;
    try {
      this.environment.query('#canvas-viewport').releasePointerCapture(e.pointerId);
    } catch {}
    this.clearCue();
    this.environment.query('#drag-ghosts')?.remove();
    if (cancel) {
      if (g.kind === 'track') {
        this.s.store.document = g.before;
        this.s.render();
      }
      return;
    }
    try {
      if (g.kind === 'track') this.s.store.commitSnapshot('Resize grid tracks', g.before);
      else if (g.started) {
        if (!g.plan?.allowed) {
          this.environment.notify(g.plan?.reason || 'Drop cancelled.');
          return;
        }
        this.s.store.transaction('Move and reorder layers', (d) => applyDropPlan(d, g.plan));
        this.s.store.select(g.ids);
      }
    } catch (error) {
      this.environment.notify(error.message);
    }
  }
  cancel() {
    const g = this.gesture;
    this.gesture = null;
    this.clearCue();
    this.environment.query('#drag-ghosts')?.remove();
    if (g?.kind === 'track') {
      this.s.store.document = g.before;
      this.s.render();
    }
    this.environment.notify('Drag cancelled');
  }
  showCue(plan) {
    this.clearCue();
    const vp = this.environment.query('#canvas-viewport'),
      vr = vp.getBoundingClientRect();
    const cue = this.environment.track(this.environment.document.createElement('div'));
    cue.id = 'drop-cue';
    cue.className = plan.allowed ? 'valid' : 'invalid';
    if (plan.cue) {
      const r = plan.cue;
      Object.assign(cue.style, {
        left: r.x - vr.left + 'px',
        top: r.y - vr.top + 'px',
        width: Math.max(2, r.width) + 'px',
        height: Math.max(2, r.height) + 'px',
      });
      cue.classList.toggle('insertion', !!r.line);
    } else Object.assign(cue.style, { left: '20px', top: '15px', width: '0', height: '0' });
    const text = this.environment.track(this.environment.document.createElement('span'));
    text.textContent = plan.allowed ? plan.cue?.label || 'Drop here' : plan.reason;
    cue.append(text);
    vp.append(cue);
    for (const g of plan.guides || []) {
      const line = this.environment.track(this.environment.document.createElement('div'));
      line.className = 'smart-guide';
      const vertical = g.axis === 'x';
      Object.assign(line.style, {
        left: g.origin.left - vr.left + (vertical ? g.at : g.from) * this.s.zoom + 'px',
        top: g.origin.top - vr.top + (vertical ? g.from : g.at) * this.s.zoom + 'px',
        width: (vertical ? 1 : (g.to - g.from) * this.s.zoom) + 'px',
        height: (vertical ? (g.to - g.from) * this.s.zoom : 1) + 'px',
      });
      vp.append(line);
    }
  }
  clearCue() {
    this.environment.query('#drop-cue')?.remove();
    this.environment.all('.smart-guide').forEach((el) => el.remove());
    this.environment
      .all('.tree-drop-before,.tree-drop-after')
      .forEach((el) => el.classList.remove('tree-drop-before', 'tree-drop-after'));
  }
  treeCue(e) {
    const row = e.target.closest('[data-node]');
    if (!row) return;
    const r = row.getBoundingClientRect(),
      ratio = (e.clientY - r.top) / r.height;
    this.treeZone = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
    this.clearCue();
    if (this.treeZone !== 'inside') row.classList.add('tree-drop-' + this.treeZone);
  }
  insertDrop(e, type) {
    const s = this.s;
    try {
      if (!s.prepareEdit()) return;
      const parent = this.parentTarget(e.clientX, e.clientY, []);
      if (!parent) throw Error('Drop over an unlocked layout container.');
      const node = s.registry.create(type);
      s.canContain(parent, [node]);
      s.store.transaction('Insert ' + type, (d) => {
        const descriptor = s.registry.get(type),
          prefix = type.includes(':') ? type.split(':')[0] : null;
        if (prefix && descriptor?.namespace) d.root.props['xmlns:' + prefix] = descriptor.namespace;
        prepareInlineContent(parent).children.push(node);
        const plan = this.createPlan(parent, [node.id], e);
        if (!plan.allowed) throw Error(plan.reason);
        applyDropPlan(d, plan);
      });
      s.store.select([node.id]);
    } catch (error) {
      this.environment.notify(error.message);
    } finally {
      this.clearCue();
    }
  }
  treeDrop(e, target, canvas) {
    try {
      if (!this.s.prepareEdit()) return;
      const ids = JSON.parse(e.dataTransfer.getData('application/x-xamora-nodes'));
      if (ids.some((id) => isLocked(this.s.doc, id)))
        throw Error('Unlock layers before moving them.');
      let parent = canvas ? this.parentTarget(e.clientX, e.clientY, ids) : target,
        beforeId = null;
      if (!canvas && this.treeZone !== 'inside') {
        parent = logicalParent(this.s.doc.root, target.id);
        if (!parent) throw Error('Cannot reorder the document root.');
        const children = contentHost(parent).children,
          index = children.findIndex((c) => c.id === target.id);
        beforeId = this.treeZone === 'before' ? target.id : children[index + 1]?.id || null;
      }
      if (!parent) parent = this.parentTarget(e.clientX, e.clientY, ids);
      if (!parent) throw Error('Choose a container.');
      if (isLocked(this.s.doc, parent.id)) throw Error('Destination is locked.');
      let plan;
      if (canvas) {
        const originals = {};
        for (const id of ids) {
          const r = this.s.renderer.elements.get(id)?.getBoundingClientRect();
          if (r)
            originals[id] = {
              x: r.left / this.s.zoom,
              y: r.top / this.s.zoom,
              width: r.width / this.s.zoom,
              height: r.height / this.s.zoom,
            };
        }
        plan = this.createPlan(parent, ids, e, originals);
      } else
        plan = planDrop({
          root: this.s.doc.root,
          registry: this.s.registry,
          ids,
          parentId: parent.id,
          beforeId,
          preserveLayout: true,
        });
      if (!plan.allowed) throw Error(plan.reason);
      this.s.store.transaction('Reparent layers', (d) => applyDropPlan(d, plan));
      this.s.store.select(ids);
    } catch (error) {
      this.environment.notify(error.message);
    } finally {
      this.clearCue();
    }
  }
  hover(e) {
    const n = this.hit.stack(e.clientX, e.clientY)[0];
    this.environment.query('#hover-outline')?.remove();
    if (!n || this.s.store.selection.includes(n.id) || n.id === this.s.doc.root.id) return;
    const r = this.s.rectFor(n.id);
    if (!r) return;
    const el = this.environment.track(this.environment.document.createElement('div'));
    el.id = 'hover-outline';
    Object.assign(el.style, {
      left: r.x + 'px',
      top: r.y + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
    });
    this.environment.query('#canvas-viewport').append(el);
  }
  pickMenu(x, y) {
    const hits = this.hit.stack(x, y, { includeLocked: true });
    this.s.modal(
      'Select a layer',
      `<p>Front-to-back layers under the pointer.</p><div class="command-list">${hits.map((n) => `<button class="command-item" data-pick-id="${n.id}">${esc(label(n))}<kbd>${esc(n.type)}${isLocked(this.s.doc, n.id) ? ' · locked' : ''}</kbd></button>`).join('')}</div>`,
    );
    this.environment.all('[data-pick-id]').forEach((b) =>
      this.environment.handler(b, 'onclick', () => {
        this.s.store.select([b.dataset.pickId]);
        this.s.closeModal();
      }),
    );
  }
  selectParent() {
    const n = this.s.selected[0],
      p = n && logicalParent(this.s.doc.root, n.id);
    if (p) this.s.store.select([p.id]);
  }
  selectChild() {
    const n = this.s.selected[0],
      child = n && contentChildren(n).find((c) => !isLocked(this.s.doc, c.id));
    if (child) this.s.store.select([child.id]);
  }
  selectSibling(direction) {
    const n = this.s.selected[0],
      p = n && logicalParent(this.s.doc.root, n.id);
    if (!p) return;
    const children = contentChildren(p).filter((c) => !isLocked(this.s.doc, c.id));
    const index = children.findIndex((c) => c.id === n.id);
    if (children.length)
      this.s.store.select([children[(index + direction + children.length) % children.length].id]);
  }
  drawGridOverlay() {
    const s = this.s;
    this.environment.query('#grid-overlay')?.remove();
    const node = s.selected[0];
    if (!this.gridEnabled || !node || localName(node.type) !== 'Grid' || s.view === 'views') return;
    const g = this.gridGeometry(node);
    if (!g) return;
    const vr = this.environment.query('#canvas-viewport').getBoundingClientRect(),
      host = this.environment.track(this.environment.document.createElement('div'));
    host.id = 'grid-overlay';
    host.style.cssText = `left:${g.left - vr.left}px;top:${g.top - vr.top}px;width:${g.rect.width}px;height:${g.rect.height}px`;
    for (const [axis, sizes, gap] of [
      ['Column', g.columns, g.columnGap],
      ['Row', g.rows, g.rowGap],
    ]) {
      let position = 0;
      const defs = definitions(node, axis);
      sizes.forEach((size, index) => {
        const b = this.environment.track(this.environment.document.createElement('button'));
        b.className = 'grid-track-label ' + axis.toLowerCase();
        b.textContent = defs[index]?.props[axis === 'Row' ? 'Height' : 'Width'] || '*';
        b.title = `Edit ${axis.toLowerCase()} ${index}`;
        if (axis === 'Column') {
          b.style.left = position * s.zoom + 'px';
          b.style.width = Math.max(30, size * s.zoom) + 'px';
        } else {
          b.style.top = position * s.zoom + 'px';
          b.style.height = Math.max(22, size * s.zoom) + 'px';
        }
        this.environment.handler(b, 'onclick', () => this.gridEditor(axis, index));
        host.append(b);
        position += size;
        if (index < sizes.length - 1) {
          const line = this.environment.track(this.environment.document.createElement('div'));
          line.className = 'grid-track-handle ' + axis.toLowerCase();
          line.style[axis === 'Column' ? 'left' : 'top'] = position * s.zoom + 'px';
          this.environment.handler(line, 'onpointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (!s.prepareEdit() || isLocked(s.doc, node.id)) return;
            this.gesture = {
              kind: 'track',
              axis,
              index,
              nodeId: node.id,
              before: clone(s.doc),
              sizes: [...sizes],
              start: axis === 'Column' ? e.clientX : e.clientY,
            };
            this.environment.query('#canvas-viewport').setPointerCapture(e.pointerId);
          });
          host.append(line);
        }
        position += gap;
      });
    }
    this.environment.query('#canvas-viewport').append(host);
  }
  resizeTrack(e) {
    const g = this.gesture,
      s = this.s,
      n = find(s.doc.root, g.nodeId);
    const delta = ((g.axis === 'Column' ? e.clientX : e.clientY) - g.start) / s.zoom;
    const total = g.sizes[g.index] + g.sizes[g.index + 1];
    if (!Number.isFinite(total) || total < 0) return;
    const minimum = Math.min(8, total / 2),
      a = Math.max(minimum, Math.min(total - minimum, s.snapValue(g.sizes[g.index] + delta))),
      b = total - a;
    const defs = definitions(n, g.axis);
    defs[g.index].props[g.axis === 'Row' ? 'Height' : 'Width'] = String(Math.round(a));
    defs[g.index + 1].props[g.axis === 'Row' ? 'Height' : 'Width'] = String(Math.round(b));
    writeDefinitions(n, g.axis, defs);
    s.renderCanvas();
  }
  gridEditor(axis = 'Row', active = 0) {
    const s = this.s;
    if (!s.prepareEdit()) return;
    let n = s.selected[0];
    if (n && isLocked(s.doc, n.id)) {
      this.environment.notify('Unlock this grid before editing tracks.');
      return;
    }
    if (!n || localName(n.type) !== 'Grid') {
      this.environment.notify('Select a Grid first.');
      return;
    }
    const nodeId = n.id;
    const render = () => {
      n = find(s.doc.root, nodeId);
      if (!n) return;
      const list = definitions(n, axis),
        key = axis === 'Row' ? 'Height' : 'Width';
      s.modal(
        'Visual grid editor',
        `<div class="feature-tabs"><button data-axis="Row" class="${axis === 'Row' ? 'active' : ''}">Rows</button><button data-axis="Column" class="${axis === 'Column' ? 'active' : ''}">Columns</button><span class="spacer"></span><button class="button" id="track-add">+ Track</button></div><p>Drag track dividers on the artboard, or edit sizes and constraints here. Divider drags convert adjacent tracks to pixels.</p><div class="track-table"><div class="track-header"><span>Track</span><span>Size</span><span>Minimum</span><span>Maximum</span><span>Shared group</span><span></span></div>${list.map((d, i) => `<div class="track-row" data-track-index="${i}"><strong>${axis} ${i}</strong><input data-track-prop="${key}" value="${esc(d.props[key] || '*')}"><input data-track-prop="Min${key}" value="${esc(d.props['Min' + key] || '')}"><input data-track-prop="Max${key}" value="${esc(d.props['Max' + key] || '')}"><input data-track-prop="SharedSizeGroup" value="${esc(d.props.SharedSizeGroup || '')}"><button data-remove-track="${i}" title="Remove track">×</button></div>`).join('')}</div>`,
        [
          {
            label: 'Apply tracks',
            primary: true,
            run: () => {
              if (!s.prepareEdit() || isLocked(s.doc, nodeId)) return;
              const next = clone(definitions(n, axis));
              this.environment.all('[data-track-index]').forEach((row) => {
                const d = next[Number(row.dataset.trackIndex)];
                this.environment.all('[data-track-prop]', row).forEach((input) => {
                  const k = input.dataset.trackProp,
                    v = input.value.trim();
                  if (k === key && !/^(Auto|(?:\d*\.?\d+)?\*|\d+(?:\.\d+)?)$/.test(v))
                    throw Error('Use Auto, a positive size, or star units.');
                  if (
                    (k.startsWith('Min') || k.startsWith('Max')) &&
                    v &&
                    (!Number.isFinite(Number(v)) || Number(v) < 0)
                  )
                    throw Error('Constraints must be nonnegative numbers.');
                  if (v) d.props[k] = v;
                  else delete d.props[k];
                });
              });
              s.store.transaction('Edit grid tracks', () =>
                writeDefinitions(find(s.doc.root, nodeId), axis, next),
              );
              s.closeModal();
              this.gridEnabled = true;
              s.drawSelection();
            },
          },
        ],
        true,
      );
      this.environment.all('[data-axis]').forEach((b) =>
        this.environment.handler(b, 'onclick', () => {
          axis = b.dataset.axis;
          render();
        }),
      );
      this.environment.handler(this.environment.query('#track-add'), 'onclick', () => {
        s.store.transaction('Insert grid track', () =>
          insertTrack(n, axis, definitions(n, axis).length),
        );
        render();
      });
      this.environment.all('[data-remove-track]').forEach((b) =>
        this.environment.handler(b, 'onclick', () => {
          try {
            s.store.transaction('Remove grid track', () =>
              removeTrack(n, axis, Number(b.dataset.removeTrack)),
            );
            render();
          } catch (error) {
            this.environment.notify(error.message);
          }
        }),
      );
    };
    this.gridEnabled = true;
    s.drawSelection();
    render();
  }
  dispose() {
    if (this.disposed) return;
    try {
      if (this.gesture) this.cancel();
      this.clearCue();
      this.environment.query('#grid-overlay')?.remove();
      this.environment.query('#hover-outline')?.remove();
    } finally {
      super.dispose();
    }
  }
}
