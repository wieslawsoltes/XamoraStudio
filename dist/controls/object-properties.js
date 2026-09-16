/** Data-only object inspection and immutable graph edits. Accessors are never evaluated. */
export const objectPathKey = (path) => JSON.stringify(normalizePath(path));
const own = (value, key) => Object.getOwnPropertyDescriptor(value, key);
function normalizePath(path) {
  if (
    !Array.isArray(path) ||
    path.some((key) => typeof key !== 'string' && (!Number.isSafeInteger(key) || key < 0))
  )
    throw new TypeError('A property path must contain strings or nonnegative integer indices.');
  return path.map(String);
}
export function objectValueKind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value !== 'object') return typeof value;
  const prototype = Object.getPrototypeOf(value);
  // The null parent also recognizes ordinary objects created in another DOM realm.
  return prototype === null || Object.getPrototypeOf(prototype) === null ? 'object' : 'unsupported';
}
const container = (value) => ['object', 'array'].includes(objectValueKind(value));
export function getObjectProperty(value, path) {
  for (const key of normalizePath(path)) {
    if (!container(value)) throw new TypeError('Path crosses a non-data object.');
    const descriptor = own(value, key);
    if (!descriptor || !('value' in descriptor))
      throw new TypeError('Path does not name an own data property.');
    value = descriptor.value;
  }
  return value;
}
function limit(value, fallback, min, max, name) {
  value ??= fallback;
  if (!Number.isInteger(value) || value < min || value > max)
    throw new RangeError(`Invalid ${name}.`);
  return value;
}
/** Produces a bounded tree including read-only markers for accessors, cycles and unsupported values. */
export function inspectObjectProperties(value, options = {}) {
  const maxDepth = limit(options.maxDepth, 16, 0, 64, 'maxDepth');
  const maxEntries = limit(options.maxEntries, 5000, 1, 100000, 'maxEntries');
  let count = 0;
  const ancestors = new WeakSet();
  function visit(value, path, readOnly = false, accessor = false) {
    const kind = accessor ? 'accessor' : objectValueKind(value);
    const node = {
      path: Object.freeze(path),
      key: objectPathKey(path),
      kind,
      value,
      readOnly,
      children: [],
    };
    if (accessor) node.note = 'Accessor (not evaluated)';
    else if (['object', 'array'].includes(kind)) {
      if (ancestors.has(value)) node.note = 'Circular reference';
      else if (path.length >= maxDepth) node.note = 'Maximum depth reached';
      else {
        ancestors.add(value);
        for (const key of Object.keys(value)) {
          if (++count > maxEntries) {
            node.truncated = true;
            break;
          }
          const descriptor = own(value, key);
          if (!descriptor) continue;
          node.children.push(
            visit(
              descriptor.value,
              [...path, key],
              readOnly || descriptor.writable === false,
              !('value' in descriptor),
            ),
          );
        }
        ancestors.delete(value);
      }
    } else if (!['string', 'number', 'boolean', 'undefined', 'null'].includes(kind))
      node.note = `Unsupported ${kind}`;
    else if (kind === 'number' && !Number.isFinite(value)) node.note = 'Non-finite number';
    if (node.note || accessor) node.readOnly = true;
    return node;
  }
  return visit(value, [], !!options.readOnly);
}
/** Copy data graphs without invoking getters, preserving cycles, aliases and property descriptors. */
export function cloneObjectGraph(value, { maxNodes = 100000 } = {}) {
  limit(maxNodes, 100000, 1, 1000000, 'maxNodes');
  const copies = new WeakMap(),
    queue = [];
  const clone = (source) => {
    if (!container(source)) return source;
    if (copies.has(source)) return copies.get(source);
    if (queue.length >= maxNodes) throw new RangeError('Maximum object count reached.');
    const target = Array.isArray(source) ? [] : Object.create(Object.getPrototypeOf(source));
    copies.set(source, target);
    queue.push([source, target]);
    return target;
  };
  const result = clone(value);
  for (let index = 0; index < queue.length; index++) {
    const [source, target] = queue[index];
    for (const key of Reflect.ownKeys(source)) {
      if (Array.isArray(source) && key === 'length') continue;
      const descriptor = own(source, key);
      if (!descriptor) continue;
      if ('value' in descriptor) descriptor.value = clone(descriptor.value);
      Object.defineProperty(target, key, descriptor);
    }
    if (Array.isArray(source)) Object.defineProperty(target, 'length', own(source, 'length'));
    if (!Object.isExtensible(source)) Object.preventExtensions(target);
  }
  return result;
}
/** Edits only own data paths. No eval, dotted-path assignment, inherited writes or accessor calls. */
export function editObjectProperty(
  source,
  path,
  value,
  { operation = 'set', maxNodes = 100000 } = {},
) {
  const keys = normalizePath(path);
  if (!['set', 'add', 'remove'].includes(operation))
    throw new TypeError('Invalid object edit operation.');
  if (!keys.length) {
    if (operation !== 'set') throw new TypeError('The root can only be replaced.');
    return cloneObjectGraph(value, { maxNodes });
  }
  let parent = source;
  for (const key of keys.slice(0, -1)) {
    if (!container(parent)) throw new TypeError('Path crosses a non-data object.');
    const descriptor = own(parent, key);
    if (!descriptor || !('value' in descriptor))
      throw new TypeError('Path does not name an own data property.');
    if (!descriptor.writable) throw new TypeError('Path crosses a read-only property.');
    parent = descriptor.value;
  }
  if (!container(parent)) throw new TypeError('The parent is not a data object or array.');
  const key = keys.at(-1),
    descriptor = own(parent, key);
  if (operation === 'add') {
    if (descriptor) throw new TypeError('The property already exists.');
    if (!Object.isExtensible(parent))
      throw new TypeError('The object does not allow new properties.');
  } else {
    if (!descriptor || !('value' in descriptor))
      throw new TypeError('Only own data properties can be edited.');
    if (operation === 'set' && !descriptor.writable)
      throw new TypeError('The property is read-only.');
    if (operation === 'remove' && !descriptor.configurable)
      throw new TypeError('The property cannot be removed.');
  }
  if (Array.isArray(parent)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || +key >= 4294967295)
      throw new TypeError('Array edits require an array index.');
    if (operation === 'add' && +key !== parent.length)
      throw new TypeError('New array items must be appended.');
    if (operation === 'remove') {
      for (let i = +key; i < parent.length; i++) {
        const item = own(parent, String(i));
        if (item && (!('value' in item) || !item.writable || !item.configurable))
          throw new TypeError('Array removal would move an accessor or read-only item.');
      }
    }
    if (operation !== 'set' && !own(parent, 'length').writable)
      throw new TypeError('Array length is read-only.');
  }
  // Clone root and incoming value together to preserve aliases between the two graphs.
  const [next, inserted] = cloneObjectGraph([source, value], { maxNodes });
  const target = getObjectProperty(next, keys.slice(0, -1));
  if (operation === 'remove') {
    if (Array.isArray(target)) Array.prototype.splice.call(target, +key, 1);
    else Reflect.deleteProperty(target, key);
  } else
    Object.defineProperty(
      target,
      key,
      descriptor
        ? { ...descriptor, value: inserted }
        : { value: inserted, writable: true, configurable: true, enumerable: true },
    );
  return next;
}
