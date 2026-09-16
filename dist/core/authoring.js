import { element, find, localName, clone, parentOf, walk, isElement } from './model.js';
import { findResource } from './styling.js';
import { resolveDictionary } from './solution.js';
export const propertyObject = (node, key) =>
  node.children?.find((n) => n.type?.endsWith('.' + key))?.children.find(isElement);
export function replaceObject(node, key, value) {
  node.children = node.children.filter((n) => !n.type?.endsWith('.' + key));
  delete node.props[key];
  if (value) node.children.push(element(node.type + '.' + key, {}, [value]));
}
export function setLiteral(node, key, value) {
  node.children = node.children.filter((n) => !(n.type === key || n.type?.endsWith('.' + key)));
  if (value === null || value === undefined) delete node.props[key];
  else node.props[key] = String(value);
}
export function textTarget(node) {
  const type = localName(node.type);
  if (
    ![
      'TextBlock',
      'TextBox',
      'Label',
      'Button',
      'ToggleButton',
      'CheckBox',
      'RadioButton',
      'Run',
    ].includes(type)
  )
    return null;
  const key = ['TextBlock', 'TextBox', 'Run'].includes(type) ? 'Text' : 'Content';
  if (String(node.props[key] || '').startsWith('{') && !String(node.props[key]).startsWith('{}'))
    throw Error('This text is bound. Edit its binding or data source in Properties.');
  if (
    node.children.some(
      (n) =>
        (n.kind === 'element' && !n.type.includes('.')) ||
        n.type?.endsWith('.' + key) ||
        n.type?.endsWith('.Inlines'),
    )
  )
    throw Error('This control contains structured content. Select its text child to edit it.');
  return {
    key,
    value:
      node.props[key]?.replace(/^\{\}/, '') ??
      node.children
        .filter((n) => n.kind === 'text' || n.kind === 'cdata')
        .map((n) => n.text || n.value || '')
        .join(''),
  };
}
export function setText(node, value) {
  const target = textTarget(node);
  if (!target) throw Error('Select a text control.');
  node.children = node.children.filter((n) => n.kind !== 'text' && n.kind !== 'cdata');
  setLiteral(node, target.key, String(value).startsWith('{') ? '{}' + value : value);
}
export function fourValues(value) {
  if (String(value || '').startsWith('{')) return null;
  const a = String(value ?? '0')
    .split(/[,\s]+/)
    .map(Number);
  if (!a.every(Number.isFinite) || ![1, 2, 4].includes(a.length)) return null;
  return a.length === 1 ? [a[0], a[0], a[0], a[0]] : a.length === 2 ? [a[0], a[1], a[0], a[1]] : a;
}
export function colorParts(value) {
  const v = String(value || '');
  if (/^#[0-9a-f]{8}$/i.test(v))
    return { rgb: '#' + v.slice(3), alpha: parseInt(v.slice(1, 3), 16) / 255 };
  if (/^#[0-9a-f]{6}$/i.test(v)) return { rgb: v, alpha: 1 };
  if (/^#[0-9a-f]{3}$/i.test(v))
    return { rgb: '#' + [...v.slice(1)].map((c) => c + c).join(''), alpha: 1 };
  return null;
}
export function argb(rgb, alpha = 1) {
  if (!/^#[0-9a-f]{6}$/i.test(rgb) || !Number.isFinite(alpha))
    throw Error('Choose a color and alpha.');
  return (
    '#' +
    (alpha >= 1
      ? ''
      : Math.round(Math.max(0, alpha) * 255)
          .toString(16)
          .padStart(2, '0')) +
    rgb.slice(1).toUpperCase()
  );
}
export function resourceReferences(documents, resource, resolver) {
  const result = [];
  for (const doc of documents)
    walk(doc.root, (node) => {
      for (const [key, value] of Object.entries(node.props || {})) {
        const match = String(value).match(/^\{(StaticResource|DynamicResource)\s+([^}]+)\}$/);
        if (match && findResource(doc, node, match[2].trim(), resolver)?.id === resource.id)
          result.push({ documentId: doc.id, nodeId: node.id, property: key, kind: match[1] });
      }
    });
  return result;
}
export function renameResource(documents, documentId, resourceId, key, resolver) {
  key = typeof key === 'string' ? key.trim() : key;
  if (typeof key !== 'string' || !key.trim() || /[{}\r\n]/.test(key))
    throw Error('Enter a nonempty resource key without braces.');
  const owner = documents.find((d) => d.id === documentId),
    resource = owner && find(owner.root, resourceId);
  if (!resource?.props['x:Key']) throw Error('Select a keyed resource.');
  const parent = parentOf(owner.root, resourceId);
  if (parent?.children.some((n) => n.id !== resourceId && n.props?.['x:Key'] === key))
    throw Error('That resource key exists in this scope.');
  const refs = resourceReferences(documents, resource, resolver),
    next = clone(documents);
  find(next.find((d) => d.id === documentId).root, resourceId).props['x:Key'] = key;
  for (const ref of refs)
    find(next.find((d) => d.id === ref.documentId).root, ref.nodeId).props[ref.property] =
      `{${ref.kind} ${key}}`;
  const resolve = (source, node) => {
    const owner = next.find((d) => find(d.root, node?.id));
    return owner ? resolveDictionary(next, source, owner) : resolver?.(source, node);
  };
  for (const ref of refs) {
    const doc = next.find((d) => d.id === ref.documentId);
    if (findResource(doc, find(doc.root, ref.nodeId), key, resolve)?.id !== resourceId)
      throw Error('This name would be shadowed in a referencing scope. Choose a different key.');
  }
  return { documents: next, references: refs.length };
}

export function inverseVector({ a, b, c, d }, x, y) {
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9)
    throw Error('This transform has no editable inverse.');
  return { x: (d * x - c * y) / det, y: (a * y - b * x) / det };
}
