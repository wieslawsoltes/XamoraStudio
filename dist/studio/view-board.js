import { clone, find, uid, localName, label } from '../core/model.js';
import { PreviewRenderer } from '../core/render.js';
import { esc, $, $$, notify } from './ui.js';
export class ViewBoard {
  constructor(s) {
    this.s = s;
    this.p = s.features.prototype;
    this.cards = new Map();
    this.query = '';
    this.size = 280;
    this.limit = 40;
    this.selected = new Set();
    this.p.board = () => this.request();
    this.p.startLink = (e, id) => this.startLink(e, id);
    const draw = this.p.drawConnections.bind(this.p);
    this.p.drawConnections = () => {
      draw();
      $$('[data-flow-id]').forEach(
        (path) =>
          (path.onclick = () => this.editConnection(path.dataset.flowView, path.dataset.flowId)),
      );
    };
  }
  request() {
    if (!this.host?.isConnected) this.render();
    else {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => {
        if (!this.cancelLink) this.render();
      });
    }
  }
  open(id, nodeId) {
    const s = this.s;
    if (
      s.switchDocument(s.stores.findIndex((st) => st.document.id === id)) === false ||
      s.doc.id !== id
    )
      return false;
    if (s.setView('split') === false) return false;
    if (nodeId && find(s.doc.root, nodeId)) s.store.select([nodeId]);
    return true;
  }
  render() {
    const s = this.s,
      p = this.p;
    if (this.connection) {
      const st = p.storeFor(this.connection.viewId),
        c = st && p.interactions(st.document).find((c) => c.id === this.connection.id);
      if (st !== this.connection.store || JSON.stringify(c) !== this.connection.signature) {
        $('#view-connection-editor')?.replaceChildren();
        const host = $('#view-connection-editor');
        if (host) host.hidden = true;
        this.connection = null;
      }
    }
    if (!this.host?.isConnected) {
      this.host = document.createElement('section');
      this.host.id = 'views-board';
      this.host.innerHTML = `<header class="views-toolbar"><strong>Views & connections</strong><input id="views-search" placeholder="Find a view…" aria-label="Find a view"><select id="board-mode"><option value="pages">All pages</option><option value="selected">Selected pages</option><option value="breakpoints">Responsive comparison</option></select><label>Size <input id="view-card-size" type="range" min="180" max="520" step="20" value="${this.size}"></label><button class="button" data-action="new-document">+ View</button></header><div class="views-scroll"><div class="views-grid" id="views-grid"><svg id="view-connectors" aria-label="Prototype connections"></svg></div><button class="button" id="views-load-more" hidden>Show more views</button><p id="views-empty" hidden>No views match this filter.</p></div><footer class="views-workbench-footer"><span id="views-count"></span><button class="button" id="views-tile">Tile selected</button><button class="button" data-action="preview">Run preview</button><span>Drag a port to create navigation. Select a connection to edit it here.</span></footer><div id="view-connection-editor" hidden></div>`;
      s.docking.viewsHost.replaceChildren(this.host);
      $('#views-search').value = this.query;
      $('#views-search').oninput = (e) => {
        this.query = e.target.value;
        this.limit = 40;
        this.request();
      };
      $('#board-mode').value = p.boardMode;
      $('#board-mode').onchange = (e) => {
        p.boardMode = e.target.value;
        this.request();
      };
      $('#view-card-size').oninput = (e) => {
        this.size = Number(e.target.value);
        this.request();
      };
      $('#views-load-more').onclick = () => {
        this.limit += 40;
        this.request();
      };
      $('#views-tile').onclick = () => this.tile();
      $('.views-scroll', this.host).addEventListener('scroll', () => p.drawConnections());
    }
    const docs = p.views.filter(
        (doc) =>
          doc.name.toLowerCase().includes(this.query.toLowerCase()) &&
          (p.boardMode !== 'selected' || this.selected.has(doc.id)),
      ),
      all =
        p.boardMode === 'breakpoints'
          ? [390, 768, 1100].map((width) => ({ doc: s.doc, width, name: width + ' px' }))
          : docs.map((doc) => ({ doc, width: doc.design.width, name: doc.name })),
      items = all.slice(0, this.limit),
      keys = new Set(items.map((i) => i.doc.id + ':' + i.width)),
      grid = $('#views-grid');
    grid.style.gridTemplateColumns = `repeat(auto-fit,minmax(${this.size}px,${this.size}px))`;
    for (const [key, card] of this.cards)
      if (!keys.has(key)) {
        card.el.remove();
        this.cards.delete(key);
      }
    items.forEach((item, index) => {
      const key = item.doc.id + ':' + item.width;
      let card = this.cards.get(key);
      if (!card) {
        const el = document.createElement('article');
        el.className = 'view-card';
        el.dataset.viewId = item.doc.id;
        el.innerHTML = `<header><input type="checkbox" data-choose-view aria-label="Select view"><button data-open-view="${item.doc.id}"></button><span class="spacer"></span><button class="view-port" data-port-view="${item.doc.id}" title="Drag to connect">↗</button></header><div class="view-thumbnail"><div class="view-preview"></div></div><footer><span></span><button data-open-source>Source</button></footer>`;
        card = { el, surface: $('.view-preview', el), signature: '' };
        this.cards.set(key, card);
        $('[data-open-view]', el).onclick = () => this.open(item.doc.id);
        $('[data-open-source]', el).onclick = () => {
          this.open(item.doc.id);
          if (s.doc.id === item.doc.id) s.setView('code');
        };
        $('[data-choose-view]', el).onchange = (e) => {
          e.target.checked ? this.selected.add(item.doc.id) : this.selected.delete(item.doc.id);
        };
        $('[data-port-view]', el).onpointerdown = (e) => this.startLink(e, item.doc.id);
        card.surface.ondblclick = (e) =>
          this.open(item.doc.id, e.target.closest('[data-node-id]')?.dataset.nodeId);
      }
      card.el.dataset.frameIndex = index;
      $('[data-open-view]', card.el).textContent = item.name;
      $('[data-choose-view]', card.el).checked = this.selected.has(item.doc.id);
      $('footer span', card.el).textContent = item.width + ' × ' + item.doc.design.height;
      card.el.style.width = this.size + 'px';
      const scale = this.size / item.width;
      card.surface.style.cssText = `width:${item.width}px;height:${item.doc.design.height}px;transform:scale(${scale});transform-origin:0 0`;
      $('.view-thumbnail', card.el).style.height =
        Math.min(460, item.doc.design.height * scale) + 'px';
      const signature = JSON.stringify([
        item.doc,
        item.width,
        s.features.data.context(),
        s.stores
          .map((st) => st.document.root)
          .filter((root) => localName(root.type) === 'ResourceDictionary'),
      ]);
      if (signature !== card.signature) {
        const doc = clone(item.doc);
        doc.root.props.Width = String(item.width);
        doc.design.width = item.width;
        const renderer = new PreviewRenderer(s.registry);
        renderer.resourceResolver = s.solution.resolverFor(doc);
        renderer.sampleData = { ...(doc.metadata.sampleData || {}), ...s.features.data.context() };
        renderer.render(doc, card.surface, { interactive: false, designTime: true });
        card.signature = signature;
        card.renderer = renderer;
      }
      grid.append(card.el);
    });
    $('#views-load-more').hidden = items.length === all.length;
    $('#views-empty').hidden = !!items.length;
    $('#views-count').textContent = items.length + ' of ' + all.length + ' views';
    requestAnimationFrame(() => p.drawConnections());
  }
  tile() {
    const ids = [...this.selected].filter((id) =>
      this.s.stores.some((st) => st.document.id === id),
    );
    if (!ids.length) {
      notify('Select views using their checkboxes.');
      return;
    }
    if (!this.open(ids[0])) return;
    const model = this.s.docking.model;
    let target = model.state.activePanel;
    for (const id of ids.slice(1, 8)) {
      const targetGroup = this.s.docking.control.shell
        .querySelector(`[data-dock-panel="${target}"]`)
        ?.closest('[data-dock-group]')?.dataset.dockGroup;
      if (targetGroup) model.dock('document:' + id, targetGroup, 'right');
      target = 'document:' + id;
    }
    this.s.docking.control.activate('document:' + ids[0]);
  }
  startLink(e, id) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.cancelLink?.();
    const s = this.s,
      start = e.currentTarget.getBoundingClientRect(),
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'connector-drag';
    svg.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1000';
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#1685ef');
    path.setAttribute('stroke-width', '3');
    svg.append(path);
    document.body.append(svg);
    const pointer = e.pointerId;
    const move = (ev) => {
      if (ev.pointerId !== pointer) return;
      path.setAttribute(
        'd',
        `M${start.right},${start.top + start.height / 2} C${start.right + 80},${start.top} ${ev.clientX - 80},${ev.clientY} ${ev.clientX},${ev.clientY}`,
      );
    };
    const cleanup = () => {
      svg.remove();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      this.cancelLink = null;
    };
    const cancel = () => {
        cleanup();
        this.request();
      },
      key = (ev) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          cancel();
        }
      };
    const end = (ev) => {
      if (ev.pointerId !== pointer) return;
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-view-id]')
        ?.dataset.viewId;
      cleanup();
      if (target && s.prepareEdit()) {
        const store = this.p.storeFor(id);
        if (!store || !this.p.storeFor(target)) return;
        const connection = {
          id: uid(),
          sourceId:
            (s.doc.id === id && s.selected[0]?.id) ||
            this.p.sources(store.document).find((n) => localName(n.type) === 'Button')?.id ||
            store.document.root.id,
          event: 'Click',
          enabled: true,
          actions: [{ type: 'navigate', targetViewId: target }],
        };
        store.transaction('Connect views', (doc) => {
          doc.metadata.interactions ??= [];
          doc.metadata.interactions.push(connection);
        });
        this.editConnection(id, connection.id);
      }
      this.request();
    };
    this.cancelLink = cancel;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    move(e);
  }
  editConnection(viewId, id) {
    const store = this.p.storeFor(viewId),
      c = this.p.interactions(store?.document || {}).find((c) => c.id === id);
    if (!c) return;
    this.connection = { viewId, id, store, signature: JSON.stringify(c) };
    this.request();
    const host = $('#view-connection-editor');
    if (!host) return;
    host.hidden = false;
    host.innerHTML = `<strong>Navigation connection</strong><label>Source<select data-conn="sourceId">${this.p
      .sources(store.document)
      .map(
        (n) =>
          `<option value="${n.id}" ${n.id === c.sourceId ? 'selected' : ''}>${esc(label(n))}</option>`,
      )
      .join(
        '',
      )}</select></label><label>Event<select data-conn="event">${['Click', 'Change', 'PointerEnter', 'PointerLeave', 'DoubleClick', 'SelectionChanged'].map((v) => `<option ${v === c.event ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>Target<select data-conn="target">${this.p.views.map((d) => `<option value="${d.id}" ${d.id === c.actions.find((a) => a.type === 'navigate')?.targetViewId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label><label><input data-conn="enabled" type="checkbox" ${c.enabled !== false ? 'checked' : ''}> Enabled</label><button data-conn-advanced>All actions…</button><button data-conn-delete>Delete</button><button data-conn-close>×</button>`;
    $$('[data-conn]', host).forEach(
      (input) =>
        (input.onchange = () => {
          if (!this.s.prepareEdit() || this.p.storeFor(viewId) !== store) return;
          store.transaction('Edit connection', (doc) => {
            const connection = doc.metadata.interactions.find((n) => n.id === id);
            if (!connection) return;
            if (input.dataset.conn === 'target') {
              let action = connection.actions.find((a) => a.type === 'navigate');
              if (!action) connection.actions.push((action = { type: 'navigate' }));
              action.targetViewId = input.value;
            } else
              connection[input.dataset.conn] =
                input.type === 'checkbox' ? input.checked : input.value;
          });
          if (this.connection)
            this.connection.signature = JSON.stringify(
              this.p.interactions(store.document).find((c) => c.id === id),
            );
          this.request();
        }),
    );
    $('[data-conn-advanced]', host).onclick = () => this.p.editConnection(viewId, null, id);
    $('[data-conn-delete]', host).onclick = () => {
      if (!this.s.prepareEdit() || this.p.storeFor(viewId) !== store) return;
      this.connection = null;
      store.transaction(
        'Delete connection',
        (doc) => (doc.metadata.interactions = doc.metadata.interactions.filter((n) => n.id !== id)),
      );
      host.hidden = true;
      this.request();
    };
    $('[data-conn-close]', host).onclick = () => {
      host.hidden = true;
      this.connection = null;
    };
  }
}
