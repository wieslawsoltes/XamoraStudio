import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { walk } from '../dist/core/model.js';
import { parseHtml } from '../dist/core/html.js';
import { compileDocument } from '../dist/core/semantic-compiler.js';
import {
  compileRenderedDocument,
  compileResponsiveVariants,
  observeRenderedDocument,
} from '../dist/core/compiler-browser.js';

function realm(t) {
  const window = new Window();
  t.after(() => window.happyDOM.close());
  return { window, document: window.document, Parser: window.DOMParser };
}
function property(result, name, key) {
  let value;
  walk(result.document.root, (node) => {
    if (node.props?.['x:Name'] === name) value = node.props[key];
  });
  return value;
}
const source = `<html><head><style>
  #target{width:10vw;height:24px}
  @media(width<500px){#target{height:32px}}
</style></head><body><button id="target">Profile</button></body></html>`;

test('responsive profiles validate then compile independent environments without mutating input', (t) => {
  const { Parser } = realm(t);
  const input = parseHtml(source, { Parser });
  const before = JSON.stringify(input);
  const variants = Object.freeze([
    Object.freeze({ name: 'narrow', width: 380, height: 700 }),
    Object.freeze({ name: 'wide', width: 900, height: 600 }),
  ]);
  const environment = Object.freeze({ viewport: Object.freeze({ width: 1234, height: 1000 }) });
  for (const framework of ['WPF', 'Avalonia']) {
    const result = compileResponsiveVariants(input, { variants, environment, framework });
    assert(result.success);
    assert.deepEqual(
      result.profiles.map((p) => p.name),
      ['narrow', 'wide'],
    );
    assert.deepEqual(
      result.profiles.map((p) => property(p.result, 'target', 'Width')),
      ['38', '90'],
    );
    assert.deepEqual(
      result.profiles.map((p) => property(p.result, 'target', 'Height')),
      ['32', '24'],
    );
    assert.deepEqual(result.profiles[0].environment.viewport, { width: 380, height: 700 });
    assert.notEqual(result.profiles[0].result.document, result.profiles[1].result.document);
    assert.equal(result.profiles[0].environment.name, undefined);
  }
  assert.equal(JSON.stringify(input), before);
  assert.equal(environment.viewport.width, 1234);
});

test('invalid profile requests are rejected before any compiler host hooks run', (t) => {
  const { Parser } = realm(t);
  const valid = { name: 'valid', width: 400, height: 300 };
  let calls = 0;
  for (const variants of [
    undefined,
    [],
    Array(33).fill(valid),
    [valid, valid],
    [valid, null],
    [valid, { ...valid, name: '../other' }],
    [valid, { ...valid, name: 'bad', width: 0 }],
    [valid, { ...valid, name: 'bad', height: Infinity }],
    [valid, { ...valid, name: 'bad', width: 100001 }],
  ]) {
    assert.throws(
      () =>
        compileResponsiveVariants(
          '<html><head><link rel="stylesheet" href="a.css"></head><body/></html>',
          {
            variants,
            Parser,
            baseUrl: 'https://example.invalid/',
            resolveStylesheet() {
              calls++;
              return '';
            },
          },
        ),
      /variant/i,
    );
  }
  assert.equal(calls, 0);
});

test('responsive profile failures retain per-profile diagnostics instead of claiming equivalence', (t) => {
  const { Parser } = realm(t);
  const result = compileResponsiveVariants(
    '<html><body><canvas id="paint"></canvas></body></html>',
    {
      Parser,
      strict: true,
      preserveMetadata: false,
      variants: [
        { name: 'phone', width: 380, height: 700 },
        { name: 'desktop', width: 900, height: 600 },
      ],
    },
  );
  assert.equal(result.success, false);
  assert.equal(result.profiles.length, 2);
  assert(result.profiles.every((p) => !p.result.success && p.result.losses.length));
});

test('rendered capture omits authored and current passwords before metadata is generated', (t) => {
  const { document, Parser } = realm(t);
  document.body.innerHTML =
    '<input type="PASSWORD" id="secret" value="authored-secret"><input id="plain" value="normal">';
  const input = document.querySelector('#secret');
  input.value = 'current-secret';
  const before = document.body.outerHTML;
  for (const framework of ['WPF', 'Avalonia'])
    for (const preserveMetadata of [false, true]) {
      const result = compileRenderedDocument(document.body, { framework, preserveMetadata });
      assert(result.success);
      assert(!JSON.stringify(result).includes('authored-secret'));
      assert(!JSON.stringify(result).includes('current-secret'));
      const back = compileDocument(result.document);
      assert(!back.source.includes('authored-secret'));
      assert(!back.source.includes('current-secret'));
      const parsed = new Parser().parseFromString(back.source, 'text/html');
      assert.equal(parsed.querySelector('#plain')?.getAttribute('value'), 'normal');
      assert(result.diagnostics.some((d) => d.code === 'BROWSER_PASSWORD_REDACTED'));
      assert(!result.losses.some((d) => d.code === 'BROWSER_PASSWORD_REDACTED'));
    }
  assert.equal(input.value, 'current-secret');
  assert.equal(document.body.outerHTML, before);
});

