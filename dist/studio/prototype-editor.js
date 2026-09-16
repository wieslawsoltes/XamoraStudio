import { MotionRuntime } from './motion-runtime.js';
import { listStoryboards } from '../core/animation.js';
import { stateGroups } from '../core/states.js';
import { clone, find, walk, isElement, uid, label, localName } from '../core/model.js';
import { PreviewRenderer } from '../core/render.js';
import { PrototypeSession, ACTION_TYPES, PREVIEW_EVENTS } from '../core/prototype.js';
import { bindingPaths, readPath, writePath, tableBy } from '../core/design-data.js';
import { esc, $, $$, notify, field, select } from './ui.js';

export class PrototypeEditor {
  constructor(studio, data) {
    this.s = studio;
    this.data = data;
    this.boardMode = 'pages';
    this.session = null;
    this.motionRuntimes = new Map();
    const close = studio.closeModal.bind(studio);
    studio.closeModal = () => {
      if (document.querySelector('.prototype-modal')) this.disposeMotion();
      close();
    };
  }
  disposeMotion() {
    for (const runtime of this.motionRuntimes.values()) runtime.dispose();
    this.motionRuntimes.clear();
    cancelAnimationFrame(this.previewFrame);
  }
  configureMotion(renderer, doc) {
    const key = doc.id;
    let runtime = this.motionRuntimes.get(key);
    if (!runtime) {
      runtime = new MotionRuntime(doc);
      this.motionRuntimes.set(key, runtime);
    }
    renderer.resourceResolver =
      this.s.solution?.resolverFor(doc) ||
      ((source) => this.s.stores.find((st) => st.document.name === source)?.document);
    const event = renderer.onEvent;
    renderer.onEvent = (detail) => {
      if (this.restoringFocus) return;
      runtime.event(detail.runtimeNodeId || detail.nodeId, detail.event);
      event?.(detail);
    };
    return () => {
      runtime.bind(renderer);
      runtime.commands(this.session.motionCommands.filter((a) => a.targetViewId === key));
    };
  }
  get views() {
    return this.s.stores
      .map((s) => s.document)
      .filter(
        (d) =>
          !['ResourceDictionary', 'ControlTemplate', 'DataTemplate'].includes(
            localName(d.root.type),
          ),
      );
  }
  sources(doc) {
    const out = [];
    walk(doc.root, (n) => {
      if (isElement(n) && !n.type.includes('.')) out.push(n);
    });
    return out;
  }
  storeFor(id) {
    return this.s.stores.find((s) => s.document.id === id);
  }
  interactions(doc) {
    return doc.metadata?.interactions || [];
  }
  panel() {
    const s = this.s,
      n = s.selected[0],
      connections = this.interactions(s.doc).filter((c) => !n || c.sourceId === n.id);
    s.inspectorHost().innerHTML = `<section class="panel-section"><div class="section-heading">Prototype interactions<span class="spacer"></span><button class="icon-button" id="flow-add">+</button></div><p class="feature-help">${n ? 'Connect ' + esc(label(n)) + ' to a view, data action, or another control.' : 'Select a source control or add a connection.'}</p><button class="button primary" data-action="preview" style="width:100%">Run interactive preview</button></section>${connections.map((c) => `<article class="connection-card"><div><span class="badge">${esc(c.event)}</span><strong>${esc(label(find(s.doc.root, c.sourceId))) || 'Missing source'}</strong><button class="icon-button" data-edit-connection="${esc(c.id)}" title="Edit connection">⋯</button></div><p>${c.actions.map((a) => esc(a.type) + (a.targetViewId ? ' → ' + esc(this.storeFor(a.targetViewId)?.document.name || 'Missing view') : '')).join('<br>')}</p></article>`).join('') || '<div class="empty-inspector">No interactions on this selection.</div>'}<section class="panel-section"><button class="button" data-action="views-board">View all pages & connections</button></section>`;
    $('#flow-add').onclick = () => this.editConnection(s.doc.id, n?.id);
    $$('[data-edit-connection]').forEach(
      (b) => (b.onclick = () => this.editConnection(s.doc.id, null, b.dataset.editConnection)),
    );
  }
  editConnection(viewId, sourceId, id, targetViewId) {
    const store = this.storeFor(viewId);
    if (!store) return;
    const doc = store.document;
    let connection = clone(
      this.interactions(doc).find((c) => c.id === id) || {
        id: uid(),
        sourceId:
          sourceId ||
          this.sources(doc).find((n) => localName(n.type) === 'Button')?.id ||
          doc.root.id,
        event: 'Click',
        actions: [
          {
            type: targetViewId ? 'navigate' : 'setData',
            targetViewId: targetViewId || this.views[0]?.id,
            path: 'App.Counter',
            value: 1,
          },
        ],
        enabled: true,
      },
    );
    const show = () => {
      this.s.modal(
        'Interaction connection',
        `<div class="form-columns">${select(
          'connection-source',
          'Source control',
          this.sources(doc).map((n) => [n.id, label(n) + ' · ' + n.type]),
          connection.sourceId,
        )}${select('connection-event', 'Trigger', PREVIEW_EVENTS, connection.event)}</div><div class="check-row"><label><input type="checkbox" name="connection-enabled" ${connection.enabled !== false ? 'checked' : ''}> Enabled</label><label><input type="checkbox" name="connection-conditional" ${connection.condition ? 'checked' : ''}> Run when condition matches</label></div><div id="connection-condition" ${connection.condition ? '' : 'hidden'} class="form-columns">${field('condition-path', 'Data path', connection.condition?.path || 'App.IsOpen')}${select('condition-op', 'Comparison', ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'isNull', 'notNull'], connection.condition?.operator || 'eq')}${field('condition-value', 'Value', JSON.stringify(connection.condition?.value ?? true))}</div><div class="section-heading">Action sequence<span class="spacer"></span><button class="button" id="connection-add-step">+ Action</button></div><div id="connection-actions">${connection.actions.map((a, i) => this.actionFields(a, i, doc)).join('')}</div><p class="feature-help">Values accept JSON literals, $event.value, $event.rowId, or {"path":"App.Counter"}. Actions run in order and roll back together if a step fails.</p>`,
        [
          ...(id
            ? [
                {
                  label: 'Delete connection',
                  run: () => {
                    store.transaction(
                      'Delete interaction',
                      (d) =>
                        (d.metadata.interactions = this.interactions(d).filter((c) => c.id !== id)),
                    );
                    this.s.save();
                    this.s.closeModal();
                    this.refresh();
                  },
                },
              ]
            : []),
          {
            label: 'Save connection',
            primary: true,
            run: () => {
              capture();
              if (!find(store.document.root, connection.sourceId))
                throw Error('Source control is missing.');
              if (!connection.actions.length) throw Error('Add at least one action.');
              store.transaction('Save interaction', (d) => {
                d.metadata.interactions = this.interactions(d).filter(
                  (c) => c.id !== connection.id,
                );
                d.metadata.interactions.push(connection);
              });
              this.s.save();
              this.s.closeModal();
              this.refresh();
            },
          },
        ],
        true,
      );
      const capture = () => {
        connection.sourceId = $('[name=connection-source]').value;
        connection.event = $('[name=connection-event]').value;
        connection.enabled = $('[name=connection-enabled]').checked;
        if ($('[name=connection-conditional]').checked)
          connection.condition = {
            path: $('[name=condition-path]').value,
            operator: $('[name=condition-op]').value,
            value: this.readValue($('[name=condition-value]').value),
          };
        else delete connection.condition;
        connection.actions = $$('[data-action-step]').map((row) => {
          const action = { type: $('[name=action-type]', row).value };
          for (const input of $$('[data-action-field]', row)) {
            const key = input.dataset.actionField;
            action[key] = key === 'value' ? this.readValue(input.value) : input.value;
          }
          return action;
        });
      };
      $('[name=connection-conditional]').onchange = (e) =>
        ($('#connection-condition').hidden = !e.target.checked);
      $('#connection-add-step').onclick = () => {
        capture();
        connection.actions.push({ type: 'navigate', targetViewId: this.views[0]?.id });
        show();
      };
      $$('[data-remove-step]').forEach(
        (b) =>
          (b.onclick = () => {
            capture();
            connection.actions.splice(Number(b.dataset.removeStep), 1);
            show();
          }),
      );
      $$('[name=action-type]').forEach(
        (input) =>
          (input.onchange = () => {
            capture();
            show();
          }),
      );
      $$('[data-action-field=targetViewId],[data-action-field=groupId]').forEach(
        (input) =>
          (input.onchange = () => {
            capture();
            show();
          }),
      );
    };
    show();
  }
  readValue(text) {
    if (text === '$event.value' || text === '$event.rowId') return text;
    if (!text.trim()) return '';
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  actionFields(action, index, doc) {
    const type = action.type;
    const input = (key, label, value = '') =>
      `<label>${label}<input data-action-field="${key}" value="${esc(value)}"></label>`;
    const choice = (key, label, options, value) =>
      `<label>${label}<select data-action-field="${key}">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    let fields = '';
    if (['startStoryboard', 'stopStoryboard', 'goToState'].includes(type)) {
      const target = this.storeFor(action.targetViewId || doc.id)?.document || doc;
      if (type === 'goToState') {
        const groups = stateGroups(target);
        fields += choice(
          'groupId',
          'State group',
          groups.map((g) => [g.id, g.name]),
          action.groupId,
        );
        const group = groups.find((g) => g.id === action.groupId) || groups[0];
        fields += choice(
          'stateName',
          'State',
          (group?.states || []).map((n) => [
            n.props['x:Name'] || n.props.Name,
            n.props['x:Name'] || n.props.Name,
          ]),
          action.stateName,
        );
      } else
        fields += choice(
          'storyboardId',
          'Storyboard',
          listStoryboards(target).map((st) => [st.id, st.name]),
          action.storyboardId,
        );
    }
    if (
      [
        'navigate',
        'openOverlay',
        'setProperty',
        'toggleVisibility',
        'startStoryboard',
        'stopStoryboard',
        'goToState',
      ].includes(type)
    )
      fields += choice(
        'targetViewId',
        'Target view',
        this.views.map((d) => [d.id, d.name]),
        action.targetViewId || doc.id,
      );
    if (['setProperty', 'toggleVisibility'].includes(type)) {
      const target = this.storeFor(action.targetViewId || doc.id)?.document || doc;
      fields += choice(
        'targetId',
        'Target control',
        this.sources(target).map((n) => [n.id, label(n) + ' · ' + n.type]),
        action.targetId,
      );
      if (type === 'setProperty')
        fields += input('property', 'Property', action.property || 'Text');
    }
    if (['setData', 'toggleData', 'increment'].includes(type))
      fields += input('path', 'Data path', action.path || 'App.Counter');
    if (['selectRecord', 'insertRecord', 'updateRecord', 'deleteRecord'].includes(type)) {
      fields += choice(
        'tableId',
        'Table',
        this.data.db.tables.map((t) => [t.id, t.name]),
        action.tableId,
      );
      if (type !== 'insertRecord')
        fields += input('rowId', 'Record ID (empty uses event)', action.rowId || '');
    }
    if (
      [
        'setData',
        'increment',
        'setProperty',
        'insertRecord',
        'updateRecord',
        'selectRecord',
      ].includes(type)
    )
      fields += input(
        'value',
        'Value',
        typeof action.value === 'string'
          ? action.value
          : JSON.stringify(
              action.value ?? (type === 'insertRecord' || type === 'updateRecord' ? {} : 1),
            ),
      );
    return `<div class="action-step" data-action-step="${index}"><div class="action-step-heading"><span class="step-number">${index + 1}</span>${select('action-type', 'Action', ACTION_TYPES, type)}<span class="spacer"></span><button class="icon-button" data-remove-step="${index}" title="Remove action">×</button></div><div class="form-columns">${fields}</div></div>`;
  }
  refresh() {
    if (this.s.rightTab === 'flow') this.panel();
    if (this.s.view === 'views' || this.s.docking?.control.visible.has('views')) this.board();
  }
  board() {
    const s = this.s;
    $('#views-board')?.remove();
    const board = document.createElement('section');
    board.id = 'views-board';
    const items =
      this.boardMode === 'breakpoints'
        ? [390, 768, 1100].map((width) => ({ document: s.doc, width, name: width + ' px' }))
        : this.views.map((doc) => ({ document: doc, width: doc.design.width, name: doc.name }));
    board.innerHTML = `<header class="views-toolbar"><div><strong>Views & prototype flow</strong><span>${this.views.length} pages · ${this.views.reduce((n, d) => n + this.interactions(d).length, 0)} interactions</span></div><span class="spacer"></span><select id="board-mode"><option value="pages">All pages</option><option value="breakpoints">Responsive comparison</option></select><button class="button" data-action="new-document">+ View</button><button class="button primary" data-action="preview">Run preview</button></header><div class="views-scroll"><div class="views-grid" id="views-grid"><svg id="view-connectors" aria-label="Prototype connections"></svg>${items.map((item, index) => `<article class="view-card" data-view-id="${item.document.id}" data-frame-index="${index}"><header><button data-open-view="${item.document.id}">${esc(item.name)}</button><span class="spacer"></span><button class="view-port" data-port-view="${item.document.id}" title="Drag to another view to connect">↗</button></header><div class="view-thumbnail" id="view-thumbnail-${index}"><div class="view-preview" id="view-preview-${index}"></div></div><footer><span>${item.width} × ${item.document.design.height}</span><button data-add-view-link="${item.document.id}">+ Interaction</button></footer></article>`).join('')}</div></div><div class="views-help">Drag a purple connection port to another view. Choose the source control and action in the connection editor.</div>`;
    (s.docking?.viewsHost || $('.center')).append(board);
    $('#board-mode').value = this.boardMode;
    $('#board-mode').onchange = (e) => {
      this.boardMode = e.target.value;
      this.board();
    };
    items.forEach((item, index) => {
      const doc = clone(item.document),
        host = $('#view-preview-' + index),
        scale = 280 / item.width;
      doc.root.props.Width = String(item.width);
      host.style.cssText = `width:${item.width}px;height:${doc.design.height}px;transform:scale(${scale});transform-origin:0 0`;
      $('#view-thumbnail-' + index).style.height = Math.min(380, doc.design.height * scale) + 'px';
      const renderer = new PreviewRenderer(s.registry);
      renderer.sampleData = { ...(doc.metadata.sampleData || {}), ...this.data.context() };
      renderer.render(doc, host);
      host.addEventListener('dblclick', (e) => {
        const id = e.target.closest('[data-node-id]')?.dataset.nodeId;
        s.switchDocument(s.stores.findIndex((st) => st.document.id === doc.id));
        s.setView('split');
        if (id && find(s.doc.root, id)) s.store.select([id]);
      });
    });
    $$('[data-open-view]').forEach(
      (b) =>
        (b.onclick = () => {
          s.switchDocument(s.stores.findIndex((st) => st.document.id === b.dataset.openView));
          s.setView('split');
        }),
    );
    $$('[data-add-view-link]').forEach(
      (b) => (b.onclick = () => this.editConnection(b.dataset.addViewLink)),
    );
    $$('[data-port-view]').forEach(
      (port) => (port.onpointerdown = (e) => this.startLink(e, port.dataset.portView)),
    );
    requestAnimationFrame(() => this.drawConnections());
    $('#views-board .views-scroll').addEventListener('scroll', () => this.drawConnections());
  }
  drawConnections() {
    const svg = $('#view-connectors'),
      grid = $('#views-grid');
    if (!svg || this.boardMode === 'breakpoints') {
      if (svg) svg.innerHTML = '';
      return;
    }
    svg.setAttribute('width', grid.scrollWidth);
    svg.setAttribute('height', grid.scrollHeight);
    const origin = grid.getBoundingClientRect();
    let markup =
      '<defs><marker id="flow-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="#9471e8"/></marker></defs>';
    for (const doc of this.views) {
      const from = $(`[data-port-view="${doc.id}"]`);
      if (!from) continue;
      const a = from.getBoundingClientRect();
      for (const connection of this.interactions(doc)) {
        for (const action of connection.actions.filter((a) =>
          ['navigate', 'openOverlay'].includes(a.type),
        )) {
          const target = $(`[data-view-id="${action.targetViewId}"] header`);
          if (!target) continue;
          const b = target.getBoundingClientRect(),
            x1 = a.right - origin.left,
            y1 = a.top + a.height / 2 - origin.top,
            x2 = b.left - origin.left,
            y2 = b.top + b.height / 2 - origin.top,
            dx = Math.max(45, Math.abs(x2 - x1) / 2);
          markup += `<path class="flow-connection" data-flow-id="${esc(connection.id)}" data-flow-view="${doc.id}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}" marker-end="url(#flow-arrow)"><title>${esc(label(find(doc.root, connection.sourceId)))} · ${esc(connection.event)} → ${esc(this.storeFor(action.targetViewId)?.document.name)}</title></path>`;
        }
      }
    }
    svg.innerHTML = markup;
    $$('[data-flow-id]').forEach(
      (path) =>
        (path.onclick = () =>
          this.editConnection(path.dataset.flowView, null, path.dataset.flowId)),
    );
  }
  startLink(e, viewId) {
    e.preventDefault();
    const port = e.currentTarget,
      a = port.getBoundingClientRect(),
      line = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    line.id = 'connector-drag';
    line.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:100';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#9471e8');
    path.setAttribute('stroke-width', '2');
    line.append(path);
    document.body.append(line);
    const move = (ev) => {
      const x = a.left + a.width / 2,
        y = a.top + a.height / 2;
      path.setAttribute(
        'd',
        `M${x},${y} C${x + 70},${y} ${ev.clientX - 70},${ev.clientY} ${ev.clientX},${ev.clientY}`,
      );
    };
    const end = (ev) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      line.remove();
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-view-id]');
      if (target)
        this.editConnection(
          viewId,
          this.s.doc.id === viewId ? this.s.selected[0]?.id : null,
          null,
          target.dataset.viewId,
        );
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end, { once: true });
    move(e);
  }
  preview() {
    if (!this.s.prepareEdit()) return;
    const docs = this.views;
    if (!docs.length) {
      notify('Create a view to preview.');
      return;
    }
    this.disposeMotion();
    this.session = new PrototypeSession(
      docs,
      this.data.db,
      docs.some((d) => d.id === this.s.doc.id) ? this.s.doc.id : docs[0].id,
    );
    this.s.modal(
      'Interactive prototype',
      `<div class="prototype-toolbar"><button class="button" id="preview-back">← Back</button><select id="preview-page">${docs.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select><select id="preview-width"><option value="auto">Artboard width</option><option value="390">Phone · 390</option><option value="768">Tablet · 768</option><option value="1100">Desktop · 1100</option></select><span class="spacer"></span><button class="button" id="preview-reset">Reset session</button><button class="button" id="preview-state-toggle">State</button></div><div class="prototype-body"><div class="prototype-stage"><div id="prototype-view" class="artboard"></div><div id="prototype-overlay" hidden></div></div><aside id="prototype-state" hidden></aside></div><div class="prototype-status" id="prototype-status">Preview state is isolated from your design database.</div>`,
      [],
      true,
    );
    $('.modal').classList.add('prototype-modal');
    const session = this.session;
    const refresh = () => this.renderSession();
    session.addEventListener('change', () => {
      cancelAnimationFrame(this.previewFrame);
      this.previewFrame = requestAnimationFrame(refresh);
    });
    $('#preview-page').value = session.currentViewId;
    $('#preview-page').onchange = (e) => {
      session.history.push(session.currentViewId);
      session.currentViewId = e.target.value;
      refresh();
    };
    $('#preview-width').onchange = refresh;
    $('#preview-back').onclick = () => {
      session.currentViewId = session.history.pop() || session.startViewId;
      refresh();
    };
    $('#preview-reset').onclick = () => session.reset();
    $('#preview-state-toggle').onclick = () => {
      $('#prototype-state').hidden = !$('#prototype-state').hidden;
      refresh();
    };
    refresh();
  }
  renderSession() {
    const session = this.session,
      host = $('#prototype-view');
    if (!session || !host) return;
    const currentFocus = document.activeElement?.closest('[data-node-id]')?.dataset.nodeId,
      caret = document.activeElement?.selectionStart;
    if (this.motionGeneration !== session.motionGeneration) {
      this.disposeMotion();
      this.motionGeneration = session.motionGeneration;
    }
    for (const [id, runtime] of this.motionRuntimes)
      if (id !== session.currentViewId && id !== session.overlayViewId) {
        runtime.dispose();
        this.motionRuntimes.delete(id);
      }
    const doc = session.document(),
      width =
        $('#preview-width').value === 'auto' ? doc.design.width : Number($('#preview-width').value);
    doc.root.props.Width = String(width);
    host.style.width = width + 'px';
    host.style.height = doc.design.height + 'px';
    $('#preview-page').value = session.currentViewId;
    const renderer = new PreviewRenderer(this.s.registry);
    renderer.sampleData = session.context;
    renderer.describeContext = (context) => session.describeContext(context);
    renderer.onEvent = (detail) => {
      try {
        const result = session.dispatch(doc.id, detail.nodeId, detail.event, detail);
        $('#prototype-status').textContent =
          `${detail.event} · ${label(find(doc.root, detail.nodeId)) || detail.nodeId} · ${result.connections} connection${result.connections === 1 ? '' : 's'}`;
      } catch (error) {
        $('#prototype-status').textContent = error.message;
        notify(error.message);
      }
    };
    renderer.onInput = (change) => {
      try {
        return session.writeBinding(change);
      } catch (error) {
        notify(error.message);
        $('#prototype-status').textContent = error.message;
        return false;
      }
    };
    const attachMotion = this.configureMotion(renderer, doc);
    renderer.render(doc, host, { interactive: true, designTime: false });
    attachMotion();
    if (currentFocus) {
      const el = host.querySelector(`[data-node-id="${CSS.escape(currentFocus)}"]`);
      if (el && ['INPUT', 'TEXTAREA'].includes(el.tagName)) {
        this.restoringFocus = true;
        el.focus();
        this.restoringFocus = false;
        if (typeof caret === 'number' && el.type !== 'number') el.setSelectionRange(caret, caret);
      }
    }
    const overlay = $('#prototype-overlay');
    overlay.hidden = !session.overlayViewId;
    if (session.overlayViewId) {
      overlay.replaceChildren();
      const shell = document.createElement('div');
      shell.className = 'prototype-overlay-card';
      const close = document.createElement('button');
      close.className = 'button';
      close.textContent = 'Close overlay';
      close.onclick = () => {
        session.overlayViewId = null;
        this.renderSession();
      };
      shell.append(close);
      const view = document.createElement('div'),
        overlayDoc = session.document(session.overlayViewId),
        r = new PreviewRenderer(this.s.registry);
      r.sampleData = session.context;
      r.describeContext = (context) => session.describeContext(context);
      r.onEvent = (d) => {
        try {
          session.dispatch(overlayDoc.id, d.nodeId, d.event, d);
        } catch (error) {
          notify(error.message);
        }
      };
      r.onInput = (change) => {
        try {
          return session.writeBinding(change);
        } catch (error) {
          notify(error.message);
          return false;
        }
      };
      const attachOverlay = this.configureMotion(r, overlayDoc);
      r.render(overlayDoc, view, { interactive: true, designTime: false });
      attachOverlay();
      shell.append(view);
      overlay.append(shell);
    }
    $('#prototype-state').innerHTML =
      `<h4>Session state</h4><pre>${esc(JSON.stringify(session.context, null, 2))}</pre><h4>Recent events</h4>${session.log
        .slice(0, 12)
        .map((e) => `<div class="session-event">${esc(e.event)} · ${e.count} actions</div>`)
        .join('')}`;
  }
}
