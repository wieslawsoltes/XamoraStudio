import { readFile, access, readdir } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { packageLayout, packageName, sourceModules } from './package-layout.mjs';
export const root = resolve(import.meta.dirname, '..');
export const slash = (value) => value.split(sep).join('/');
export const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
export async function layout() {
  const entries = structuredClone(packageLayout);
  if (await exists(resolve(root, 'packages/compiler/package.json'))) {
    const p = JSON.parse(await readFile(resolve(root, 'packages/compiler/package.json'), 'utf8'));
    entries.splice(entries.length - 1, 0, {
      id: 'compiler',
      description: p.description,
      ...p.xamora,
    });
  }
  return entries;
}
export async function graph({ allowMissing = false } = {}) {
  const entries = await layout(),
    owners = new Map(),
    contents = new Map();
  for (const entry of entries) {
    entry.name = packageName(entry.id);
    entry.directory = resolve(root, 'packages', entry.id);
    entry.sources = sourceModules(entry);
    entry.dependencies = new Set(entry.contracts ? [] : ['@wieslawsoltes/xamora-contracts']);
    for (const module of entry.sources) {
      if (owners.has(module.source)) throw Error(`Duplicate source ownership: ${module.source}`);
      owners.set(module.source, { entry, ...module });
      if (await exists(resolve(root, module.source)))
        contents.set(module.source, await readFile(resolve(root, module.source), 'utf8'));
      else if (!allowMissing)
        throw Error(`Package ${entry.name} is missing canonical source ${module.source}`);
    }
  }
  const relativeImports = (source) =>
    [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)].map(
      (match) => match[1],
    );
  for (const [path, source] of contents)
    for (const specifier of relativeImports(source)) {
      if (!specifier.startsWith('.')) continue;
      const target = slash(relative(root, resolve(root, dirname(path), specifier)));
      const owner = owners.get(target);
      if (!owner) throw Error(`Unpackaged import ${specifier} from ${path}`);
      const current = owners.get(path).entry;
      if (owner.entry.id !== current.id) current.dependencies.add(owner.entry.name);
    }
  const umbrella = entries.find((entry) => entry.umbrella);
  for (const entry of entries) if (entry !== umbrella) umbrella.dependencies.add(entry.name);
  const known = new Set([...owners.keys(), 'dist/core/index.js']);
  for (const name of await readdir(resolve(root, 'dist/core')))
    if (name.endsWith('.js') && !known.has('dist/core/' + name))
      throw Error(`Core module has no package owner: ${name}`);
  return { entries, owners, contents };
}
export function specifierFor(owner) {
  return `${owner.entry.name}/${owner.name}`;
}
export function rewrite(source, path, owners, { cjs = false } = {}) {
  const current = owners.get(path);
  return source.replace(
    /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"])([^'"]+)(['"])/g,
    (all, before, value, after) => {
      if (!value.startsWith('.')) return all;
      const target = owners.get(slash(relative(root, resolve(root, dirname(path), value))));
      if (!target) throw Error(`Unresolved package import ${value} in ${path}`);
      let next;
      if (target.entry.id === current.entry.id) {
        next = slash(relative(dirname(current.name), target.name)) + (cjs ? '.cjs' : '.js');
        if (!next.startsWith('.')) next = './' + next;
      } else next = specifierFor(target);
      return before + next + after;
    },
  );
}
