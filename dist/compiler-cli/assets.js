import { lstat, readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';

const external = /^(?:[a-z][a-z\d+.-]*:|\/|#)/i;
const urls = (source) =>
  [
    ...String(source).matchAll(
      /url\(\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^)]*?))\s*\)|@import\s+(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')/gi,
    ),
  ].map((match) => match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]);
const inside = (root, path) => {
  const value = relative(root, path);
  return value && !value.startsWith('..' + sep) && value !== '..' && !isAbsolute(value);
};

/** Collect only referenced local assets, recursively following CSS imports and URLs. */
export async function collectReferencedAssets(plan, root) {
  const files = [],
    diagnostics = [],
    queue = [],
    seen = new Set();
  const documents = new Set(
    plan.entries
      .filter((entry) => entry.status === 'ready')
      .map((entry) => entry.targetPath.toLowerCase()),
  );
  const issue = (path, message) =>
    diagnostics.push({ severity: 'warning', code: 'CLI_ASSET_REFERENCE', path, message });
  const enqueue = (value, owner) => {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      external.test(value.trim()) ||
      /[{}]/.test(value)
    )
      return;
    let path;
    try {
      const decoded = decodeURIComponent(value.trim().split(/[?#]/, 1)[0]);
      if (!decoded || decoded.includes('\\') || /[\x00-\x1f]/.test(decoded))
        throw Error('Unsupported asset URL encoding.');
      const full = resolve(root, owner.split('/').slice(0, -1).join('/'), decoded);
      if (!inside(root, full)) throw Error('Referenced asset is outside the input root.');
      path = relative(root, full).split(sep).join('/');
      if (documents.has(path.toLowerCase()) || seen.has(path.toLowerCase())) return;
      seen.add(path.toLowerCase());
      queue.push({ path, full });
    } catch (error) {
      issue(owner, String(error.message) + ' URL: ' + value);
    }
  };
  const scanNode = (node, owner) => {
    if (!node || node.kind !== 'element') return;
    for (const property of ['src', 'href', 'poster', 'Source', 'NavigateUri'])
      enqueue(node.props?.[property], owner);
    for (const url of urls(node.props?.style || '')) enqueue(url, owner);
    if (node.props?.srcset) {
      // Data URLs contain commas; keep those external and split ordinary candidates.
      if (!/data:/i.test(node.props.srcset))
        for (const candidate of node.props.srcset.split(','))
          enqueue(candidate.trim().split(/\s+/)[0], owner);
      else
        issue(
          owner,
          'A srcset containing data URLs needs manual review for additional local candidates.',
        );
    }
    if (node.type === 'style')
      for (const url of urls((node.children || []).map((child) => child.text || '').join('')))
        enqueue(url, owner);
    for (const child of node.children || []) scanNode(child, owner);
  };
  for (const entry of plan.entries)
    if (entry.status === 'ready') scanNode(entry.result?.document?.root, entry.targetPath);
  while (queue.length) {
    const item = queue.shift();
    try {
      let cursor = root;
      for (const part of item.path.split('/')) {
        cursor = resolve(cursor, part);
        if ((await lstat(cursor)).isSymbolicLink())
          throw Error('Referenced assets must not contain symbolic links.');
      }
      if (!(await lstat(item.full)).isFile())
        throw Error('Referenced asset is not a regular file.');
      const content = await readFile(item.full);
      files.push({ path: item.path, content });
      if (/\.css$/i.test(item.path))
        for (const url of urls(content.toString('utf8'))) enqueue(url, item.path);
    } catch (error) {
      issue(item.path, 'Asset was not copied: ' + error.message);
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, diagnostics };
}
