/** Reviewable direct service/selector inventory for standalone workspace adapters. */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function workspaceInventory(root = resolve(import.meta.dirname, '..')) {
  const result = {};
  for (const file of (await readdir(resolve(root, 'dist/workspaces'))).sort()) {
    if (!file.endsWith('.js') || file === 'workspace-context.js') continue;
    const text = await readFile(resolve(root, 'dist/workspaces', file), 'utf8');
    result[file] = {
      hostMembers: [
        ...new Set([...text.matchAll(/\b(?:this\.s|s|studio)\.([\w]+)/g)].map((match) => match[1])),
      ].sort(),
      selectors: [
        ...new Set(
          [...text.matchAll(/this\.environment\.(?:query|all)\(\s*(['"])(.*?)\1/g)].map(
            (match) => match[2],
          ),
        ),
      ].sort(),
    };
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = JSON.stringify(await workspaceInventory(), null, 2) + '\n';
  for (const folder of ['docs', 'dist/docs'])
    await writeFile(resolve(import.meta.dirname, '..', folder, 'WORKSPACE-SERVICES.json'), data);
}
