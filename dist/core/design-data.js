import { uid, clone } from './model.js';
export const DATA_TYPES = ['string', 'number', 'boolean', 'date', 'json'];
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function validName(name) {
  return typeof name === 'string' && /^[A-Za-z_]\w*$/.test(name) && !forbidden.has(name);
}
export function pathParts(path) {
  if (typeof path !== 'string' || path.length > 500) throw Error('Invalid data path.');
  const value = path.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
  if (!value) return [];
  const parts = value.split('.');
  if (parts.some((p) => !p || forbidden.has(p) || !/^\w+$/.test(p)))
    throw Error('Use safe dotted property paths and numeric indexes.');
  return parts;
}
export function readPath(root, path) {
  let value = root;
  for (const p of pathParts(path)) {
    if (value == null || !Object.hasOwn(Object(value), p)) return undefined;
    value = value[p];
  }
  return value;
}
export function writePath(root, path, value) {
  const parts = pathParts(path);
  if (!parts.length) throw Error('Choose a writable data path.');
  let target = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (target[p] === undefined) target[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    if (!target[p] || typeof target[p] !== 'object')
      throw Error('Data path crosses a scalar value.');
    target = target[p];
  }
  target[parts.at(-1)] = clone(value);
}
export function parseValue(value, type, nullable = true) {
  if (value === null || value === undefined || (value === '' && type !== 'string')) {
    if (nullable) return null;
    throw Error('A value is required.');
  }
  if (type === 'string') return String(value);
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) throw Error('Enter a finite number.');
    return n;
  }
  if (type === 'boolean') {
    if (value === true || value === 'true' || value === 'True') return true;
    if (value === false || value === 'false' || value === 'False') return false;
    throw Error('Use true or false.');
  }
  if (type === 'date') {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
    )
      throw Error('Use a valid YYYY-MM-DD date.');
    return value;
  }
  if (type === 'json') {
    return typeof value === 'string' ? JSON.parse(value) : clone(value);
  }
  throw Error('Unsupported column type.');
}
export function createDatabase() {
  return {
    version: 1,
    tables: [],
    relationships: [],
    queries: [],
    objects: { App: { Title: 'My workspace', Counter: 0, IsOpen: false, Search: '' } },
  };
}
export function tableBy(db, id) {
  return db.tables.find((t) => t.id === id || t.name === id);
}
export function validateDatabase(db) {
  if (
    !db ||
    db.version !== 1 ||
    !Array.isArray(db.tables) ||
    !Array.isArray(db.relationships) ||
    !Array.isArray(db.queries) ||
    !db.objects ||
    typeof db.objects !== 'object' ||
    Array.isArray(db.objects) ||
    db.tables.length > 100
  )
    throw Error('Invalid design database.');
  if (
    Object.keys(db.objects).some(
      (k) => !validName(k) || ['Tables', 'Queries', 'Selection'].includes(k),
    )
  )
    throw Error('Object roots must be safe names outside Tables, Queries, and Selection.');
  const names = new Set(),
    ids = new Set();
  let count = 0;
  for (const table of db.tables) {
    if (!Array.isArray(table.columns) || !Array.isArray(table.rows))
      throw Error('Tables require column and row arrays.');
    if (
      !validName(table.name) ||
      names.has(table.name) ||
      typeof table.id !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(table.id) ||
      ids.has(table.id)
    )
      throw Error('Tables require unique names and IDs.');
    names.add(table.name);
    ids.add(table.id);
    const columns = new Set();
    for (const c of table.columns) {
      if (
        !validName(c.name) ||
        c.name === '_id' ||
        columns.has(c.name) ||
        !DATA_TYPES.includes(c.type)
      )
        throw Error('Invalid or duplicate column.');
      columns.add(c.name);
    }
    const rowIds = new Set();
    for (const row of table.rows) {
      if (
        !row ||
        typeof row !== 'object' ||
        typeof row._id !== 'string' ||
        !/^[A-Za-z0-9_-]+$/.test(row._id) ||
        rowIds.has(row._id)
      )
        throw Error('Rows require unique IDs.');
      rowIds.add(row._id);
      if (++count > 20000) throw Error('The design database supports up to 20,000 rows.');
      for (const c of table.columns) {
        const v = row[c.name];
        if (c.required && (v === undefined || v === null || v === ''))
          throw Error(`${table.name}.${c.name} is required.`);
        if (v !== undefined && v !== null) {
          const parsed = parseValue(v, c.type, !c.required);
          if (JSON.stringify(parsed) !== JSON.stringify(v))
            throw Error(`${table.name}.${c.name} has the wrong value type.`);
        }
      }
    }
    for (const c of table.columns.filter((c) => c.unique)) {
      const values = new Set();
      for (const row of table.rows) {
        const value = row[c.name];
        if (value === null || value === undefined) continue;
        const key = JSON.stringify(value);
        if (values.has(key)) throw Error(`${table.name}.${c.name} must be unique.`);
        values.add(key);
      }
    }
  }
  const relIds = new Set();
  for (const rel of db.relationships) {
    if (
      typeof rel.id !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(rel.id) ||
      relIds.has(rel.id) ||
      !['restrict', 'cascade', 'setNull'].includes(rel.onDelete || 'restrict')
    )
      throw Error('Invalid relationship identity or deletion policy.');
    relIds.add(rel.id);
    const from = tableBy(db, rel.fromTable),
      to = tableBy(db, rel.toTable);
    const fc = from?.columns.find((c) => c.name === rel.fromColumn),
      tc =
        rel.toColumn === '_id'
          ? { unique: true, type: 'string' }
          : to?.columns.find((c) => c.name === rel.toColumn);
    if (!from || !to || !fc || !tc || !tc.unique)
      throw Error('Relationship targets must be a primary ID or unique column.');
    if (fc.type !== tc.type) throw Error('Relationship columns must have matching types.');
    for (const row of from.rows) {
      const value = row[rel.fromColumn];
      if (value != null && !to.rows.some((r) => r[rel.toColumn] === value))
        throw Error(`Foreign key ${from.name}.${rel.fromColumn} references a missing record.`);
    }
  }
  const queryNames = new Set(),
    queryIds = new Set();
  for (const q of db.queries) {
    if (
      !validName(q.name) ||
      queryNames.has(q.name) ||
      typeof q.id !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(q.id) ||
      queryIds.has(q.id)
    )
      throw Error('Queries require unique names and IDs.');
    queryNames.add(q.name);
    queryIds.add(q.id);
    validateQuery(db, q);
  }
  return db;
}
export class DesignDatabase {
  constructor(data = createDatabase()) {
    this.data = clone(validateDatabase(data));
  }
  transaction(action) {
    const next = clone(this.data);
    action(next);
    validateDatabase(next);
    this.data = next;
    return this;
  }
  addTable(name, columns = []) {
    let id;
    this.transaction((db) => {
      id = uid();
      db.tables.push({ id, name, columns: clone(columns), rows: [] });
    });
    return id;
  }
  addColumn(tableId, column) {
    this.transaction((db) => {
      const t = tableBy(db, tableId);
      if (!t) throw Error('Table not found.');
      t.columns.push(clone(column));
      for (const row of t.rows)
        row[column.name] = parseValue(column.default ?? null, column.type, !column.required);
    });
  }
  insert(tableId, values = {}) {
    let id;
    this.transaction((db) => {
      const t = tableBy(db, tableId);
      if (!t) throw Error('Table not found.');
      const row = { _id: uid() };
      for (const c of t.columns)
        row[c.name] = parseValue(values[c.name] ?? c.default ?? null, c.type, !c.required);
      t.rows.push(row);
      id = row._id;
    });
    return id;
  }
  update(tableId, rowId, values) {
    this.transaction((db) => {
      const t = tableBy(db, tableId),
        row = t?.rows.find((r) => r._id === rowId);
      if (!row) throw Error('Record not found.');
      for (const [key, value] of Object.entries(values)) {
        const c = t.columns.find((c) => c.name === key);
        if (!c) throw Error('Column not found: ' + key);
        row[key] = parseValue(value, c.type, !c.required);
      }
    });
  }
  remove(tableId, rowId) {
    this.transaction((db) => {
      const visited = new Set();
      const remove = (tid, rid) => {
        const t = tableBy(db, tid),
          row = t?.rows.find((r) => r._id === rid);
        if (!row) return;
        const key = t.id + ':' + rid;
        if (visited.has(key)) return;
        visited.add(key);
        for (const rel of db.relationships.filter((r) => r.toTable === t.id)) {
          const source = tableBy(db, rel.fromTable),
            dependents = source.rows.filter((r) => r[rel.fromColumn] === row[rel.toColumn]);
          if (dependents.length) {
            if (rel.onDelete === 'cascade') dependents.forEach((r) => remove(source.id, r._id));
            else if (rel.onDelete === 'setNull')
              dependents.forEach((r) => (r[rel.fromColumn] = null));
            else throw Error(`Record is referenced by ${source.name}; deletion is restricted.`);
          }
        }
        t.rows = t.rows.filter((r) => r._id !== rid);
      };
      remove(tableId, rowId);
    });
  }
}
export function compareValue(actual, operator, expected) {
  switch (operator) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'contains':
      return String(actual ?? '')
        .toLowerCase()
        .includes(String(expected ?? '').toLowerCase());
    case 'startsWith':
      return String(actual ?? '').startsWith(String(expected ?? ''));
    case 'gt':
      return actual > expected;
    case 'gte':
      return actual >= expected;
    case 'lt':
      return actual < expected;
    case 'lte':
      return actual <= expected;
    case 'isNull':
      return actual == null;
    case 'notNull':
      return actual != null;
    default:
      throw Error('Unknown filter operator.');
  }
}
export const FILTER_OPERATORS = [
  'eq',
  'ne',
  'contains',
  'startsWith',
  'gt',
  'gte',
  'lt',
  'lte',
  'isNull',
  'notNull',
];
export function validateQuery(db, query) {
  const table = tableBy(db, query.tableId);
  if (!table) throw Error('Query table not found.');
  const column = (t, name) => name === '_id' || t.columns.some((c) => c.name === name);
  if (
    (query.filters !== undefined && !Array.isArray(query.filters)) ||
    (query.joins !== undefined && !Array.isArray(query.joins))
  )
    throw Error('Invalid query filters or joins.');
  for (const f of query.filters || [])
    if (!column(table, f.column) || !FILTER_OPERATORS.includes(f.operator))
      throw Error('Invalid query filter column or operator.');
  const aliases = new Map();
  for (const j of query.joins || []) {
    const target = tableBy(db, j.tableId);
    if (
      !target ||
      !validName(j.as) ||
      column(table, j.as) ||
      aliases.has(j.as) ||
      !column(table, j.localColumn) ||
      !column(target, j.foreignColumn) ||
      !['left', 'inner'].includes(j.kind)
    )
      throw Error('Invalid query join column, alias, or kind.');
    aliases.set(j.as, target);
  }
  if (query.sort?.column) {
    const parts = query.sort.column.split('.'),
      valid =
        parts.length === 1
          ? column(table, parts[0])
          : parts.length === 2 && aliases.has(parts[0]) && column(aliases.get(parts[0]), parts[1]);
    if (!valid || !['asc', 'desc'].includes(query.sort.direction))
      throw Error('Invalid query sort.');
  }
  if (
    query.limit != null &&
    (!Number.isInteger(query.limit) || query.limit < 0 || query.limit > 20000)
  )
    throw Error('Query limit must be an integer from 0 to 20,000.');
  return table;
}
export function queryRows(db, query) {
  const table = validateQuery(db, query);
  let rows = table.rows.map(clone);
  for (const f of query.filters || [])
    rows = rows.filter((r) => compareValue(readPath(r, f.column), f.operator, f.value));
  for (const join of query.joins || []) {
    const other = tableBy(db, join.tableId),
      index = new Map();
    for (const row of other.rows) {
      const value = row[join.foreignColumn];
      if (value == null) continue;
      const key = JSON.stringify(value);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(row);
    }
    const next = [];
    for (const row of rows) {
      const matches =
        row[join.localColumn] == null ? [] : index.get(JSON.stringify(row[join.localColumn])) || [];
      if (next.length + Math.max(matches.length, join.kind === 'left' ? 1 : 0) > 20000)
        throw Error(
          'Query exceeds the 20,000 intermediate row limit. Add filters or use unique join keys.',
        );
      if (matches.length)
        for (const match of matches) next.push({ ...row, [join.as]: clone(match) });
      else if (join.kind === 'left') next.push({ ...row, [join.as]: null });
    }
    rows = next;
  }
  if (query.sort?.column) {
    const { column, direction } = query.sort;
    rows.sort((a, b) => {
      const av = readPath(a, column),
        bv = readPath(b, column);
      return (
        (av === bv
          ? 0
          : av == null
            ? -1
            : bv == null
              ? 1
              : typeof av === 'number' && typeof bv === 'number'
                ? av - bv
                : String(av).localeCompare(String(bv))) * (direction === 'desc' ? -1 : 1)
      );
    });
  }
  if (query.limit != null) rows = rows.slice(0, query.limit);
  return rows;
}
export function databaseContext(db) {
  const tables = {},
    queries = {},
    selection = {};
  for (const t of db.tables) {
    tables[t.name] = clone(t.rows);
    selection[t.name] = clone(t.rows[0] || {});
  }
  for (const q of db.queries || []) {
    try {
      queries[q.name] = queryRows(db, q);
    } catch {
      queries[q.name] = [];
    }
  }
  return { ...clone(db.objects), Tables: tables, Queries: queries, Selection: selection };
}
export function bindingPaths(value, prefix = '', depth = 0) {
  if (depth > 7 || value == null || typeof value !== 'object') return [];
  const paths = [];
  for (const key of Object.keys(value).slice(0, 100)) {
    if (forbidden.has(key)) continue;
    const path = prefix ? (Array.isArray(value) ? `${prefix}[${key}]` : `${prefix}.${key}`) : key;
    paths.push(path);
    if (Array.isArray(value) && Number(key) > 1) continue;
    paths.push(...bindingPaths(value[key], path, depth + 1));
  }
  return paths;
}
export function parseBinding(expression) {
  if (
    typeof expression !== 'string' ||
    !/^\{Binding(?:\s|,|})/.test(expression) ||
    !expression.endsWith('}')
  )
    return null;
  const inner = expression.slice(1, -1).replace(/^Binding\s*/, ''),
    parts = inner.split(/,(?![^{}]*})/).map((s) => s.trim()),
    options = {};
  let path = '';
  for (const part of parts) {
    const index = part.indexOf('=');
    if (index > 0) options[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    else if (part) path = part;
  }
  path = options.Path ?? path;
  return { path, options };
}
export function resolveBinding(expression, context, root = context) {
  const binding = parseBinding(expression);
  if (!binding) return expression;
  const { path, options } = binding;
  let value;
  try {
    value = path.startsWith('$root.')
      ? readPath(root, path.slice(6))
      : path
        ? readPath(context, path)
        : context;
  } catch {
    return undefined;
  }
  if (value === undefined && options.FallbackValue !== undefined) value = options.FallbackValue;
  if (value === null && options.TargetNullValue !== undefined) value = options.TargetNullValue;
  if (value !== undefined && options.StringFormat)
    value = options.StringFormat.replace(/^{}|^['"]|['"]$/g, '').replace(
      /\{0(?::[^}]+)?}/g,
      String(value),
    );
  return value;
}
export function parseCSV(text) {
  const rows = [];
  let row = [],
    value = '',
    quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quote = !quote;
    } else if (c === ',' && !quote) {
      row.push(value);
      value = '';
    } else if ((c === '\n' || c === '\r') && !quote) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else value += c;
  }
  if (quote) throw Error('Unclosed CSV quote.');
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}
export function toCSV(table) {
  const quote = (v) =>
    '"' +
    String(v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v).replace(/"/g, '""') +
    '"';
  return [
    table.columns.map((c) => c.name),
    ...table.rows.map((r) => table.columns.map((c) => r[c.name])),
  ]
    .map((r) => r.map(quote).join(','))
    .join('\r\n');
}
