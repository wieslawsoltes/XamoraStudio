import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseArguments, collectConversionEntries, runCli} from '../dist/compiler-cli/index.js';
import {collectReferencedAssets} from '../dist/compiler-cli/assets.js';
import {parseXaml} from '../dist/core/xaml.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'xamora-cli-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}
function compileStub(entries, options) {
  return {
    entries: entries.map(entry => ({
      sourcePath: entry.path, targetPath: entry.path.replace(/\.(xaml|xml|axaml|html?)$/i, '.' + options.to),
      status: 'ready', result: {source: '<converted>' + (entry.source || entry.document.name) + '</converted>', diagnostics: [], sourceMap: [], losses: []}
    })), summary: {ready: entries.length, failed: 0, skipped: 0, diagnostics: 0, losses: 0}
  };
}
async function invoke(directory, args, environment = {}) {
  let output = '', errors = '';
  const code = await runCli(args, {cwd: directory, stdout: text => { output += text; }, stderr: text => { errors += text; }, planner: compileStub, ...environment});
  return {code, output, errors};
}

test('CLI validates complete option values, formats, and write-free dry runs', () => {
  const options = parseArguments(['page.xaml', '--to', 'html', '--dry-run', '--strict', '--no-metadata', '--report', '-']);
  assert.equal(options.to, 'html');
  assert.equal(options.strict, true);
  assert.equal(options.preserveMetadata, false);
  for (const arguments_ of [[], ['page.xaml'], ['page.xaml', '--to'], ['page.xaml', '--to', 'svg'], ['page.xaml', '--to', 'html'], ['page.xaml', '--to', 'html', '--dry-run', '--report', 'report.json'], ['page.xaml', '--to', 'html', '--dry-run', '--unknown']]) {
    assert.throws(() => parseArguments(arguments_));
  }
  assert.equal(parseArguments(['--help']).help, true);
  assert.equal(parseArguments(['--to', 'html', '--dry-run', '--', '-page.xaml']).input, '-page.xaml');
});

test('folder scan sorts nested paths, excludes output and dependencies, filters source formats', async t => {
  const directory = await workspace(t);
  for (const folder of ['views/z', 'views/a', 'views/generated', 'views/node_modules', 'views/.git']) await mkdir(join(directory, folder), {recursive: true});
  for (const path of ['views/z/B.xaml', 'views/a/A.axaml', 'views/Page.html', 'views/generated/Old.xaml', 'views/node_modules/Package.xaml', 'views/.git/Old.xaml']) await writeFile(join(directory, path), '<Grid/>');
  await writeFile(join(directory, 'views/readme.md'), 'Ignore');
  const collected = await collectConversionEntries('views', {cwd: directory, from: 'xaml', outDir: 'views/generated'});
  assert.deepEqual(collected.entries.map(entry => entry.path), ['a/A.axaml', 'z/B.xaml']);
  assert.equal(collected.skipped[0].path, 'Page.html');
});

test('dry run invokes shared planner but creates neither files nor folders', async t => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'View.xaml'), '<Grid/>');
  let passed;
  const result = await invoke(directory, ['View.xaml', '--to', 'html', '--out-dir', 'output', '--dry-run', '--strict', '--report', '-'], {planner: (entries, options) => { passed = options; return compileStub(entries, options); }});
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(await readdir(directory), ['View.xaml']);
  assert.equal(passed.strict, true);
  assert.equal(passed.collision, 'error');
  const report = JSON.parse(result.output);
  assert.equal(report.dryRun, true);
  assert.equal(report.entries[0].targetPath, 'View.html');
});

