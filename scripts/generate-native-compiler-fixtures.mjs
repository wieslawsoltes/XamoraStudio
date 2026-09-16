/** Generate actual compiler outputs for independent native WPF/Avalonia validation. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { Window } from 'happy-dom';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { compileDocument } from '../dist/core/semantic-compiler.js';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, process.env.XAMORA_NATIVE_FIXTURES || 'test-results/native-fixtures');
await mkdir(output, { recursive: true });
const Parser = new Window().DOMParser;
const manifest = [];
const inputs = [
  {
    name: 'grid-padding',
    html: '<main id="sample" style="display:grid;width:360px;height:150px;grid-template-columns:100px 1fr;grid-template-rows:40px 60px;gap:8px;padding:4px;background-color:#eeeeee"><button id="button" style="width:80px;height:30px">Action</button><input id="entry" value="Native text"/><p id="caption">Editable <strong>rich</strong> text</p></main>',
    checks: [
      { name: 'sample', width: 360, height: 150 },
      { name: 'button', width: 80, height: 30 },
    ],
    text: [{ name: 'entry', property: 'Text', value: 'Native text' }],
  },
  {
    name: 'stack-gap',
    html: '<div id="sample" style="display:flex;flex-direction:column;width:300px;height:120px;padding:6px;gap:7px"><button id="button" style="height:30px">One</button><button id="second" style="height:30px">Two</button></div>',
    checks: [{ name: 'sample', width: 300, height: 120 }],
    text: [{ name: 'button', property: 'Content', value: 'One' }],
  },
  {
    name: 'forms',
    html: '<div id="sample" style="width:300px;height:180px"><textarea id="entry" readonly>Native Ω</textarea><input id="check" type="checkbox" checked/><select id="choice"><option>A</option><option selected>B</option></select></div>',
    checks: [{ name: 'sample', width: 300, height: 180 }],
    text: [
      { name: 'entry', property: 'Text', value: 'Native Ω' },
      { name: 'check', property: 'IsChecked', value: 'True' },
      { name: 'choice', property: 'SelectedIndex', value: '1' },
    ],
  },
  {
    name: 'conditional',
    html: '<style>@layer base,theme;@layer base{#button{height:10px}}@layer theme{@media (width >= 600px){:is(button,input){height:36px}}@supports (display:grid){button:has(span){width:120px}}}</style><div id="sample" style="width:300px;height:100px"><button id="button"><span>Conditional</span></button></div>',
    checks: [
      { name: 'sample', width: 300, height: 100 },
      { name: 'button', width: 120, height: 36 },
    ],
    text: [],
  },
];
for (const framework of ['WPF', 'Avalonia'])
  for (const input of inputs) {
    const result = compileDocument(
      '<!doctype html><html><head></head><body>' + input.html + '</body></html>',
      {
        from: 'html',
        framework,
        nativeOutput: true,
        Parser,
        environment: { type: 'screen', width: 900, height: 700 },
        supports: { 'display:grid': true },
      },
    );
    assert(result.success, JSON.stringify(result.diagnostics));
    const file = `${framework}-${input.name}.xaml`;
    await writeFile(resolve(output, file), result.source);
    manifest.push({
      name: framework + '-' + input.name,
      framework,
      file,
      width: 360,
      height: 200,
      checks: input.checks,
      text: input.text,
      losses: result.losses,
    });
  }
const fixtureRoot = resolve(root, 'tests/fixtures/compiler-responsive');
const html = await readFile(resolve(fixtureRoot, 'index.html'), 'utf8');
const isolated = process.env.XAMORA_ISOLATED_BROWSER === '1';
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname),
      file = resolve(fixtureRoot, '.' + path);
    if (!file.startsWith(fixtureRoot + '/')) throw Error('Invalid path');
    res.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const bundled = await build({
    absWorkingDir: root,
    entryPoints: ['dist/core/compiler-browser.js'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
  });
  for (const width of [380, 900]) {
    const page = await browser.newPage({
      viewport: { width, height: 700 },
      colorScheme: width === 380 ? 'dark' : 'light',
    });
    if (isolated) {
      const theme = await readFile(resolve(fixtureRoot, 'theme.css'), 'utf8'),
        base = await readFile(resolve(fixtureRoot, 'base.css'), 'utf8');
      await page.setContent(
        html.replace(
          '<link rel="stylesheet" href="theme.css">',
          `<style>@layer base{${base}}</style><style>${theme.replace('@import "base.css" layer(base);', '')}</style>`,
        ),
      );
    } else await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    const snapshots = await page.evaluate(async (code) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })),
        { compileRenderedDocument } = await import(url);
      URL.revokeObjectURL(url);
      await document.fonts.ready;
      return ['WPF', 'Avalonia'].map((framework) => ({
        framework,
        result: compileRenderedDocument(document.getElementById('surface'), { framework }),
      }));
    }, bundled.outputFiles[0].text);
    for (const { framework, result } of snapshots) {
      assert(result.success, JSON.stringify(result.diagnostics));
      const name = `${framework}-browser-${width}`,
        file = name + '.xaml',
        box = result.metadata.browserCapture.root;
      const checks = result.metadata.geometry
        .filter((item) => item.targetName)
        .map((item) => ({
          name: item.targetName,
          x: item.rect.x - box.x,
          y: item.rect.y - box.y,
          width: item.rect.width,
          height: item.rect.height,
        }));
      await writeFile(resolve(output, file), result.source);
      manifest.push({
        name,
        framework,
        file,
        width: box.width,
        height: box.height,
        checks,
        text: [
          { name: 'entry', property: 'Text', value: 'Initial' },
          { name: 'choice', property: 'SelectedIndex', value: '1' },
        ],
        losses: result.losses,
      });
    }
    await page.screenshot({ path: resolve(output, `browser-${width}.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
await writeFile(
  resolve(output, 'manifest.json'),
  JSON.stringify(
    {
      version: 1,
      generatedFrom: 'compiler outputs, not hand-authored target fixtures',
      browserMode: isolated ? 'isolated' : 'http-external-stylesheets',
      fixtures: manifest,
    },
    null,
    2,
  ),
);
console.log(
  `Generated ${manifest.length} native compiler fixtures with ${manifest.reduce((sum, item) => sum + item.checks.length, 0)} named geometry expectations.`,
);
