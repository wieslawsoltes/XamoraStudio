/** Package metadata, entrypoint policy and non-code distribution files. */
import { mkdir, copyFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, exists } from '../package-graph.mjs';

export function validateManifest(entry, manifest, version) {
  if (manifest.version !== version) throw Error(`Version mismatch: ${entry.name}`);
  for (const name of entry.dependencies)
    if (manifest.dependencies?.[name] !== version)
      throw Error(`Missing dependency ${name} in ${entry.name}; update package manifests.`);
}

export function entrypointSource(entry, entries) {
  return entry.umbrella
    ? entries
        .filter((other) => other !== entry && !other.contracts)
        .map((other) => `export * from '${other.name}';`)
        .join('\n')
    : entry.sources
        .filter((module) => !module.name.startsWith('cli/'))
        .map((module) => `export * from './${module.name}.js';`)
        .join('\n');
}

export async function copyPackageFiles(entry, output, projectRoot = root) {
  if (entry.cli) await chmod(resolve(output, 'esm/cli/index.js'), 0o755);
  for (const asset of entry.assets || []) {
    if (!(await exists(resolve(projectRoot, asset)))) throw Error(`Missing package asset ${asset}`);
    await mkdir(resolve(output, 'assets'), { recursive: true });
    await copyFile(resolve(projectRoot, asset), resolve(output, 'assets', asset.split('/').at(-1)));
  }
  await copyFile(resolve(projectRoot, 'LICENSE'), resolve(entry.directory, 'LICENSE'));
}
