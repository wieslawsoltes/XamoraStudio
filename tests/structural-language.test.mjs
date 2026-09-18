import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import { DocumentStore } from '../dist/core/model.js';
import { DocumentSession } from '../dist/core/document-session.js';
import { parseXaml } from '../dist/core/xaml.js';
import { parseHtml, serializeHtml } from '../dist/core/html.js';
import { SemanticLanguageService } from '../dist/core/language-service.js';
import { LanguageWorkspace } from '../dist/studio/language-workspace.js';
import { CodeEditor } from '../dist/controls/code-editor.js';

function setup(source, html = false) {
  const store = new DocumentStore(html ? parseHtml(source) : parseXaml(source));
  const session = new DocumentSession(store, {
    source,
    ...(html ? { adapters: { HTML: { parse: parseHtml, serialize: serializeHtml } } } : {}),
  });
  store.session = session;
  return { store, session, service: new SemanticLanguageService(session) };
}
const selected = (source, range) => range && source.slice(range.start, range.end);

test('matching tags use exact paired names, never text, comments, CDATA or attribute lookalikes', () => {
  const source =
    '<a:Grid xmlns:a="urn:custom"><a:Grid Tag="&lt;a:Grid> >"><!-- <a:Grid> --><![CDATA[</a:Grid>]]>text</a:Grid></a:Grid>';
  const { service } = setup(source);
  const at = source.indexOf('Tag=');
  const closing = service.matchingTagAt(at);
  assert.equal(closing.start, source.indexOf('</a:Grid>', source.indexOf('text')) + 2);
  assert.equal(selected(source, closing), 'a:Grid');
  const opening = service.matchingTagAt(closing.start);
  assert.equal(opening.start, source.indexOf('<a:Grid Tag') + 1);
  for (const marker of ['<!--', '<![CDATA[', 'text'])
    assert.equal(service.matchingTagAt(source.indexOf(marker) + 3), null);
});

test('self-closing tags and whitespace outside authored elements have no opposite tag', () => {
  const source = '<Grid> <Button/> </Grid>\n';
  const { service } = setup(source);
  assert.equal(service.matchingTagAt(source.indexOf('Button')), null);
  assert.equal(service.matchingTagAt(source.length - 1), null);
  assert.equal(service.elementAt(source.length), null);
  assert.equal(selected(source, service.elementAt(source.indexOf('Button'))), '<Button/>');
});

test('attribute selection expands value, attribute, opening tag, element and document in strict order', () => {
  const source = '<Grid>\n  <TextBlock Text="A 😀 &amp; B">body</TextBlock>\n</Grid>';
  const { service } = setup(source);
  const at = source.indexOf('😀');
  const ranges = service.selectionRanges(at);
  assert.deepEqual(
    ranges.map((r) => selected(source, r)),
    [
      'A 😀 &amp; B',
      'Text="A 😀 &amp; B"',
      '<TextBlock Text="A 😀 &amp; B">',
      '<TextBlock Text="A 😀 &amp; B">body</TextBlock>',
      '\n  <TextBlock Text="A 😀 &amp; B">body</TextBlock>\n',
      source,
    ],
  );
  for (let i = 1; i < ranges.length; i++) {
    assert(ranges[i].start <= ranges[i - 1].start);
    assert(ranges[i].end >= ranges[i - 1].end);
    assert(ranges[i].end - ranges[i].start > ranges[i - 1].end - ranges[i - 1].start);
  }
  assert.equal(ranges[0].line, 2);
  assert.equal(ranges[0].column, 20);
});

test('selections spanning siblings expand to shared content, not the first child', () => {
  const source = '<Grid><Button/><TextBlock Text="B"/></Grid>';
  const { service } = setup(source);
  const ranges = service.selectionRanges(source.indexOf('Button'), source.indexOf('TextBlock') + 5);
  assert.equal(selected(source, ranges[0]), '<Button/><TextBlock Text="B"/>');
  assert.equal(selected(source, ranges.at(-1)), source);
});

test('comments, CDATA, property wrappers and empty values have concrete, nonempty selection ranges', () => {
  const source =
    '<TextBlock><TextBlock.Text><!-- note --><![CDATA[A < B]]></TextBlock.Text></TextBlock>';
  const { service } = setup(source);
  assert.equal(selected(source, service.selectionRanges(source.indexOf('note'))[0]), ' note ');
  assert.equal(selected(source, service.selectionRanges(source.indexOf('A < B'))[0]), 'A < B');
  assert.equal(
    selected(source, service.elementAt(source.indexOf('note'))),
    '<TextBlock.Text><!-- note --><![CDATA[A < B]]></TextBlock.Text>',
  );
  const empty = '<Grid Tag=""/>';
  assert.equal(
    selected(empty, setup(empty).service.selectionRanges(empty.indexOf('""') + 1)[0]),
    'Tag=""',
  );
});

test('invalid offsets and drafts produce no stale structural locations', () => {
  const { session, service } = setup('<Grid><Button/></Grid>');
  for (const offset of [-1, 999, NaN, Infinity, 1.5, '2']) {
    assert.equal(service.matchingTagAt(offset), null);
    assert.equal(service.elementAt(offset), null);
    assert.deepEqual(service.selectionRanges(offset), []);
  }
  assert.deepEqual(service.selectionRanges(8, 2), []);
  session.updateSource('<Grid>');
  assert.equal(service.matchingTagAt(2), null);
  assert.equal(service.elementAt(2), null);
  assert.deepEqual(service.selectionRanges(2), []);
});

