/** Qualify restored profiles and privacy/lifecycle behavior in source and built packages. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
let browser;
const watchdog = setTimeout(() => {
  process.exitCode = 1;
  console.error('Recovered compiler browser suite exceeded 90 seconds.');
  void browser?.close();
}, 90000);
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--disable-dev-shm-usage'],
  });
  for (const entry of ['dist/core/compiler-browser.js', 'packages/compiler/dist/esm/index.js']) {
    const bundle = await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
    });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setContent(`<!doctype html><html><head><style>
      #root{width:500px}#preference{color:rgb(0,0,255)}
      @media(prefers-color-scheme:dark){#preference{color:rgb(255,0,0)}}
    </style></head><body><main id="root"><input type="password" id="secret" value="authored-secret"><input id="plain" value="normal"><p id="preference">Theme</p></main></body></html>`);
    const report = await page.evaluate(async (code) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const api = await import(url);
      URL.revokeObjectURL(url);
      const check = (value, message) => {
        if (!value) throw Error(message);
      };
      const named = (result, name) => {
        const visit = (node) =>
          node.props?.['x:Name'] === name ? node : node.children?.map(visit).find(Boolean);
        return visit(result.document.root)?.props;
      };
      const root = document.querySelector('#root');
      const input = document.querySelector('#secret');
      input.value = 'current-secret';
      const markup = root.outerHTML;
      for (const framework of ['WPF', 'Avalonia'])
        for (const preserveMetadata of [true, false]) {
          const result = api.compileRenderedDocument(root, { framework, preserveMetadata });
          check(result.success, 'Redacted snapshot failed');
          check(
            (named(result, 'secret')[framework === 'WPF' ? 'Password' : 'Text'] ?? '') === '',
            'Password was not redacted',
          );
          check(!JSON.stringify(result).includes('current-secret'), 'Cleartext password leaked');
          check(!JSON.stringify(result).includes('authored-secret'), 'Authored password leaked');
          check(named(result, 'plain').Text === 'normal', 'Ordinary input lost');
          const consent = api.compileRenderedDocument(root, {
            framework,
            includePasswordValues: true,
          });
          check(
            named(consent, 'secret')[framework === 'WPF' ? 'Password' : 'Text'] ===
              'current-secret',
            'Explicit opt-in not honored',
          );
        }
      check(
        root.outerHTML === markup && input.value === 'current-secret',
        'Capture mutated source',
      );
      const source =
        '<html><head><style>#profile{width:10vw}@media(width<500px){#profile{height:32px}}</style></head><body><button id="profile">Size</button></body></html>';
      const variants = api.compileResponsiveVariants(source, {
        environment: { viewport: { width: 2000, height: 2000 } },
        variants: [
          { name: 'phone', width: 380, height: 700 },
          { name: 'wide', width: 900, height: 600 },
        ],
      });
      check(variants.success, 'Profiles failed');
      check(named(variants.profiles[0].result, 'profile').Width === '38', 'Stale narrow viewport');
      check(named(variants.profiles[1].result, 'profile').Width === '90', 'Stale wide viewport');
      window.recoveredCapture = { notices: 0, errors: [], named };
      const state = window.recoveredCapture;
      state.observer = api.observeRenderedDocument(root, {
        observeMedia: ['(pointer:coarse)'],
        onResult(result) {
          state.last = result;
          state.notices++;
        },
        onError(error) {
          state.errors.push(error.message);
        },
      });
      return { privacy: true, profiles: true };
    }, bundle.outputFiles[0].text);
    assert.deepEqual(report, { privacy: true, profiles: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(
      () =>
        window.recoveredCapture
          .named(window.recoveredCapture.last, 'preference')
          .Foreground.toLowerCase() === '#ffff0000',
    );
    const notices = await page.evaluate(() => {
      const state = window.recoveredCapture;
      state.observer.dispose();
      state.observer.dispose();
      return state.notices;
    });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => window.recoveredCapture.notices), notices);
    assert.deepEqual(await page.evaluate(() => window.recoveredCapture.errors), []);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Recovered compiler ${entry}: password privacy, profiles and media lifecycle passed.`,
    );
  }
} finally {
  clearTimeout(watchdog);
  await browser?.close();
}
