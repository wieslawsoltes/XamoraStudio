import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { CompilerWorkspace } from '../dist/studio/compiler-workspace.js';
function fixture(t) {
  const { document } = controlDOM(t);
  document.body.innerHTML = `<div class="compiler-workspace"><input data-convert-option="nativeOutput" type="checkbox" checked><input data-convert-width><input data-convert-height><select data-convert-color><option value="">Unspecified</option><option>dark</option></select><textarea data-convert-stylesheets></textarea><input data-convert-supports type="checkbox"><select data-convert-target><option>WPF</option><option>Avalonia</option></select><label data-convert-document-label></label><label data-convert-folder-label></label></div>`;
  return {
    read: () =>
      CompilerWorkspace.prototype.readSettings.call({ currentSettings: { scope: 'document' } }),
    get: (key) => document.querySelector(`[data-convert-${key}]`),
  };
}
test('conversion UI accepts explicit environment, native target and inert CSS source map', (t) => {
  const { read, get } = fixture(t);
  get('width').value = '900';
  get('height').value = '700';
  get('color').value = 'dark';
  get('target').value = 'Avalonia';
  get('stylesheets').value = '{"theme.css":"button { width:120px }"}';
  const settings = read();
  assert.deepEqual(settings.environment, {
    type: 'screen',
    width: 900,
    height: 700,
    colorScheme: 'dark',
  });
  assert.equal(settings.nativeOutput, true);
  assert.equal(settings.framework, 'Avalonia');
  assert.equal(settings.stylesheets['theme.css'], 'button { width:120px }');
});
test('conversion UI rejects incomplete viewports and non-string stylesheet maps before preview', (t) => {
  const { read, get } = fixture(t);
  get('width').value = '900';
  assert.throws(read, /both viewport/);
  get('height').value = '700';
  for (const text of ['false', 'null', '[]', '{"main.css":42}', '{bad']) {
    get('stylesheets').value = text;
    assert.throws(read);
  }
});