test('incremental text changes and undo recompute structural ranges without modifying history', () => {
  const source = '<Grid><TextBlock Text="A">body</TextBlock></Grid>';
  const { store, session, service } = setup(source);
  const original = service.matchingTagAt(source.indexOf('Text='));
  session.updateSource(source.replace('"A"', '"Longer 😀"'));
  const next = service.matchingTagAt(source.indexOf('Text='));
  assert.equal(next.start - original.start, 8);
  const revision = store.revision,
    history = store.history.length;
  service.selectionRanges(15);
  service.elementAt(15);
  assert.equal(store.revision, revision);
  assert.equal(store.history.length, history);
  store.undo();
  assert.deepEqual(service.matchingTagAt(source.indexOf('Text=')), original);
});

test('native HTML optional ends, void elements and inserted wrappers are never fabricated tag targets', (t) => {
  controlDOM(t);
  const source = '<!doctype html><ul><li>A<li>B</ul><table><tr><td>C</td></tr></table><br>';
  const { service } = setup(source, true);
  assert.equal(service.matchingTagAt(source.indexOf('<li>') + 1), null);
  assert.equal(service.matchingTagAt(source.indexOf('<br>') + 1), null);
  const td = service.matchingTagAt(source.indexOf('<td>') + 1);
  assert.equal(selected(source, td), 'td');
  assert(
    service
      .selectionRanges(source.indexOf('C'))
      .every((r) => !selected(source, r).includes('tbody')),
  );
});

test('HTML raw script content and quoted greater-than signs do not create tag matches', (t) => {
  controlDOM(t);
  const source =
    '<main><script>const s = "<main>not markup</main>";</script><p title="a > b">P</p></main>';
  const { service } = setup(source, true);
  assert.equal(service.matchingTagAt(source.indexOf('not markup')), null);
  assert.equal(
    selected(source, service.selectionRanges(source.indexOf('not markup'))[0]),
    'const s = "<main>not markup</main>";',
  );
  assert.equal(selected(source, service.matchingTagAt(source.indexOf('title='))), 'p');
});

function workspace(t, source) {
  const dom = controlDOM(t),
    state = setup(source),
    input = dom.host().appendChild(document.createElement('textarea'));
  input.value = source;
  const editor = { input, reveal() {}, cursor() {}, composing: false };
  const language = Object.create(LanguageWorkspace.prototype);
  language.s = { editor, store: state.store, doc: state.store.document };
  Object.defineProperty(language, 'service', { value: state.service });
  return { ...state, input, language, editor };
}

test('structural expand/shrink restores an arbitrary backwards selection and never edits source/history', (t) => {
  const source = '<Grid><TextBlock Text="Hello world"/></Grid>';
  const { input, language, store } = workspace(t, source);
  const start = source.indexOf('Hello') + 1;
  input.setSelectionRange(start, start + 3, 'backward');
  assert.equal(language.syntaxSelection(false), true);
  assert.equal(input.value.slice(input.selectionStart, input.selectionEnd), 'Hello world');
  assert.equal(language.syntaxSelection(false), true);
  assert.equal(language.syntaxSelection(true), true);
  assert.equal(language.syntaxSelection(true), true);
  assert.deepEqual(
    [input.selectionStart, input.selectionEnd, input.selectionDirection],
    [start, start + 3, 'backward'],
  );
  assert.equal(language.syntaxSelection(true), false);
  assert.equal(store.revision, 0);
  assert.equal(input.value, source);
});

test('manual selection, source revision and document switches discard stale shrink trails', (t) => {
  const { input, language, session } = workspace(t, '<Grid Tag="abc"/>');
  input.setSelectionRange(12, 12);
  language.syntaxSelection(false);
  input.setSelectionRange(1, 1);
  assert.equal(language.syntaxSelection(true), false);
  language.syntaxSelection(false);
  session.updateSource('<Grid Tag="xyz"/>');
  assert.equal(language.syntaxSelection(true), false);
});

test('source-to-designer selection chooses the inline owner of a property element', (t) => {
  const { input, language, store } = workspace(
    t,
    '<TextBlock><Run><Run.Text>body</Run.Text></Run></TextBlock>',
  );
  input.setSelectionRange(input.value.indexOf('body'), input.value.indexOf('body'));
  assert.equal(language.command('language-select-designer'), true);
  assert.deepEqual(store.selection, [store.document.root.children[0].id]);
  assert.equal(store.history.length, 0);
});

test('structural commands flush current editor source before using token ranges', (t) => {
  const { input, language, session, store } = workspace(t, '<Grid><TextBlock Text="A"/></Grid>');
  let flushed = 0;
  language.s.sync = {
    flush() {
      flushed++;
      const ok = session.updateSource(input.value).valid;
      language.s.doc = store.document;
      return ok;
    },
  };
  input.value = '<Grid><Button Content="New"/></Grid>';
  input.setSelectionRange(10, 10);
  assert.equal(language.command('language-select-designer'), true);
  assert.equal(flushed, 1);
  assert.equal(store.document.root.children[0].type, 'Button');
  assert.equal(store.selection[0], store.document.root.children[0].id);
});

test('editor routes syntax shortcuts only with a semantic host and never during IME', (t) => {
  const dom = controlDOM(t),
    editor = new CodeEditor(dom.host());
  t.after(() => editor.dispose());
  const calls = [];
  editor.onSemanticCommand = (command) => calls.push(command);
  const send = (options) =>
    editor.input.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options }),
    );
  send({ key: 'ArrowRight', altKey: true, shiftKey: true });
  send({ key: 'ArrowLeft', altKey: true, shiftKey: true });
  send({ key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true });
  send({ key: 'ArrowLeft', altKey: true });
  assert.deepEqual(calls, [
    'language-expand-selection',
    'language-shrink-selection',
    'language-matching-tag',
    'language-back',
  ]);
  editor.composing = true;
  send({ key: 'ArrowRight', altKey: true, shiftKey: true });
  assert.equal(calls.length, 4);
});
