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
  await page.waitForFunction(() => !!window.xamora?.studio?.html?.motion, { timeout: 30000 });
  const source = `<!doctype html>\n<html><head><title>Animation proof</title><style>/* Keep this rule. */\nbody { padding:40px; }\nbutton { width:160px; height:60px; border:0; }</style></head><body><button id='target' style='opacity: 1; background-color: rgb(255, 0, 0);'>Animate</button></body></html>`;
  const targetId = await page.evaluate((text) => {
    const s = window.xamora.studio;
    s.importText(text, 'animation-proof.html');
    s.setView('split');
    const n = s.doc.root.children
      .find((n) => n.type === 'body')
      .children.find((n) => n.props?.id === 'target');
    s.store.select([n.id]);
    s.docking.showTimeline();
    return n.id;
  }, source);
  const ready = async () => {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    return page.waitForFunction((id) => {
      const s = window.xamora.studio,
        r = s.renderer.htmlRenderer;
      return r?.elements.has(id) && s.html.motion.preview?.document === r.frame?.contentDocument;
    }, targetId);
  };
  await ready();
  const created = await page.evaluate(() =>
    window.xamora.studio.html.motion.create({
      name: 'fadeProof',
      duration: 1000,
      easing: 'linear',
      fill: 'both',
      iterations: 1,
      frames: [
        { offset: 0, values: { opacity: '0', transform: 'translateX(0px)' } },
        { offset: 1, values: { opacity: '1', transform: 'translateX(100px)' } },
      ],
    }),
  );
  assert.ok(created?.definitionId, 'timeline creates authored CSS keyframes');
  await ready();
  await page.waitForFunction(() =>
    window.xamora.studio.html.motion.preview.animations.some(
      (a) => a.animationName === 'fadeProof',
    ),
  );
  const measure = () =>
    page.evaluate((id) => {
      const s = window.xamora.studio,
        el = s.renderer.htmlRenderer.elements.get(id),
        css = el.ownerDocument.defaultView.getComputedStyle(el);
      return {
        opacity: Number(css.opacity),
        x: new DOMMatrix(css.transform).m41,
        revision: s.store.revision,
        style: s.doc.root.children.find((n) => n.type === 'body').children.find((n) => n.id === id)
          .props.style,
        source: s.store.session.source,
      };
    }, targetId);
  const authored = await measure();
  await page.evaluate(() => window.xamora.studio.html.motion.seek(500));
  const half = await measure();
  assert.ok(Math.abs(half.opacity - 0.5) < 0.02, 'browser interpolates opacity at midpoint');
  assert.ok(Math.abs(half.x - 50) < 1, 'browser interpolates transform at midpoint');
  assert.equal(half.revision, authored.revision);
  assert.equal(half.source, authored.source, 'scrubbing never changes authored source');
  assert.equal(half.style, authored.style, 'scrubbing preserves base inline styles');
  const timing = page.locator('[data-hm-timing="duration"]');
  await timing.fill('2000');
  await timing.dispatchEvent('change');
  await ready();
  await page.waitForFunction(
    () =>
      window.xamora.studio.html.motion.preview.animations
        .find((a) => a.animationName === 'fadeProof')
        ?.effect.getTiming().duration === 2000,
  );
  assert.ok(
    (await page.locator('.code-input').inputValue()).includes('2000ms'),
    'timing UI syncs into source',
  );
  await page.evaluate(() => window.xamora.studio.command('undo'));
  await ready();
  assert.ok(
    !(await page.locator('.code-input').inputValue()).includes('2000ms'),
    'undo restores animation timing',
  );
  await page.evaluate(() => window.xamora.studio.command('redo'));
  await ready();
  await page.evaluate((id) => {
    const s = window.xamora.studio;
    s.store.select([id]);
    s.html.motion.seek(1000);
    s.html.motion.toggleRecord();
  }, targetId);
  const opacity = page.locator('[data-inspector-host="design"] [data-html-css="opacity"]').first();
  await opacity.fill('0.25');
  await opacity.dispatchEvent('change');
  await ready();
  await page.waitForFunction(() =>
    window.xamora.studio.html.motion.catalog.definitions.some(
      (d) =>
        d.name === 'fadeProof' &&
        d.frames.some((f) => f.offset === 0.5 && f.values.opacity === '0.25'),
    ),
  );
  const recorded = await measure();
  assert.match(recorded.style, /opacity:\s*1\s*;/, 'recording leaves authored base opacity intact');
  assert.ok(recorded.source.includes('50%'), 'recorded keyframe is CSS source');
  await page.evaluate(() => window.xamora.studio.html.motion.toggleRecord());
  await page.evaluate(() => window.xamora.studio.command('undo'));
  await ready();
  assert.equal(
    await page.evaluate(() =>
      window.xamora.studio.html.motion.catalog.definitions
        .find((d) => d.name === 'fadeProof')
        .frames.some((f) => f.offset === 0.5),
    ),
    false,
    'recorded property and frame undo atomically',
  );
  await page.evaluate(() => window.xamora.studio.command('redo'));
  await ready();
  await page.evaluate(() => window.xamora.studio.docking.control.show('xaml'));
  const input = page.locator('.code-input'),
    changed = (await input.inputValue()).replace('opacity: 0.25', 'opacity: 0.75');
  await input.fill(changed);
  await ready();
  await page.waitForFunction(() =>
    window.xamora.studio.html.motion.catalog.definitions
      .find((d) => d.name === 'fadeProof')
      ?.frames.some((f) => f.offset === 0.5 && f.values.opacity === '0.75'),
  );
  await page.evaluate(() => window.xamora.studio.html.motion.seek(1000));
  assert.ok(
    Math.abs((await measure()).opacity - 0.75) < 0.02,
    'source keyframe edits update native preview',
  );
  await page.evaluate((id) => {
    const s = window.xamora.studio;
    s.store.select([id]);
    s.docking.control.show('properties');
    s.html.motion.seek(1000);
    s.html.motion.toggleRecord();
  }, targetId);
  await ready();
  const beforeRemoval = await measure();
  await opacity.fill('');
  await opacity.dispatchEvent('change');
  await ready();
  await page.waitForFunction(() =>
    window.xamora.studio.html.motion.catalog.definitions
      .find((d) => d.name === 'fadeProof')
      ?.frames.some((f) => f.offset === 0.5 && f.values.opacity === '1'),
  );
  assert.equal(
    (await measure()).style,
    beforeRemoval.style,
    'recording removal preserves exact authored base styles',
  );
  await page.evaluate(() => window.xamora.studio.html.motion.toggleRecord());
  await page.evaluate(() => window.xamora.studio.command('undo'));
  await ready();
  assert.equal(
    await page.evaluate(
      () =>
        window.xamora.studio.html.motion.catalog.definitions
          .find((d) => d.name === 'fadeProof')
          .frames.find((f) => f.offset === 0.5).values.opacity,
    ),
    '0.75',
    'removed property recording undoes as one edit',
  );
  await page.evaluate(() => window.xamora.studio.docking.showTimeline());
  const key = page.locator('[data-hm-key][aria-label="Keyframe 50.0 percent"]').first();
  await key.scrollIntoViewIfNeeded();
  const keyBox = await key.boundingBox(),
    laneBox = await key.locator('..').boundingBox();
  await page.mouse.move(keyBox.x + keyBox.width / 2, keyBox.y + keyBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    keyBox.x + keyBox.width / 2 + laneBox.width * 0.1,
    keyBox.y + keyBox.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  await ready();
  await page.waitForFunction(() =>
    window.xamora.studio.html.motion.catalog.definitions
      .find((d) => d.name === 'fadeProof')
      .frames.some((f) => Math.abs(f.offset - 0.6) < 0.01 && f.values.opacity === '0.75'),
  );
  assert.ok((await input.inputValue()).includes('60%'), 'dragging a keyframe updates CSS offsets');
  const revision = await page.evaluate(() => window.xamora.studio.store.revision);
  await page.locator('[data-hm-play]').click();
  await page.waitForFunction(() => window.xamora.studio.html.motion.time > 1250);
  await page.locator('[data-hm-play]').click();
  assert.equal(
    await page.evaluate(() => window.xamora.studio.store.revision),
    revision,
    'play/pause leaves document history unchanged',
  );
  await page.evaluate(() => window.xamora.studio.html.preview());
  const frame = await (
    await page.locator('#html-preview-device iframe').elementHandle()
  ).contentFrame();
  await frame.waitForFunction(() =>
    document.getAnimations().some((a) => a.animationName === 'fadeProof'),
  );
  assert.equal(
    await frame.evaluate(
      () =>
        document.getAnimations().find((a) => a.animationName === 'fadeProof').playState ===
        'paused',
    ),
    false,
    'export preview retains authored running state',
  );
  assert.ok(
    (await input.inputValue()).includes('/* Keep this rule. */'),
    'unrelated CSS is preserved through all edits',
  );
  assert.deepEqual(runtimeErrors, [], 'no uncaught browser errors');
  console.log(
    'Browser HTML animation integration passed: CSS creation, native interpolation, timing, record, undo/redo, source edits, removed-property recording, keyframe drag, playback and isolated export preview.',
  );
} catch (error) {
  if (page) {
    await mkdir('test-results', { recursive: true });
    await page
      .screenshot({ path: 'test-results/browser-html-motion-failure.png', fullPage: true })
      .catch(() => {});
    console.error('Browser errors:', runtimeErrors);
    console.error(
      'HTML motion status:',
      await page
        .locator('#html-animation-panel footer')
        .textContent()
        .catch(() => ''),
    );
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
