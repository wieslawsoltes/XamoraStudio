import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EditorLineIndex,
  indexEditorTokens,
  renderEditorTokens,
  editorVirtualization,
} from '../dist/controls/code-viewport.js';
import { CodeEditor } from '../dist/controls/code-editor.js';
import { controlDOM } from './control-fixture.mjs';
const large = Array.from({ length: 100000 }, (_, i) => `row ${i + 1} <>&`).join('\n');
function fixture(t, options = {}) {
  const dom = controlDOM(t),
    frames = new Map();
  let id = 0;
  t.mock.method(dom.window, 'requestAnimationFrame', (cb) => {
    frames.set(++id, cb);
    return id;
  });
  t.mock.method(dom.window, 'cancelAnimationFrame', (key) => frames.delete(key));
  const control = new CodeEditor(dom.host(), options);
  Object.defineProperty(control.input, 'clientHeight', { value: 420, configurable: true });
  control.input.style.lineHeight = '21px';
  control.input.style.padding = '12px 14px';
  t.after(() => control.dispose());
  return {
    ...dom,
    control,
    frames,
    flush() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((cb) => cb(0));
    },
  };
}
test('line index preserves empty lines and UTF-16 source offsets', () => {
  const index = new EditorLineIndex('🙂a\n\nlast\n');
  assert.deepEqual([...index.starts], [0, 4, 5, 10]);
  assert.equal(index.length, 4);
  assert.deepEqual(
    [0, 3, 4, 5, 9, 10, 99].map((n) => index.lineAt(n)),
    [0, 0, 1, 2, 2, 3, 3],
  );
  assert.equal(index.offsetAt(4), 10);
  assert.equal(new EditorLineIndex().length, 1);
  assert.throws(() => new EditorLineIndex(null), /string/);
});
test('100000-line viewport range is bounded at the first, middle and last rows', () => {
  const index = new EditorLineIndex(large);
  for (const line of [0, 50000, 99999]) {
    const range = index.visibleRange(line * 21, 420, 21, 8);
    assert(range.startLine <= line && range.endLine > line);
    assert(range.endLine - range.startLine <= 37);
    assert(range.start >= 0 && range.end <= large.length);
  }
  assert.throws(() => index.visibleRange(0, 100, 0), /positive/);
  assert.throws(() => index.visibleRange(0, 100, 20, 201), /Overscan/);
});
test('token slices retain a multi-line token kind and escape content', () => {
  const source = 'before\n<one>\n<two>\nafter';
  const tokens = indexEditorTokens(source, {
    tokenize: () => [
      { text: 'before\n' },
      { text: '<one>\n<two>\n', kind: 'comment' },
      { text: 'after' },
    ],
  });
  assert.equal(
    renderEditorTokens(source, tokens, 13, 19),
    '<span class="syntax-comment">&lt;two&gt;\n</span>',
  );
  assert.equal(
    renderEditorTokens('<x>', [{ start: 0, end: 3, kind: 'x" onclick="bad' }]),
    '&lt;x&gt;',
  );
});
test('incomplete, throwing and fabricated token streams fall back to literal source', () => {
  for (const provider of [
    {
      tokenize() {
        throw Error('language');
      },
    },
    { tokenize: () => Promise.resolve([]) },
    { tokenize: () => [{ text: 'other' }] },
    { tokenize: () => [] },
  ]) {
    assert.equal(indexEditorTokens('<safe>', provider), null);
    assert.equal(renderEditorTokens('<safe>', null), '&lt;safe&gt;');
  }
});
test('virtualization settings validate before the host is changed', (t) => {
  const { host } = controlDOM(t),
    root = host();
  root.textContent = 'keep';
  for (const virtualization of [null, 3, { threshold: -1 }, { overscan: 201 }, { overscan: 1.5 }])
    assert.throws(() => new CodeEditor(root, { virtualization }));
  assert.equal(root.textContent, 'keep');
  assert.equal(editorVirtualization(false).threshold, Infinity);
  assert.equal(editorVirtualization(true).threshold, 0);
  assert.equal(editorVirtualization().threshold, 1000);
});
test('scrolling reuses token/line indexes and retains native input and selection', (t) => {
  let calls = 0;
  const { control, window, frames, flush } = fixture(t, {
    languageProvider: {
      tokenize: (source) => {
        calls++;
        return [{ text: source, kind: 'string' }];
      },
    },
  });
  control.setValue(large);
  const count = calls,
    index = control.lineIndex,
    input = control.input;
  input.setSelectionRange(150, 166, 'backward');
  for (let n = 0; n < 8; n++) {
    input.scrollTop = 50000 * 21 + n;
    input.dispatchEvent(new window.Event('scroll'));
  }
  assert.equal(frames.size, 1);
  flush();
  assert.equal(calls, count);
  assert.equal(control.lineIndex, index);
  assert.equal(control.input, input);
  assert.equal(input.selectionStart, 150);
  assert.equal(input.selectionEnd, 166);
  assert.equal(input.selectionDirection, 'backward');
  assert(control.viewport.virtualized);
  assert(control.viewport.renderedLines <= 37);
  assert(control.highlight.textContent.includes('row 50001'));
  assert(control.highlight.textContent.length < 1000);
  assert(control.highlight.querySelector('.syntax-string'));
});
test('pixel scrolling and resize update positions without retokenizing or replacing the paint window', (t) => {
  let calls = 0;
  const { control } = fixture(t, {
    virtualization: true,
    languageProvider: {
      tokenize: (source) => {
        calls++;
        return [{ text: source }];
      },
    },
  });
  control.setValue(large);
  control.input.scrollTop = 21 * 10 + 12;
  control.input.scrollLeft = 80;
  control.refreshLayout();
  const window = control.codeWindow,
    count = calls;
  const top = parseFloat(window.style.top);
  control.input.scrollTop++;
  control.refreshLayout();
  assert.equal(control.codeWindow, window);
  assert.equal(calls, count);
  assert.equal(parseFloat(window.style.top), top - 1);
  assert.equal(window.style.left, '-66px');
  Object.defineProperty(control.input, 'clientHeight', { value: 210, configurable: true });
  control.refreshLayout();
  assert(control.viewport.renderedLines <= 27);
});
test('reveal and cursor use indexed offsets, provider changes rebuild tokens once', (t) => {
  const { control } = fixture(t);
  control.setValue(large);
  const offset = control.lineIndex.offsetAt(87654) + 3;
  control.input.setSelectionRange(offset, offset);
  control.cursor();
  assert.equal(control.position.textContent, 'Ln 87655, Col 4');
  control.reveal(offset);
  assert(control.viewport.startLine <= 87654 && control.viewport.endLine > 87654);
  let calls = 0;
  control.setLanguageProvider(
    {
      tokenize: (source) => {
        calls++;
        return [{ text: source, kind: 'keyword' }];
      },
    },
    'Custom',
  );
  assert.equal(calls, 1);
  assert(control.highlight.querySelector('.syntax-keyword'));
  control.refreshLayout();
  assert.equal(calls, 1);
});
test('forced/full/threshold modes preserve source, native input and buffer undo', (t) => {
  const { control } = fixture(t, { virtualization: true });
  control.setValue('one\ntwo\nthree');
  const input = control.input;
  assert(control.viewport.virtualized);
  control.setVirtualization(false);
  assert.equal(control.viewport.virtualized, false);
  assert.equal(control.highlight.textContent, 'one\ntwo\nthree\n');
  assert.equal(control.lines.textContent, '1\n2\n3');
  control.setVirtualization({ threshold: 3, overscan: 0 });
  assert(control.viewport.virtualized);
  input.value = 'changed\ntwo\nthree';
  control.changed();
  assert(control.undoBuffer());
  assert.equal(control.getValue(), 'one\ntwo\nthree');
  assert.equal(control.input, input);
});
test('IME composition in virtual mode does not replace the input and teardown cancels pending paint', (t) => {
  const { control, window, frames, flush } = fixture(t, { virtualization: true });
  control.setValue('start\nend');
  const input = control.input;
  input.dispatchEvent(new window.Event('compositionstart'));
  input.value = '文\nend';
  input.dispatchEvent(new window.InputEvent('input', { isComposing: true }));
  assert(control.composing);
  control.refreshLayout();
  assert.equal(control.input, input);
  assert.equal(input.value, '文\nend');
  input.dispatchEvent(new window.Event('compositionend'));
  assert.equal(control.composing, false);
  input.dispatchEvent(new window.Event('scroll'));
  assert.equal(frames.size, 1);
  control.dispose();
  assert.equal(frames.size, 0);
  flush();
  input.dispatchEvent(new window.Event('scroll'));
  assert.equal(frames.size, 0);
  assert.equal(control.lineIndex, null);
  assert.equal(control.host.children.length, 0);
});
