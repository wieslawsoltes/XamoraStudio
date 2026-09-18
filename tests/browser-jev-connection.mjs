/** Actual HTTPS Studio -> actual HTTP bridge; no browser request interception.
 * Only server-to-server provider inference is a fixture. The temporary certificate is
 * trusted in this test context only. CORS, mixed-content and origin checks stay enabled.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createHTTPS } from 'node:https';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { readFile, stat, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { createAIServer } from '../scripts/serve-ai.mjs';
import { responseFor } from './jev-fixture.mjs';

const token = 'bridge-fixture-private-token-1234567890';
const root = resolve(import.meta.dirname, '../dist');
const upstream = [],
  network = [],
  denied = [],
  errors = [],
  connectionDiagnostics = [];
const servers = [];
const certificate = await mkdtemp(resolve(tmpdir(), 'xamora-test-tls-'));
let browser, page;
const listen = async (server) => {
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
};
try {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      resolve(certificate, 'key.pem'),
      '-out',
      resolve(certificate, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  // Routing a fake HTTPS origin with Playwright also intercepts CORS preflights.
  // Use actual TLS/static serving so even the negative control observes native OPTIONS.
  const studio = createHTTPS(
    {
      key: await readFile(resolve(certificate, 'key.pem')),
      cert: await readFile(resolve(certificate, 'cert.pem')),
    },
    async (req, res) => {
      try {
        const pathname = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
        if (!pathname.startsWith('/XamoraStudio/')) throw Error('Outside application');
        let file = resolve(root, '.' + pathname.slice('/XamoraStudio'.length));
        if (file !== root && !file.startsWith(root + sep)) throw Error('Outside root');
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
    },
  );
  const origin = 'https://127.0.0.1:' + (await listen(studio));
  const url = origin + '/XamoraStudio/';
  const bridge = createAIServer({
    allowedOrigins: [origin],
    authToken: token,
    allowClientKeys: true,
    fetch: async (url, options) => {
      upstream.push({ url, options });
      assert.equal(options.headers.Authorization, 'Bearer browser-fixture-key');
      assert.equal(options.headers['X-Xamora-AI-Token'], undefined);
      if (url.endsWith('/models')) return Response.json({ models: [{ name: 'jev-latest' }] });
      const body = JSON.parse(options.body);
      assert(!options.body.includes(token));
      assert(!options.body.includes('browser-fixture-key'));
      return Response.json(
        responseFor(
          body,
          body.questions.framework
            ? { framework: 'WPF', recipe: 'login:', palette: 'blue', title: 'Default heading' }
            : { operation: body.state.completed.length ? 'done:' : 'new_document:' },
        ),
      );
    },
  });

  bridge.on('request', (req) =>
    network.push({ method: req.method, origin: req.headers.origin, path: req.url }),
  );
  const blocked = createServer((req, res) => {
    denied.push(req.method);
    res.writeHead(400).end('Origin not allowed');
  });
  const bridgeBase = 'http://127.0.0.1:' + (await listen(bridge)) + '/api/jev';
  const blockedBase = 'http://127.0.0.1:' + (await listen(blocked));
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
    ignoreHTTPSErrors: true,
  });
  // A test-only certificate exception is not a CORS or network-security bypass.
  await context.grantPermissions(['local-network-access'], { origin });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') connectionDiagnostics.push(m.text());
  });
  page.on('requestfailed', (r) =>
    connectionDiagnostics.push({ url: r.url(), failure: r.failure() }),
  );
  await page.goto(url);
  await page.waitForFunction(() => !!window.xamora?.jev);
  // Prove native CORS enforcement remains on: denied OPTIONS prevents POST at another origin.
  const deniedFetch = await page.evaluate(async (base) => {
    try {
      await fetch(base + '/v1/systemone', {
        method: 'POST',
        headers: { Authorization: 'Bearer unused', 'Content-Type': 'application/json' },
        body: '{}',
      });
      return false;
    } catch (e) {
      return e.name === 'TypeError';
    }
  }, blockedBase);
  assert(deniedFetch);
  assert(
    denied.includes('OPTIONS'),
    JSON.stringify({
      browser: browser.version(),
      denied,
      network,
      connectionDiagnostics,
      state: await page.evaluate(async () => {
        const permissions = {};
        for (const name of ['local-network-access', 'loopback-network', 'local-network']) {
          try {
            permissions[name] = (await navigator.permissions.query({ name })).state;
          } catch (e) {
            permissions[name] = e.message;
          }
        }
        return { secure: isSecureContext, origin: location.origin, permissions };
      }),
    }),
  );
  assert(!denied.includes('POST'));
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.importText(
      '<UserControl xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Width="1100" Height="760"><Grid /></UserControl>',
      'Connection-test.xaml',
    );
    window.originalConnectionSource = s.store.session.source;
    window.originalConnectionCount = s.stores.length;
    localStorage.setItem('connection-workspace-marker', 'keep-this-workspace');
    window.xamora.jev.open('document');
    window.xamora.jev.settings();
  });
  let settings = page.getByRole('dialog', { name: 'Jev AI settings', exact: true });
  await settings.locator('[name=endpoint]').fill(blockedBase);
  await settings.locator('[name=endpoint]').press('Tab');
  await settings.locator('[name=trustDestination]').check();
  await settings.locator('[name=apiKey]').fill('browser-fixture-key');
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
  const panel = page.locator('.jev-workspace');
  await panel.locator('[data-jev-prompt]').fill('Create a login page');
  await panel.locator('[data-jev-run]').click();
  await page.getByRole('button', { name: 'Allow and run', exact: true }).click();
  await panel.locator('[data-jev-connection-setup]').waitFor({ state: 'visible' });
  assert.match(await panel.locator('[data-jev-status]').textContent(), /local AI bridge/);
  assert(denied.includes('OPTIONS'));
  assert(!denied.includes('POST'), 'The rejected preflight must prevent a real inference POST');
  const deniedCount = denied.length;
  assert.equal(upstream.length, 0);
  await panel.locator('[data-jev-connection-setup]').click();
  settings = page.getByRole('dialog', { name: 'Jev AI settings', exact: true });
  assert(await settings.locator('[data-jev-bridge-instructions]').evaluate((n) => n.open));
  assert(
    (await settings.locator('[data-jev-bridge-command]').textContent()).includes('--allow-origin='),
  );
  await settings.locator('[data-jev-local-bridge]').click();
  assert.equal(await settings.locator('[name=apiKey]').inputValue(), '');
  assert.equal(await settings.locator('[name=proxyToken]').inputValue(), '');
  await settings.locator('[name=endpoint]').fill(bridgeBase + '/v1/systemone');
  await settings.locator('[name=endpoint]').press('Tab');
  await settings.locator('[name=apiKey]').fill('browser-fixture-key');
  await settings.locator('[name=proxyToken]').fill(token);
  await settings.locator('[name=trustDestination]').check();
  await settings.locator('[data-jev-test]').click();
  await page.waitForFunction(() =>
    document.querySelector('[data-jev-test-status]')?.textContent.includes('Connected.'),
  );
  assert.equal(upstream.length, 1, 'Model discovery does not send document context or inference');
  assert(network.some((r) => r.method === 'OPTIONS' && r.origin === origin));
  await settings.locator('.jev-connection').scrollIntoViewIfNeeded();
  await mkdir('test-results/ux', { recursive: true });
  await page.screenshot({ path: 'test-results/ux/18-jev-connection-setup.png' });
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.xamora.studio.jev.preferences.value.endpoint),
    bridgeBase,
  );
  await panel.locator('[data-jev-run]').click();
  const review = page.getByRole('dialog', { name: 'Allow Jev to use this context?', exact: true });
  assert((await review.textContent()).includes(bridgeBase));
  assert.equal(upstream.length, 1);
  await review.getByRole('button', { name: 'Allow and run', exact: true }).click();
  await panel.locator('[data-jev-apply]:not(:disabled)').waitFor();
  assert.equal(
    await page.evaluate(() => window.xamora.studio.store.session.source),
    await page.evaluate(() => window.originalConnectionSource),
  );
  await panel.locator('[data-jev-apply]').click();
  await page.waitForFunction(
    () => window.xamora.studio.stores.length === window.originalConnectionCount + 1,
  );
  assert.match(await page.evaluate(() => window.xamora.studio.store.session.source), /PasswordBox/);
  assert.equal(page.url(), url);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('connection-workspace-marker')),
    'keep-this-workspace',
  );
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  assert(!stored.includes(token));
  assert(!stored.includes('browser-fixture-key'));
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem('xamora-jev-session-keys-v1')),
    null,
  );
  assert.equal(
    denied.length,
    deniedCount,
    'No fallback or hidden request after switching to the approved bridge',
  );
  assert.deepEqual(errors, []);
  console.log(
    'Jev connection: HTTPS-origin Studio, real CORS/preflight, rejected origin, explicit bridge setup, model discovery, consent, reviewed login starter and unchanged workspace origin passed. Provider inference remained a fixture.',
  );
} catch (e) {
  await mkdir('test-results', { recursive: true });
  await writeFile(
    'test-results/jev-connection-error.txt',
    String(e.stack || e) +
      '\n' +
      JSON.stringify({ network, denied, connectionDiagnostics }, null, 2),
  );
  await page?.screenshot({ path: 'test-results/jev-connection-failure.png' }).catch(() => {});
  throw e;
} finally {
  await browser?.close();
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  await rm(certificate, { recursive: true, force: true });
}
