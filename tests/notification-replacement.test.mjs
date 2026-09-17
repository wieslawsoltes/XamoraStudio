import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { createNotifier } from '../dist/studio/ui.js';

test('replacing a held notification preserves hover, keyboard focus and its original return target', (t) => {
  const dom = controlDOM(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const field = dom.document.createElement('input'),
    el = dom.document.createElement('div');
  el.id = 'toast';
  dom.document.body.append(field, el);
  field.focus();
  createNotifier(100)('First');
  el.dispatchEvent(new dom.window.Event('pointerenter'));
  createNotifier(100)('Second');
  t.mock.timers.tick(500);
  assert(el.classList.contains('show'), 'Pointer ownership survives replacement');
  el.querySelector('button').focus();
  createNotifier(100)('Third');
  assert.equal(dom.document.activeElement, el.querySelector('button'));
  el.dispatchEvent(new dom.window.Event('pointerleave'));
  t.mock.timers.tick(500);
  assert(el.classList.contains('show'), 'Focused replacement never times out');
  el.querySelector('button').click();
  assert.equal(dom.document.activeElement, field);
  assert.equal(el.classList.contains('show'), false);
});
