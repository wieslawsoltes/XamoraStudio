import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile, rm, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { graph, root, rewrite, exists } from './package-graph.mjs';
import { declarations } from './package-declarations.mjs';
import { validatePackageImports } from './package-validate.mjs';
const current = await graph(),
  project = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const typed = await declarations(current);
for (const entry of current.entries) {
  const manifest = JSON.parse(await readFile(resolve(entry.directory, 'package.json'), 'utf8'));
  if (manifest.version !== project.version) throw Error(`Version mismatch: ${entry.name}`);
  for (const name of entry.dependencies)
    if (manifest.dependencies?.[name] !== project.version)
      throw Error(`Missing dependency ${name} in ${entry.name}; update package manifests.`);
  const output = resolve(entry.directory, 'dist');
  await rm(output, { recursive: true, force: true });
  await mkdir(resolve(output, 'esm'), { recursive: true });
  await mkdir(resolve(output, 'cjs'), { recursive: true });
  const entries = [];
  for (const source of entry.sources) {
    const target = resolve(output, 'esm', source.name + '.js');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      rewrite(current.contents.get(source.source), source.source, current.owners),
    );
    const esmTypes = rewrite(typed.sources.get(source.source), source.source, current.owners);
    await writeFile(target.replace(/\.js$/, '.d.ts'), esmTypes);
    const cjsTarget = resolve(output, 'cjs', source.name + '.d.cts');
    await mkdir(dirname(cjsTarget), { recursive: true });
    await writeFile(
      cjsTarget,
      rewrite(typed.sources.get(source.source), source.source, current.owners, { cjs: true }),
    );
    if (!source.name.startsWith('cli/')) entries.push(target);
  }
  const index = entry.umbrella
    ? current.entries
        .filter((other) => other !== entry && !other.contracts)
        .map((other) => `export * from '${other.name}';`)
        .join('\n')
    : entry.sources
        .filter((module) => !module.name.startsWith('cli/'))
        .map((module) => `export * from './${module.name}.js';`)
        .join('\n');
  const indexFile = resolve(output, 'esm/index.js');
  await writeFile(indexFile, index + '\n');
  await writeFile(resolve(output, 'esm/index.d.ts'), index + '\n');
  await writeFile(resolve(output, 'cjs/index.d.cts'), index.replace(/\.js'/g, ".cjs'") + '\n');
  entries.push(indexFile);
  if (entry.contracts) {
    await writeFile(resolve(output, 'esm/contracts.d.ts'), typed.contracts);
    await writeFile(resolve(output, 'cjs/contracts.d.cts'), typed.contracts);
    await writeFile(resolve(output, 'esm/index.d.ts'), "export type * from './contracts.js';\n");
    await writeFile(resolve(output, 'cjs/index.d.cts'), "export type * from './contracts.cjs';\n");
  }
  await build({
    entryPoints: entries,
    outdir: resolve(output, 'cjs'),
    outbase: resolve(output, 'esm'),
    bundle: false,
    platform: 'node',
    format: 'cjs',
    target: 'es2022',
    outExtension: { '.js': '.cjs' },
    sourcemap: true,
    plugins: [
      {
        name: 'local-commonjs',
        setup(api) {
          api.onLoad({ filter: /\.js$/ }, async (args) => ({
            contents: (await readFile(args.path, 'utf8')).replace(
              /((?:\bfrom\s*|\bimport\s*\(\s*)['"])(\.[^'"]+)\.js(['"])/g,
              '$1$2.cjs$3',
            ),
            loader: 'js',
          }));
        },
      },
    ],
  });
  if (entry.cli) {
    await chmod(resolve(output, 'esm/cli/index.js'), 0o755);
  }
  for (const asset of entry.assets || []) {
    if (!(await exists(resolve(root, asset)))) throw Error(`Missing package asset ${asset}`);
    await mkdir(resolve(output, 'assets'), { recursive: true });
    await copyFile(resolve(root, asset), resolve(output, 'assets', asset.split('/').at(-1)));
  }
  await copyFile(resolve(root, 'LICENSE'), resolve(entry.directory, 'LICENSE'));
}
// Browser bundles are deliberately separate opt-in entry points. Normal package
// imports stay unbundled and resolve one copy of each shared model/runtime module.
for (const entry of current.entries.filter((item) => item.standalone)) {
  await build({
    entryPoints: [resolve(entry.directory, 'dist/esm/index.js')],
    outfile: resolve(entry.directory, 'dist/browser/index.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    sourcemap: true,
    plugins: [
      {
        name: 'workspace-packages',
        setup(api) {
          api.onResolve({ filter: /^@wieslawsoltes\/xamora/ }, (args) => {
            const owner = current.entries.find(
              (item) => args.path === item.name || args.path.startsWith(item.name + '/'),
            );
            if (!owner) return;
            const subpath =
              args.path === owner.name ? 'index' : args.path.slice(owner.name.length + 1);
            return { path: resolve(owner.directory, 'dist/esm', subpath + '.js') };
          });
        },
      },
    ],
  });
}
await validatePackageImports(current);
console.log(
  `Built ${current.entries.length} packages from ${current.contents.size} canonical modules (ESM, CommonJS, declarations, browser bundles).`,
);
