/** Full Studio outline, imported CRLF editing, real popup navigation and standalone packages. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..'),
  imports = {};
for (const name of await readdir(resolve(root, 'packages'))) {
  const p = JSON.parse(await readFile(resolve(root, 'packages', name, 'package.json'), 'utf8'));
  for (const [key, v] of Object.entries(p.exports)) {
    const target = v.import?.default;
    if (typeof target === 'string' && target.endsWith('.js'))
      imports[p.name + (key === '.' ? '' : key.slice(1))] = `/packages/${name}/${target.slice(2)}`;
  }
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'),
      path = decodeURIComponent(url.pathname);
    if (path === '/outline-check/') {
      res
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="${url.searchParams.has('packed') ? '/packages/control-primitives/dist/assets/outline-tree.css' : '/controls/outline-tree.css'}"><script type="importmap">${JSON.stringify({ imports })}</script><main id="host" style="height:300px;width:600px"></main>`,
        );
      return;
    }
    const base = /^\/(packages|tests)\//.test(path) ? root : resolve(root, 'dist');
    let file = resolve(base, '.' + path);
    if (file !== base && !file.startsWith(base + sep)) throw Error('Outside root');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    res
      .writeHead(200, {
        'Content-Type':
          {
            '.js': 'text/javascript',
            '.mjs': 'text/javascript',
            '.html': 'text/html',
            '.css': 'text/css',
          }[extname(file)] || 'text/plain',
      })
      .end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser, page;
const errors = [],
  failures = [];
async function popupFor(id) {
  await page.evaluate((id) => window.xamora.docking.control.activate(id, { focus: false }), id);
  await page.locator(`[data-dock-panel="${id}"]`).click({ button: 'right' });
  const next = page.waitForEvent('popup');
  await page
    .locator('.dock-menu')
    .getByRole('menuitem', { name: 'Open tab in browser window', exact: true })
    .click();
  const popup = await next;
  await popup.locator('[data-browser-return]').waitFor();
  return popup;
}
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  context.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('response', (r) => {
      if (r.status() >= 400) failures.push(r.url());
    });
  });
  page = await context.newPage();
  for (const packed of [false, true]) {
    await page.goto(base + '/outline-check/' + (packed ? '?packed' : ''));
    const result = await page.evaluate(async (packed) => {
      const base = packed ? '@wieslawsoltes/xamora-markup/' : '/core/';
      const extension = packed ? '' : '.js';
      const api = Object.assign(
        {},
        ...(await Promise.all([
          import(base + 'markup-structure' + extension),
          import(base + 'source-text-coordinates' + extension),
          import(base + 'document-session' + extension),
          import(base + 'html' + extension),
          import(packed ? '@wieslawsoltes/xamora-model/model' : '/core/model.js'),
          import(
            packed
              ? '@wieslawsoltes/xamora-control-primitives/outline-tree'
              : '/controls/outline-tree.js'
          ),
        ])),
      );
      const { runOutlineNativeCases } = await import('/tests/outline-native-cases.mjs');
      return runOutlineNativeCases(api, document.querySelector('#host'));
    }, packed);
    assert.equal(result.virtualItems, 10001);
  }
  await page.goto(base + '/');
  await page.waitForFunction(() => !!window.xamora?.outline);
  assert(
    await page.evaluate(() =>
      window.xamora.docking.model.state.hidden.includes('document-outline'),
    ),
  );
  const source =
    '\uFEFF<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width="640" Height="480">\r\n  <StackPanel>\r\n    <TextBlock><TextBlock.Inlines><Bold><Run Text="Outline review"/></Bold></TextBlock.Inlines></TextBlock>\r\n    <Button x:Name="SaveButton" Content="Save"/>\r\n  </StackPanel>\r\n</Grid>\r\n';
  await page.evaluate((source) => {
    const s = window.xamora.studio;
    s.importText(source, 'Outline.xaml');
    window.outlineOriginal = source;
    window.outlineDocId = s.doc.id;
    s.docking.control.activate('xaml', { focus: false });
    const input = s.editor.input;
    input.focus();
    const start = input.value.indexOf('Button x:Name');
    input.setSelectionRange(start, start + 6);
    s.editor.cursor(true);
  }, source);
  const input = page.locator('.code-input');
  assert.equal(await page.evaluate(() => window.xamora.studio.store.session.source), source);
  await input.press('Control+Alt+o');
  const filter = page.getByRole('textbox', { name: 'Filter document outline', exact: true });
  await filter.waitFor({ state: 'visible' });
  assert(await filter.evaluate((el) => el === document.activeElement));
  assert.equal(await page.locator('[role="dialog"]').count(), 0);
  await filter.fill('savebutton');
  await page.waitForFunction(() => window.xamora.studio.outline.tree.matchCount === 1);
  await filter.press('ArrowDown');
  const tree = page.getByRole('tree', { name: 'Document outline', exact: true });
  await tree.press('End');
  await tree.press('Enter');
  await input.waitFor({ state: 'visible' });
  assert.equal(
    await input.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd)),
    'Button',
  );
  assert.equal(await page.evaluate(() => window.xamora.studio.store.session.source), source);
  // Source refactoring uses authored CRLF offsets and accepts the normalized textarea as synchronized.
  await input.press('Shift+F2');
  await page.getByRole('textbox', { name: 'New tag name', exact: true }).fill('ToggleButton');
  await page.getByRole('button', { name: 'Apply refactor', exact: true }).click();
  await page.waitForFunction(() =>
    window.xamora.studio.store.session.source.includes('<ToggleButton'),
  );
  assert.equal(
    await page.evaluate(() => window.xamora.studio.store.session.source),
    source.replace('<Button', '<ToggleButton'),
  );
  await input.press('Control+z');
  await page.waitForFunction(
    () => window.xamora.studio.store.session.source === window.outlineOriginal,
  );
  // An existing source value survives CRLF attribute completion, with mapped replacement offsets.
  await input.evaluate((el) => {
    const i = el.value.indexOf('Content=') + 3;
    el.focus();
    el.setSelectionRange(i, i);
  });
  await input.press('Control+Space');
  await page
    .locator('.completions button')
    .filter({ has: page.locator('span', { hasText: /^Content$/ }) })
    .first()
    .dispatchEvent('mousedown');
  assert.equal(await page.evaluate(() => window.xamora.studio.store.session.source), source);
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.outline.show();
    s.outline.tree.setFilter('');
    s.outline.filter.value = '';
  });
  const outlinePopup = await popupFor('document-outline');
  const sourcePopup = await popupFor('xaml');
  const popupTree = outlinePopup.getByRole('tree', { name: 'Document outline', exact: true });
  const buttonId = await page.evaluate(
    () => window.xamora.outline.entries().find((n) => n.detail === '#SaveButton').id,
  );
  await outlinePopup.locator(`[data-outline-id="${buttonId}"]`).dblclick();
  await sourcePopup.waitForFunction(
    () => document.activeElement === document.querySelector('.code-input'),
  );
  assert.equal(
    await sourcePopup
      .locator('.code-input')
      .evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd)),
    'Button',
  );
  assert(
    await sourcePopup.getByRole('navigation', { name: 'Source element breadcrumbs' }).isVisible(),
  );
  const before = await page.evaluate(() => window.xamora.studio.store.session.source);
  await sourcePopup.locator('.code-input').fill(source.replace(/\r\n/g, '\n') + '<');
  await page.waitForFunction(() => !window.xamora.studio.store.session.isValid);
  assert.equal(await popupTree.getAttribute('aria-disabled'), 'true');
  assert.equal(await page.evaluate((id) => window.xamora.outline.reveal(id), buttonId), false);
  await sourcePopup.locator('.code-input').press('Control+z');
  await page.waitForFunction(
    () => window.xamora.studio.store.session.source === window.outlineOriginal,
  );
  assert.equal(await page.evaluate(() => window.xamora.studio.store.session.source), before);
  await Promise.all([
    outlinePopup.waitForEvent('close', { timeout: 10000 }),
    outlinePopup.locator('[data-browser-return]').click(),
  ]);
  await Promise.all([
    sourcePopup.waitForEvent('close', { timeout: 10000 }),
    sourcePopup.locator('[data-browser-return]').click(),
  ]);
  await page.evaluate(() => window.xamora.studio.outline.show());
  await mkdir('test-results/ux', { recursive: true });
  await page.screenshot({ path: 'test-results/ux/20-document-outline.png' });
  // HTML repair structure is visible but never receives a fabricated authored range.
  await page.evaluate(() =>
    window.xamora.studio.importText(
      '<main><table><tr><td>One</td></tr></table><svg><circle r="10"/></svg><math><mi>x</mi></math></main>',
      'Outline.html',
    ),
  );
  await page.waitForFunction(() => window.xamora.outline.entries().some((n) => n.label === 'mi'));
  assert(
    await page.evaluate(() => {
      const items = window.xamora.outline.entries(),
        tbody = items.find((n) => n.label === 'tbody');
      return (
        tbody.synthetic &&
        !tbody.range &&
        !window.xamora.outline.reveal(tbody.id) &&
        items.find((n) => n.label === 'mi').namespaceURI === 'http://www.w3.org/1998/Math/MathML'
      );
    }),
  );
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.outline.show();
    s.outline.tree.setFilter('circle');
  });
  await page.screenshot({ path: 'test-results/ux/21-html-outline.png' });
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(
    'Outline: canonical/package native namespaces, 10,001-row tree, source/designer navigation, CRLF editing/refactoring/completion/undo, real popup focus and invalid-draft protection passed.',
  );
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/outline-error.txt', String(error.stack || error));
  for (const [i, p] of (page?.context().pages() || []).entries()) {
    await p.screenshot({ path: `test-results/outline-failure-${i}.png` }).catch(() => {});
    await writeFile(`test-results/outline-failure-${i}.html`, await p.content().catch(() => ''));
  }
  console.error({ errors, failures });
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
