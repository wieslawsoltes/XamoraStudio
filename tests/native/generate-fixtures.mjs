/** Generate trusted qualification fixtures with the actual compiler, never hand-authored target XAML. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { compileDocument } from '../../dist/core/semantic-compiler.js';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const Parser = new Window().DOMParser;
const output = resolve('test-results/native');
const cases = [];
for (const framework of ['WPF', 'Avalonia'])
  for (const width of [360, 960])
    for (const preserveMetadata of [false, true]) {
      const source = `<!doctype html><html><head><link rel="stylesheet" href="../css/base.css"><style>
  @layer base,theme;@layer theme{button{height:44px!important}}@supports(display:grid){#layout{display:grid;grid-template-columns:200px 200px}}
  @media (width >= 600px){button:is(#target,.unused){width:180px}}@media(width < 600px){button{width:80px}}
  #layout:has(>textarea) > button:nth-child(1){padding-left:9px}
  </style></head><body><div id="layout" style="width:400px;height:300px">
  <button id="target">Caption</button><textarea id="edit" readonly style="width:150px;height:70px">first\nsecond</textarea>
  <select id="choice" style="width:120px;height:30px"><option>A</option><option selected>B</option></select>
  <input id="password" style="width:140px" type="password" value="explicit fixture value"/><p id="rich" style="font-size:18px">One <strong>bold</strong> end</p></div></body></html>`;
      const result = compileDocument(source, {
        from: 'html',
        Parser,
        framework,
        preserveMetadata,
        baseUrl: 'https://fixture.invalid/views/main.html',
        environment: { width, height: 600, type: 'screen', supports: { 'display:grid': true } },
        stylesheets: {
          'https://fixture.invalid/css/base.css':
            '@import "spacing.css" layer(base);@layer base{button{height:36px!important}}',
          'https://fixture.invalid/css/spacing.css': 'button{padding:4px 6px}',
        },
      });
      if (!result.success) throw Error(JSON.stringify(result.diagnostics));
      if (
        result.losses.some((d) =>
          ['CONDITIONAL_CSS', 'DYNAMIC_SELECTOR', 'EXTERNAL_CSS', 'NATIVE_PROPERTY'].includes(
            d.code,
          ),
        )
      )
        throw Error(JSON.stringify(result.losses));
      cases.push({
        framework,
        name: `static-${width}-${preserveMetadata ? 'metadata' : 'plain'}`,
        source: result.source,
        expected: {
          layout: { Width: 400, Height: 300 },
          target: {
            Width: width >= 600 ? 180 : 80,
            Height: 36,
            Padding: [9, 4, 6, 4],
            Content: 'Caption',
          },
          edit: { Text: 'first\nsecond', IsReadOnly: true, AcceptsReturn: true },
          choice: { SelectedIndex: 1 },
          rich: { FontSize: 18 },
          // Static conversion receives explicit source; live capture redacts below.
          password:
            framework === 'WPF'
              ? { Width: 140 }
              : { PasswordChar: '*', Text: 'explicit fixture value' },
        },
        diagnostics: result.diagnostics,
      });
    }
if (process.argv.includes('--browser')) {
  const bundle = await build({
    entryPoints: ['dist/core/compiler-browser.js'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
  });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.setContent(
      '<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;padding:16px;border:2px solid black}section{padding:8px;background:#eee}p{font:16px Arial}</style></head><body><main id="layout"><section id="first"><p id="text">Native layout sample text</p></section><section id="second"><button id="action">Go</button><input id="capturedPassword" type="password" value="never exported" style="width:100px;height:28px"></section><section id="third">Direct text</section></main></body></html>',
    );
    const rendered = await page.evaluate(async (code) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const { compileRenderedDocument } = await import(url);
      URL.revokeObjectURL(url);
      const cases = [];
      for (const width of [330, 700])
        for (const framework of ['WPF', 'Avalonia']) {
          const root = document.getElementById('layout');
          root.style.width = width + 'px';
          const result = compileRenderedDocument(root, { framework, preserveMetadata: false });
          if (!result.success) throw Error(JSON.stringify(result.diagnostics));
          const expected = {};
          for (const id of [
            'layout',
            'first',
            'second',
            'third',
            'text',
            'action',
            'capturedPassword',
          ]) {
            const el = document.getElementById(id),
              r = el.getBoundingClientRect();
            expected[id] = { Width: r.width, Height: r.height };
            if (id !== 'layout') {
              const p = el.parentElement.getBoundingClientRect();
              expected[id]['Canvas.Left'] = r.x - p.x;
              expected[id]['Canvas.Top'] = r.y - p.y;
            }
          }
          expected.capturedPassword[framework === 'WPF' ? 'Password' : 'Text'] = '';
          if (framework === 'Avalonia') expected.capturedPassword.PasswordChar = '*';
          if (result.source.includes('never exported'))
            throw Error('Captured native fixture leaked a password.');
          cases.push({
            framework,
            name: `rendered-${width}`,
            source: result.source,
            expected,
            diagnostics: result.diagnostics,
          });
        }
      return cases;
    }, bundle.outputFiles[0].text);
    cases.push(...rendered);
  } finally {
    await browser.close();
  }
}
for (const framework of ['WPF', 'Avalonia']) {
  const dir = resolve(output, framework);
  await mkdir(dir, { recursive: true });
  const manifest = [];
  for (const fixture of cases.filter((c) => c.framework === framework)) {
    const file = fixture.name + '.xaml';
    await writeFile(resolve(dir, file), fixture.source);
    manifest.push({
      name: fixture.name,
      file,
      expected: fixture.expected,
      diagnostics: fixture.diagnostics,
    });
  }
  await writeFile(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${framework}: generated ${manifest.length} native fixtures.`);
}
