/** Package metadata, entrypoint policy and non-code distribution files. */
import { mkdir, copyFile, chmod, readFile, writeFile } from 'node:fs/promises';
import { resolve, posix } from 'node:path';
import { root, exists } from '../package-graph.mjs';

export function validateManifest(entry, manifest, version) {
  if (manifest.version !== version) throw Error(`Version mismatch: ${entry.name}`);
  for (const name of entry.dependencies)
    if (manifest.dependencies?.[name] !== version)
      throw Error(`Missing dependency ${name} in ${entry.name}; update package manifests.`);
  // Every non-CLI canonical/compatibility module is used by generated subpath imports.
  // A built file alone is not resolvable when the package export map hides it.
  for (const { name } of [...(entry.sources || []), ...(entry.reexports || [])]) {
    if (name.startsWith('cli/')) continue;
    const exported = manifest.exports?.['./' + name];
    for (const [kind, format, extension, declaration] of [
      ['import', 'esm', 'js', 'd.ts'],
      ['require', 'cjs', 'cjs', 'd.cts'],
    ]) {
      if (
        exported?.[kind]?.default !== `./dist/${format}/${name}.${extension}` ||
        exported?.[kind]?.types !== `./dist/${format}/${name}.${declaration}`
      )
        throw Error(
          `Missing or invalid ${kind} export ./${name} in ${entry.name}; update package manifests.`,
        );
    }
  }
}

export function entrypointSource(entry, entries) {
  return entry.umbrella
    ? entries
        .filter((other) => other !== entry && !other.contracts)
        .map((other) => `export * from '${other.name}';`)
        .join('\n')
    : [...entry.sources, ...(entry.reexports || [])]
        .filter((module) => !module.name.startsWith('cli/'))
        .map((module) => `export * from './${module.name}.js';`)
        .join('\n');
}

export async function copyPackageFiles(entry, output, projectRoot = root) {
  if (entry.cli) await chmod(resolve(output, 'esm/cli/index.js'), 0o755);
  for (const asset of entry.assets || []) {
    if (!(await exists(resolve(projectRoot, asset)))) throw Error(`Missing package asset ${asset}`);
    await mkdir(resolve(output, 'assets'), { recursive: true });
    const target = resolve(output, 'assets', asset.split('/').at(-1));
    if (asset.endsWith('.css')) {
      await writeFile(
        target,
        rewriteStyleImports(
          await readFile(resolve(projectRoot, asset), 'utf8'),
          asset,
          entry.assets,
        ),
      );
    } else await copyFile(resolve(projectRoot, asset), target);
  }
  await copyFile(resolve(projectRoot, 'LICENSE'), resolve(entry.directory, 'LICENSE'));
}

/** CSS files are flattened into assets/; retain imports without referring to the source tree. */
export function rewriteStyleImports(source, asset, assets) {
  const declared = new Set(assets);
  return source.replace(
    /(^[ \t]*@import\s+(?:url\(\s*)?)(['"])([^'"]+)(\2)/gm,
    (match, before, quote, specifier, after) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(specifier)) return match;
      const split = specifier.search(/[?#]/);
      const path = split < 0 ? specifier : specifier.slice(0, split);
      const suffix = split < 0 ? '' : specifier.slice(split);
      const target = posix.normalize(posix.join(posix.dirname(asset), path));
      if (!declared.has(target)) throw Error(`Undeclared CSS import ${specifier} from ${asset}`);
      return before + quote + './' + posix.basename(target) + suffix + after;
    },
  );
}
