import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import {
  validateManifest,
  entrypointSource,
  copyPackageFiles,
} from '../scripts/package-build/metadata.mjs';
import { emitPackageModules } from '../scripts/package-build/emit-modules.mjs';
import {
  rewriteCommonJSImports,
  resolveWorkspaceImport,
  buildCommonJS,
} from '../scripts/package-build/bundles.mjs';

async function temporary(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'xamora-build-unit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('package manifest validation retains exact version and dependency requirements', () => {
  const entry = { name: 'test-package', dependencies: new Set(['model']) };
  validateManifest(entry, { version: '1.2.3', dependencies: { model: '1.2.3' } }, '1.2.3');
  assert.throws(
    () => validateManifest(entry, { version: '1.2.4' }, '1.2.3'),
    /Version mismatch: test-package/,
  );
  assert.throws(
    () => validateManifest(entry, { version: '1.2.3' }, '1.2.3'),
    /Missing dependency model/,
  );
  assert.throws(
    () => validateManifest(entry, { version: '1.2.3', dependencies: { model: '^1.2.3' } }, '1.2.3'),
    /Missing dependency model/,
  );
});

test('entrypoint policy excludes CLI modules and type-only contracts from umbrella runtime exports', () => {
  const entry = { sources: [{ name: 'model' }, { name: 'nested/view' }, { name: 'cli/index' }] };
  assert.equal(
    entrypointSource(entry, [entry]),
    "export * from './model.js';\nexport * from './nested/view.js';",
  );
  const umbrella = { name: 'sdk', umbrella: true };
  const packages = [{ name: 'contracts', contracts: true }, { name: 'model' }, umbrella];
  assert.equal(entrypointSource(umbrella, packages), "export * from 'model';");
});

test('CommonJS import rewriting preserves external specifiers and rewrites relative static/dynamic imports', () => {
  const source = `export { value } from './value.js';\nimport value from "../nested/value.js";\nconst lazy = import('./lazy.js');\nexport * from '@scope/model/value';\nimport 'side-effect';`;
  assert.equal(
    rewriteCommonJSImports(source),
    `export { value } from './value.cjs';\nimport value from "../nested/value.cjs";\nconst lazy = import('./lazy.cjs');\nexport * from '@scope/model/value';\nimport 'side-effect';`,
  );
});

test('browser workspace resolution respects package boundaries and nested subpaths', () => {
  const entries = [{ name: '@wieslawsoltes/xamora-model', directory: resolve('packages/model') }];
  assert.equal(
    resolveWorkspaceImport(entries[0].name, entries),
    resolve('packages/model/dist/esm/index.js'),
  );
  assert.equal(
    resolveWorkspaceImport(entries[0].name + '/nested/view', entries),
    resolve('packages/model/dist/esm/nested/view.js'),
  );
  assert.equal(resolveWorkspaceImport(entries[0].name + '-other', entries), undefined);
  assert.equal(resolveWorkspaceImport('external-package', entries), undefined);
});

test('module emission retains declarations, CLI isolation and executable unbundled CommonJS exports', async (t) => {
  const directory = await temporary(t);
  const entry = {
    id: 'test',
    directory,
    name: '@test/package',
    sources: [
      { source: 'dist/core/value.js', name: 'value' },
      { source: 'dist/core/view.js', name: 'nested/view' },
      { source: 'cli/index.js', name: 'cli/index' },
    ],
  };
  const current = {
    entries: [entry],
    owners: new Map(entry.sources.map((source) => [source.source, { entry, ...source }])),
    contents: new Map([
      ['dist/core/value.js', 'export const answer = 42;\n'],
      ['dist/core/view.js', "export { answer } from './value.js';\n"],
      ['cli/index.js', '#!/usr/bin/env node\nexport const cli = true;\n'],
    ]),
  };
  const typed = {
    sources: new Map([
      ['dist/core/value.js', 'export declare const answer: number;\n'],
      ['dist/core/view.js', "export { answer } from './value.js';\n"],
      ['cli/index.js', 'export declare const cli: boolean;\n'],
    ]),
  };
  const result = await emitPackageModules(entry, current, typed);
  assert(!result.entries.some((path) => path.includes('/cli/')));
  assert.match(await readFile(resolve(result.output, 'esm/cli/index.js'), 'utf8'), /^#!/);
  assert.equal(
    await readFile(resolve(result.output, 'esm/nested/view.js'), 'utf8'),
    "export { answer } from '../value.js';\n",
  );
  assert.equal(
    await readFile(resolve(result.output, 'cjs/nested/view.d.cts'), 'utf8'),
    "export { answer } from '../value.cjs';\n",
  );
  await buildCommonJS(result.output, result.entries);
  const require = createRequire(import.meta.url);
  assert.equal(require(resolve(result.output, 'cjs/index.cjs')).answer, 42);
});

test('contract emission keeps declarations type-only in both module systems', async (t) => {
  const directory = await temporary(t);
  const entry = { directory, sources: [], contracts: true };
  const contracts = 'export interface Contract { value: string }\n';
  const { output } = await emitPackageModules(entry, { entries: [entry] }, { contracts });
  assert.equal(
    await readFile(resolve(output, 'esm/index.d.ts'), 'utf8'),
    "export type * from './contracts.js';\n",
  );
  assert.equal(
    await readFile(resolve(output, 'cjs/index.d.cts'), 'utf8'),
    "export type * from './contracts.cjs';\n",
  );
  assert.equal(await readFile(resolve(output, 'esm/contracts.d.ts'), 'utf8'), contracts);
  assert.equal(await readFile(resolve(output, 'cjs/contracts.d.cts'), 'utf8'), contracts);
});

test('distribution files preserve assets, license, executable CLI mode and missing-asset errors', async (t) => {
  const root = await temporary(t);
  const entry = { directory: resolve(root, 'package'), assets: ['assets/test.bin'], cli: true };
  const output = resolve(entry.directory, 'dist');
  await mkdir(resolve(root, 'assets'));
  await mkdir(resolve(output, 'esm/cli'), { recursive: true });
  await writeFile(resolve(output, 'esm/cli/index.js'), '#!/usr/bin/env node\n');
  await writeFile(resolve(root, 'assets/test.bin'), Buffer.from([0, 127, 255]));
  await writeFile(resolve(root, 'LICENSE'), 'License text\n');
  await copyPackageFiles(entry, output, root);
  assert.deepEqual(await readFile(resolve(output, 'assets/test.bin')), Buffer.from([0, 127, 255]));
  assert.equal(await readFile(resolve(entry.directory, 'LICENSE'), 'utf8'), 'License text\n');
  if (process.platform !== 'win32')
    assert.equal((await stat(resolve(output, 'esm/cli/index.js'))).mode & 0o777, 0o755);
  entry.assets.push('missing.bin');
  await assert.rejects(copyPackageFiles(entry, output, root), /Missing package asset missing.bin/);
});
