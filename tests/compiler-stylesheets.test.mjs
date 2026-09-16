import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { loadLocalStylesheets } from '../dist/compiler-cli/stylesheets.js';
import { parseArguments, runCli } from '../dist/compiler-cli/index.js';
const Parser = new Window().DOMParser;
async function workspace(t) {
  const path = await mkdtemp(join(tmpdir(), 'xamora-css-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
const entry = (source, path = 'views/index.html') => ({ source, path, framework: 'HTML' });
test('CLI CSS graph resolves nested project paths, queries, imports and encoded filenames', async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, 'views'));
  await mkdir(join(root, 'styles'));
  await writeFile(
    join(root, 'styles', 'theme.css'),
    '@import "space name.css?cache=1"; button {height:40px}',
  );
  await writeFile(join(root, 'styles', 'space name.css'), 'button{width:120px}');
  const sheets = await loadLocalStylesheets(
    [entry('<link rel="stylesheet" href="../styles/theme.css">')],
    root,
    Parser,
  );
  assert.equal(sheets.size, 2);
  assert.match(sheets.get('https://xamora.invalid/styles/space%20name.css?cache=1'), /120px/);
});
test('CLI stylesheet graph refuses network, traversal, symlink, invalid UTF8 and missing files', async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, 'views'));
  await writeFile(join(root, 'bad.css'), Buffer.from([0xff]));
  await symlink(join(root, 'bad.css'), join(root, 'linked.css'));
  for (const href of [
    'https://example.com/style.css',
    '//example.com/style.css',
    '../../outside.css',
    '../linked.css',
    '../bad.css',
    'missing.css',
    '..%2f..%2foutside.css',
  ])
    await assert.rejects(
      loadLocalStylesheets([entry(`<link rel="stylesheet" href="${href}">`)], root, Parser),
      undefined,
      href,
    );
});
test('CLI stylesheet graph terminates cycles and ignores disabled, alternate and non-CSS sheets', async (t) => {
  const root = await workspace(t);
  await writeFile(join(root, 'a.css'), '@import "b.css";');
  await writeFile(join(root, 'b.css'), '@import "a.css";');
  const sheets = await loadLocalStylesheets(
    [
      entry(
        '<link rel="stylesheet" href="a.css"><link disabled rel="stylesheet" href="absent.css"><link rel="alternate stylesheet" href="absent.css"><link rel="stylesheet" type="text/plain" href="absent.css"><style type="text/plain">@import "absent.css";</style>',
        'index.html',
      ),
    ],
    root,
    Parser,
  );
  assert.equal(sheets.size, 2);
});
test('CLI viewport and native options validate without filesystem side effects', () => {
  const args = ['index.html', '--to', 'xaml', '--dry-run'];
  const result = parseArguments([
    ...args,
    '--viewport',
    '800x600',
    '--media-type',
    'print',
    '--color-scheme',
    'dark',
    '--native',
    '--load-css',
  ]);
  assert.deepEqual(result.environment, {
    type: 'print',
    width: 800,
    height: 600,
    colorScheme: 'dark',
  });
  assert.equal(result.nativeOutput, true);
  assert.equal(result.preserveMetadata, false);
  for (const extras of [
    ['--viewport', '0x10'],
    ['--viewport', '1e2x10'],
    ['--viewport', '100001x10'],
    ['--media-type', 'TV'],
    ['--color-scheme', 'automatic'],
  ])
    assert.throws(() => parseArguments([...args, ...extras]));
});
test('real CLI uses supplied CSS and media conditions in native output before atomic file writes', async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, 'views'));
  await mkdir(join(root, 'styles'));
  await writeFile(
    join(root, 'views', 'index.html'),
    '<link rel="stylesheet" href="../styles/main.css"><div style="padding:4px"><button id="button">Apply</button></div>',
  );
  await writeFile(
    join(root, 'styles', 'main.css'),
    'button{width:80px}@media(width >= 600px){button{width:120px}}',
  );
  let errors = '';
  const code = await runCli(
    ['.', '--to', 'xaml', '--out-dir', 'out', '--native', '--load-css', '--viewport', '800x600'],
    { cwd: root, Parser, stdout: () => {}, stderr: (value) => (errors += value) },
  );
  assert.equal(code, 0, errors);
  const source = await readFile(join(root, 'out', 'views', 'index.xaml'), 'utf8');
  assert.match(source, /Width="120"/);
  assert.match(source, /<Border/);
  assert.doesNotMatch(source, /web:Source/);
});

test('local HTML directory base uses the first base and cannot normalize traversal away', async (t) => {
  const root = await workspace(t);
  await mkdir(join(root, 'styles'));
  await writeFile(join(root, 'styles', 'a.css'), 'button{width:91px}');
  const result = await loadLocalStylesheets(
    [
      entry(
        '<base href="styles/"><base href="ignored/"><link rel="stylesheet" href="a.css">',
        'index.html',
      ),
    ],
    root,
    Parser,
  );
  assert.match(result.get('https://xamora.invalid/styles/a.css'), /91px/);
  await assert.rejects(
    loadLocalStylesheets(
      [entry('<base href="../"><link rel="stylesheet" href="a.css">', 'index.html')],
      root,
      Parser,
    ),
    /escapes/,
  );
});
