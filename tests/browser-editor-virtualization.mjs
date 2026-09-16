import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..');
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file, body;
    if (path.startsWith('/packed/')) {
      const name = path.slice(8) || 'index.html';
      if (!['index.html', 'lab.js'].includes(name)) throw Error('Unknown resource');
      file = name;
      body = await readFile(resolve(root, 'dist/examples/VirtualEditorLab', name), 'utf8');
      body = body
        .replace('../../controls/code-editor.js', '/packages/code-editor/dist/browser/index.js')
        .replace(
          '../../controls/code-editor.css',
          '/packages/code-editor/dist/assets/code-editor.css',
        );
    } else {
      const base = path.startsWith('/packages/') ? root : resolve(root, 'dist');
      file = resolve(base, '.' + path + (path.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(base + sep)) throw Error('Outside root');
      body = await readFile(file);
    }
    res
      .writeHead(200, {
        'Content-Type':
          { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[extname(file)] ||
          'text/plain',
      })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser, page;
const errors = [],
  failed = [],
  requests = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(r.url());
  });
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  for (const path of ['/examples/VirtualEditorLab/', '/packed/']) {
    requests.length = 0;
    await page.goto(`http://127.0.0.1:${server.address().port}${path}`);
    await page.waitForFunction(() => !!window.virtualEditorLab);
    const input = page.getByLabel('Rows code editor', { exact: true });
    assert.equal(await input.evaluate((el) => el.value.split('\n').length), 100000);
    await page.locator('#middle').click();
    const middle = await page.evaluate(() => {
      const { editor } = window.virtualEditorLab;
      const style = getComputedStyle(editor.input);
      const bounds = editor.highlight.getBoundingClientRect();
      return {
        ...editor.viewport,
        tokenizations: window.virtualEditorLab.tokenizations,
        actualTop: editor.codeWindow.getBoundingClientRect().top,
        expectedTop:
          bounds.top +
          parseFloat(style.paddingTop) +
          editor.viewport.startLine * parseFloat(style.lineHeight) -
          editor.input.scrollTop,
      };
    });
    assert(
      middle.virtualized &&
        middle.renderedLines < 100 &&
        middle.startLine < 50001 &&
        middle.endLine > 50000,
    );
    assert(Math.abs(middle.actualTop - middle.expectedTop) < 1);
    await input.evaluate((el) => {
      el.scrollTop += 7;
      el.scrollLeft = 250;
      el.dispatchEvent(new Event('scroll'));
    });
    await page.waitForFunction(
      () =>
        parseFloat(window.virtualEditorLab.editor.codeWindow.style.left) ===
        -window.virtualEditorLab.editor.input.scrollLeft,
    );
    assert.equal(
      await page.evaluate(() => window.virtualEditorLab.tokenizations),
      middle.tokenizations,
    );
    await page.locator('#end').click();
    assert(
      await page
        .locator('.code-highlight')
        .textContent()
        .then((s) => s.includes('row 100000')),
    );
    await input.press('End');
    await page.keyboard.insertText(' Edited');
    assert((await input.inputValue()).endsWith(' Edited'));
    await input.press('Control+z');
    assert(!(await input.inputValue()).endsWith(' Edited'));
    await page.setViewportSize({ width: 700, height: 500 });
    await page.waitForFunction(() => window.virtualEditorLab.editor.viewport.renderedLines < 50);
    await page.evaluate(() => {
      const { editor } = window.virtualEditorLab;
      const input = editor.input;
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input.setRangeText('文', input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
      editor.refreshLayout();
      if (editor.input !== input || !editor.composing) throw Error('IME authority changed');
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    if (path === '/packed/')
      assert(!requests.some((p) => /^\/(core|studio|controls|workspaces)\//.test(p)));
    await page.evaluate(() => window.virtualEditorLab.editor.dispose());
    assert.equal(await page.locator('#editor>*').count(), 0);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  console.log(
    '100000-line source and packed editors: bounded paint, alignment, cached scrolling, edit/undo, resize and IME passed.',
  );
} catch (error) {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await page
    ?.screenshot({ path: resolve(root, 'test-results/nested-properties.png') })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
