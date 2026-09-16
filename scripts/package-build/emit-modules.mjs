/** Emit unbundled ESM sources and matching ESM/CommonJS declarations. */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { rewrite, specifierFor } from '../package-graph.mjs';
import { entrypointSource } from './metadata.mjs';

export async function emitPackageModules(entry, current, typed) {
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
  for (const alias of entry.reexports || []) {
    const owner = current.owners.get(alias.source);
    if (!owner) throw Error(`Missing compatibility owner: ${alias.source}`);
    const source = `export * from '${specifierFor(owner)}';\n`;
    for (const [directory, extension] of [
      ['esm', '.js'],
      ['esm', '.d.ts'],
      ['cjs', '.d.cts'],
    ]) {
      const target = resolve(output, directory, alias.name + extension);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
      if (extension === '.js') entries.push(target);
    }
  }
  const index = entrypointSource(entry, current.entries);
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
  return { output, entries };
}
