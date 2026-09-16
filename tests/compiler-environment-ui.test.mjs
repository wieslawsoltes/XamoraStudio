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

test('clearing IDE environment fields drops stale media and colors while retaining host features', (t) => {
  const { document } = controlDOM(t);
  document.body.innerHTML =
    '<div class="compiler-workspace"><input data-convert-option="viewportWidth" value=""><input data-convert-option="viewportHeight" value=""><input data-convert-option="mediaType" value=""><input data-convert-option="colorScheme" value=""><select data-convert-target><option value="WPF">WPF</option></select><span data-convert-document-label></span><span data-convert-folder-label></span></div>';
  const environment = {
    width: 800,
    height: 600,
    type: 'print',
    'prefers-color-scheme': 'dark',
    'prefers-reduced-motion': 'reduce',
  };
  const workspace = { currentSettings: { scope: 'document', environment } };
  const read = () => CompilerWorkspace.prototype.readSettings.call(workspace);
  assert.deepEqual(read().environment, { 'prefers-reduced-motion': 'reduce' });
  assert.equal(environment.type, 'print');
  assert.equal(environment.width, 800);
  workspace.currentSettings = { environment: { width: 800, height: 600, type: 'print' } };
  assert.equal(read().environment, undefined);
  document.querySelector('[data-convert-option="viewportWidth"]').value = '400';
  document.querySelector('[data-convert-option="viewportHeight"]').value = '600';
  assert.deepEqual(read().environment, { width: 400, height: 600, type: 'screen' });
});
