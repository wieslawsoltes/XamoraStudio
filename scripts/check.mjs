import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
async function files(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : join(dir, e.name),
      ),
    )
  ).flat();
}
let fail = false;
for (const path of await files('dist'))
  if (path.endsWith('.js')) {
    const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (check.status) {
      fail = true;
      console.error(check.stderr);
    }
  }
for (const path of [
  '../dist/core/index.js',
  '../dist/studio/blend-features.js',
  '../dist/studio/prototype-editor.js',
  '../dist/studio/docking-studio.js',
  '../dist/studio/editor-workspace.js',
  '../dist/controls/dock-workspace.js',
]) {
  try {
    await import(path);
  } catch (error) {
    fail = true;
    console.error('Module linkage failed', path, error.message);
  }
}
const html = await readFile('dist/index.html', 'utf8');
for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) {
  try {
    await readFile(resolve('dist', match[1]));
  } catch {
    fail = true;
    console.error('Missing asset', match[1]);
  }
}
if (!html.includes('type="module"') || !html.includes('name="viewport"')) {
  fail = true;
  console.error('Missing entrypoint or viewport.');
}
console.log(
  fail
    ? 'Static checks failed'
    : 'JavaScript syntax, module linkage and local entrypoint assets verified.',
);
process.exitCode = fail ? 1 : 0;
