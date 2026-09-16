import { npmInvocation } from './package-process.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { graph, root } from './package-graph.mjs';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const command = process.argv[2];
if (!['check', 'pack', 'verify', 'dry-run', 'publish'].includes(command))
  throw Error('Usage: node scripts/package-release.mjs check|pack|verify|dry-run|publish');
function run(binary, args, { allowFailure = false } = {}) {
  if (binary === npm) {
    const invocation = npmInvocation(args);
    binary = invocation.command;
    args = invocation.args;
  }
  const r = spawnSync(binary, args, { cwd: root, encoding: 'utf8', env: process.env });
  if (!allowFailure && r.status !== 0)
    throw Error(`${binary} ${args.join(' ')} failed:\n${r.stdout || ''}${r.stderr || ''}`);
  return r;
}
const current = await graph(),
  project = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const ordered = [],
  visited = new Set(),
  visiting = new Set();
function visit(entry) {
  if (visited.has(entry.name)) return;
  if (visiting.has(entry.name)) throw Error(`Package dependency cycle at ${entry.name}`);
  visiting.add(entry.name);
  for (const name of entry.dependencies) {
    const dependency = current.entries.find((item) => item.name === name);
    assert(dependency, `Unknown internal dependency ${name}`);
    visit(dependency);
  }
  visiting.delete(entry.name);
  visited.add(entry.name);
  ordered.push(entry);
}
for (const entry of current.entries) visit(entry);
for (const entry of ordered) {
  const p = JSON.parse(await readFile(resolve(entry.directory, 'package.json'), 'utf8'));
  assert.equal(p.version, project.version);
  assert(!p.private);
  assert.equal(p.publishConfig?.access, 'public');
  assert.equal(p.publishConfig?.provenance, true);
  for (const [name, version] of Object.entries(p.dependencies || {}))
    if (name.startsWith('@wieslawsoltes/xamora'))
      assert.equal(
        version,
        project.version,
        `${entry.name}: internal dependencies must be exact and aligned`,
      );
}
if (command === 'check') {
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, project.version);
  assert.equal(lock.packages[''].version, project.version);
  for (const entry of ordered) {
    const locked = lock.packages['packages/' + entry.id];
    assert(locked, `Missing lock entry ${entry.name}`);
    assert.equal(locked.version, project.version);
    const manifest = JSON.parse(await readFile(resolve(entry.directory, 'package.json'), 'utf8'));
    assert.deepEqual(
      locked.dependencies || {},
      manifest.dependencies || {},
      `Stale lock dependencies for ${entry.name}`,
    );
  }
  console.log(
    `Release metadata and acyclic package graph verified for ${ordered.length} packages @ ${project.version}. No publication performed.`,
  );
  process.exit(0);
}
const directory = resolve(root, '.artifacts/npm');
if (command === 'pack') {
  run(process.execPath, [resolve(root, 'scripts/build-packages.mjs')]);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const packages = [];
  for (const entry of ordered) {
    const packed = JSON.parse(
      run(npm, [
        'pack',
        entry.directory,
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        directory,
      ]).stdout,
    )[0];
    const bytes = await readFile(resolve(directory, packed.filename));
    packages.push({
      name: packed.name,
      version: packed.version,
      filename: packed.filename,
      integrity: packed.integrity,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  const sha = run('git', ['rev-parse', 'HEAD'], { allowFailure: true }).stdout.trim() || null;
  await writeFile(
    resolve(directory, 'release.json'),
    JSON.stringify({ version: project.version, commit: sha, packages }, null, 2) + '\n',
  );
  await writeFile(
    resolve(directory, 'SHA256SUMS.txt'),
    packages.map((item) => `${item.sha256}  ${item.filename}`).join('\n') + '\n',
  );
  console.log(
    `Packed ${packages.length} npm artifacts and checksum manifest in .artifacts/npm. Nothing published.`,
  );
  process.exit(0);
}
const release = JSON.parse(await readFile(resolve(directory, 'release.json'), 'utf8'));
assert.equal(release.version, project.version);
assert.deepEqual(
  release.packages.map((item) => item.name),
  ordered.map((entry) => entry.name),
);
for (const item of release.packages) {
  assert.equal(basename(item.filename), item.filename);
  assert.equal(item.version, project.version);
  const bytes = await readFile(resolve(directory, item.filename));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    item.sha256,
    `Changed artifact: ${item.filename}`,
  );
  assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), item.integrity);
}
if (command === 'verify') {
  for (const item of release.packages) {
    const packed = JSON.parse(
      run(npm, [
        'pack',
        resolve(directory, item.filename),
        '--dry-run',
        '--ignore-scripts',
        '--json',
      ]).stdout,
    )[0];
    assert.equal(packed.name, item.name);
    assert.equal(packed.version, item.version);
    assert(packed.files.some((file) => file.path === 'dist/esm/index.js'));
    assert(packed.files.some((file) => file.path === 'dist/cjs/index.cjs'));
  }
  console.log(
    `Verified checksums, integrity, metadata, and npm pack --dry-run for ${release.packages.length} tarballs. No npm publish command was invoked.`,
  );
  process.exit(0);
}
if (command === 'dry-run') {
  for (const item of release.packages)
    run(npm, [
      'publish',
      resolve(directory, item.filename),
      '--dry-run',
      '--ignore-scripts',
      '--provenance=false',
      '--access',
      'public',
    ]);
  console.log(
    `npm publish --dry-run passed for ${release.packages.length} checksum-verified tarballs. Nothing published.`,
  );
  process.exit(0);
}
// Actual publication is reachable only through an explicit, pinned manual release.
assert.equal(
  process.env.XAMORA_NPM_PUBLISH,
  'true',
  'Publication requires explicit XAMORA_NPM_PUBLISH=true',
);
assert.equal(
  process.env.GITHUB_ACTIONS,
  'true',
  'Publish through the protected npm release workflow',
);
assert.equal(
  process.env.RELEASE_REF,
  `v${project.version}`,
  'Publication requires an existing version tag',
);
assert.match(
  process.env.EXPECTED_SHA || '',
  /^[a-f0-9]{40}$/,
  'Publication requires an expected full commit SHA',
);
const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
assert.equal(head, process.env.EXPECTED_SHA);
assert.equal(head, release.commit);
assert.equal(
  run('git', ['rev-parse', `refs/tags/${process.env.RELEASE_REF}^{commit}`]).stdout.trim(),
  head,
  'Release must identify an actual tag at the expected commit',
);
const tag = process.env.NPM_DIST_TAG || 'latest';
assert(['latest', 'next'].includes(tag));
if (project.version.includes('-')) assert.equal(tag, 'next', 'Prereleases use the next dist-tag');
for (const item of release.packages) {
  const existing = run(
    npm,
    [
      'view',
      `${item.name}@${item.version}`,
      'dist.integrity',
      '--json',
      '--registry=https://registry.npmjs.org',
    ],
    { allowFailure: true },
  );
  if (existing.status === 0 && existing.stdout.trim()) {
    assert.equal(
      JSON.parse(existing.stdout),
      item.integrity,
      `Immutable npm version differs: ${item.name}`,
    );
    console.log(`Already published identical artifact: ${item.name}`);
    continue;
  }
  if (existing.status !== 0 && !`${existing.stdout}${existing.stderr}`.includes('E404'))
    throw Error(`Could not verify npm registry state for ${item.name}: ${existing.stderr}`);
  run(npm, [
    'publish',
    resolve(directory, item.filename),
    '--registry=https://registry.npmjs.org',
    '--access',
    'public',
    '--provenance',
    '--ignore-scripts',
    '--tag',
    tag,
  ]);
  const verified = run(npm, [
    'view',
    `${item.name}@${item.version}`,
    'dist.integrity',
    '--json',
    '--registry=https://registry.npmjs.org',
  ]);
  assert.equal(
    JSON.parse(verified.stdout),
    item.integrity,
    `Published integrity mismatch: ${item.name}`,
  );
}
console.log('Published artifacts verified against immutable npm integrity.');
