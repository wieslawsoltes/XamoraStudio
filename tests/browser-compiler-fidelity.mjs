/** Compare source and built-package conversion with Chromium's CSS/text/form behavior. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceOnly = process.env.XAMORA_FIDELITY_SOURCE_ONLY === '1';
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--disable-dev-shm-usage'],
  });
  for (const modulePath of [
    'dist/core/semantic-compiler.js',
    ...(!sourceOnly ? ['packages/compiler/dist/esm/index.js'] : []),
  ]) {
    const bundle = await build({
      absWorkingDir: root,
      entryPoints: [modulePath],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><title>Compiler fidelity</title>');
    const report = await page.evaluate(async (code) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const { compileDocument } = await import(url);
      URL.revokeObjectURL(url);
      const check = (condition, message) => {
        if (!condition) throw Error(message);
      };
      const frame = async (source) => {
        const el = document.createElement('iframe');
        el.width = '600';
        el.height = '300';
        const ready = new Promise((resolve) => (el.onload = resolve));
        el.srcdoc = source;
        document.body.append(el);
        await ready;
        return el;
      };
      const node = (result, name) => {
        const visit = (n) =>
          n.props?.['x:Name'] === name ? n : n.children?.map(visit).find(Boolean);
        return visit(result.document.root);
      };
      const source = `<!doctype html><html><head><style>
        :root {--measure:12pt;--edge:2px 4px;--base:11px;--derived:var(--base)}
        #target {height:31px!important;height:99px; margin:2px 4px; padding:var(--edge)}
        main>button {width:var(--missing, var(--measure));color:rgb(10% 50% 100% / 50%)}
        #first+button[data-token="a,b:c"] {padding-left:7px}
        #first~button {margin-right:9px}
      </style></head><body><main><button id="first">A</button><!--gap--><button id="target" data-token="a,b:c" style="--base:33px;min-width:var(--derived)">B</button></main></body></html>`;
      const original = await frame(source);
      const originalStyle = original.contentWindow.getComputedStyle(
        original.contentDocument.getElementById('target'),
      );
      const result = compileDocument(source, { from: 'html', Parser: DOMParser });
      check(result.success, 'CSS conversion failed');
      const p = node(result, 'target').props;
      check(
        Number(p.Width) === parseFloat(originalStyle.width),
        `width ${p.Width} != ${originalStyle.width}`,
      );
      check(Number(p.Height) === parseFloat(originalStyle.height), 'important height mismatch');
      check(
        Number(p.MinWidth) === parseFloat(originalStyle.minWidth),
        'computed inherited variable mismatch',
      );
      check(
        p.Padding ===
          [
            originalStyle.paddingLeft,
            originalStyle.paddingTop,
            originalStyle.paddingRight,
            originalStyle.paddingBottom,
          ]
            .map(parseFloat)
            .join(','),
        'padding cascade mismatch',
      );
      check(
        p.Margin ===
          [
            originalStyle.marginLeft,
            originalStyle.marginTop,
            originalStyle.marginRight,
            originalStyle.marginBottom,
          ]
            .map(parseFloat)
            .join(','),
        'margin cascade mismatch',
      );
      const returned = await frame(compileDocument(result.source).source);
      const backStyle = returned.contentWindow.getComputedStyle(
        returned.contentDocument.getElementById('target'),
      );
      for (const key of ['width', 'height', 'color', 'paddingLeft', 'marginRight', 'minWidth'])
        check(originalStyle[key] === backStyle[key], `roundtrip CSS ${key} mismatch`);
      original.remove();
      returned.remove();
      let rich = 0;
      for (const body of [
        '<p id="text">  One   <strong> bold </strong> next <em>word</em> <br>  line</p>',
        '<pre id="text"> first\n  <strong>bold</strong>  end</pre>',
        '<p id="text" style="white-space:pre-line">One   <b> bold </b>  \n  next  line\nlast</p>',
        '<button id="text">Click <strong>here</strong> now</button>',
      ]) {
        const input = `<!doctype html><html><head><style>#text {font-family:Arial;font-size:16px}</style></head><body>${body}</body></html>`;
        const before = await frame(input);
        const converted = compileDocument(input, { from: 'html', Parser: DOMParser });
        check(converted.success, 'rich text conversion failed');
        const after = await frame(compileDocument(converted.source).source);
        const a = before.contentDocument.getElementById('text'),
          b = after.contentDocument.getElementById('text');
        check(
          a.innerText === b.innerText,
          `rich text mismatch: ${JSON.stringify(a.innerText)} != ${JSON.stringify(b.innerText)}`,
        );
        check(
          a.querySelectorAll('strong,b,em').length === b.querySelectorAll('strong,b,em').length,
          'lost rich formatting',
        );
        before.remove();
        after.remove();
        rich++;
      }
      const forms = compileDocument(
        '<html><body><div><textarea id="edit" readonly>one\ntwo</textarea><select id="choice"><option selected>A</option><option>B</option></select><input id="radio" type="radio" name="team" checked></div></body></html>',
        { from: 'html', Parser: DOMParser },
      );
      node(forms, 'choice').props.SelectedIndex = '1';
      node(forms, 'edit').props.Text = 'edited\ncontent';
      const formFrame = await frame(compileDocument(forms.document).source);
      const fd = formFrame.contentDocument;
      check(fd.getElementById('choice').selectedIndex === 1, 'edited selection reverted');
      check(fd.getElementById('edit').value === 'edited\ncontent', 'multiline text lost');
      check(fd.getElementById('edit').readOnly, 'readonly lost');
      check(
        fd.getElementById('radio').name === 'team' && fd.getElementById('radio').checked,
        'radio state lost',
      );
      formFrame.remove();
      return { css: true, rich, forms: true };
    }, bundle.outputFiles[0].text);
    assert.deepEqual(report, { css: true, rich: 4, forms: true });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Chromium fidelity ${modulePath}: cascade, 4 rich-text cases, edited form state passed.`,
    );
  }
} finally {
  await browser?.close();
}
