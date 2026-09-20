import test from 'node:test';
import assert from 'node:assert/strict';
import { CodeEditor } from '../dist/controls/code-editor.js';
import { renderEditorTokens } from '../dist/controls/code-viewport.js';
import { controlDOM } from './control-fixture.mjs';

function fixture(t, source = 'one ONE alone one', options = {}) {
  const dom = controlDOM(t);
  const code = new CodeEditor(dom.host(), options);
  code.setValue(source);
  code.input.setSelectionRange(0, 0);
  t.after(() => code.dispose());
  const query = (text, replacement = '') => {
    code.find({ replace: true, seed: false });
    code.search.query.value = text;
    code.search.replacement.value = replacement;
    code.search.refresh();
    return code.search;
  };
  const key = (target, key, options = {}) => {
    const e = new dom.window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    target.dispatchEvent(e);
    return e;
  };
  const value = () => code.input.value.slice(code.input.selectionStart, code.input.selectionEnd);
  return { ...dom, code, query, key, value };
}

test('find seeds selected text, presents options and count, and never edits source', (t) => {
  const { code } = fixture(t);
  code.input.setSelectionRange(4, 7, 'backward');
  code.find();
  assert.equal(code.search.query.value, 'ONE');
  assert.match(code.search.status.textContent, /2 of 4 matches/);
  assert.equal(code.search.status.getAttribute('role'), 'status');
  assert.equal(code.input.ownerDocument.activeElement, code.search.query);
  assert.equal(code.getValue(), 'one ONE alone one');
  assert.equal(code.editHistory.length, 0);
  assert.equal(code.highlight.textContent, code.getValue() + '\n');
});
test('next/previous/F3 wrap occurrences without changing source history', (t) => {
  const { code, query, key, value } = fixture(t, 'one one');
  query('one');
  key(code.input, 'F3');
  assert.equal(code.input.selectionStart, 0);
  key(code.input, 'F3');
  assert.equal(code.input.selectionStart, 4);
  key(code.input, 'F3');
  assert.equal(code.input.selectionStart, 0);
  assert.match(code.search.status.textContent, /Wrapped/);
  key(code.input, 'F3', { shiftKey: true });
  assert.equal(code.input.selectionStart, 4);
  assert.equal(value(), 'one');
  assert.equal(code.editHistory.length, 0);
});
test('search Enter navigates while focus stays in find, Escape returns to current source selection', (t) => {
  const { code, query, key, value } = fixture(t);
  const s = query('one');
  key(s.query, 'Enter');
  assert.equal(code.input.ownerDocument.activeElement, s.query);
  assert.equal(value(), 'one');
  key(s.query, 'Escape');
  assert.equal(s.host.hidden, true);
  assert.equal(code.input.ownerDocument.activeElement, code.input);
  assert.equal(value(), 'one');
  assert.equal(code.highlight.querySelectorAll('mark').length, 0);
});
test('case and whole-word toggles are immediate and accessible', (t) => {
  const { code, query } = fixture(t);
  const s = query('one');
  assert.equal(s.model.matches.length, 4);
  s.host.querySelector('[data-find="case"]').click();
  assert.equal(s.model.matches.length, 3);
  s.host.querySelector('[data-find="word"]').click();
  assert.equal(s.model.matches.length, 2);
  assert.equal(s.host.querySelector('[data-find="word"]').getAttribute('aria-pressed'), 'true');
  assert.equal(code.highlight.querySelectorAll('mark').length, 2);
});
test('Replace first selects a real match and does not blindly replace arbitrary selected text', (t) => {
  const { code, query } = fixture(t, 'one other one');
  const s = query('one', 'X');
  assert.equal(s.replace(), false);
  assert.equal(code.getValue(), 'one other one');
  assert.equal(s.replace(), true);
  assert.equal(code.getValue(), 'X other one');
  assert.equal(code.input.selectionStart, 8);
  assert.equal(code.editHistory.length, 1);
  assert.equal(code.undoBuffer(), true);
  assert.equal(code.getValue(), 'one other one');
});
test('Replace all uses one source-change callback and one undo, treating substitutions literally', (t) => {
  let events = 0;
  const { code, query } = fixture(t, 'one one one', { onChange: () => events++ });
  query('one', '$&').replace(true);
  assert.equal(code.getValue(), '$& $& $&');
  assert.equal(events, 1);
  assert.equal(code.editHistory.length, 1);
  code.undoBuffer();
  assert.equal(code.getValue(), 'one one one');
  code.redoBuffer();
  assert.equal(code.getValue(), '$& $& $&');
});
test('captured selection scope stays anchored and resizes after a controlled replacement', (t) => {
  const { code, query } = fixture(t, 'one one one');
  code.input.setSelectionRange(4, 7);
  const s = query('one', 'longer');
  s.host.querySelector('[data-find="selection"]').click();
  assert.equal(s.model.matches.length, 1);
  s.replace(true);
  assert.equal(code.getValue(), 'one longer one');
  assert.deepEqual(s.scope, { start: 4, end: 10 });
  s.query.value = 'longer';
  s.refresh();
  assert.equal(s.model.matches.length, 1);
  s.replacement.value = 'Z';
  s.replace(true);
  assert.equal(code.getValue(), 'one Z one');
  assert.deepEqual(s.scope, { start: 4, end: 5 });
});
test('external edits and document identity changes invalidate selection scope, including equal text', (t) => {
  const { code, query } = fixture(t, 'one one');
  code.setSearchContext({});
  code.input.setSelectionRange(4, 7);
  const s = query('one');
  s.host.querySelector('[data-find="selection"]').click();
  assert(s.scope);
  code.setSearchContext({});
  assert.equal(s.scope, null);
  assert.equal(s.query.value, 'one');
  code.input.setSelectionRange(4, 7);
  code.find({ seed: false });
  s.host.querySelector('[data-find="selection"]').click();
  code.setValue('one two', { force: true });
  assert.equal(s.scope, null);
  assert.match(s.status.textContent, /scope cleared/);
});
test('empty selection never widens a requested selection-only search silently', (t) => {
  const { query } = fixture(t);
  const s = query('one');
  s.host.querySelector('[data-find="selection"]').click();
  assert.equal(s.scope, null);
  assert.match(s.status.textContent, /Select source text first/);
});
test('read-only and disabled surfaces allow searching but never replace', (t) => {
  const { code, query } = fixture(t);
  const s = query('one', 'X');
  for (const property of ['readOnly', 'disabled']) {
    code.input[property] = true;
    s.refresh();
    assert.equal(s.replace(true), false);
    assert.equal(code.getValue(), 'one ONE alone one');
    assert.equal(s.host.querySelector('[data-find="all"]').disabled, true);
    assert(s.move());
    code.input[property] = false;
  }
});
test('IME in source or search fields does not consume composition or apply replacements', (t) => {
  const { code, query, key, window } = fixture(t);
  const s = query('one', 'X');
  code.input.dispatchEvent(new window.Event('compositionstart'));
  assert.equal(s.replace(true), false);
  assert.equal(s.move(), false);
  assert.equal(key(code.input, 'Enter', { isComposing: true }).defaultPrevented, false);
  code.input.dispatchEvent(new window.Event('compositionend'));
  s.query.dispatchEvent(new window.Event('compositionstart', { bubbles: true }));
  assert.equal(key(s.query, 'Enter', { isComposing: true }).defaultPrevented, false);
  assert.equal(s.replace(true), false);
  s.query.dispatchEvent(new window.Event('compositionend', { bubbles: true }));
  assert.equal(code.getValue(), 'one ONE alone one');
});
test('bounded result sets never allow a partial Replace all', (t) => {
  const { code, query } = fixture(t, 'a'.repeat(20001));
  const s = query('a', 'x');
  assert.equal(s.model.truncated, true);
  assert.equal(s.host.querySelector('[data-find="all"]').disabled, true);
  assert.equal(s.replace(true), false);
  assert.equal(code.getValue(), 'a'.repeat(20001));
  assert.equal(code.editHistory.length, 0);
});
test('stale edit snapshots and rejected host adapters never fall back to local mutations', (t) => {
  let calls = 0;
  const { code, query } = fixture(t, 'one', {
    onTextEdits: () => {
      calls++;
      return false;
    },
  });
  const edits = [{ start: 0, end: 3, text: 'two' }];
  assert.equal(code.applyTextEdits(edits, { expectedValue: 'old' }), false);
  assert.equal(calls, 0);
  assert.equal(query('one', 'two').replace(true), false);
  assert.equal(calls, 1);
  assert.equal(code.getValue(), 'one');
  assert.equal(code.editHistory.length, 0);
});
test('document-owned batch replaces once, updates the surface, and never calls standalone onChange', (t) => {
  let calls = 0,
    changes = 0;
  const { code, query } = fixture(t, 'one one', { onChange: () => changes++ });
  code.onTextEdits = (edits, before) => {
    calls++;
    assert.equal(before, 'one one');
    assert.equal(edits.length, 2);
    code.setValue('two two', { force: true });
    return true;
  };
  assert.equal(query('one', 'two').replace(true), true);
  assert.equal(calls, 1);
  assert.equal(changes, 0);
  assert.equal(code.getValue(), 'two two');
});
test('dispose cancels search events, clears references and disallows delayed application', (t) => {
  const { code, query, key } = fixture(t);
  const s = query('one', 'two'),
    host = s.host;
  code.dispose();
  key(s.query, 'Enter');
  assert.equal(s.replace(true), false);
  assert.equal(s.move(), false);
  assert.equal(host.childNodes.length, 0);
  assert.equal(s.model, null);
  assert.equal(s.editor, null);
  assert.equal(code.onTextEdits, null);
  assert.equal(code.find(), false);
});
test('highlighting intersects token and viewport boundaries without inserting untrusted markup', () => {
  const src = '<evil>one</evil>';
  const tokens = [
    { start: 0, end: 6, kind: 'tag' },
    { start: 6, end: 9, kind: 'string' },
    { start: 9, end: 16, kind: 'tag' },
  ];
  const paint = renderEditorTokens(src, tokens, 2, 12, [{ start: 0, end: 9 }]);
  assert.equal(paint.includes('<evil>'), false);
  assert.match(paint, /syntax-tag/);
  assert.match(paint, /<mark class="editor-search-match">/);
  assert.equal(paint.includes('one</mark>'), true);
});
test('virtualized highlighting stays bounded to visible lines', (t) => {
  const { code, query } = fixture(t, Array.from({ length: 5000 }, () => '<item/>').join('\n'), {
    virtualization: true,
  });
  query('item');
  assert.equal(code.search.model.matches.length, 5000);
  assert(code.highlight.querySelectorAll('mark').length < 60);
  assert.equal(code.viewport.virtualized, true);
});

test('Enter on option buttons retains native button activation, and Ctrl+H inside Find opens Replace', (t) => {
  const { code, query, key } = fixture(t);
  const s = query('one');
  s.setReplaceVisible(false);
  const option = s.host.querySelector('[data-find="case"]');
  assert.equal(key(option, 'Enter').defaultPrevented, false);
  const e = key(s.query, 'h', { ctrlKey: true });
  assert.equal(e.defaultPrevented, true);
  assert.equal(s.replaceRow.hidden, false);
  assert.equal(code.input.ownerDocument.activeElement, s.query);
});
test('same-text replacement does not add history or advertise nonexistent Undo', (t) => {
  const { code, query } = fixture(t, 'one');
  const s = query('one', 'one');
  assert(s.replace(true));
  assert.equal(code.editHistory.length, 0);
  assert.match(s.status.textContent, /unchanged/);
});
test('single-line match highlighting has a hard paint cap and preserves every source character', (t) => {
  const { code, query } = fixture(t, 'a'.repeat(25000));
  query('a');
  assert(code.highlight.querySelectorAll('mark').length <= 1000);
  assert.equal(code.highlight.textContent, code.input.value + '\n');
});
