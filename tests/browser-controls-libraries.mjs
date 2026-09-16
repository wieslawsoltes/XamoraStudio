/** Source and packed-library controls run independently of the Studio application. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/packed/') {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/packages/docking/dist/assets/docking.css"><main id="host" style="height:400px"></main>`,
        );
      return;
    }
    const base = pathname.startsWith('/packages/') ? root : resolve(root, 'dist');
    let file = resolve(base, '.' + pathname);
    if (!file.startsWith(base + sep)) throw Error('Outside server root');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    response
      .writeHead(200, {
        'Content-Type': mime[extname(file)] || 'text/plain',
        'Cache-Control': 'no-store',
      })
      .end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser, page;
const errors = [],
  failed = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(response.url());
  });
  await page.goto(base + '/examples/ControlsLab/');
  await page.waitForFunction(() => !!window.controlsLab);
  await page.getByLabel('Example text').fill('Live content survives layout changes');
  await page.locator('#float').click();
  assert.equal(await page.locator('.dock-floating').count(), 1);
  assert.equal(
    await page.getByLabel('Example text').inputValue(),
    'Live content survives layout changes',
  );
  await page.locator('#dock').click();
  assert.equal(await page.locator('.dock-floating').count(), 0);
  await page.locator('#save').click();
  await page.locator('#float').click();
  await page.locator('#restore').click();
  assert.equal(await page.locator('.dock-floating').count(), 0);
  assert.equal(
    await page.getByLabel('Example text').inputValue(),
    'Live content survives layout changes',
  );

  const requests = [];
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(base + '/packed/');
  const result = await page.evaluate(async () => {
    const api = await import('/packages/docking/dist/browser/index.js');
    const model = new api.DockLayout([{ id: 'doc', kind: 'document' }]);
    const host = document.querySelector('#host');
    const control = new api.DockWorkspace(host, model);
    const input = document.createElement('textarea');
    input.value = 'Packed docking';
    control.mount('doc', input);
    control.render();
    const height = input.parentElement.getBoundingClientRect().height;
    model.float('doc', { x: 10, y: 20, width: 350, height: 220 });
    const retained = control.contents.get('doc') === input && input.value === 'Packed docking';
    control.dispose();
    return { retained, height, returned: input.parentElement === host };
  });
  assert(result.retained && result.returned);
  assert(result.height > 100, 'packaged CSS lays out the control without Studio CSS');
  assert(!requests.some((path) => path.startsWith('/core/') || path.startsWith('/studio/')));
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  console.log('Standalone docking example and self-contained package browser bundle passed.');
} catch (error) {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await page
    ?.screenshot({ path: resolve(root, 'test-results/controls-libraries.png'), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
