/** Real Chromium HTML animation integration. Run: node tests/browser-html-motion.mjs. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
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
const runtimeErrors = [];
try {
  browser = await playwright.chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => !!window.xamora?.studio?.html?.states, { timeout: 30000 });
  const source = `<!doctype html><html><head><title>States proof</title><style>/* Preserve this stylesheet. */ button { transition: opacity 400ms linear; } #target:focus { outline: 3px solid purple; }</style></head><body><button id="target" style="opacity: 1; width: 140px; height: 45px; position: absolute; left: 40px; top: 90px;">Target</button><button id="trigger">Toggle state</button></body></html>`;
  const ids = await page.evaluate((text) => {
    const s = window.xamora.studio;
    s.importText(text, 'states-proof.html');
    const children = s.doc.root.children.find((n) => n.type === 'body').children;
    const target = children.find((n) => n.props?.id === 'target'),
      trigger = children.find((n) => n.props?.id === 'trigger');
    s.store.select([target.id]);
    s.html.states.show();
    return { target: target.id, trigger: trigger.id };
  }, source);
  const ready = async () => {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.waitForFunction((id) => {
      const s = window.xamora.studio,
        r = s.renderer.htmlRenderer;
      return r?.elements.has(id) && s.html.states.preview?.document === r.frame?.contentDocument;
    }, ids.target);
  };
  const measure = () =>
    page.evaluate((id) => {
      const s = window.xamora.studio,
        el = s.renderer.htmlRenderer.elements.get(id),
        node = s.store.session.nodeAtOffset(s.store.session.source.indexOf('id="target"'));
      return {
        opacity: Number(el.ownerDocument.defaultView.getComputedStyle(el).opacity),
        style:
          node?.props.style ||
          s.doc.root.children.find((n) => n.type === 'body').children.find((n) => n.id === id).props
            .style,
        revision: s.store.revision,
        source: s.store.session.source,
      };
    }, ids.target);
  await ready();
  const baseSnapshot = await measure();
  const hover = await page.evaluate(() =>
    window.xamora.studio.html.states.create({
      kind: 'hover',
      values: { opacity: '0.4', left: '40px', top: '90px' },
    }),
  );
  await ready();
  assert.ok(hover.id);
  assert.ok(
    Math.abs((await measure()).opacity - 0.4) < 0.02,
    'state preview renders CSS over preserved inline base values',
  );
  assert.equal((await measure()).style, baseSnapshot.style);
  const revision = await page.evaluate(() => window.xamora.studio.store.revision);
  await page.evaluate(() => window.xamora.studio.html.states.reset());
  assert.equal((await measure()).opacity, 1);
  assert.equal(
    await page.evaluate(() => window.xamora.studio.store.revision),
    revision,
    'state preview does not enter history',
  );
  await page.evaluate((id) => {
    const w = window.xamora.studio.html.states;
    w.selectState(id);
    w.toggleRecord();
  }, hover.id);
  await ready();
  const opacity = page.locator('[data-inspector-host="design"] [data-html-css="opacity"]').first();
  await page.evaluate(() => window.xamora.studio.docking.control.show('properties'));
  await opacity.fill('0.2');
  await opacity.dispatchEvent('change');
  await ready();
  assert.equal(
    (await measure()).style,
    baseSnapshot.style,
    'state recording preserves exact base styles',
  );
  assert.ok(Math.abs((await measure()).opacity - 0.2) < 0.02);
  await page.evaluate(() => {
    window.xamora.studio.html.states.toggleRecord();
    window.xamora.studio.command('undo');
  });
  await ready();
  assert.match(
    await page.evaluate(() => window.xamora.studio.html.states.state.values.opacity),
    /^0\.4/,
    'state recording undoes once',
  );
  await page.evaluate(() => window.xamora.studio.command('redo'));
  await ready();
  await page.evaluate(() => window.xamora.studio.docking.control.show('xaml'));
  const code = page.locator('.code-input');
  const changed = (await code.inputValue()).replace('opacity: 0.2', 'opacity: 0.6');
  await code.fill(changed);
  await ready();
  await page.evaluate(
    ({ target, stateId }) => {
      const s = window.xamora.studio;
      s.store.select([target]);
      s.html.states.show();
      s.html.states.selectState(stateId);
    },
    { target: ids.target, stateId: hover.id },
  );
  await ready();
  assert.ok(
    Math.abs((await measure()).opacity - 0.6) < 0.02,
    'source state edits update visual preview',
  );
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.docking.control.show('document:' + s.doc.id);
    s.html.states.toggleRecord();
  });
  await ready();
  const designFrame = page.frameLocator('#artboard iframe'),
    targetCanvas = designFrame.locator('#target');
  const startBox = await targetCanvas.boundingBox();
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    startBox.x + startBox.width / 2 + 30,
    startBox.y + startBox.height / 2 + 20,
    { steps: 6 },
  );
  const duringBox = await targetCanvas.boundingBox();
  assert.ok(
    duringBox.x > startBox.x + 20,
    'state recording moves the visible canvas element during dragging',
  );
  await page.mouse.up();
  await ready();
  assert.equal(
    (await measure()).style,
    baseSnapshot.style,
    'state canvas drag preserves base positioning',
  );
  assert.ok(
    await page.evaluate(() => parseFloat(window.xamora.studio.html.states.state.values.left) > 40),
    'canvas position is recorded in state CSS',
  );
  await page.evaluate(() => {
    window.xamora.studio.html.states.toggleRecord();
    window.xamora.studio.command('undo');
  });
  await ready();
  await page.evaluate(() => window.xamora.studio.html.states.show());
  await ready();
  const duration = page.locator(
    '#html-states-panel [data-hs-transition="0"] [data-hs-transition-field="duration"]',
  );
  await duration.fill('600');
  await duration.dispatchEvent('change');
  await ready();
  assert.ok((await code.inputValue()).includes('600ms'), 'transition editor writes source');
  await page.evaluate(() => window.xamora.studio.html.states.trigger());
  await page.waitForFunction(
    (id) =>
      window.xamora.studio.renderer.htmlRenderer.elements
        .get(id)
        .getAnimations()
        .some((a) => a.transitionProperty === 'opacity'),
    ids.target,
  );
  await page.waitForTimeout(90);
  const midway = (await measure()).opacity;
  assert.ok(midway > 0.6 && midway < 1, 'native CSS transitions interpolate state changes');
  const transitionRevision = await page.evaluate(() => window.xamora.studio.store.revision);
  await page.evaluate(() => window.xamora.studio.html.states.reset());
  assert.equal(await page.evaluate(() => window.xamora.studio.store.revision), transitionRevision);
  const named = await page.evaluate(() =>
    window.xamora.studio.html.states.create({
      kind: 'named',
      name: 'expanded',
      values: { opacity: '0.3' },
    }),
  );
  await ready();
  await page.selectOption('[data-hs-trigger-node]', ids.trigger);
  await page.selectOption('[data-hs-event]', 'click');
  await page.selectOption('[data-hs-action]', 'toggle');
  await page.locator('[data-hs-bind-interaction]').click();
  await ready();
  assert.ok((await code.inputValue()).includes('data-xamora-state-actions'));
  await page.evaluate(() => window.xamora.studio.html.preview());
  const frame = await (
    await page.locator('#html-preview-device iframe').elementHandle()
  ).contentFrame();
  await frame.locator('#trigger').click();
  await frame.waitForFunction(
    () => document.getElementById('target').getAttribute('data-xamora-state') === 'expanded',
  );
  await frame.waitForFunction(
    () =>
      Math.abs(Number(getComputedStyle(document.getElementById('target')).opacity) - 0.3) < 0.03,
  );
  assert.ok(
    Math.abs(
      (await frame.locator('#target').evaluate((el) => Number(getComputedStyle(el).opacity))) - 0.3,
    ) < 0.03,
    'exported click binding activates named state',
  );
  await frame.locator('#trigger').click();
  await frame.waitForFunction(
    () => !document.getElementById('target').hasAttribute('data-xamora-state'),
  );
  await page.evaluate(() => window.xamora.studio.closeModal());
  await page.evaluate(async () =>
    window.xamora.studio.menus.commands.get('html-interaction-example').run(),
  );
  await page.waitForFunction(
    () =>
      window.xamora.studio.doc.name === 'HtmlInteractionLab.html' &&
      window.xamora.studio.html.states.catalog.states.length >= 7,
  );
  await page.setViewportSize({ width: 1366, height: 768 });
  const previewControl = page.locator('[data-hs-preview]');
  await previewControl.scrollIntoViewIfNeeded();
  assert.ok(
    await previewControl.evaluate((el) => {
      const r = el.getBoundingClientRect(),
        hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit === el || el.contains(hit);
    }),
    'compact state panel controls remain hittable above the footer',
  );
  const malformed =
    '<html><head></head><body><button data-xamora-state-actions="{">Malformed authored JSON</button></body></html>';
  await page.evaluate((text) => {
    const s = window.xamora.studio;
    s.importText(text, 'malformed-actions.html');
    s.html.states.show();
  }, malformed);
  await page.waitForFunction(
    () =>
      window.xamora.studio.doc.name === 'malformed-actions.html' &&
      document.querySelector('#html-states-panel footer').textContent.includes('malformed'),
  );
  assert.equal(
    await page.evaluate(() => window.xamora.studio.store.session.source),
    malformed,
    'malformed action JSON remains editable source',
  );
  assert.deepEqual(runtimeErrors, [], 'state editing has no uncaught browser errors');
  console.log(
    'HTML states browser passed: preview, record, base preservation, source sync, atomic undo/redo, native transitions, exported click binding, compact panel access, malformed action recovery and interaction example.',
  );
} catch (error) {
  if (page) {
    await mkdir('test-results', { recursive: true });
    await page
      .screenshot({ path: 'test-results/browser-html-states-failure.png', fullPage: true })
      .catch(() => {});
    console.error('Browser errors:', runtimeErrors);
    console.error(
      'HTML states status:',
      await page
        .locator('#html-states-panel footer')
        .textContent()
        .catch(() => ''),
    );
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
