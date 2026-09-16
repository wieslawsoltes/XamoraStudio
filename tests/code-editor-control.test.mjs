import test from 'node:test';
import assert from 'node:assert/strict';
import { CodeEditor, mapTextSelection } from '../dist/controls/code-editor.js';
import {
  XamlEditor,
  createMarkupLanguageProvider,
  mapTextSelection as legacyMap,
} from '../dist/core/editor.js';
import { controlDOM } from './control-fixture.mjs';
import { graph } from '../scripts/package-graph.mjs';

function editor(t, options) {
  const dom = controlDOM(t);
  const control = new CodeEditor(dom.host(), options);
  t.after(() => control.dispose());
  return { ...dom, control };
}

test('generic editor has no runtime dependencies and the legacy mapping function retains identity', async () => {
  const current = await graph();
  const owner = current.entries.find((entry) => entry.id === 'code-editor');
  assert.deepEqual([...owner.dependencies], []);
  assert.equal(legacyMap, mapTextSelection);
  assert.equal(Object.getPrototypeOf(XamlEditor.prototype), CodeEditor.prototype);
});
test('plain text editor mounts independently and escapes markup without evaluating it', (t) => {
  const { control } = editor(t);
  control.setValue('<img src=x onerror=alert(1)> & plain');
  assert.equal(control.getValue(), '<img src=x onerror=alert(1)> & plain');
  assert.equal(control.highlight.querySelector('img'), null);
  assert.equal(control.highlight.textContent, control.getValue() + '\n');
  assert.equal(control.input.getAttribute('aria-label'), 'Text code editor');
  assert.equal(control.validate(), true);
});
test('provider validation, formatting, highlighting and apply rejection use the same source buffer', (t) => {
  let applied;
  const { control } = editor(t, {
    language: 'JSON',
    languageProvider: {
      validate(source) {
        JSON.parse(source);
      },
      format: (source) => JSON.stringify(JSON.parse(source), null, 2),
      tokenize: (source) => [{ text: source, kind: 'keyword' }],
    },
    onApply: (source) => {
      applied = source;
      return false;
    },
  });
  control.setValue('{"ok":true}');
  control.format();
  assert.match(control.getValue(), /\n  "ok": true/);
  assert(control.highlight.querySelector('.syntax-keyword'));
  assert.equal(control.apply(), false);
  assert.equal(control.dirty, true);
  assert.equal(applied, control.getValue());
  control.input.value = '{';
  control.changed();
  assert.equal(control.validate(), false);
  assert(control.message.classList.contains('error'));
});
test('provider switching and unsafe token output cannot change or hide the buffer', (t) => {
  const { control } = editor(t);
  control.setValue('<safe>');
  control.setLanguageProvider(
    { tokenize: () => [{ text: '<script>bad</script>', kind: 'tag' }] },
    'Custom',
  );
  assert.equal(control.highlight.textContent, '<safe>\n');
  control.setLanguageProvider({
    tokenize: (source) => [{ text: source, kind: 'tag" onclick="bad' }],
  });
  assert.equal(control.highlight.querySelector('[onclick]'), null);
  assert.equal(control.getValue(), '<safe>');
});
test('completion escapes labels and rejects a stale source or caret', (t) => {
  const { window, control } = editor(t, {
    languageProvider: {
      complete: () => [{ label: '<b>Item</b>', insertText: 'hello', start: 0, end: 1 }],
    },
  });
  control.setValue('h');
  control.input.setSelectionRange(1, 1);
  control.complete();
  assert.equal(control.completions.querySelector('b'), null);
  const stale = control.completions.firstChild;
  control.input.value = 'changed';
  stale.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(control.getValue(), 'changed');
  control.setValue('h', { force: true });
  control.input.setSelectionRange(1, 1);
  control.complete();
  control.completions.firstChild.dispatchEvent(
    new window.MouseEvent('mousedown', { bubbles: true }),
  );
  assert.equal(control.getValue(), 'hello');
  assert.equal(control.undoBuffer(), true);
  assert.equal(control.getValue(), 'h');
});
test('IME flags, delayed validation and disposal release listeners and pending work', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let changes = 0,
    validates = 0;
  const { window, control } = editor(t, {
    onChange: (_source, options) => {
      changes++;
      assert.equal(options.composing, true);
    },
    languageProvider: {
      validate: () => {
        validates++;
      },
    },
  });
  control.input.dispatchEvent(new window.Event('compositionstart'));
  control.input.value = '文';
  control.input.dispatchEvent(new window.InputEvent('input', { isComposing: true }));
  assert.equal(changes, 1);
  const input = control.input;
  control.dispose();
  control.dispose();
  t.mock.timers.tick(1000);
  input.dispatchEvent(new window.InputEvent('input'));
  assert.equal(validates, 0);
  assert.equal(changes, 1);
  assert.equal(control.host.children.length, 0);
  assert.equal(control.setValue('late'), false);
});
test('read-only editor supports finding but does not mutate via commands, formatting or replacement', (t) => {
  const { window, control } = editor(t, {
    readOnly: true,
    languageProvider: { format: () => 'changed', toggleComment: () => 'changed' },
  });
  control.setValue('original');
  for (const key of ['Tab', 'Enter', '/'])
    control.keydown(new window.KeyboardEvent('keydown', { key, ctrlKey: key === '/' }));
  control.format();
  control.find();
  const inputs = control.host.querySelectorAll('.editor-find input');
  inputs[0].value = 'original';
  inputs[1].value = 'changed';
  control.host.querySelector('[data-find="all"]').click();
  assert.equal(control.getValue(), 'original');
  assert.equal(control.undoBuffer(), false);
});
test('legacy adapter retains markup indentation, comments, validation and completion providers', (t) => {
  const { window, host } = controlDOM(t);
  const control = new XamlEditor(host());
  t.after(() => control.dispose());
  control.setValue('<Grid>');
  control.input.setSelectionRange(6, 6);
  control.keydown(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.equal(control.getValue(), '<Grid>\n    ');
  control.setValue('<Grid/>', { force: true });
  assert(control.validate());
  control.setLanguage('HTML');
  control.setValue('<p>HTML</p>', { force: true });
  assert(control.validate());
  const provider = createMarkupLanguageProvider();
  assert.equal(provider.toggleComment('hello'), '<!-- hello -->');
  assert.equal(
    provider
      .tokenize('<Grid/>')
      .map((t) => t.text)
      .join(''),
    '<Grid/>',
  );
});
