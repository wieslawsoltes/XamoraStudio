import { clone, uid, walk, validateDocument, localName } from './model.js';
export function normalizePath(path) {
  if (
    typeof path !== 'string' ||
    !path.trim() ||
    path.length > 500 ||
    /[\x00-\x1f<>:"|?*]/.test(path) ||
    path.startsWith('/')
  )
    throw Error('Enter a relative solution path.');
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.some((p) => !p || p === '.' || p === '..' || p.trim() !== p))
    throw Error('Use folder names separated by /.');
  return parts.join('/');
}
export const filePath = (doc) => doc.metadata?.solutionPath || doc.name;
export function resolvePath(source, owner = '') {
  if (typeof source !== 'string' || !source || /^[a-z]+:/i.test(source) || source.startsWith('/'))
    return null;
  const parts = owner.replace(/\\/g, '/').split('/').slice(0, -1);
  for (const part of source.replace(/\\/g, '/').split('/')) {
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
export function relativePath(target, owner) {
  const a = owner.split('/').slice(0, -1),
    b = target.split('/');
  while (a.length && b.length && a[0] === b[0]) {
    a.shift();
    b.shift();
  }
  return [...a.map(() => '..'), ...b].join('/');
}
export function createSolution(documents, metadata = {}) {
  const result = {
    version: 1,
    id: metadata.id || uid(),
    name: metadata.name || 'My solution',
    folders: [],
    startupId: metadata.startupId || documents[0]?.id || null,
  };
  const seen = new Set();
  for (const doc of documents) {
    let path;
    try {
      path = normalizePath(filePath(doc));
    } catch {
      path = 'View.xaml';
    }
    const ext = path.match(/\.[^.\/]+$/)?.[0] || '',
      base = path.slice(0, path.length - ext.length);
    let i = 2;
    while (seen.has(path.toLowerCase())) path = base + ' ' + i++ + ext;
    seen.add(path.toLowerCase());
    doc.metadata ??= {};
    doc.metadata.solutionPath = path;
    const parts = path.split('/');
    parts.pop();
    while (parts.length) {
      result.folders.push(parts.join('/'));
      parts.pop();
    }
  }
  for (const folder of metadata.folders || []) result.folders.push(normalizePath(folder));
  result.folders = [...new Set(result.folders)].sort();
  if (!documents.some((d) => d.id === result.startupId))
    result.startupId = documents[0]?.id || null;
  return result;
}
export function validateSolution(documents, solution) {
  if (!Array.isArray(documents) || !documents.length)
    throw Error('Keep at least one document in the solution.');
  if (
    !solution ||
    solution.version !== 1 ||
    typeof solution.name !== 'string' ||
    !solution.name.trim() ||
    !Array.isArray(solution.folders)
  )
    throw Error('Invalid solution metadata.');
  const ids = new Set(),
    paths = new Set();
  for (const d of documents) {
    validateDocument(d);
    if (ids.has(d.id)) throw Error('Duplicate document identity.');
    ids.add(d.id);
    const path = normalizePath(filePath(d)).toLowerCase();
    if (paths.has(path)) throw Error('A file already exists at ' + filePath(d));
    paths.add(path);
  }
  for (const f of [...solution.folders, ...documents.map(filePath)]) {
    const parts = normalizePath(f).toLowerCase().split('/');
    if (solution.folders.includes(f) && paths.has(parts.join('/')))
      throw Error('A folder conflicts with a file.');
    parts.pop();
    while (parts.length) {
      if (paths.has(parts.join('/'))) throw Error('A file cannot be a parent folder.');
      parts.pop();
    }
  }
  if (solution.startupId && !ids.has(solution.startupId)) throw Error('Startup view is missing.');
  return solution;
}
export function moveSolutionPath(documents, solution, from, to) {
  from = normalizePath(from);
  to = normalizePath(to);
  if (to.startsWith(from + '/')) throw Error('A folder cannot move into itself.');
  const next = clone(documents),
    meta = clone(solution),
    mapping = new Map();
  for (const d of next) {
    const old = filePath(d);
    mapping.set(
      old,
      old === from || old.startsWith(from + '/') ? to + old.slice(from.length) : old,
    );
  }
  if (![...mapping].some(([a, b]) => a !== b) && !meta.folders.includes(from))
    throw Error('The file or folder no longer exists.');
  const lookup = new Map([...mapping].map(([a, b]) => [a.toLowerCase(), b]));
  for (const d of next) {
    const old = filePath(d),
      path = mapping.get(old);
    walk(d.root, (n) => {
      if (n.props?.Source) {
        const resolved = resolvePath(n.props.Source, old);
        if (
          resolved &&
          !n.props.Source.startsWith('{') &&
          (path !== old || lookup.has(resolved.toLowerCase()))
        )
          n.props.Source = relativePath(lookup.get(resolved.toLowerCase()) || resolved, path);
      }
    });
    d.metadata ??= {};
    d.metadata.solutionPath = path;
    d.name = path.split('/').at(-1);
  }
  meta.folders = meta.folders.map((p) =>
    p === from || p.startsWith(from + '/') ? to + p.slice(from.length) : p,
  );
  for (const p of mapping.values()) {
    const parts = p.split('/');
    parts.pop();
    while (parts.length) {
      meta.folders.push(parts.join('/'));
      parts.pop();
    }
  }
  meta.folders = [...new Set(meta.folders)];
  validateSolution(next, meta);
  return { documents: next, solution: meta };
}
export function resolveDictionary(documents, source, owner) {
  const path = resolvePath(source, typeof owner === 'string' ? owner : filePath(owner));
  if (!path) return null;
  const exact = documents.find((d) => filePath(d).toLowerCase() === path.toLowerCase());
  return localName(exact?.root.type || '') === 'ResourceDictionary' ? exact.root : null;
}
