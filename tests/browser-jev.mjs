/** Full Studio/real popup workflow with faithful mocked TypeSafe HTTP. Never uses a live API key. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { responseFor } from './jev-fixture.mjs';
const root = resolve(import.meta.dirname, '../dist');
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
        'Content-Type':
          {
            '.js': 'text/javascript',
            '.html': 'text/html',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
          }[extname(file)] || 'text/plain',
      })
      .end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
let browser, page, release;
const errors = [],
  requests = [],
  generatorRequests = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
  await context.route('https://api.typesafe.ai/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      });
    assert.equal(req.headers().authorization, 'Bearer jev-browser-fixture');
    if (req.url().endsWith('/v1/models'))
      return route.fulfill({
        json: { models: [{ name: 'jev-latest', description: 'Fixture', release_date: 'fixture' }] },
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    const body = req.postDataJSON();
    requests.push(body);
    assert(!body.messages);
    assert(!JSON.stringify(body).includes('jev-browser-fixture'));
    assert(Buffer.byteLength(JSON.stringify(body)) <= 20000);
    const prompt = body.state.request || '';
    if (prompt.includes('cancel this run')) await new Promise((r) => (release = r));
    const selections = body.questions.fits
      ? { fits: 0.99 }
      : body.questions.framework
        ? {
            framework: prompt.includes('HTML') ? 'HTML' : 'WPF',
            recipe: 'login:',
            palette: 'blue',
            title: 'Default heading',
          }
        : body.questions.value
          ? { value: '"After"' }
          : body.questions.property
            ? { property: 'Width' }
            : {
                operation: body.state.completed.length
                  ? 'done:'
                  : prompt.includes('bespoke')
                    ? 'generate_new:'
                    : prompt.includes('login starter')
                      ? 'new_document:'
                      : prompt.includes('theme')
                        ? 'command:'
                        : 'set_text:',
                target: 'Button',
                command: 'theme:',
              };
    await route
      .fulfill({
        json: responseFor(body, selections),
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
      .catch(() => {});
  });
  await context.route('https://generator.test/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      });
    assert.equal(req.headers().authorization, 'Bearer generator-browser-fixture');
    const body = req.postDataJSON();
    generatorRequests.push(body);
    assert(!JSON.stringify(body).includes('jev-browser-fixture'));
    await route.fulfill({
      json: {
        model: 'text-fixture',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                source: '<Grid Width="600" Height="400"><TextBlock Text="Bespoke fixture"/></Grid>',
              }),
            },
          },
        ],
      },
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  page = await context.newPage();
  await page.goto(base);
  await page.waitForFunction(() => !!window.xamora?.jev);
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.importText(
      '<Grid Width="600" Height="400"><Button Content="Before" Width="120" Height="40"/></Grid>',
      'Jev-test.xaml',
    );
    s.store.select([s.doc.root.children[0].id]);
    window.jevOriginal = s.store.session.source;
    window.xamora.jev.open('document');
    window.xamora.jev.settings();
  });
  const settings = page.locator('[role=dialog]');
  await settings.locator('[name=apiKey]').fill('jev-browser-fixture');
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
  const panel = page.locator('.jev-workspace');
  await panel.locator('[data-jev-prompt]').fill('Set the button text to "After"');
  await panel.locator('[data-jev-preview]').click();
  await page.waitForFunction(() =>
    document.querySelector('[data-jev-status]').textContent.includes('No network'),
  );
  assert.equal(requests.length, 0);
  // Reproduce the reported unchecked-consent Run flow. It must offer a real
  // action, not a provider-looking error, and must not send until approved.
  await panel.locator('[data-jev-run]').click();
  const consentReview = page.getByRole('dialog', { name: 'Allow Jev to use this context?' });
  await consentReview.waitFor({ state: 'visible' });
  assert((await consentReview.textContent()).includes('https://api.typesafe.ai'));
  assert((await consentReview.textContent()).includes('Current document'));
  assert.equal(requests.length, 0);
  await consentReview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => !window.xamora.jev.status().running);
  assert.equal(requests.length, 0);
  assert.equal(await panel.locator('[data-jev-consent]').isChecked(), false);
  await panel.locator('[data-jev-prompt]').press('Control+Enter');
  await consentReview.waitFor({ state: 'visible' });
  assert.equal(requests.length, 0);
  await mkdir('test-results/ux', { recursive: true });
  await page.screenshot({ path: 'test-results/ux/17-jev-consent.png' });
  await consentReview.getByRole('button', { name: 'Allow and run', exact: true }).click();
  await panel.locator('[data-jev-apply]:not(:disabled)').waitFor();
  assert.equal(await panel.locator('[data-jev-consent]').isChecked(), false);
  assert.equal(await page.evaluate(() => window.xamora.jev.status().awaitingConsent), false);
  assert.equal(
    await page.evaluate(() => window.xamora.studio.doc.root.children[0].props.Content),
    'Before',
  );
  await panel.locator('[data-jev-apply]').click();
  await page.waitForFunction(
    () => window.xamora.studio.doc.root.children[0].props.Content === 'After',
  );
  await page.evaluate(() => window.xamora.studio.command('undo'));
  await page.waitForFunction(
    () => window.xamora.studio.store.session.source === window.jevOriginal,
  );
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem('xamora-jev-settings-v1').includes('jev-browser-fixture'),
    ),
    false,
  );
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem('xamora-jev-session-keys-v1')),
    null,
  );
  console.log(
    'Jev: unchecked Run/keyboard consent, zero-network cancellation, typed HTTP, proposal review and exact undo passed.',
  );

  // A result is not allowed to overwrite any newer source or selection.
  await panel.locator('[data-jev-consent]').check();
  await panel.locator('[data-jev-run]').click();
  await panel.locator('[data-jev-apply]:not(:disabled)').waitFor();
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.store.setProperty([s.doc.root.children[0].id], 'Width', '333');
  });
  await panel.locator('[data-jev-apply]').click();
  await page.waitForFunction(() =>
    document.querySelector('[data-jev-status]').textContent.includes('changed'),
  );
  assert.equal(
    await page.evaluate(() => window.xamora.studio.doc.root.children[0].props.Content),
    'Before',
  );
  assert.equal(
    await page.evaluate(() => window.xamora.studio.doc.root.children[0].props.Width),
    '333',
  );
  await panel.locator('[data-jev-discard]').click();
  await panel.locator('[data-jev-prompt]').fill('cancel this run');
  await panel.locator('[data-jev-consent]').check();
  await panel.locator('[data-jev-run]').click();
  await page.waitForFunction(() => window.xamora.jev.status().running);
  // Wait for the mocked provider to receive the request without a timing sleep.
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const check = () => {
      if (release) resolve();
      else if (Date.now() > deadline) reject(Error('Cancellation request not received'));
      else setImmediate(check);
    };
    check();
  });
  await panel.locator('[data-jev-cancel]').click();
  release();
  release = null;
  await page.waitForFunction(() => !window.xamora.jev.status().running);
  assert.equal(await page.evaluate(() => window.xamora.jev.status().hasProposal), false);

  await panel.locator('[data-jev-scope]').selectOption('application');
  await panel.locator('[data-jev-prompt]').fill('Toggle the application theme');
  const dark = await page.evaluate(() => window.xamora.studio.dark);
  await panel.locator('[data-jev-consent]').check();
  await panel.locator('[data-jev-run]').click();
  await panel.locator('[data-jev-apply]:not(:disabled)').waitFor();
  await panel.locator('[data-jev-apply]').click();
  assert.equal(await page.evaluate(() => window.xamora.studio.dark), !dark);
  await panel.locator('[data-jev-scope]').selectOption('document');
  await panel.locator('[data-jev-prompt]').fill('Create a blue HTML login starter');
  const count = await page.evaluate(() => window.xamora.studio.stores.length);
  await panel.locator('[data-jev-consent]').check();
  await panel.locator('[data-jev-run]').click();
  await panel.locator('[data-jev-apply]:not(:disabled)').waitFor();
  await panel.locator('[data-jev-apply]').click();
  await page.waitForFunction(() => window.xamora.studio.doc.framework === 'HTML');
  assert.equal(await page.evaluate(() => window.xamora.studio.stores.length), count + 1);
  assert(
    (await page.evaluate(() => window.xamora.studio.store.session.source)).includes(
      'type="password"',
    ),
  );
  console.log('Jev: stale responses, cancellation, app commands and native HTML creation passed.');

  await panel.locator('[data-jev-settings]').click();
  await settings.locator('details').last().locator('summary').click();
  await settings.locator('[name=generatorEnabled]').check();
  await settings
    .locator('[name=generatorEndpoint]')
    .fill('https://generator.test/v1/chat/completions');
  await settings.locator('[name=generatorModel]').fill('text-fixture');
  await settings.locator('[name=generatorKey]').fill('generator-browser-fixture');
  await settings.locator('[name=trustDestination]').check();
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
  await panel.locator('[data-jev-prompt]').fill('Create a bespoke WPF view');
  await panel.locator('[data-jev-consent]').check();
  await panel.locator('[data-jev-run]').click();
  await panel.locator('[data-jev-apply]:not(:disabled)').waitFor();
  assert.equal(generatorRequests.length, 1);
  assert((await panel.locator('[data-jev-summary]').textContent()).includes('separate generator'));
  await panel.locator('[data-jev-apply]').click();
  await page.waitForFunction(() => window.xamora.studio.doc.framework === 'WPF');
  assert(
    (await page.evaluate(() => window.xamora.studio.store.session.source)).includes(
      'Bespoke fixture',
    ),
  );
  // The same live prompt UI works in a detached document; settings remain owner-hosted.
  await page.locator('[data-dock-panel="jev"]').click({ button: 'right' });
  const pending = page.waitForEvent('popup');
  await page
    .locator('.dock-menu')
    .getByRole('menuitem', { name: 'Open tab in browser window', exact: true })
    .click();
  const popup = await pending;
  await popup.locator('[data-jev-prompt]').waitFor({ state: 'visible' });
  await popup.locator('[data-jev-preview]').click();
  await popup.waitForFunction(() =>
    document.querySelector('[data-jev-status]').textContent.includes('No network'),
  );
  const beforePopupRun = requests.length;
  await popup.locator('[data-jev-prompt]').fill('Review the selected view');
  await popup.locator('[data-jev-run]').click();
  await consentReview.waitFor({ state: 'visible' });
  assert(
    (await consentReview.textContent()).includes('https://generator.test/v1/chat/completions'),
  );
  assert.equal(requests.length, beforePopupRun);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.xamora.jev.status().running);
  assert.equal(requests.length, beforePopupRun);
  assert.equal(await popup.locator('[data-jev-consent]').isChecked(), false);
  assert.equal(
    await popup.evaluate(
      () => document.activeElement === document.querySelector('[data-jev-prompt]'),
    ),
    true,
  );
  await popup.locator('[data-jev-settings]').click();
  await settings.waitFor({ state: 'visible' });
  assert.equal(await settings.locator('[name=apiKey]').inputValue(), 'jev-browser-fixture');
  await page.keyboard.press('Escape');
  await Promise.all([popup.waitForEvent('close'), popup.locator('[data-browser-return]').click()]);
  await mkdir('test-results/ux', { recursive: true });
  await page.screenshot({ path: 'test-results/ux/16-jev-assistant.png' });
  assert.deepEqual(errors, []);
  console.log(
    'Jev: explicit hybrid generation and detached assistant consent/cancel/focus/settings routing passed. All AI calls were mocked.',
  );
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/jev-error.txt', String(error.stack || error));
  for (const [i, p] of (page?.context().pages() || []).entries()) {
    await p.screenshot({ path: `test-results/jev-${i}.png` }).catch(() => {});
    await writeFile(`test-results/jev-${i}.html`, await p.content().catch(() => ''));
  }
  throw error;
} finally {
  release?.();
  await browser?.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
