/** Inline authoring in the full Studio, then canonical and package-only runtimes. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..');
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/runtime-check/') {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><main id="host"></main>',
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
let browser, page;
const errors = [],
  failures = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(response.url());
  });
  await page.goto(base + '/');
  await page.waitForFunction(() => !!window.xamora?.studio.sync);
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.importText(
      '<StackPanel xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width="600" Height="300"><TextBlock x:Name="Plain" Text="Keep " FontSize="24"/><TextBlock x:Name="Rich" FontSize="24"><TextBlock.Inlines><Bold><Run Text="Formatted "/></Bold><Run x:Name="Editable"><Run.Text><!-- retained -->Literal</Run.Text></Run><LineBreak/><Italic><Run Text="Second line"/></Italic></TextBlock.Inlines></TextBlock></StackPanel>',
      'Inline-content.xaml',
    );
    window.inlinePlainId = s.doc.root.children[0].id;
    window.inlineRichId = s.doc.root.children[1].id;
    s.store.select([window.inlinePlainId]);
    s.insertControl('Bold');
  });
  await page.waitForFunction(() => window.xamora.studio.editor.input.value.includes('<Bold>'));
  assert(
    await page.evaluate(() => {
      const s = window.xamora.studio,
        n = s.doc.root.children[0];
      return (
        !Object.hasOwn(n.props, 'Text') &&
        n.children[0].props.Text === 'Keep ' &&
        n.children[1].type === 'Bold' &&
        s.renderer.elements.get(n.id).textContent.startsWith('Keep ')
      );
    }),
  );
  await page.evaluate(() => {
    const s = window.xamora.studio;
    const run = s.doc.root.children[1].children[0].children.find(
      (n) => n.props?.['x:Name'] === 'Editable',
    );
    window.inlineRunId = run.id;
    s.store.select([run.id]);
    s.editText(run);
  });
  const editor = page.getByRole('textbox', { name: 'Edit text on canvas', exact: true });
  assert.equal(await editor.inputValue(), 'Literal');
  await editor.fill('{Literal braces}');
  await editor.press('Control+Enter');
  await page.waitForFunction(() =>
    window.xamora.studio.editor.input.value.includes('{Literal braces}'),
  );
  assert(
    await page.evaluate(() => {
      const s = window.xamora.studio;
      return (
        s.renderer.elements.get(window.inlineRunId)?.textContent === '{Literal braces}' &&
        s.editor.input.value.includes('<!-- retained -->') &&
        s.editor.input.value.includes('<Run.Text>')
      );
    }),
  );
  await page.evaluate(() => window.xamora.studio.command('undo'));
  await page.waitForFunction(
    () => window.xamora.studio.renderer.elements.get(window.inlineRunId)?.textContent === 'Literal',
  );
  await page.evaluate(() => window.xamora.studio.command('redo'));
  await page.waitForFunction(
    () =>
      window.xamora.studio.renderer.elements.get(window.inlineRunId)?.textContent ===
      '{Literal braces}',
  );
  // A pasted inline uses the explicit collection and duplicates through its logical owner.
  assert(
    await page.evaluate(() => {
      const s = window.xamora.studio;
      s.clipboard = [
        s.doc.root.children[1].children[0].children.find((n) => n.id === window.inlineRunId),
      ];
      s.paste(true);
      const rich = s.doc.root.children[1];
      return (
        rich.children.length === 1 &&
        rich.children[0].type.endsWith('.Inlines') &&
        rich.children[0].children.filter((n) => n.type === 'Run').length === 2
      );
    }),
  );
  await mkdir(resolve(root, 'test-results/ux'), { recursive: true });
  await page.screenshot({ path: resolve(root, 'test-results/ux/14-xaml-inline-designer.png') });
  for (const module of ['/core/web-runtime.js', '/packages/runtime/dist/browser/index.js']) {
    await page.goto(base + '/runtime-check/');
    await page.evaluate(async (module) => {
      const { createApplication } = await import(module);
      window.inlineCalls = 0;
      window.inlineApp = createApplication({
        source:
          '<TextBlock xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" FontSize="24" FontWeight="Normal"><TextBlock.Inlines><Bold><Bold.Inlines><Run x:Name="Name" Text="{Binding name}"/></Bold.Inlines></Bold><LineBreak/><Hyperlink x:Name="Link" NavigateUri="javascript:window.bad=1" Click="Handle">Host-owned link</Hyperlink><InlineUIContainer><Button x:Name="Action" Content="Action" Click="Handle"/></InlineUIContainer></TextBlock.Inlines></TextBlock>',
        data: { name: 'Ada' },
        events: { Handle: () => window.inlineCalls++ },
      });
      window.inlineApp.mount(document.querySelector('#host'));
    }, module);
    const name = page.locator('[data-runtime-name="Name"]');
    assert.equal(await name.textContent(), 'Ada');
    assert.equal(await name.evaluate((n) => getComputedStyle(n).fontWeight), '700');
    assert.equal(await name.evaluate((n) => getComputedStyle(n).fontSize), '24px');
    await page.evaluate(() => {
      window.inlineApp.data.name = 'Grace';
    });
    await page.waitForFunction(() => window.inlineApp.findName('Name').textContent === 'Grace');
    const link = page.getByRole('link', { name: 'Host-owned link', exact: true });
    assert.equal(await link.getAttribute('href'), null);
    await link.press('Enter');
    await page.getByRole('button', { name: 'Action', exact: true }).click();
    assert.equal(await page.evaluate(() => window.inlineCalls), 2);
    assert.equal(await page.evaluate(() => window.bad), undefined);
    await page.evaluate(() => window.inlineApp.dispose());
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(
    'Inline XAML: Studio insertion, explicit collection editing, undo/redo, duplication, and source/package runtime binding, inheritance and events passed.',
  );
} catch (error) {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await writeFile(
    resolve(root, 'test-results/xaml-inline-error.txt'),
    String(error.stack || error),
  );
  await page
    ?.screenshot({ path: resolve(root, 'test-results/xaml-inline-failure.png') })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
