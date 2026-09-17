import { dockGroups, locatePanel, walkDock } from '../core/docking.js';

const transferType = 'application/x-xamora-dock';
const members = (root) => {
  const ids = [];
  walkDock(root, (node) => {
    if (node.type === 'group') ids.push(...node.panels);
  });
  return ids;
};
const bounds = (rect = {}) => {
  const result = {
    x: rect.x ?? 80,
    y: rect.y ?? 80,
    width: rect.width ?? 700,
    height: rect.height ?? 520,
  };
  if (
    !Object.values(result).every(Number.isFinite) ||
    result.width < 180 ||
    result.height < 120 ||
    result.width > 16384 ||
    result.height > 16384 ||
    Math.abs(result.x) > 100000 ||
    Math.abs(result.y) > 100000
  )
    throw new TypeError('Invalid browser window bounds.');
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, Math.round(value)]));
};
const popupCSS = `
html, body { margin:0!important; width:100%!important; height:100%!important; overflow:hidden!important; display:block!important; }
.dock-browser-bar { height:34px; display:flex; align-items:center; gap:8px; padding:0 8px; border-bottom:1px solid var(--border,#8886); font:12px system-ui; }
.dock-browser-title { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dock-browser-bar button { font:inherit; cursor:pointer; }
.dock-browser-host { position:relative!important; display:block!important; width:100%!important; height:calc(100% - 34px)!important; min-width:0!important; min-height:0!important; margin:0!important; padding:0!important; }
.dock-browser-surface { position:absolute; inset:0; }
.dock-browser-surface > .dock-floating { position:absolute!important; inset:0!important; width:100%!important; height:100%!important; border:0!important; border-radius:0!important; box-shadow:none!important; }
.dock-browser-parking { display:none!important; }
`;

