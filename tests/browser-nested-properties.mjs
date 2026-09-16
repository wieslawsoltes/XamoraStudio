import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..');
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file, body;
    if (path.startsWith('/packed/')) {
      const name = path.slice(8) || 'index.html';
      if (!['index.html', 'lab.js'].includes(name)) throw Error('Unknown resource');
      file = name;
      body = await readFile(resolve(root, 'dist/examples/NestedPropertiesLab', name), 'utf8');
      body = body
        .replace(
          '../../controls/object-property-grid.js',
          '/packages/property-grid/dist/browser/index.js',
        )
        .replace(
          '../../controls/property-grid.css',
          '/packages/property-grid/dist/assets/property-grid.css',
        );
    } else {
      const base = path.startsWith('/packages/') ? root : resolve(root, 'dist');
      file = resolve(base, '.' + path + (path.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(base + sep)) throw Error('Outside root');
      body = await readFile(file);
    }
    res
      .writeHead(200, {
        'Content-Type':
          { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[extname(file)] ||
          'text/plain',
      })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser, page;
const errors = [],
  failed = [],
  requests = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(r.url());
  });
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  for (const path of ['/examples/NestedPropertiesLab/', '/packed/']) {
    requests.length = 0;
    await page.goto(`http://127.0.0.1:${server.address().port}${path}`);
    await page.waitForFunction(() => !!window.nestedPropertiesLab);
    const field = page.getByLabel('theme.spacing', { exact: true });
    await field.fill('12');
    await field.dispatchEvent('change');
    assert.equal(await page.evaluate(() => window.nestedPropertiesLab.value.theme.spacing), 12);
    await page.locator('#undo').click();
    assert.equal(await field.inputValue(), '8');
    await page.locator('#redo').click();
    assert.equal(await field.inputValue(), '12');
    await page.getByLabel('Filter nested properties', { exact: true }).fill('label');
    const label = page.getByLabel('items.[0].label', { exact: true });
    assert(await label.isVisible());
    assert.equal(await field.isVisible(), false);
    await label.fill('Renamed');
    await label.dispatchEvent('change');
    assert.equal(
      await page.evaluate(() => window.nestedPropertiesLab.value.items[0].label),
      'Renamed',
    );
    await page.getByLabel('Filter nested properties', { exact: true }).fill('');
    await page.getByLabel('Add property to items', { exact: true }).click();
    assert.equal(await page.evaluate(() => window.nestedPropertiesLab.value.items.length), 3);
    await page.getByLabel('Remove items.[2]', { exact: true }).click();
    assert.equal(await page.evaluate(() => window.nestedPropertiesLab.value.items.length), 2);
    if (path === '/packed/')
      assert(!requests.some((p) => /^\/(core|studio|controls|workspaces)\//.test(p)));
    await page.evaluate(() => window.nestedPropertiesLab.grid.dispose());
    assert.equal(await page.locator('#grid>*').count(), 0);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  console.log(
    'Nested-object source and packed controls: edits, undo, arrays, filtering and disposal passed.',
  );
} catch (error) {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await page
    ?.screenshot({ path: resolve(root, 'test-results/nested-properties.png') })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
