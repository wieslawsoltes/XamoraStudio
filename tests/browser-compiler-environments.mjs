/** Real computed styles and native box captures from source and published-package entrypoints. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..');
const fixtureRoot = resolve(root, 'tests/fixtures/compiler-responsive');
const source = await readFile(resolve(fixtureRoot, 'index.html'), 'utf8');
const theme = await readFile(resolve(fixtureRoot, 'theme.css'), 'utf8');
const base = await readFile(resolve(fixtureRoot, 'base.css'), 'utf8');
const isolated = process.env.XAMORA_ISOLATED_BROWSER === '1';
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(fixtureRoot, '.' + path);
    if (!file.startsWith(fixtureRoot + '/')) throw Error('Invalid path');
    res.setHeader('Content-Type', extname(file) === '.css' ? 'text/css' : 'text/html');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  for (const entry of ['dist/core/index.js', 'packages/compiler/dist/esm/index.js']) {
    const bundle = await build({
      absWorkingDir: root,
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
    });
    const page = await browser.newPage({
      viewport: { width: 900, height: 700 },
      colorScheme: 'light',
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (isolated)
      await page.setContent(
        source.replace(
          '<link rel="stylesheet" href="theme.css">',
          `<style>@layer base {${base}}</style><style>${theme.replace('@import "base.css" layer(base);', '')}</style>`,
        ),
      );
    else await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.evaluate(async (code) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      window.compiler = await import(url);
      URL.revokeObjectURL(url);
      await document.fonts.ready;
    }, bundle.outputFiles[0].text);
    const first = await page.evaluate(
      ({ source, theme, base }) => {
        const check = (condition, message) => {
          if (!condition) throw Error(message);
        };
        const target = document.getElementById('conditional');
        const css = getComputedStyle(target);
        check(css.height === '32px', 'supports condition');
        check(css.backgroundColor === 'rgb(20, 30, 40)', 'light media context');
        check(
          getComputedStyle(document.getElementById('container_child')).height === '40px',
          'wide container query',
        );
        const snapshot = compiler.compileRenderedDocument(document.getElementById('surface'));
        check(snapshot.success, JSON.stringify(snapshot.diagnostics));
        check(snapshot.metadata.geometry.length >= 10, 'mapped measured boxes');
        for (const item of snapshot.metadata.geometry) {
          if (!item.sourceElementId) continue;
          const actual = document.getElementById(item.sourceElementId).getBoundingClientRect();
          check(Math.abs(item.rect.width - actual.width) < 0.001, item.sourceElementId + ' width');
          check(Math.abs(item.rect.x - actual.x) < 0.001, item.sourceElementId + ' position');
        }
        check(
          snapshot.sourceMap.every((entry) => entry.targetRange),
          'native source ranges',
        );
        const semantic = compiler.compileDocument(source, {
          from: 'html',
          preserveMetadata: false,
          environment: {
            type: 'screen',
            width: innerWidth,
            height: innerHeight,
            colorScheme: 'light',
          },
          supports: (query) => CSS.supports(query),
          stylesheets: { 'theme.css': theme, 'base.css': base },
          evaluateCondition: (kind, query, node) =>
            kind === 'container'
              ? document.getElementById('container').getBoundingClientRect().width > 400
              : undefined,
          selectorState: { hover: [], focus: [] },
        });
        check(semantic.success, 'semantic environment');
        const find = (node, name) =>
          node.props?.['x:Name'] === name
            ? node
            : node.children?.map((child) => find(child, name)).find(Boolean);
        check(find(semantic.document.root, 'conditional').props.Height === '32', 'static supports');
        check(
          find(semantic.document.root, 'card_one').props.BorderBrush === '#FFB4141E',
          'static has',
        );
        check(
          find(semantic.document.root, 'card_two').props.Background === '#FFE0F0FF',
          'static nth-child',
        );
        const strict = compiler.compileRenderedDocument(document.getElementById('surface'), {
          strict: true,
        });
        check(
          !strict.success && strict.losses.some((loss) => loss.code === 'BROWSER_FONT_METRICS'),
          'strict typography loss',
        );
        window.captures = [];
        window.observer = compiler.observeRenderedDocument(document.getElementById('surface'), {
          onResult: (result) => captures.push(result),
        });
        return snapshot.metadata.browserCapture.root;
      },
      { source, theme, base },
    );
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.style.cssText = 'width:200px;height:100px';
      host.innerHTML =
        '<input id="secret_input" type="password" value="SecretValue"><button id="same">{Binding Unsafe}</button><span id="same">Duplicate</span><canvas></canvas>';
      document.body.append(host);
      const before = host.outerHTML;
      const captured = compiler.compileRenderedDocument(host);
      if (
        !captured.success ||
        captured.source.includes('SecretValue') ||
        !captured.source.includes('{}{Binding Unsafe}')
      )
        throw Error('Sensitive/literal native values');
      if (!captured.losses.some((item) => item.code === 'BROWSER_REPLACED_CONTENT'))
        throw Error('Missing replaced-content diagnostic');
      const names = captured.metadata.geometry.map((item) => item.targetName).filter(Boolean);
      if (names.length !== new Set(names).size) throw Error('Duplicate native names');
      if (host.outerHTML !== before) throw Error('Capture changed source');
      if (
        compiler.compileRenderedDocument(host, { maxNodes: 1 }).success ||
        compiler.compileRenderedDocument(host, { maxNodes: 0 }).success
      )
        throw Error('Capture bounds');
      if (
        !compiler
          .compileRenderedDocument(host, { includePasswordValues: true })
          .source.includes('SecretValue')
      )
        throw Error('Explicit password inclusion');
      host.remove();
      if (compiler.compileRenderedDocument(host).success) throw Error('Disconnected capture');
    });
    await page.waitForFunction(() => captures.length > 0);
    await page.locator('#entry').fill('Changed Ω');
    await page.locator('#check').uncheck();
    await page.locator('#choice').selectOption({ label: 'A' });
    await page.locator('#action').hover();
    await page.waitForFunction(() => captures.at(-1)?.source.includes('Changed Ω'));
    const hover = await page.evaluate(() => {
      const snapshot = compiler.compileRenderedDocument(document.getElementById('surface'));
      return {
        source: snapshot.source,
        color: getComputedStyle(document.getElementById('action')).backgroundColor,
      };
    });
    assert.equal(hover.color, 'rgb(10, 120, 180)');
    assert.match(hover.source, /IsChecked="false"/);
    assert.match(hover.source, /SelectedIndex="0"/);
    await page.setViewportSize({ width: 380, height: 700 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(
      () => captures.at(-1)?.metadata.browserCapture?.viewport.width === 380,
    );
    const narrow = await page.evaluate(() => {
      const result = observer.refresh();
      const before = document.documentElement.outerHTML;
      compiler.compileRenderedDocument(document.getElementById('surface'));
      if (before !== document.documentElement.outerHTML) throw Error('capture mutated source');
      observer.dispose();
      observer.dispose();
      window.disposedCount = captures.length;
      return {
        height: getComputedStyle(document.getElementById('container_child')).height,
        color: getComputedStyle(document.getElementById('conditional')).backgroundColor,
        root: result.metadata.browserCapture.root,
        result,
      };
    });
    assert.equal(narrow.height, '24px');
    assert.equal(narrow.color, 'rgb(90, 100, 110)');
    assert(narrow.root.height > first.height, 'responsive layout reflows');
    await page.locator('#entry').fill('After disposal');
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(
      await page.evaluate(() => captures.length),
      await page.evaluate(() => disposedCount),
    );
    assert.deepEqual(errors, []);
    console.log(
      `${entry}: media/supports/layers/imports/pseudos, intrinsic grid/container geometry, form state, observer disposal passed (${isolated ? 'isolated CSS' : 'HTTP external sheets'}).`,
    );
    // CI also uses these generated artifacts in the native qualification job.
    if (process.env.XAMORA_NATIVE_FIXTURES) {
      const output = resolve(root, process.env.XAMORA_NATIVE_FIXTURES);
      await mkdir(output, { recursive: true });
      await writeFile(
        resolve(output, 'browser-narrow.json'),
        JSON.stringify(narrow.result, null, 2),
      );
    }
    await page.close();
  }
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
