import {
  EditorLineIndex,
  indexEditorTokens,
  renderEditorTokens,
  editorVirtualization,
} from './code-viewport.js';
/** Standalone text editing surface. Language semantics belong to injected providers. */
export class CodeEditor {
  constructor(
    host,
    {
      language = 'Text',
      languageProvider = {},
      onApply = () => {},
      onSelection,
      onChange,
      readOnly = false,
      virtualization = {},
    } = {},
  ) {
    if (!host?.ownerDocument) throw new TypeError('CodeEditor requires a DOM host.');
    this.virtualization = editorVirtualization(virtualization);
    this.paintRevision = 0;
    this.tokenRevision = -1;
    this.paintFrame = null;
    this.window = host.ownerDocument.defaultView;
    this.languageProvider = languageProvider;
    this.onChange = onChange;
    this.disposed = false;
    this.listeners = [];
    host.classList.add('xamora-code-editor');
    this.onApply = onApply;
    this.onSelection = onSelection;
    this.host = host;
    this.dirty = false;
    this.searchIndex = 0;
    this.editHistory = [];
    this.editFuture = [];
    this.lastText = '';
    this.syncedText = '';
    host.innerHTML = `<div class="editor-find" hidden><input aria-label="Find in XAML" placeholder="Find in XAML"><input aria-label="Replace in XAML" placeholder="Replace with"><button data-find="next">Next</button><button data-find="replace">Replace</button><button data-find="all">All</button><button data-find="close" aria-label="Close find">×</button></div><div class="editor-body"><div class="line-numbers" aria-hidden="true"></div><div class="code-viewport"><pre class="code-highlight" aria-hidden="true"></pre><textarea class="code-input" aria-label="XAML code editor" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off"></textarea><div class="completions" role="listbox" hidden></div></div></div><div class="editor-status"><span class="code-message">XAML</span><span class="code-position">Ln 1, Col 1</span></div>`;
    this.input = host.querySelector('textarea');
    this.highlight = host.querySelector('pre');
    this.lines = host.querySelector('.line-numbers');
    this.completions = host.querySelector('.completions');
    this.message = host.querySelector('.code-message');
    this.position = host.querySelector('.code-position');
    // Large native textarea insertions can stall before an input event is delivered.
    // Keep the textarea authoritative but apply ordinary virtualized text inserts
    // through its range API, then use the existing input/history/validation path.
    this.listen(this.input, 'beforeinput', (event) => {
      if (
        this.disposed ||
        this.input.readOnly ||
        this.input.disabled ||
        this.composing ||
        event.isComposing ||
        event.defaultPrevented ||
        !event.cancelable ||
        !this.viewport?.virtualized ||
        event.inputType !== 'insertText' ||
        typeof event.data !== 'string'
      )
        return;
      event.preventDefault();
      const top = this.input.scrollTop,
        left = this.input.scrollLeft;
      this.input.setRangeText(
        event.data,
        this.input.selectionStart,
        this.input.selectionEnd,
        'end',
      );
      this.input.scrollTop = top;
      this.input.scrollLeft = left;
      this.input.dispatchEvent(
        new this.window.InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: event.inputType,
          data: event.data,
        }),
      );
    });
    this.listen(this.input, 'compositionstart', () => {
      this.composing = true;
    });
    this.listen(this.input, 'compositionend', () => {
      this.composing = false;
      this.changed({ defer: false });
    });
    this.listen(this.input, 'input', (e) => {
      this.changed({ defer: true, composing: e.isComposing });
      if (!e.isComposing && this.input.value[this.input.selectionStart - 1]?.match(/[.<{=\w]/))
        this.complete();
    });
    this.listen(this.input, 'scroll', () => {
      this.schedulePaint();
      this.hideCompletions();
    });
    this.listen(this.input, 'click', () => {
      this.hideCompletions();
      this.cursor(true);
    });
    this.listen(this.input, 'keyup', () => this.cursor(true));
    this.listen(this.input, 'keydown', (e) => this.keydown(e));
    this.listen(host.querySelector('.editor-find'), 'click', (e) => {
      const action = e.target.dataset.find;
      if (!action) return;
      if (action === 'close') {
        host.querySelector('.editor-find').hidden = true;
        return;
      }
      const [a, b] = host.querySelectorAll('.editor-find input');
      if (!a.value) return;
      const value = this.input.value;
      if (this.input.readOnly && ['all', 'replace'].includes(action)) return;
      if (action === 'all') {
        this.input.value = value.split(a.value).join(b.value);
        this.changed();
        return;
      }
      if (
        action === 'replace' &&
        value.slice(this.input.selectionStart, this.input.selectionEnd) === a.value
      ) {
        this.input.setRangeText(b.value, this.input.selectionStart, this.input.selectionEnd, 'end');
        this.changed();
      }
      const at = this.input.value.indexOf(a.value, this.input.selectionEnd);
      const start = at < 0 ? this.input.value.indexOf(a.value) : at;
      if (start >= 0) {
        this.input.focus();
        this.input.setSelectionRange(start, start + a.value.length);
        this.reveal(start);
      } else this.message.textContent = 'No matches';
    });
    this.elements = [...host.children];
    this.setLanguage(language);
    this.setReadOnly(readOnly);
    this.message.textContent = language;
    if (this.window.ResizeObserver) {
      this.resizeObserver = new this.window.ResizeObserver(() => this.schedulePaint());
      this.resizeObserver.observe(this.input);
    }
    this.listen(this.window, 'resize', () => this.schedulePaint());
    host.ownerDocument.fonts?.ready.then(() => {
      if (!this.disposed) this.refreshLayout();
    });
    this.paint();
  }
  listen(target, type, listener) {
    target.addEventListener(type, listener);
    this.listeners.push(() => target.removeEventListener(type, listener));
  }
  getLanguageProvider() {
    return this.languageProvider || {};
  }
  setLanguageProvider(provider = {}, language = this.language) {
    if (this.disposed) return;
    this.languageProvider = provider;
    this.setLanguage(language);
    this.hideCompletions();
    this.paint();
    this.validate();
  }
  getValue() {
    return this.input.value;
  }
  focus() {
    if (!this.disposed) this.input.focus();
  }
  setReadOnly(value) {
    this.input.readOnly = Boolean(value);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.resizeObserver?.disconnect();
    if (this.paintFrame !== null) this.window.cancelAnimationFrame(this.paintFrame);
    this.paintFrame = null;
    this.lineIndex = this.tokenIndex = this.paintSource = null;
    for (const remove of this.listeners) remove();
    this.listeners.length = 0;
    this.completions.replaceChildren();
    for (const node of this.elements) node.remove();
    this.host.classList.remove('xamora-code-editor');
    this.onChange = this.onApply = this.onSelection = null;
    this.onValidate = this.getCompletions = this.getLanguageContext = null;
    this.onUndo = this.onRedo = this.onSemanticCommand = null;
  }
  setLanguage(language = 'Text') {
    this.tokenRevision = -1;
    this.language = language;
    this.input.setAttribute('aria-label', language + ' code editor');
    this.host.querySelectorAll('.editor-find input').forEach((el, i) => {
      el.setAttribute('aria-label', (i ? 'Replace in ' : 'Find in ') + language);
      if (!i) el.placeholder = 'Find in ' + language;
    });
  }
  changed({ defer = false, composing = false } = {}) {
    if (this.disposed) return;
    const value = this.input.value;
    if (value !== this.lastText) {
      this.editHistory.push(this.lastText);
      while (
        this.editHistory.length > 60 ||
        (this.editHistory.length > 1 &&
          this.editHistory.reduce((n, v) => n + v.length, 0) > 8000000)
      )
        this.editHistory.shift();
      this.editFuture = [];
      this.lastText = value;
    }
    this.hideCompletions();
    this.dirty = value !== this.syncedText;
    this.paint();
    clearTimeout(this.timer);
    if (defer) this.timer = setTimeout(() => this.validate(), 350);
    else this.validate();
    this.onChange?.(value, { defer, composing: composing || this.composing });
  }
  undoBuffer() {
    if (this.disposed || this.input.readOnly) return false;
    if (!this.editHistory.length) return false;
    this.editFuture.push(this.input.value);
    return this.restoreBuffer(this.editHistory.pop());
  }
  redoBuffer() {
    if (this.disposed || this.input.readOnly) return false;
    if (!this.editFuture.length) return false;
    this.editHistory.push(this.input.value);
    return this.restoreBuffer(this.editFuture.pop());
  }
  restoreBuffer(value) {
    this.lastText = value;
    this.input.value = value;
    this.input.setSelectionRange(value.length, value.length);
    this.changed();
    return true;
  }

  setValue(value, { force = false, preserveHistory = false } = {}) {
    if (this.disposed) return false;
    value = String(value);
    if (this.dirty && !force) return false;
    const before = this.input.value,
      selection = mapTextSelection(
        before,
        value,
        this.input.selectionStart,
        this.input.selectionEnd,
      ),
      direction = this.input.selectionDirection,
      top = this.input.scrollTop,
      left = this.input.scrollLeft;
    if (before !== value) this.hideCompletions();
    if (value !== this.lastText && !preserveHistory) {
      this.editHistory = [];
      this.editFuture = [];
    }
    this.syncedText = value;
    this.lastText = value;
    if (before !== value) {
      this.input.value = value;
      this.input.setSelectionRange(selection.start, selection.end, direction);
      this.input.scrollTop = top;
      this.input.scrollLeft = left;
    }
    this.dirty = false;
    if (before !== value) this.paint();
    this.message.textContent = (this.language || 'Text') + ' · synchronized';
    return true;
  }

  schedulePaint() {
    if (this.disposed || this.paintFrame !== null) return;
    this.paintFrame = this.window.requestAnimationFrame(() => {
      this.paintFrame = null;
      this.paint();
    });
  }
  setVirtualization(value = {}) {
    if (this.disposed) return;
    this.virtualization = editorVirtualization(value);
    this.renderSignature = null;
    this.paint();
  }
  refreshLayout() {
    if (!this.disposed) this.paint();
  }
  ensureIndex() {
    const source = this.input.value;
    if (source !== this.paintSource || !this.lineIndex) {
      this.paintSource = source;
      this.lineIndex = new EditorLineIndex(source);
      this.paintRevision++;
    }
    return this.lineIndex;
  }
  paint() {
    if (this.disposed) return;
    const index = this.ensureIndex(),
      source = index.source;
    if (this.tokenRevision !== this.paintRevision) {
      this.tokenIndex = indexEditorTokens(source, this.getLanguageProvider());
      this.tokenRevision = this.paintRevision;
      this.renderSignature = null;
    }
    const style = this.window.getComputedStyle(this.input),
      gutter = this.window.getComputedStyle(this.lines);
    const numeric = (value, fallback = 0) =>
      Number.isFinite(parseFloat(value)) ? parseFloat(value) : fallback;
    const lineHeight = Math.max(1, numeric(style.lineHeight, 21)),
      topPadding = numeric(style.paddingTop, 12);
    const virtualized = index.length >= this.virtualization.threshold;
    this.highlight.classList.toggle('is-virtual', virtualized);
    this.lines.classList.toggle('is-virtual', virtualized);
    const range = virtualized
      ? index.visibleRange(
          this.input.scrollTop - topPadding,
          this.input.clientHeight,
          lineHeight,
          this.virtualization.overscan,
        )
      : { startLine: 0, endLine: index.length, start: 0, end: source.length };
    const signature = `${this.paintRevision}:${this.tokenRevision}:${virtualized}:${range.startLine}:${range.endLine}`;
    if (this.renderSignature !== signature) {
      const html = renderEditorTokens(source, this.tokenIndex, range.start, range.end);
      const numbers = Array.from(
        { length: range.endLine - range.startLine },
        (_, i) => range.startLine + i + 1,
      ).join('\n');
      if (virtualized) {
        if (!this.codeWindow || this.codeWindow.parentElement !== this.highlight) {
          this.codeWindow = this.host.ownerDocument.createElement('span');
          this.codeWindow.className = 'code-paint-window';
          this.highlight.replaceChildren(this.codeWindow);
          this.lineWindow = this.host.ownerDocument.createElement('span');
          this.lineWindow.className = 'code-line-window';
          this.lines.replaceChildren(this.lineWindow);
        }
        this.codeWindow.innerHTML = html + (html.endsWith('\n') ? '' : '\n');
        this.lineWindow.textContent = numbers;
      } else {
        this.highlight.innerHTML = html + '\n';
        this.lines.textContent = numbers;
        this.codeWindow = this.lineWindow = null;
      }
      this.renderSignature = signature;
    }
    if (virtualized) {
      const top = topPadding + range.startLine * lineHeight - this.input.scrollTop;
      this.codeWindow.style.top = `${top}px`;
      this.codeWindow.style.left = `${numeric(style.paddingLeft) - this.input.scrollLeft}px`;
      this.codeWindow.style.lineHeight = this.lineWindow.style.lineHeight = `${lineHeight}px`;
      this.lineWindow.style.top = `${top}px`;
      this.lineWindow.style.paddingLeft = gutter.paddingLeft;
      this.lineWindow.style.paddingRight = gutter.paddingRight;
      this.lines.style.minWidth = `calc(${Math.max(3, String(index.length).length)}ch + ${numeric(gutter.paddingLeft) + numeric(gutter.paddingRight)}px)`;
      this.highlight.scrollTop = this.highlight.scrollLeft = this.lines.scrollTop = 0;
    } else {
      this.lines.style.minWidth = '';
      this.highlight.scrollTop = this.input.scrollTop;
      this.highlight.scrollLeft = this.input.scrollLeft;
      this.lines.scrollTop = this.input.scrollTop;
    }
    this.viewport = Object.freeze({
      virtualized,
      lineCount: index.length,
      startLine: range.startLine,
      endLine: range.endLine,
      renderedLines: range.endLine - range.startLine,
    });
    this.cursor();
  }
  cursor(notify = false) {
    if (this.disposed) return;
    const index = this.ensureIndex(),
      caret = this.input.selectionStart,
      line = index.lineAt(caret);
    this.position.textContent = `Ln ${line + 1}, Col ${caret - index.offsetAt(line) + 1}`;
    if (notify) this.onSelection?.({ start: caret, end: this.input.selectionEnd });
  }
  validate() {
    if (this.disposed) return false;
    if (this.onValidate) return this.onValidate();
    try {
      const result = this.getLanguageProvider().validate?.(this.input.value);
      if (result === false || typeof result === 'string')
        throw Error(typeof result === 'string' ? result : 'Invalid source');
      this.message.textContent = this.dirty
        ? 'Valid ' + (this.language || 'Text') + ' · synchronizing…'
        : (this.language || 'Text') + ' · synchronized';
      this.message.classList.remove('error');
      return true;
    } catch (e) {
      this.message.textContent = `${e.line || 1}:${e.column || 1} ${e.message}`;
      this.message.classList.add('error');
      return false;
    }
  }
  apply() {
    if (!this.validate()) return false;
    try {
      if (this.onApply?.(this.input.value) === false) throw Error('Apply was rejected.');
      this.syncedText = this.input.value;
      this.dirty = false;
      this.message.textContent = (this.language || 'Text') + ' · synchronized';
      return true;
    } catch (error) {
      this.message.textContent = error.message;
      this.message.classList.add('error');
      this.dirty = true;
      return false;
    }
  }
  format() {
    try {
      if (this.disposed || this.input.readOnly) return false;
      const format = this.getLanguageProvider().format;
      if (!format) return false;
      const value = format(this.input.value);
      if (typeof value !== 'string') throw Error('A formatter must return source text.');
      this.input.value = value;
      this.changed();
    } catch (e) {
      this.validate();
    }
  }
  find() {
    if (this.disposed) return;
    this.host.querySelector('.editor-find').hidden = false;
    this.host.querySelector('.editor-find input').focus();
  }
  reveal(offset) {
    if (this.disposed) return;
    const line = this.ensureIndex().lineAt(offset);
    const measured = parseFloat(this.window.getComputedStyle(this.input).lineHeight);
    this.input.scrollTop = Math.max(
      0,
      (line - 3) * (Number.isFinite(measured) && measured > 0 ? measured : 21),
    );
    this.paint();
  }
  revealName(name) {
    const at = this.input.value.indexOf(`="${name}"`);
    if (at >= 0) {
      this.input.setSelectionRange(at + 2, at + 2 + name.length);
      this.reveal(at);
      this.cursor();
    }
  }
  complete() {
    if (this.disposed || this.input.readOnly || this.composing) return;
    const source = this.input.value,
      caret = this.input.selectionStart;
    const context = this.getLanguageContext?.() || {};
    const items = (
      this.getCompletions?.(source, caret, context) ??
      this.getLanguageProvider().complete?.(source, caret, context) ??
      []
    ).slice(0, 60);
    if (!items.length) {
      this.hideCompletions();
      return;
    }
    this.completions.replaceChildren();
    this.completions.hidden = false;
    for (const [index, entry] of items.entries()) {
      const item = this.host.ownerDocument.createElement('button');
      item.type = 'button';
      item.role = 'option';
      item.title = entry.detail;
      const label = this.host.ownerDocument.createElement('span');
      label.textContent = entry.label;
      const detail = this.host.ownerDocument.createElement('small');
      detail.textContent = entry.detail;
      item.append(label, detail);
      item.classList.toggle('active', index === 0);
      item.onmousedown = (e) => {
        e.preventDefault();
        if (
          this.disposed ||
          this.input.readOnly ||
          this.input.value !== source ||
          this.input.selectionStart !== caret
        ) {
          this.hideCompletions();
          return;
        }
        this.input.setRangeText(entry.insertText, entry.start, entry.end, 'end');
        if (entry.caretOffset !== undefined)
          this.input.setSelectionRange(
            entry.start + entry.caretOffset,
            entry.start + entry.caretOffset,
          );
        this.changed();
        this.hideCompletions();
        this.input.focus();
      };
      this.completions.append(item);
    }
    this.completionIndex = 0;
  }
  hideCompletions() {
    this.completions.hidden = true;
  }
  keydown(e) {
    if (this.disposed || e.isComposing) return;
    if (
      this.onSemanticCommand &&
      (e.key === 'F12' ||
        e.key === 'F2' ||
        (e.altKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)))
    ) {
      e.preventDefault();
      e.stopPropagation();
      this.hideCompletions();
      this.onSemanticCommand(
        e.key === 'F2'
          ? 'language-rename'
          : e.key === 'F12'
            ? e.shiftKey
              ? 'language-references'
              : 'language-definition'
            : e.key === 'ArrowLeft'
              ? 'language-back'
              : 'language-forward',
      );
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key))
      this.hideCompletions();
    const mod = e.ctrlKey || e.metaKey;
    if (
      this.input.readOnly &&
      ((mod && ['z', 'y', '/'].includes(e.key.toLowerCase())) || ['Tab', 'Enter'].includes(e.key))
    )
      return;
    if (mod && ['z', 'y'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey || e.key.toLowerCase() === 'y') {
        if (this.onRedo) this.onRedo();
        else this.redoBuffer();
      } else {
        if (this.onUndo) this.onUndo();
        else this.undoBuffer();
      }
      return;
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      this.apply();
      return;
    }
    if (mod && e.code === 'Space') {
      e.preventDefault();
      this.complete();
      return;
    }
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.find();
      return;
    }
    if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.format();
      return;
    }
    if (e.key === 'Escape') this.hideCompletions();
    if (!this.completions.hidden && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key)) {
      e.preventDefault();
      const items = [...this.completions.children];
      if (e.key === 'Enter' || e.key === 'Tab') {
        items[this.completionIndex].dispatchEvent(
          new this.host.ownerDocument.defaultView.MouseEvent('mousedown', { bubbles: true }),
        );
        return;
      }
      this.completionIndex =
        (this.completionIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((n, i) => n.classList.toggle('active', i === this.completionIndex));
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const a = this.input.selectionStart,
        b = this.input.selectionEnd;
      if (a !== b) {
        const start = this.input.value.lastIndexOf('\n', a - 1) + 1,
          text = this.input.value.slice(start, b),
          out = e.shiftKey ? text.replace(/^ {1,4}/gm, '') : text.replace(/^/gm, '    ');
        this.input.setRangeText(out, start, b, 'select');
      } else this.input.setRangeText('    ', a, b, 'end');
      this.changed();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const a = this.input.selectionStart,
        before = this.input.value.slice(0, a),
        indent = before.split('\n').at(-1).match(/^\s*/)[0];
      const extra = this.getLanguageProvider().indent?.(before) || '';
      this.input.setRangeText('\n' + indent + extra, a, this.input.selectionEnd, 'end');
      this.changed();
    }
    if (mod && e.key === '/' && this.getLanguageProvider().toggleComment) {
      e.preventDefault();
      const a = this.input.selectionStart,
        b = this.input.selectionEnd;
      const start = this.input.value.lastIndexOf('\n', a - 1) + 1,
        end = this.input.value.indexOf('\n', b);
      const text = this.input.value.slice(start, end < 0 ? this.input.value.length : end);
      const out = this.getLanguageProvider().toggleComment(text);
      this.input.setRangeText(out, start, end < 0 ? this.input.value.length : end, 'select');
      this.changed();
    }
  }
}

/** Preserve both caret endpoints when an external AST transaction patches source. */
export function mapTextSelection(before, after, start, end = start) {
  if (before === after) return { start, end };
  let prefix = 0,
    suffix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix++;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  )
    suffix++;
  const oldEnd = before.length - suffix,
    newEnd = after.length - suffix;
  const map = (offset) =>
    Math.max(
      0,
      Math.min(
        after.length,
        offset <= prefix
          ? offset
          : offset >= oldEnd
            ? offset + newEnd - oldEnd
            : prefix + Math.min(offset - prefix, newEnd - prefix),
      ),
    );
  return { start: map(start), end: map(end) };
}
