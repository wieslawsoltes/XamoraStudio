import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { compileRenderedDocument, observeRenderedDocument } from '../dist/core/compiler-browser.js';
import { compileDocument } from '../dist/core/semantic-compiler.js';
import { walk } from '../dist/core/model.js';

function fixture(t, html = '<main id="root"></main>') {
  const window = new Window();
  t.after(() => window.close());
  const document = window.document;
  document.body.innerHTML = html;
  // These unit tests assert state/lifecycle only; real geometry is tested in Chromium.
  const getStyle = window.getComputedStyle.bind(window);
  t.mock.method(window, 'getComputedStyle', (node) => getStyle(node));
  return { window, document, root: document.getElementById('root') };
}
function named(result, name) {
  let found;
  walk(result.document.root, (node) => {
    if (node.props?.['x:Name'] === name) found = node;
  });
  assert(found, name);
  return found;
}

for (const framework of ['WPF', 'Avalonia']) {
  test(`${framework} rendered passwords redact live/default values and prior metadata without mutating the DOM`, (t) => {
    const { root } = fixture(
      t,
      '<main id="root"><input id="secret" type="password" value="default-secret"><input id="plain" value="ordinary"></main>',
    );
    const input = root.querySelector('#secret');
    input.value = 'live-secret';
    input.setAttribute(
      'data-xamora-xaml',
      JSON.stringify({
        type: 'PasswordBox',
        props: { Password: 'metadata-secret' },
        generated: { value: 'live-secret' },
      }),
    );
    const before = root.outerHTML;
    for (const preserveMetadata of [true, false]) {
      const result = compileRenderedDocument(root, { framework, preserveMetadata });
      assert(result.success, JSON.stringify(result.diagnostics));
      const content = JSON.stringify(result);
      for (const value of ['default-secret', 'live-secret', 'metadata-secret'])
        assert(!content.includes(value), value);
      assert(result.diagnostics.some((d) => d.code === 'BROWSER_PASSWORD_REDACTED'));
      assert.equal(named(result, 'plain').props.Text, 'ordinary');
      assert.equal(
        named(result, 'secret').type,
        framework === 'Avalonia' ? 'TextBox' : 'PasswordBox',
      );
    }
    assert.equal(root.outerHTML, before);
    assert.equal(input.value, 'live-secret');
  });
  test(`${framework} password values require explicit opt-in and remain masked in native and reverse output`, (t) => {
    const { root, window } = fixture(
      t,
      '<main id="root"><input id="secret" type="password" value="default"></main>',
    );
    root.firstElementChild.value = 'current';
    const result = compileRenderedDocument(root, {
      framework,
      includePasswordValues: true,
      preserveMetadata: false,
    });
    const password = named(result, 'secret');
    assert.equal(password.props[framework === 'Avalonia' ? 'Text' : 'Password'], 'current');
    if (framework === 'Avalonia') assert.equal(password.props.PasswordChar, '●');
    else assert.equal(password.props.TextWrapping, undefined);
    const back = compileDocument(result.document, { to: 'html', preserveMetadata: false });
    const parsed = new window.DOMParser().parseFromString(back.source, 'text/html');
    assert.equal(parsed.getElementById('secret').type, 'password');
    assert.equal(parsed.getElementById('secret').value, 'current');
  });
}

for (const framework of ['WPF', 'Avalonia']) {
  test(`${framework} capture preserves explicitly empty selection and tri-state checkboxes`, (t) => {
    const { root } = fixture(
      t,
      '<main id="root"><select id="choice"><option selected>A</option><option>B</option></select><input id="check" type="checkbox" checked></main>',
    );
    root.querySelector('#choice').selectedIndex = -1;
    root.querySelector('#check').checked = false;
    root.querySelector('#check').indeterminate = true;
    const result = compileRenderedDocument(root, { framework, preserveMetadata: false });
    assert.equal(named(result, 'choice').props.SelectedIndex, '-1');
    assert.equal(named(result, 'check').props.IsChecked, '{x:Null}');
    assert.equal(named(result, 'check').props.IsThreeState, 'True');
    root.querySelector('#check').indeterminate = false;
    assert.equal(
      named(compileRenderedDocument(root, { framework }), 'check').props.IsChecked,
      'False',
    );
  });
}

