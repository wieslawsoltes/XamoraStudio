/** Capture privacy, physical RTL geometry, group opacity and live state in source and package. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
let browser;
const watchdog = setTimeout(() => {
  process.exitCode = 1;
  void browser?.close();
}, 90000);
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--disable-dev-shm-usage'],
  });
  for (const entry of process.env.XAMORA_FIDELITY_SOURCE_ONLY === '1'
    ? ['source']
    : ['source', 'package']) {
    const bundle = await build({
      stdin: {
        contents:
          entry === 'source'
            ? `export * from './dist/core/compiler-browser.js';export * from './dist/core/semantic-compiler.js';`
            : `export * from './packages/compiler/dist/esm/index.js';`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
    });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<!doctype html><html><head></head><body></body></html>');
    const report = await page.evaluate(async (code) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const api = await import(url);
      URL.revokeObjectURL(url);
      const check = (condition, message) => {
        if (!condition) throw Error(message);
      };
      const all = (node) => [node, ...(node.children || []).flatMap(all)];
      const named = (result, id) =>
        all(result.document.root).find((node) => node.props?.['x:Name'] === id);
      document.head.innerHTML =
        '<style>body{margin:0}*{box-sizing:border-box}main{display:flex;direction:rtl;gap:12px;width:420px;height:180px;opacity:.5}section{width:140px;height:100px;opacity:.4;background:#eee}input{width:120px;height:40px}p{font:16px Arial}</style>';
      document.body.innerHTML =
        '<form id="outside"></form><main id="root"><section id="first">Direct text</section><input type="PaSsWoRd" id="password" value="authored-secret"><input id="edit" form="outside" value="initial"></main>';
      const root = document.getElementById('root');
      const password = document.getElementById('password');
      password.value = 'live-secret';
      const original = root.outerHTML;
      for (const framework of ['WPF', 'Avalonia']) {
        for (const preserveMetadata of [false, true]) {
          const result = api.compileRenderedDocument(root, { framework, preserveMetadata });
          check(result.success, JSON.stringify(result.diagnostics));
          check(
            !JSON.stringify(result).includes('live-secret') &&
              !JSON.stringify(result).includes('authored-secret'),
            'password leaked',
          );
          check(
            named(result, 'password').type ===
              (framework === 'Avalonia' ? 'TextBox' : 'PasswordBox'),
            'password type',
          );
          check(
            named(result, 'root').props.FlowDirection === 'LeftToRight',
            'physical geometry must not mirror',
          );
          check(
            named(result, 'first').props.FlowDirection === 'LeftToRight',
            'child physical geometry must not mirror',
          );
          for (const id of ['first', 'password', 'edit']) {
            const bounds = document.getElementById(id).getBoundingClientRect();
            check(
              Math.abs(
                Number(named(result, id).props['Canvas.Left']) -
                  (bounds.x - root.getBoundingClientRect().x),
              ) < 0.01,
              id + ' RTL x',
            );
          }
          const text = all(named(result, 'first')).find((n) => n.type === 'TextBlock');
          check(
            text && Number(text.props.Opacity ?? 1) === 1,
            'direct text duplicates parent opacity',
          );
          check(text.props.FlowDirection === 'RightToLeft', 'text direction lost');
          check(Number(named(result, 'first').props.Opacity) === 0.4, 'group opacity lost');
          check(
            root.outerHTML === original && password.value === 'live-secret',
            'capture changed source',
          );
        }
        const included = api.compileRenderedDocument(root, {
          framework,
          includePasswordValues: true,
          preserveMetadata: false,
        });
        const props = named(included, 'password').props;
        check(
          props[framework === 'Avalonia' ? 'Text' : 'Password'] === 'live-secret',
          'opt-in value lost',
        );
        const back = api.compileDocument(included.document, { preserveMetadata: false });
        const parsed = new DOMParser().parseFromString(back.source, 'text/html');
        check(
          parsed.getElementById('password').type === 'password',
          'reverse conversion unmasked password',
        );
      }
      const choice = document.createElement('select');
      choice.id = 'empty';
      choice.innerHTML = '<option selected>A</option><option>B</option>';
      const mixed = document.createElement('input');
      mixed.type = 'checkbox';
      mixed.id = 'mixed';
      root.append(choice, mixed);
      choice.selectedIndex = -1;
      mixed.indeterminate = true;
      for (const framework of ['WPF', 'Avalonia']) {
        const r = api.compileRenderedDocument(root, { framework, preserveMetadata: false });
        check(named(r, 'empty').props.SelectedIndex === '-1', 'empty selection reverted');
        check(named(r, 'mixed').props.IsChecked === '{x:Null}', 'mixed checkbox became false');
        check(named(r, 'mixed').props.IsThreeState === 'True', 'tri-state missing');
      }
      let latest,
        count = 0;
      const observer = api.observeRenderedDocument(root, {
        preserveMetadata: false,
        onResult(result) {
          latest = result;
          count++;
        },
      });
      const input = document.getElementById('edit');
      input.value = 'edited';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const wait = () =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await wait();
      check(named(latest, 'edit').props.Text === 'edited', 'live edit not captured');
      document.getElementById('outside').reset();
      await wait();
      check(
        input.value === 'initial' && named(latest, 'edit').props.Text === 'initial',
        'external form reset stale',
      );
      observer.dispose();
      const ended = count;
      input.value = 'late';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('outside').reset();
      await wait();
      check(count === ended, 'late callbacks');
      return { privacy: true, rtl: true, opacity: true, forms: true, teardown: true };
    }, bundle.outputFiles[0].text);
    assert.deepEqual(report, {
      privacy: true,
      rtl: true,
      opacity: true,
      forms: true,
      teardown: true,
    });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${entry}: capture privacy, RTL, opacity, form reset and teardown passed.`);
  }
} finally {
  clearTimeout(watchdog);
  await browser?.close();
}
