import { ScrollButtons } from './scroll-buttons.js';
import { dockRatioLimits } from '../core/docking.js';
import { findDock, dockGroups, locatePanel, clampFloat } from '../core/docking.js';
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const button = (text, title, action) => {
  const b = el('button', 'dock-button', text);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.onclick = (e) => {
    e.stopPropagation();
    action(e);
  };
  return b;
};
const edgeNames = {
  left: 'Left',
  right: 'Right',
  top: 'Top',
  bottom: 'Bottom',
  center: 'Join tabs',
};
const symbols = { left: '◧', right: '◨', top: '⬒', bottom: '⬓', center: '▣' };
/** DOM docking control. Content nodes are moved, never cloned or reconstructed. */
export class DockWorkspace extends EventTarget {
  constructor(
    host,
    model,
    {
      beforeActivate = () => true,
      onChange = () => {},
      onVisibility = () => {},
      keyboardScope = 'workspace',
    } = {},
  ) {
    super();
    if (!['workspace', 'document'].includes(keyboardScope))
      throw Error('Invalid docking keyboard scope.');
    this.keyboardScope = keyboardScope;
    this.host = host;
    this.model = model;
    this.beforeActivate = beforeActivate;
    this.onChange = onChange;
    this.onVisibility = onVisibility;
    this.contents = new Map();
    this.flyout = null;
    this.drag = null;
    this.disposed = false;
    this.visible = new Set();
    this.strips = new Map();
    this.tabScroll = new Map();
    host.classList.add('dock-workspace');
    this.parking = el('div', 'dock-parking');
    this.parking.hidden = true;
    this.shell = el('div', 'dock-shell');
    this.live = el('div', 'dock-announcer');
    this.live.setAttribute('aria-live', 'polite');
    host.append(this.parking, this.shell, this.live);
    this.changed = (event) => {
      if (event.label === 'Raise floating window') {
        this.paintZ();
      } else if (
        event.label === 'Activate panel' &&
        this.renderedFlyout === this.flyout &&
        dockGroups(this.model.state).every((g) => this.renderedGroups?.get(g.id) === g.active)
      ) {
        this.paintActive();
      } else this.render();
      this.onChange(event.label);
    };
    model.addEventListener('change', this.changed);
    this.keydown = (e) => this.key(e);
    document.addEventListener('keydown', this.keydown, true);
    this.outside = (e) => {
      if (this.flyout && !e.target.closest('.dock-flyout,.dock-auto-tab,.dock-menu'))
        this.closeFlyout();
      if (this.menu && !this.menu.contains(e.target)) this.closeMenu();
    };
    document.addEventListener('pointerdown', this.outside);
    this.contentFocus = (e) => {
      if (this.rendering) return;
      const id = e.target.closest('[data-dock-content]')?.dataset.dockContent;
      if (id && this.visible.has(id) && id !== this.model.state.activePanel) this.activate(id);
      if (
        e.type === 'focusin' &&
        this.flyout &&
        !e.target.closest('.dock-flyout,.dock-auto-strip,.dock-menu')
      )
        this.closeFlyout();
    };
    host.addEventListener('pointerdown', this.contentFocus);
    document.addEventListener('focusin', this.contentFocus);
    this.observer = new ResizeObserver(() => {
      this.clampWindows();
      this.dispatchEvent(new Event('resize'));
    });
    this.observer.observe(host);
  }
  mount(id, node) {
    if (!this.model.panels.has(id)) throw Error('Register the docking panel before mounting it.');
    if (this.disposed) throw Error('DockWorkspace is disposed.');
    for (const [other, content] of this.contents)
      if (other !== id && content === node)
        throw Error('A content node can only belong to one panel.');
    if (this.contents.get(id) !== node) this.unmount(id);
    this.contents.set(id, node);
    node.dataset.dockContent = id;
    this.parking.append(node);
    return node;
  }
  /** Detach content without destroying it or changing the caller-owned layout model. */
  unmount(id) {
    const node = this.contents.get(id);
    if (!node) return null;
    this.contents.delete(id);
    delete node.dataset.dockContent;
    node.remove();
    return node;
  }
  activate(id, { focus = false } = {}) {
    if (this.disposed) return false;
    if (this.beforeActivate(id) === false) return false;
    const place = locatePanel(this.model.state, id);
    if (this.model.state.zoomedGroup && place?.group?.id !== this.model.state.zoomedGroup)
      this.model.zoomGroup(null);
    if (place?.kind === 'autoHide') {
      this.flyout = id;
      this.model.activate(id);
      this.render();
    } else this.model.activate(id);
    requestAnimationFrame(() => {
      if (this.disposed) return;
      this.revealTab(id);
      if (focus) this.focus(id);
    });
    return true;
  }
  show(id) {
    return this.activate(id, { focus: true });
  }
  hide(id) {
    const descriptor = this.model.panels.get(id);
    if (descriptor?.onClose?.() === false) return false;
    if (this.flyout === id) this.flyout = null;
    this.model.hide(id);
    return true;
  }
  focus(id) {
    const node = this.contents.get(id);
    if (node?.closest('[hidden]')) return;
    const target = node?.querySelector(
      '[autofocus],textarea,input:not([type=hidden]),[tabindex="0"],button',
    );
    if (target) target.focus({ preventScroll: true });
    else {
      const group = this.shell.querySelector(`[data-dock-panel="${id}"]`);
      group?.focus({ preventScroll: true });
    }
  }
  title(id) {
    return this.model.panels.get(id)?.title || id;
  }
  notify(message) {
    this.live.textContent = message;
  }
  render() {
    if (this.disposed) return;
    for (const [id, strip] of this.strips) {
      this.tabScroll.set(id, strip.viewport.scrollLeft);
      strip.dispose();
    }
    this.strips.clear();
    this.rendering = true;
    const focused = document.activeElement,
      selection =
        focused && typeof focused.selectionStart === 'number'
          ? { start: focused.selectionStart, end: focused.selectionEnd }
          : null;
    const oldVisible = this.visible;
    this.visible = new Set();
    for (const node of this.contents.values()) this.parking.append(node);
    this.shell.replaceChildren();
    const d = this.model.state;
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      const strip = el('nav', 'dock-auto-strip dock-auto-' + edge);
      strip.setAttribute('aria-label', edgeNames[edge] + ' auto-hidden windows');
      for (const id of d.autoHide[edge]) {
        const tab = button(this.title(id), 'Show ' + this.title(id), () => {
          if (this.flyout === id) this.closeFlyout();
          else this.activate(id);
        });
        tab.className = 'dock-auto-tab';
        tab.dataset.panel = id;
        tab.setAttribute('aria-expanded', String(this.flyout === id));
        tab.onpointerdown = (e) =>
          this.startDrag(
            e,
            [id],
            { id: 'auto-' + id, panels: [id], kind: 'tool' },
            { flyout: true },
          );
        tab.onmouseenter = () => {
          if (this.drag) return;
          clearTimeout(this.hoverTimer);
          this.hoverTimer = setTimeout(() => this.activate(id), 350);
        };
        tab.onmouseleave = () => clearTimeout(this.hoverTimer);
        tab.oncontextmenu = (e) => this.context(e, id);
        strip.append(tab);
      }
      this.shell.append(strip);
      this.shell.classList.toggle('has-auto-' + edge, !!d.autoHide[edge].length);
    }
    const root = el('div', 'dock-root');
    root.dataset.dockRoot = 'true';
    this.rootElement = root;
    const zoomed = d.zoomedGroup && findDock(d, d.zoomedGroup);
    if (zoomed) root.append(this.node(zoomed));
    else if (d.root) root.append(this.node(d.root));
    else {
      const empty = el('div', 'dock-empty');
      empty.append(
        el('strong', '', 'No windows open'),
        el('span', '', 'Reopen a window from the Window menu.'),
      );
      root.append(empty);
    }
    this.shell.append(root);
    if (!zoomed)
      for (const floating of d.floating) {
        const frame = el('section', 'dock-floating');
        frame.dataset.floatId = floating.id;
        frame.setAttribute('aria-label', 'Floating window');
        frame.style.zIndex = String(20 + d.floating.indexOf(floating));
        const rect = floating.maximized
          ? { x: 0, y: 0, width: this.host.clientWidth, height: this.host.clientHeight }
          : clampFloat(floating.rect, this.host.clientWidth, this.host.clientHeight);
        this.applyRect(frame, rect);
        frame.append(this.node(floating.root, floating));
        frame.onpointerdown = () => this.model.raiseFloat(floating.id);
        if (!floating.maximized)
          for (const side of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
            const handle = el('div', 'dock-float-resize resize-' + side);
            handle.onpointerdown = (e) => this.resizeFloat(e, floating, side, frame);
            frame.append(handle);
          }
        this.shell.append(frame);
      }
    if (this.flyout) {
      const place = locatePanel(d, this.flyout);
      if (place?.kind === 'autoHide') {
        const box = el('section', 'dock-flyout flyout-' + place.edge);
        box.setAttribute('aria-label', this.title(this.flyout));
        const header = this.header(
          { id: 'flyout', kind: 'tool', active: this.flyout, panels: [this.flyout] },
          null,
          true,
        );
        const body = el('div', 'dock-group-body');
        this.attach(this.flyout, body);
        box.append(header, body);
        const size = this.model.state.autoHideSize?.[place.edge];
        if (size)
          box.style[['left', 'right'].includes(place.edge) ? 'width' : 'height'] =
            Math.min(
              size,
              (['left', 'right'].includes(place.edge)
                ? this.host.clientWidth
                : this.host.clientHeight) - 50,
            ) + 'px';
        const handle = el(
          'div',
          'dock-flyout-resize resize-' +
            { left: 'e', right: 'w', top: 's', bottom: 'n' }[place.edge],
        );
        handle.onpointerdown = (e) => this.resizeFlyout(e, place.edge, box);
        box.append(handle);
        this.shell.append(box);
      } else this.flyout = null;
    }
    for (const id of new Set([...oldVisible, ...this.visible]))
      if (oldVisible.has(id) !== this.visible.has(id)) this.onVisibility(id, this.visible.has(id));
    if (
      focused &&
      this.host.contains(focused) &&
      !focused.closest('[hidden]') &&
      this.visible.has(focused.closest('[data-dock-content]')?.dataset.dockContent)
    ) {
      focused.focus({ preventScroll: true });
      if (selection)
        try {
          focused.setSelectionRange(selection.start, selection.end);
        } catch {}
    }
    for (const [id, strip] of this.strips) {
      strip.viewport.scrollLeft = this.tabScroll.get(id) || 0;
      strip.update();
    }
    this.renderedGroups = new Map(dockGroups(d).map((g) => [g.id, g.active]));
    this.renderedFlyout = this.flyout;
    this.rendering = false;
    this.dispatchEvent(new Event('resize'));
  }
  revealTab(id) {
    const tab = this.shell.querySelector(`[data-dock-panel="${id}"]`),
      group = tab?.closest('[data-dock-group]');
    this.strips.get(group?.dataset.dockGroup)?.reveal(tab?.closest('.dock-tab-wrap'));
  }
  paintActive() {
    for (const group of this.shell.querySelectorAll('[data-dock-group]'))
      group.classList.toggle(
        'dock-group-active',
        !!findDock(this.model.state, group.dataset.dockGroup)?.panels.includes(
          this.model.state.activePanel,
        ),
      );
  }
  paintZ() {
    for (const frame of this.shell.querySelectorAll('[data-float-id]'))
      frame.style.zIndex = String(
        20 + this.model.state.floating.findIndex((f) => f.id === frame.dataset.floatId),
      );
  }
  attach(id, host) {
    const content = this.contents.get(id);
    if (content) {
      host.append(content);
      this.visible.add(id);
    } else host.append(el('div', 'dock-empty', 'Window is not available.'));
  }
  node(node, floating = null) {
    if (node.type === 'split') {
      const box = el('div', 'dock-split split-' + node.axis);
      box.dataset.splitId = node.id;
      this.applyRatio(box, node.ratio, node.axis);
      const first = el('div', 'dock-branch'),
        second = el('div', 'dock-branch'),
        splitter = el('div', 'dock-splitter');
      first.append(this.node(node.first, floating));
      second.append(this.node(node.second, floating));
      splitter.tabIndex = 0;
      splitter.setAttribute('role', 'separator');
      splitter.setAttribute('aria-label', 'Resize docked windows');
      splitter.setAttribute(
        'aria-orientation',
        node.axis === 'horizontal' ? 'vertical' : 'horizontal',
      );
      splitter.setAttribute('aria-valuemin', '5');
      splitter.setAttribute('aria-valuemax', '95');
      splitter.setAttribute('aria-valuenow', String(Math.round(node.ratio * 100)));
      splitter.dataset.splitId = node.id;
      splitter.onpointerdown = (e) => this.resizeSplit(e, node, box);
      splitter.ondblclick = () => this.model.resizeSplit(node.id, 0.5);
      box.append(first, splitter, second);
      return box;
    }
    const box = el(
      'section',
      'dock-group ' + (node.kind === 'document' ? 'dock-document-group' : 'dock-tool-group'),
    );
    box.dataset.dockGroup = node.id;
    box.classList.toggle('dock-group-active', node.panels.includes(this.model.state.activePanel));
    box.append(this.header(node, floating));
    const tabs = el('div', 'dock-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', node.kind === 'document' ? 'Documents' : 'Tool windows');
    const sorted = [
      ...node.panels.filter((id) => this.model.state.pinned.includes(id)),
      ...node.panels.filter((id) => !this.model.state.pinned.includes(id)),
    ];
    for (const id of sorted) {
      const wrap = el('div', 'dock-tab-wrap');
      wrap.classList.toggle('active', node.active === id);
      wrap.classList.toggle('pinned', this.model.state.pinned.includes(id));
      const tab = el('button', 'dock-tab');
      tab.type = 'button';
      tab.dataset.dockPanel = id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(node.active === id));
      tab.setAttribute('aria-controls', 'dock-body-' + node.id);
      tab.tabIndex = node.active === id ? 0 : -1;
      tab.title = this.title(id);
      tab.append(
        el(
          'span',
          'dock-tab-icon',
          this.model.panels.get(id)?.icon || (node.kind === 'document' ? '◇' : '▤'),
        ),
        el('span', 'dock-tab-text', this.title(id)),
      );
      tab.onclick = () => this.activate(id);
      wrap.onpointerdown = (e) => this.startDrag(e, [id], node);
      tab.oncontextmenu = (e) => this.context(e, id);
      tab.ondblclick = (e) => {
        if (e.ctrlKey || e.metaKey) this.toggleFloat(id);
        else if (node.kind === 'document') this.model.pin(id);
        else this.toggleFloat(id);
      };
      wrap.append(tab);
      if (node.kind === 'document')
        wrap.append(
          button(this.model.state.pinned.includes(id) ? '◆' : '◇', 'Pin tab', () =>
            this.model.pin(id),
          ),
        );
      wrap.append(button('×', 'Close ' + this.title(id), () => this.hide(id)));
      tabs.append(wrap);
    }
    const body = el('div', 'dock-group-body');
    body.id = 'dock-body-' + node.id;
    body.setAttribute('role', 'tabpanel');
    body.setAttribute('aria-label', this.title(node.active));
    this.attach(node.active, body);
    const strip = new ScrollButtons(tabs, {
      label: node.kind === 'document' ? 'documents' : 'tool windows',
    });
    this.strips.set(node.id, strip);
    box.append(strip.host, body);
    requestAnimationFrame(() => strip.update());
    return box;
  }
  header(group, floating, flyout = false) {
    const header = el('header', 'dock-group-header');
    const title = el(
      'span',
      'dock-group-title',
      flyout
        ? this.title(group.active)
        : group.kind === 'document'
          ? floating
            ? 'Floating documents'
            : 'Documents'
          : this.title(group.active),
    );
    title.title = 'Drag to move this group';
    header.append(title);
    header.onpointerdown = (e) => {
      if (!e.target.closest('button')) this.startDrag(e, group.panels, group, { floating, flyout });
    };
    header.ondblclick = (e) => {
      if (e.target.closest('button')) return;
      if (floating && !e.ctrlKey && !e.metaKey) this.model.maximizeFloat(floating.id);
      else this.toggleFloat(group.active, true);
    };
    if (group.panels.length > 1)
      header.append(
        button('☷', 'All tabs in this group', (e) =>
          this.tabList(e, group, header.getBoundingClientRect()),
        ),
      );
    header.append(
      button('▾', 'Window actions', (e) =>
        this.context(e, group.active, header.getBoundingClientRect()),
      ),
    );
    if (group.kind === 'tool')
      header.append(
        button(flyout ? '⌖' : '⌁', flyout ? 'Pin window' : 'Auto-hide window', () =>
          flyout
            ? this.model.dockBack(group.active)
            : this.model.autoHide(
                group.active,
                this.model.state.placements[group.active]?.edge || 'right',
              ),
        ),
      );
    if (!flyout)
      header.append(
        button(
          this.model.state.zoomedGroup === group.id ? '❐' : '□',
          floating ? 'Maximize or restore floating window' : 'Maximize or restore tab group',
          () => (floating ? this.model.maximizeFloat(floating.id) : this.model.zoomGroup(group.id)),
        ),
      );
    header.append(button('×', 'Close ' + this.title(group.active), () => this.hide(group.active)));
    return header;
  }
  applyRatio(box, ratio, axis) {
    box.style[axis === 'horizontal' ? 'gridTemplateColumns' : 'gridTemplateRows'] =
      `minmax(0,${ratio}fr) 5px minmax(0,${1 - ratio}fr)`;
  }
  applyRect(frame, rect) {
    Object.assign(frame.style, {
      left: rect.x + 'px',
      top: rect.y + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
    });
  }
  clampWindows() {
    for (const frame of this.shell.querySelectorAll('[data-float-id]')) {
      const f = this.model.state.floating.find((n) => n.id === frame.dataset.floatId);
      if (f)
        this.applyRect(
          frame,
          f.maximized
            ? { x: 0, y: 0, width: this.host.clientWidth, height: this.host.clientHeight }
            : clampFloat(f.rect, this.host.clientWidth, this.host.clientHeight),
        );
    }
  }
  gesture(event, move, finish, cancel) {
    event.preventDefault();
    event.stopPropagation();
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onCancel, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onCancel);
      this.cancelGesture = null;
      document.body.classList.remove('dock-gesturing');
    };
    const onMove = (e) => {
      if (e.pointerId === event.pointerId) move(e);
    };
    const onUp = (e) => {
      if (e.pointerId !== event.pointerId) return;
      cleanup();
      finish(e);
    };
    const onCancel = () => {
      cleanup();
      cancel?.();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCancel();
      }
    };
    this.cancelGesture?.();
    this.cancelGesture = onCancel;
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onCancel);
    document.body.classList.add('dock-gesturing');
  }
  chromeHeight() {
    const value =
      typeof getComputedStyle === 'function'
        ? parseFloat(getComputedStyle(this.host).getPropertyValue('--dock-chrome-height'))
        : NaN;
    return Number.isFinite(value) && value >= 0 ? value : 52;
  }
  resizeSplit(event, node, box) {
    if (event.button !== 0) return;
    const rect = box.getBoundingClientRect(),
      horizontal = node.axis === 'horizontal';
    let ratio = node.ratio;
    this.gesture(
      event,
      (e) => {
        const size = horizontal ? rect.width : rect.height;
        const limits = dockRatioLimits(node, this.model.panels, size, {
          chromeHeight: this.chromeHeight(),
        });
        ratio = Math.max(
          limits[0],
          Math.min(
            limits[1],
            ((horizontal ? e.clientX - rect.left : e.clientY - rect.top) - 2.5) /
              Math.max(1, size - 5),
          ),
        );
        this.applyRatio(box, ratio, node.axis);
        this.dispatchEvent(new Event('resize'));
      },
      () => this.model.resizeSplit(node.id, ratio),
      () => {
        this.applyRatio(box, node.ratio, node.axis);
        this.dispatchEvent(new Event('resize'));
      },
    );
  }
  resizeFlyout(event, edge, box) {
    if (event.button !== 0) return;
    const horizontal = ['left', 'right'].includes(edge),
      rect = box.getBoundingClientRect(),
      initial = horizontal ? rect.width : rect.height;
    let size = initial;
    this.gesture(
      event,
      (e) => {
        const delta = horizontal ? e.clientX - event.clientX : e.clientY - event.clientY;
        size = Math.max(
          140,
          Math.min(
            (horizontal ? this.host.clientWidth : this.host.clientHeight) - 50,
            initial + (['right', 'bottom'].includes(edge) ? -delta : delta),
          ),
        );
        box.style[horizontal ? 'width' : 'height'] = size + 'px';
        this.dispatchEvent(new Event('resize'));
      },
      () => this.model.setAutoHideSize(edge, size),
      () => {
        box.style[horizontal ? 'width' : 'height'] = initial + 'px';
        this.dispatchEvent(new Event('resize'));
      },
    );
  }
  resizeFloat(event, floating, side, frame) {
    if (event.button !== 0) return;
    const hostRect = this.host.getBoundingClientRect(),
      r = frame.getBoundingClientRect(),
      start = {
        x: r.left - hostRect.left,
        y: r.top - hostRect.top,
        width: r.width,
        height: r.height,
      };
    let rect = start;
    this.gesture(
      event,
      (e) => {
        const dx = e.clientX - event.clientX,
          dy = e.clientY - event.clientY;
        rect = { ...start };
        if (side.includes('e')) rect.width += dx;
        if (side.includes('s')) rect.height += dy;
        if (side.includes('w')) {
          rect.width -= dx;
          rect.x += dx;
        }
        if (side.includes('n')) {
          rect.height -= dy;
          rect.y += dy;
        }
        if (rect.width < 180) {
          if (side.includes('w')) rect.x = start.x + start.width - 180;
          rect.width = 180;
        }
        if (rect.height < 100) {
          if (side.includes('n')) rect.y = start.y + start.height - 100;
          rect.height = 100;
        }
        rect = clampFloat(rect, this.host.clientWidth, this.host.clientHeight);
        this.applyRect(frame, rect);
        this.dispatchEvent(new Event('resize'));
      },
      () => this.model.setFloatRect(floating.id, rect),
      () => this.applyRect(frame, start),
    );
  }
  startDrag(event, ids, group, { floating = null, flyout = false } = {}) {
    if (event.button !== 0 || event.target.closest('.dock-button')) return;
    const start = { x: event.clientX, y: event.clientY },
      groupElement = event.target.closest('.dock-group,.dock-flyout'),
      original = (groupElement || event.target).getBoundingClientRect();
    clearTimeout(this.hoverTimer);
    let moved = false,
      last = event,
      drop = null;
    const cleanup = () => {
      cancelAnimationFrame(this.scrollFrame);
      this.drag = null;
      this.overlay?.remove();
      this.overlay = null;
      this.ghost?.remove();
      this.ghost = null;
      this.host.classList.remove('dock-dragging');
    };
    this.gesture(
      event,
      (e) => {
        last = e;
        if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
        if (!moved) {
          moved = true;
          this.drag = { ids, groupId: group.id };
          this.host.classList.add('dock-dragging');
          this.ghost = el(
            'div',
            'dock-drag-ghost',
            ids.length === 1 ? this.title(ids[0]) : ids.length + ' windows',
          );
          document.body.append(this.ghost);
          const tick = () => {
            if (!this.drag) return;
            const hit = document.elementFromPoint(last.clientX, last.clientY),
              tabs = hit?.closest('.dock-tabs');
            if (tabs) {
              const r = tabs.getBoundingClientRect(),
                delta = last.clientX - r.left < 30 ? -10 : r.right - last.clientX < 30 ? 10 : 0;
              if (delta) {
                tabs.scrollLeft += delta;
                drop = this.dropAt(last, ids, group.id);
                this.drawDrop(drop);
              }
            }
            this.scrollFrame = requestAnimationFrame(tick);
          };
          this.scrollFrame = requestAnimationFrame(tick);
        }
        this.ghost.style.left = e.clientX + 16 + 'px';
        this.ghost.style.top = e.clientY + 15 + 'px';
        drop = this.dropAt(e, ids, group.id);
        this.drawDrop(drop);
      },
      (e) => {
        if (moved) drop = this.dropAt(e, ids, group.id);
        cleanup();
        if (!moved) return;
        const suppress = (ev) => {
          ev.preventDefault();
          ev.stopImmediatePropagation();
        };
        document.addEventListener('click', suppress, true);
        setTimeout(() => document.removeEventListener('click', suppress, true), 0);
        try {
          if (drop) {
            if (this.beforeActivate(ids[0]) === false) return;
            this.model.dock(ids, drop.id, drop.position, drop.index);
            this.notify('Docked ' + this.title(ids[0]) + ' · ' + edgeNames[drop.position]);
          } else {
            const host = this.host.getBoundingClientRect(),
              rect = clampFloat(
                {
                  x: e.clientX - host.left - 40,
                  y: e.clientY - host.top - 14,
                  width: Math.max(300, original.width),
                  height: Math.max(220, original.height),
                },
                this.host.clientWidth,
                this.host.clientHeight,
              );
            if (
              floating &&
              floating.root.id === group.id &&
              group.panels.length === ids.length &&
              !flyout
            )
              this.model.setFloatRect(floating.id, rect);
            else this.model.float(ids, rect);
            this.notify('Floating ' + this.title(ids[0]));
          }
        } catch (error) {
          this.notify(error.message);
        }
      },
      cleanup,
    );
  }
  dropAt(event, ids, sourceId) {
    if (event.ctrlKey || event.metaKey) return null;
    const x = event.clientX,
      y = event.clientY,
      hit = document.elementFromPoint(x, y),
      guide = hit?.closest('[data-dock-guide]');
    if (guide) {
      const target = findDock(this.model.state, guide.dataset.target);
      return this.validDrop(
        { id: target?.id || null, position: guide.dataset.dockGuide, rect: this.lastTargetRect },
        ids,
        sourceId,
      );
    }
    const stripHit = hit?.closest('.dock-tabs'),
      tabGroup = stripHit?.closest('[data-dock-group]');
    if (tabGroup) {
      const target = findDock(this.model.state, tabGroup.dataset.dockGroup);
      if (target) {
        const wrap = hit.closest('.dock-tab-wrap'),
          tab = wrap?.querySelector('[data-dock-panel]'),
          tr = wrap?.getBoundingClientRect(),
          sr = stripHit.getBoundingClientRect();
        const after = tr ? x > tr.left + tr.width / 2 : true,
          index = tab
            ? target.panels.indexOf(tab.dataset.dockPanel) + (after ? 1 : 0)
            : target.panels.length;
        return this.validDrop(
          {
            id: target.id,
            position: 'center',
            index,
            rect: tabGroup.getBoundingClientRect(),
            marker: {
              x: tr
                ? after
                  ? tr.right
                  : tr.left
                : Math.min(
                    sr.right,
                    stripHit.lastElementChild?.getBoundingClientRect().right || sr.left,
                  ),
              y: sr.top,
              height: sr.height,
            },
          },
          ids,
          sourceId,
        );
      }
    }
    const rr = this.rootElement.getBoundingClientRect();
    if (x < rr.left || x > rr.right || y < rr.top || y > rr.bottom) return null;
    if (!this.model.state.root) return { id: null, position: 'center', rect: rr };
    const outer =
      x - rr.left < 26
        ? 'left'
        : rr.right - x < 26
          ? 'right'
          : y - rr.top < 26
            ? 'top'
            : rr.bottom - y < 26
              ? 'bottom'
              : null;
    if (outer && this.model.state.root)
      return this.validDrop(
        { id: this.model.state.root.id, position: outer, rect: rr, outer: true },
        ids,
        sourceId,
      );
    const targetEl = hit?.closest('[data-dock-group]');
    if (!targetEl) return null;
    const target = findDock(this.model.state, targetEl.dataset.dockGroup);
    if (!target) return null;
    const rect = targetEl.getBoundingClientRect(),
      rx = (x - rect.left) / rect.width,
      ry = (y - rect.top) / rect.height;
    let position =
        rx < 0.22
          ? 'left'
          : rx > 0.78
            ? 'right'
            : ry < 0.2
              ? 'top'
              : ry > 0.8
                ? 'bottom'
                : 'center',
      index;
    const tab = hit.closest('[data-dock-panel]');
    if (tab && target.panels.includes(tab.dataset.dockPanel)) {
      position = 'center';
      const tr = tab.getBoundingClientRect();
      index = target.panels.indexOf(tab.dataset.dockPanel) + (x > tr.left + tr.width / 2 ? 1 : 0);
    }
    return this.validDrop({ id: target.id, position, index, rect }, ids, sourceId);
  }
  validDrop(drop, ids, sourceId) {
    if (!drop.id && !this.model.state.root) return drop;
    const target = findDock(this.model.state, drop.id);
    if (!target || (target.type === 'split' && drop.position === 'center')) return null;
    if (
      target.type === 'group' &&
      target.id === sourceId &&
      target.panels.every((id) => ids.includes(id))
    )
      return null;
    if (
      drop.position === 'center' &&
      target.kind === 'tool' &&
      ids.some((id) => this.model.panels.get(id)?.kind === 'document')
    )
      return { ...drop, position: 'right' };
    return drop;
  }
  drawDrop(drop) {
    this.overlay?.remove();
    this.overlay = null;
    if (!drop) return;
    const { rect: r, position } = drop;
    if (!r) return;
    this.lastTargetRect = r;
    const overlay = el('div', 'dock-drop-overlay');
    this.overlay = overlay;
    const preview = el('div', 'dock-drop-preview');
    let x = r.left,
      y = r.top,
      w = r.width,
      h = r.height;
    if (position === 'left') w *= 0.3;
    if (position === 'right') {
      x += w * 0.7;
      w *= 0.3;
    }
    if (position === 'top') h *= 0.3;
    if (position === 'bottom') {
      y += h * 0.7;
      h *= 0.3;
    }
    Object.assign(preview.style, {
      left: x + 'px',
      top: y + 'px',
      width: w + 'px',
      height: h + 'px',
    });
    preview.append(el('span', '', drop.index === undefined ? edgeNames[position] : 'Insert tab'));
    overlay.append(preview);
    if (drop.marker && position === 'center') {
      const marker = el('div', 'dock-tab-insertion');
      Object.assign(marker.style, {
        left: drop.marker.x + 'px',
        top: drop.marker.y + 'px',
        height: drop.marker.height + 'px',
      });
      overlay.append(marker);
    }
    const compass = el('div', 'dock-compass');
    Object.assign(compass.style, {
      left: r.left + r.width / 2 + 'px',
      top: r.top + r.height / 2 + 'px',
    });
    for (const position of ['top', 'left', 'center', 'right', 'bottom']) {
      if (position === 'center' && findDock(this.model.state, drop.id)?.type === 'split') continue;
      const b = el('span', 'guide-' + position, symbols[position]);
      b.dataset.dockGuide = position;
      b.dataset.target = drop.id || '';
      b.title = edgeNames[position];
      b.classList.toggle('active', position === drop.position);
      compass.append(b);
    }
    overlay.append(compass);
    document.body.append(overlay);
  }
  toggleFloat(id, whole = false) {
    const p = locatePanel(this.model.state, id);
    if (p?.floating || p?.kind === 'autoHide') {
      this.model.dockBack(id);
      return;
    }
    const bounds = this.host.getBoundingClientRect();
    this.model.float(
      whole && p?.group ? p.group.panels : id,
      clampFloat(
        this.model.state.placements[id]?.floatingRect || {
          x: bounds.width * 0.22,
          y: 50,
          width: Math.min(620, bounds.width * 0.6),
          height: Math.min(450, bounds.height * 0.7),
        },
        bounds.width,
        bounds.height,
      ),
    );
  }
  tabList(event, group, anchor) {
    event.preventDefault?.();
    event.stopPropagation?.();
    this.closeMenu();
    this.menuReturn = event.target;
    const menu = el('div', 'dock-menu');
    menu.setAttribute('role', 'menu');
    this.menu = menu;
    for (const id of group.panels) {
      const b = button((id === group.active ? '✓ ' : '') + this.title(id), this.title(id), () => {
        this.closeMenu();
        this.show(id);
      });
      b.setAttribute('role', 'menuitem');
      menu.append(b);
    }
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(anchor.left, window.innerWidth - rect.width - 4)) + 'px';
    menu.style.top =
      Math.max(4, Math.min(anchor.bottom, window.innerHeight - rect.height - 4)) + 'px';
    menu.querySelector('button')?.focus();
  }
  closeFlyout() {
    if (!this.flyout) return;
    const focused = document.activeElement?.closest('.dock-flyout'),
      id = this.flyout;
    this.flyout = null;
    this.render();
    if (focused) this.shell.querySelector(`[data-panel="${id}"]`)?.focus();
  }
  closeMenu() {
    const focused = this.menu?.contains(document.activeElement);
    this.menu?.remove();
    this.menu = null;
    if (focused) this.menuReturn?.focus?.({ preventScroll: true });
  }
  context(event, id, anchor) {
    event.preventDefault?.();
    event.stopPropagation?.();
    this.closeMenu();
    this.menuReturn = event.target || document.activeElement;
    const place = locatePanel(this.model.state, id),
      descriptor = this.model.panels.get(id),
      menu = el('div', 'dock-menu');
    menu.setAttribute('role', 'menu');
    this.menu = menu;
    const add = (name, fn, disabled = false) => {
      const b = button(name, name, () => {
        this.closeMenu();
        try {
          fn();
        } catch (error) {
          this.notify(error.message);
        }
      });
      b.setAttribute('role', 'menuitem');
      b.disabled = disabled;
      menu.append(b);
    };
    menu.append(el('strong', 'dock-menu-title', this.title(id)));
    add('Float', () => this.toggleFloat(id), !!place?.floating);
    add('Dock back', () => this.model.dockBack(id));
    if (descriptor?.kind !== 'document')
      for (const edge of ['left', 'right', 'top', 'bottom'])
        add('Auto-hide · ' + edgeNames[edge], () => this.model.autoHide(id, edge));
    if (place?.group) {
      add(
        'New vertical tab group',
        () => this.model.dock(id, place.group.id, 'right'),
        place.group.panels.length < 2,
      );
      add(
        'New horizontal tab group',
        () => this.model.dock(id, place.group.id, 'bottom'),
        place.group.panels.length < 2,
      );
      add('Maximize / restore group', () => this.model.zoomGroup(place.group.id));
      if (descriptor?.kind === 'document')
        add(this.model.state.pinned.includes(id) ? 'Unpin tab' : 'Pin tab', () =>
          this.model.pin(id),
        );
    }
    for (const group of dockGroups(this.model.state).filter(
      (g) => g !== place?.group && !(g.kind === 'tool' && descriptor?.kind === 'document'),
    ))
      add('Move to ' + this.title(group.active), () => this.model.dock(id, group.id, 'center'));
    add('Close', () => this.hide(id));
    if (place?.group) {
      add('Close other tabs', () => {
        for (const other of [...place.group.panels])
          if (other !== id && !this.model.state.pinned.includes(other)) this.hide(other);
      });
      add('Close group', () => {
        for (const other of [...place.group.panels]) this.hide(other);
      });
    }
    document.body.append(menu);
    const mr = menu.getBoundingClientRect(),
      x = anchor?.left ?? event.clientX ?? 20,
      y = anchor?.bottom ?? event.clientY ?? 70;
    menu.style.left = Math.max(5, Math.min(x, window.innerWidth - mr.width - 5)) + 'px';
    menu.style.top = Math.max(5, Math.min(y, window.innerHeight - mr.height - 5)) + 'px';
    menu.querySelector('button:not(:disabled)')?.focus();
  }
  key(e) {
    if (this.disposed) return;
    const workspace = e.target.closest?.('.dock-workspace');
    if (workspace && workspace !== this.host) return;
    if (
      this.keyboardScope !== 'document' &&
      !this.host.contains(e.target) &&
      !this.menu?.contains(e.target) &&
      !this.cancelGesture
    )
      return;
    if (this.menu) {
      const items = [...this.menu.querySelectorAll('button:not(:disabled)')],
        at = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Escape', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 'Escape') this.closeMenu();
        else
          items[
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? items.length - 1
                : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          ]?.focus();
        return;
      }
    }
    if (e.key === 'Escape' && this.cancelGesture) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.cancelGesture();
      return;
    }
    if (e.key === 'Escape' && this.flyout) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.closeFlyout();
      return;
    }
    if (e.target.closest('[role="dialog"],[role="alertdialog"],[data-dock-ignore-shortcuts]'))
      return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'F6') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const visible = [...this.visible],
        at = visible.indexOf(this.model.state.activePanel),
        id = visible[(at + (e.shiftKey ? -1 : 1) + visible.length) % visible.length];
      if (id) this.activate(id, { focus: true });
      return;
    }
    if (mod && e.key === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const all = dockGroups(this.model.state).flatMap((g) => g.panels),
        at = all.indexOf(this.model.state.activePanel),
        id = all[(at + (e.shiftKey ? -1 : 1) + all.length) % all.length];
      if (id) this.activate(id, { focus: true });
      return;
    }
    if (mod && e.key === 'F4') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (this.model.state.activePanel) this.hide(this.model.state.activePanel);
      return;
    }
    const splitter = e.target.closest('.dock-splitter');
    if (
      splitter &&
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(e.key)
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const n = findDock(this.model.state, splitter.dataset.splitId),
        step = e.shiftKey ? 0.1 : 0.02;
      this.model.resizeSplit(
        n.id,
        e.key === 'Home'
          ? 0.1
          : e.key === 'End'
            ? 0.9
            : e.key === 'Enter'
              ? 0.5
              : n.ratio + (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -step : step),
      );
      this.shell.querySelector(`[data-split-id="${n.id}"].dock-splitter`)?.focus();
      return;
    }
    const tab = e.target.closest('[data-dock-panel]');
    if (tab) {
      if (
        ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete', 'Backspace', ' '].includes(e.key) ||
        (e.shiftKey && e.key === 'F10')
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const id = tab.dataset.dockPanel,
          p = locatePanel(this.model.state, id);
        if (['Delete', 'Backspace'].includes(e.key)) this.hide(id);
        else if (e.shiftKey && e.key === 'F10') this.context(e, id, tab.getBoundingClientRect());
        else if (e.key === ' ') this.activate(id);
        else {
          const tabs = [...tab.closest('.dock-tabs').querySelectorAll('[data-dock-panel]')],
            index = tabs.indexOf(tab),
            next =
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? tabs.length - 1
                  : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          this.activate(tabs[next].dataset.dockPanel);
          this.shell.querySelector(`[data-dock-panel="${tabs[next].dataset.dockPanel}"]`)?.focus();
        }
        return;
      }
    }
    if (
      e.target.closest('.dock-group-header,.dock-auto-strip,.dock-splitter') &&
      ['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(
        e.key,
      )
    )
      e.stopImmediatePropagation();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelGesture?.();
    for (const strip of this.strips.values()) strip.dispose();
    this.strips.clear();
    clearTimeout(this.hoverTimer);
    this.closeMenu();
    this.overlay?.remove();
    this.ghost?.remove();
    this.observer.disconnect();
    this.model.removeEventListener('change', this.changed);
    document.removeEventListener('keydown', this.keydown, true);
    document.removeEventListener('pointerdown', this.outside);
    document.removeEventListener('focusin', this.contentFocus);
    this.host.removeEventListener('pointerdown', this.contentFocus);
    for (const node of this.contents.values()) {
      delete node.dataset.dockContent;
      this.host.append(node);
    }
    this.contents.clear();
    this.visible.clear();
    this.host.classList.remove('dock-workspace');
    this.shell.remove();
    this.parking.remove();
    this.live.remove();
  }
}