test('writes converted documents with relative directories and a machine-readable report', async t => {
  const directory = await workspace(t);
  await mkdir(join(directory, 'src/Views'), {recursive: true});
  await writeFile(join(directory, 'src/Views/Page.xaml'), '<Grid/>');
  const result = await invoke(directory, ['src', '--to', 'html', '--out-dir', 'out']);
  assert.equal(result.code, 0, result.errors);
  assert.equal(await readFile(join(directory, 'out/Views/Page.html'), 'utf8'), '<converted><Grid/></converted>');
  assert.equal(JSON.parse(await readFile(join(directory, 'out/conversion-report.json'), 'utf8')).success, true);
  assert.equal(await readFile(join(directory, 'src/Views/Page.xaml'), 'utf8'), '<Grid/>');
});

test('existing output aborts the complete batch before any files change', async t => {
  const directory = await workspace(t);
  await mkdir(join(directory, 'src'));
  await mkdir(join(directory, 'out'));
  for (const name of ['A', 'B']) await writeFile(join(directory, 'src', name + '.xaml'), '<Grid/>');
  await writeFile(join(directory, 'out/B.html'), 'Keep me');
  const result = await invoke(directory, ['src', '--to', 'html', '--out-dir', 'out']);
  assert.equal(result.code, 2);
  assert.match(result.errors, /already exists/);
  assert.deepEqual(await readdir(join(directory, 'out')), ['B.html']);
  assert.equal(await readFile(join(directory, 'out/B.html'), 'utf8'), 'Keep me');
});

test('conversion failure retains diagnostics and writes no partial documents', async t => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'View.xaml'), '<Unknown/>');
  const result = await invoke(directory, ['View.xaml', '--to', 'html', '--out-dir', 'out', '--strict', '--report', '-'], {planner: entries => ({entries: [
    {sourcePath: entries[0].path, targetPath: 'View.html', status: 'failed', diagnostics: [{severity: 'warning', code: 'UNMAPPED_CONTROL', message: 'Unknown control'}], result: {losses: [{code: 'UNMAPPED_CONTROL'}]}}
  ], summary: {ready: 0, failed: 1, skipped: 0, diagnostics: 1, losses: 1}})});
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.output).entries[0].diagnostics[0].code, 'UNMAPPED_CONTROL');
  assert.deepEqual(await readdir(directory), ['View.xaml']);
});

test('portable manifests support inline and file sources without escaping their root', async t => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'Disk.xaml'), '<Button/>');
  await writeFile(join(directory, 'solution.json'), JSON.stringify({format: 'xamora-conversion', version: 1, files: ['Disk.xaml', {path: 'Nested/Inline.xaml', source: '<Grid/>'}]}));
  const result = await collectConversionEntries('solution.json', {cwd: directory});
  assert.deepEqual(result.entries.map(entry => entry.path), ['Disk.xaml', 'Nested/Inline.xaml']);
  assert.equal(result.entries[0].source, '<Button/>');
  assert.equal(result.entries[1].source, '<Grid/>');
  for (const path of ['../escape.xaml', '/absolute.xaml', 'a/../../escape.xaml', 'C:\\escape.xaml']) {
    await writeFile(join(directory, 'solution.json'), JSON.stringify({format: 'xamora-conversion', version: 1, files: [{path, source: '<Grid/>'}]}));
    await assert.rejects(collectConversionEntries('solution.json', {cwd: directory}));
  }
});

test('Xamora workspace manifests pass shared AST documents directly to the planner', async t => {
  const directory = await workspace(t);
  const document = {id: 'view', name: 'Page.xaml', framework: 'Avalonia', root: {type: 'Grid'}, metadata: {solutionPath: 'Views/Page.xaml'}};
  await writeFile(join(directory, 'workspace.xamora.json'), JSON.stringify({format: 'xamora-workspace', documents: [document]}));
  const result = await collectConversionEntries('workspace.xamora.json', {cwd: directory});
  assert.deepEqual(result.entries[0].document, document);
  assert.equal(result.entries[0].path, 'Views/Page.xaml');
  assert.equal(result.entries[0].framework, 'Avalonia');
});

