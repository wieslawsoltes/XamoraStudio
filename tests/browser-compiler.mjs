/** Real Chromium smoke/integration tests. Run: node tests/browser-sync.mjs. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
let playwright;
try {
  playwright = await import('playwright');
} catch (error) {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
  playwright = await import(
    pathToFileURL(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs'))
      .href
  );
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const server = createServer(async (req, res) => {
  try {
    let file = resolve(
      root,
      '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname),
    );
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    res
      .writeHead(200, {
        'Content-Type': mime[extname(file)] || 'text/plain',
        'Cache-Control': 'no-store',
      })
      .end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser, page;
const runtimeErrors = [],
  consoleErrors = [],
  consoleCapture = [];
try {
  browser = await playwright.chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.on('pageerror', (error) => runtimeErrors.push(error.stack || error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const record = { text: message.text(), location: message.location(), arguments: [] };
    consoleErrors.push(record);
    const capture = Promise.all(
      message.args().map((argument) =>
        argument
          .evaluate((value) => {
            if (value instanceof Error) return value.stack || value.message;
            if (typeof value === 'string') return value;
            try {
              return JSON.stringify(value);
            } catch {
              return String(value);
            }
          })
          .catch((error) => 'Unable to inspect console argument: ' + error.message),
      ),
    ).then((values) => {
      record.arguments = values;
      console.error('Browser console.error:', values.join('\n') || record.text);
    });
    consoleCapture.push(capture);
  });
  await page.goto(base);
  await page.waitForFunction(
    () => !!window.xamora?.studio?.sync || !!document.querySelector('#recover-workspace'),
    null,
    { timeout: 30000 },
  );
  const startup = await page.evaluate(() => ({
    recovery: !!document.querySelector('#recover-workspace'),
    ready: !!window.xamora?.studio?.sync,
    body: document.body.innerText.slice(0, 12000),
  }));
  await Promise.allSettled(consoleCapture);
  assert.equal(
    startup.recovery,
    false,
    'App startup entered recovery: ' +
      startup.body +
      '\n' +
      consoleErrors.map((error) => error.arguments.join('\n') || error.text).join('\n'),
  );
  assert.equal(startup.ready, true, 'App did not initialize synchronization: ' + startup.body);
  await page.waitForFunction(() => !!window.xamora.studio.language);

  await page.waitForFunction(() => !!window.xamora.studio.compiler);
  const names = await page.evaluate(() =>
    window.xamora.commands.list().map((command) => command.id),
  );
  for (const id of [
    'convert-document-html',
    'convert-document-wpf',
    'convert-document-avalonia',
    'convert-folder',
    'convert-solution',
  ])
    assert.ok(names.includes(id), 'Menu command exists: ' + id);
  const xml = `<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width="420" Height="260"><StackPanel Margin="20"><TextBlock x:Name="Heading" Text="Editable title"/><Button Content="Run"/></StackPanel></Grid>`;
  const before = await page.evaluate((source) => {
    const s = window.xamora.studio;
    s.importText(source, 'Conversion.xaml');
    s.setView('split');
    s.solution.selectedId = s.doc.id;
    s.store.setProperty([s.doc.root.id], 'Width', '430');
    window.__compilerOriginal = {
      store: s.store,
      session: s.store.session,
      history: s.store.history,
      selection: s.store.selection,
      source: s.store.session.source,
    };
    return { id: s.doc.id, count: s.stores.length, history: s.store.history.length };
  }, xml);
  await page.waitForFunction(() => !window.xamora.studio.sync.renderFrame);
  await page.evaluate(() => window.xamora.commands.execute('convert-document-html'));
  await page.waitForFunction(() => window.xamora.studio.compiler.plan?.summary.ready === 1);
  assert.match(await page.locator('[data-convert-preview]').inputValue(), /<html/i);
  await page.locator('[data-modal-action="2"]').click();
  await page.waitForFunction(
    (count) => window.xamora.studio.stores.length === count + 1,
    before.count,
  );
  const after = await page.evaluate(() => {
    const s = window.xamora.studio,
      o = window.__compilerOriginal;
    return {
      id: s.doc.id,
      sameStore: s.store === o.store,
      sameSession: s.store.session === o.session,
      sameHistory: s.store.history === o.history,
      source: s.store.session.source === o.source,
      history: s.store.history.length,
      converted: s.compiler.lastReport.created[0],
    };
  });
  assert.equal(after.id, before.id);
  assert.equal(after.sameStore, true);
  assert.equal(after.sameSession, true);
  assert.equal(after.sameHistory, true);
  assert.equal(after.source, true);
  assert.equal(after.history, before.history);
  assert.match(after.converted.path, /\.html$/);
  await page.evaluate(() => window.xamora.studio.solution.undo());
  assert.equal(await page.evaluate(() => window.xamora.studio.stores.length), before.count);
  await page.evaluate(() => window.xamora.studio.solution.redo());
  assert.equal(await page.evaluate(() => window.xamora.studio.stores.length), before.count + 1);
  console.log(
    'PASS compiler IDE: menu commands, reviewed source output, preserved original store/session/history, atomic solution undo and redo',
  );

  await page.evaluate((id) => {
    const s = window.xamora.studio;
    s.solution.open(id, 'split');
    s.solution.selectedId = id;
    const node = [...s.renderer.elements.keys()].find(
      (id) => s.renderer.elements.get(id).textContent === 'Editable title',
    );
    if (node) s.store.select([node]);
  }, after.converted.documentId);
  await page.waitForFunction(
    () => window.xamora.studio.doc.framework === 'HTML' && !window.xamora.studio.sync.renderFrame,
  );
  await page.evaluate(() => {
    const s = window.xamora.studio;
    const visit = (n) => {
      if (n.kind === 'text' && n.text === 'Editable title') return n;
      for (const c of n.children || []) {
        const v = visit(c);
        if (v) return v;
      }
    };
    s.store.transaction(
      'Edit converted title',
      (doc) => (visit(doc.root).text = 'Changed from HTML designer'),
    );
  });
  await page.waitForFunction(() =>
    document.querySelector('.code-input').value.includes('Changed from HTML designer'),
  );
  await page.evaluate(() => window.xamora.commands.execute('convert-document-wpf'));
  await page.waitForFunction(() => window.xamora.studio.compiler.plan?.summary.ready === 1);
  assert.match(
    await page.locator('[data-convert-preview]').inputValue(),
    /Changed from HTML designer/,
  );
  assert.match(await page.locator('[data-convert-filename]').textContent(), /converted.*\.xaml$/);
  await page.locator('[data-convert-open]').check();
  await page.locator('[data-modal-action="2"]').click();
  await page.waitForFunction(
    () =>
      window.xamora.studio.doc.framework === 'WPF' &&
      window.xamora.studio.store.session.source.includes('Changed from HTML designer'),
  );
  assert.equal(await page.evaluate(() => window.xamora.studio.view), 'split');
  console.log(
    'PASS compiler IDE: converted HTML remains live-editable and converts back into a new WPF editor with unique filename',
  );

  const batch = await page.evaluate((source) => {
    const s = window.xamora.studio;
    s.importText(source, 'BatchGood.xaml');
    const good = s.doc.id;
    s.importText(source, 'BatchBad.xaml');
    const bad = s.doc.id;
    s.solution.mutate('Prepare conversion folder', (snap) => {
      for (const doc of snap.documents)
        if ([good, bad].includes(doc.id)) doc.metadata.solutionPath = 'Batch/' + doc.name;
      snap.solution.folders.push('Batch');
    });
    s.stores.find((store) => store.document.id === bad).session.updateSource('<Grid');
    s.solution.open(good, 'split');
    s.solution.selectedId = null;
    s.solution.folder = 'Batch';
    return { good, bad, count: s.stores.length };
  }, xml);
  await page.waitForFunction(() => !window.xamora.studio.sync.renderFrame);
  await page.evaluate(() => window.xamora.commands.execute('convert-folder'));
  await page.waitForFunction(() => window.xamora.studio.compiler.plan?.summary.failed === 1);
  assert.equal(await page.locator('[data-modal-action="2"]').isDisabled(), true);
  assert.match(await page.locator('.compiler-status').textContent(), /1 ready.*1 failed/);
  await page.locator('[data-modal-action="0"]').click();
  await page.waitForFunction(() => !document.querySelector('.modal')?.hasAttribute('aria-busy'));
  assert.equal(
    await page.locator('[data-modal-action="2"]').isDisabled(),
    true,
    'Preview again must retain the explicit partial-conversion guard',
  );
  await page.locator('[data-convert-partial]').check();
  assert.equal(await page.locator('[data-modal-action="2"]').isEnabled(), true);
  await page.locator('[data-modal-action="2"]').click();
  await page.waitForFunction(
    (count) => window.xamora.studio.stores.length === count + 1,
    batch.count,
  );
  const inactive = await page.evaluate((id) => {
    const store = window.xamora.studio.stores.find((store) => store.document.id === id);
    return { text: store.session.source, valid: store.session.isValid };
  }, batch.bad);
  assert.equal(inactive.text, '<Grid');
  assert.equal(inactive.valid, false);
  console.log(
    'PASS compiler IDE: folder scope, per-file invalid-draft failure, explicit partial conversion, inactive draft preserved',
  );

  const stale = await page.evaluate(() => {
    const s = window.xamora.studio;
    const plan = s.compiler.preview({ scope: 'document', documentId: s.doc.id, to: 'html' }),
      count = s.stores.length;
    s.store.setProperty([s.doc.root.id], 'Height', '271');
    try {
      s.compiler.apply(plan);
      return { rejected: false };
    } catch (error) {
      return {
        rejected: /changed after this preview/.test(error.message),
        count: s.stores.length === count,
      };
    }
  });
  assert.equal(stale.rejected, true);
  assert.equal(stale.count, true);
  assert.deepEqual(runtimeErrors, [], 'compiler has no uncaught browser errors');
  console.log('PASS compiler IDE: source edits invalidate stale previews without creating output');
  console.log('Browser semantic compiler integration passed.');
} catch (error) {
  if (page) {
    await Promise.allSettled(consoleCapture);
    const state = await page
      .evaluate(() => ({
        url: location.href,
        body: document.body?.innerText.slice(0, 12000) || '',
        editorStatus: document.querySelector('.code-message')?.textContent || '',
        recovery: !!document.querySelector('#recover-workspace'),
      }))
      .catch((error) => ({ diagnosticError: error.message }));
    const diagnostics = {
      error: error.stack || error.message,
      runtimeErrors,
      consoleErrors,
      state,
    };
    await mkdir('test-results', { recursive: true });
    await writeFile(
      'test-results/browser-compiler-failure.json',
      JSON.stringify(diagnostics, null, 2),
    );
    await page
      .screenshot({ path: 'test-results/browser-compiler-failure.png', fullPage: true })
      .catch(() => {});
    console.error('Browser errors:', runtimeErrors);
    console.error('Browser console errors:', consoleErrors);
    console.error('Editor status:', state.editorStatus);
    console.error('App body:', state.body);
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
