import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { compileDocument } from '../dist/core/semantic-compiler.js';
import { walk } from '../dist/core/model.js';
import {
  cssBoxLonghands,
  cssBoxFamily,
  physicalCssProperty,
} from '../dist/core/compiler-logical.js';
const Parser = new Window().DOMParser;
function fixture(style, options = {}, head = '', body = '') {
  return compileDocument(
    `<html><head>${head}</head><body>${body || `<button id="target" style="${style}">T</button>`}</body></html>`,
    { from: 'html', Parser, ...options },
  );
}
function named(result, id = 'target') {
  assert(result.document, JSON.stringify(result.diagnostics));
  let found;
  walk(result.document.root, (node) => {
    if (node.props?.['x:Name'] === id) found = node;
  });
  assert(found, id);
  return found;
}
const props = (result, id) => named(result, id).props;
function returned(result) {
  const back = compileDocument(result.document, { to: 'html' });
  assert(back.success, JSON.stringify(back.diagnostics));
  return new Parser().parseFromString(back.source, 'text/html');
}

test('logical name mapping covers dimensions, axes, sideways modes and unknown names', () => {
  for (const [mode, block, inline] of [
    ['horizontal-tb', ['top', 'bottom'], ['left', 'right']],
    ['vertical-rl', ['right', 'left'], ['top', 'bottom']],
    ['vertical-lr', ['left', 'right'], ['top', 'bottom']],
    ['sideways-rl', ['right', 'left'], ['top', 'bottom']],
    ['sideways-lr', ['left', 'right'], ['bottom', 'top']],
  ])
    for (const direction of ['ltr', 'rtl']) {
      const flow = { direction, 'writing-mode': mode };
      for (const [axis, sides] of [
        ['block', block],
        ['inline', direction === 'rtl' ? [...inline].reverse() : inline],
      ])
        for (const [index, edge] of ['start', 'end'].entries()) {
          assert.equal(
            physicalCssProperty(`padding-${axis}-${edge}`, flow),
            'padding-' + sides[index],
          );
          assert.equal(physicalCssProperty(`inset-${axis}-${edge}`, flow), sides[index]);
          assert.equal(
            physicalCssProperty(`border-${axis}-${edge}-width`, flow),
            `border-${sides[index]}-width`,
          );
        }
      assert.equal(
        physicalCssProperty('min-inline-size', flow),
        mode === 'horizontal-tb' ? 'min-width' : 'min-height',
      );
      assert.equal(
        physicalCssProperty('max-block-size', flow),
        mode === 'horizontal-tb' ? 'max-height' : 'max-width',
      );
    }
  assert.equal(physicalCssProperty('padding-inline-start', { 'writing-mode': 'unknown' }), null);
  for (const property of ['--inline-size', 'padding-inline-extra', 'border-inline-color', 'color'])
    assert.equal(physicalCssProperty(property), property);
  assert.deepEqual(cssBoxLonghands('margin-inline'), ['margin-inline-start', 'margin-inline-end']);
  assert.deepEqual(cssBoxLonghands('inset'), ['top', 'right', 'bottom', 'left']);
  assert.equal(cssBoxLonghands('border-inline'), null);
  assert.equal(cssBoxFamily('min-block-size', { 'writing-mode': 'vertical-rl' }), 'min-width');
});

