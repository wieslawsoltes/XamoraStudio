import test from 'node:test';
import assert from 'node:assert/strict';
import { PropertyGrid, renderPropertyField } from '../dist/controls/property-grid.js';
import { Studio } from '../dist/studio/studio.js';
import { controlDOM } from './control-fixture.mjs';
import { graph } from '../scripts/package-graph.mjs';
function fixture(t, options = {}) {
  const dom = controlDOM(t),
    host = dom.host(),
    grid = new PropertyGrid(host, options);
  t.after(() => grid.dispose());
  return {
    ...dom,
    host,
    grid,
    input: (name) => grid.fields.get(name).input,
    change(name, value) {
      const input = grid.fields.get(name).input;
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    },
  };
}
test('standalone property grid has no runtime or document-model dependencies', async () => {
  const entry = (await graph()).entries.find((entry) => entry.id === 'property-grid');
  assert.deepEqual([...entry.dependencies], []);
});
test('field markup escapes names, labels and values, retaining zero and false', (t) => {
  const { host, input } = fixture(t, {
    properties: [
      { name: '"<name>', label: '<img src=x>', value: '<script>bad</script>' },
      { name: 'Zero', type: 'number', value: 0 },
      { name: 'No', type: 'boolean', value: false },
    ],
  });
  assert.equal(host.querySelector('script,img'), null);
  assert.equal(input('"<name>').value, '<script>bad</script>');
  assert.equal(input('Zero').value, '0');
  assert.equal(input('No').checked, false);
});
test('controlled typed edits preserve identity, invoke one transaction and expose reset intent', (t) => {
  const calls = [],
    { grid, input, change } = fixture(t, {
      properties: [
        { name: 'Width', type: 'number', value: 10, defaultValue: 0 },
        { name: 'Enabled', type: 'boolean', value: false },
        { name: 'Title', value: 'Hello' },
      ],
      onChange: (change) => {
        calls.push(change);
      },
    });
  const original = input('Width');
  change('Width', '42');
  change('Enabled', true);
  change('Title', '');
  assert.equal(grid.getValue('Width'), 42);
  assert.equal(grid.getValue('Enabled'), true);
  assert.equal(grid.getValue('Title'), '');
  assert.equal(input('Width'), original);
  assert.equal(calls.length, 3);
  change('Width', '42');
  assert.equal(calls.length, 3);
  assert(grid.reset('Width'));
  assert.equal(grid.getValue('Width'), 0);
  assert.equal(calls.at(-1).reset, true);
  assert(grid.reset('Title'));
  assert.equal(grid.getValue('Title'), undefined);
});
test('enum choices preserve string, number, boolean and explicit empty-string types', (t) => {
  const { grid, change, input } = fixture(t, {
    properties: [
      { name: 'Choice', value: '', options: ['', 0, false, { value: 'red', label: 'Red & warm' }] },
    ],
  });
  assert.equal(input('Choice').value, 'o0');
  change('Choice', 'o1');
  assert.equal(grid.getValue('Choice'), 0);
  change('Choice', 'o2');
  assert.equal(grid.getValue('Choice'), false);
  change('Choice', 'o3');
  assert.equal(grid.getValue('Choice'), 'red');
  change('Choice', '_default');
  assert.equal(grid.getValue('Choice'), undefined);
});
test('validation and rejected transactions retain committed data with accessible errors', (t) => {
  const calls = [],
    { grid, input, change } = fixture(t, {
      properties: [
        { name: 'Size', type: 'number', value: 5, min: 0, max: 10, required: true },
        { name: 'Text', value: 'old', validate: (value) => (value === 'bad' ? '<Invalid>' : true) },
      ],
      onChange: (change) => {
        calls.push(change);
        return false;
      },
    });
  change('Size', '11');
  assert.equal(grid.getValue('Size'), 5);
  assert.equal(input('Size').value, '5');
  change('Size', '');
  assert.equal(calls.length, 0);
  assert.match(grid.error.textContent, /required/);
  change('Text', 'bad');
  assert.equal(grid.error.textContent, '<Invalid>');
  assert.equal(grid.error.children.length, 0);
  change('Size', '7');
  assert.equal(calls.length, 1);
  assert.equal(grid.getValue('Size'), 5);
  assert.equal(input('Size').getAttribute('aria-invalid'), 'true');
});
test('readonly, mixed and non-resettable fields preserve their contracts', (t) => {
  const { grid, input, change } = fixture(t, {
    properties: [
      { name: 'Id', value: 'immutable', readOnly: true },
      { name: 'Mixed', value: false, type: 'boolean', mixed: true },
      { name: 'Fixed', value: 'no reset', resettable: false },
    ],
  });
  assert(input('Id').readOnly);
  change('Id', 'ignored');
  assert.equal(grid.getValue('Id'), 'immutable');
  assert.equal(grid.reset('Id'), false);
  assert.equal(grid.reset('Fixed'), false);
  assert(input('Mixed').indeterminate);
  change('Mixed', false);
  assert(!input('Mixed').indeterminate);
});
test('search hides grouped fields without replacing active editors or their draft values', (t) => {
  const { grid, input } = fixture(t, {
    properties: [
      { name: 'Width', label: 'Size', group: 'Layout', value: '10' },
      { name: 'Title', group: 'Content', value: 'original' },
    ],
  });
  const field = input('Title');
  field.value = 'uncommitted';
  grid.setFilter('layout');
  assert(grid.fields.get('Title').field.hidden);
  assert(!grid.fields.get('Width').field.hidden);
  assert(grid.headings.find((h) => h.group === 'Content').heading.hidden);
  grid.setFilter('');
  assert.equal(input('Title'), field);
  assert.equal(input('Title').value, 'uncommitted');
});
test('schema updates validate atomically and caller-owned schema is not mutated', (t) => {
  const properties = [{ name: 'A', value: 'old' }],
    { grid, input, change } = fixture(t, { properties });
  change('A', 'new');
  assert.equal(properties[0].value, 'old');
  const field = input('A');
  assert.throws(() => grid.setProperties([{ name: 'A' }, { name: 'A' }]), /unique/);
  assert.equal(input('A'), field);
  assert.equal(grid.getValue('A'), 'new');
  assert.throws(() => grid.setValue('unknown', ''), /Unknown/);
});
test('external mode retains native Studio transactions and legacy field value markup', (t) => {
  const { grid, host, input, window } = fixture(t, {
    eventMode: 'external',
    searchable: false,
    properties: [{ name: 'Width', value: 'Auto' }],
    fieldRenderer: (field) => renderPropertyField(field, { legacy: true }),
  });
  const events = [];
  host.parentElement.addEventListener('change', (event) => events.push(event.target.dataset.prop));
  input('Width').value = '128';
  input('Width').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(events, ['Width']);
  assert.equal(grid.getValue('Width'), 'Auto');
  const studio = Object.create(Studio.prototype);
  studio.stores = [{ selected: [], selection: [], document: { root: { children: [] } } }];
  studio.active = 0;
  Object.defineProperty(studio, 'selected', { value: [] });
  studio.registry = { get: () => ({ properties: [{ name: 'Mode', values: ['One', 'Two'] }] }) };
  const markup = studio.field('Mode', 'Mode', 'Two', undefined, true);
  assert.match(markup, /value="Two" selected/);
  assert.match(markup, /data-reset="Mode"/);
});
test('multiple grids stay isolated and dispose clears ownership and listeners idempotently', (t) => {
  const { grid, host, input, window, document } = fixture(t, {
    properties: [{ name: 'A', value: 'one' }],
  });
  const otherHost = document.createElement('div');
  document.body.append(otherHost);
  const other = new PropertyGrid(otherHost, { properties: [{ name: 'A', value: 'two' }] });
  t.after(() => other.dispose());
  assert.throws(() => new PropertyGrid(host), /Dispose/);
  const oldInput = input('A');
  grid.dispose();
  grid.dispose();
  oldInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(host.childElementCount, 0);
  assert.equal(other.getValue('A'), 'two');
  const replacement = new PropertyGrid(host);
  replacement.dispose();
});
test('synchronous transaction rerenders are authoritative and not overwritten by stale events', (t) => {
  const { grid, change } = fixture(t, {
    properties: [{ name: 'A', value: 'initial' }],
    onChange({ grid }) {
      grid.setProperties([{ name: 'A', value: 'server' }]);
    },
  });
  change('A', 'draft');
  assert.equal(grid.getValue('A'), 'server');
});

