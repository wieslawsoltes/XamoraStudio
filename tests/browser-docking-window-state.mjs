/** Full Studio dialog/draft recovery and standalone split-root persistence in real popups. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/window-state/') {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/controls/docking.css"><main id="host" style="height:650px"></main><button id="open">Open split</button><button id="reopen">Reopen saved split</button>',
        );
      return;
    }
    let file = resolve(root, '.' + path);
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
const errors = [];
let browser, page;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  context.on('page', (p) => p.on('pageerror', (error) => errors.push(error.message)));
  page = await context.newPage();
  await page.goto(base + '/');
  await page.waitForFunction(() => !!window.xamora?.studio.sync);
  await page.evaluate(() => {
    const s = window.xamora.studio;
    const rows = Array.from({ length: 100 }, (_, i) => `  <TextBlock Text="Line ${i}"/>`).join(
      '\n',
    );
    s.importText(`<Grid Width="640" Height="480">\n${rows}\n</Grid>`, 'Popup-state.xaml');
    window.stateDocument = s.doc.id;
    window.xamora.docking.show('xaml');
  });
  await page.locator('[data-dock-panel="xaml"]').click({ button: 'right' });
  const pending = page.waitForEvent('popup');
  await page
    .locator('.dock-menu')
    .getByRole('menuitem', { name: 'Open tab in browser window', exact: true })
    .click();
  const source = await pending;
  const input = source.locator('.code-input');
  await input.waitFor({ state: 'visible' });
  await input.focus();
  const original = await input.inputValue();
  await source.evaluate(() => {
    const input = document.querySelector('.code-input');
    window.originalEditor = input;
    input.setSelectionRange(40, 57, 'backward');
    input.scrollTop = 200;
    window.originalPosition = {
      start: input.selectionStart,
      end: input.selectionEnd,
      direction: input.selectionDirection,
      scroll: input.scrollTop,
    };
  });
  await input.press('Control+k');
  await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !!document.activeElement?.closest('[role="dialog"]'));
  assert.equal(await source.locator('[role="dialog"]').count(), 0);
  await page.keyboard.press('Escape');
  await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
  await source.waitForFunction(() => document.activeElement === window.originalEditor);
  assert(
    await source.evaluate(() => {
      const input = window.originalEditor,
        saved = window.originalPosition;
      return (
        input === document.querySelector('.code-input') &&
        input.selectionStart === saved.start &&
        input.selectionEnd === saved.end &&
        input.selectionDirection === saved.direction &&
        input.scrollTop === saved.scroll
      );
    }),
    'Owner dialog dismissal preserves popup editor identity, selection, direction and scroll',
  );
  console.log(
    'Multiwindow state: real popup keyboard opens owner dialog and restores editor focus/state.',
  );

  const invalid = '<Grid><TextBlock';
  await input.fill(invalid);
  await page.waitForFunction(() => !window.xamora.studio.store.session.isValid);
  const guarded = await page.evaluate(() => {
    const s = window.xamora.studio,
      count = s.stores.length;
    s.importText('<Grid/>', 'Must-not-replace-draft.xaml');
    return (
      s.doc.id === window.stateDocument &&
      s.stores.length === count &&
      s.doc.root.children.length === 100
    );
  });
  assert(guarded, 'Invalid detached source blocks replacing the last valid document');
  await source.close();
  await page.waitForFunction(() => window.xamora.docking.windows().length === 0);
  const returned = page.locator('.code-input');
  assert.equal(await returned.inputValue(), invalid);
  assert(
    await page.evaluate(() => window.xamora.studio.store.session.source === '<Grid><TextBlock'),
  );
  await returned.press('Control+z');
  await page.waitForFunction(() => window.xamora.studio.store.session.isValid);
  assert.equal(await returned.inputValue(), original);
  await returned.press('Control+Shift+z');
  await page.waitForFunction(() => !window.xamora.studio.store.session.isValid);
  assert.equal(await returned.inputValue(), invalid);
  await page.locator('.source-restore').click();
  await page.waitForFunction(() => window.xamora.studio.store.session.isValid);
  assert.equal(await returned.inputValue(), original);
  console.log(
    'Multiwindow state: invalid draft survives popup closure, guarded import, shared undo/redo and explicit restore.',
  );

  await page.goto(base + '/window-state/');
  await page.evaluate(async () => {
    const { DockLayout, DockWorkspace, locatePanel } = await import('/controls/docking.js');
    const model = new DockLayout([
      { id: 'one', kind: 'document' },
      { id: 'two', kind: 'document' },
    ]);
    const control = new DockWorkspace(document.querySelector('#host'), model, {
      browserWindows: true,
    });
    for (const id of ['one', 'two']) {
      const host = document.createElement('div');
      const input = document.createElement('textarea');
      input.setAttribute('aria-label', id);
      input.value = 'Live ' + id;
      host.append(input);
      control.mount(id, host);
    }
    model.float('one');
    model.dock('two', locatePanel(model.state, 'one').group.id, 'right');
    const floating = locatePanel(model.state, 'one').floating;
    window.windowState = { model, control, id: floating.id, tree: JSON.stringify(floating.root) };
    document.querySelector('#open').onclick = () => control.openWindow(['one', 'two']);
    document.querySelector('#reopen').onclick = () => control.windows.reopen(window.windowState.id);
    control.render();
  });
  let next = page.waitForEvent('popup');
  await page.locator('#open').click();
  const split = await next;
  await split.getByRole('textbox', { name: 'one', exact: true }).waitFor({ state: 'visible' });
  assert(await split.getByRole('textbox', { name: 'two', exact: true }).isVisible());
  assert.equal(await split.evaluate(() => document.compatMode), 'CSS1Compat');
  await split.getByRole('textbox', { name: 'two', exact: true }).fill('Retained split draft');
  await page.evaluate(() => {
    window.windowState.saved = window.windowState.model.serialize();
  });
  await Promise.all([
    split.waitForEvent('close', { timeout: 10000 }),
    split.locator('[data-browser-return]').click(),
  ]);
  await page.waitForFunction(() => window.windowState.control.windows.list().length === 0);
  assert(
    await page.evaluate(
      () =>
        JSON.stringify(window.windowState.model.state.floating[0].root) === window.windowState.tree,
    ),
  );
  await page.evaluate(() => window.windowState.model.load(window.windowState.saved));
  assert.equal(await page.evaluate(() => window.windowState.control.windows.list().length), 0);
  assert.equal(await page.evaluate(() => window.windowState.control.windows.pending().length), 1);
  next = page.waitForEvent('popup');
  await page.locator('#reopen').click();
  const reopened = await next;
  await reopened.getByRole('textbox', { name: 'two', exact: true }).waitFor({ state: 'visible' });
  assert.equal(
    await reopened.getByRole('textbox', { name: 'two', exact: true }).inputValue(),
    'Retained split draft',
  );
  assert(
    await page.evaluate(
      () =>
        JSON.stringify(window.windowState.model.state.floating[0].root) === window.windowState.tree,
    ),
  );
  await Promise.all([
    reopened.waitForEvent('close', { timeout: 10000 }),
    page.evaluate(() => window.windowState.control.dispose()),
  ]);
  await page.waitForFunction(() => window.windowState.control.windows.list().length === 0);
  assert.equal(
    await page.getByRole('textbox', { name: 'two', exact: true }).inputValue(),
    'Retained split draft',
  );
  assert.deepEqual(errors, []);
  console.log(
    'Multiwindow state: complete split tree, live buffers, saved intent and explicit reopening passed.',
  );
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/window-state-error.txt', String(error.stack || error));
  for (const [i, p] of (page?.context().pages() || []).entries()) {
    await p.screenshot({ path: `test-results/window-state-${i}.png` }).catch(() => {});
    await writeFile(
      `test-results/window-state-${i}.html`,
      await p.content().catch(() => 'Page unavailable'),
    );
  }
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