for (const framework of ['WPF', 'Avalonia']) {
  test(`${framework} logical size and two-value spacing lower without native property losses`, () => {
    const result = fixture(
      'direction:rtl;inline-size:180px;block-size:40px;min-inline-size:20px;max-block-size:70px;margin-block:3px 9px;padding-inline:6px 14px;border-inline-width:2px 4px',
      { framework },
    );
    assert(result.success, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.losses, []);
    const p = props(result);
    assert.equal(p.Width, '180');
    assert.equal(p.Height, '40');
    assert.equal(p.MinWidth, '20');
    assert.equal(p.MaxHeight, '70');
    assert.equal(p.Padding, '14,0,6,0');
    assert.equal(p.Margin, '0,3,0,9');
    assert.equal(p.BorderThickness, '4,0,2,0');
    assert.equal(p.FlowDirection, 'RightToLeft');
  });
  test(`${framework} declaration order is retained across mapped logical and physical candidates`, () => {
    for (const [style, expected] of [
      ['padding-inline:4px 8px;padding-left:11px', '11,0,8,0'],
      ['padding-left:11px;padding-inline:4px 8px', '4,0,8,0'],
      ['padding-inline-start:4px;padding:1px 2px 3px 6px;padding-inline-end:9px', '6,1,9,3'],
      ['padding-inline-start:4px!important;padding-left:8px', '4,0,0,0'],
      ['padding-left:8px!important;padding-inline-start:4px', '8,0,0,0'],
      ['padding-inline:4px 8px!important;padding:3px!important', '3'],
    ])
      assert.equal(props(fixture(style, { framework })).Padding, expected, style);
  });
  test(`${framework} direction resolves from variables, inheritance and the winning cascade before mapping`, () => {
    const result = fixture(
      '',
      { framework },
      '<style>button{direction:var(--flow);padding-inline:5px 13px} #target{direction:ltr} @layer theme{button{direction:rtl!important}} </style>',
      '<section style="--flow:rtl;direction:ltr"><button id="target" dir="ltr" style="padding-inline-start:7px">T</button></section>',
    );
    assert.equal(props(result).Padding, '13,0,7,0');
    assert.equal(props(result).FlowDirection, 'RightToLeft');
    const inherited = fixture(
      '',
      { framework },
      '',
      '<section dir="rtl"><button id="target" style="padding-inline:2px 8px">T</button></section>',
    );
    assert.equal(props(inherited).Padding, '8,0,2,0');
    assert.equal(
      props(fixture('padding-inline:2px 8px;direction:RTL', { framework })).Padding,
      '8,0,2,0',
    );
  });
  test(`${framework} layer rollback spans logical and physical aliases including important layers`, () => {
    const head =
      '<style>@layer base,theme; @layer base {button{padding-left:11px;inline-size:70px}} @layer theme {button{padding-inline-start:25px;padding-left:revert-layer;width:90px;inline-size:revert-layer}} </style>';
    const result = fixture('', { framework }, head);
    assert.equal(props(result).Padding, '11,0,0,0');
    assert.equal(props(result).Width, '70');
    const priority = fixture(
      '',
      { framework },
      '<style>@layer a,b; @layer a {button{padding-inline:2px 7px!important}} @layer b {button{padding-left:80px!important}} button {padding-right:90px!important}</style>',
    );
    assert.equal(props(priority).Padding, '2,0,7,0');
  });
  test(`${framework} deferred pairs, explicit inheritance and invalid substitution do not resurrect old values`, () => {
    const r = fixture(
      'padding:8px;--pair:3px 7px;padding-inline:var(--pair);padding-inline-end:9px',
      { framework },
    );
    assert.equal(props(r).Padding, '3,8,9,8');
    const invalid = fixture('padding:8px;--pair:1px 2px 3px;padding-inline:var(--pair)', {
      framework,
    });
    assert.equal(props(invalid).Padding, '0,8,0,8');
    assert(invalid.losses.some((d) => d.code === 'CSS_VALUE'));
    const inherited = fixture(
      '',
      { framework },
      '',
      '<section style="direction:rtl;padding:1px 2px 3px 4px"><button id="target" style="padding-inline:INHERIT;padding-block:initial">T</button></section>',
    );
    assert.equal(props(inherited).Padding, '4,0,2,0');
    const absent = fixture('padding-inline:var(--missing)', { framework });
    assert.equal(props(absent).Padding, '0');
    assert(absent.losses.some((d) => d.code === 'CSS_VARIABLE'));
  });
  test(`${framework} parser-invalid pair counts and flow keywords do not replace earlier declarations`, () => {
    const result = fixture(
      'padding-inline:3px 8px;padding-inline:1px 2px 3px;direction:rtl;direction:sideways',
      { framework },
    );
    assert.equal(props(result).Padding, '8,0,3,0');
    assert.equal(props(result).FlowDirection, 'RightToLeft');
    assert.equal(result.losses.length, 0);
    assert.equal(result.diagnostics.filter((d) => d.code === 'CSS_INVALID_DECLARATION').length, 2);
  });
  test(`${framework} logical percentage and calculated sizes use the explicit parent and viewport environment`, () => {
    const result = fixture(
      '',
      { framework, environment: { width: 800, height: 600 } },
      '',
      '<section style="width:400px;height:200px"><button id="target" style="inline-size:calc(50% - 8px);block-size:25%;padding-inline:2.5% 5%;margin-block:1rem">T</button></section>',
    );
    assert.equal(props(result).Width, '192');
    assert.equal(props(result).Height, '50');
    assert.equal(props(result).Padding, '10,0,20,0');
    assert.equal(props(result).Margin, '0,16,0,16');
  });
  test(`${framework} logical insets retain auto as an absent native offset`, () => {
    const result = fixture(
      '',
      { framework },
      '',
      '<div style="position:relative"><button id="target" style="position:absolute;direction:rtl;inset:1px 2px 3px 4px;inset-inline:8px auto">T</button></div>',
    );
    const p = props(result);
    assert.equal(p['Canvas.Top'], '1');
    assert.equal(p['Canvas.Bottom'], '3');
    assert.equal(p['Canvas.Right'], '8');
    assert.equal(p['Canvas.Left'], undefined);
    assert(!result.losses.some((d) => d.code === 'CSS_VALUE'));
  });
  test(`${framework} auto margins are explicit losses instead of invalid native Auto thickness`, () => {
    const result = fixture('margin-inline:auto;padding:2px', { framework });
    assert.equal(props(result).Margin, undefined);
    assert(result.losses.some((d) => d.code === 'CSS_VALUE'));
    assert.equal(fixture('margin-inline:auto', { framework, strict: true }).success, false);
  });
}

