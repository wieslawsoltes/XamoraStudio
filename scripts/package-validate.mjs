import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { exists } from './package-graph.mjs';
async function files(path) {
  const result = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    const next = resolve(path, item.name);
    if (item.isDirectory()) result.push(...(await files(next)));
    else result.push(next);
  }
  return result;
}
export async function validatePackageImports(graph) {
  for (const entry of graph.entries) {
    const manifest = JSON.parse(await readFile(resolve(entry.directory, 'package.json'), 'utf8'));
    for (const path of await files(resolve(entry.directory, 'dist'))) {
      if (!/\.(?:js|cjs|d\.ts|d\.cts)$/.test(path)) continue;
      if (path.includes('/browser/')) continue;
      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(
        /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)['"]([^'"\s]+)['"]/g,
      )) {
        const name = match[1];
        if (name.startsWith('node:')) continue;
        if (name.startsWith('.')) {
          const target = resolve(dirname(path), name);
          const declaration = target.replace(/\.js$/, '.d.ts').replace(/\.cjs$/, '.d.cts');
          assert(
            (await exists(target)) || (await exists(declaration)),
            `${entry.name}: missing local target ${name} from ${path}`,
          );
          continue;
        }
        const packageName = name.startsWith('@')
          ? name.split('/').slice(0, 2).join('/')
          : name.split('/')[0];
        assert(
          packageName === entry.name ||
            manifest.dependencies?.[packageName] ||
            manifest.peerDependencies?.[packageName],
          `${entry.name}: undeclared dependency ${packageName} imported from ${path}`,
        );
      }
    }
  }
}
