import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtins, ToolkitRegistry } from '../dist/core/registry.js';

test('temporary control overrides restore the previous descriptor and notify mounted runtimes', () => {
  const registry = builtins(),
    previous = registry.get('Button');
  let changes = 0;
  registry.addEventListener('change', () => changes++);
  const dispose = registry.registerControl({
    type: 'Button',
    category: 'Application',
    defaults: { Content: 'Temporary' },
  });
  assert.equal(registry.get('Button').category, 'Application');
  assert.equal(dispose(), true);
  assert.equal(registry.get('Button'), previous);
  assert.equal(dispose(), false);
  assert.equal(changes, 2);
});

test('an obsolete registration cannot dispose a later control implementation', () => {
  const registry = new ToolkitRegistry();
  const old = registry.registerControl({ type: 'app:Meter', category: 'Application' });
  registry.registerControl({ type: 'app:Meter', category: 'Replacement' });
  assert.equal(old(), false);
  assert.equal(registry.get('app:Meter').category, 'Replacement');
});