test('vertical box previews map axes but diagnose unavailable native writing-mode semantics', () => {
  const result = fixture(
    'writing-mode:vertical-rl;inline-size:100px;block-size:50px;padding-block:3px 9px',
  );
  assert.equal(props(result).Height, '100');
  assert.equal(props(result).Width, '50');
  assert.equal(props(result).Padding, '9,0,3,0');
  assert(result.losses.some((d) => d.code === 'CSS_WRITING_MODE'));
  assert.equal(
    fixture('writing-mode:vertical-rl;inline-size:100px', { strict: true }).success,
    false,
  );
});

test('cross-flow explicit inheritance is reported instead of claiming draft/browser agreement', () => {
  const result = fixture(
    '',
    {},
    '',
    '<section style="direction:ltr;margin:1px 27px 3px 11px"><button id="target" style="direction:rtl;margin-inline-start:inherit">T</button></section>',
  );
  assert.equal(props(result).Margin, '0,0,27,0');
  assert(result.losses.some((d) => d.code === 'CSS_LOGICAL_INHERITANCE'));
});

test('unchanged logical CSS source retains comments, fallbacks and importance byte for byte', () => {
  const style =
    '/*before*/ padding-inline: 3px 8px; padding-inline: var(--space, 4px 9px) !important; inline-size:120px; --author: "a;b";';
  const result = fixture(style.replaceAll('"', '&quot;'));
  assert.equal(returned(result).getElementById('target').getAttribute('style'), style);
});

