/** Three real popups: unrelated close/dragend isolation and selected-group transfer. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/isolation/') {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><main id="host" style="height:600px"></main>',
        );
      return;
    }
    const base = path.startsWith('/packages/') ? root : resolve(root, 'dist');
    let file = resolve(base, '.' + path);
    if (file !== base && !file.startsWith(base + sep)) throw Error('Outside root');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    response
      .writeHead(200, {
        'Content-Type':
          { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[extname(file)] ||
          'text/plain',
      })
      .end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser, context;
const errors = [],
  failures = [];
async function start(popup) {
  await popup
    .locator('.dock-transfer-grip')
    .first()
    .evaluate((grip) => {
      grip.dispatchEvent(
        new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer: new DataTransfer(),
        }),
      );
    });
}
async function drop(body, token) {
  await body.evaluate((body, token) => {
    const r = body.getBoundingClientRect(),
      dataTransfer = new DataTransfer();
    dataTransfer.setData('application/x-xamora-dock', token);
    const options = {
      bubbles: true,
      cancelable: true,
      clientX: r.x + r.width / 2,
      clientY: r.y + r.height / 2,
      dataTransfer,
    };
    body.dispatchEvent(new DragEvent('dragover', options));
    body.dispatchEvent(new DragEvent('drop', options));
  }, token);
}
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  for (const source of ['/controls/docking.js', '/packages/docking/dist/browser/index.js']) {
    context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    context.on('page', (page) => {
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 400) failures.push(response.url());
      });
    });
    const page = await context.newPage();
    await page.goto(base + '/isolation/');
    await page.evaluate(async (source) => {
      const { DockLayout, DockWorkspace, locatePanel } = await import(source);
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = source.startsWith('/packages/')
        ? '/packages/docking/dist/assets/docking.css'
        : '/controls/docking.css';
      const loaded = new Promise((resolve, reject) => {
        css.onload = resolve;
        css.onerror = reject;
      });
      document.head.append(css);
      await loaded;
      const model = new DockLayout(['one', 'two', 'three'].map((id) => ({ id, kind: 'document' })));
      const control = new DockWorkspace(document.querySelector('#host'), model, {
        browserWindows: true,
      });
      for (const id of model.panels.keys()) {
        const input = document.createElement('textarea');
        input.setAttribute('aria-label', id);
        input.value = 'Live ' + id;
        control.mount(id, input);
        const button = document.createElement('button');
        button.id = 'open-' + id;
        button.textContent = 'Open ' + id;
        button.onclick = () => control.openWindow(id);
        document.body.append(button);
      }
      control.render();
      window.isolation = { model, control, locatePanel };
    }, source);
    const popups = [];
    for (const id of ['one', 'two', 'three']) {
      const pending = page.waitForEvent('popup');
      await page.locator('#open-' + id).click();
      const popup = await pending;
      await popup.getByRole('textbox', { name: id, exact: true }).waitFor({ state: 'visible' });
      popups.push(popup);
    }
    const [a, b, c] = popups;
    await page.evaluate(() => window.isolation.control.focus('one'));
    assert(
      await a
        .getByRole('textbox', { name: 'one', exact: true })
        .evaluate((input) => input.ownerDocument.activeElement === input),
    );
    await a.getByRole('textbox', { name: 'one', exact: true }).fill('Preserved three-window draft');
    await start(a);
    const token = await page.evaluate(() => window.isolation.control.windows.transfer.token);
    await c.close();
    await page.waitForFunction(() => window.isolation.control.windows.list().length === 2);
    assert.equal(
      await page.evaluate(() => window.isolation.control.windows.transfer?.token),
      token,
    );
    await b
      .locator('.dock-transfer-grip')
      .first()
      .evaluate((grip) => grip.dispatchEvent(new DragEvent('dragend', { bubbles: true })));
    assert.equal(
      await page.evaluate(() => window.isolation.control.windows.transfer?.token),
      token,
    );
    await Promise.all([
      a.waitForEvent('close', { timeout: 10000 }),
      drop(b.locator('.dock-group-body'), token),
    ]);
    assert.equal(
      await b.getByRole('textbox', { name: 'one', exact: true }).inputValue(),
      'Preserved three-window draft',
    );
    // Select a non-first member, then focus another window before transferring the group.
    await page.evaluate(() => {
      const s = window.isolation;
      s.model.dock('one', s.locatePanel(s.model.state, 'two').group.id, 'center', 0);
    });
    await b.locator('[data-dock-panel="two"]').click();
    await page.evaluate(() => {
      const s = window.isolation;
      if (s.locatePanel(s.model.state, 'two').group.panels.indexOf('two') !== 1)
        throw Error('The selected transfer member must not be the first tab');
      s.control.activate('three');
      s.guardCalls = [];
      s.control.beforeActivate = (id) => {
        s.guardCalls.push(id);
        return true;
      };
    });
    await start(b);
    const groupToken = await page.evaluate(() => window.isolation.control.windows.transfer.token);
    await Promise.all([
      b.waitForEvent('close', { timeout: 10000 }),
      drop(page.locator('.dock-group-body'), groupToken),
    ]);
    const result = await page.evaluate(() => {
      const s = window.isolation;
      return {
        guard: s.guardCalls[0],
        active: s.locatePanel(s.model.state, 'two').group.active,
        windows: s.control.windows.list().length,
      };
    });
    assert.deepEqual(result, { guard: 'two', active: 'two', windows: 0 });
    await page.evaluate(() => window.isolation.control.focus('two'));
    assert(
      await page
        .getByRole('textbox', { name: 'two', exact: true })
        .evaluate((input) => input.ownerDocument.activeElement === input),
    );
    await page.evaluate(() => {
      const s = window.isolation;
      s.control.activate('one');
      s.control.dispose();
    });
    assert.equal(
      await page.getByRole('textbox', { name: 'one', exact: true }).inputValue(),
      'Preserved three-window draft',
    );
    console.log(
      `${source}: three-window isolation, actual close events, selected-group guards and root-editor focus passed.`,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/window-isolation-error.txt', String(error.stack || error));
  for (const [i, page] of (context?.pages() || []).entries()) {
    await page.screenshot({ path: `test-results/window-isolation-${i}.png` }).catch(() => {});
    await writeFile(
      `test-results/window-isolation-${i}.html`,
      await page.content().catch(() => 'Page unavailable'),
    );
  }
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
