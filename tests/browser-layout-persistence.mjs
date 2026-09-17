/** A document-free saved docking layout must boot without silently resetting documents. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const server = createServer(async (request, response) => {
  try {
    let file = resolve(
      root,
      '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname),
    );
    if (file !== root && !file.startsWith(root + sep)) throw Error('Outside root');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    response
      .writeHead(200, {
        'Content-Type':
          { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[extname(file)] ||
          'text/plain',
      })
      .end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser, page;
const errors = [];
async function ready() {
  await page.waitForFunction(
    () =>
      !!window.xamora?.studio.layoutPreferences || !!document.getElementById('recover-workspace'),
  );
  assert.equal(
    await page.locator('#recover-workspace').count(),
    0,
    'Saved empty layout failed to boot: ' + errors.join('\n'),
  );
}
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', async (message) => {
    if (message.type() !== 'error') return;
    for (const arg of message.args())
      errors.push(
        await arg.evaluate((value) => value?.stack || String(value)).catch(() => message.text()),
      );
  });
  const response = await page.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(response?.status(), 200, 'The test server must serve the Studio entry point');
  await ready();
  const before = await page.evaluate(() => {
    const s = window.xamora.studio;
    for (const panel of s.docking.model.panels.values())
      if (panel.kind === 'document') s.docking.control.hide(panel.id);
    return {
      layout: s.docking.model.serialize(),
      documents: JSON.stringify(s.stores.map((store) => store.document)),
      source: s.editor.input.value,
    };
  });
  await page.reload();
  await ready();
  const after = await page.evaluate(() => {
    const s = window.xamora.studio;
    return {
      layout: s.docking.model.serialize(),
      documents: JSON.stringify(s.stores.map((store) => store.document)),
      source: s.editor.input.value,
    };
  });
  assert.deepEqual(after, before, 'Reload must preserve empty docking wells, documents and source');
  assert(await page.getByLabel('Empty document panel', { exact: true }).first().isVisible());
  assert.deepEqual(errors, []);
  console.log('Saved empty docking layout boots without resetting layout, documents or source.');
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/layout-persistence-error.txt',
    [error.stack, ...errors].join('\n\n'),
  );
  await page
    ?.screenshot({ path: 'test-results/layout-persistence.png', timeout: 10000 })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
