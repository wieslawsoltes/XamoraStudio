import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { graph, root, exists } from './package-graph.mjs';
const project = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const current = await graph({ allowMissing: true });
const known = {
  data: ['model'],
  styling: ['model', 'data'],
  animation: ['model', 'data', 'styling'],
  markup: ['model', 'data', 'styling', 'animation'],
  renderer: ['model', 'data', 'styling', 'animation', 'markup'],
  controls: [],
  designer: ['model', 'data', 'styling', 'animation', 'markup', 'renderer'],
  properties: [],
  runtime: ['model', 'data', 'styling', 'animation', 'markup', 'renderer', 'properties'],
};
const conditional = (name) => ({
  import: { types: `./dist/esm/${name}.d.ts`, default: `./dist/esm/${name}.js` },
  require: { types: `./dist/cjs/${name}.d.cts`, default: `./dist/cjs/${name}.cjs` },
});
for (const entry of current.entries) {
  const old = (await exists(resolve(entry.directory, 'package.json')))
    ? JSON.parse(await readFile(resolve(entry.directory, 'package.json'), 'utf8'))
    : {};
  const exports = { '.': conditional('index'), './package.json': './package.json' };
  for (const source of entry.sources)
    if (!source.name.startsWith('cli/')) exports['./' + source.name] = conditional(source.name);
  for (const asset of entry.assets || [])
    exports['./' + asset.split('/').at(-1)] = './dist/assets/' + asset.split('/').at(-1);
  if (entry.standalone)
    exports['./browser'] = { types: './dist/esm/index.d.ts', default: './dist/browser/index.js' };
  const dependencies = Object.fromEntries(
    [
      ...new Set([
        ...entry.dependencies,
        ...(known[entry.id] || []).map((id) => '@wieslawsoltes/xamora-' + id),
      ]),
    ]
      .sort()
      .map((name) => [name, project.version]),
  );
  for (const [name, version] of Object.entries(old.dependencies || {}))
    if (!name.startsWith('@wieslawsoltes/xamora')) dependencies[name] = version;
  const manifest = {
    name: entry.name,
    version: project.version,
    description: entry.description,
    type: 'module',
    license: 'MIT',
    author: 'Xamora contributors',
    repository: {
      type: 'git',
      url: 'git+https://github.com/wieslawsoltes/XamoraStudio.git',
      directory: 'packages/' + entry.id,
    },
    homepage: 'https://wieslawsoltes.github.io/XamoraStudio/',
    bugs: 'https://github.com/wieslawsoltes/XamoraStudio/issues',
    main: './dist/cjs/index.cjs',
    module: './dist/esm/index.js',
    types: './dist/esm/index.d.ts',
    exports,
    files: ['dist', 'README.md', 'LICENSE'],
    sideEffects: ['**/*.css'],
    engines: { node: '>=22' },
    publishConfig: { access: 'public', provenance: true },
    scripts: { prepack: 'node ../../scripts/build-packages.mjs' },
    ...(Object.keys(dependencies).length ? { dependencies } : {}),
    ...(entry.cli ? { bin: { 'xamora-convert': './dist/esm/cli/index.js' } } : {}),
    ...(old.xamora ? { xamora: old.xamora } : {}),
  };
  await mkdir(entry.directory, { recursive: true });
  await writeFile(
    resolve(entry.directory, 'package.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  await writeFile(
    resolve(entry.directory, 'README.md'),
    `# ${entry.name}\n\n${entry.description}.\n\nThis package is built from the same canonical modules used by Xamora Studio. ESM and CommonJS consumers share modules across package boundaries; all public entry points include TypeScript declarations. Browser applications can use a bundler${entry.standalone ? ' or the self-contained `./browser` entry' : ''}.\n\nSee [package architecture and installation](https://github.com/wieslawsoltes/XamoraStudio/blob/main/docs/PACKAGES.md), [runtime guide](https://github.com/wieslawsoltes/XamoraStudio/blob/main/docs/WEB-RUNTIME.md), and [source](https://github.com/wieslawsoltes/XamoraStudio).\n\nMIT licensed.\n`,
  );
}
console.log(`Updated ${current.entries.length} package manifests for ${project.version}.`);