test('password capture opt-in is type checked rather than accepting truthy strings', (t) => {
  const { root } = fixture(t);
  assert.throws(() => compileRenderedDocument(root, { includePasswordValues: 'false' }), /boolean/);
});

function observedFixture(t) {
  const dom = fixture(t);
  const frames = new Map(),
    observers = [],
    events = new Set();
  let nextFrame = 0;
  for (const kind of ['ResizeObserver', 'MutationObserver']) {
    const original = dom.window[kind];
    t.after(() => {
      dom.window[kind] = original;
    });
    dom.window[kind] = class {
      constructor(callback) {
        this.callback = callback;
        this.targets = new Set();
        observers.push(this);
      }
      observe(target) {
        this.targets.add(target);
      }
      unobserve(target) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    };
  }
  t.mock.method(dom.window, 'requestAnimationFrame', (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  t.mock.method(dom.window, 'cancelAnimationFrame', (id) => frames.delete(id));
  for (const target of [dom.root, dom.document, dom.window]) {
    const add = target.addEventListener.bind(target),
      remove = target.removeEventListener.bind(target);
    t.mock.method(target, 'addEventListener', (name, fn, capture) => {
      const entry = { target, name, fn };
      if (capture === true) events.add(entry);
      add(name, fn, capture);
    });
    t.mock.method(target, 'removeEventListener', (name, fn, capture) => {
      for (const e of events)
        if (e.target === target && e.name === name && e.fn === fn) events.delete(e);
      remove(name, fn, capture);
    });
  }
  return {
    ...dom,
    frames,
    observers,
    events,
    flush() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((fn) => fn());
    },
  };
}

test('observer setup failure rolls back all previously installed observers and listeners', (t) => {
  const f = observedFixture(t);
  t.mock.method(f.window, 'matchMedia', () => {
    throw Error('No media service');
  });
  assert.throws(() => observeRenderedDocument(f.root, { onResult() {} }), /No media/);
  assert(f.observers.length >= 3);
  assert(f.observers.every((o) => o.targets.size === 0));
  assert.equal(f.events.size, 0, JSON.stringify([...f.events].map((e) => e.name)));
  assert.equal(f.frames.size, 0);
});

test('observer rollback also covers an initial consumer failure and late queued mutation delivery', (t) => {
  const f = observedFixture(t);
  assert.throws(
    () =>
      observeRenderedDocument(f.root, {
        onResult() {
          throw Error('Consumer failed');
        },
      }),
    /Consumer failed/,
  );
  for (const observer of f.observers) observer.callback([]);
  assert(f.observers.every((o) => o.targets.size === 0));
  assert.equal(f.frames.size, 0);
  assert.equal(f.events.size, 0, JSON.stringify([...f.events].map((e) => e.name)));
});

test('reset, external scrolling, toggle and linked-sheet completion coalesce; disposal removes them', (t) => {
  const f = observedFixture(t);
  let count = 0;
  const observer = observeRenderedDocument(f.root, {
    onResult() {
      count++;
    },
  });
  const link = f.document.createElement('link');
  link.rel = 'stylesheet';
  f.document.head.append(link);
  for (const [target, type] of [
    [f.document, 'reset'],
    [f.window, 'scroll'],
    [f.root, 'toggle'],
    [link, 'load'],
  ]) {
    target.dispatchEvent(new f.window.Event(type));
    assert.equal(f.frames.size, 1, type);
    f.flush();
  }
  assert.equal(count, 5);
  observer.schedule();
  observer.schedule();
  assert.equal(f.frames.size, 1);
  observer.dispose();
  observer.dispose();
  assert.equal(f.frames.size, 0);
  assert(f.observers.every((o) => o.targets.size === 0));
  assert.equal(f.events.size, 0, JSON.stringify([...f.events].map((e) => e.name)));
  link.dispatchEvent(new f.window.Event('load'));
  f.root.dispatchEvent(new f.window.Event('toggle'));
  f.window.dispatchEvent(new f.window.Event('scroll'));
  assert.equal(observer.refresh(), null);
  assert.equal(count, 5);
});
