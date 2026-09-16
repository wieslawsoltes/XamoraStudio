import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { compileDocument } from '../dist/core/semantic-compiler.js';
import { compileResponsiveVariants } from '../dist/core/compiler-browser.js';
import { evaluateMediaQuery, evaluateSupportsCondition } from '../dist/core/compiler-css.js';
import { walk } from '../dist/core/model.js';
const Parser = new Window().DOMParser;
const html = (body, css = '') =>
  `<html><head><style>${css}</style></head><body>${body}</body></html>`;
const compile = (body, css, options = {}) =>
  compileDocument(html(body, css), { from: 'html', Parser, ...options });
const find = (result, name) => {
  let found;
  walk(result.document.root, (node) => {
    if (node.props?.['x:Name'] === name) found = node;
  });
  assert.ok(found, name + JSON.stringify(result.diagnostics));
  return found;
};

test('explicit media environments support ranges, units, orientation, lists and three-valued logic', () => {
  const env = {
    type: 'screen',
    width: 800,
    height: 600,
    resolution: 2,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    pointer: 'fine',
    hover: 'hover',
  };
  for (const query of [
    'screen',
    'only screen and (width: 800px)',
    '(40em <= width < 60em)',
    '(height >= 450pt)',
    '(orientation: landscape)',
    '(aspect-ratio: 4/3)',
    '(resolution:192dpi)',
    '(prefers-color-scheme: dark)',
    '(prefers-reduced-motion: reduce)',
    '(pointer:fine) and (hover:hover)',
    'print, (min-width: 700px)',
    '(unknown: 1) or (width: 800px)',
  ])
    assert.equal(evaluateMediaQuery(query, env), true, query);
  for (const query of [
    'print',
    '(width > 800px)',
    'not screen',
    'screen and (width: 900px)',
    '(width: 900px) and (unknown: 1)',
  ])
    assert.equal(evaluateMediaQuery(query, env), false, query);
  for (const query of [
    'not (unknown:1)',
    '(width:1px) or (unknown:1)',
    '(unsupported())',
    '(width:200%)',
  ])
    assert.equal(evaluateMediaQuery(query, env), null, query);
  assert.equal(evaluateMediaQuery('(width:800px)'), null);
  assert.equal(evaluateMediaQuery('(resolution: 2dppx)', env), true);
});

test('supports uses explicit capability maps or callbacks with nested logical conditions', () => {
  const capabilities = { 'display:grid': true, 'display:subgrid': false };
  assert.equal(
    evaluateSupportsCondition('(display:grid) and (not (display:subgrid))', capabilities),
    true,
  );
  assert.equal(evaluateSupportsCondition('not (unknown:value)', capabilities), null);
  assert.equal(
    evaluateSupportsCondition('selector(:has(> p))', (query) => query === 'selector(:has(> p))'),
    true,
  );
});

test('nested media and supports cascade only in the selected environment without altering source metadata', () => {
  const css =
    '#target {width:20px} @media (min-width:600px) { @supports (display:grid) { #target {width:80px} } }';
  const large = compile('<button id="target">T</button>', css, {
    environment: { width: 800 },
    supports: { 'display:grid': true },
  });
  assert.equal(find(large, 'target').props.Width, '80');
  assert.equal(
    find(compile('<button id="target">T</button>', css, { environment: { width: 300 } }), 'target')
      .props.Width,
    '20',
  );
  assert(large.diagnostics.some((d) => d.code === 'CSS_ENVIRONMENT_SNAPSHOT'));
  assert.equal(large.losses.length, 0);
  const back = compileDocument(large.document);
  assert(back.source.includes('@media (min-width:600px)'));
  assert.equal(compile('<button>T</button>', css, { strict: true }).success, false);
});

test('container evaluation is per element and never inferred without a supplied adapter', () => {
  const result = compile(
    '<div><button id="a">A</button><button id="b">B</button></div>',
    '@container card (width > 30px) {button{width:90px}}',
    {
      evaluateCondition: (kind, query, node) =>
        kind === 'container' && query === 'card (width > 30px)' ? node.props.id === 'b' : undefined,
    },
  );
  assert.equal(find(result, 'a').props.Width, undefined);
  assert.equal(find(result, 'b').props.Width, '90');
});

