import test from 'node:test';
import assert from 'node:assert/strict';
import { CodeEditor } from '../dist/controls/code-editor.js';
import { controlDOM } from './control-fixture.mjs';

function fixture(t, options = {}) {
  const dom = controlDOM(t);
  const control = new CodeEditor(dom.host(), { virtualization: true, ...options });
  control.setValue('first\nmiddle\nlast');
  t.after(() => control.dispose());
  const insertion = (options = {}) =>
    new dom.window.InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'Z',
      ...options,
    });
  return { ...dom, control, insertion };
}

test('virtualized text insertion retains selection replacement, one notification and buffer undo', (t) => {
  let changes = 0;
  const { control, insertion } = fixture(t, {
    onChange() {
      changes++;
    },
  });
  const original = control.getValue();
  const notices = [];
  control.host.addEventListener('input', (event) =>
    notices.push({
      data: event.data,
      type: event.inputType,
      composed: event.composed,
    }),
  );
  control.input.setSelectionRange(13, 17, 'backward');
  control.input.scrollTop = 42;
  control.input.scrollLeft = 17;
  const event = insertion({ data: '👩‍💻' });
  control.input.dispatchEvent(event);
  assert(event.defaultPrevented);
  assert.equal(control.getValue(), 'first\nmiddle\n👩‍💻');
  assert.equal(control.input.selectionStart, 13 + '👩‍💻'.length);
  assert.equal(control.input.selectionEnd, control.input.selectionStart);
  assert.equal(control.input.scrollTop, 42);
  assert.equal(control.input.scrollLeft, 17);
  assert.deepEqual(notices, [{ data: '👩‍💻', type: 'insertText', composed: true }]);
  assert.equal(changes, 1);
  assert.equal(control.dirty, true);
  control.undoBuffer();
  assert.equal(control.getValue(), original);
  control.redoBuffer();
  assert.equal(control.getValue(), 'first\nmiddle\n👩‍💻');
});

test('large-buffer insertion respects read-only, disabled, composition and native-event guards', (t) => {
  const { control, insertion } = fixture(t);
  const before = control.getValue();
  const check = (event) => {
    const canceled = event.defaultPrevented;
    control.input.dispatchEvent(event);
    assert.equal(event.defaultPrevented, canceled);
    assert.equal(control.getValue(), before);
  };
  for (const key of ['readOnly', 'disabled']) {
    control.input[key] = true;
    check(insertion());
    control.input[key] = false;
  }
  control.composing = true;
  check(insertion());
  control.composing = false;
  check(insertion({ isComposing: true }));
  check(insertion({ cancelable: false }));
  check(insertion({ inputType: 'insertCompositionText' }));
  check(insertion({ inputType: 'insertFromPaste' }));
  // happy-dom normalizes the constructor's null data to an empty string.
  check(Object.defineProperty(insertion(), 'data', { value: null }));
  const canceled = insertion();
  canceled.preventDefault();
  check(canceled);
  control.setVirtualization(false);
  check(insertion());
});

test('disposing the editor removes the virtualized beforeinput handler', (t) => {
  const { control, insertion } = fixture(t);
  const input = control.input,
    before = input.value;
  control.dispose();
  const event = insertion();
  input.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(input.value, before);
});
