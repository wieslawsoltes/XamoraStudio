/** Exercise the committed lab via actual HTTP, including its external stylesheets. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (request, response) => {
  try {
    let file = resolve(
      root,
      '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname),
    );
    if (!file.startsWith(root + sep)) throw Error('Outside root');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    response
      .writeHead(200, { 'Content-Type': types[extname(file)] || 'text/plain' })
      .end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser, page;
const watchdog = setTimeout(() => {
  process.exitCode = 1;
  void browser?.close();
  server.closeAllConnections();
}, 90000);
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--disable-dev-shm-usage'],
  });
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [],
    failed = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(r.url());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/examples/CompilerFidelityLab/`);
  await page.waitForFunction(() =>
    document.querySelector('#status').textContent.includes('900px viewport'),
  );
  const original = await page.locator('#output').inputValue();
  assert(!original.includes('demo-only'));
  await page
    .frameLocator('#source')
    .getByLabel('Text value', { exact: true })
    .fill('Edited live value');
  await page.waitForFunction(() =>
    document.querySelector('#output').value.includes('Edited live value'),
  );
  await page.locator('#viewport').selectOption('380');
  await page.waitForFunction(() =>
    document.querySelector('#status').textContent.includes('380px viewport'),
  );
  const phone = await page.locator('#output').inputValue();
  assert.notEqual(phone, original);
  await page.locator('#framework').selectOption('Avalonia');
  await page.waitForFunction(() =>
    document.querySelector('#output').value.includes('https://github.com/avaloniaui'),
  );
  await page.locator('#live').uncheck();
  const manual = await page.locator('#output').inputValue();
  await page.frameLocator('#source').getByLabel('Text value', { exact: true }).fill('Manual value');
  await page.waitForTimeout(80);
  assert.equal(await page.locator('#output').inputValue(), manual);
  await page.locator('#capture').click();
  await page.waitForFunction(() =>
    document.querySelector('#output').value.includes('Manual value'),
  );
  const download = page.waitForEvent('download');
  await page.locator('#download').click();
  assert.equal((await download).suggestedFilename(), 'CapturedView.axaml');
  await page.locator('#live').check();
  await page.evaluate(() =>
    dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
  );
  await page.evaluate(() =>
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await page
    .frameLocator('#source')
    .getByLabel('Text value', { exact: true })
    .fill('Restored page');
  await page.waitForFunction(() =>
    document.querySelector('#output').value.includes('Restored page'),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.locator('#capture').isVisible());
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  console.log(
    'Compiler Fidelity Lab: HTTP assets, viewport/target switching, input, downloads and page lifecycle passed.',
  );
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await page
    ?.screenshot({ path: 'test-results/compiler-fidelity-lab.png', timeout: 5000 })
    .catch(() => {});
  throw error;
} finally {
  clearTimeout(watchdog);
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
