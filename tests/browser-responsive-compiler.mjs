/** Browser differential tests, with no fetched source or HTTP navigation requirement. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const entries =
  process.env.XAMORA_FIDELITY_SOURCE_ONLY === '1' ? ['source'] : ['source', 'package'];
let browser;
const watchdog = setTimeout(() => {
  process.exitCode = 1;
  console.error('Responsive compiler exceeded 90 seconds.');
  void browser?.close();
}, 90000);
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--disable-dev-shm-usage'],
  });
  for (const entry of entries) {
    const source =
      entry === 'source'
        ? `export * from './dist/core/compiler-selectors.js';export * from './dist/core/compiler-environment.js';export * from './dist/core/compiler-browser.js';export * from './dist/core/semantic-compiler.js';export {parseHtml} from './dist/core/html.js';export {walk} from './dist/core/model.js';`
        : `export * from './packages/compiler/dist/esm/index.js';export {parseHtml} from './packages/markup/dist/esm/html.js';export {walk} from './packages/model/dist/esm/model.js';`;
    const bundle = await build({
      stdin: { contents: source, resolveDir: process.cwd() },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
    });
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><html><head></head><body></body></html>');
    const result = await page.evaluate(async (code) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const api = await import(url);
      URL.revokeObjectURL(url);
      const check = (value, message) => {
        if (!value) throw Error(message);
      };
      const props = (result, id) => {
        let found;
        api.walk(result.document.root, (n) => {
          if (n.props?.['x:Name'] === id) found = n;
        });
        check(found, 'Missing ' + id);
        return found.props;
      };
      document.body.innerHTML = `<main id="root" lang="en-US"><section id="s1"><button id="b1" class="on">A</button><!--gap-->text<span id="span"></span><button id="b2">B</button><button id="b3" class="on">C</button></section><section id="s2"><button id="b4" class="on">D</button></section><p id="end"></p><fieldset disabled id="fs"><legend><input id="legend"></legend><input id="disabled"></fieldset><input id="required" required><input id="hidden" type="hidden" required><select id="select"><option id="o1" disabled>A</option><option id="o2">B</option></select><textarea id="ta" placeholder=""></textarea><form><button id="submit">Submit</button><input id="submit2" type="submit"></form></main>`;
      const input = api.parseHtml(document.documentElement.outerHTML, { Parser: DOMParser });
      const ctx = { input, parents: new Map(), previousElements: new Map(), options: {} };
      api.walk(input.root, (n, p) => {
        if (p) ctx.parents.set(n.id, p);
        let last;
        for (const c of n.children || [])
          if (c.kind === 'element') {
            if (last) ctx.previousElements.set(c.id, last);
            last = c;
          }
      });
      let selectors = 0;
      for (const selector of [
        ':root',
        ':empty',
        ':is(button,.on):not(#b4)',
        ':where(section)>:first-child',
        'button:nth-child(-n + 3)',
        'button:nth-last-of-type(2)',
        ':nth-child(2 of .on, #b2)',
        ':nth-last-child(odd of .on)',
        'section:has(>.on)',
        'section:has(+section button)',
        'section:has(~p)',
        'section:not(:has(#b1))',
        ':lang(en)',
        ':enabled',
        ':disabled',
        ':checked',
        ':default',
        ':required',
        ':optional',
        ':read-write',
        ':read-only',
        ':placeholder-shown',
      ]) {
        const expected = [...document.querySelectorAll(selector)].map((n) => n.id).filter(Boolean);
        const plan = api.compileCssSelector(selector);
        check(plan, 'Cannot compile ' + selector);
        ctx.selectorSteps = 0;
        const actual = [];
        api.walk(input.root, (n) => {
          if (n.kind === 'element' && n.props.id && api.matchesCssSelector(n, plan, ctx))
            actual.push(n.props.id);
        });
        check(
          JSON.stringify(actual) === JSON.stringify(expected),
          `${selector}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
        );
        selectors++;
      }
      for (const query of [
        '(width >= 600px)',
        'screen and (300px <= width < 1200px)',
        'print, (orientation:portrait)',
        '(aspect-ratio > 1/1)',
        'not (width > 9999px)',
      ])
        check(
          api.evaluateCssCondition(query, {
            type: 'screen',
            width: innerWidth,
            height: innerHeight,
          }) === matchMedia(query).matches,
          'media ' + query,
        );
      const css = `@layer base,theme;@layer base{#card{height:37px!important}}@layer theme{#card{height:50px!important}}#card{height:90px!important;width:10px} @media(width>=600px){:is(#card,.on){width:calc(10vw + 2rem)}} @supports(display:grid){#card{padding:4px;padding-left:9px}}`;
      document.head.innerHTML = '<style>' + css + '</style>';
      document.body.innerHTML = '<button id="card">Card</button>';
      const converted = api.compileDocument(document.documentElement.outerHTML, {
        from: 'html',
        environment: {
          type: 'screen',
          width: innerWidth,
          height: innerHeight,
          supports: (query) => CSS.supports(query),
        },
        Parser: DOMParser,
      });
      check(converted.success, JSON.stringify(converted.diagnostics));
      const p = props(converted, 'card'),
        computed = getComputedStyle(document.getElementById('card'));
      check(Number(p.Width) === parseFloat(computed.width), 'responsive width');
      check(Number(p.Height) === parseFloat(computed.height), 'important layer height');
      check(
        p.Padding ===
          [computed.paddingLeft, computed.paddingTop, computed.paddingRight, computed.paddingBottom]
            .map(parseFloat)
            .join(','),
        'padding',
      );
      document.head.innerHTML = `<style>*{box-sizing:border-box}body{margin:0}.host{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;padding:16px;width:700px;border:2px solid black;container-type:inline-size}.item{font:16px Arial;min-width:0; padding:4px; background:#eee}@container(width<400px){.item{font-size:20px}}</style>`;
      document.body.innerHTML =
        '<main id="layout" class="host"><div id="first" class="item"><p id="text">Intrinsic text wraps across several words naturally.</p></div><div id="second" class="item"><button id="action">Go</button></div><div id="third" class="item">Direct text</div></main>';
      const root = document.getElementById('layout'),
        original = root.outerHTML;
      const snapshot = api.compileRenderedDocument(root, { preserveMetadata: false });
      check(snapshot.success, JSON.stringify(snapshot.diagnostics));
      const compare = (result) => {
        for (const id of ['layout', 'first', 'second', 'third', 'text', 'action']) {
          const native = document.getElementById(id),
            bounds = native.getBoundingClientRect(),
            n = props(result, id);
          check(Math.abs(Number(n.Width) - bounds.width) < 0.01, id + ' width');
          check(Math.abs(Number(n.Height) - bounds.height) < 0.01, id + ' height');
          if (native.parentElement !== document.body) {
            const parent = native.parentElement.getBoundingClientRect();
            check(Math.abs(Number(n['Canvas.Left']) - (bounds.x - parent.x)) < 0.01, id + ' x');
            check(Math.abs(Number(n['Canvas.Top']) - (bounds.y - parent.y)) < 0.01, id + ' y');
          }
        }
      };
      compare(snapshot);
      check(root.outerHTML === original, 'capture mutated source');
      check(snapshot.source.includes('<Canvas'), 'measured containers must be native canvases');
      let notices = 0,
        last,
        failures = [];
      const observer = api.observeRenderedDocument(root, {
        preserveMetadata: false,
        onResult: (r) => {
          last = r;
          notices++;
        },
        onError: (e) => failures.push(e.message),
      });
      root.style.width = '330px';
      await new Promise((r) => setTimeout(r, 100));
      compare(last);
      check(
        Number(props(last, 'second')['Canvas.Top']) >
          Number(props(snapshot, 'second')['Canvas.Top']),
        'responsive item did not reflow',
      );
      check(props(last, 'text').FontSize === '20', 'container font change missing');
      const before = notices;
      root.classList.add('one');
      root.classList.add('two');
      root.querySelector('#action').textContent = 'Go now';
      await new Promise((r) => setTimeout(r, 100));
      check(notices > before && notices - before <= 3, 'observer did not coalesce');
      observer.dispose();
      observer.dispose();
      const ended = notices;
      root.style.width = '500px';
      await new Promise((r) => setTimeout(r, 60));
      check(notices === ended, 'late callback after disposal');
      check(observer.refresh() === null, 'disposed refresh');
      check(!failures.length, failures.join('\n'));
      check(
        api.compileRenderedDocument(root, { strict: true }).success === false,
        'native-theme loss must reject strict capture',
      );
      return {
        selectors,
        media: true,
        cascade: true,
        intrinsic: true,
        container: true,
        observer: true,
      };
    }, bundle.outputFiles[0].text);
    assert.equal(result.selectors, 22);
    assert.deepEqual(errors, []);
    console.log(entry, JSON.stringify(result));
    await page.close();
  }
} finally {
  clearTimeout(watchdog);
  await browser?.close();
}