test('read-only color fields cannot open an editable color picker', (t) => {
  const { input } = fixture(t, {
    properties: [{ name: 'Color', type: 'color', value: '#123456', readOnly: true }],
  });
  assert.equal(input('Color').disabled, true);
});
test('repeated group sections hide their own empty headings during filtering', (t) => {
  const { grid } = fixture(t, {
    properties: [
      { name: 'First', group: 'Shared' },
      { name: 'Middle', group: 'Other' },
      { name: 'Last', group: 'Shared' },
    ],
  });
  grid.setFilter('Last');
  assert.deepEqual(
    grid.headings.map(({ heading }) => heading.hidden),
    [true, true, false],
  );
});
test('asynchronous hooks are rejected without accepting changes or unhandled rejections', async (t) => {
  const { grid, change } = fixture(t, {
    properties: [
      { name: 'A', value: 'initial', validate: () => Promise.reject(Error('Async validator')) },
      { name: 'B', value: 'initial' },
    ],
    onChange: () => Promise.reject(Error('Async transaction')),
  });
  change('A', 'draft');
  assert.match(grid.error.textContent, /Validators must be synchronous/);
  assert.equal(grid.getValue('A'), 'initial');
  change('B', 'draft');
  assert.match(grid.error.textContent, /Commit callbacks must be synchronous/);
  assert.equal(grid.getValue('B'), 'initial');
  await new Promise((resolve) => setImmediate(resolve));
});

test('standalone control README imports refer to exported CSS assets', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const id of ['property-grid', 'code-editor', 'docking', 'control-primitives']) {
    const manifest = JSON.parse(
      await readFile(new URL(`../packages/${id}/package.json`, import.meta.url), 'utf8'),
    );
    const readme = await readFile(new URL(`../packages/${id}/README.md`, import.meta.url), 'utf8');
    for (const match of readme.matchAll(/import ['"](@wieslawsoltes\/[^'"]+\.css)['"]/g)) {
      assert(match[1].startsWith(manifest.name + '/'));
      assert(
        manifest.exports['.' + match[1].slice(manifest.name.length)],
        `${id} README has an unexported style import`,
      );
    }
  }
});