for (const [selector, expected] of [
  ['button:first-child', ['a']],
  ['button:last-child', ['d']],
  ['button:nth-child(2n + 1)', ['a', 'c']],
  ['button:nth-last-child(-n+2)', ['c', 'd']],
  ['button:nth-child(2 of .chosen)', ['c']],
  ['button:nth-last-child(1 of .chosen)', ['d']],
  ['button:not(.chosen)', ['b']],
  ['button:is(.chosen,#b)', ['a', 'b', 'c', 'd']],
  ['button:where(#a,#b)', ['a', 'b']],
  ['button:has(+ button.chosen)', ['b', 'c']],
  ['button:has(~ #d)', ['a', 'b', 'c']],
  ['button:empty', ['d']],
  ['button:lang(en)', ['a', 'b', 'c', 'd']],
])
  test('static pseudo selector ' + selector, () => {
    const result = compile(
      '<div lang="en-GB"><button id="a" class="chosen">A</button><!--ignored--><button id="b">B</button><button id="c" class="chosen">C</button><button id="d" class="chosen"></button></div>',
      `${selector}{width:41px}`,
    );
    for (const id of ['a', 'b', 'c', 'd'])
      assert.equal(find(result, id).props.Width, expected.includes(id) ? '41' : undefined, id);
    assert(!result.diagnostics.some((d) => d.code === 'DYNAMIC_SELECTOR'));
  });

test('logical pseudo specificity follows maximum argument specificity, where remains zero', () => {
  const result = compile(
    '<button id="target" class="chosen">T</button>',
    'button.chosen{width:10px} :is(#unused,.chosen){width:20px} :where(#target){width:30px}',
  );
  assert.equal(find(result, 'target').props.Width, '20');
  assert.equal(
    find(
      compile('<button id="target">T</button>', ':is(:unsupported,button){width:33px}'),
      'target',
    ).props.Width,
    '33',
  );
  assert(
    compile('<button>T</button>', 'button:not(:unsupported){width:33px}', {
      strict: true,
    }).losses.some((d) => d.code === 'DYNAMIC_SELECTOR'),
  );
});

test('checked/disabled/required states follow HTML control applicability, fieldset and legend rules', () => {
  const result = compile(
    '<div><input id="checked" type="checkbox" checked><input id="required" required><input id="readonly" readonly><fieldset disabled><legend><button id="legend">L</button></legend><button id="disabled">D</button></fieldset><div id="notcontrol" disabled></div></div>',
    ':checked{width:11px} :required{width:22px} input:read-only{height:33px} :disabled{height:44px}',
  );
  assert.equal(find(result, 'checked').props.Width, '11');
  assert.equal(find(result, 'required').props.Width, '22');
  assert.equal(find(result, 'readonly').props.Height, '33');
  assert.equal(find(result, 'disabled').props.Height, '44');
  assert.equal(find(result, 'legend').props.Height, undefined);
  assert.equal(find(result, 'notcontrol').props.Height, undefined);
});

test('interaction pseudos require an explicit state and propagate hover/focus ancestry', () => {
  const css = 'button:hover{width:40px} div:focus-within{height:80px}';
  const result = compile('<div id="parent"><button id="target">T</button></div>', css, {
    selectorState: { hover: ['target'], focus: ['target'] },
  });
  assert.equal(find(result, 'target').props.Width, '40');
  assert.equal(find(result, 'parent').props.Height, '80');
  assert.equal(compile('<button>T</button>', css, { strict: true }).success, false);
});

test('external sheets and recursive imports preserve source order and relative URL bases', () => {
  const source =
    '<html><head><style>button{width:1px}</style><link rel="stylesheet" href="../css/main.css"><style>button{height:90px}</style></head><body><button id="target">T</button></body></html>';
  const stylesheets = {
    'https://xamora.invalid/css/main.css': '@import "nested/base.css"; button{width:60px}',
    'https://xamora.invalid/css/nested/base.css': 'button{width:50px;height:80px}',
  };
  const result = compileDocument(source, {
    from: 'html',
    Parser,
    sourceName: 'views/page.html',
    stylesheets,
  });
  assert.equal(find(result, 'target').props.Width, '60');
  assert.equal(find(result, 'target').props.Height, '90');
  assert.deepEqual(result.metadata.stylesheetDependencies, Object.keys(stylesheets));
  assert.equal(result.losses.length, 0);
  assert.deepEqual(stylesheets, {
    'https://xamora.invalid/css/main.css': '@import "nested/base.css"; button{width:60px}',
    'https://xamora.invalid/css/nested/base.css': 'button{width:50px;height:80px}',
  });
});

test('import conditions, link media, disabled/alternate sheets and stylesheet type are respected', () => {
  const source =
    '<html><head><link rel="stylesheet" href="a.css" media="screen"><link rel="alternate stylesheet" href="absent.css"><style type="text/plain">button{width:99px}</style><style disabled>button{width:98px}</style></head><body><button id="target">T</button></body></html>';
  const result = compileDocument(source, {
    from: 'html',
    Parser,
    environment: { type: 'screen', width: 800 },
    supports: { 'display:grid': true },
    stylesheets: {
      'a.css': '@import "b.css" supports(display:grid) (width >= 700px);',
      'b.css': 'button{width:47px}',
    },
  });
  assert.equal(find(result, 'target').props.Width, '47');
  assert.equal(result.losses.length, 0);
});