test('duplicate case-insensitive manifest paths are rejected before compiling', async t => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'solution.json'), JSON.stringify({format: 'xamora-conversion', version: 1, files: [{path: 'View.xaml', source: ''}, {path: 'view.xaml', source: ''}]}));
  await assert.rejects(collectConversionEntries('solution.json', {cwd: directory}), /Duplicate manifest path/);
});

test('symlinks are skipped during recursion and rejected as manifest sources or output parents', async t => {
  const directory = await workspace(t);
  await mkdir(join(directory, 'src'));
  await mkdir(join(directory, 'elsewhere'));
  await writeFile(join(directory, 'src/Page.xaml'), '<Grid/>');
  await writeFile(join(directory, 'elsewhere/Other.xaml'), '<Grid/>');
  await symlink(join(directory, 'elsewhere'), join(directory, 'src/link'), 'dir');
  const scan = await collectConversionEntries('src', {cwd: directory});
  assert.deepEqual(scan.entries.map(entry => entry.path), ['Page.xaml']);
  assert.match(scan.skipped[0].reason, /Symbolic link/);
  await writeFile(join(directory, 'solution.json'), JSON.stringify({format: 'xamora-conversion', version: 1, files: ['src/link/Other.xaml']}));
  await assert.rejects(collectConversionEntries('solution.json', {cwd: directory}), /symbolic links/);
  await symlink(join(directory, 'elsewhere'), join(directory, 'out'), 'dir');
  const result = await invoke(directory, ['src/Page.xaml', '--to', 'html', '--out-dir', 'out']);
  assert.equal(result.code, 2);
  assert.match(result.errors, /symbolic links/);
  assert.deepEqual(await readdir(join(directory, 'elsewhere')), ['Other.xaml']);
});

test('compiler target traversal and duplicate targets are rejected without writing', async t => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'View.xaml'), '<Grid/>');
  const result = await invoke(directory, ['View.xaml', '--to', 'html', '--out-dir', 'out'], {planner: () => ({entries: [{sourcePath: 'View.xaml', targetPath: '../escape.html', status: 'ready', source: 'No'}], summary: {ready: 1}})});
  assert.equal(result.code, 2);
  assert.deepEqual(await readdir(directory), ['View.xaml']);
  const duplicates = await invoke(directory, ['View.xaml', '--to', 'html', '--out-dir', 'out'], {planner: () => ({entries: ['a.html', 'A.html'].map(targetPath => ({sourcePath: 'View.xaml', targetPath, status: 'ready', source: 'No'})), summary: {ready: 2}})});
  assert.equal(duplicates.code, 2);
  assert.match(duplicates.errors, /same file/);
  assert.deepEqual(await readdir(directory), ['View.xaml']);
});

test('a report path cannot overwrite an input or collide with generated output', async t => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'View.xaml'), '<Grid/>');
  const result = await invoke(directory, ['View.xaml', '--to', 'html', '--out-dir', 'out', '--report', 'View.xaml']);
  assert.equal(result.code, 2);
  assert.equal(await readFile(join(directory, 'View.xaml'), 'utf8'), '<Grid/>');
  const collision = await invoke(directory, ['View.xaml', '--to', 'html', '--out-dir', 'out', '--report', 'out/View.html']);
  assert.equal(collision.code, 2);
  assert.deepEqual(await readdir(directory), ['View.xaml']);
});

test('unreadable manifest file aborts collection without output', async t => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'solution.json'), JSON.stringify({format: 'xamora-conversion', version: 1, files: [{path: 'Good.xaml', source: '<Grid/>'}, 'Missing.xaml']}));
  const result = await invoke(directory, ['solution.json', '--to', 'html', '--out-dir', 'out']);
  assert.equal(result.code, 2);
  assert.match(result.errors, /Missing.xaml/);
  assert.deepEqual(await readdir(directory), ['solution.json']);
});