/** Live same-origin popup hosts over one DockWorkspace, one layout, and one content registry. */
export class DockBrowserWindows {
  constructor(control, options = {}) {
    this.control = control;
    this.options = options;
    this.records = new Map();
    this.disposed = false;
    this.cleanups = [];
    this.bindTransfer(control.host, this.cleanups);
    const pagehide = () => {
      for (const record of [...this.records.values()]) this.release(record, { render: false });
    };
    const pageshow = (event) => {
      if (event.persisted && !this.disposed) control.render();
    };
    control.window.addEventListener('pageshow', pageshow);
    this.cleanups.push(() => control.window.removeEventListener('pageshow', pageshow));
    control.window.addEventListener('pagehide', pagehide);
    this.cleanups.push(() => control.window.removeEventListener('pagehide', pagehide));
  }
  get(id) {
    return this.records.get(id) || null;
  }
  list() {
    return [...this.records.values()].map((record) => ({
      id: record.id,
      window: record.window,
      document: record.document,
      host: record.host,
      panels: members(this.control.model.state.floating.find((f) => f.id === record.id)?.root),
    }));
  }
  pending() {
    return this.control.model.state.floating
      .filter((f) => f.browserWindow && !this.records.has(f.id))
      .map((f) => f.id);
  }
  forDocument(document) {
    return [...this.records.values()].find((record) => record.document === document) || null;
  }
  open(ids, { wholeGroup = false, rect, sourceWindow } = {}) {
    if (this.disposed || this.control.disposed) return null;
    const c = this.control,
      model = c.model;
    ids = model.require(ids);
    const place = locatePanel(model.state, ids[0]);
    if (wholeGroup && place?.group) ids = [...place.group.panels];
    const existing = place?.floating && members(place.floating.root);
    const reuse =
      existing?.length === ids.length && existing.every((id) => ids.includes(id))
        ? place.floating
        : null;
    if (reuse && this.records.has(reuse.id)) {
      this.focus(reuse.id);
      return reuse.id;
    }
    const geometry = bounds(rect || reuse?.browserWindow || {});
    const source =
      sourceWindow && [c.window, ...this.list().map((item) => item.window)].includes(sourceWindow)
        ? sourceWindow
        : c.window;
    // Allocation precedes all layout/content changes. A blocked popup cannot close or move a panel.
    const features = `popup=yes,left=${geometry.x},top=${geometry.y},width=${geometry.width},height=${geometry.height}`;
    let popup;
    try {
      popup = this.options.openWindow
        ? this.options.openWindow(features, source)
        : source.open('', '_blank', features);
    } catch (error) {
      c.notify('Browser window could not open: ' + error.message);
      return null;
    }
    if (!popup || popup === c.window || this.list().some((item) => item.window === popup)) {
      c.notify('The browser blocked the window. Allow popups for this site and try again.');
      return null;
    }
    let record;
    try {
      const doc = popup.document; // Same-origin access is required; never transfer state through arbitrary messages.
      if (!doc?.body || popup.closed || (doc.URL !== 'about:blank' && doc.URL !== ''))
        throw new Error('A fresh same-origin blank browser window is required.');
      const active = ids.includes(model.state.activePanel)
        ? model.state.activePanel
        : dockGroups(model.state).find((group) => ids.includes(group.active))?.active || ids[0];
      if (c.beforeActivate(active) === false) {
        popup.close();
        return null;
      }
      record = this.prepare(popup, doc);
      model.batch('Move to browser window', () => {
        if (!reuse) model.float(ids);
        const floating = reuse
          ? model.state.floating.find((f) => f.id === reuse.id)
          : locatePanel(model.state, ids[0]).floating;
        record.id = floating.id;
        this.records.set(record.id, record);
        const cleanup = this.options.onOpen?.({
          id: record.id,
          window: popup,
          document: doc,
          host: record.host,
          panels: [...ids],
        });
        if (typeof cleanup === 'function') record.cleanups.push(cleanup);
        model.setBrowserWindow(record.id, geometry);
      });
      c.render();
      this.startWatch();
      this.focus(record.id);
      c.show(active);
      return record.id;
    } catch (error) {
      if (record) this.release(record, { render: false });
      else
        try {
          popup.close();
        } catch {}
      c.notify('Browser window could not open: ' + error.message);
      return null;
    }
  }
  reopen(id, options) {
    const floating = this.control.model.state.floating.find((f) => f.id === id);
    if (!floating) return null;
    return this.open(members(floating.root), { rect: floating.browserWindow, ...options });
  }
  prepare(window, document) {
    const c = this.control;
    const record = {
      window,
      document,
      id: null,
      cleanups: [],
      visible: new Set(),
      frame: null,
      signature: null,
    };
    const make = (tag, className, text) => {
      const node = document.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    // Rendering mode is chosen by the parser, not by inserting a DocumentType node.
    // Initialize only the fresh, validated blank window, before portals or listeners exist.
    // This static shell never interpolates project content or executes application scripts.
    document.open();
    document.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    document.close();
    const viewport = document.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width,initial-scale=1';
    document.head.append(viewport);
    const base = document.createElement('base');
    base.href = c.document.baseURI;
    const styles = make('span', 'dock-browser-styles');
    const ownStyle = document.createElement('style');
    ownStyle.textContent = popupCSS;
    document.head.append(base, styles, ownStyle);
    const title = make('span', 'dock-browser-title');
    const bar = make('header', 'dock-browser-bar');
    const back = make('button', '', 'Return to main window');
    back.type = 'button';
    back.dataset.browserReturn = '';
    back.onclick = () => this.return(record.id);
    const main = make('button', '', 'Focus main window');
    main.type = 'button';
    main.onclick = () => c.window.focus();
    bar.append(title, main, back);
    const host = make('div', c.host.className + ' dock-browser-host');
    const surface = make('div', 'dock-browser-surface');
    const parking = make('div', 'dock-browser-parking');
    parking.hidden = true;
    const live = make('div', 'dock-announcer');
    live.setAttribute('aria-live', 'polite');
    host.append(surface, parking, live);
    document.body.append(bar, host);
    Object.assign(record, { host, surface, parking, live, title, bar });
    const styleCopies = new Map();
    let inheritedProperties = new Set();
    const syncStyles = () => {
      if (record.releasing || this.disposed || c.disposed) return;
      document.documentElement.className = c.document.documentElement.className;
      document.documentElement.style.cssText = c.document.documentElement.style.cssText;
      for (const [target, source] of [
        [document.documentElement, c.document.documentElement],
        [document.body, c.document.body],
      ]) {
        for (const name of ['data-theme', 'data-density', 'lang', 'dir']) {
          const value = source.getAttribute(name);
          if (value === null) target.removeAttribute(name);
          else target.setAttribute(name, value);
        }
      }
      document.body.className = c.document.body.className + ' ' + (this.options.bodyClass || '');
      document.body.style.cssText = c.document.body.style.cssText;
      host.className =
        c.host.className.replace(/\bdock-(dragging|gesturing)\b/g, '') + ' dock-browser-host';
      // Keep unchanged style/link nodes mounted: unrelated activation and density changes
      // must not reload stylesheets or briefly remove the popup's theme.
      const sources = [...c.document.querySelectorAll('head link[rel="stylesheet"],head style')];
      for (const [source, { clone }] of styleCopies)
        if (!sources.includes(source)) {
          clone.remove();
          styleCopies.delete(source);
        }
      sources.forEach((source, index) => {
        const signature = source.outerHTML + ':' + !!source.disabled;
        let copy = styleCopies.get(source);
        if (!copy || copy.signature !== signature) {
          const clone = source.cloneNode(true);
          if (source.tagName === 'LINK') clone.href = source.href;
          clone.disabled = source.disabled;
          copy?.clone.remove();
          copy = { clone, signature };
          styleCopies.set(source, copy);
        }
        if (styles.children[index] !== copy.clone)
          styles.insertBefore(copy.clone, styles.children[index] || null);
      });
      const computed = c.window.getComputedStyle?.(c.host);
      if (computed) {
        const current = new Set();
        for (let i = 0; i < computed.length; ++i) {
          const key = computed.item(i);
          if (key.startsWith('--')) {
            current.add(key);
            host.style.setProperty(key, computed.getPropertyValue(key));
          }
        }
        // Removed custom properties must not remain as stale inline overrides in the popup.
        for (const key of inheritedProperties)
          if (!current.has(key)) host.style.removeProperty(key);
        inheritedProperties = current;
      }
    };
    try {
      syncStyles();
      if (c.window.MutationObserver) {
        const observer = new c.window.MutationObserver(syncStyles);
        observer.observe(c.document.head, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
        // A reusable control may inherit its theme from a container, not just body/html.
        for (let node = c.host; node; node = node.parentElement)
          observer.observe(node, {
            attributes: true,
            attributeFilter: ['class', 'style', 'data-theme', 'data-density', 'lang', 'dir'],
          });
        record.cleanups.push(() => observer.disconnect());
      }
      // Linked stylesheet completion changes computed tokens without a DOM mutation.
      c.document.head.addEventListener('load', syncStyles, true);
      record.cleanups.push(() => c.document.head.removeEventListener('load', syncStyles, true));
      record.cleanups.push(() => styleCopies.clear());
      c.bindDocument(document, host, record.cleanups);
      this.bindTransfer(host, record.cleanups);
      const leaving = () => this.return(record.id);
      const resize = () => {
        this.captureBounds(record);
        c.dispatchEvent(new Event('resize'));
      };
      window.addEventListener('pagehide', leaving);
      window.addEventListener('resize', resize);
      record.cleanups.push(
        () => window.removeEventListener('pagehide', leaving),
        () => window.removeEventListener('resize', resize),
      );
      return record;
    } catch (error) {
      for (const cleanup of record.cleanups.reverse()) cleanup();
      throw error;
    }
  }
  startWatch() {
    if (this.watch) return;
    this.watch = this.control.window.setInterval(() => {
      for (const record of [...this.records.values()]) {
        try {
          if (record.window.closed || record.window.document !== record.document)
            this.return(record.id);
          else this.captureBounds(record);
        } catch {
          this.return(record.id);
        }
      }
    }, 1000);
  }
  captureBounds(record) {
    if (this.disposed || record.releasing || !this.records.has(record.id)) return;
    const win = record.window;
    try {
      const rect = bounds({
        x: win.screenX,
        y: win.screenY,
        width: win.innerWidth,
        height: win.innerHeight,
      });
      this.control.model.setBrowserWindow(record.id, rect, { history: false });
    } catch {
      /* A minimized or navigating window can have temporarily unavailable bounds. */
    }
  }
  sync() {
    for (const record of [...this.records.values()]) {
      const floating = this.control.model.state.floating.find((f) => f.id === record.id);
      if (!floating?.browserWindow) this.release(record, { render: false });
      else {
        const title = members(floating.root)
          .map((id) => this.control.title(id))
          .join(' · ');
        record.title.textContent = title;
        record.document.title = title + ' — Dock workspace';
      }
    }
  }
  focus(id) {
    const record = this.records.get(id);
    if (!record) return false;
    try {
      record.window.focus();
      return !record.window.closed;
    } catch {
      return false;
    }
  }
  return(id) {
    const record = this.records.get(id);
    if (!record || record.releasing) return false;
    this.captureBounds(record);
    this.release(record, { render: false });
    if (!this.control.disposed && !this.disposed) {
      this.control.model.setBrowserWindow(id, null);
      this.control.render();
    }
    return true;
  }
  release(record, { render = true } = {}) {
    if (record.releasing) return;
    record.releasing = true;
    this.records.delete(record.id);
    this.endTransfer();
    this.control.cancelGesture?.();
    if (this.control.menu?.ownerDocument === record.document) this.control.closeMenu();
    // Reclaim every live node, including inactive tabs, before the document goes away.
    for (const node of this.control.contents.values())
      if (node.ownerDocument === record.document || record.host.contains(node))
        this.control.parking.append(node);
    for (const cleanup of record.cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        this.control.notify(error.message);
      }
    }
    record.frame = null;
    try {
      record.window.close();
    } catch {}
    if (!this.records.size && this.watch) {
      this.control.window.clearInterval(this.watch);
      this.watch = null;
    }
    try {
      this.options.onClose?.(record.id);
    } catch (error) {
      this.control.notify(error.message);
    }
    if (render && !this.control.disposed) this.control.render();
  }
  beginTransfer(event, ids, groupId) {
    if (!event.dataTransfer) return;
    this.endTransfer();
    const token =
      this.control.window.crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random();
    this.transfer = { token, ids: [...ids], groupId };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(transferType, token);
    event.stopPropagation();
  }
  endTransfer() {
    this.transfer = null;
    this.control.overlay?.remove();
    this.control.overlay = null;
  }
  bindTransfer(host, cleanups) {
    const over = (event) => {
      if (!this.transfer || ![...(event.dataTransfer?.types || [])].includes(transferType)) return;
      const drop = this.control.dropAt(event, this.transfer.ids, this.transfer.groupId);
      this.control.drawDrop(drop, event.target.ownerDocument);
      if (drop) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
      }
    };
    const drop = (event) => {
      const transfer = this.transfer;
      if (!transfer || event.dataTransfer?.getData(transferType) !== transfer.token) return;
      const target = this.control.dropAt(event, transfer.ids, transfer.groupId);
      this.endTransfer();
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (this.control.beforeActivate(transfer.ids[0]) === false) return;
      try {
        this.control.model.dock(transfer.ids, target.id, target.position, target.index);
      } catch (error) {
        this.control.notify(error.message);
      }
    };
    const end = () => this.endTransfer();
    host.addEventListener('dragover', over, true);
    host.addEventListener('drop', drop, true);
    host.addEventListener('dragend', end, true);
    cleanups.push(
      () => host.removeEventListener('dragover', over, true),
      () => host.removeEventListener('drop', drop, true),
      () => host.removeEventListener('dragend', end, true),
    );
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of [...this.records.values()]) this.release(record, { render: false });
    for (const cleanup of this.cleanups.reverse()) cleanup();
    this.cleanups.length = 0;
  }
}
