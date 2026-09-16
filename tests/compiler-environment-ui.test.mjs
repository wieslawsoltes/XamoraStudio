import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { CompilerWorkspace } from '../dist/studio/compiler-workspace.js';
test('IDE conversion options validate explicit viewport values before creating a plan', (t) => {
  const { document } = controlDOM(t);
  document.body.innerHTML =
    '<div class="compiler-workspace"><input data-convert-option="viewportWidth" value="800"><input data-convert-option="viewportHeight" value="600"><input data-convert-option="mediaType" value="print"><input data-convert-option="colorScheme" value="dark"><select data-convert-target><option value="WPF">WPF</option></select><span data-convert-document-label></span><span data-convert-folder-label></span></div>';
  const workspace = { currentSettings: { scope: 'document' } };
  const read = () => CompilerWorkspace.prototype.readSettings.call(workspace);
  const settings = read();
  assert.deepEqual(settings.environment, {
    width: 800,
    height: 600,
    type: 'print',
    'prefers-color-scheme': 'dark',
  });
  assert.equal(settings.framework, 'WPF');
  document.querySelector('[data-convert-option="viewportHeight"]').value = '';
  assert.throws(read, /both viewport/);
});
