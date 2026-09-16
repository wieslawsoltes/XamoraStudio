import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import {
  preloadCompilerStylesheets,
  compileDocumentAsync,
} from '../dist/core/compiler-resources.js';
import { runCli, parseArguments } from '../dist/compiler-cli/index.js';
const Parser = new Window().DOMParser;
const input =
  '<html><head><link rel="stylesheet" href="css/main.css"></head><body><button id="target">X</button></body></html>';
test('async loader resolves nested imports once with absolute URL and no source mutation', async () => {
  const calls = [];
  const sources = {
    'https://a.test/site/css/main.css':
      '@import "nested.css";@import "nested.css";button{width:22px}',
    'https://a.test/site/css/nested.css': '@import "main.css";button{height:33px}',
  };
  const options = {
    from: 'html',
    Parser,
    baseUrl: 'https://a.test/site/index.html',
    loadStylesheet: async (url, { signal }) => {
      assert(signal instanceof AbortSignal);
      calls.push(url);
      return sources[url];
    },
  };
  const r = await compileDocumentAsync(input, options);
  assert(r.success);
  assert.match(r.source, /Width="22"/);
  assert.match(r.source, /Height="33"/);
  assert.deepEqual(calls, Object.keys(sources));
  assert(r.diagnostics.some((d) => d.code === 'CSS_IMPORT_CYCLE'));
});
test('async conditional preload never loads false branches and honors first HTML base', async () => {
  const calls = [];
  const registry = await preloadCompilerStylesheets(
    '<base href="https://a.test/css/"><base href="https://ignored.test/"><link media="print" rel="stylesheet" href="print.css"><style>@import "main.css";</style>',
    {
      Parser,
      environment: { type: 'screen' },
      loadStylesheet: (url) => {
        calls.push(url);
        return 'button{width:22px}';
      },
    },
  );
  assert.deepEqual(calls, ['https://a.test/css/main.css']);
  assert.equal(registry.size, 1);
});
test('async callback deadlines and cancellation settle even when the host ignores its signal', async () => {
  await assert.rejects(
    preloadCompilerStylesheets(input, {
      Parser,
      stylesheetTimeout: 5,
      loadStylesheet: () => new Promise(() => {}),
    }),
    /timed out/,
  );
  const controller = new AbortController();
  const operation = preloadCompilerStylesheets(input, {
    Parser,
    signal: controller.signal,
    loadStylesheet: () => new Promise(() => {}),
  });
  controller.abort(new Error('cancelled by caller'));
  await assert.rejects(operation, /cancelled by caller/);
});
test('async loader validates returned types, budgets, already-aborted requests and explicit missing policy', async () => {
  await assert.rejects(
    preloadCompilerStylesheets(input, { Parser, loadStylesheet: () => 42 }),
    /No text stylesheet/,
  );
  await assert.rejects(
    preloadCompilerStylesheets(input, {
      Parser,
      maxStylesheetBytes: 2,
      loadStylesheet: () => '.x{}',
    }),
    /maxStylesheetBytes/,
  );
  const c = new AbortController();
  c.abort(new Error('stop'));
  let called = false;
  await assert.rejects(
    preloadCompilerStylesheets(input, {
      Parser,
      signal: c.signal,
      loadStylesheet: () => {
        called = true;
        return '';
      },
    }),
    /stop/,
  );
  assert(!called);
  const r = await compileDocumentAsync(input, {
    from: 'html',
    Parser,
    allowMissingStylesheets: true,
    loadStylesheet: () => undefined,
    strict: true,
  });
  assert(!r.success);
  assert(r.losses.some((d) => d.code === 'EXTERNAL_CSS'));
});
test('viewport CLI options validate units and ranges without touching files', () => {
  assert.deepEqual(
    parseArguments([
      'a.html',
      '--to',
      'xaml',
      '--dry-run',
      '--viewport',
      '800x600',
      '--media',
      'print',
    ]).environment,
    { width: 800, height: 600, type: 'print' },
  );
  for (const value of ['0x600', '800pxx600', 'NaNx1', '100001x600'])
    assert.throws(
      () => parseArguments(['a.html', '--to', 'xaml', '--dry-run', '--viewport', value]),
      /viewport/,
    );
});
test('CLI compiles nested local stylesheets with full relative document paths and responsive environment', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'xamora-css-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'views'));
  await mkdir(join(dir, 'css'));
  await writeFile(
    join(dir, 'views', 'main.html'),
    '<link rel="stylesheet" href="../css/main.css"><button id="target">X</button>',
  );
  await writeFile(
    join(dir, 'css', 'main.css'),
    '@import "size.css";@media(width<600px){button{height:42px}}',
  );
  await writeFile(join(dir, 'css', 'size.css'), 'button{width:123px}');
  let errors = '';
  const exit = await runCli(
    [dir, '--to', 'xaml', '--out-dir', join(dir, 'out'), '--viewport', '400x600'],
    { stdout: () => {}, stderr: (s) => (errors += s) },
  );
  assert.equal(exit, 0, errors);
  const source = await readFile(join(dir, 'out', 'views', 'main.xaml'), 'utf8');
  assert.match(source, /Width="123"/);
  assert.match(source, /Height="42"/);
});
test('CLI never fetches remote stylesheets and refuses local symlink escape', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'xamora-css-escape-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    join(dir, 'main.html'),
    '<link rel="stylesheet" href="https://example.invalid/private.css"><button>X</button>',
  );
  let output = '';
  const env = { stdout: (s) => (output += s), stderr: (s) => (output += s) };
  assert.equal(await runCli([dir, '--to', 'xaml', '--dry-run', '--report', '-'], env), 0);
  assert.match(output, /EXTERNAL_CSS/);
  await writeFile(join(dir, 'actual.css'), 'button{width:99px}');
  await symlink(join(dir, 'actual.css'), join(dir, 'linked.css'));
  await writeFile(
    join(dir, 'main.html'),
    '<link rel="stylesheet" href="linked.css"><button>X</button>',
  );
  output = '';
  assert.notEqual(await runCli([dir, '--to', 'xaml', '--dry-run', '--report', '-'], env), 0);
  assert.match(output, /symbolic|symlink/i);
});
