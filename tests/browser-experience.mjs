/** Full Studio UX regression and visual review at desktop and touch/narrow viewports. */
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
await mkdir('test-results/ux', { recursive: true });
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  context.on('page', (p) => {
    p.on('pageerror', (error) => errors.push(error.message));
    p.on('response', (response) => {
      if (response.status() >= 400) failures.push(response.url());
    });
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => !!window.xamora?.studio.experience);
  assert.equal(
    await page.evaluate(() => window.xamora.docking.control.visible.has('code-intelligence')),
    false,
  );
  const baseline = await page.evaluate(() => JSON.stringify(window.xamora.getDocument()));
  const inspector = page.locator('[data-inspector-host="design"]');
  assert.equal(await inspector.locator('.ux-inspector-disclosure').count(), 2);
  assert.equal(await inspector.locator('.ux-inspector-disclosure[open]').count(), 0);
  const identity = await inspector.locator('#inspector-name').boundingBox();
  assert(
    identity.y < 430,
    'Selected layer identity and basic properties must precede long action lists',
  );
  await page.screenshot({ path: 'test-results/ux/01-desktop.png' });
  await inspector.locator('[data-inspector-section="appearance"] > summary').click();
  assert(await inspector.locator('[data-action="motion-brush"]').isVisible());
  await inspector.locator('[data-inspector-section="appearance"] > summary').click();
  await page.locator('.ux-command-trigger').click();
  const search = page.locator('#ide-command-search');
  await search.fill('density comfortable');
  assert.equal(await page.locator('[role="option"]').count(), 1);
  await search.press('Enter');
  await page.waitForFunction(() => window.xamora.studio.density.value === 'comfortable');
  assert.equal(await page.locator('.ux-command-dialog').count(), 0);
  assert.equal(await page.evaluate(() => JSON.stringify(window.xamora.getDocument())), baseline);
  await page.locator('.ux-command-trigger').click();
  await page.screenshot({ path: 'test-results/ux/02-palette.png' });
  const active = await search.getAttribute('aria-activedescendant');
  await search.press('ArrowDown');
  assert.notEqual(await search.getAttribute('aria-activedescendant'), active);
  assert(await search.evaluate((el) => document.activeElement === el));
  await search.fill('no-such-command-987654321');
  assert(await page.locator('.ux-palette-empty').isVisible());
  assert.equal(await search.getAttribute('aria-activedescendant'), null);
  await page.locator('[data-command-clear]').click();
  await page.locator('[data-command-scope="windows"]').click();
  assert((await page.locator('[data-ide-command^="window:"]').count()) > 0);
  assert.equal(
    await page.locator('[data-ide-command]:not([data-ide-command^="window:"])').count(),
    0,
  );
  await search.press('Escape');
  // Menu Tab must return native focus navigation to a connected page control.
  await page.keyboard.press('F10');
  await page.keyboard.press('ArrowDown');
  await page.locator('.ide-menu-popup').waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.ide-menu-popup').count(), 0);
  assert(
    await page.evaluate(
      () => document.activeElement.isConnected && document.activeElement !== document.body,
    ),
  );
  await page.locator('[data-tool="hand"]').click();
  await page.waitForFunction(
    () => document.querySelector('[data-tool="hand"]').getAttribute('aria-pressed') === 'true',
  );
  await page.locator('[data-tool="select"]').click();
  await page.evaluate(() => window.xamora.studio.setTool('hand'));
  assert.equal(await page.locator('[data-tool="hand"]').getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => window.xamora.studio.setTool('select'));

  await page.evaluate(() => {
    if (!window.xamora.studio.dark) window.xamora.studio.command('theme');
  });
  assert(
    await page
      .locator('.toolbar')
      .evaluate(
        (el) =>
          getComputedStyle(el).color ===
          getComputedStyle(el.querySelector('[data-tool="hand"]')).color,
      ),
  );
  await page.screenshot({ path: 'test-results/ux/03-dark.png' });
  await page.locator('.ux-guide-trigger').click();
  await page.locator('.ux-guide-dialog').waitFor();
  await page.screenshot({ path: 'test-results/ux/04-guide.png' });
  await page.locator('[data-guide-command="window:toolkit"]').click();
  await page.waitForFunction(() => window.xamora.docking.control.visible.has('toolkit'));
  // Popup source retains its input, buffer and selection while command search opens in the owner.
  await page.evaluate(() => window.xamora.docking.show('xaml'));
  await page.locator('[data-dock-panel="xaml"]').click({ button: 'right' });
  const pending = page.waitForEvent('popup');
  await page
    .locator('.dock-menu')
    .getByRole('menuitem', { name: 'Open tab in browser window', exact: true })
    .click();
  const popup = await pending;
  const input = popup.locator('.code-input');
  await input.waitFor({ state: 'visible' });
  const value = await input.inputValue();
  await input.focus();
  await input.evaluate((el) => el.setSelectionRange(3, 9, 'backward'));
  await input.press('Control+k');
  await search.waitFor({ state: 'visible' });
  await search.fill('interface density');
  await search.press('Escape');
  assert.equal(await input.inputValue(), value);
  assert.deepEqual(await input.evaluate((el) => [el.selectionStart, el.selectionEnd]), [3, 9]);
  await Promise.all([popup.waitForEvent('close'), popup.locator('[data-browser-return]').click()]);
  // Notification channels may overlap; the newest message owns its lifetime.
  await page.evaluate(async () => {
    const { createNotifier } = await import('./studio/ui.js');
    createNotifier(50)('Old message');
    createNotifier(5000)('Export completed. Keep a project backup.');
  });
  await page.locator('.toast-dismiss').focus();
  assert(await page.locator('#toast.show').isVisible());
  await page.locator('.toast-dismiss').click();
  assert.equal(await page.locator('#toast.show').count(), 0);
  assert.equal(await page.evaluate(() => JSON.stringify(window.xamora.getDocument())), baseline);

  // Restore extension-panel choices after all workspaces finish registering, not from a partial registry.
  const savedRoot = await page.evaluate(() => {
    const { model, control } = window.xamora.docking;
    control.show('code-intelligence');
    return JSON.stringify(model.state.root);
  });
  await page.reload();
  await page.waitForFunction(() => !!window.xamora?.studio.experience);
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.xamora.docking.model.state.root)),
    savedRoot,
  );
  assert(await page.evaluate(() => window.xamora.docking.control.visible.has('code-intelligence')));
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  mobile.on('page', (p) => p.on('pageerror', (error) => errors.push(error.message)));
  const small = await mobile.newPage();
  await small.goto(base);
  await small.waitForFunction(() => !!window.xamora?.studio.experience);
  await small.screenshot({ path: 'test-results/ux/05-touch.png' });
  assert(await small.evaluate(() => matchMedia('(pointer: coarse)').matches));
  const toolTarget = await small.locator('[data-tool="hand"]').boundingBox();
  assert(toolTarget.height >= 44, 'Touch density must override the persisted density selectors');
  const searchButton = await small.locator('.ux-command-trigger').boundingBox();
  assert(
    searchButton.x >= 0 && searchButton.x + searchButton.width <= 390,
    'Primary search must be reachable without scrolling the header',
  );
  assert(await small.locator('.topbar').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await small.locator('.ux-command-trigger').click();
  await small.locator('#ide-command-search').fill('export');
  await small.screenshot({ path: 'test-results/ux/06-touch-palette.png' });
  const box = await small.locator('.ux-command-dialog').boundingBox();
  assert(box.x >= 0 && box.x + box.width <= 391);
  assert(await small.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const target = await small.locator('[data-command-scope="all"]').boundingBox();
  assert(target.height >= 44, 'Touch filter controls must retain their minimum target height');
  await small.locator('#close-modal').click();
  await small.locator('.ux-guide-trigger').click();
  await small.screenshot({ path: 'test-results/ux/07-touch-guide.png' });
  assert(await small.locator('[data-guide-command="new-html"]').isVisible());
  const count = await small.evaluate(() => window.xamora.studio.stores.length);
  await small.locator('[data-guide-command="new-html"]').click();
  await small.waitForFunction((count) => window.xamora.studio.stores.length === count + 1, count);
  assert.equal(await small.evaluate(() => window.xamora.studio.doc.framework), 'HTML');
  await mobile.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(
    'Studio UX: ranked search, keyboard/IME-safe interactions, command filters, guide actions, popup source context, notifications, touch sizing and unchanged authored documents passed.',
  );
} catch (error) {
  await writeFile('test-results/ux/error.txt', String(error.stack || error));
  for (const [i, p] of (context?.pages() || []).entries()) {
    await p.screenshot({ path: `test-results/ux/failure-${i}.png` }).catch(() => {});
    await writeFile(
      `test-results/ux/failure-${i}.html`,
      await p.content().catch(() => 'Unavailable'),
    );
  }
  console.error({ errors, failures });
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
