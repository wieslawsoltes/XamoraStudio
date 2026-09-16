/** Real source and packaged document-aware components, using a host that never imports Studio. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..');
const bundle = "'/packages/xamora/dist/browser/index.js'";
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file, body;
    if (path.startsWith('/packed/')) {
      const name = path.slice('/packed/'.length) || 'index.html';
      if (!['index.html', 'lab.js', 'host.js', 'lab.css'].includes(name))
        throw Error('Unknown resource');
      body = await readFile(resolve(root, 'dist/examples/WorkspaceLab', name), 'utf8');
      if (name.endsWith('.js'))
        body = body.replace(
          /['"]\.\.\/\.\.\/(?:core|controls|workspaces)\/[^'"]+\.js['"]/g,
          bundle,
        );
      if (name === 'index.html')
        body = body
          .replace(/\.\.\/\.\.\/workspaces\/([^"/]+)\.css/g, '/packages/$1/dist/assets/$1.css')
          .replace(
            '../../controls/dialog-host.css',
            '/packages/dialogs/dist/assets/dialog-host.css',
          )
          .replace(
            '../../controls/code-editor.css',
            '/packages/code-editor/dist/assets/code-editor.css',
          )
          .replace(
            '../../controls/property-grid.css',
            '/packages/property-grid/dist/assets/property-grid.css',
          );
      file = name;
    } else {
      const base = path.startsWith('/packages/') ? root : resolve(root, 'dist');
      file = resolve(base, '.' + path + (path.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(base + sep)) throw Error('Outside root');
      body = await readFile(file);
    }
    res
      .writeHead(200, {
        'Content-Type':
          { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[extname(file)] ||
          'text/plain',
      })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
let browser, page;
const errors = [],
  failed = [],
  requests = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(r.url());
  });
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  for (const path of ['/examples/WorkspaceLab/', '/packed/']) {
    requests.length = 0;
    await page.goto(url + path);
    await page.waitForFunction(() => !!window.workspaceLab);
    await page.locator('[data-lab="new-story"]').click();
    await page.waitForFunction(() => !!window.workspaceLab.host.blend.animation.story);
    assert(await page.locator('#animation-panel').isVisible());
    await page.locator('[data-lab="resource"]').click();
    assert(
      await page.evaluate(() =>
        window.workspaceLab.host.resources.entries().some((e) => e.node.type === 'SolidColorBrush'),
      ),
    );
    await page.locator('[data-lab="data"]').click();
    assert(await page.getByRole('dialog', { name: 'Design data' }).isVisible());
    await page.keyboard.press('Escape');
    await page.locator('[data-lab="states"]').click();
    assert.equal(await page.locator('[role="dialog"]').count(), 1);
    await page.keyboard.press('Escape');
    const before = await page.evaluate(() => window.workspaceLab.host.store.session.source);
    const width = page.locator('[data-inspector-host="design"] input[data-prop="Width"]').first();
    await width.fill('175');
    await width.dispatchEvent('change');
    assert.equal(
      await page.evaluate(() => window.workspaceLab.host.selected[0].props.Width),
      '175',
    );
    await page.locator('[data-lab="undo"]').click();
    assert.equal(await page.evaluate(() => window.workspaceLab.host.store.session.source), before);
    if (path === '/packed/')
      assert(
        !requests.some(
          (p) =>
            p.startsWith('/core/') ||
            p.startsWith('/studio/') ||
            p.startsWith('/workspaces/') ||
            p.startsWith('/controls/'),
        ),
      );
    await page.evaluate(() => window.workspaceLab.dispose());
    assert.equal(await page.locator('#host>*').count(), 0);
  }
  assert.deepEqual(failed, []);
  assert.deepEqual(errors, []);
  console.log(
    'Source and package-only workspace composition, authorship, undo and disposal passed.',
  );
} catch (error) {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await page
    ?.screenshot({ path: resolve(root, 'test-results/workspace-components.png'), fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
