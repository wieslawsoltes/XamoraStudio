import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { initialStudioLayout, finishDockingStartup } from '../dist/studio/startup-layout.js';
import { DockLayout, validateDockLayout, locatePanel } from '../dist/core/docking.js';
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

for (const compact of [false, true])
  test(`first-run layout includes all registered panels without opening optional columns: compact=${compact}`, () => {
    const ids = [
      'document:one',
      'xaml',
      'layers',
      'properties',
      'solution',
      'code-intelligence',
      'timeline',
    ];
    const layout = initialStudioLayout(ids, ['document:one'], compact);
    validateDockLayout(layout, new Set(ids));
    assert(layout.hidden.includes('code-intelligence'));
    assert.equal(layout.activePanel, 'document:one');
    const solution = locatePanel(layout, 'solution');
    assert.equal(solution.kind, compact ? 'autoHide' : 'group');
    if (!compact) assert.equal(solution.group.active, 'solution');
    assert.equal(locatePanel(layout, 'xaml').kind, 'group');
  });

test('final composition restores saved extension-panel intent instead of initialization side effects', (t) => {
  const dom = controlDOM(t);
  const ids = ['document:one', 'xaml', 'layers', 'properties', 'solution', 'code-intelligence'];
  const model = new DockLayout(
    ids.map((id) => ({
      id,
      kind: id.startsWith('document:') || id === 'xaml' ? 'document' : 'tool',
    })),
    initialStudioLayout(ids, ['document:one']),
  );
  model.show('code-intelligence');
  const saved = model.serialize();
  model.hide('code-intelligence');
  let rendered = 0;
  finishDockingStartup(
    {
      view: 'split',
      stores: [{ document: { id: 'one' } }],
      docking: {
        model,
        control: {
          window: dom.window,
          render() {
            rendered++;
          },
        },
        syncCanvas() {},
        layoutChanged() {},
        setView() {
          throw Error('A saved layout must not be replaced by a mode preset');
        },
      },
    },
    saved,
  );
  assert.equal(model.serialize(), saved);
  assert.equal(model.history.length, 0);
  assert.equal(model.future.length, 0);
  assert.equal(rendered, 1);
});
