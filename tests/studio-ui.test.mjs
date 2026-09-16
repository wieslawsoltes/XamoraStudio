import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  $,
  $$,
  esc,
  createNotifier,
  notify,
  toast,
  saveFile,
  download,
} from '../dist/studio/ui.js';
import { icon, button } from '../dist/studio/icons.js';

function fakeDocument(t, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value, configurable: true });
  t.after(() =>
    original ? Object.defineProperty(globalThis, 'document', original) : delete globalThis.document,
  );
}

test('Studio and UI modules can be imported without starting the browser application', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { Studio } from './dist/studio/studio.js';
    assert.equal(typeof Studio, 'function');
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(typeof globalThis.document, 'undefined');
  `,
    ],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('shared escaping and selectors preserve nullish values, entities and explicit roots', (t) => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  const element = {};
  const nodes = new Set([element]);
  const root = {
    querySelector: (selector) => {
      assert.equal(selector, '.item');
      return element;
    },
    querySelectorAll: () => nodes,
  };
  assert.equal($('.item', root), element);
  assert.deepEqual($$('.item', root), [element]);
  fakeDocument(t, root);
  assert.equal($('.item'), element);
  const result = $$('.item');
  result.length = 0;
  assert.equal(nodes.size, 1);
});

test('icon fallback and button accessibility labels retain their original markup', () => {
  assert.equal(icon('missing'), icon('square'));
  assert.match(icon('pointer', 'selected'), /class="icon selected"/);
  const markup = button('open', '<Open & "file">', 'folder');
  assert.match(markup, /data-action="open"/);
  assert.match(markup, /title="&lt;Open &amp; &quot;file&quot;&gt;"/);
  assert.match(markup, /aria-label="&lt;Open &amp; &quot;file&quot;&gt;"/);
  assert.match(markup, /aria-hidden="true"/);
});

test('notifiers reset their own timer and retain the separate 3400/3500ms channels', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const classes = new Set();
  const element = {
    textContent: '',
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
  };
  fakeDocument(t, { querySelector: () => element });
  const first = createNotifier(100);
  const second = createNotifier(200);
  first('one');
  t.mock.timers.tick(50);
  first('two');
  t.mock.timers.tick(50);
  assert(classes.has('show'));
  assert.equal(element.textContent, 'two');
  second('other');
  const timer = second.timer;
  first('latest');
  assert.equal(second.timer, timer);
  t.mock.timers.tick(100);
  assert.equal(classes.has('show'), false);
  notify('feature');
  t.mock.timers.tick(200);
  notify('feature again');
  t.mock.timers.tick(3499);
  assert(classes.has('show'));
  t.mock.timers.tick(1);
  assert.equal(classes.has('show'), false);
  toast('base');
  t.mock.timers.tick(3399);
  assert(classes.has('show'));
  t.mock.timers.tick(1);
  assert.equal(classes.has('show'), false);
});

test('download aliases preserve MIME defaults, filenames, content and delayed URL cleanup', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const blobs = [];
  const revoked = [];
  const links = [];
  t.mock.method(URL, 'createObjectURL', (blob) => {
    blobs.push(blob);
    return `blob:${blobs.length}`;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  fakeDocument(t, {
    createElement: (tag) => {
      assert.equal(tag, 'a');
      const link = {
        click() {
          this.clicked = true;
        },
      };
      links.push(link);
      return link;
    },
  });
  saveFile('workspace.json', '{"hello":true}');
  download('view.xaml', '<Grid/>');
  download('view.html', '<p>Hello</p>', 'text/html');
  assert.deepEqual(
    blobs.map((blob) => blob.type),
    ['application/json', 'text/plain', 'text/html'],
  );
  assert.deepEqual(await Promise.all(blobs.map((blob) => blob.text())), [
    '{"hello":true}',
    '<Grid/>',
    '<p>Hello</p>',
  ]);
  assert.deepEqual(
    links.map((link) => [link.href, link.download, link.clicked]),
    [
      ['blob:1', 'workspace.json', true],
      ['blob:2', 'view.xaml', true],
      ['blob:3', 'view.html', true],
    ],
  );
  t.mock.timers.tick(999);
  assert.deepEqual(revoked, []);
  t.mock.timers.tick(1);
  assert.deepEqual(revoked, ['blob:1', 'blob:2', 'blob:3']);
});
