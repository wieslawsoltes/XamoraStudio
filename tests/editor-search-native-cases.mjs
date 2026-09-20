/** Native DOM geometry and source safety cases shared by HTTP CI and in-memory local checks. */
export async function runEditorSearchNativeCases({ CodeEditor, TextSearchIndex }, host) {
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const source = Array.from({ length: 4000 }, (_, i) => `<row id="${i}">Needle</row>`).join('\n');
  const code = new CodeEditor(host, { virtualization: true });
  code.setValue(source);
  code.input.setSelectionRange(0, 0);
  code.find({ replace: true, seed: false });
  const search = code.search;
  search.query.value = 'Needle';
  search.refresh();
  check(search.model.matches.length === 4000, 'All matches counted without mounting them all');
  check(code.highlight.querySelectorAll('mark').length < 70, 'Highlight DOM bounded to viewport');
  check(
    code.highlight.querySelector('row') === null,
    'Authored tags never become real overlay elements',
  );
  code.input.setSelectionRange(source.length, source.length);
  code.findNext(true);
  check(
    code.input.value.slice(code.input.selectionStart, code.input.selectionEnd) === 'Needle',
    'Last match selected',
  );
  await new Promise((resolve) => requestAnimationFrame(resolve));
  check(code.input.scrollTop > 1000, 'Navigation reveals the remote match');
  check(code.viewport.startLine > 3900, 'Virtual paint follows the source caret');
  const previousModel = search.model;
  for (let i = 0; i < 10; i++) search.refresh(false);
  check(search.model === previousModel, 'Caret/status updates reuse immutable match index');
  check(code.editHistory.length === 0, 'Find navigation creates no edits');
  code.setValue('😀 CAT cat cat2', { force: true });
  code.input.setSelectionRange(7, 10);
  code.find({ seed: false, replace: true });
  search.query.value = 'cat';
  search.wholeWord = true;
  search.refresh();
  search.host.querySelector('[data-find="selection"]').click();
  search.replacement.value = '$&';
  check(search.replace(true), 'Scoped replacement applied');
  check(
    code.getValue() === '😀 CAT $& cat2',
    'Literal replacement kept outside selection unchanged',
  );
  check(code.undoBuffer() && code.getValue() === '😀 CAT cat cat2', 'One undo restores scope edit');
  code.setReadOnly(true);
  search.query.value = 'CAT';
  search.refresh();
  check(!search.replace(true), 'Read-only mutation refused');
  code.setReadOnly(false);
  search.close();
  check(host.ownerDocument.activeElement === code.input, 'Escape/close restores source focus');
  const folding = new TextSearchIndex('İ😀 K K', 'k');
  check(
    folding.matches.length === 2 && folding.matches[0].start === 4,
    'Unicode fold retains original offsets',
  );
  const phrase = new TextSearchIndex('xa a a', 'a a', { wholeWord: true });
  check(
    phrase.matches[0]?.start === 3,
    'A rejected whole-word overlap does not hide a valid phrase',
  );
  code.setValue('xa a a', { force: true });
  code.input.setSelectionRange(0, 0);
  code.find({ replace: true, seed: false });
  search.query.value = 'a a';
  search.replacement.value = 'matched';
  search.refresh();
  check(
    search.replace(true) && code.getValue() === 'xa matched',
    'Whole-word phrase replaces only the valid occurrence',
  );
  check(code.undoBuffer() && code.getValue() === 'xa a a', 'Phrase replacement is one undo');
  code.dispose();
  check(
    host.children.length === 0 && search.model === null,
    'Disposal releases search and editor DOM',
  );
}
