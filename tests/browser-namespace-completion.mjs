/** Completion context, native namespace differentials and public built ESM consumers. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--disable-dev-shm-usage'],
  });
  for (const packed of [false, true]) {
    const modules = packed
      ? [
          '@wieslawsoltes/xamora-markup/markup-context',
          '@wieslawsoltes/xamora-markup/xaml-language',
          '@wieslawsoltes/xamora-markup/html',
          '@wieslawsoltes/xamora-model/registry',
        ]
      : [
          './dist/core/markup-context.js',
          './dist/core/xaml-language.js',
          './dist/core/html.js',
          './dist/core/registry.js',
        ];
    const result = await build({
      absWorkingDir: root,
      stdin: {
        contents: modules.map((name) => `export * from '${name}';`).join('\n'),
        resolveDir: root,
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
    });
    const page = await browser.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><title>Namespace completion qualification</title>');
    const report = await page.evaluate(async (code) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const h = await import(url);
      URL.revokeObjectURL(url);
      const check = (value, message) => {
        if (!value) throw Error(message);
      };
      const cases = [
        ['<main>', 'button'],
        ['<svg>', 'circle'],
        ['<svg><g>', 'linearGradient'],
        ['<svg><foreignObject>', 'div'],
        ['<svg><title>', 'span'],
        ['<svg><desc>', 'b'],
        ['<math>', 'mfrac'],
        ['<math><mi>', 'span'],
        ['<math><mi>', 'mglyph'],
        ['<math><annotation-xml encoding="text/html">', 'div'],
        ['<math><annotation-xml encoding="application/xml">', 'mrow'],
        ['<math><annotation-xml encoding="application/xhtml+xml"><svg>', 'circle'],
      ];
      for (const [prefix, tag] of cases) {
        const markup = prefix + `<${tag} id="probe"></${tag}>`;
        const node = new DOMParser().parseFromString(markup, 'text/html').getElementById('probe');
        const current = h.markupCompletionContext(prefix + '<' + tag, (prefix + '<' + tag).length, {
          html: true,
        });
        check(
          current.tag.namespaceURI === node.namespaceURI,
          `Native namespace mismatch for ${prefix}${tag}`,
        );
      }
      const names = (s) => h.completeHtml(s, s.length).map((x) => x.label);
      check(names('<svg viewB').includes('viewBox'), 'SVG case-sensitive attributes');
      check(!names('<svg viewBox="0 0 1 1" view').includes('viewBox'), 'Duplicate SVG attribute');
      check(names('<math><mf').includes('mfrac'), 'MathML elements');
      check(names('<script>text</scr').includes('script'), 'Raw closing completion');
      check(names('<script>"<div type=').length === 0, 'No fake HTML in script');
      check(names('<!-- <style> col').length === 0, 'No CSS in comments');
      const wpf = 'http://schemas.microsoft.com/winfx/2006/xaml/presentation';
      const source = `<a:TextBlock xmlns:a="${wpf}"><a:TextBlock.Inlines><a:R`;
      const registry = h.builtins(),
        entries = h.completeXaml(source, source.length, { registry });
      check(
        entries.some((x) => x.label === 'a:Run'),
        'Inline alias completion',
      );
      check(!entries.some((x) => x.label === 'a:Grid'), 'Inline content context');
      registry.registerControl({
        type: 'Card',
        category: 'Custom',
        properties: [{ name: 'Mode', values: ['Quiet', 'Loud'] }],
      });
      const attribute = `<a:Card xmlns:a="${wpf}" Mode="Q`;
      check(
        h.completeXaml(attribute, attribute.length, { registry })[0]?.label === 'Quiet',
        'Alias descriptor values',
      );
      const htmlSource = "<svg viewBox = '0 0 100 100'></svg>",
        htmlOffset = htmlSource.indexOf('viewBox') + 4,
        htmlItem = h.completeHtml(htmlSource, htmlOffset).find((item) => item.label === 'viewBox');
      const xamlSource = '<Button FontWeight="Bold"/>',
        xamlOffset = xamlSource.indexOf('FontWeight') + 4,
        xamlItem = h
          .completeXaml(xamlSource, xamlOffset, { registry })
          .find((item) => item.label === 'FontWeight');
      for (const [text, item] of [
        [htmlSource, htmlItem],
        [xamlSource, xamlItem],
      ]) {
        check(!!item, 'Caret name completion remains available');
        check(
          text.slice(0, item.start) + item.insertText + text.slice(item.end) === text,
          'Existing name suffix, assignment and value must survive completion',
        );
      }
      return {
        nativeNamespaceCases: cases.length,
        canonicalAndPackageAPI: true,
        caretRanges: true,
      };
    }, result.outputFiles[0].text);
    assert.deepEqual(errors, []);
    console.log(packed ? 'package' : 'source', report);
    await page.close();
  }
} finally {
  await browser?.close();
}
