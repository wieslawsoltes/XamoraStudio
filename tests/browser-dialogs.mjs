/** Source/packed modal controls plus real keyboard, focus and async ownership checks. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/packed/') {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/packages/dialogs/dist/assets/dialog-host.css"><button id="previous">Previous</button><div id="host"></div>',
        );
      return;
    }
    const base = path.startsWith('/packages/') ? root : resolve(root, 'dist');
    const file = resolve(base, '.' + path + (path.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(base + sep)) throw Error('Outside server root');
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
const errors = [],
  failed = [],
  requests = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(response.url());
  });
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url + '/examples/DialogLab/');
  await page.locator('#open').click();
  await page.getByLabel('Profile name').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[role="alert"]')?.textContent.includes('required'),
  );
  await page.getByLabel('Profile name').fill('Grace');
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.getByRole('dialog', { name: 'Independent dialog' }).waitFor();
  assert.equal(await page.locator('.modal').count(), 2);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.modal').count(), 1);
  assert.equal(await page.getByLabel('Profile name').inputValue(), 'Grace');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => !window.dialogLab.dialog.isOpen);
  assert.equal(await page.locator('#result').textContent(), 'Saved profile: Grace');
  assert.equal(await page.locator('main #name').inputValue(), 'Grace');
  assert.equal(
    await page.locator('#open').evaluate((node) => document.activeElement === node),
    true,
  );
  assert(!requests.some((path) => path.startsWith('/core/') || path.startsWith('/studio/')));

  requests.length = 0;
  await page.setViewportSize({ width: 390, height: 650 });
  await page.goto(url + '/packed/');
  const layout = await page.evaluate(async () => {
    const { DialogHost } = await import('/packages/dialogs/dist/browser/index.js');
    const previous = document.querySelector('#previous');
    previous.focus();
    const host = new DialogHost(document.querySelector('#host'));
    window.packedDialog = host;
    const dialog = host.open({
      title: 'Packed dialog',
      content: 'Standalone CSS and no Studio imports.',
      actions: [
        {
          label: 'Reject later',
          run: () =>
            new Promise((_, reject) => {
              window.rejectPending = reject;
            }),
        },
      ],
    });
    host.focus();
    const rect = dialog.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      inert: previous.hasAttribute('inert'),
    };
  });
  assert(
    layout.width > 200 &&
      layout.x >= 0 &&
      layout.right <= 390 &&
      layout.y >= 0 &&
      layout.bottom <= 650,
  );
  assert(layout.inert);
  await page.getByRole('button', { name: 'Reject later' }).focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page
      .getByRole('button', { name: 'Close dialog' })
      .evaluate((node) => document.activeElement === node),
    true,
  );
  const late = await page.evaluate(async () => {
    const host = window.packedDialog;
    const pending = host.element.querySelector('[data-modal-action]').onclick();
    host.open({ title: 'Replacement', content: 'Must survive' });
    window.rejectPending(Error('Obsolete error'));
    await pending;
    return {
      title: host.element.getAttribute('aria-label'),
      error: host.element.querySelector('[role="alert"]').textContent,
    };
  });
  assert.deepEqual(late, { title: 'Replacement', error: '' });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[role="dialog"]').count(), 0);
  assert.equal(
    await page
      .locator('#previous')
      .evaluate((node) => document.activeElement === node && !node.hasAttribute('inert')),
    true,
  );
  await page.evaluate(() => window.packedDialog.dispose());
  assert(
    !requests.some(
      (path) =>
        path.startsWith('/core/') || path.startsWith('/studio/') || path.startsWith('/controls/'),
    ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  console.log(
    'Standalone source and packed dialogs passed: live content, validation, nested hosts, keyboard/focus, inert restoration, compact CSS and stale async rejection.',
  );
} catch (error) {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await page
    ?.screenshot({ path: resolve(root, 'test-results/dialogs.png'), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
