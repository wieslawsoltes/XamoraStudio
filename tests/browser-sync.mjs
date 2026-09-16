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
  const input = page.locator('.code-input');
  const replaceToken = async (before, after) => {
    await input.focus();
    await input.evaluate((el, token) => {
      const start = el.value.indexOf(token);
      if (start < 0) throw Error('Missing source token: ' + token);
      el.setSelectionRange(start, start + token.length);
    }, before);
    await page.keyboard.insertText(after);
  };
  const xml = `<Canvas xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Width='640' Height='420'>\n  <!-- keep authored formatting -->\n  <Button x:Name='Primary' Width='120' Height='40' Canvas.Left='20' Canvas.Top='20' Content='Before' />\n  <TextBlock x:Name='Caption' Text='Stable' Canvas.Top='100' />\n</Canvas>`;
  const xaml = await page.evaluate((source) => {
    const s = window.xamora.studio;
    const id = s.importText(source, 'SyncSmoke.xaml');
    s.setView('split');
    const node = s.doc.root.children.find((n) => n.props?.['x:Name'] === 'Primary');
    s.store.select([node.id]);
    return { id, index: s.active, nodeId: node.id };
  }, xml);
  const typed = xml.replace("Content='Before'", "Content='Typed'");
  await input.fill(xml);
  await page.waitForFunction(() => window.xamora.studio.store.session.isValid);
  await replaceToken('Before', 'Typed');
  await page.waitForFunction((id) => {
    const s = window.xamora.studio;
    return (
      s.selected.find((n) => n.id === id)?.props.Content === 'Typed' &&
      s.store.session.isValid &&
      !s.sync.renderFrame &&
      s.renderer.elements.get(id)?.textContent.includes('Typed')
    );
  }, xaml.nodeId);
  assert.equal(await input.inputValue(), typed, 'valid typing keeps authored source');
  assert.ok(
    await page.evaluate(
      (id) => window.xamora.studio.renderer.elements.get(id)?.textContent.includes('Typed'),
      xaml.nodeId,
    ),
    'XAML preview renders source change',
  );
  assert.deepEqual(
    await page.evaluate(() => window.xamora.studio.store.selection),
    [xaml.nodeId],
    'source application retains selected element',
  );

  // Edit a real inspector field, then verify source and undo across surfaces.
  const width = page.locator('[data-inspector-host="design"] input[data-prop="Width"]').first();
  await width.fill('180');
  await width.dispatchEvent('change');
  await page.waitForFunction(() => {
    const s = window.xamora.studio;
    return s.selected[0]?.props.Width === '180' && !s.sync.renderFrame;
  });
  assert.match(await input.inputValue(), /Width='180'/);
  assert.ok((await input.inputValue()).includes('<!-- keep authored formatting -->'));
  await page.evaluate(() => window.xamora.studio.command('undo'));
  assert.equal(await input.inputValue(), typed, 'undo inspector returns exact typed source');
  await input.focus();
  await input.press('Control+z');
  await page.waitForFunction((id) => {
    const s = window.xamora.studio;
    return (
      s.selected[0]?.props.Content === 'Before' &&
      !s.sync.renderFrame &&
      s.renderer.elements.get(id)?.textContent.includes('Before')
    );
  }, xaml.nodeId);
  await input.press('Control+Shift+z');
  await page.waitForFunction((id) => {
    const s = window.xamora.studio;
    return (
      s.selected[0]?.props.Content === 'Typed' &&
      !s.sync.renderFrame &&
      s.renderer.elements.get(id)?.textContent.includes('Typed')
    );
  }, xaml.nodeId);

  // Canvas command uses the same session, selection and source history.
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.nudge('ArrowRight', 1);
  });
  await page.waitForFunction(() => window.xamora.studio.selected[0]?.props['Canvas.Left'] === '21');
  assert.match(await input.inputValue(), /Canvas.Left=['"]21['"]/);
  const valid = await input.inputValue(),
    invalid = valid.replace('</Canvas>', '');
  await input.fill(invalid);
  await page.waitForFunction(() => !window.xamora.studio.store.session.isValid);
  const rejected = await page.evaluate(() => {
    const s = window.xamora.studio;
    const before = s.selected[0].props.Width;
    s.setProps(s.store.selection, 'Width', '999');
    return s.selected[0].props.Width === before;
  });
  assert.equal(rejected, true, 'invalid source blocks visual mutation');
  assert.equal(await input.inputValue(), invalid, 'blocked visual edit preserves source draft');
  await page.evaluate(() => window.xamora.studio.switchDocument(0));
  await page.evaluate((index) => window.xamora.studio.switchDocument(index), xaml.index);
  assert.equal(await input.inputValue(), invalid, 'document switch restores invalid source draft');
  await input.fill(valid);
  await page.waitForFunction(() => window.xamora.studio.store.session.isValid);
  await page.evaluate((id) => window.xamora.studio.store.select([id]), xaml.nodeId);

  // An immediate panel action must observe the preceding input revision.
  const racing = valid.replace("Content='Typed'", "Content='Racing'");
  await page.evaluate((text) => {
    const s = window.xamora.studio;
    s.editor.input.value = text;
    s.editor.input.setSelectionRange(text.indexOf('Racing'), text.indexOf('Racing'));
    s.editor.input.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText' }),
    );
    s.setProps(s.store.selection, 'Height', '52');
  }, racing);
  assert.equal(await page.evaluate(() => window.xamora.studio.selected[0].props.Content), 'Racing');
  assert.match(await input.inputValue(), /Height=['"]52['"]/);
  const composed = await page.evaluate(() => {
    const s = window.xamora.studio,
      el = s.editor.input,
      documentId = s.doc.id;
    el.focus();
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.value = el.value.replace('Racing', 'Composed');
    el.setSelectionRange(el.value.indexOf('Composed'), el.value.indexOf('Composed') + 8);
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, isComposing: true, data: 'Composed' }),
    );
    s.render();
    let rejected = false;
    try {
      s.store.setProperty(s.store.selection, 'Width', '999');
    } catch {
      rejected = true;
    }
    s.switchDocument(0);
    return {
      documentId,
      active: s.doc.id,
      rejected,
      buffer: el.value,
      committed: s.store.session.source,
    };
  });
  assert.equal(composed.active, composed.documentId, 'IME draft blocks document switching');
  assert.equal(composed.rejected, true, 'IME draft blocks direct store visual mutation');
  assert.ok(composed.buffer.includes('Composed'));
  assert.ok(
    !composed.committed.includes('Composed'),
    'composition does not publish partial semantic state',
  );
  await input.dispatchEvent('compositionend', { data: 'Composed' });
  await page.waitForFunction((id) => {
    const s = window.xamora.studio;
    return (
      s.store.session.source.includes('Composed') &&
      s.store.session.isValid &&
      !s.sync.renderFrame &&
      s.renderer.elements.get(id)?.textContent.includes('Composed')
    );
  }, xaml.nodeId);
  await replaceToken("Width='640'", "Width='800'");
  await page.waitForFunction(
    () =>
      !window.xamora.studio.sync.renderFrame &&
      window.xamora.studio.doc.design.width === 800 &&
      document.querySelector('#artboard').style.width === '800px',
  );
  await input.press('Control+z');
  await page.waitForFunction(
    () =>
      !window.xamora.studio.sync.renderFrame &&
      window.xamora.studio.doc.design.width === 640 &&
      document.querySelector('#artboard').style.width === '640px',
  );
  console.log(
    'PASS XAML: source, rendered canvas, inspector, shared history, invalid draft, document switching, immediate edit race, IME, artboard dimensions',
  );

  const html = `<!doctype html>\n<html lang='en'><head><title>Sync</title><style>button { color: rgb(10, 20, 30); }</style></head><body>\n<!-- preserve HTML comment -->\n<button id='action' style='width: 120px; height: 40px;'>Before</button><p id='stable'>Untouched</p>\n</body></html>`;
  const htmlId = await page.evaluate((source) => {
    const s = window.xamora.studio;
    s.importText(source, 'sync.html');
    s.setView('split');
    let id;
    const visit = (n) => {
      if (n.props?.id === 'action') id = n.id;
      (n.children || []).forEach(visit);
    };
    visit(s.doc.root);
    s.store.select([id]);
    return id;
  }, html);
  const htmlTyped = html.replace('>Before<', '>Typed HTML<');
  await input.fill(html);
  await page.waitForFunction(() => window.xamora.studio.store.session.isValid);
  await replaceToken('Before', 'Typed HTML');
  await page.waitForFunction((id) => {
    const s = window.xamora.studio;
    return (
      !s.sync.renderFrame && s.renderer.htmlRenderer?.elements.get(id)?.textContent === 'Typed HTML'
    );
  }, htmlId);
  assert.equal(await input.inputValue(), htmlTyped);
  assert.deepEqual(await page.evaluate(() => window.xamora.studio.store.selection), [htmlId]);
  // Text and comment AST nodes navigate to their nearest selectable owner.
  const textSelection = await page.evaluate(() => {
    const s = window.xamora.studio,
      body = s.doc.root.children.find((n) => n.type === 'body'),
      sibling = body.children.find((n) => n.props?.id === 'stable');
    s.store.select([sibling.id]);
    const caret = s.editor.input.value.indexOf('Typed HTML') + 3;
    s.editor.input.focus();
    s.editor.input.setSelectionRange(caret, caret);
    s.editor.cursor(true);
    return {
      kind: s.store.session.nodeAtOffset(caret)?.kind,
      selection: s.store.selection,
      caret: s.editor.input.selectionStart,
      expectedCaret: caret,
    };
  });
  assert.equal(textSelection.kind, 'text', 'the probe is strictly inside a text AST node');
  assert.deepEqual(
    textSelection.selection,
    [htmlId],
    'caret inside HTML text selects its owning button',
  );
  assert.equal(
    textSelection.caret,
    textSelection.expectedCaret,
    'selection synchronization preserves the text caret',
  );
  const commentSelection = await page.evaluate(() => {
    const s = window.xamora.studio,
      body = s.doc.root.children.find((n) => n.type === 'body'),
      caret = s.editor.input.value.indexOf('preserve HTML comment') + 4;
    s.editor.input.setSelectionRange(caret, caret);
    s.editor.cursor(true);
    return {
      kind: s.store.session.nodeAtOffset(caret)?.kind,
      selection: s.store.selection,
      owner: body.id,
    };
  });
  assert.equal(commentSelection.kind, 'comment');
  assert.deepEqual(
    commentSelection.selection,
    [commentSelection.owner],
    'caret inside a comment selects its containing element',
  );
  await page.evaluate((id) => window.xamora.studio.store.select([id]), htmlId);
  const cssWidth = page.locator('[data-inspector-host="design"] [data-html-css="width"]').first();
  await cssWidth.fill('190px');
  await cssWidth.dispatchEvent('change');
  await page.waitForFunction(() => window.xamora.studio.store.session.source.includes('190px'));
  assert.ok((await input.inputValue()).includes('<!-- preserve HTML comment -->'));
  await page.waitForFunction(
    (id) =>
      !window.xamora.studio.sync.renderFrame &&
      Math.round(
        window.xamora.studio.renderer.htmlRenderer?.elements.get(id)?.getBoundingClientRect().width,
      ) === 190,
    htmlId,
  );
  await page.evaluate(() => window.xamora.studio.command('undo'));
  assert.equal(
    await input.inputValue(),
    htmlTyped,
    'HTML property undo returns typed text with original quotes',
  );
  await input.focus();
  await input.press('Control+z');
  await page.waitForFunction(
    (id) =>
      !window.xamora.studio.sync.renderFrame &&
      window.xamora.studio.renderer.htmlRenderer?.elements.get(id)?.textContent === 'Before',
    htmlId,
  );
  await input.press('Control+Shift+z');
  await page.waitForFunction(
    (id) =>
      !window.xamora.studio.sync.renderFrame &&
      window.xamora.studio.renderer.htmlRenderer?.elements.get(id)?.textContent === 'Typed HTML',
    htmlId,
  );
  const malformed = htmlTyped.replace("id='action'", "id='action");
  await input.fill(malformed);
  await page.waitForFunction(
    (id) =>
      !window.xamora.studio.store.session.isValid &&
      !window.xamora.studio.sync.renderFrame &&
      window.xamora.studio.renderer.htmlRenderer?.elements.get(id)?.textContent === 'Typed HTML',
    htmlId,
  );
  assert.equal(
    await page.evaluate(
      (id) => window.xamora.studio.renderer.htmlRenderer?.elements.get(id)?.textContent,
      htmlId,
    ),
    'Typed HTML',
    'malformed HTML retains last valid preview',
  );
  await input.fill(htmlTyped);
  await page.waitForFunction(
    (id) =>
      window.xamora.studio.store.session.isValid &&
      !window.xamora.studio.sync.renderFrame &&
      window.xamora.studio.renderer.htmlRenderer?.elements.get(id)?.textContent === 'Typed HTML',
    htmlId,
  );
  console.log(
    'PASS HTML: native parser, typed source, text/comment owner selection, iframe render, CSS inspector, shared history, malformed-source retention',
  );
  assert.deepEqual(runtimeErrors, [], 'no uncaught browser errors');
  console.log('Browser synchronization integration passed.');
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
    await writeFile('test-results/browser-sync-failure.json', JSON.stringify(diagnostics, null, 2));
    await page
      .screenshot({ path: 'test-results/browser-sync-failure.png', fullPage: true })
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
