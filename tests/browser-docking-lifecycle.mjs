/** Full Studio regression: file actions must not rotate unrelated tool tabs. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const server = createServer(async (req, res) => {
  try {
    let file = resolve(
      root,
      '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname),
    );
    if (file !== root && !file.startsWith(root + sep)) throw Error('Outside root');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    res
      .writeHead(200, {
        'Content-Type':
          { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[extname(file)] ||
          'text/plain',
      })
      .end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser, page;
const errors = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!window.xamora?.studio?.sync);
  const result = await page.evaluate(async () => {
    const s = window.xamora.studio,
      { control, model } = s.docking;
    const { locatePanel, validateDockLayout } = await import('./core/docking.js');
    const frames = () =>
      new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const selected = () => [
      locatePanel(model.state, 'toolkit').group.active,
      locatePanel(model.state, 'raw').group.active,
    ];
    control.activate('toolkit');
    control.activate('raw');
    await frames();
    const before = selected(),
      checks = [];
    const snapshot = () => {
      validateDockLayout(model.state, new Set(model.panels.keys()));
      checks.push(selected());
    };
    for (let i = 0; i < 8; i++) {
      s.importText(`<Grid><TextBlock Text="File ${i}"/></Grid>`, `Docking-${i}.xaml`);
      await frames();
      snapshot();
      control.hide('document:' + s.doc.id);
      await frames();
      snapshot();
    }
    // A previously queued Show focus must not reselect a tool after a file action.
    control.show('toolkit');
    const documentPanel = 'document:' + s.doc.id;
    control.activate(documentPanel);
    await frames();
    return { before, checks, active: model.state.activePanel, documentPanel };
  });
  for (const tabs of result.checks) assert.deepEqual(tabs, result.before);
  assert.equal(result.active, result.documentPanel);
  assert.deepEqual(errors, []);
  console.log('Docking lifecycle: 16 file open/close checks and deferred-focus regression passed.');
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await page?.screenshot({ path: 'test-results/docking-lifecycle.png' }).catch(() => {});
  console.error(errors);
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
