/** Reversible document deltas. No retained document snapshots or DOM dependency. */
export const DEFAULT_HISTORY_LIMIT = 100;
export const DEFAULT_HISTORY_BYTE_LIMIT = 32 * 1024 * 1024;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) =>
  !!value &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const copyString = (value) => JSON.parse(JSON.stringify(value));
const copy = (value) => (typeof value === 'string' ? copyString(value) : structuredClone(value));
const define = (object, key, value) =>
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });

/** Cycles cannot be represented as a document delta. Shared acyclic values are allowed. */
export function validateHistoryValue(value) {
  const active = new Set(),
    done = new Set();
  const visit = (value, depth) => {
    if (!value || typeof value !== 'object') return;
    if (active.has(value)) throw Error('Document history cannot contain cyclic data.');
    if (done.has(value)) return;
    if (depth > 512) throw Error('Document history data is too deeply nested.');
    active.add(value);
    if (value instanceof Map)
      for (const [key, item] of value) {
        visit(key, depth + 1);
        visit(item, depth + 1);
      }
    else if (value instanceof Set) for (const item of value) visit(item, depth + 1);
    else if (
      !ArrayBuffer.isView(value) &&
      !(value instanceof ArrayBuffer) &&
      !(value instanceof Date) &&
      !(value instanceof RegExp)
    )
      for (const key of Object.keys(value)) visit(value[key], depth + 1);
    active.delete(value);
    done.add(value);
  };
  visit(value, 0);
  return value;
}
function equal(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((key) => own(b, key) && equal(a[key], b[key]))
    );
  if (a instanceof Date || b instanceof Date)
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  if (a instanceof RegExp || b instanceof RegExp)
    return (
      a instanceof RegExp && b instanceof RegExp && a.source === b.source && a.flags === b.flags
    );
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false;
    const aa = [...a],
      bb = [...b];
    return aa.every(([k, v], i) => equal(k, bb[i][0]) && equal(v, bb[i][1]));
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return false;
    return equal([...a], [...b]);
  }
  if (
    a instanceof ArrayBuffer ||
    b instanceof ArrayBuffer ||
    ArrayBuffer.isView(a) ||
    ArrayBuffer.isView(b)
  ) {
    if (
      Object.prototype.toString.call(a) !== Object.prototype.toString.call(b) ||
      a.byteLength !== b.byteLength
    )
      return false;
    const aa = new Uint8Array(a.buffer || a, a.byteOffset || 0, a.byteLength),
      bb = new Uint8Array(b.buffer || b, b.byteOffset || 0, b.byteLength);
    return aa.every((v, i) => v === bb[i]);
  }
  if (!plain(a) || !plain(b)) return false;
  const aa = Object.keys(a),
    bb = Object.keys(b);
  return aa.length === bb.length && aa.every((key, i) => key === bb[i] && equal(a[key], b[key]));
}
function arrayKey(a, b) {
  if (!a.length && !b.length) return null;
  for (const key of ['id', '_id'])
    if (
      [a, b].every((items) => {
        const keys = new Set();
        return items.every((item) => {
          const id = item?.[key];
          if (!plain(item) || typeof id !== 'string' || keys.has(id)) return false;
          keys.add(id);
          return true;
        });
      })
    )
      return key;
  return null;
}
function textDelta(a, b) {
  let start = 0,
    endA = a.length,
    endB = b.length;
  while (start < endA && start < endB && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--;
    endB--;
  }
  return {
    type: 'text',
    start,
    removed: copyString(a.slice(start, endA)),
    inserted: copyString(b.slice(start, endB)),
  };
}
function sequenceDelta(a, b) {
  if (a.length === b.length && a.every((value, i) => value === b[i])) return null;
  if (a.length === b.length) {
    const membership = new Set(a);
    if (membership.size === a.length && b.every((value) => membership.has(value))) {
      const work = [...a],
        moves = [];
      for (let i = 0; i < b.length; i++) {
        if (work[i] === b[i]) continue;
        const from = work.indexOf(b[i], i + 1);
        moves.push({ from, to: i });
        work.splice(i, 0, work.splice(from, 1)[0]);
        if (moves.length > 32) break;
      }
      if (moves.length <= 32) return { type: 'moves', moves };
    }
  }
  let index = 0,
    endA = a.length,
    endB = b.length;
  while (index < endA && index < endB && a[index] === b[index]) index++;
  while (endA > index && endB > index && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { type: 'splice', index, removed: a.slice(index, endA), inserted: b.slice(index, endB) };
}
function delta(a, b) {
  if (Object.is(a, b)) return null;
  if (typeof a === 'string' && typeof b === 'string') return textDelta(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    const key = arrayKey(a, b);
    if (key) {
      const old = new Map(a.map((item) => [item[key], item])),
        next = new Map(b.map((item) => [item[key], item])),
        changes = [];
      for (const [id, item] of old) {
        if (!next.has(id))
          changes.push({
            key: id,
            before: true,
            after: false,
            delta: { type: 'value', before: copy(item), after: undefined },
          });
        else {
          const changed = delta(item, next.get(id));
          if (changed) changes.push({ key: id, before: true, after: true, delta: changed });
        }
      }
      for (const [id, item] of next)
        if (!old.has(id))
          changes.push({
            key: id,
            before: false,
            after: true,
            delta: { type: 'value', before: undefined, after: copy(item) },
          });
      const order = sequenceDelta(
        a.map((item) => item[key]),
        b.map((item) => item[key]),
      );
      return changes.length || order ? { type: 'keyed-array', key, order, changes } : null;
    }
    // Sparse arrays and non-index properties use replacement so their exact shape survives.
    if (Object.keys(a).length !== a.length || Object.keys(b).length !== b.length)
      return equal(a, b) ? null : { type: 'value', before: copy(a), after: copy(b) };
    if (a.length === b.length) {
      const changes = [];
      for (let i = 0; i < a.length; i++) {
        const changed = delta(a[i], b[i]);
        if (changed) changes.push({ index: i, delta: changed });
      }
      return changes.length ? { type: 'array', changes } : null;
    }
    let index = 0,
      endA = a.length,
      endB = b.length;
    while (index < endA && index < endB && equal(a[index], b[index])) index++;
    while (endA > index && endB > index && equal(a[endA - 1], b[endB - 1])) {
      endA--;
      endB--;
    }
    return {
      type: 'splice',
      index,
      removed: copy(a.slice(index, endA)),
      inserted: copy(b.slice(index, endB)),
    };
  }
  if (plain(a) && plain(b)) {
    const beforeKeys = Object.keys(a),
      afterKeys = Object.keys(b),
      changes = [];
    for (const key of beforeKeys) {
      if (!own(b, key))
        changes.push({
          key,
          before: true,
          after: false,
          delta: { type: 'value', before: copy(a[key]), after: undefined },
        });
      else {
        const changed = delta(a[key], b[key]);
        if (changed) changes.push({ key, before: true, after: true, delta: changed });
      }
    }
    for (const key of afterKeys)
      if (!own(a, key))
        changes.push({
          key,
          before: false,
          after: true,
          delta: { type: 'value', before: undefined, after: copy(b[key]) },
        });
    const sameKeys =
      beforeKeys.length === afterKeys.length && beforeKeys.every((key, i) => key === afterKeys[i]);
    return changes.length || !sameKeys
      ? {
          type: 'object',
          changes,
          ...(sameKeys ? {} : { keys: { before: beforeKeys, after: afterKeys } }),
        }
      : null;
  }
  return equal(a, b) ? null : { type: 'value', before: copy(a), after: copy(b) };
}

/** Deterministic retained-payload estimate, not an engine-specific heap measurement. */
export function estimateHistoryBytes(value) {
  const seen = new Set();
  const measure = (value) => {
    if (value === null || value === undefined) return 8;
    if (typeof value === 'string') return 24 + value.length * 2;
    if (typeof value !== 'object') return 8;
    if (seen.has(value)) return 0;
    seen.add(value);
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return 64 + value.byteLength;
    if (value instanceof Date) return 64;
    if (value instanceof RegExp) return 64 + measure(value.source) + measure(value.flags);
    if (value instanceof Map)
      return 64 + [...value].reduce((n, [k, v]) => n + 32 + measure(k) + measure(v), 0);
    if (value instanceof Set) return 64 + [...value].reduce((n, v) => n + 16 + measure(v), 0);
    return (
      64 + Object.keys(value).reduce((n, key) => n + 16 + measure(key) + measure(value[key]), 0)
    );
  };
  return measure(value);
}
/** No input object is retained. Unchanged subtrees and source strings are omitted. */
export function createHistoryPatch(before, after) {
  validateHistoryValue(before);
  validateHistoryValue(after);
  const change = delta(before, after);
  if (!change) return null;
  const patch = { version: 1, delta: change };
  patch.estimatedBytes = estimateHistoryBytes(patch);
  return patch;
}
const conflict = () => {
  throw Error('Document history no longer matches the current document.');
};
function apply(value, change, forward) {
  const from = forward ? 'before' : 'after',
    to = forward ? 'after' : 'before';
  switch (change.type) {
    case 'value':
      if (!equal(value, change[from])) conflict();
      return copy(change[to]);
    case 'text': {
      const removed = forward ? change.removed : change.inserted,
        inserted = forward ? change.inserted : change.removed;
      if (
        typeof value !== 'string' ||
        !Number.isInteger(change.start) ||
        change.start < 0 ||
        change.start + removed.length > value.length ||
        value.slice(change.start, change.start + removed.length) !== removed
      )
        conflict();
      return value.slice(0, change.start) + inserted + value.slice(change.start + removed.length);
    }
    case 'object': {
      if (!plain(value)) conflict();
      const result = {};
      for (const key of Object.keys(value)) define(result, key, value[key]);
      for (const entry of change.changes) {
        if (own(result, entry.key) !== entry[from]) conflict();
        const next = apply(entry[from] ? result[entry.key] : undefined, entry.delta, forward);
        if (entry[to]) define(result, entry.key, next);
        else delete result[entry.key];
      }
      if (change.keys) {
        const keys = change.keys[to];
        if (
          keys.length !== Object.keys(result).length ||
          new Set(keys).size !== keys.length ||
          keys.some((key) => !own(result, key))
        )
          conflict();
        const ordered = {};
        for (const key of keys) define(ordered, key, result[key]);
        return ordered;
      }
      return result;
    }
    case 'array': {
      if (!Array.isArray(value)) conflict();
      const result = value.slice();
      for (const entry of change.changes) {
        if (entry.index >= result.length) conflict();
        result[entry.index] = apply(result[entry.index], entry.delta, forward);
      }
      return result;
    }
    case 'splice': {
      if (!Array.isArray(value)) conflict();
      const removed = forward ? change.removed : change.inserted,
        inserted = forward ? change.inserted : change.removed;
      if (
        !Number.isInteger(change.index) ||
        change.index < 0 ||
        change.index + removed.length > value.length ||
        !equal(value.slice(change.index, change.index + removed.length), removed)
      )
        conflict();
      return [
        ...value.slice(0, change.index),
        ...copy(inserted),
        ...value.slice(change.index + removed.length),
      ];
    }
    case 'moves': {
      if (!Array.isArray(value)) conflict();
      const result = value.slice(),
        moves = forward ? change.moves : [...change.moves].reverse();
      for (const move of moves) {
        const from = forward ? move.from : move.to,
          to = forward ? move.to : move.from;
        if (from < 0 || from >= result.length || to < 0 || to >= result.length) conflict();
        result.splice(to, 0, result.splice(from, 1)[0]);
      }
      return result;
    }
    case 'keyed-array': {
      if (
        !Array.isArray(value) ||
        value.some((item) => !plain(item) || typeof item[change.key] !== 'string')
      )
        conflict();
      const items = new Map(value.map((item) => [item[change.key], item]));
      if (items.size !== value.length) conflict();
      const currentOrder = value.map((item) => item[change.key]),
        order = change.order ? apply(currentOrder, change.order, forward) : currentOrder;
      for (const entry of change.changes) {
        if (items.has(entry.key) !== entry[from]) conflict();
        const next = apply(items.get(entry.key), entry.delta, forward);
        if (entry[to]) items.set(entry.key, next);
        else items.delete(entry.key);
      }
      if (
        order.length !== items.size ||
        new Set(order).size !== order.length ||
        order.some((key) => !items.has(key))
      )
        conflict();
      return order.map((key) => items.get(key));
    }
    default:
      throw Error('Unsupported document history patch.');
  }
}
/** Applies changed paths immutably; unmodified subtrees are shared with the input. */
export function applyHistoryPatch(document, patch, { direction = 'forward' } = {}) {
  if (patch?.version !== 1 || !['forward', 'backward'].includes(direction))
    throw Error('Unsupported document history patch.');
  return apply(document, patch.delta, direction === 'forward');
}
