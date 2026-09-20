/** Full Studio and standalone/built-package editor find/replace, including real popup windows. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..');
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/search-native/') {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/controls/code-editor.css"><main id="host" style="height:650px;width:700px"></main>',
        );
      return;
    }
    const base =
      path.startsWith('/packages/') || path.startsWith('/tests/') ? root : resolve(root, 'dist');
    let file = resolve(base, '.' + path);
    if (file !== base && !file.startsWith(base + sep)) throw Error('Outside root');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    response
      .writeHead(200, {
        'Content-Type':
          {
            '.js': 'text/javascript',
            '.mjs': 'text/javascript',
            '.css': 'text/css',
            '.html': 'text/html',
          }[extname(file)] || 'text/plain',
      })
      .end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser, context, page;
const errors = [],
  failures = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  context.on('page', (p) => {
    p.on('pageerror', (error) => errors.push(error.message));
    p.on('response', (r) => {
      if (r.status() >= 400) failures.push(r.url());
    });
  });
  page = await context.newPage();
  for (const source of [
    '/controls/code-editor.js',
    '/packages/code-editor/dist/browser/index.js',
  ]) {
    await page.goto(base + '/search-native/');
    await page.evaluate(async (source) => {
      const api = await import(source);
      const search = source.startsWith('/packages/')
        ? api
        : await import('/controls/text-search.js');
      const { runEditorSearchNativeCases } = await import('/tests/editor-search-native-cases.mjs');
      await runEditorSearchNativeCases({ ...api, ...search }, document.querySelector('#host'));
    }, source);
  }
  await page.goto(base + '/');
  await page.waitForFunction(() => !!window.xamora?.studio.sync);
  await page.evaluate(() => {
    const s = window.xamora.studio;
    window.searchOriginal =
      '\uFEFF<Grid xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width="600" Height="400">\r\n<Button x:Name="First" Content="Save"/>\n<Button x:Name="Second" Content="Save"/>\r<TextBlock Text="SAVED"/>\r\n</Grid>';
    s.importText(window.searchOriginal, 'Search.xaml');
    s.editor.input.setSelectionRange(0, 0);
    s.command('replace-code');
    window.searchRevision = s.store.revision;
    window.searchHistory = s.store.history.length;
  });
  const query = page.getByRole('textbox', { name: 'Find in XAML', exact: true });
  await query.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.activeElement?.matches('[data-find-query]'));
  await query.fill('Save');
  await page.getByRole('button', { name: 'Whole word', exact: true }).click();
  await page.getByRole('textbox', { name: 'Replace in XAML', exact: true }).fill('Proceed');
  assert.match(await page.locator('.editor-find-status').textContent(), /2 matches/);
  assert(await page.evaluate(() => window.xamora.studio.store.revision === window.searchRevision));
  await page.getByRole('button', { name: 'Replace all', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.xamora.getSource() ===
      window.searchOriginal.replaceAll('Content="Save"', 'Content="Proceed"'),
  );
  assert(
    await page.evaluate(
      () => window.xamora.studio.store.history.length === window.searchHistory + 1,
    ),
  );
  await page.evaluate(() => window.xamora.studio.command('undo'));
  await page.waitForFunction(() => window.xamora.getSource() === window.searchOriginal);
  await page.evaluate(() => window.xamora.studio.command('redo'));
  await page.waitForFunction(() => window.xamora.getSource().includes('Proceed'));
  await page.evaluate(() => {
    const e = window.xamora.studio.editor;
    const start = e.input.value.indexOf('Content="Proceed"') + 9;
    e.input.setSelectionRange(start, start + 7);
    e.find({ replace: true, seed: false });
  });
  await query.fill('Proceed');
  await page.getByRole('button', { name: 'In selection', exact: true }).click();
  await page.getByRole('textbox', { name: 'Replace in XAML', exact: true }).fill('Continue');
  await page.getByRole('button', { name: 'Replace all', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.xamora.getSource() ===
      window.searchOriginal
        .replace('Content="Save"', 'Content="Continue"')
        .replace('Content="Save"', 'Content="Proceed"'),
  );
  await page.evaluate(() => {
    window.searchHtml = '<main><button>Save</button><button>Save</button></main>';
    const s = window.xamora.studio;
    s.importText(window.searchHtml, 'Search.html');
    if (s.editor.search.scope !== null)
      throw Error('Document switch retained an old selection scope');
    s.docking.control.show('xaml');
  });
  await page.locator('[data-dock-panel="xaml"]').click({ button: 'right' });
  const pending = page.waitForEvent('popup');
  await page
    .locator('.dock-menu')
    .getByRole('menuitem', { name: 'Open tab in browser window', exact: true })
    .click();
  const popup = await pending;
  const input = popup.locator('.code-input');
  await input.waitFor({ state: 'visible' });
  await input.press('Control+h');
  const htmlQuery = popup.getByRole('textbox', { name: 'Find in HTML', exact: true });
  await htmlQuery.fill('Save');
  await popup.getByRole('textbox', { name: 'Replace in HTML', exact: true }).fill('Done');
  await popup.getByRole('button', { name: 'Replace all', exact: true }).click();
  await page.waitForFunction(
    () => window.xamora.getSource() === window.searchHtml.replaceAll('Save', 'Done'),
  );
  await page.waitForFunction(
    () =>
      window.xamora.studio.renderer.htmlRenderer?.frame.contentDocument?.querySelector('button')
        ?.textContent === 'Done',
  );
  await input.press('Control+z');
  await page.waitForFunction(() => window.xamora.getSource() === window.searchHtml);
  await input.press('Control+Shift+z');
  await page.waitForFunction(() => window.xamora.getSource().includes('Done'));
  await htmlQuery.fill('Done');
  await htmlQuery.press('Enter');
  assert(await htmlQuery.evaluate((n) => n.ownerDocument.activeElement === n));
  await htmlQuery.press('Escape');
  assert(await input.evaluate((n) => n.ownerDocument.activeElement === n));
  await input.press('F3');
  assert.equal(
    await input.evaluate((n) => n.value.slice(n.selectionStart, n.selectionEnd)),
    'Done',
  );
  // A synchronous designer cleanup callback must not apply old search offsets afterward.
  const guarded = await page.evaluate(() => {
    const s = window.xamora.studio,
      e = s.editor;
    e.search.query.value = 'Done';
    e.search.replacement.value = 'Wrong';
    e.find({ replace: true, seed: false });
    e.search.refresh();
    const originalCancel = s.direct.cancelGesture;
    const source = s.store.session.source;
    const independent = source.replace('Done', 'Independent change');
    const history = s.store.history.length;
    let accepted;
    try {
      s.direct.cancelGesture = () => s.store.session.updateSource(independent);
      accepted = e.search.replace(true);
    } finally {
      s.direct.cancelGesture = originalCancel;
    }
    return {
      accepted,
      source: s.store.session.source,
      independent,
      historyDelta: s.store.history.length - history,
    };
  });
  assert.equal(guarded.accepted, false);
  assert.equal(guarded.source, guarded.independent);
  assert.equal(guarded.historyDelta, 1);
  await input.press('Control+z');
  await page.waitForFunction(
    () => window.xamora.getSource() === window.searchHtml.replaceAll('Save', 'Done'),
  );
  await mkdir(resolve(root, 'test-results/ux'), { recursive: true });
  await popup.screenshot({ path: resolve(root, 'test-results/ux/20-editor-search-popup.png') });
  await Promise.all([
    popup.waitForEvent('close', { timeout: 10000 }),
    popup.locator('[data-browser-return]').click(),
  ]);
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.command('replace-code');
    s.editor.search.query.value = 'Done';
    s.editor.search.refresh();
  });
  await page.screenshot({ path: resolve(root, 'test-results/ux/21-editor-find-replace.png') });
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(
    'Editor search: source/package virtual highlighting, atomic canonical mixed-newline replacements, exact Undo/Redo, selection scope and actual popup HTML editing passed.',
  );
} catch (error) {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await writeFile(
    resolve(root, 'test-results/editor-search-error.txt'),
    String(error.stack || error),
  );
  for (const [i, p] of (context?.pages() || []).entries()) {
    await p
      .screenshot({ path: resolve(root, `test-results/editor-search-${i}.png`) })
      .catch(() => {});
    await writeFile(
      resolve(root, `test-results/editor-search-${i}.html`),
      await p.content().catch(() => ''),
    );
  }
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
