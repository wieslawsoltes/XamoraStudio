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
    if (pathname === '/packed-properties/') {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/packages/property-grid/dist/assets/property-grid.css"><main id="host" style="width:400px"></main>`,
        );
      return;
    }
    if (pathname === '/packed-editor/') {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          `<!doctype html><link rel="icon" href="data:,"><link rel="stylesheet" href="/packages/code-editor/dist/assets/code-editor.css"><main id="host" style="height:400px"></main>`,
        );
      return;
    }
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

  await page.goto(base + '/examples/EditorLab/');
  await page.waitForFunction(() => !!window.editorLab);
  await page.getByLabel('JSON code editor').fill('{"value":42}');
  await page.locator('#format').click();
  assert.match(await page.getByLabel('JSON code editor').inputValue(), /\n  "value": 42/);
  await page.locator('#apply').click();
  assert.match(await page.locator('#result').textContent(), /Applied/);
  await page.locator('#readonly').check();
  assert(await page.getByLabel('JSON code editor').evaluate((node) => node.readOnly));

  await page.goto(base + '/examples/PropertyGridLab/');
  await page.waitForFunction(() => !!window.propertyGridLab);
  await page.getByLabel('Width', { exact: true }).fill('480');
  await page.getByLabel('Width', { exact: true }).press('Tab');
  assert.equal(await page.evaluate(() => window.propertyGridLab.model.Width), 480);
  await page.getByLabel('Enabled', { exact: true }).uncheck();
  assert.equal(await page.evaluate(() => window.propertyGridLab.model.Enabled), false);
  await page.getByLabel('Theme', { exact: true }).selectOption('o1');
  assert.equal(await page.evaluate(() => window.propertyGridLab.model.Theme), 'dark');
  await page.getByLabel('Width', { exact: true }).fill('1500');
  await page.getByLabel('Width', { exact: true }).press('Tab');
  assert.equal(await page.getByLabel('Width', { exact: true }).inputValue(), '480');
  assert.match(await page.getByRole('alert').textContent(), /limits Width/);
  await page.getByRole('button', { name: 'Reset Width', exact: true }).click();
  assert.equal(await page.evaluate(() => window.propertyGridLab.model.Width), 320);
  await page.getByLabel('Filter properties').fill('Appearance');
  assert.equal(await page.locator('.prop-field:visible').count(), 2);
  assert(await page.getByLabel('Theme', { exact: true }).isVisible());

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
  await page.goto(base + '/packed-editor/');
  const editorResult = await page.evaluate(async () => {
    const { CodeEditor } = await import('/packages/code-editor/dist/browser/index.js');
    const host = document.querySelector('#host');
    const editor = new CodeEditor(host);
    editor.setValue('<not-a-tag>');
    const visible = editor.input.getBoundingClientRect().height > 100;
    const escaped = editor.highlight.querySelector('not-a-tag') === null;
    editor.input.setSelectionRange(4, 4);
    editor.setValue('X<not-a-tag>', { force: true });
    const caret = editor.input.selectionStart;
    editor.dispose();
    return { visible, escaped, caret, cleared: host.children.length === 0 };
  });
  assert.deepEqual(editorResult, { visible: true, escaped: true, caret: 5, cleared: true });
  assert(!requests.some((path) => path.startsWith('/core/') || path.startsWith('/studio/')));
  await page.goto(base + '/packed-properties/');
  const propertyResult = await page.evaluate(async () => {
    const { PropertyGrid } = await import('/packages/property-grid/dist/browser/index.js');
    const host = document.querySelector('#host');
    const changes = [];
    const grid = new PropertyGrid(host, {
      properties: [{ name: 'Count', type: 'number', value: 5, defaultValue: 1 }],
      onChange(change) {
        changes.push({ value: change.value, reset: change.reset });
      },
    });
    const input = host.querySelector('[data-prop="Count"]');
    const visible = input.getBoundingClientRect().width > 50;
    input.value = '42';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const value = grid.getValue('Count');
    grid.reset('Count');
    grid.dispose();
    return { visible, value, changes, cleared: host.children.length === 0 };
  });
  assert.deepEqual(propertyResult, {
    visible: true,
    value: 42,
    changes: [
      { value: 42, reset: false },
      { value: 1, reset: true },
    ],
    cleared: true,
  });
  assert(!requests.some((path) => path.startsWith('/core/') || path.startsWith('/studio/')));
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  console.log(
    'Standalone docking, code editor and property grid examples and isolated package bundles passed.',
  );
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