test('invalid UTF-8 input fails before writing and preserves source bytes', async t => {
  const directory = await workspace(t);
  await mkdir(join(directory, 'src'));
  const invalid = Buffer.from([0x3c, 0x47, 0x72, 0x69, 0x64, 0x3e, 0xc3, 0x28, 0x3c, 0x2f, 0x47, 0x72, 0x69, 0x64, 0x3e]);
  await writeFile(join(directory, 'src/A.xaml'), '<Grid/>');
  await writeFile(join(directory, 'src/B.xaml'), invalid);
  const result = await invoke(directory, ['src', '--to', 'html', '--out-dir', 'out']);
  assert.equal(result.code, 2);
  assert.match(result.errors, /not valid UTF-8/);
  assert.deepEqual(await readFile(join(directory, 'src/B.xaml')), invalid);
  assert.deepEqual(await readdir(directory), ['src']);
});

test('dry-run preflights existing destinations and emits a failed JSON report', async t => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'View.xaml'), '<Grid/>');
  await mkdir(join(directory, 'out'));
  await writeFile(join(directory, 'out/View.html'), 'Existing');
  const result = await invoke(directory, ['View.xaml', '--to', 'html', '--out-dir', 'out', '--dry-run', '--report', '-']);
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.output).success, false);
  assert.equal(await readFile(join(directory, 'out/View.html'), 'utf8'), 'Existing');
});

test('absolute output roots preserve unrelated files and dry-run also checks the default report', async t => {
  const directory = await workspace(t);
  await mkdir(join(directory, 'out'));
  await writeFile(join(directory, 'View.xaml'), '<Grid/>');
  await writeFile(join(directory, 'out/unrelated.txt'), 'Keep me');
  const result = await invoke(directory, ['View.xaml', '--to', 'html', '--out-dir', join(directory, 'out')]);
  assert.equal(result.code, 0, result.errors);
  assert.equal(await readFile(join(directory, 'out/unrelated.txt'), 'utf8'), 'Keep me');
  await rm(join(directory, 'out/View.html'));
  const dryRun = await invoke(directory, ['View.xaml', '--to', 'html', '--out-dir', join(directory, 'out'), '--dry-run']);
  assert.equal(dryRun.code, 2);
  assert.match(dryRun.errors, /conversion-report\.json/);
  assert.deepEqual((await readdir(join(directory, 'out'))).sort(), ['conversion-report.json', 'unrelated.txt']);
});

test('real compiler CLI parses source and emitted HTML in both directions', async t => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'View.xaml'), '<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><Button Content="Original" Width="120"/></Grid>');
  const toHtml = await invoke(directory, ['View.xaml', '--to', 'html', '--out-dir', 'web'], {planner: undefined});
  assert.equal(toHtml.code, 0, toHtml.errors);
  const html = await readFile(join(directory, 'web/View.html'), 'utf8');
  assert.match(html, /<button\b/);
  assert.match(html, /width: 120px/);
  await writeFile(join(directory, 'web/View.html'), html.replace('>Original<', '>Edited<'));
  const toXaml = await invoke(directory, ['web/View.html', '--to', 'xaml', '--out-dir', 'native'], {planner: undefined});
  assert.equal(toXaml.code, 0, toXaml.errors);
  const document = parseXaml(await readFile(join(directory, 'native/View.xaml'), 'utf8'));
  assert.equal(document.root.type, 'Grid');
  assert.equal(document.root.children.find(node => node.type === 'Button').props.Content, 'Edited');
});

