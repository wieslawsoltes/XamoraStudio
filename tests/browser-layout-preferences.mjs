/** Exercise actual Studio chrome and source/packaged docking without relaxing existing gates. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/dock-test/' || path === '/packed-test/') {
      const css =
        path === '/packed-test/'
          ? '/packages/docking/dist/assets/docking.css'
          : '/controls/docking.css';
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="${css}"><div id="host" style="width:800px;height:400px"></div>`,
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
let browser, page;
const errors = [];
async function viewCommand(id) {
  await page.locator('.ide-menubar').getByRole('menuitem', { name: 'View', exact: true }).click();
  await page
    .getByRole('menuitemcheckbox', {
      name:
        id === 'layout:canvas-tips' ? 'Show canvas navigation tips' : 'Keep empty document panels',
    })
    .click();
}
async function assertTabArrowsOnly(p) {
  assert.equal(await p.locator('.chrome-scroll-wrapper .strip-scroll-button').count(), 0);
  assert(
    await p.evaluate(() =>
      [...document.querySelectorAll('.strip-scroll-button')].every(
        (b) => b.closest('.dock-group') && b.parentElement.querySelector('.dock-tabs'),
      ),
    ),
  );
}
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.on('page', (p) => p.on('pageerror', (error) => errors.push(error.message)));
  page = await context.newPage();
  await page.goto(base + '/');
  await page.waitForFunction(() => !!window.xamora?.studio.layoutPreferences);
  await mkdir(resolve(root, 'test-results/ux'), { recursive: true });
  assert.equal(await page.locator('.canvas-hint').isVisible(), false);
  assert.equal(
    await page.evaluate(() => window.xamora.docking.model.keepEmptyDocumentGroups),
    true,
  );
  await assertTabArrowsOnly(page);
  // Actual menu commands expose both preferences, not just programmatic switches.
  await page.evaluate(() => {
    window.beforePreferenceDocs = JSON.stringify(
      window.xamora.studio.stores.map((st) => st.document),
    );
    window.beforePreferenceHistory = window.xamora.studio.store.history.length;
  });
  await viewCommand('layout:canvas-tips');
  assert.equal(await page.locator('.canvas-hint').isVisible(), true);
  await viewCommand('layout:canvas-tips');
  assert.equal(await page.locator('.canvas-hint').isVisible(), false);
  assert(
    await page.evaluate(
      () =>
        window.beforePreferenceDocs ===
          JSON.stringify(window.xamora.studio.stores.map((st) => st.document)) &&
        window.beforePreferenceHistory === window.xamora.studio.store.history.length,
    ),
  );

  const state = await page.evaluate(async () => {
    const { dockGroups } = await import('/core/docking.js');
    const { model, control } = window.xamora.docking;
    const groups = dockGroups({ root: model.state.root, floating: [] }).filter(
      (g) => g.kind === 'document',
    );
    const ids = groups.map((g) => g.id);
    const first = groups.flatMap((g) => g.panels)[0];
    const firstGroup = groups.find((g) => g.panels.includes(first)).id;
    const source = window.xamora.studio.editor.input.value;
    for (const panel of model.panels.values())
      if (panel.kind === 'document') control.hide(panel.id);
    return { ids, first, firstGroup, source };
  });
  for (const id of state.ids) {
    const well = page.locator(`[data-dock-group="${id}"]`);
    assert(await well.isVisible());
    assert((await well.boundingBox()).width > 100);
    assert.equal(await well.locator('button').count(), 0);
  }
  assert.equal(await page.locator('.dock-root .dock-document-group .dock-tab').count(), 0);
  await page.screenshot({ path: resolve(root, 'test-results/ux/08-empty-documents.png') });
  // The pagehide handler persists the empty wells before navigating.
  await page.reload();
  await page.waitForFunction(() => !!window.xamora?.studio.layoutPreferences);
  for (const id of state.ids)
    assert(await page.locator(`[data-dock-group="${id}"].dock-group-empty`).isVisible());
  await page.evaluate((id) => window.xamora.docking.show(id), state.first);
  assert.equal(
    await page
      .locator(`[data-dock-panel="${state.first}"]`)
      .evaluate((n) => n.closest('[data-dock-group]').dataset.dockGroup),
    state.firstGroup,
  );
  assert.equal(await page.evaluate(() => window.xamora.studio.editor.input.value), state.source);

  // A new document after closing all editors must occupy a retained well, not create another split.
  const newGroup = await page.evaluate(async () => {
    const { dockGroups, locatePanel } = await import('/core/docking.js');
    const s = window.xamora.studio;
    for (const panel of s.docking.model.panels.values())
      if (panel.kind === 'document') s.docking.control.hide(panel.id);
    const emptyIds = dockGroups(s.docking.model.state)
      .filter((g) => g.kind === 'document' && !g.panels.length)
      .map((g) => g.id);
    s.importText('<Grid Width="400" Height="300"><Button Content="New"/></Grid>', 'EmptyWell.xaml');
    return {
      emptyIds,
      group: locatePanel(s.docking.model.state, 'document:' + s.doc.id)?.group?.id,
    };
  });
  assert(newGroup.emptyIds.includes(newGroup.group));
  // Switching editor modes deliberately removes unused wells but retains the preference.
  for (const mode of ['code', 'design', 'split', 'views', 'split']) {
    assert(
      await page.evaluate(async (mode) => {
        const { dockGroups } = await import('/core/docking.js');
        const s = window.xamora.studio;
        return (
          s.docking.setView(mode) &&
          s.docking.model.keepEmptyDocumentGroups &&
          dockGroups(s.docking.model.state).every((g) => g.panels.length)
        );
      }, mode),
    );
  }
  // Opting out affects closing immediately and survives reload.
  await viewCommand('layout:keep-empty-documents');
  await page.evaluate(() => {
    const { model, control } = window.xamora.docking;
    for (const panel of model.panels.values())
      if (panel.kind === 'document') control.hide(panel.id);
  });
  assert.equal(await page.locator('.dock-root .dock-document-group').count(), 0);
  await page.reload();
  await page.waitForFunction(() => !!window.xamora?.studio.layoutPreferences);
  assert.equal(
    await page.evaluate(() => window.xamora.docking.model.keepEmptyDocumentGroups),
    false,
  );
  await viewCommand('layout:keep-empty-documents');
  await page.evaluate(() => window.xamora.studio.docking.setView('split'));
  await page.screenshot({ path: resolve(root, 'test-results/ux/09-chrome-without-arrows.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertTabArrowsOnly(page);
  assert.equal(await page.locator('.canvas-hint').isVisible(), false);

  for (const [path, module] of [
    ['/dock-test/', '/controls/docking.js'],
    ['/packed-test/', '/packages/docking/dist/browser/index.js'],
  ]) {
    const p = await context.newPage();
    await p.goto(base + path);
    await p.evaluate(async (module) => {
      const { DockLayout, DockWorkspace, dockGroup, createDockLayout } = await import(module);
      const panels = Array.from({ length: 3 }, (_, i) => ({
        id: 'tab' + i,
        title: 'Document ' + i,
        kind: 'document',
      }));
      const model = new DockLayout(
        panels,
        {
          ...createDockLayout(panels.map((p) => p.id)),
          root: dockGroup(
            panels.map((p) => p.id),
            'document',
            'test-docs',
          ),
          hidden: [],
          activePanel: 'tab0',
        },
        { keepEmptyDocumentGroups: true },
      );
      const host = document.getElementById('host');
      const control = new DockWorkspace(host, model);
      for (const panel of panels) {
        const input = document.createElement('input');
        input.value = panel.id;
        control.mount(panel.id, input);
      }
      control.render();
      window.fixture = { host, model, control };
    }, module);
    assert.equal(await p.locator('.strip-scroll-button').count(), 2);
    const arrows = p.locator('.strip-scroll-button:visible');
    await p.waitForFunction(() =>
      [...document.querySelectorAll('.strip-scroll-button')].every((b) => b.hidden),
    );
    assert.equal(await arrows.count(), 0);
    await p.locator('#host').evaluate((host) => (host.style.width = '180px'));
    await p.waitForFunction(() =>
      [...document.querySelectorAll('.strip-scroll-button')].some((b) => !b.hidden && !b.disabled),
    );
    await p.getByRole('button', { name: 'Scroll documents right', exact: true }).click();
    assert((await p.locator('.dock-tabs').evaluate((el) => el.scrollLeft)) > 0);
    await p.locator('#host').evaluate((host) => (host.style.width = '800px'));
    await p.waitForFunction(() =>
      [...document.querySelectorAll('.strip-scroll-button')].every((b) => b.hidden),
    );
    assert.equal(await arrows.count(), 0);
    await p.evaluate(() => {
      const { model } = window.fixture;
      model.hide(['tab0', 'tab1', 'tab2']);
    });
    assert(await p.getByLabel('Empty document panel', { exact: true }).isVisible());
    await p.evaluate(() => window.fixture.model.show('tab1'));
    assert.equal(await p.locator('input:visible').inputValue(), 'tab1');
    await p.evaluate(() => window.fixture.control.dispose());
    await p.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Layout preferences: retained empty wells, reopen/new document, mode switching, persisted toggles, hidden tips, arrow-free chrome, and source/packaged tab overflow passed.',
  );
} catch (error) {
  await mkdir(resolve(root, 'test-results/ux'), { recursive: true });
  await page
    ?.screenshot({ path: resolve(root, 'test-results/ux/layout-preferences-failure.png') })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
