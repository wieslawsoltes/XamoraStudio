import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import {
  commandCatalog,
  searchCommands,
  readRecentCommands,
  rememberCommand,
} from '../dist/studio/command-search.js';
import { CommandPalette } from '../dist/studio/command-palette.js';
import { MenuBar } from '../dist/controls/menu-bar.js';
import { DialogHost } from '../dist/controls/dialog-host.js';
import { createNotifier, notify } from '../dist/studio/ui.js';
const entry = (id, label = id, extra = {}) => ({ id, label, run() {}, ...extra });

test('command catalog refreshes dynamic menus and preserves category paths without mutating them', () => {
  let panels = [entry('window:one')];
  const menus = [{ label: 'Window', children: [{ label: 'Open', children: () => panels }] }];
  const first = commandCatalog(menus);
  assert.equal(first[0].path, 'Window › Open');
  assert.equal(first[0].category, 'Window');
  assert.equal(panels[0].path, undefined);
  panels = [entry('window:two')];
  assert.deepEqual(
    commandCatalog(menus).map((c) => c.id),
    ['window:two'],
  );
});
test('search matches multiple accent-insensitive label, menu, and identifier terms', () => {
  const catalog = commandCatalog([
    {
      label: 'View',
      children: [entry('density:comfortable', 'Có mfortable'), entry('theme', 'Toggle theme')],
    },
  ]);
  assert.equal(
    searchCommands(catalog, 'view density comfortable').items[0].id,
    'density:comfortable',
  );
  assert.equal(searchCommands(catalog, 'CO').items[0].id, 'density:comfortable');
  assert.equal(searchCommands(catalog, 'density theme').total, 0);
});
test('search ranks exact titles first and recents only bias the empty query', () => {
  const catalog = [entry('a', 'Toggle theme'), entry('b', 'Theme')];
  assert.equal(searchCommands(catalog, 'theme').items[0].id, 'b');
  assert.equal(searchCommands(catalog, '', { recent: ['b'] }).items[0].id, 'b');
  assert.equal(searchCommands(catalog, 'theme', { recent: ['a'] }).items[0].id, 'b');
});
test('file/window filters retain totals while large search results are bounded', () => {
  const catalog = Array.from({ length: 1000 }, (_, i) => entry('window:' + i, 'Panel ' + i));
  catalog.push(entry('save', 'Save', { category: 'File' }));
  assert.equal(searchCommands(catalog, '', { scope: 'files' }).total, 1);
  const result = searchCommands(catalog, '', { scope: 'windows' });
  assert.equal(result.total, 1000);
  assert.equal(result.items.length, 60);
});
test('recent command persistence is bounded, deduplicated and tolerant of blocked storage', () => {
  assert.deepEqual(readRecentCommands({ getItem: () => '{' }), []);
  assert.deepEqual(readRecentCommands({ getItem: () => '[1,"a","a",null,"b"]' }), ['a', 'b']);
  const storage = {
    getItem() {
      throw Error('blocked');
    },
    setItem() {
      throw Error('blocked');
    },
  };
  assert.deepEqual(readRecentCommands(storage), []);
  assert.deepEqual(rememberCommand(storage, ['old', 'next'], 'old'), ['old', 'next']);
});
function paletteFixture(t, commands) {
  const dom = controlDOM(t),
    root = dom.host(),
    input = dom.document.createElement('textarea');
  dom.document.body.prepend(input);
  input.value = 'Keep my draft';
  input.focus();
  const toast = dom.document.createElement('div');
  toast.id = 'toast';
  dom.document.body.append(toast);
  const dialogHost = new DialogHost(root);
  const s = {
    menus: {
      menus: [{ label: 'Edit', children: commands }],
      commands: new Map(commands.map((c) => [c.id, c])),
      bar: { value: (v, fallback) => (typeof v === 'function' ? v() : (v ?? fallback)) },
    },
    dialogHost,
    modal(title, html) {
      dialogHost.open({ title, html });
    },
    closeModal() {
      dialogHost.close();
      this.menus.contextTarget = null;
    },
  };
  const palette = new CommandPalette(s, { storage: null });
  palette.open(input);
  const search = root.querySelector('#ide-command-search');
  search.focus();
  const key = (value, props = {}) =>
    search.onkeydown({ key: value, preventDefault() {}, ...props });
  const query = (value) => {
    search.value = value;
    search.oninput();
  };
  t.after(() => {
    dialogHost.dispose();
    clearTimeout(notify.timer);
  });
  return { ...dom, s, palette, input, root, search, key, query };
}
test('palette arrow navigation keeps input focus and Enter runs the selected result', async (t) => {
  let result;
  const f = paletteFixture(t, [
    entry('a', 'First', { run: () => (result = 'a') }),
    entry('b', 'Second', { run: () => (result = 'b') }),
  ]);
  assert.equal(f.search.getAttribute('aria-activedescendant'), 'ux-command-0');
  f.key('ArrowDown');
  assert.equal(f.document.activeElement, f.search);
  assert.equal(f.search.getAttribute('aria-activedescendant'), 'ux-command-1');
  f.key('Enter');
  await Promise.resolve();
  assert.equal(result, 'b');
  assert.equal(f.s.dialogHost.isOpen, false);
});
test('palette never executes disabled, stale-disabled or IME-composing commands', (t) => {
  let allowed = true,
    called = 0;
  const f = paletteFixture(t, [
    entry('a', 'Action', { enabled: () => allowed, run: () => called++ }),
  ]);
  f.key('Enter', { isComposing: true });
  assert.equal(called, 0);
  allowed = false;
  f.key('Enter');
  assert.equal(called, 0);
  assert.equal(f.s.dialogHost.isOpen, true);
  assert.match(f.root.querySelector('#ux-command-hint').textContent, /unavailable/);
});
test('palette execution retains the original text context and safely escapes command content', async (t) => {
  let target;
  const command = entry('odd:<x>', '<img src=x onerror=alert(1)>', {
    run: () => {
      target = f.s.menus.contextTarget;
    },
  });
  const f = paletteFixture(t, [command]);
  assert.equal(f.root.querySelector('img'), null);
  f.key('Enter');
  await Promise.resolve();
  assert.equal(target, f.input);
  assert.equal(f.s.menus.contextTarget, null);
  assert.equal(f.input.value, 'Keep my draft');
});
test('empty search results clear active descendants and offer a working reset', (t) => {
  const f = paletteFixture(t, [entry('a')]);
  f.query('unfindable');
  assert.equal(f.search.hasAttribute('aria-activedescendant'), false);
  assert.equal(f.root.querySelector('.ux-palette-empty').hidden, false);
  f.root.querySelector('[data-command-clear]').click();
  assert.equal(f.search.value, '');
  assert.equal(f.root.querySelector('.ux-palette-empty').hidden, true);
});
test('failed commands do not become recent and expose a notification without unhandled rejection', async (t) => {
  const f = paletteFixture(t, [
    entry('a', 'Failure', {
      run: async () => {
        throw Error('Action failed');
      },
    }),
  ]);
  f.key('Enter');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(f.palette.recent, []);
  assert.match(f.document.querySelector('#toast').textContent, /Action failed/);
});
test('an older notifier channel cannot hide the newest message', (t) => {
  const dom = controlDOM(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const el = dom.document.createElement('div');
  el.id = 'toast';
  dom.document.body.append(el);
  const short = createNotifier(100),
    long = createNotifier(400);
  short('Old');
  t.mock.timers.tick(50);
  long('New');
  t.mock.timers.tick(100);
  assert(el.classList.contains('show'));
  assert.equal(el.querySelector('.toast-message').textContent, 'New');
  t.mock.timers.tick(300);
  assert.equal(el.classList.contains('show'), false);
});
test('notifications pause during hover/focus and provide a keyboard reachable dismiss action', (t) => {
  const dom = controlDOM(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const el = dom.document.createElement('div');
  el.id = 'toast';
  dom.document.body.append(el);
  createNotifier(100)('A long message');
  el.dispatchEvent(new dom.window.Event('pointerenter'));
  t.mock.timers.tick(1000);
  assert(el.classList.contains('show'));
  el.querySelector('button').focus();
  el.dispatchEvent(new dom.window.Event('pointerleave'));
  t.mock.timers.tick(1000);
  assert(el.classList.contains('show'));
  el.querySelector('button').click();
  assert.equal(el.classList.contains('show'), false);
});
test('menu outside pointer dismissal does not restore stale editor focus', (t) => {
  const dom = controlDOM(t),
    host = dom.host(),
    origin = dom.document.createElement('input'),
    other = dom.document.createElement('input');
  dom.document.body.append(origin, other);
  origin.focus();
  const menu = new MenuBar(host, [{ label: 'File', children: [entry('a')] }]);
  t.after(() => menu.dispose());
  menu.openRoot(0);
  other.focus();
  menu.outside({ target: other });
  assert.equal(dom.document.activeElement, other);
});
test('Tab closes menus without suppressing native navigation or leaving detached focus', (t) => {
  const dom = controlDOM(t),
    menu = new MenuBar(dom.host(), [{ label: 'File', children: [entry('a')] }]);
  t.after(() => menu.dispose());
  menu.openRoot(0);
  let prevented = false;
  menu.keydown({
    key: 'Tab',
    target: dom.document.activeElement,
    preventDefault() {
      prevented = true;
    },
    stopImmediatePropagation() {},
  });
  assert.equal(prevented, false);
  assert.equal(menu.stack.length, 0);
  assert.equal(dom.document.activeElement, menu.buttons[0]);
});
test('submenu expanded state clears on Escape and modal/IME keys remain untouched', (t) => {
  const dom = controlDOM(t),
    menu = new MenuBar(dom.host(), [
      { label: 'File', children: [{ label: 'New', children: [entry('a')] }] },
    ]);
  t.after(() => menu.dispose());
  menu.openRoot(0);
  const parent = menu.stack[0].items[0].button;
  const key = (value, props = {}) =>
    menu.keydown({
      key: value,
      target: dom.document.activeElement,
      preventDefault() {},
      stopImmediatePropagation() {},
      ...props,
    });
  key('ArrowRight');
  assert.equal(parent.getAttribute('aria-expanded'), 'true');
  key('Escape', { isComposing: true });
  assert.equal(menu.stack.length, 2);
  key('Escape');
  assert.equal(parent.getAttribute('aria-expanded'), 'false');
});
