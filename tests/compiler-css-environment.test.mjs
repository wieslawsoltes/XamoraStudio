import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { compileDocument } from '../dist/core/semantic-compiler.js';
import { parseHtml } from '../dist/core/html.js';
import { walk } from '../dist/core/model.js';
import { compileCssSelector, matchesCssSelector } from '../dist/core/compiler-selectors.js';
import { evaluateCssCondition, resolveCssLength } from '../dist/core/compiler-environment.js';
import { parseCompilerCssImport, rebaseCompilerCssUrls } from '../dist/core/compiler-css.js';
const Parser = new Window().DOMParser;
const env = {
  type: 'screen',
  width: 800,
  height: 600,
  resolution: 2,
  'prefers-color-scheme': 'dark',
  pointer: 'fine',
};
function fixture(css, options = {}, body = '<button id="target">Test</button>') {
  const result = compileDocument(
    `<html><head>${options.head || ''}<style>${css}</style></head><body>${body}</body></html>`,
    { from: 'html', Parser, ...options },
  );
  return result;
}
function prop(result, name = 'target') {
  assert.ok(result.document, result.diagnostics.map((d) => d.message).join('\n'));
  let found;
  walk(result.document.root, (node) => {
    if (node.props?.['x:Name'] === name) found = node;
  });
  assert.ok(found, name);
  return found.props;
}
function matching(body, selector, options = {}) {
  const input = parseHtml(`<html><body>${body}</body></html>`, { Parser }),
    ctx = { input, parents: new Map(), previousElements: new Map(), options },
    result = [];
  walk(input.root, (n, p) => {
    if (p) ctx.parents.set(n.id, p);
    let last;
    for (const c of n.children || [])
      if (c.kind === 'element') {
        if (last) ctx.previousElements.set(c.id, last);
        last = c;
      }
  });
  const plan = compileCssSelector(selector);
  assert.ok(plan, selector);
  walk(input.root, (n) => {
    if (n.kind === 'element' && matchesCssSelector(n, plan, ctx) && n.props.id)
      result.push(n.props.id);
  });
  return result;
}
test('functional selectors compute maximum and zero specificity without matching-arm bias', () => {
  assert.deepEqual(compileCssSelector('button:is(.a,#never):where(#zero)').specificity, [1, 0, 1]);
  assert.deepEqual(compileCssSelector('div:has(> #a, + .b)').specificity, [1, 0, 1]);
  assert.deepEqual(compileCssSelector(':nth-child(2n + 1 of .a,#b)').specificity, [1, 1, 0]);
  assert.equal(compileCssSelector(':has(:has(button))'), null);
  assert.equal(compileCssSelector(':not(:unknown,button)'), null);
  assert.ok(compileCssSelector(':is(:unknown,button)'));
  const r = fixture(
    'button:is(.a,#never){width:21px}.a.a.a{width:99px}:where(#target){height:10px}button{height:30px}',
    {},
    '<button id="target" class="a">X</button>',
  );
  assert.equal(prop(r).Width, '21');
  assert.equal(prop(r).Height, '30');
});
test('structural and filtered An+B selectors honor element siblings, type and negative series', () => {
  const body =
    '<div><button id="a" class="on">A</button>text<!--gap--><span id="s"></span><button id="b">B</button><button id="c" class="on">C</button><button id="d" class="on">D</button></div>';
  for (const [selector, expected] of [
    ['button:first-child', ['a']],
    ['button:last-child', ['d']],
    ['span:only-of-type', ['s']],
    ['button:nth-child(-n + 3)', ['a', 'b']],
    ['button:nth-last-of-type(2)', ['c']],
    [':nth-child(2 of .on)', ['c']],
    [':nth-last-child(odd of .on)', ['a', 'd']],
  ])
    assert.deepEqual(matching(body, selector), expected, selector);
});
test('relative has supports descendant, direct child and following sibling relationships', () => {
  const b =
    '<section id="one"><div><button class="ok"></button></div></section><section id="two"><button></button></section><p id="last"></p>';
  assert.deepEqual(matching(b, 'section:has(.ok)'), ['one']);
  assert.deepEqual(matching(b, 'section:has(>button)'), ['two']);
  assert.deepEqual(matching(b, 'section:has(+section>button)'), ['one']);
  assert.deepEqual(matching(b, 'section:has(~p)'), ['one', 'two']);
  assert.deepEqual(matching(b, 'section:not(:has(.ok))'), ['two']);
});
test('form predicates implement disabled-fieldset legend exception and implicit option selection', () => {
  const b =
    '<fieldset disabled><legend><input id="legend"></legend><input id="disabled"></fieldset><input id="required" required><input id="hidden" type="hidden" required><select><option id="oa" disabled>A</option><option id="ob">B</option></select><textarea id="ph" placeholder=""></textarea>';
  assert.deepEqual(matching(b, 'input:enabled'), ['legend', 'required', 'hidden']);
  assert.deepEqual(matching(b, 'input:disabled'), ['disabled']);
  assert.deepEqual(matching(b, ':required'), ['required']);
  assert.deepEqual(matching(b, 'option:checked'), ['ob']);
  assert.deepEqual(matching(b, ':placeholder-shown'), ['ph']);
});
test('language, explicit dynamic state and target matching propagate only defined states', () => {
  const b =
    '<main id="m" lang="pl-PL" dir="rtl"><button id="a"></button><button id="b"></button></main>';
  assert.deepEqual(matching(b, 'button:lang(pl):dir(rtl)'), ['a', 'b']);
  assert.deepEqual(matching(b, ':hover', { pseudoStates: { a: ['hover'] } }), ['m', 'a']);
  assert.deepEqual(matching(b, ':focus-within', { pseudoStates: { b: ['focus-visible'] } }), [
    'm',
    'b',
  ]);
  assert.deepEqual(matching(b, ':target', { targetId: 'a' }), ['a']);
});
test('selector matching work budgets fail atomically, never silently drop rules', () => {
  const r = fixture(
    'button:has(span){width:1px}',
    { maxSelectorSteps: 1 },
    '<button id="target"><span>X</span></button>',
  );
  assert.equal(r.success, false);
  assert.equal(r.source, '');
  assert.match(r.diagnostics.at(-1).message, /maxSelectorSteps/);
});
test('conditional evaluator supports types, nested boolean logic, ranges and resolution', () => {
  for (const [query, expected] of [
    ['screen and (400px <= width < 900px)', true],
    ['print, (width > 900px)', false],
    ['not print and (width > 900px)', true],
    ['((width >= 800px) and (height <= 600px)) or (monochrome)', true],
    ['(orientation: landscape)', true],
    ['(aspect-ratio: 4/3)', true],
    ['(min-resolution:192dpi)', true],
    ['(prefers-color-scheme:dark)', true],
    ['(width:50em)', true],
    ['not (unknown-feature)', null],
  ])
    assert.equal(evaluateCssCondition(query, env), expected, query);
  assert.equal(evaluateCssCondition('(width > 2px)'), null);
  assert.equal(
    evaluateCssCondition('(display:grid)', { supports: { 'display:grid': true } }, 'supports'),
    true,
  );
  assert.equal(evaluateCssCondition('not (display:unknown)', {}, 'supports'), null);
});
test('media and supports branches are selected in original cascade order', () => {
  const css =
    'button{width:10px}@media (width >= 600px){button{width:20px}@supports (display:grid){button{height:30px}}}@media print{button{width:99px}}';
  const a = fixture(css, { environment: { ...env, supports: { 'display:grid': true } } });
  assert.equal(prop(a).Width, '20');
  assert.equal(prop(a).Height, '30');
  const b = fixture(css, {
    environment: { ...env, width: 400, supports: { 'display:grid': true } },
  });
  assert.equal(prop(b).Width, '10');
  assert.equal(prop(b).Height, undefined);
  assert(!a.losses.some((d) => d.code === 'CONDITIONAL_CSS'));
});
test('unprovided conditions are explicit losses including negation and strict failure', () => {
  const r = fixture('@media not (width > 1px){button{width:99px}}button{height:10px}', {
    strict: true,
  });
  assert.equal(r.success, false);
  assert.equal(prop(r).Width, undefined);
  assert(r.losses.some((d) => d.code === 'CONDITIONAL_CSS'));
});
test('container conditions require a host-supplied nearest-container environment per element', () => {
  const r = fixture('@container card (width > 300px){button{height:22px}}', {
    containerEnvironment: (node, name) => ({
      width: name === 'card' && node.props.id === 'target' ? 500 : 100,
    }),
  });
  assert.equal(prop(r).Height, '22');
  assert(!r.losses.some((d) => d.code === 'CONDITIONAL_CSS'));
});
test('cascade layers apply normal order, unlayered priority and reversed important order', () => {
  const r = fixture(
    '@layer base,theme; @layer theme {#target{width:20px;height:20px!important}}@layer base{button{width:10px;height:10px!important}}button{width:30px;height:30px!important}',
  );
  assert.equal(prop(r).Width, '30');
  assert.equal(prop(r).Height, '10');
  const inline = fixture(
    '@layer base{#target{height:10px!important}}',
    {},
    '<button id="target" style="height:40px!important">X</button>',
  );
  assert.equal(prop(inline).Height, '40');
});
test('nested layers keep parent implicit order and revert-layer restores prior layer values', () => {
  const r = fixture(
    '@layer base,theme;@layer base{button{width:11px}}@layer theme{button{width:revert-layer;height:33px}@layer child{button{height:22px}}}',
  );
  assert.equal(prop(r).Width, '11');
  assert.equal(prop(r).Height, '33');
});
test('layer rollback expands shorthands and supports custom properties', () => {
  const r = fixture(
    '@layer a,b;@layer a{button{padding:2px 4px;--size:11px}}@layer b{button{padding:8px;padding-left:revert-layer;--size:revert-layer;width:var(--size)}}',
  );
  assert.equal(prop(r).Padding, '4,8,8,8');
  assert.equal(prop(r).Width, '11');
});
test('external sheets and nested imports retain URL, order, media and layer semantics', () => {
  const stylesheets = {
    'https://example.test/css/main.css':
      '@import "nested/theme.css" layer(theme) (min-width:600px);button{width:30px}',
    'https://example.test/css/nested/theme.css': 'button{height:22px}',
  };
  const r = fixture('button{width:40px}', {
    head: '<link rel="stylesheet" href="../css/main.css">',
    baseUrl: 'https://example.test/views/page.html',
    stylesheets,
    environment: env,
  });
  assert.equal(prop(r).Width, '40');
  assert.equal(prop(r).Height, '22');
  assert.equal(r.metadata.css.stylesheets.length, 2);
  assert(!r.losses.some((d) => d.code === 'EXTERNAL_CSS'));
});
test('repeated noncyclic imports cascade again; cyclic imports terminate explicitly', () => {
  const r = fixture('@import "a.css";@import "b.css";@import "a.css";', {
    stylesheets: { 'a.css': '@import "a.css";button{width:11px}', 'b.css': 'button{width:22px}' },
  });
  assert.equal(prop(r).Width, '11');
  assert(r.diagnostics.some((d) => d.code === 'CSS_IMPORT_CYCLE'));
  assert.equal(r.metadata.css.stylesheets.length, 2);
});
test('missing, async or over-limit stylesheet sources fail without hidden network IO', () => {
  const missing = fixture('@import "missing.css";', { strict: true });
  assert.equal(missing.success, false);
  assert(missing.losses.some((d) => d.code === 'EXTERNAL_CSS'));
  const asyncResult = fixture('@import "a.css";', { resolveStylesheet: () => Promise.resolve('') });
  assert.equal(asyncResult.success, false);
  assert.equal(asyncResult.source, '');
  for (const options of [
    { maxStylesheetBytes: 2 },
    {
      maxStylesheets: 1,
      stylesheets: { 'a.css': '@import "b.css";', 'b.css': 'button{width:1px}' },
    },
    {
      maxStylesheetDepth: 1,
      stylesheets: { 'a.css': '@import "b.css";', 'b.css': '@import "c.css";', 'c.css': '' },
    },
    { maxCssRules: 1 },
  ]) {
    const r = fixture('@import "a.css";button{width:2px}', {
      stylesheets: { 'a.css': 'button{width:1px}' },
      ...options,
    });
    assert.equal(r.success, false, JSON.stringify(options));
    assert.equal(r.source, '');
  }
});
test('disabled, alternate and nonmatching external stylesheets never call the resolver', () => {
  let calls = 0;
  const r = fixture('', {
    head: '<link rel="alternate stylesheet" href="a.css"><link disabled rel="stylesheet" href="b.css"><link media="print" rel="stylesheet" href="c.css">',
    environment: env,
    resolveStylesheet() {
      calls++;
      throw Error('unexpected');
    },
  });
  assert.equal(r.success, true);
  assert.equal(calls, 0);
});
test('import conditions are checked before loading and late imports are ignored', () => {
  let calls = 0;
  const r = fixture(
    '@import "a.css" supports(display:made-up);button{width:12px}@import "b.css";',
    {
      environment: { supports: { 'display:made-up': false } },
      resolveStylesheet() {
        calls++;
        throw Error('unexpected');
      },
    },
  );
  assert.equal(prop(r).Width, '12');
  assert.equal(calls, 0);
  assert(r.diagnostics.some((d) => d.code === 'CSS_IMPORT_ORDER'));
});
test('CSS URL rebasing is token-aware and retains query/hash and quoted non-URL strings', () => {
  assert.equal(
    rebaseCompilerCssUrls(
      'url("../image a.png?q=1#p")  center, "url(no.png)"',
      'https://example.test/css/main.css',
    ),
    'url("https://example.test/image%20a.png?q=1#p")  center, "url(no.png)"',
  );
  assert.deepEqual(
    parseCompilerCssImport(
      '@import url("theme.css") layer(base.theme) supports(display:grid) screen and (width>1px);',
    ),
    {
      href: 'theme.css',
      layer: 'base.theme',
      supports: '(display:grid)',
      media: 'screen and (width>1px)',
    },
  );
});
test('environment lengths implement dimensional math, viewport units, fonts and explicit percentage bases', () => {
  const e = { width: 800, height: 600, fontSize: 20, rootFontSize: 16, percentBase: 600 };
  for (const [value, expected] of [
    ['1in', 96],
    ['2em', 40],
    ['2rem', 32],
    ['10vw', 80],
    ['10vmin', 60],
    ['clamp(100px, calc(50% - 2rem), 400px)', 268],
    ['calc(2 * 10px + 1px)', 21],
    ['max(2px,3px)', 3],
  ])
    assert.equal(resolveCssLength(value, e), expected, value);
  for (const value of [
    'calc(1px+2px)',
    '1px + 2px',
    'calc(1px * 2px)',
    'calc(1px / 0)',
    'calc(1px + 1)',
    'NaNpx',
    '1fr',
    'var(--x)',
    'calc(1% + 2px)',
  ])
    assert.equal(resolveCssLength(value), null, value);
});
test('responsive relative lengths lower only with known environment and containing size', () => {
  const r = fixture(
    '#parent{width:600px}button{width:calc(50% - 2rem);height:10vh;font-size:2rem}',
    { environment: env },
    '<div id="parent"><button id="target">X</button></div>',
  );
  assert.equal(prop(r).Width, '268');
  assert.equal(prop(r).Height, '60');
  assert.equal(prop(r).FontSize, '32');
});
test('bad option limits fail validation and input remains unchanged', () => {
  for (const options of [
    { maxCssRules: NaN },
    { maxStylesheets: 0 },
    { environment: { width: -1 } },
    { maxSelectorSteps: Infinity },
  ])
    assert.equal(fixture('', options).success, false);
  const input = parseHtml('<button style="width:12px">X</button>', { Parser }),
    before = JSON.stringify(input);
  compileDocument(input, { from: 'html', environment: env });
  assert.equal(JSON.stringify(input), before);
});

test('root font declarations supply rem values while media em uses the initial font', () => {
  const r = fixture(
    ':root{font-size:20px}button{width:2rem}@media(width:50em){button{height:11px}}',
    { environment: env },
  );
  assert.equal(prop(r).Width, '40');
  assert.equal(prop(r).Height, '11');
});
