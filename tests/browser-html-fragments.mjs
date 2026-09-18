/** Browser-native contextual parsing, source fidelity, and full Studio fragment authoring. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..');
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/fragment-check/') {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><main id="host"></main>',
        );
      return;
    }
    const base = path.startsWith('/packages/') ? root : resolve(root, 'dist');
    let file = resolve(base, '.' + path);
    if (file !== base && !file.startsWith(base + sep)) throw Error('Outside root');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    response
      .writeHead(200, {
        'Content-Type':
          { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[extname(file)] ||
          'text/plain',
      })
      .end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser, page;
const errors = [],
  failures = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(response.url());
  });
  for (const module of ['/core/html.js', '/packages/markup/dist/browser/index.js']) {
    await page.goto(base + '/fragment-check/');
    const checked = await page.evaluate(async (module) => {
      const h = await import(module);
      const check = (condition, message) => {
        if (!condition) throw Error(message);
      };
      const context = (type, namespaceURI = h.HTML_NAMESPACE, props = {}) => ({
        kind: 'element',
        id: 'context',
        type,
        namespaceURI,
        props,
        children: [],
      });
      const fragment = (source, node) => h.parseHtmlFragment(source, { context: node });
      const table = fragment('<tr><td>First</td><td>Second</td></tr>', context('table'));
      check(
        table[0].type === 'tbody' && table[0].children[0].children.length === 2,
        'Contextual table rows',
      );
      check(fragment('<td>Cell</td>', context('tr'))[0].type === 'td', 'Contextual cell');
      const select = fragment(
        '<option value="a">A</option><option value="b">B</option>',
        context('select'),
      );
      check(select.length === 2 && select[1].props.value === 'b', 'Select options');
      const template = fragment('<template><b>Inert</b></template>', context('template'));
      check(template[0].children[0].type === 'b', 'Nested template projection');
      const gradient = fragment(
        '<linearGradient viewBox="0 0 1 1"><stop offset="1"/></linearGradient>',
        context('svg', h.SVG_NAMESPACE),
      );
      check(
        gradient[0].type === 'linearGradient' &&
          gradient[0].namespaceURI === h.SVG_NAMESPACE &&
          gradient[0].props.viewBox === '0 0 1 1',
        'SVG case and namespace',
      );
      for (const integration of ['foreignObject', 'desc', 'title']) {
        const content = fragment(
          '<div>HTML</div><svg><circle/></svg>',
          context(integration, h.SVG_NAMESPACE),
        );
        check(
          content[0].namespaceURI === h.HTML_NAMESPACE &&
            content[1].namespaceURI === h.SVG_NAMESPACE,
          'SVG integration point ' + integration,
        );
      }
      const math = fragment(
        '<mi>x</mi><mfrac><mi>a</mi><mi>b</mi></mfrac>',
        context('math', h.MATHML_NAMESPACE),
      );
      check(
        math.every((n) => n.namespaceURI === h.MATHML_NAMESPACE),
        'MathML namespace',
      );
      const textIntegration = fragment('<b>HTML</b><mglyph/>', context('mi', h.MATHML_NAMESPACE));
      check(
        textIntegration[0].namespaceURI === h.HTML_NAMESPACE &&
          textIntegration[1].namespaceURI === h.MATHML_NAMESPACE,
        'MathML text integration',
      );
      const annotation = fragment(
        '<div>HTML annotation</div>',
        context('annotation-xml', h.MATHML_NAMESPACE, { encoding: 'text/html' }),
      );
      check(annotation[0].namespaceURI === h.HTML_NAMESPACE, 'MathML annotation encoding');
      window.fragmentExecuted = 0;
      customElements.define(
        'x-fragment-probe',
        class extends HTMLElement {
          constructor() {
            super();
            window.fragmentExecuted++;
          }
        },
      );
      const inert = fragment(
        '<script>window.fragmentExecuted++;</script><x-fragment-probe></x-fragment-probe><button onclick="window.fragmentExecuted++">B</button>',
        context('div'),
      );
      check(
        window.fragmentExecuted === 0 && inert.length === 3,
        'Detached parsing must not execute author code',
      );
      const source =
        '<!doctype html><html><body><main id="root"></main><table id="rows"></table><svg id="drawing"><style><![CDATA[.a > .b { content: "< &"; }]]></style><template>Foreign template</template><foreignObject width="100" height="50"><div>Before</div></foreignObject></svg><math id="formula"><mi>x</mi></math><template id="inert"><b>Before</b></template></body></html>';
      const doc = h.parseHtml(source),
        body = h.htmlBody(doc),
        byId = (id) => body.children.find((n) => n.props?.id === id);
      check(h.serializeHtml(doc) === source, 'Unchanged source remains byte-exact');
      h.insertHtmlFragment(doc, byId('rows').id, '<tr><td>A</td></tr>');
      const svg = byId('drawing');
      h.insertHtmlFragment(doc, svg.id, '<circle cx="50" cy="50" r="20"/>');
      h.insertHtmlFragment(doc, svg.children[2].id, '<p>HTML integration</p>');
      h.insertHtmlFragment(doc, byId('formula').id, '<mfrac><mi>a</mi><mi>b</mi></mfrac>');
      h.insertHtmlFragment(doc, byId('inert').id, '<span>After</span>');
      const normalized = (n) =>
        n.kind === 'element'
          ? [n.type, n.namespaceURI, n.props, n.children.map(normalized)]
          : [n.kind, n.text];
      const saved = h.serializeHtml(doc),
        reopened = h.parseHtml(saved);
      check(
        JSON.stringify(normalized(reopened.root)) === JSON.stringify(normalized(doc.root)),
        'Edited foreign/table/template AST must survive serialize and reparse',
      );
      check(saved.includes('&lt; &amp;'), 'Foreign style text must be escaped after edits');
      const before = JSON.stringify(doc);
      let rejected = false;
      try {
        h.insertHtmlFragment(doc, svg.id, '<div>Wrong namespace</div>');
      } catch {
        rejected = true;
      }
      check(rejected && JSON.stringify(doc) === before, 'Invalid HTML-in-SVG insertion is atomic');
      const formDoc = h.parseHtml('<form><div id="container"></div></form>');
      const inside = h.htmlBody(formDoc).children[0].children[0];
      const formNodes = h.insertHtmlFragment(formDoc, inside.id, '<form><input></form>');
      check(
        formNodes.every((node) => node.type !== 'form'),
        'Ancestor form context must be retained',
      );
      return true;
    }, module);
    assert(checked);
    console.log(
      module +
        ': native namespace, table, template, inert parsing and AST round-trip checks passed.',
    );
  }
  await page.goto(base + '/');
  await page.waitForFunction(() => !!window.xamora?.studio.html);
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.importText(
      '<!doctype html><html><head><title>Fragments</title></head><body><main><table id="rows"></table><svg id="drawing" viewBox="0 0 240 160" width="240" height="160"></svg><math id="formula"></math><template id="inert"></template></main></body></html>',
      'Fragments.html',
    );
    const main = s.doc.root.children.find((n) => n.type === 'body').children[0];
    window.fragmentIds = Object.fromEntries(main.children.map((n) => [n.props.id, n.id]));
    window.fragmentOriginal = s.editor.input.value;
    s.store.select([window.fragmentIds.rows]);
    s.command('html-insert-fragment');
  });
  const input = page.getByRole('textbox', { name: 'Markup', exact: true });
  await input.fill('<tr><td>Created through the designer</td></tr>');
  await page.getByRole('button', { name: 'Insert fragment', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-html-fragment-source]'));
  await page.waitForFunction(() =>
    window.xamora.studio.editor.input.value.includes('Created through the designer'),
  );
  await page.waitForFunction(
    () =>
      window.xamora.studio.renderer.htmlRenderer?.frame.contentDocument?.querySelector('td')
        ?.textContent === 'Created through the designer',
  );
  await page.evaluate(() => window.xamora.studio.command('undo'));
  await page.waitForFunction(
    () => window.xamora.studio.editor.input.value === window.fragmentOriginal,
  );
  await page.evaluate(() => window.xamora.studio.command('redo'));
  await page.waitForFunction(() =>
    window.xamora.studio.editor.input.value.includes('Created through the designer'),
  );
  await page.evaluate(() => {
    const s = window.xamora.studio;
    s.store.select([window.fragmentIds.drawing]);
    s.insertControl('circle');
    window.fragmentCircle = s.store.selection[0];
    s.setProps([window.fragmentCircle], 'fill', '#237a57');
    s.store.select([window.fragmentIds.formula]);
    s.insertControl('mfrac');
    window.fragmentMath = s.store.selection[0];
  });
  await page.waitForFunction(() => {
    const renderer = window.xamora.studio.renderer.htmlRenderer;
    return (
      renderer?.elements.get(window.fragmentCircle)?.namespaceURI ===
        'http://www.w3.org/2000/svg' &&
      renderer?.elements.get(window.fragmentMath)?.namespaceURI ===
        'http://www.w3.org/1998/Math/MathML'
    );
  });
  assert.equal(
    await page.evaluate(() =>
      window.xamora.studio.renderer.htmlRenderer.elements
        .get(window.fragmentCircle)
        .getAttribute('fill'),
    ),
    '#237a57',
  );
  // The menu opens the same integrated action; template content stays inert in the design iframe.
  await page.evaluate(() => window.xamora.studio.store.select([window.fragmentIds.inert]));
  await page.locator('.ide-menubar').getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Insert HTML fragment…', exact: true }).click();
  await input.fill('<b>Inert template child</b>');
  await page.getByRole('button', { name: 'Insert fragment', exact: true }).click();
  await page.waitForFunction(() =>
    window.xamora.studio.editor.input.value.includes('Inert template child'),
  );
  await page.waitForFunction(() => {
    const doc = window.xamora.studio.renderer.htmlRenderer?.frame.contentDocument;
    return (
      doc?.querySelector('#inert')?.content.textContent === 'Inert template child' &&
      !doc.querySelector('#inert b')
    );
  });
  assert.equal(
    await page.locator('iframe.html-design-frame').getAttribute('sandbox'),
    'allow-same-origin',
  );
  await mkdir(resolve(root, 'test-results/ux'), { recursive: true });
  await page.screenshot({
    path: resolve(root, 'test-results/ux/15-html-contextual-fragments.png'),
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(
    'HTML fragments: Studio dialog/menu, table source/preview, exact undo, redo, SVG attributes, MathML and inert template content passed.',
  );
} catch (error) {
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  await writeFile(
    resolve(root, 'test-results/html-fragment-error.txt'),
    String(error.stack || error),
  );
  await page
    ?.screenshot({ path: resolve(root, 'test-results/html-fragment-failure.png') })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
