import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { InspectorDisclosure } from '../dist/studio/inspector-disclosure.js';

test('inspector disclosure preserves live actions, remembers expansion and restores original controls', (t) => {
  const dom = controlDOM(t),
    root = dom.host();
  root.innerHTML =
    '<section class="panel-section blend-section"><div class="section-heading">Appearance</div><button>Brushes</button></section><input aria-label="Width" value="120">';
  const button = root.querySelector('button'),
    field = root.querySelector('input');
  let clicked = 0;
  button.onclick = () => clicked++;
  const disclosure = new InspectorDisclosure();
  disclosure.decorate(root);
  const details = root.querySelector('details');
  assert.equal(details.open, false);
  assert(root.querySelector('button') === button);
  assert(
    field.parentElement === root,
    'Basic property fields remain outside secondary-action disclosure',
  );
  details.open = true;
  details.ontoggle();
  button.click();
  assert.equal(clicked, 1);
  disclosure.decorate(root);
  assert.equal(root.querySelectorAll('details').length, 1);
  disclosure.restore(root);
  assert.equal(root.querySelector('details'), null);
  assert.equal(root.querySelector('.section-heading').hidden, false);
  disclosure.decorate(root);
  assert.equal(root.querySelector('details').open, true);
});
