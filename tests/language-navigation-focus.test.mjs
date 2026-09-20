import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { controlDOM } from './control-fixture.mjs';
import { DockLayout } from '../dist/core/docking.js';
import { DockWorkspace } from '../dist/controls/docking.js';
import { CodeEditor } from '../dist/controls/code-editor.js';
import { LanguageWorkspace } from '../dist/studio/language-workspace.js';

function fixture(t, detached = false) {
  const dom = controlDOM(t);
  const frames = new Map();
  let next = 0;
  const model = new DockLayout([{ id: 'xaml', kind: 'tool' }]);
  const control = new DockWorkspace(dom.host(), model, {
    browserWindows: {
      openWindow: () => {
        const popup = new Window();
        popup.requestAnimationFrame = (callback) => {
          frames.set(++next, callback);
          return next;
        };
        popup.cancelAnimationFrame = (id) => frames.delete(id);
        return popup;
      },
    },
  });
  // The real source panel has a Format toolbar button before its editor.
  const panel = dom.document.createElement('section');
  const toolbarButton = dom.document.createElement('button');
  toolbarButton.textContent = 'Format';
  const host = dom.document.createElement('div');
  panel.append(toolbarButton, host);
  const editor = new CodeEditor(host);
  editor.setValue('<Grid><Button/></Grid>');
  control.mount('xaml', panel);
  control.render();
  if (detached) control.openWindow('xaml');
  const flush = () => {
    dom.flushFrames();
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(0);
  };
  flush();
  t.after(() => {
    editor.dispose();
    control.dispose();
    frames.clear();
  });
  const language = Object.create(LanguageWorkspace.prototype);
  language.back = [];
  language.forward = [];
  language.s = {
    editor,
    doc: { id: 'document' },
    store: { session: { isValid: true } },
    docking: { control },
  };
  return { ...dom, control, editor, language, flush, toolbarButton };
}

for (const detached of [false, true])
  test(`source navigation retains input focus after docking frames, detached=${detached}`, (t) => {
    const { language, editor, control, flush, toolbarButton } = fixture(t, detached);
    toolbarButton.focus();
    const before = editor.getValue();
    assert.equal(language.navigate({ start: 7, end: 13 }), true);
    // Flush the same asynchronous docking activation that used to focus Format.
    flush();
    assert.equal(
      editor.input.ownerDocument.activeElement === editor.input,
      true,
      'Source input keeps focus',
    );
    assert.equal(
      editor.input.value.slice(editor.input.selectionStart, editor.input.selectionEnd),
      'Button',
    );
    assert.equal(editor.getValue(), before);
    assert.equal(control.model.state.activePanel, 'xaml');
    assert.equal(language.back.length, 1);
  });

test('navigation rejected by activation does not change the caret or history', (t) => {
  const { language, editor, control, flush } = fixture(t);
  editor.input.focus();
  editor.input.setSelectionRange(1, 5, 'backward');
  language.forward = [{ documentId: 'document', start: 0, end: 0 }];
  const future = [...language.forward];
  control.beforeActivate = () => false;
  assert.equal(language.navigate({ start: 7, end: 13 }), false);
  flush();
  assert.deepEqual(
    [editor.input.selectionStart, editor.input.selectionEnd, editor.input.selectionDirection],
    [1, 5, 'backward'],
  );
  assert.equal(language.back.length, 0);
  assert.deepEqual(language.forward, future);
});

test('navigation history preserves exact source selection and focus across browser hosts', (t) => {
  const { language, editor, flush } = fixture(t, true);
  editor.input.setSelectionRange(1, 5);
  language.navigate({ start: 7, end: 13 });
  flush();
  assert.equal(language.history(false), true);
  flush();
  assert.deepEqual([editor.input.selectionStart, editor.input.selectionEnd], [1, 5]);
  assert.equal(
    editor.input.ownerDocument.activeElement === editor.input,
    true,
    'Source input keeps focus',
  );
  assert.equal(language.history(true), true);
  flush();
  assert.deepEqual([editor.input.selectionStart, editor.input.selectionEnd], [7, 13]);
  assert.equal(
    editor.input.ownerDocument.activeElement === editor.input,
    true,
    'Source input keeps focus',
  );
});

test('a rejected history jump retains both stacks and the source caret', (t) => {
  const { language, editor, control, flush } = fixture(t);
  editor.input.setSelectionRange(1, 5);
  language.navigate({ start: 7, end: 13 });
  const back = [...language.back],
    forward = [...language.forward];
  control.beforeActivate = () => false;
  assert.equal(language.history(false), false);
  flush();
  assert.deepEqual(language.back, back);
  assert.deepEqual(language.forward, forward);
  assert.deepEqual([editor.input.selectionStart, editor.input.selectionEnd], [7, 13]);
});

test('a missing target document does not consume or append navigation history', (t) => {
  const { language, editor } = fixture(t);
  language.s.stores = [];
  editor.input.setSelectionRange(1, 5);
  assert.equal(language.navigate({ documentId: 'removed', start: 0, end: 0 }), false);
  assert.equal(language.back.length, 0);
  language.back.push({ documentId: 'removed', start: 0, end: 0 });
  assert.equal(language.history(false), false);
  assert.equal(language.back.length, 1);
  assert.equal(language.forward.length, 0);
  assert.deepEqual([editor.input.selectionStart, editor.input.selectionEnd], [1, 5]);
});
