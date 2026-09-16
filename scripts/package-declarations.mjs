import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, exists, rewrite, specifierFor } from './package-graph.mjs';

const blockName = (text) =>
  text.match(
    /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+(\w+)/,
  )?.[1];
const blocks = (text) => text.split(/(?=^export\s)/m).filter(Boolean);
const typeOwners = {
  Framework: 'model',
  PropertyValue: 'model',
  ElementNode: 'model',
  TextNode: 'model',
  DesignNode: 'model',
  Annotation: 'model',
  DesignDocument: 'model',
  ControlApplicationHost: 'registry',
  ControlMountContext: 'registry',
  PropertyDescriptor: 'registry',
  ControlDescriptor: 'registry',
  ExportResult: 'registry',
  ExportAdapter: 'registry',
  DataType: 'design-data',
  DataColumn: 'design-data',
  DataRecord: 'design-data',
  DataTable: 'design-data',
  DataRelationship: 'design-data',
  FilterOperator: 'design-data',
  DataQuery: 'design-data',
  DesignData: 'design-data',
  PreviewEventName: 'render',
  BindingProvenance: 'render',
  PreviewInput: 'render',
  PreviewEvent: 'render',
  PrototypeAction: 'prototype',
  Interaction: 'prototype',
  Completion: 'xaml-language',
  DropPlan: 'design-tools',
  AnimationValueType: 'animation',
  AnimationValues: 'animation',
  AnimationKey: 'animation',
  AnimationTrack: 'animation',
  StoryboardInfo: 'animation',
  AnimationScope: 'animation',
  AnimationSample: 'animation',
  AnimationClockOptions: 'animation',
  VisualStateGroupInfo: 'states',
  VisualStateEntry: 'states',
  ResourceResolver: 'styling',
  PathCommand: 'vector',
  PathPoint: 'vector',
  MotionBaseline: 'motion-render',
};
/** Emit missing declarations, then overlay the project's handwritten public contracts. */
export async function declarations(graph) {
  const temporary = resolve(root, '.package-build/types-source'),
    out = resolve(root, '.package-build/types-output');
  await rm(temporary, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
  const files = [];
  for (const [path, source] of graph.contents) {
    const file = resolve(temporary, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, source);
    const authored = resolve(root, path.replace(/\.js$/, '.d.ts'));
    if (await exists(authored))
      await writeFile(file.replace(/\.js$/, '.d.ts'), await readFile(authored, 'utf8'));
    else files.push(file);
  }
  const generated = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules/typescript/bin/tsc'),
      '--ignoreConfig',
      '--allowJs',
      '--declaration',
      '--emitDeclarationOnly',
      '--noCheck',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--rootDir',
      temporary,
      '--outDir',
      out,
      ...files,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (generated.status !== 0)
    throw Error(`Declaration generation failed:\n${generated.stdout}${generated.stderr}`);
  const byName = new Map(),
    legacyBySource = new Map();
  for (const [path, source] of graph.contents)
    for (const match of source.matchAll(
      /\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/g,
    ))
      if (!byName.has(match[1])) byName.set(match[1], path);
  const legacyNames = new Set();
  const legacy = await readFile(resolve(root, 'dist/core/index.d.ts'), 'utf8');
  for (const block of blocks(legacy)) {
    const name = blockName(block);
    if (!name) continue;
    const path = typeOwners[name] ? `dist/core/${typeOwners[name]}.js` : byName.get(name);
    if (!path || !graph.owners.has(path)) throw Error(`No declaration owner for ${name}`);
    byName.set(name, path);
    legacyNames.add(name);
    if (!legacyBySource.has(path)) legacyBySource.set(path, []);
    legacyBySource.get(path).push(block.trim());
  }
  const raw = new Map();
  for (const path of graph.contents.keys()) {
    const authored = resolve(root, path.replace(/\.js$/, '.d.ts'));
    let source = await readFile(
      (await exists(authored)) ? authored : resolve(out, path.replace(/\.js$/, '.d.ts')),
      'utf8',
    );
    source = source.replace(
      /^import\s+(?:type\s+)?\{[^}]*\}\s+from\s+['"]\.\/index\.js['"];?\s*/gm,
      '',
    );
    const overlays = legacyBySource.get(path) || [],
      names = new Set(overlays.map(blockName));
    if (overlays.length)
      source =
        blocks(source)
          .filter((block) => !names.has(blockName(block)))
          .join('') +
        '\n' +
        overlays.join('\n\n') +
        '\n';
    raw.set(path, source);
    for (const block of blocks(source)) {
      const name = blockName(block);
      if (name && !byName.has(name)) byName.set(name, path);
    }
  }
  const result = new Map();
  for (const [path, text] of raw) {
    const local = new Set(blocks(text).map(blockName).filter(Boolean));
    for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}/g))
      for (const part of match[1].split(','))
        local.add(
          part
            .trim()
            .split(/\s+as\s+/)
            .at(-1),
        );
    const imports = new Map();
    for (const name of new Set(text.match(/\b[A-Za-z_$][\w$]*\b/g) || [])) {
      const target = /^[A-Z]/.test(name) ? byName.get(name) : null;
      if (!target || target === path || local.has(name)) continue;
      const key = legacyNames.has(name) ? 'contracts' : target;
      if (!imports.has(key)) imports.set(key, []);
      imports.get(key).push(name);
    }
    const header = [...imports]
      .map(
        ([target, names]) =>
          `import type {${names.sort().join(', ')}} from ${JSON.stringify(target === 'contracts' ? '@wieslawsoltes/xamora-contracts' : specifierFor(graph.owners.get(target)))};`,
      )
      .join('\n');
    result.set(path, header + '\n' + text);
  }
  const history = await readFile(resolve(root, 'dist/core/history.d.ts'), 'utf8');
  const contracts =
    blocks(legacy)
      .filter((block) => blockName(block))
      .join('')
      .replace(/import\(['"]\.\/history\.js['"]\)\./g, '') +
    '\n' +
    history;
  return { sources: result, byName, contracts };
}
