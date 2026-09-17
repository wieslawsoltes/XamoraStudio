/** Real Chromium popups: Studio editing and canonical/packaged standalone docking hosts. */
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
    if (path === '/packed/') {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/packages/docking/dist/assets/docking.css"><style>.nested-dark { --packed-theme: dark; }</style><div id="theme-container"><main id="host" style="height:600px"></main></div>',
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
const errors = [],
  failures = [];
async function openTab(page, id) {
  await page.evaluate((id) => window.xamora.docking.show(id), id);
  await page.locator(`[data-dock-panel="${id}"]`).click({ button: 'right' });
  const pending = page.waitForEvent('popup');
  await page
    .locator('.dock-menu')
    .getByRole('menuitem', { name: 'Open tab in browser window', exact: true })
    .click();
  const popup = await pending;
  await popup.locator('[data-browser-return]').waitFor();
  return popup;
}
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  context.on('page', (p) => {
    p.on('pageerror', (error) => errors.push(error.message));
    p.on('response', (response) => {
      if (response.status() >= 400) failures.push(response.url());
    });
  });
  page = await context.newPage();
  await page.goto(base + '/');
  await page.waitForFunction(() => !!window.xamora?.studio.sync);
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.importText(
      '<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width="640" Height="480"><Button x:Name="PopupButton" Content="Start" Width="160" Height="48"/></Grid>',
      'Popup.xaml',
    );
    s.store.select([s.doc.root.children[0].id]);
  });
  const source = await openTab(page, 'xaml');
  assert(await source.locator('.code-input').isVisible());
  assert((await source.locator('.code-input').boundingBox()).height > 80);
  const properties = await openTab(page, 'properties');
  assert.equal(await page.evaluate(() => window.xamora.docking.windows().length), 2);
  const input = source.locator('.code-input');
  const original = await input.inputValue();
  await input.fill(original.replace('Content="Start"', 'Content="Edited across windows"'));
  await page.waitForFunction(
    () => window.xamora.studio.doc.root.children[0].props.Content === 'Edited across windows',
  );
  const width = properties
    .locator('[data-inspector-host="design"] input[data-prop="Width"]')
    .first();
  await width.fill('211');
  await width.press('Tab');
  await page.waitForFunction(() => window.xamora.studio.doc.root.children[0].props.Width === '211');
  await source.waitForFunction(() =>
    document.querySelector('.code-input').value.includes('Width="211"'),
  );
  // The routed source keyboard handler must run in the source input's current document.
  await input.press('Control+f');
  assert(await source.locator('.editor-find').isVisible());
  await source.locator('[data-find="close"]').click();
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.density.set('comfortable');
    if (!s.dark) s.command('theme');
  });
  await source.waitForFunction(
    () =>
      document.documentElement.dataset.density === 'comfortable' &&
      !document.body.classList.contains('light'),
  );
  assert.equal(await source.evaluate(() => document.compatMode), 'CSS1Compat');
  // Validate both directions through the actual Studio command, not a synthetic class edit.
  const themeToken = (p) =>
    p.evaluate(() => {
      const host =
        document.querySelector('.dock-browser-host') || window.xamora.docking.control.host;
      return getComputedStyle(host).getPropertyValue('--panel').trim();
    });
  assert.equal(await themeToken(source), await themeToken(page));
  await source.evaluate(() => {
    window.themeStyles = [...document.querySelector('.dock-browser-styles').children];
    window.themeFrame = document.querySelector('.dock-floating');
  });
  await page.evaluate(() => window.xamora.studio.command('theme'));
  await source.waitForFunction(() => document.body.classList.contains('light'));
  assert.equal(await themeToken(source), await themeToken(page));
  assert(
    await source.evaluate(
      () =>
        window.themeFrame === document.querySelector('.dock-floating') &&
        window.themeStyles.every(
          (node, i) => document.querySelector('.dock-browser-styles').children[i] === node,
        ),
    ),
  );
  // Context menu and keyboard navigation are attached to the child document, not the opener.
  await source.locator('[data-dock-panel="xaml"]').click({ button: 'right' });
  assert(await source.locator('.dock-menu').isVisible());
  assert.equal(await page.locator('.dock-menu').count(), 0);
  await source.keyboard.press('Escape');
  assert.equal(await source.locator('.dock-menu').count(), 0);
  const stable = await page.evaluate(() => {
    const { model, control } = window.xamora.docking;
    const record = control.windows.list().find((r) => r.panels.includes('xaml'));
    const frame = record.host.querySelector('.dock-floating'),
      node = control.contents.get('xaml');
    model.pin('document:' + window.xamora.studio.doc.id);
    return (
      record.host.querySelector('.dock-floating') === frame &&
      node.ownerDocument === record.document
    );
  });
  assert(stable, 'Pinning an unrelated document must not reparent the popup editor');
  await properties.close();
  await page.waitForFunction(() => window.xamora.docking.windows().length === 1);
  assert(
    await page.evaluate(
      () => window.xamora.docking.control.contents.get('properties').ownerDocument === document,
    ),
  );
  const text = await input.inputValue();
  await source.locator('[data-browser-return]').click();
  await page.waitForFunction(() => window.xamora.docking.windows().length === 0);
  assert.equal(await page.locator('.code-input').inputValue(), text);
  // Undo closes the physical host. Redo restores intent in-app, without bypassing popup permissions.
  const again = await openTab(page, 'xaml');
  await page.evaluate(() => window.xamora.docking.model.undo());
  await page.waitForFunction(() => window.xamora.docking.windows().length === 0);
  assert(again.isClosed());
  await page.evaluate(() => window.xamora.docking.model.redo());
  assert.equal(await page.evaluate(() => window.xamora.docking.pendingWindows().length), 1);
  const restored = await openTab(page, 'xaml');
  await page.evaluate(() => window.xamora.docking.windows()[0].window.location.reload());
  await page.waitForFunction(() => window.xamora.docking.windows().length === 0);
  assert(
    restored.isClosed(),
    'Reloading a popup returns live content before its document is replaced',
  );
  assert.equal(await page.locator('.code-input').inputValue(), text);
  const blocked = await page.evaluate(() => {
    const { control, model } = window.xamora.docking,
      before = model.serialize();
    control.windows.options.openWindow = () => null;
    const result = control.openWindow('xaml');
    delete control.windows.options.openWindow;
    return result === null && model.serialize() === before;
  });
  assert(blocked);
  // Repeated document creation/close with live tool and source windows must not rotate unrelated tools.
  const last = await openTab(page, 'xaml');
  const fileActions = await page.evaluate(async () => {
    const s = window.xamora.studio,
      { control, model } = s.docking;
    const { locatePanel, validateDockLayout } = await import('./core/docking.js');
    control.activate('toolkit');
    control.activate('raw');
    const selected = () =>
      [
        locatePanel(model.state, 'toolkit').group.active,
        locatePanel(model.state, 'raw').group.active,
      ].join(':');
    const before = selected();
    for (let i = 0; i < 4; i++) {
      s.importText(`<Grid><TextBlock Text="Window file ${i}"/></Grid>`, `Window-${i}.xaml`);
      control.hide('document:' + s.doc.id);
      validateDockLayout(model.state, new Set(model.panels.keys()));
      if (selected() !== before) return false;
    }
    return control.windows.list().length === 1;
  });
  assert(fileActions);
  // Owner navigation reclaims and closes dependent hosts, not orphaned duplicate editor applications.
  await page.goto(base + '/examples/ControlsLab/');
  assert(last.isClosed());
  await page.waitForFunction(() => !!window.controlsLab);
  const labPending = page.waitForEvent('popup');
  await page.locator('#popout').click();
  const lab = await labPending;
  await lab.getByLabel('Example text').fill('Standalone live buffer');
  await lab.locator('[data-browser-return]').click();
  assert.equal(await page.getByLabel('Example text').inputValue(), 'Standalone live buffer');

  // Repeat transfers using the built npm browser bundle, with no Studio dependencies.
  await page.goto(base + '/packed/');
  await page.evaluate(async () => {
    const { DockLayout, DockWorkspace } = await import('/packages/docking/dist/browser/index.js');
    const model = new DockLayout([
      { id: 'one', kind: 'document' },
      { id: 'two', kind: 'document' },
    ]);
    const control = new DockWorkspace(document.querySelector('#host'), model, {
      browserWindows: true,
    });
    for (const id of ['one', 'two']) {
      const input = document.createElement('textarea');
      input.value = `Packed ${id}`;
      input.setAttribute('aria-label', id);
      control.mount(id, input);
      const button = document.createElement('button');
      button.id = 'open-' + id;
      button.textContent = 'Open ' + id;
      button.onclick = () => control.openWindow(id);
      document.body.append(button);
    }
    control.render();
    window.packed = { control, model };
  });
  let next = page.waitForEvent('popup');
  await page.locator('#open-one').click();
  const a = await next;
  next = page.waitForEvent('popup');
  await page.locator('#open-two').click();
  const b = await next;
  await a.getByLabel('one', { exact: true }).fill('Transferred buffer');
  await page.evaluate(() =>
    document.querySelector('#theme-container').classList.add('nested-dark'),
  );
  for (const popup of [a, b])
    await popup.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('.dock-browser-host'))
          .getPropertyValue('--packed-theme')
          .trim() === 'dark',
    );
  await page.evaluate(() =>
    document.querySelector('#theme-container').classList.remove('nested-dark'),
  );
  for (const popup of [a, b])
    await popup.waitForFunction(
      () =>
        document.querySelector('.dock-browser-host').style.getPropertyValue('--packed-theme') ===
        '',
    );
  // Real DragEvent/DataTransfer handlers, dispatched deterministically across two browser documents.
  await a
    .locator('.dock-transfer-grip')
    .first()
    .evaluate((grip) => {
      const dataTransfer = new DataTransfer();
      grip.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }),
      );
    });
  const token = await page.evaluate(() => window.packed.control.windows.transfer.token);
  await b.locator('.dock-group-body').evaluate((body, token) => {
    const r = body.getBoundingClientRect(),
      dataTransfer = new DataTransfer();
    dataTransfer.setData('application/x-xamora-dock', token);
    body.dispatchEvent(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: r.x + r.width / 2,
        clientY: r.y + r.height / 2,
        dataTransfer,
      }),
    );
    body.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: r.x + r.width / 2,
        clientY: r.y + r.height / 2,
        dataTransfer,
      }),
    );
  }, token);
  await page.waitForFunction(() => window.packed.control.windows.list().length === 1);
  assert(a.isClosed());
  assert.equal(await b.getByLabel('one', { exact: true }).inputValue(), 'Transferred buffer');
  const same = await page.evaluate(() => {
    const { control } = window.packed,
      record = control.windows.list()[0];
    return ['one', 'two'].every((id) => control.contents.get(id).ownerDocument === record.document);
  });
  assert(same);
  await page.evaluate(() => window.packed.control.dispose());
  assert(b.isClosed());
  assert.equal(await page.getByLabel('one', { exact: true }).inputValue(), 'Transferred buffer');
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(
    'Multiwindow docking: Studio source/property editing, shortcuts, CSS, file lifecycle, popup close/reload, blocked allocation, undo/redo, owner navigation and standalone/packaged transfers passed.',
  );
} catch (error) {
  await mkdir('test-results', { recursive: true });
  for (const [i, p] of (page?.context().pages() || []).entries())
    await p.screenshot({ path: `test-results/docking-window-${i}.png` }).catch(() => {});
  console.error({ errors, failures });
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
