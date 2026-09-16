import { stateGroups } from './states.js';
import { listStoryboards } from './animation.js';
import { clone, find } from './model.js';
import {
  DesignDatabase,
  databaseContext,
  readPath,
  writePath,
  compareValue,
  parseBinding,
  pathParts,
  tableBy,
} from './design-data.js';
export const PREVIEW_EVENTS = [
  'Click',
  'Change',
  'PointerEnter',
  'PointerLeave',
  'DoubleClick',
  'SelectionChanged',
  'PointerDown',
  'PointerUp',
  'GotFocus',
  'LostFocus',
];
export const ACTION_TYPES = [
  'navigate',
  'back',
  'setData',
  'toggleData',
  'increment',
  'setProperty',
  'toggleVisibility',
  'selectRecord',
  'insertRecord',
  'updateRecord',
  'deleteRecord',
  'openOverlay',
  'closeOverlay',
  'startStoryboard',
  'stopStoryboard',
  'goToState',
];
export class PrototypeSession extends EventTarget {
  constructor(documents, database, startViewId) {
    super();
    this.documents = documents.map(clone);
    this.initialDatabase = clone(database);
    this.database = new DesignDatabase(database);
    this.startViewId = startViewId || documents[0]?.id;
    this.reset();
  }
  reset() {
    this.database = new DesignDatabase(this.initialDatabase);
    this.context = {};
    for (const doc of this.documents)
      Object.assign(this.context, clone(doc.metadata?.sampleData || {}));
    Object.assign(this.context, databaseContext(this.database.data));
    this.currentViewId = this.startViewId;
    this.history = [];
    this.overrides = {};
    this.overlayViewId = null;
    this.motionCommands = [];
    this.motionSerial = 0;
    this.motionGeneration = (this.motionGeneration || 0) + 1;
    this.log = [];
    this.dispatchEvent(new Event('change'));
  }
  document(viewId = this.currentViewId) {
    const doc = clone(this.documents.find((d) => d.id === viewId));
    if (!doc) throw Error('Preview view not found.');
    for (const [id, values] of Object.entries(this.overrides[viewId] || {})) {
      const n = find(doc.root, id);
      if (n) Object.assign(n.props, values);
    }
    return doc;
  }
  resolve(value, event) {
    if (value && typeof value === 'object' && Object.hasOwn(value, 'path'))
      return readPath(this.context, value.path);
    if (value === '$event.value') return event.value;
    if (value === '$event.rowId') return event.rowId;
    return clone(value);
  }
  dispatch(viewId, nodeId, eventName, event = {}) {
    const view = this.documents.find((d) => d.id === viewId);
    if (!view) throw Error('Unknown preview view.');
    const connections = (view.metadata?.interactions || []).filter(
      (c) => c.sourceId === nodeId && c.event === eventName && c.enabled !== false,
    );
    if (!connections.length) return { connections: 0, viewId: this.currentViewId };
    const now = Date.now();
    this.eventTimes = (this.eventTimes || []).filter((t) => now - t < 1000);
    if (this.eventTimes.length >= 100)
      throw Error('Preview event rate exceeded; check pointer interaction loops.');
    this.eventTimes.push(now);
    const before = {
      context: clone(this.context),
      database: clone(this.database.data),
      current: this.currentViewId,
      history: [...this.history],
      overrides: clone(this.overrides),
      overlay: this.overlayViewId,
      motion: clone(this.motionCommands),
      serial: this.motionSerial,
    };
    try {
      for (const connection of connections) {
        if (
          connection.condition &&
          !compareValue(
            readPath(this.context, connection.condition.path),
            connection.condition.operator,
            connection.condition.value,
          )
        )
          continue;
        for (const action of connection.actions) this.execute(action, event, viewId);
      }
      this.log.unshift({
        time: new Date().toISOString(),
        viewId,
        nodeId,
        event: eventName,
        count: connections.length,
      });
      this.log = this.log.slice(0, 100);
      const after = {
        context: this.context,
        database: this.database.data,
        current: this.currentViewId,
        history: this.history,
        overrides: this.overrides,
        overlay: this.overlayViewId,
        motion: this.motionCommands,
        serial: this.motionSerial,
      };
      if (JSON.stringify(before) !== JSON.stringify(after)) this.dispatchEvent(new Event('change'));
      return { connections: connections.length, viewId: this.currentViewId };
    } catch (error) {
      this.context = before.context;
      this.database = new DesignDatabase(before.database);
      this.currentViewId = before.current;
      this.history = before.history;
      this.overrides = before.overrides;
      this.overlayViewId = before.overlay;
      this.motionCommands = before.motion;
      this.motionSerial = before.serial;
      throw error;
    }
  }
  refreshData() {
    const next = databaseContext(this.database.data);
    this.context.Tables = next.Tables;
    this.context.Queries = next.Queries;
    for (const [name, rows] of Object.entries(next.Tables)) {
      const selected = this.context.Selection?.[name];
      this.context.Selection[name] = rows.find((r) => r._id === selected?._id) || rows[0] || {};
    }
  }
  contextPath(target) {
    if (target === this.context) return '';
    const visit = (value, path, depth) => {
      if (value === target) return path;
      if (depth > 12 || !value || typeof value !== 'object') return null;
      for (const [key, item] of Object.entries(value)) {
        if (item && typeof item === 'object') {
          const found = visit(item, path ? path + '.' + key : key, depth + 1);
          if (found !== null) return found;
        }
      }
      return null;
    };
    return visit(this.context, '', 0);
  }
  describeContext(context) {
    const path = this.contextPath(context);
    if (path === null) return { contextPath: null };
    const parts = pathParts(path);
    if (['Tables', 'Selection'].includes(parts[0])) {
      const table = tableBy(this.database.data, parts[1]),
        offset = parts[0] === 'Tables' ? 3 : 2,
        row =
          parts[0] === 'Tables'
            ? this.context.Tables[parts[1]]?.[parts[2]]
            : this.context.Selection[parts[1]];
      if (table && row?._id)
        return {
          contextPath: path,
          recordLocator: { tableId: table.id, rowId: row._id, suffix: parts.slice(offset) },
        };
    }
    return { contextPath: path };
  }
  writeValue(path, value, { notify = true } = {}) {
    const parts = pathParts(path),
      next = clone(this.context),
      database = new DesignDatabase(this.database.data);
    if (!parts.length) throw Error('Choose a writable data property.');
    if (parts[0] === 'Queries')
      throw Error('Query projections are read-only. Update a source table record.');
    if (['Tables', 'Selection'].includes(parts[0])) {
      const table = tableBy(database.data, parts[1]);
      if (!table) throw Error('Binding table not found.');
      const row =
          parts[0] === 'Tables' ? next.Tables[parts[1]]?.[parts[2]] : next.Selection[parts[1]],
        offset = parts[0] === 'Tables' ? 3 : 2,
        column = table.columns.find((c) => c.name === parts[offset]);
      if (!row?._id || !column) throw Error('Bind to a writable table column.');
      let result = value;
      if (parts.length > offset + 1) {
        if (column.type !== 'json') throw Error('Only JSON columns support nested properties.');
        result = clone(row[column.name]);
        if (!result || typeof result !== 'object') throw Error('JSON column is not an object.');
        writePath(result, parts.slice(offset + 1).join('.'), value);
      }
      database.update(table.id, row._id, { [column.name]: result });
      const derived = databaseContext(database.data);
      next.Tables = derived.Tables;
      next.Queries = derived.Queries;
      for (const [name, rows] of Object.entries(derived.Tables)) {
        const selected = next.Selection?.[name];
        next.Selection[name] = rows.find((r) => r._id === selected?._id) || rows[0] || {};
      }
    } else writePath(next, path, value);
    const changed = JSON.stringify(next) !== JSON.stringify(this.context);
    this.database = database;
    this.context = next;
    if (changed && notify) this.dispatchEvent(new Event('change'));
    return true;
  }
  writeBinding(change) {
    const binding = parseBinding(change.expression);
    if (!binding || binding.options.Mode !== 'TwoWay') return true;
    if (binding.options.Converter || binding.options.StringFormat)
      throw Error('TwoWay converters and formatted values require a runtime adapter.');
    let path = binding.path;
    if (!path) throw Error('TwoWay bindings require a property path.');
    if (path.startsWith('$root.')) path = path.slice(6);
    else {
      let base = Object.hasOwn(change, 'contextPath')
        ? change.contextPath
        : this.contextPath(change.context);
      if (change.recordLocator) {
        const locator = change.recordLocator,
          table = tableBy(this.database.data, locator.tableId),
          index = table?.rows.findIndex((r) => r._id === locator.rowId);
        if (!table || index < 0) throw Error('The bound record no longer exists.');
        base = ['Tables', table.name, String(index), ...(locator.suffix || [])].join('.');
      }
      if (base === null) throw Error('The input data context is no longer current.');
      path = base ? base + '.' + path : path;
    }
    return this.writeValue(path, change.value);
  }
  execute(action, event, sourceViewId) {
    if (!ACTION_TYPES.includes(action.type)) throw Error('Unknown prototype action.');
    const value = this.resolve(action.value, event);
    switch (action.type) {
      case 'startStoryboard':
      case 'stopStoryboard':
      case 'goToState': {
        const vid = action.targetViewId || sourceViewId,
          doc = this.documents.find((d) => d.id === vid);
        if (!doc) throw Error('Animation view not found.');
        if (action.type === 'goToState') {
          const group = stateGroups(doc).find((g) => g.id === action.groupId);
          if (!group?.states.some((n) => (n.props['x:Name'] || n.props.Name) === action.stateName))
            throw Error('Visual state no longer exists.');
        } else if (
          action.storyboardId &&
          !listStoryboards(doc).some((s) => s.id === action.storyboardId)
        )
          throw Error('Storyboard no longer exists.');
        else if (action.type === 'startStoryboard' && !action.storyboardId)
          throw Error('Select a storyboard.');
        this.motionCommands.push({
          ...clone(action),
          targetViewId: vid,
          serial: ++this.motionSerial,
        });
        break;
      }
      case 'navigate':
        if (!this.documents.some((d) => d.id === action.targetViewId))
          throw Error('Connection target view no longer exists.');
        this.history.push(this.currentViewId);
        this.currentViewId = action.targetViewId;
        break;
      case 'back':
        this.currentViewId = this.history.pop() || this.startViewId;
        break;
      case 'setData':
        this.writeValue(action.path, value, { notify: false });
        break;
      case 'toggleData':
        this.writeValue(action.path, !readPath(this.context, action.path), { notify: false });
        break;
      case 'increment': {
        const old = readPath(this.context, action.path) ?? 0;
        if (typeof old !== 'number' || !Number.isFinite(Number(value ?? 1)))
          throw Error('Increment requires numeric state.');
        this.writeValue(action.path, old + Number(value ?? 1), { notify: false });
        break;
      }
      case 'setProperty':
      case 'toggleVisibility': {
        const vid = action.targetViewId || sourceViewId,
          doc = this.documents.find((d) => d.id === vid);
        if (!doc || !find(doc.root, action.targetId))
          throw Error('Target control no longer exists.');
        const values = ((this.overrides[vid] ??= {})[action.targetId] ??= {});
        if (action.type === 'setProperty') {
          if (
            !/^[A-Za-z_][\w.:-]*$/.test(action.property) ||
            ['__proto__', 'constructor', 'prototype'].includes(action.property)
          )
            throw Error('Invalid target property.');
          values[action.property] = String(value ?? '');
        } else {
          const key = doc.framework === 'Avalonia' ? 'IsVisible' : 'Visibility',
            current = values[key] ?? find(doc.root, action.targetId).props[key];
          values[key] =
            doc.framework === 'Avalonia'
              ? current === 'False'
                ? 'True'
                : 'False'
              : current === 'Collapsed'
                ? 'Visible'
                : 'Collapsed';
        }
        break;
      }
      case 'selectRecord': {
        const table = this.database.data.tables.find((t) => t.id === action.tableId),
          row = table?.rows.find((r) => r._id === (action.rowId || event.rowId || value));
        if (!row) throw Error('Record not found.');
        this.context.Selection[table.name] = clone(row);
        break;
      }
      case 'insertRecord':
        this.database.insert(action.tableId, value || {});
        this.refreshData();
        break;
      case 'updateRecord':
        this.database.update(action.tableId, action.rowId || event.rowId, value || {});
        this.refreshData();
        break;
      case 'deleteRecord':
        this.database.remove(action.tableId, action.rowId || event.rowId || value);
        this.refreshData();
        break;
      case 'openOverlay':
        if (!this.documents.some((d) => d.id === action.targetViewId))
          throw Error('Overlay view no longer exists.');
        this.overlayViewId = action.targetViewId;
        break;
      case 'closeOverlay':
        this.overlayViewId = null;
        break;
    }
  }
}
