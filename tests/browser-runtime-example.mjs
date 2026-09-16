/** Standalone runtime example and real custom-element lifecycle integration. */
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
const browserBundle = resolve(root, '../packages/runtime/dist/browser/index.js');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/package-runtime/') {
      response
        .writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
        .end(
          '<!doctype html><html><head><title>Packed runtime test</title><link rel="icon" href="data:,"></head><body><main id="packed-app"></main><script type="module">window.bundleRuntime = await import("/package-runtime/index.js");</script></body></html>',
        );
      return;
    }
    if (pathname === '/package-runtime/index.js') {
      response
        .writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' })
        .end(await readFile(browserBundle));
      return;
    }
    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    response
      .writeHead(200, {
        'Content-Type': mime[extname(file)] || 'text/plain',
        'Cache-Control': 'no-store',
      })
      .end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser, page;
const errors = [],
  requests = [];
try {
  browser = await playwright.chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('request', (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(base + '/examples/StandaloneApp/');
  await page.waitForFunction(() => !!window.launchboard?.application, null, { timeout: 30000 });
  assert.equal(await page.locator('#runtime-status').textContent(), 'Runtime connected');
  assert.equal(
    await page.getByRole('button', { name: 'Add task', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.locator('.launch-status').textContent(), 'In progress');
  await page.getByTitle('Project name', { exact: true }).fill('Browser launch');
  await page.waitForFunction(
    () => window.launchboard.application.data.Project.Title === 'Browser launch',
  );
  assert.equal(
    await page.getByText('Browser launch', { exact: true }).count(),
    1,
    'text binding refreshed from the input',
  );
  assert.ok((await page.locator('#model-output').textContent()).includes('Browser launch'));
  await page.getByTitle('Project owner', { exact: true }).fill('Taylor Reed');
  await page.waitForFunction(
    () => window.launchboard.application.data.Project.Owner === 'Taylor Reed',
  );

  await page.getByTitle('New task title', { exact: true }).fill('Verify the standalone package');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await page.waitForFunction(() => window.launchboard.application.data.Tasks.length === 5);
  assert.equal(await page.getByTitle('New task title', { exact: true }).inputValue(), '');
  assert.equal(
    await page.getByRole('button', { name: 'Add task', exact: true }).isDisabled(),
    true,
  );
  await page.getByTitle('Task title', { exact: true }).last().fill('Verify the packed application');
  await page.getByTitle('Complete task', { exact: true }).last().locator('input').check();
  await page.waitForFunction(() => window.launchboard.application.data.Progress === 60);
  assert.equal(await page.getByText('60%', { exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Remove', exact: true }).last().click();
  await page.waitForFunction(() => window.launchboard.application.data.Tasks.length === 4);
  assert.equal(await page.getByText('50%', { exact: true }).count(), 1);
  console.log(
    'PASS standalone example: input-to-model-to-view, custom control, item-template edits, commands and canExecute',
  );

  const colorBefore = await page
    .getByRole('button', { name: 'Preview celebration', exact: true })
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await page.getByRole('button', { name: 'Switch accent', exact: true }).click();
  await page.waitForFunction(() => window.launchboard.application.data.Accent === '#178572');
  const colorAfter = await page
    .getByRole('button', { name: 'Preview celebration', exact: true })
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  assert.notEqual(colorAfter, colorBefore, 'application resource change reaches styled controls');
  assert.equal(colorAfter, 'rgb(23, 133, 114)');
  await page.getByRole('button', { name: 'Toggle state', exact: true }).click();
  await page.waitForFunction(
    () =>
      Number(getComputedStyle(window.launchboard.application.findName('SummaryCard')).opacity) <
      0.5,
  );
  await page.getByRole('button', { name: 'Toggle state', exact: true }).click();
  await page.waitForFunction(
    () =>
      Number(getComputedStyle(window.launchboard.application.findName('SummaryCard')).opacity) >
      0.99,
  );
  await page.getByRole('button', { name: 'Preview celebration', exact: true }).click();
  const motion = await page.evaluate(() => {
    const app = window.launchboard.application;
    const player = [...app.players].at(-1);
    player.pause();
    player.seek(0.15);
    return {
      count: app.players.size,
      opacity: Number(getComputedStyle(app.findName('SummaryCard')).opacity),
    };
  });
  assert.ok(motion.count > 0);
  assert.ok(
    motion.opacity > 0.45 && motion.opacity < 1,
    'storyboard samples a visible intermediate opacity',
  );
  console.log(
    'PASS standalone example: live resources/theme, generated state transitions and storyboard sampling',
  );

  await page.getByRole('button', { name: 'Dispose', exact: true }).click();
  assert.equal(await page.locator('#runtime-status').textContent(), 'Runtime disposed');
  assert.equal(await page.evaluate(() => window.launchboard.application), undefined);
  await page.getByRole('button', { name: 'Remount', exact: true }).click();
  await page.waitForFunction(() => !!window.launchboard.application);
  assert.equal(
    await page.getByTitle('Project name', { exact: true }).inputValue(),
    'Browser launch',
  );
  assert.equal(await page.getByTitle('Project owner', { exact: true }).inputValue(), 'Taylor Reed');
  await page.locator('#data-tab').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#source-tab').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#source-output').isVisible(), true);
  assert.ok((await page.locator('#source-output').textContent()).includes('<launch:StatusBadge'));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    'example has no page overflow on a narrow viewport',
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  assert.ok(
    !requests.some(
      (path) =>
        path === '/app.js' ||
        path.startsWith('/studio/') ||
        /^\/styles\/(studio|features|editor|docking|motion|density)\.css$/.test(path),
    ),
    'standalone example loads no studio entry point, modules or styles',
  );
  console.log(
    'PASS standalone example: disposal/remount, retained data, keyboard tabs, compact viewport and no studio dependencies',
  );

  const lifecycle = await page.evaluate(async () => {
    const { registerXamlElement } = await import('/core/runtime-element.js');
    const { ObservableState } = await import('/core/runtime-properties.js');
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const settle = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const source =
      '<StackPanel xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><TextBox x:Name="Editor" Text="{Binding Name, Mode=TwoWay, UpdateSourceTrigger=PropertyChanged}"/><TextBlock x:Name="Label" Text="{Binding Name}"/></StackPanel>';
    registerXamlElement('test-xaml-view', { source, data: { Name: 'Default' } });
    const first = document.createElement('test-xaml-view'),
      second = document.createElement('test-xaml-view');
    document.body.append(first, second);
    await settle();
    check(first.application && second.application, 'custom element connects automatically');
    const state = first.application.state;
    first.data.Name = 'Independent';
    await settle();
    check(second.data.Name === 'Default', 'plain default data is independent across elements');
    check(first.shadowRoot.querySelector('[part="application"]'), 'default host uses shadow DOM');
    for (let index = 0; index < 4; index++) {
      const previous = first.application;
      first.remove();
      check(
        first.application === null && previous.disposed,
        'disconnect disposes previous application',
      );
      document.body.append(first);
      await settle();
      check(
        first.application.state === state,
        'reconnect reuses ObservableState without wrapping old proxies',
      );
      first.data.Name = 'Reconnect ' + index;
      await settle();
      check(
        first.application.findName('Label').textContent === 'Reconnect ' + index,
        'reconnected binding remains observable',
      );
    }
    const snapshot = state.snapshot();
    await first.reload();
    check(
      first.application.state === state && first.data.Name === snapshot.Name,
      'reload keeps the existing observable state',
    );
    const live = first.application;
    let failure;
    first.addEventListener('xamora-error', (event) => {
      failure = event.detail.error;
    });
    first.source = '<Grid';
    await settle();
    check(
      failure && first.application === live && !live.disposed,
      'invalid replacement reports error and preserves mounted application',
    );
    first.source = source;
    await settle();
    const shared = new ObservableState({ Name: 'Shared' });
    first.data = shared;
    second.data = shared;
    await settle();
    shared.data.Name = 'Together';
    await settle();
    check(
      first.application.findName('Label').textContent === 'Together' &&
        second.application.findName('Label').textContent === 'Together',
      'explicit ObservableState sharing synchronizes hosts',
    );
    first.remove();
    second.remove();
    check(first.application === null && second.application === null, 'test hosts are disposed');
    registerXamlElement('inline-xaml-view');
    const inline = document.createElement('inline-xaml-view');
    inline.data.Name = 'Before connect';
    const script = document.createElement('script');
    script.type = 'application/xaml';
    script.textContent = '<TextBlock Text="{Binding Name}"/>';
    inline.append(script);
    document.body.append(inline);
    await settle();
    check(
      inline.shadowRoot.textContent.includes('Before connect'),
      'pre-connect data mutations survive mounting inline source',
    );
    script.textContent = '<TextBlock Text="Reloaded inline source"/>';
    await inline.reload();
    check(
      inline.shadowRoot.textContent.includes('Reloaded inline source'),
      'reload rereads inline source',
    );
    inline.remove();
    const pending = new Map();
    const fetcher = (url, { signal }) =>
      new Promise((resolve) => pending.set(new URL(url).pathname, { resolve, signal }));
    registerXamlElement('fetch-xaml-view', { fetch: fetcher });
    const fetched = document.createElement('fetch-xaml-view');
    fetched.setAttribute('src', '/first.xaml');
    document.body.append(fetched);
    fetched.setAttribute('src', '/second.xaml');
    pending.get('/second.xaml').resolve(new Response('<TextBlock Text="Second"/>'));
    await settle();
    check(fetched.shadowRoot.textContent.includes('Second'), 'latest src mounts');
    pending.get('/first.xaml').resolve(new Response('<TextBlock Text="Stale"/>'));
    await settle();
    check(pending.get('/first.xaml').signal.aborted, 'replacing src aborts old request');
    check(
      fetched.shadowRoot.textContent.includes('Second') &&
        !fetched.shadowRoot.textContent.includes('Stale'),
      'late response cannot replace current source even if fetch ignores abort',
    );
    fetched.setAttribute('src', '/third.xaml');
    fetched.remove();
    pending.get('/third.xaml').resolve(new Response('<TextBlock Text="Detached"/>'));
    await settle();
    check(
      fetched.application === null && pending.get('/third.xaml').signal.aborted,
      'disconnection aborts in-flight fetch and prevents remount',
    );
    return { reconnections: 4, retainedState: true, isolatedDefaults: true, sharedState: true };
  });
  assert.equal(lifecycle.reconnections, 4);
  await page.evaluate(async () => {
    const { registerXamlElement } = await import('/core/runtime-element.js');
    registerXamlElement('typing-xaml-view', {
      source: '<TextBox Text="{Binding Value, Mode=TwoWay, UpdateSourceTrigger=PropertyChanged}"/>',
      data: { Value: '' },
    });
    document.body.append(document.createElement('typing-xaml-view'));
  });
  const shadowInput = page.locator('typing-xaml-view input');
  await shadowInput.pressSequentially('Shadow typing', { delay: 20 });
  assert.equal(
    await shadowInput.inputValue(),
    'Shadow typing',
    'successive typing retains focus through shadow-root refreshes',
  );
  await page.evaluate(() => document.querySelector('typing-xaml-view').remove());
  assert.deepEqual(
    await page.evaluate(() =>
      window.launchboard.application.diagnostics.filter((issue) => issue.severity === 'error'),
    ),
    [],
  );
  assert.deepEqual(errors, [], 'no unhandled browser errors');
  console.log(
    'PASS custom element: shadow host, independent defaults, repeated reconnect, retained state, invalid-source recovery, explicit state sharing, stale fetch prevention and focus retention',
  );
  await mkdir('test-results', { recursive: true });
  await page.locator('#data-tab').click();
  await page.screenshot({ path: 'test-results/standalone-runtime.png', fullPage: true });
  const bundled = await browser.newPage();
  const bundledRequests = [];
  bundled.on('pageerror', (error) => errors.push(error.stack || error.message));
  bundled.on('request', (request) => bundledRequests.push(new URL(request.url()).pathname));
  await bundled.goto(base + '/package-runtime/');
  await bundled.waitForFunction(() => !!window.bundleRuntime, null, { timeout: 30000 });
  await bundled.evaluate(() => {
    const { createApplication } = window.bundleRuntime;
    window.bundledApp = createApplication({
      source: `<StackPanel xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:pkg="urn:package-test">
        <TextBox x:Name="Input" AutomationProperties.Name="Package value" Text="{Binding Value, Mode=TwoWay, UpdateSourceTrigger=PropertyChanged}"/>
        <TextBlock x:Name="ValueLabel" Text="{Binding Value}"/>
        <TextBlock x:Name="CountLabel" Text="{Binding Count}"/>
        <pkg:Badge Text="{Binding Value}"/>
        <Button Content="Run packaged command" Command="Increment" Background="{DynamicResource Accent}"/>
      </StackPanel>`,
      data: { Value: 'Packed runtime', Count: 0 },
      resources: { Accent: '#176B57' },
      commands: {
        Increment: (_parameter, { data }) => {
          data.Count++;
        },
      },
      plugins: [
        {
          setup(app) {
            return app.registry.registerControl({
              type: 'pkg:Badge',
              category: 'Package test',
              render({ properties }) {
                const badge = document.createElement('span');
                badge.className = 'package-badge';
                badge.textContent = properties.Text;
                return badge;
              },
            });
          },
        },
      ],
    });
    window.bundledApp.mount(document.querySelector('#packed-app'));
  });
  await bundled.getByRole('textbox', { name: 'Package value' }).fill('One browser bundle');
  await bundled.getByRole('button', { name: 'Run packaged command' }).click();
  await bundled.waitForFunction(
    () =>
      window.bundledApp.data.Value === 'One browser bundle' &&
      window.bundledApp.findName('CountLabel').textContent === '1',
  );
  assert.equal(await bundled.locator('.package-badge').textContent(), 'One browser bundle');
  await bundled.evaluate(() => window.bundledApp.setResource('Accent', '#6542A4'));
  await bundled.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('#packed-app button')).backgroundColor ===
      'rgb(101, 66, 164)',
  );
  await bundled.evaluate(async () => {
    const { registerXamlElement } = window.bundleRuntime;
    registerXamlElement('packed-xaml-view', {
      source: '<TextBlock Text="{Binding Value}"/>',
      data: { Value: 'Bundled custom element' },
    });
    const host = document.createElement('packed-xaml-view');
    document.body.append(host);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (!host.shadowRoot.textContent.includes('Bundled custom element'))
      throw new Error('Bundled custom element did not mount.');
    const app = host.application;
    host.remove();
    if (!app.disposed) throw new Error('Bundled custom element did not dispose.');
    window.bundledApp.dispose();
  });
  assert.deepEqual(
    [...new Set(bundledRequests)].sort(),
    ['/package-runtime/', '/package-runtime/index.js'],
    'browser artifact runs without package resolution or additional runtime/studio modules',
  );
  await bundled.close();
  assert.deepEqual(
    errors,
    [],
    'standalone source and bundled entry have no unhandled browser errors',
  );
  console.log(
    'PASS browser package entry: one bundle, two-way binding, command, resource update, custom control and custom-element lifecycle without external modules',
  );
  console.log('Standalone runtime browser integration passed.');
} catch (error) {
  if (page) {
    await mkdir('test-results', { recursive: true });
    await writeFile(
      'test-results/browser-runtime-example-failure.json',
      JSON.stringify(
        {
          error: error.stack || error.message,
          errors,
          body: await page.locator('body').innerText(),
        },
        null,
        2,
      ),
    );
    await page
      .screenshot({ path: 'test-results/browser-runtime-example-failure.png', fullPage: true })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