test('password capture requires explicit boolean opt-in and exports current not authored state', (t) => {
  const { document } = realm(t);
  document.body.innerHTML = '<input id="secret" type="password" value="authored-secret">';
  document.querySelector('input').value = 'current-secret';
  const result = compileRenderedDocument(document.body, { includePasswordValues: true });
  assert.equal(property(result, 'secret', 'Password'), 'current-secret');
  assert(!result.diagnostics.some((d) => d.code === 'BROWSER_PASSWORD_REDACTED'));
  assert(!JSON.stringify(result).includes('authored-secret'));
  for (const includePasswordValues of ['true', 1, null])
    assert.throws(
      () => compileRenderedDocument(document.body, { includePasswordValues }),
      /boolean/,
    );
});

function observation(t) {
  const dom = realm(t),
    { window, document } = dom;
  document.body.innerHTML = '<div id="root"><input id="text" value="capture"></div>';
  const root = document.querySelector('#root');
  const instances = [],
    queries = [],
    frames = new Map();
  let sequence = 0,
    calls = 0;
  class Observer {
    constructor() {
      this.closed = false;
      instances.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      this.closed = true;
    }
  }
  t.mock.method(window, 'ResizeObserver', function () {
    return new Observer();
  });
  t.mock.method(window, 'MutationObserver', function () {
    return new Observer();
  });
  t.mock.method(window, 'requestAnimationFrame', (cb) => {
    frames.set(++sequence, cb);
    return sequence;
  });
  t.mock.method(window, 'cancelAnimationFrame', (id) => frames.delete(id));
  t.mock.method(window, 'matchMedia', (query) => {
    const target = new window.EventTarget();
    target.query = query;
    queries.push(target);
    return target;
  });
  const onResult = () => calls++;
  return { ...dom, root, instances, queries, frames, onResult, calls: () => calls };
}

test('observer media queries add to defaults, deduplicate, coalesce and release event listeners', (t) => {
  const { window, document, root, instances, queries, frames, onResult, calls } = observation(t);
  const observer = observeRenderedDocument(root, {
    onResult,
    observeMedia: ['(pointer: coarse)', '(prefers-color-scheme: dark)'],
  });
  assert.equal(calls(), 1);
  assert.equal(queries.length, 4);
  queries[3].dispatchEvent(new window.Event('change'));
  document.dispatchEvent(new window.Event('load'));
  window.dispatchEvent(new window.Event('scroll'));
  assert.equal(frames.size, 1);
  observer.dispose();
  observer.dispose();
  assert.equal(frames.size, 0);
  assert(instances.every((o) => o.closed));
  for (const query of queries) query.dispatchEvent(new window.Event('change'));
  document.dispatchEvent(new window.Event('load'));
  root.dispatchEvent(new window.Event('input'));
  window.dispatchEvent(new window.Event('scroll'));
  assert.equal(frames.size, 0);
  assert.equal(observer.refresh(), null);
  assert.equal(calls(), 1);
});

test('observer installation rollback releases earlier observers and listeners on adapter failure', (t) => {
  const { window, document, root, instances, frames, onResult } = observation(t);
  t.mock.method(window, 'matchMedia', () => {
    throw Error('Media adapter failed');
  });
  assert.throws(() => observeRenderedDocument(root, { onResult }), /Media adapter failed/);
  assert(instances.every((o) => o.closed));
  for (const target of [root, document, window])
    for (const type of ['input', 'load', 'resize', 'scroll'])
      target.dispatchEvent(new window.Event(type));
  assert.equal(frames.size, 0);
});

test('observer rejects excessive media lists and rolls back initial callback exceptions', (t) => {
  const { root, instances } = observation(t);
  assert.throws(
    () =>
      observeRenderedDocument(root, { onResult() {}, observeMedia: Array(257).fill('(color)') }),
    /256/,
  );
  assert.equal(instances.length, 0);
  assert.throws(
    () =>
      observeRenderedDocument(root, {
        onResult() {
          throw Error('Host failed');
        },
      }),
    /Host failed/,
  );
  assert(instances.every((o) => o.closed));
});

test('Avalonia password fields use a masked native TextBox and reverse to password inputs', (t) => {
  const { Parser } = realm(t);
  const input =
    '<html><body><input id="secret" type="password" value="explicit-source"/></body></html>';
  for (const preserveMetadata of [true, false]) {
    const result = compileDocument(input, {
      from: 'html',
      framework: 'Avalonia',
      preserveMetadata,
      Parser,
    });
    assert(result.success);
    assert.match(result.source, /<TextBox/);
    assert(!result.source.includes('<PasswordBox'));
    assert.equal(property(result, 'secret', 'PasswordChar'), '*');
    assert.equal(property(result, 'secret', 'Text'), 'explicit-source');
    const back = compileDocument(result.document);
    const parsed = new Parser().parseFromString(back.source, 'text/html');
    assert.equal(parsed.querySelector('#secret').type, 'password');
    assert.equal(parsed.querySelector('#secret').value, 'explicit-source');
  }
});