test('reverse native thickness edits override important logical and physical aliases without losing unrelated CSS', () => {
  const result = fixture(
    'direction:rtl; padding-inline:6px 14px!important; padding-left:20px; width:90px; --keep:3px; color:red',
  );
  named(result).props.Padding = '10,20,30,40';
  const html = returned(result),
    style = html.getElementById('target').getAttribute('style');
  assert(style.includes('--keep:3px'));
  assert(style.includes('color:red'));
  assert(style.includes('width:90px'));
  assert(!style.includes('padding-inline'));
  assert(!style.includes('padding-left'));
  assert.match(style, /padding: 20px 30px 40px 10px !important/);
  assert.equal(
    props(compileDocument(html.documentElement.outerHTML, { from: 'html', Parser })).Padding,
    '10,20,30,40',
  );
});

test('reverse edits carry stylesheet importance through logical metadata and reset without resurrection', () => {
  const result = fixture(
    '',
    {},
    '<style>button{inline-size:120px!important;padding-inline:5px 9px!important}</style>',
  );
  named(result).props.Width = '200';
  named(result).props.Padding = '7';
  const round = returned(result);
  const style = round.getElementById('target').getAttribute('style');
  assert.match(style, /width: 200px !important/);
  assert.match(style, /padding: 7px !important/);
  let next = compileDocument(round.documentElement.outerHTML, { from: 'html', Parser });
  assert.equal(props(next).Width, '200');
  assert.equal(props(next).Padding, '7');
  delete named(result).props.Width;
  delete named(result).props.Padding;
  next = compileDocument(returned(result).documentElement.outerHTML, { from: 'html', Parser });
  assert.equal(props(next).Width, 'Auto');
  assert.equal(props(next).Padding, '0');
});

test('reverse inset edits materialize unedited offsets and unset removed offsets', () => {
  const result = fixture('position:absolute;inset-inline:8px 12px!important;inset-block:3px 7px');
  named(result).props['Canvas.Left'] = '22';
  delete named(result).props['Canvas.Top'];
  const html = returned(result);
  const style = html.getElementById('target').getAttribute('style');
  assert(!style.includes('inset-inline'));
  assert(!style.includes('inset-block'));
  const next = compileDocument(html.documentElement.outerHTML, { from: 'html', Parser });
  assert.equal(props(next)['Canvas.Left'], '22');
  assert.equal(props(next)['Canvas.Right'], '12');
  assert.equal(props(next)['Canvas.Top'], undefined);
  assert.equal(props(next)['Canvas.Bottom'], '7');
});

test('a direction edit preserves concrete native thickness while unchanged logical dimensions remain authored', () => {
  const result = fixture('direction:rtl;inline-size:120px;padding-inline:3px 8px');
  named(result).props.FlowDirection = 'LeftToRight';
  const html = returned(result);
  assert(html.getElementById('target').getAttribute('style').includes('inline-size:120px'));
  assert.equal(
    props(compileDocument(html.documentElement.outerHTML, { from: 'html', Parser })).Padding,
    '8,0,3,0',
  );
});

test('logical metadata validation rejects malformed or oversized contexts without mutating input', () => {
  const result = fixture('padding-inline:3px 8px');
  const target = named(result),
    meta = JSON.parse(target.props['web:Source.Metadata']);
  meta.logicalCss.important = {};
  target.props['web:Source.Metadata'] = JSON.stringify(meta);
  const snapshot = JSON.stringify(result.document);
  const back = compileDocument(result.document, { to: 'html' });
  assert(back.diagnostics.some((d) => d.code === 'INVALID_METADATA'));
  assert.equal(JSON.stringify(result.document), snapshot);
});

test('mixed CSS-wide tokens from variables invalidate the whole winning shorthand', () => {
  for (const framework of ['WPF', 'Avalonia']) {
    const pair = fixture('padding:7px;--bad:inherit 4px;padding-inline:var(--bad)', { framework });
    assert.equal(props(pair).Padding, '0,7,0,7');
    assert(pair.losses.some((d) => d.code === 'CSS_VALUE'));
    const box = fixture('padding:7px;--bad:initial 4px 5px;padding:var(--bad)', { framework });
    assert.equal(props(box).Padding, '0');
    assert(box.losses.some((d) => d.code === 'CSS_VALUE'));
  }
});
