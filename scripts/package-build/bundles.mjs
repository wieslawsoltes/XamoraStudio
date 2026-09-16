/** Build CommonJS modules and explicitly opted-in standalone browser bundles. */
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function rewriteCommonJSImports(source) {
  return source.replace(/((?:\bfrom\s*|\bimport\s*\(\s*)['"])(\.[^'"]+)\.js(['"])/g, '$1$2.cjs$3');
}

export function resolveWorkspaceImport(specifier, entries) {
  const owner = entries.find(
    (item) => specifier === item.name || specifier.startsWith(item.name + '/'),
  );
  if (!owner) return;
  const subpath = specifier === owner.name ? 'index' : specifier.slice(owner.name.length + 1);
  return resolve(owner.directory, 'dist/esm', subpath + '.js');
}

export async function buildCommonJS(output, entries) {
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
            contents: rewriteCommonJSImports(await readFile(args.path, 'utf8')),
            loader: 'js',
          }));
        },
      },
    ],
  });
}

export async function buildBrowserBundle(entry, current) {
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
            const path = resolveWorkspaceImport(args.path, current.entries);
            if (path) return { path };
          });
        },
      },
    ],
  });
}
