/** Differential checks against actual browser cascade, including reverse edits. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
let browser;
const watchdog = setTimeout(() => {
  console.error('Logical CSS suite exceeded 90 seconds.');
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
    const source =
      entry === 'source'
        ? "export * from './dist/core/semantic-compiler.js';export * from './dist/core/compiler-browser.js';"
        : "export * from './packages/compiler/dist/esm/index.js';";
    const bundle = await build({
      stdin: { contents: source, resolveDir: process.cwd() },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
    });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><html><head></head><body></body></html>');
    const report = await page.evaluate(async (code) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const api = await import(url);
      URL.revokeObjectURL(url);
      const check = (condition, message) => {
        if (!condition) throw Error(message);
      };
      const named = (result, id = 'target') => {
        const visit = (n) =>
          n.props?.['x:Name'] === id ? n : n.children?.map(visit).find(Boolean);
        const found = visit(result.document.root);
        check(found, 'Missing ' + id);
        return found;
      };
      const set = (body, css = '') => {
        document.head.innerHTML = '<style>' + css + '</style>';
        document.body.innerHTML = body;
      };
      const from = (framework) =>
        api.compileDocument(document.documentElement.outerHTML, {
          from: 'html',
          Parser: DOMParser,
          framework,
          environment: { type: 'screen', width: 800, height: 600 },
        });
      const number = (actual, expected, message) =>
        check(
          Number.isFinite(Number(actual)) && Math.abs(Number(actual) - parseFloat(expected)) < 0.02,
          `${message}: ${actual} != ${expected}`,
        );
      const thickness = (value) => {
        const [left, top = left, right = left, bottom = top] = String(value).split(',').map(Number);
        return [left, top, right, bottom];
      };
      let checks = 0;
      const compare = (result) => {
        check(result.success, JSON.stringify(result.diagnostics));
        const p = named(result).props,
          c = getComputedStyle(document.getElementById('target'));
        for (const [native, css] of [
          ['Width', 'width'],
          ['Height', 'height'],
          ['MinWidth', 'minWidth'],
          ['MinHeight', 'minHeight'],
          ['MaxWidth', 'maxWidth'],
          ['MaxHeight', 'maxHeight'],
        ])
          if (p[native] !== undefined && p[native] !== 'Auto') number(p[native], c[css], native);
        for (const [native, prefix, suffix] of [
          ['Padding', 'padding', ''],
          ['Margin', 'margin', ''],
          ['BorderThickness', 'border', 'Width'],
        ]) {
          if (p[native] === undefined) continue;
          const a = thickness(p[native]);
          for (const [i, side] of ['Left', 'Top', 'Right', 'Bottom'].entries())
            number(a[i], c[prefix + side + suffix], native + side);
        }
        for (const side of ['Left', 'Top', 'Right', 'Bottom']) {
          const value = p['Canvas.' + side];
          if (value !== undefined) number(value, c[side.toLowerCase()], side);
        }
        checks++;
      };
      const reset =
        'display:block;box-sizing:content-box;width:160px;height:80px;min-width:0;min-height:0;max-width:1000px;max-height:1000px;padding:0;margin:0;border-style:solid;border-width:0;position:absolute;';
      const cases = [
        'padding-inline:3px 7px;padding-left:12px',
        'padding-left:12px;padding-inline:3px 7px',
        'padding-inline:3px 7px!important;padding-right:12px',
        'margin-inline-start:4px;margin:2px 3px;margin-inline-end:8px',
        'border-width:1px;border-inline-width:2px 6px;border-block-start-width:4px',
        '--pair:3px 9px;padding-inline:var(--pair);padding-block:4px 8px',
        'inset:1px 2px 3px 4px;inset-inline:8px auto',
        'inline-size:180px;block-size:90px;min-inline-size:17px;max-block-size:300px',
        'width:170px;inline-size:190px!important;width:200px',
        'padding-inline:3px 8px;padding-inline:1px 2px 3px',
        'padding:7px;--bad:inherit 4px;padding-inline:var(--bad)',
        'padding:7px;--bad:initial 4px 5px;padding:var(--bad)',
      ];
      for (const framework of ['WPF', 'Avalonia'])
        for (const mode of [
          'horizontal-tb',
          'vertical-rl',
          'vertical-lr',
          'sideways-rl',
          'sideways-lr',
        ])
          for (const direction of ['ltr', 'rtl'])
            for (const value of cases) {
              set(
                `<button id="target" style="${reset}${value};writing-mode:${mode};--flow:${direction};direction:var(--flow)">T</button>`,
              );
              const result = from(framework);
              compare(result);
              if (mode !== 'horizontal-tb')
                check(
                  result.losses.some((d) => d.code === 'CSS_WRITING_MODE'),
                  'vertical flow must remain a loss',
                );
            }
      let seed = 73419;
      const random = (n) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % n;
      };
      const declarations = [
        'padding-left',
        'padding-right',
        'padding-top',
        'padding-inline-start',
        'padding-block-end',
        'padding',
        'padding-inline',
        'margin-left',
        'margin-inline',
        'margin-inline-start',
        'margin-block',
        'border-width',
        'border-inline-width',
        'border-right-width',
        'width',
        'inline-size',
        'block-size',
        'height',
      ];
      for (let index = 0; index < 96; index++) {
        let css = reset;
        for (let j = 0; j < 12; j++)
          css += `${declarations[random(declarations.length)]}:${20 + random(30)}px${random(3) === 0 ? '!important' : ''};`;
        css += 'direction:' + (random(2) ? 'rtl' : 'ltr');
        set(`<button id="target" style="${css}">T</button>`);
        compare(from(index % 2 ? 'WPF' : 'Avalonia'));
      }
      for (const framework of ['WPF', 'Avalonia']) {
        set(
          `<button id="target" style="${reset}direction:rtl">T</button>`,
          '@layer base,theme;@layer base{#target{padding-inline:3px 9px!important;inline-size:70px!important}} @layer theme{#target{padding-right:20px!important}} @media(width>=600px){#target{block-size:60px!important}}',
        );
        compare(from(framework));
        const result = from(framework);
        named(result).props.Padding = '11,13,17,19';
        named(result).props.Width = '210';
        const back = api.compileDocument(result.document);
        const parsed = new DOMParser().parseFromString(back.source, 'text/html');
        set(parsed.body.innerHTML, parsed.head.querySelector('style')?.textContent || '');
        // Retain every returned stylesheet, including the authored important layer rules.
        document.head.innerHTML = parsed.head.innerHTML;
        const computed = getComputedStyle(document.getElementById('target'));
        number(210, computed.width, 'edited width');
        for (const [side, value] of [
          ['Left', 11],
          ['Top', 13],
          ['Right', 17],
          ['Bottom', 19],
        ])
          number(value, computed['padding' + side], 'edited ' + side);
        compare(from(framework));
      }
      set('<p id="target" style="writing-mode:vertical-rl;inline-size:100px">Vertical text</p>');
      const captured = api.compileRenderedDocument(document.getElementById('target'));
      check(
        captured.losses.some((d) => d.code === 'CSS_WRITING_MODE'),
        'capture cannot silently claim vertical native text',
      );
      return { checks, reverseEdits: 2, captureDiagnostic: true };
    }, bundle.outputFiles[0].text);
    assert.deepEqual(report, { checks: 340, reverseEdits: 2, captureDiagnostic: true });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Logical CSS ${entry}: ${report.checks} computed-layout comparisons, two important reverse edits and vertical capture diagnostic passed.`,
    );
  }
} finally {
  clearTimeout(watchdog);
  await browser?.close();
}
