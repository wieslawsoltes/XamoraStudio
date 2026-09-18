/** Real Studio window discovery, modal focus, rejected drafts, popups and touch layout. */
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
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.on('page', (p) => {
    p.on('pageerror', (error) => errors.push(error.message));
    p.on('response', (response) => {
      if (response.status() >= 400) failures.push(response.url());
    });
  });
  const page = await context.newPage();
  assert.equal((await page.goto(base)).status(), 200);
  await page.waitForFunction(() => !!window.xamora?.studio.experience);
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.importText('<Grid Width="400" Height="300"/>', 'Navigation-A.xaml');
    s.store.transaction('Fixture folder', (d) => {
      d.metadata.solutionPath = 'Screens/Navigation-A.xaml';
    });
    window.navigationTarget = 'document:' + s.doc.id;
    s.importText('<Grid Width="400" Height="300"/>', 'Navigation-B.xaml');
    window.navigationDocs = JSON.stringify(s.stores.map((st) => st.document));
  });
  // The header -> layouts -> navigator route uses real controls.
  await page.locator('.dock-window-menu').click();
  await page.locator('#dock-open-navigator').click();
  const input = page.locator('#dock-window-search'),
    list = page.locator('#dock-window-list');
  await input.waitFor({ state: 'visible' });
  const searchBox = await page.locator('.ux-window-search').boundingBox();
  assert(
    searchBox.height >= 44 && searchBox.height < 65,
    'The search icon, input and Escape hint stay in one row',
  );
  assert.equal(await input.evaluate((el) => getComputedStyle(el).borderTopWidth), '0px');
  await input.fill('screens navigation');
  assert.equal(await list.locator('[data-show-dock]').count(), 1);
  assert.equal(
    await list.locator('[data-show-dock]').getAttribute('data-show-dock'),
    await page.evaluate(() => window.navigationTarget),
  );
  await input.fill('navigation');
  const before = await page.evaluate(() => window.xamora.docking.model.serialize());
  const first = await list.locator('[aria-selected="true"]').getAttribute('data-show-dock');
  await input.press('ArrowDown');
  const selected = await list.locator('[aria-selected="true"]').getAttribute('data-show-dock');
  assert.notEqual(selected, first);
  assert(await input.evaluate((el) => el === document.activeElement));
  assert.equal(await page.evaluate(() => window.xamora.docking.model.serialize()), before);
  await input.press('Enter');
  await page.waitForFunction(
    (id) => window.xamora.docking.model.state.activePanel === id,
    selected,
  );
  assert.equal(await page.locator('.ux-window-dialog').count(), 0);
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.xamora.studio.stores.map((st) => st.document))),
    await page.evaluate(() => window.navigationDocs),
  );

  // Closed tools update while the dialog stays open and reopen through the selected row.
  await page.evaluate(() => window.xamora.studio.docking.navigator());
  await input.fill('properties');
  await page.locator('[data-window-scope="closed"]').click();
  await page.evaluate(() => window.xamora.docking.close('properties'));
  const properties = list.locator('[data-show-dock="properties"]');
  await properties.waitFor({ state: 'visible' });
  await properties.click();
  await page.waitForFunction(() => window.xamora.docking.control.visible.has('properties'));

  // Replacing an owner dialog returns to the original input, not the removed dialog button.
  await page.evaluate(() => window.xamora.docking.show('xaml'));
  const source = page.locator('.code-input');
  await source.focus();
  await source.evaluate((el) => el.setSelectionRange(3, 9, 'backward'));
  await page.evaluate(() => window.xamora.studio.docking.layouts());
  await page.locator('#dock-open-navigator').click();
  await input.press('Escape');
  assert(await source.evaluate((el) => el === document.activeElement));
  assert.deepEqual(
    await source.evaluate((el) => [el.selectionStart, el.selectionEnd, el.selectionDirection]),
    [3, 9, 'backward'],
  );

  const original = await source.inputValue();
  const draft = await page.evaluate(() => ({
    id: window.xamora.studio.doc.id,
    name: window.xamora.studio.doc.name,
    root: JSON.stringify(window.xamora.studio.doc.root),
  }));
  const otherName = draft.name === 'Navigation-A.xaml' ? 'Navigation-B.xaml' : 'Navigation-A.xaml';
  await source.fill('<Grid><TextBlock');
  await page.waitForFunction(() => !window.xamora.studio.store.session.isValid);
  // Invalid drafts intentionally permit document switching; their canonical source stays intact.
  await page.evaluate(() => window.xamora.studio.docking.navigator());
  await input.fill(otherName);
  await input.press('Enter');
  await page.waitForFunction((name) => window.xamora.studio.doc.name === name, otherName);
  assert.equal(await page.locator('.ux-window-dialog').count(), 0);
  assert.deepEqual(
    await page.evaluate((id) => {
      const store = window.xamora.studio.stores.find((s) => s.document.id === id);
      return { source: store.session.source, root: JSON.stringify(store.document.root) };
    }, draft.id),
    { source: '<Grid><TextBlock', root: draft.root },
  );
  await page.evaluate(() => window.xamora.studio.docking.navigator());
  await input.fill(draft.name);
  await input.press('Enter');
  await page.waitForFunction((id) => window.xamora.studio.doc.id === id, draft.id);
  assert.equal(await source.inputValue(), '<Grid><TextBlock');
  assert.equal(await page.evaluate(() => window.xamora.studio.store.session.isValid), false);
  await source.fill(original);
  await page.waitForFunction(() => window.xamora.studio.store.session.isValid);

  // Dispatch the editor's real composition handlers; no activation guard is mocked or bypassed.
  await page.evaluate(() => window.xamora.studio.docking.navigator());
  await input.fill(otherName);
  const guardedLayout = await page.evaluate(() => {
    const s = window.xamora.studio;
    s.editor.input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    return s.docking.model.serialize();
  });
  await input.press('Enter');
  assert(await page.locator('.ux-window-dialog').isVisible());
  assert.match(
    await page.locator('.ux-window-dialog [role="alert"]').innerText(),
    /Finish composing/,
  );
  assert.equal(await input.inputValue(), otherName);
  assert.equal(await page.evaluate(() => window.xamora.docking.model.serialize()), guardedLayout);
  await page.evaluate(() =>
    window.xamora.studio.editor.input.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    ),
  );
  await input.press('Escape');
  assert.equal(await source.inputValue(), original);

  // Actual dependent-host location; closing the host updates the live filter immediately.
  await page.locator('[data-dock-panel="xaml"]').click({ button: 'right' });
  const pending = page.waitForEvent('popup');
  await page
    .locator('.dock-menu')
    .getByRole('menuitem', { name: 'Open tab in browser window', exact: true })
    .click();
  const popup = await pending;
  await popup.locator('.code-input').waitFor({ state: 'visible' });
  await page.evaluate(() => window.xamora.studio.docking.navigator());
  await page.locator('[data-window-scope="browser"]').click();
  assert.equal(await list.locator('[data-show-dock="xaml"]').count(), 1);
  assert.equal(await list.locator('.ux-window-location').innerText(), 'Browser window');
  await mkdir('test-results/ux', { recursive: true });
  await page.screenshot({ path: 'test-results/ux/10-window-navigator-browser.png' });
  await popup.close();
  await page.locator('.ux-window-empty').waitFor({ state: 'visible' });
  await page.locator('[data-window-clear]').click();
  await input.fill('no such window');
  assert.equal(await input.getAttribute('aria-activedescendant'), null);
  await page.locator('[data-window-clear]').click();
  await page.screenshot({ path: 'test-results/ux/11-window-navigator-desktop.png' });
  await input.press('Escape');
  await page.evaluate(() => window.xamora.studio.command('theme'));
  await page.evaluate(() => window.xamora.studio.docking.navigator());
  await page.screenshot({ path: 'test-results/ux/12-window-navigator-dark.png' });
  await input.press('Escape');

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  mobile.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  const small = await mobile.newPage();
  await small.goto(base);
  await small.waitForFunction(() => !!window.xamora?.studio.experience);
  await small.locator('.ux-command-trigger').click();
  await small.locator('#ide-command-search').fill('window navigator');
  await small.locator('#ide-command-search').press('Enter');
  await small.locator('.ux-window-dialog').waitFor({ state: 'visible' });
  await small.locator('[data-window-scope="tools"]').tap();
  const button = await small.locator('[data-window-scope="tools"]').boundingBox();
  assert(button.height >= 44);
  assert((await small.locator('.ux-window-search').boundingBox()).height < 65);
  const box = await small.locator('.ux-window-dialog').boundingBox();
  assert(box.x >= 0 && box.x + box.width <= 391);
  assert(await small.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert(
    await small.locator('#dock-window-search').evaluate((el) => el === document.activeElement),
  );
  await small.screenshot({ path: 'test-results/ux/13-window-navigator-touch.png' });
  await mobile.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(
    'Window navigator: paths, keyboard selection, live filters, retained invalid drafts, guarded composition, modal return focus, real browser hosts and 390px touch layout passed.',
  );
} catch (error) {
  await mkdir('test-results/ux', { recursive: true });
  await writeFile('test-results/ux/window-navigator-error.txt', String(error.stack || error));
  for (const [i, p] of (context?.pages() || []).entries()) {
    await p
      .screenshot({ path: `test-results/ux/window-navigator-failure-${i}.png` })
      .catch(() => {});
    await writeFile(
      `test-results/ux/window-navigator-failure-${i}.html`,
      await p.content().catch(() => 'Unavailable'),
    );
  }
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
