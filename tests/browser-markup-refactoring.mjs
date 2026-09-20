/** Real Studio source/designer/popout operations and native source/package AST checks. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { runRefactoringCases } from './refactoring-native-cases.mjs';
const root = resolve(import.meta.dirname, '..');
const imports = {};
for (const id of await readdir(resolve(root, 'packages'))) {
  const manifest = JSON.parse(
    await readFile(resolve(root, 'packages', id, 'package.json'), 'utf8'),
  );
  for (const [subpath, condition] of Object.entries(manifest.exports || {})) {
    const target = condition.import?.default;
    if (typeof target === 'string' && target.endsWith('.js'))
      imports[manifest.name + (subpath === '.' ? '' : subpath.slice(1))] =
        `/packages/${id}/${target.slice(2)}`;
  }
}
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/refactoring-check/') {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          `<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script type="importmap">${JSON.stringify({ imports })}</script>`,
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
          { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[extname(file)] ||
          'text/plain',
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
    p.on('response', (response) => {
      if (response.status() >= 400) failures.push(response.url());
    });
  });
  page = await context.newPage();
  for (const modules of [
    [
      '/core/model.js',
      '/core/document-session.js',
      '/core/markup-refactoring.js',
      '/core/xaml.js',
      '/core/html.js',
    ],
    [
      '@wieslawsoltes/xamora-model',
      '@wieslawsoltes/xamora-markup/document-session',
      '@wieslawsoltes/xamora-markup/markup-refactoring',
      '@wieslawsoltes/xamora-markup/xaml',
      '@wieslawsoltes/xamora-markup/html',
    ],
  ]) {
    await page.goto(base + '/refactoring-check/');
    await page.addScriptTag({
      content: `window.runRefactoringCases = ${runRefactoringCases.toString()};`,
    });
    const result = await page.evaluate(async (modules) => {
      const api = Object.assign({}, ...(await Promise.all(modules.map((path) => import(path)))));
      return window.runRefactoringCases(api);
    }, modules);
    assert.equal(result.assertions, 33);
    console.log(
      modules[2] + ': native parser refactoring, source fidelity and rejection checks passed.',
    );
  }
  await page.goto(base + '/');
  await page.waitForFunction(() => !!window.xamora?.refactoring);
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.importText(
      '<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width="640" Height="420"><StackPanel x:Name="Group"><StackPanel.Resources><!-- retained --></StackPanel.Resources><Button Content=\'Save &amp; close\'/><TextBlock Text="Status"/></StackPanel></Grid>',
      'Refactoring.xaml',
    );
    window.refactorOriginal = s.store.session.source;
    window.refactorGroup = s.doc.root.children[0].id;
    window.refactorButton = s.doc.root.children[0].children[1].id;
    window.refactorText = s.doc.root.children[0].children[2].id;
    s.editor.input.focus();
    const at = s.editor.input.value.indexOf('StackPanel') + 3;
    s.editor.input.setSelectionRange(at, at);
  });
  const editor = page.locator('.code-input');
  await editor.press('Shift+F2');
  const dialog = page.getByRole('dialog', { name: 'Rename element tag', exact: true });
  await dialog.waitFor();
  await dialog.getByRole('textbox', { name: 'New tag name', exact: true }).fill('Grid');
  assert.equal(
    await page.evaluate(() => window.xamora.studio.store.session.source),
    await page.evaluate(() => window.refactorOriginal),
  );
  await mkdir(resolve(root, 'test-results/ux'), { recursive: true });
  await page.screenshot({ path: resolve(root, 'test-results/ux/19-markup-refactoring.png') });
  await dialog.getByRole('button', { name: 'Apply refactor', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.xamora.studio.doc.root.children[0].type === 'Grid');
  assert(
    await page.evaluate(() => {
      const s = window.xamora.studio;
      return (
        s.doc.root.children[0].id === window.refactorGroup &&
        s.store.session.source.includes('<Grid.Resources><!-- retained --></Grid.Resources>') &&
        s.store.session.source.includes("Content='Save &amp; close'")
      );
    }),
  );
  await editor.press('Control+z');
  await page.waitForFunction(
    () => window.xamora.studio.store.session.source === window.refactorOriginal,
  );
  await editor.press('Control+Shift+z');
  await page.waitForFunction(() => window.xamora.studio.doc.root.children[0].type === 'Grid');
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.store.select([window.refactorButton, window.refactorText]);
    s.command('designer-wrap-element');
  });
  const wrap = page.getByRole('dialog', { name: 'Wrap elements', exact: true });
  await wrap.getByRole('textbox', { name: 'Wrapper tag', exact: true }).fill('StackPanel');
  await wrap.getByRole('button', { name: 'Apply refactor', exact: true }).click();
  await wrap.waitFor({ state: 'detached' });
  assert(
    await page.evaluate(() => {
      const s = window.xamora.studio,
        wrapped = s.doc.root.children[0].children[1];
      return (
        wrapped.type === 'StackPanel' &&
        wrapped.children[0].id === window.refactorButton &&
        wrapped.children[1].id === window.refactorText &&
        s.store.selection[0] === wrapped.id
      );
    }),
  );
  await page.evaluate(() => window.xamora.studio.command('designer-unwrap-element'));
  const unwrap = page.getByRole('dialog', { name: 'Unwrap element', exact: true });
  await unwrap.getByRole('button', { name: 'Apply refactor', exact: true }).click();
  await unwrap.waitFor({ state: 'detached' });
  assert(
    await page.evaluate(
      () => window.xamora.studio.doc.root.children[0].children[1].id === window.refactorButton,
    ),
  );

  // Full text-edit history remains authoritative: invalid source is not overwritten by a refactor.
  await editor.fill('<Grid');
  await page.waitForFunction(() => !window.xamora.studio.store.session.isValid);
  assert.equal(await page.evaluate(() => window.xamora.refactoring.open('rename')), false);
  assert.equal(await editor.inputValue(), '<Grid');
  await page.evaluate(() => window.xamora.studio.store.session.discardDraft());

  // The source editor may live in a different document; dialogs keep their owner and return focus.
  await page.evaluate(() => window.xamora.docking.show('xaml'));
  await page.locator('[data-dock-panel="xaml"]').click({ button: 'right' });
  const pending = page.waitForEvent('popup');
  await page
    .locator('.dock-menu')
    .getByRole('menuitem', { name: 'Open tab in browser window', exact: true })
    .click();
  const popup = await pending;
  const popInput = popup.locator('.code-input');
  await popInput.waitFor({ state: 'visible' });
  await popInput.focus();
  await popInput.evaluate((input) => {
    const at = input.value.indexOf('<Button') + 2;
    input.setSelectionRange(at, at);
  });
  await popInput.press('Shift+F2');
  await dialog.getByRole('textbox', { name: 'New tag name', exact: true }).fill('Label');
  assert.equal(await popup.getByRole('dialog').count(), 0);
  await dialog.getByRole('button', { name: 'Apply refactor', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await popup.waitForFunction(
    () => document.activeElement === document.querySelector('.code-input'),
  );
  assert((await popInput.inputValue()).includes("<Label Content='Save &amp; close'/>"));
  await Promise.all([popup.waitForEvent('close'), popup.locator('[data-browser-return]').click()]);

  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.importText(
      '<!doctype html><html><body><main><section id="target"><b>A&nbsp;B</b> &amp; <i>C</i></section></main></body></html>',
      'Refactor.html',
    );
    window.htmlRefactorOriginal = s.store.session.source;
    window.htmlRefactorId = s.doc.root.children.find(
      (n) => n.type === 'body',
    ).children[0].children[0].id;
    s.editor.input.focus();
    const at = s.editor.input.value.indexOf('<section') + 3;
    s.editor.input.setSelectionRange(at, at);
  });
  // Actual IDE menu registration, not only a programmatic command call.
  await page.locator('.ide-menubar').getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Refactor markup', exact: true }).hover();
  await page.getByRole('menuitem', { name: /Rename element tag/ }).click();
  await dialog.getByRole('textbox', { name: 'New tag name', exact: true }).fill('article');
  await dialog.getByRole('button', { name: 'Apply refactor', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(() =>
    window.xamora.studio.renderer.htmlRenderer?.frame.contentDocument?.querySelector(
      'article#target',
    ),
  );
  assert(
    (await editor.inputValue()).includes(
      '<article id="target"><b>A&nbsp;B</b> &amp; <i>C</i></article>',
    ),
  );
  await editor.press('Control+z');
  await page.waitForFunction(
    () => window.xamora.studio.store.session.source === window.htmlRefactorOriginal,
  );
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.store.select([window.htmlRefactorId]);
    s.command('designer-wrap-element');
  });
  await wrap.waitFor();
  await page.evaluate(() =>
    window.xamora.studio.store.setProperty(
      [window.htmlRefactorId],
      'title',
      'Changed while reviewing',
    ),
  );
  assert(await wrap.getByRole('button', { name: 'Apply refactor', exact: true }).isDisabled());
  await wrap.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert((await editor.inputValue()).includes('Changed while reviewing'));
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(
    'Refactoring: full Studio XAML/HTML commands, owned properties, exact history, designer grouping, invalid drafts, menu discovery and popup source editing passed.',
  );
} catch (error) {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await writeFile(
    resolve(root, 'test-results/refactoring-error.txt'),
    String(error.stack || error),
  );
  for (const [i, p] of (context?.pages() || []).entries()) {
    await p
      .screenshot({ path: resolve(root, `test-results/refactoring-${i}.png`) })
      .catch(() => {});
    await writeFile(
      resolve(root, `test-results/refactoring-${i}.html`),
      await p.content().catch(() => ''),
    );
  }
  console.error({ errors, failures });
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