test('real compiler copies nested referenced binary assets into the output root', async t => {
  const directory = await workspace(t);
  await mkdir(join(directory, 'src/Views'), {recursive: true});
  await mkdir(join(directory, 'src/images'));
  const image = Buffer.from([0, 1, 2, 255, 0, 127]);
  await writeFile(join(directory, 'src/images/photo.png'), image);
  await writeFile(join(directory, 'src/Views/Page.xaml'), '<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><Image Source="../images/photo.png"/></Grid>');
  const result = await invoke(directory, ['src', '--to', 'html', '--out-dir', 'out'], {planner: undefined});
  assert.equal(result.code, 0, result.errors);
  assert.deepEqual(await readFile(join(directory, 'out/images/photo.png')), image);
  assert.match(await readFile(join(directory, 'out/Views/Page.html'), 'utf8'), /src="\.\.\/images\/photo.png"/);
  assert.equal(JSON.parse(await readFile(join(directory, 'out/conversion-report.json'), 'utf8')).assets[0].bytes, image.length);
});

test('asset graph follows nested CSS references while refusing missing files and escaping paths', async t => {
  const directory = await workspace(t);
  await mkdir(join(directory, 'styles/theme'), {recursive: true});
  await mkdir(join(directory, 'images'));
  await writeFile(join(directory, 'styles/site.css'), '@import "theme/colors.css"; main { background: url(../images/back.png) }');
  await writeFile(join(directory, 'styles/theme/colors.css'), '.icon { background: url("../../images/icon.png") }');
  await writeFile(join(directory, 'images/back.png'), Buffer.from([1, 2]));
  await writeFile(join(directory, 'images/icon.png'), Buffer.from([3, 4]));
  const result = await collectReferencedAssets({entries: [{status: 'ready', targetPath: 'index.html', result: {document: {root: {
    kind: 'element', type: 'html', props: {}, children: [
      {kind: 'element', type: 'link', props: {href: 'styles/site.css'}, children: []},
      {kind: 'element', type: 'img', props: {src: '../outside.png'}, children: []},
      {kind: 'element', type: 'img', props: {src: 'missing.png'}, children: []}
    ]
  }}}}]}, directory);
  assert.deepEqual(result.files.map(file => file.path), ['images/back.png', 'images/icon.png', 'styles/site.css', 'styles/theme/colors.css']);
  assert.equal(result.diagnostics.length, 2);
  assert.match(result.diagnostics.map(issue => issue.message).join(' '), /outside the input root/);
});

test('strict asset failures abort the batch and preserve source bytes', async t => {
  const directory = await workspace(t);
  const source = '<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><Image Source="missing.png"/></Grid>';
  await writeFile(join(directory, 'View.xaml'), source);
  const result = await invoke(directory, ['View.xaml', '--to', 'html', '--out-dir', 'out', '--strict', '--report', '-'], {planner: undefined});
  assert.equal(result.code, 1, result.errors);
  const report = JSON.parse(result.output);
  assert.equal(report.assetDiagnostics[0].code, 'CLI_ASSET_REFERENCE');
  assert.deepEqual(await readdir(directory), ['View.xaml']);
  assert.equal(await readFile(join(directory, 'View.xaml'), 'utf8'), source);
});

test('HTML parsing does not evaluate scripts during conversion', async t => {
  const directory = await workspace(t);
  await writeFile(join(directory, 'page.html'), '<!DOCTYPE html><html><head><script>throw new Error("MUST NOT EXECUTE");</script></head><body><button>Safe</button></body></html>');
  const result = await invoke(directory, ['page.html', '--to', 'xaml', '--out-dir', 'out'], {planner: undefined});
  assert.equal(result.code, 0, result.errors);
  assert.match(await readFile(join(directory, 'out/page.xaml'), 'utf8'), /Safe/);
});

test('executable entrypoint works through npm-style bin symlinks from another directory', async t => {
  const directory = await workspace(t);
  await symlink(fileURLToPath(new URL('../dist/compiler-cli/index.js', import.meta.url)), join(directory, 'xamora-convert'));
  const result = await promisify(execFile)(process.execPath, [join(directory, 'xamora-convert'), '--help'], {cwd: directory});
  assert.match(result.stdout, /Xamora semantic document converter/);
  assert.equal(result.stderr, '');
});
