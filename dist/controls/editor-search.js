import { TextSearchIndex } from './text-search.js';

/** Find/replace UI for one CodeEditor. Events follow the live panel into another document. */
export class EditorSearch {
  constructor(editor, host) {
    this.editor = editor;
    this.host = host;
    this.scope = null;
    this.context = null;
    this.version = 0;
    this.listeners = [];
    this.disposed = false;
    host.setAttribute('role', 'search');
    host.setAttribute('aria-label', 'Source search');
    host.innerHTML = `<div class="editor-find-row"><input data-find-query type="text" spellcheck="false" autocomplete="off" maxlength="10000"><button type="button" data-find="previous" title="Previous match (Shift+F3)" aria-label="Previous match">↑</button><button type="button" data-find="next" title="Next match (F3)" aria-label="Next match">↓</button><button type="button" data-find="toggle-replace" aria-expanded="false">Replace…</button><button type="button" data-find="close" aria-label="Close find" title="Close find (Escape)">×</button></div><div class="editor-replace-row" hidden><input data-find-replacement type="text" spellcheck="false" autocomplete="off" placeholder="Replace with"><button type="button" data-find="replace">Replace</button><button type="button" data-find="all">Replace all</button></div><div class="editor-find-options"><button type="button" data-find="case" aria-pressed="false" title="Match case">Match case</button><button type="button" data-find="word" aria-pressed="false" title="Match whole words">Whole word</button><button type="button" data-find="selection" aria-pressed="false" title="Search only within the captured source selection">In selection</button><span class="editor-find-status" role="status" aria-live="polite" aria-atomic="true"></span></div>`;
    this.query = host.querySelector('[data-find-query]');
    this.replacement = host.querySelector('[data-find-replacement]');
    this.status = host.querySelector('.editor-find-status');
    this.replaceRow = host.querySelector('.editor-replace-row');
    this.matchCase = false;
    this.wholeWord = false;
    this.source = editor.input.value;
    this.listen(host, 'input', (e) => {
      if (e.isComposing) return;
      this.note = '';
      this.refresh();
    });
    this.listen(host, 'compositionstart', () => {
      this.composing = true;
      this.refresh();
    });
    this.listen(host, 'compositionend', () => {
      this.composing = false;
      this.refresh();
    });
    this.listen(host, 'keydown', (e) => this.keydown(e));
    this.listen(host, 'click', (e) => {
      const action = e.target.closest('[data-find]')?.dataset.find;
      if (!action || e.target.closest('button')?.disabled) return;
      if (action === 'close') this.close();
      else if (action === 'next' || action === 'previous') this.move(action === 'previous');
      else if (action === 'replace' || action === 'all') this.replace(action === 'all');
      else if (action === 'toggle-replace') this.setReplaceVisible(this.replaceRow.hidden);
      else if (action === 'case' || action === 'word') {
        this[action === 'case' ? 'matchCase' : 'wholeWord'] =
          !this[action === 'case' ? 'matchCase' : 'wholeWord'];
        this.note = '';
        this.refresh();
      } else if (action === 'selection') {
        if (this.scope) this.scope = null;
        else {
          const input = editor.input;
          const chosen =
            this.candidate?.source === input.value && this.candidate.end > this.candidate.start
              ? this.candidate
              : { start: input.selectionStart, end: input.selectionEnd };
          if (chosen.end <= chosen.start) {
            this.note = 'Select source text first, then choose In selection.';
            this.refresh();
            return;
          }
          this.scope = { start: chosen.start, end: chosen.end };
        }
        this.note = '';
        this.refresh();
      }
    });
    this.listen(editor.input, 'select', () => this.refresh(false));
    this.listen(editor.input, 'compositionstart', () => this.refresh(false));
    this.listen(editor.input, 'compositionend', () => this.refresh());
    this.language(editor.language || 'Text');
  }
  listen(target, type, fn) {
    target.addEventListener(type, fn);
    this.listeners.push(() => target.removeEventListener(type, fn));
  }
  language(language) {
    this.query.setAttribute('aria-label', `Find in ${language}`);
    this.query.placeholder = `Find in ${language}`;
    this.replacement.setAttribute('aria-label', `Replace in ${language}`);
  }
  setContext(key) {
    if (this.context === key || this.disposed) return;
    this.context = key;
    this.scope = this.candidate = null;
    this.note = '';
    this.signature = null;
    this.refresh();
  }
  setReplaceVisible(value) {
    if (this.disposed) return;
    this.replaceRow.hidden = !value;
    this.host
      .querySelector('[data-find="toggle-replace"]')
      .setAttribute('aria-expanded', String(value));
    this.editor.refreshLayout();
  }
  open({ replace = false, seed = true } = {}) {
    if (this.disposed || this.editor.composing) return false;
    const input = this.editor.input;
    this.candidate = { source: input.value, start: input.selectionStart, end: input.selectionEnd };
    const selected = input.value.slice(input.selectionStart, input.selectionEnd);
    if (seed && selected && selected.length <= 10000 && !/[\r\n]/.test(selected))
      this.query.value = selected;
    this.host.hidden = false;
    if (replace) this.setReplaceVisible(true);
    this.editor.hideCompletions();
    this.note = '';
    this.refresh();
    this.query.focus({ preventScroll: true });
    this.query.select();
    return true;
  }
  close() {
    if (this.disposed) return;
    this.host.hidden = true;
    this.scope = this.candidate = null;
    this.model = null;
    this.signature = null;
    this.version++;
    this.editor.paint();
    this.editor.input.focus({ preventScroll: true });
  }
  /** Called before a source change is delivered to a host adapter. Unreviewed changes clear scope. */
  sourceChanged() {
    if (this.disposed) return;
    const value = this.editor.input.value;
    if (this.source !== value) {
      if (!this.applying && this.scope) {
        this.note = 'Selection scope cleared because the source changed.';
        this.scope = null;
      }
      if (!this.applying) this.candidate = null;
      this.source = value;
    }
  }
  refresh(paint = true) {
    if (this.disposed) return;
    this.sourceChanged();
    if (this.host.hidden) return;
    const signature = JSON.stringify([
      this.query.value,
      this.matchCase,
      this.wholeWord,
      this.scope,
    ]);
    let changed = false;
    if (this.signature !== signature || this.indexedSource !== this.source) {
      this.indexedSource = this.source;
      changed = true;
      this.signature = signature;
      this.version++;
      try {
        this.model = new TextSearchIndex(this.source, this.query.value, {
          matchCase: this.matchCase,
          wholeWord: this.wholeWord,
          range: this.scope || undefined,
        });
        this.error = '';
      } catch (error) {
        this.model = null;
        this.error = error.message;
      }
    }
    const input = this.editor.input,
      m = this.model;
    const current = m?.selected(input.selectionStart, input.selectionEnd) ?? -1;
    const composing = this.composing || this.editor.composing;
    this.status.textContent =
      this.error ||
      (composing ? 'Finish composing text to search or replace.' : this.note) ||
      (!this.query.value
        ? 'Type to search'
        : !m?.matches.length
          ? 'No matches'
          : `${current >= 0 ? current + 1 + ' of ' : ''}${m.matches.length.toLocaleString()}${m.truncated ? '+' : ''} matches${this.scope ? ' in selection' : ''}${m.truncated ? ' · narrow search to replace all' : ''}`);
    for (const [action, value] of [
      ['case', this.matchCase],
      ['word', this.wholeWord],
      ['selection', !!this.scope],
    ])
      this.host
        .querySelector(`[data-find="${action}"]`)
        .setAttribute('aria-pressed', String(value));
    for (const action of ['next', 'previous', 'replace', 'all']) {
      const replacement = action === 'replace' || action === 'all';
      this.host.querySelector(`[data-find="${action}"]`).disabled =
        !!composing ||
        !m?.matches.length ||
        !!this.error ||
        (replacement && (input.readOnly || input.disabled || this.editor.applyingTextEdits)) ||
        (action === 'all' && m?.truncated);
    }
    this.replacement.disabled = input.readOnly || input.disabled;
    if (changed && paint) this.editor.paint();
  }
  move(backwards = false, { focus = true } = {}) {
    if (this.disposed || this.editor.composing || this.composing) return false;
    if (this.host.hidden) this.open({ seed: false });
    this.note = '';
    this.refresh(false);
    const input = this.editor.input;
    const match = this.model?.next(input.selectionStart, input.selectionEnd, backwards);
    if (!match) return false;
    input.setSelectionRange(match.start, match.end);
    this.editor.reveal(match.start);
    this.editor.cursor(true);
    if (focus) input.focus({ preventScroll: true });
    this.refresh(false);
    if (match.wrapped) this.status.textContent += ' · Wrapped';
    return true;
  }
  replace(all = false) {
    if (this.disposed) return false;
    const editor = this.editor,
      input = editor.input;
    if (
      this.disposed ||
      input.readOnly ||
      input.disabled ||
      editor.composing ||
      this.composing ||
      this.applying
    )
      return false;
    this.note = '';
    this.refresh(false);
    const model = this.model;
    if (!model?.matches.length) return false;
    let at = model.selected(input.selectionStart, input.selectionEnd);
    if (!all && at < 0) {
      this.move(false, { focus: false });
      return false;
    }
    const context = this.context;
    const savedScope = this.scope && { ...this.scope };
    try {
      const result = model.replacement(this.replacement.value, all ? undefined : at);
      this.applying = true;
      // A synchronous host callback is the only optional bridge into document transactions.
      if (!editor.applyTextEdits(result.edits, { expectedValue: model.source }))
        throw Error('Replacement was rejected. Review the current source before trying again.');
      if (this.disposed || context !== this.context) return false;
      if (savedScope && input.value === result.text)
        this.scope = {
          start: savedScope.start,
          end: savedScope.end + result.text.length - model.source.length,
        };
      if (!all) {
        const end = model.matches[at].start + this.replacement.value.length;
        input.setSelectionRange(end, end);
      }
      this.signature = null;
      this.refresh();
      if (!all) this.move(false, { focus: false });
      this.note =
        result.text === model.source
          ? 'Replacement leaves the source unchanged.'
          : `Replaced ${result.count.toLocaleString()} occurrence${result.count === 1 ? '' : 's'}. Undo is available.`;
      this.refresh(false);
      return true;
    } catch (error) {
      this.note = error.message;
      this.refresh(false);
      return false;
    } finally {
      this.applying = false;
    }
  }
  keydown(event) {
    if (this.disposed || event.defaultPrevented || event.isComposing || this.composing) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      ['f', 'h'].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.open({ replace: event.key.toLowerCase() === 'h', seed: false });
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (
      event.key === 'Enter' &&
      (event.target === this.query || event.target === this.replacement) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.target === this.replacement) this.replace(false);
      else this.move(event.shiftKey, { focus: false });
    } else if (event.key === 'F3') {
      event.preventDefault();
      event.stopPropagation();
      this.move(event.shiftKey, { focus: false });
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.splice(0).forEach((fn) => fn());
    this.scope =
      this.candidate =
      this.context =
      this.model =
      this.signature =
      this.source =
      this.indexedSource =
        null;
    this.host.replaceChildren();
    this.editor = null;
  }
}
