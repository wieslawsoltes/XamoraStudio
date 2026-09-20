import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { MenuBar } from '../dist/controls/menu-bar.js';

test('menu state glyphs are decorative while labels and shortcut text remain available', (t) => {
  const { host } = controlDOM(t);
  const menu = new MenuBar(host(), [
    {
      label: 'Edit',
      children: [
        {
          label: 'Refactor markup',
          children: [{ label: 'Rename element tag', shortcut: 'Shift+F2' }],
        },
        { label: 'Show guides', checked: true },
        { label: 'Show grid', checked: false },
        { label: 'Find', shortcut: 'Ctrl+F' },
      ],
    },
  ]);
  t.after(() => menu.dispose());
  menu.openRoot(0);
  for (const { button, entry } of menu.stack[0].items) {
    assert.equal(button.querySelector('.menu-check').getAttribute('aria-hidden'), 'true');
    assert.equal(button.querySelector('.menu-arrow').getAttribute('aria-hidden'), 'true');
    assert.equal(button.querySelector('.menu-label').textContent, entry.label);
    assert.equal(button.querySelector('.menu-label').getAttribute('aria-hidden'), null);
    assert.equal(button.querySelector('kbd').textContent, entry.shortcut || '');
    assert.equal(button.querySelector('kbd').getAttribute('aria-hidden'), null);
  }
  assert.equal(menu.stack[0].items[1].button.getAttribute('aria-checked'), 'true');
  assert.equal(menu.stack[0].items[2].button.getAttribute('aria-checked'), 'false');
});

test('decorative submenu arrows leave keyboard expansion and dismissal semantics intact', (t) => {
  const { host, window, document } = controlDOM(t);
  const menu = new MenuBar(host(), [
    {
      label: 'Edit',
      children: [
        {
          label: 'Refactor markup',
          children: [{ label: 'Rename element tag', shortcut: 'Shift+F2' }],
        },
      ],
    },
  ]);
  t.after(() => menu.dispose());
  menu.openRoot(0);
  const parent = menu.stack[0].items[0].button;
  assert.equal(parent.getAttribute('aria-haspopup'), 'menu');
  assert.equal(parent.getAttribute('aria-expanded'), 'false');
  parent.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
  );
  assert.equal(parent.getAttribute('aria-expanded'), 'true');
  assert.equal(menu.stack.length, 2);
  assert.equal(document.activeElement === menu.stack[1].items[0].button, true);
  document.activeElement.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  assert.equal(parent.getAttribute('aria-expanded'), 'false');
  assert.equal(menu.stack.length, 1);
  assert.equal(document.activeElement === parent, true);
});
