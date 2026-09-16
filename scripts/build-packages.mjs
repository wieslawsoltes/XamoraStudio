/** Build the package graph without coupling emission, bundling and metadata policy. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { graph, root } from './package-graph.mjs';
import { declarations } from './package-declarations.mjs';
import { validatePackageImports } from './package-validate.mjs';
import { validateManifest, copyPackageFiles } from './package-build/metadata.mjs';
import { emitPackageModules } from './package-build/emit-modules.mjs';
import { buildCommonJS, buildBrowserBundle } from './package-build/bundles.mjs';

const current = await graph();
const project = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const typed = await declarations(current);
for (const entry of current.entries) {
  const manifest = JSON.parse(await readFile(resolve(entry.directory, 'package.json'), 'utf8'));
  validateManifest(entry, manifest, project.version);
  const { output, entries } = await emitPackageModules(entry, current, typed);
  await buildCommonJS(output, entries);
  await copyPackageFiles(entry, output);
}
// Keep normal imports unbundled so consumers share one model/runtime identity.
for (const entry of current.entries.filter((item) => item.standalone)) {
  await buildBrowserBundle(entry, current);
}
await validatePackageImports(current);
console.log(
  `Built ${current.entries.length} packages from ${current.contents.size} canonical modules (ESM, CommonJS, declarations, browser bundles).`,
);