test('layers reverse important precedence and retain nesting and unlayered priority', () => {
  const result = compile(
    '<button id="target">T</button>',
    '@layer reset,theme; @layer theme {#target{width:20px!important;height:20px}} @layer reset {button{width:10px!important;height:10px}} button{width:30px!important;height:30px}',
  );
  assert.equal(find(result, 'target').props.Width, '10');
  assert.equal(find(result, 'target').props.Height, '30');
  const nested = compile(
    '<button id="target">T</button>',
    '@layer a {button{width:10px} @layer child{button{width:20px}}}',
  );
  assert.equal(find(nested, 'target').props.Width, '10');
  assert.equal(
    find(
      compile(
        '<button id="target" style="width:71px!important">T</button>',
        '@layer a{#target{width:1px!important}}',
      ),
      'target',
    ).props.Width,
    '71',
  );
});

test('missing imports, cycles, unsafe URLs and expansion limits produce losses without any fetching', () => {
  for (const [css, stylesheets, code] of [
    ['@import "missing.css";', {}, 'EXTERNAL_CSS'],
    ['@import "a.css";', { 'a.css': '@import "a.css";' }, 'CSS_IMPORT_CYCLE'],
    ['@import "javascript:alert(1)";', {}, 'CSS_STYLESHEET_URL'],
    ['@import "a.css";', { 'a.css': ' '.repeat(2_000_001) }, 'CSS_STYLESHEET_LIMIT'],
  ]) {
    const result = compile('<button>T</button>', css, { stylesheets, strict: true });
    assert.equal(result.success, false);
    assert(
      result.losses.some((d) => d.code === code),
      JSON.stringify(result.diagnostics),
    );
  }
});

test('native output wraps panel boxes and lowers WPF gaps into real spacer tracks', () => {
  const result = compile(
    '<div id="grid"><button id="a">A</button><button id="b">B</button></div>',
    '#grid{display:grid;grid-template-columns:100px 200px;gap:12px;padding:8px;border-width:2px;color:red}',
    { nativeOutput: true },
  );
  assert.equal(find(result, 'grid').type, 'Border');
  assert.equal(find(result, 'grid').props.Padding, '8');
  const grid = find(result, 'grid').children[0];
  assert.equal(grid.type, 'Grid');
  assert.equal(grid.props.Foreground, undefined);
  assert.deepEqual(
    grid.children
      .find((n) => n.type === 'Grid.ColumnDefinitions')
      .children.map((n) => n.props.Width),
    ['100', '12', '200'],
  );
  assert.equal(find(result, 'b').props['Grid.Column'], '2');
  assert.equal(result.metadata.preserved, false);
  assert(!result.source.includes('Spacing='));
  assert.equal(result.losses.length, 0);
});

test('responsive variants use independent explicit environments and retain the original input', () => {
  const source = html(
    '<button id="target">T</button>',
    'button{width:40px} @media(width >= 700px){button{width:80px}}',
  );
  const result = compileResponsiveVariants(source, {
    Parser,
    variants: [
      { name: 'phone', width: 360, height: 800 },
      { name: 'desktop', width: 1200, height: 800 },
    ],
  });
  assert.equal(result.success, true);
  assert.deepEqual(
    result.profiles.map((p) => find(p.result, 'target').props.Width),
    ['40', '80'],
  );
  assert.throws(() =>
    compileResponsiveVariants(source, { variants: [{ name: 'a', width: 0, height: 1 }] }),
  );
  assert.throws(() =>
    compileResponsiveVariants(source, {
      variants: [
        { name: 'a', width: 1, height: 1 },
        { name: 'a', width: 2, height: 2 },
      ],
    }),
  );
});

test('invalid media values and invalid environments remain unknown under negation', () => {
  assert.equal(evaluateMediaQuery('not (hover: nonsense)', { hover: 'hover' }), null);
  assert.equal(evaluateMediaQuery('(width > 3px)', { width: NaN }), null);
  assert.equal(evaluateMediaQuery('screen', { type: 4 }), null);
  assert.equal(evaluateMediaQuery('(width > 3px)', null), null);
});
test('native Avalonia gap and tooltip output uses real platform property names', () => {
  const result = compile(
    '<div id="target" title="Hint" style="display:grid;gap:8px;padding:4px"><button>A</button><button>B</button></div>',
    '',
    { nativeOutput: true, framework: 'Avalonia' },
  );
  assert.equal(result.success, true);
  assert.match(result.source, /RowSpacing="8"/);
  assert.match(result.source, /ColumnSpacing="8"/);
  assert.doesNotMatch(result.source, /\sSpacing=/);
  assert.match(result.source, /ToolTip.Tip="Hint"/);
});
