import { SourceTextCoordinates } from '../core/source-text-coordinates.js';
import { listenStudio } from './ui.js';
import { find, parentOf } from '../core/model.js';
import { serializeXaml } from '../core/xaml.js';
import { $, $$, notify, saveFile } from './ui.js';

/** Connect the IDE to each document's canonical source/AST session. */
export class DocumentSync {
  constructor(studio) {
    this.s = studio;
    studio.sync = this;
    this.positions = new Map();
    this.bound = new WeakSet();
    const editor = studio.editor;
    this.banner = document.createElement('div');
    this.banner.className = 'source-sync-banner';
    this.banner.hidden = true;
    this.banner.setAttribute('role', 'status');
    this.banner.innerHTML =
      '<button class="source-diagnostic" title="Go to source error"></button><button class="source-restore">Restore last valid source</button>';
    editor.host.prepend(this.banner);
    this.banner.querySelector('.source-diagnostic').onclick = () => this.revealDiagnostic();
    this.banner.querySelector('.source-restore').onclick = () => {
      studio.store.session.discardDraft();
      this.updateEditor();
    };
    this.attachStores();
    const add = studio.addStore.bind(studio);
    studio.addStore = (doc) => {
      const store = add(doc);
      this.attach(store);
      return store;
    };
    const render = studio.render.bind(studio);
    studio.render = () => {
      this.attachStores();
      if (this.applying) {
        this.queueRender();
        return;
      }
      render();
      this.updateEditor();
    };
    this.renderNow = () => {
      render();
      this.updateEditor();
    };
    studio.applyCode = (source) => {
      const result = this.applySource(this.coordinates.fromEditor(source));
      if (!result?.valid)
        throw Error(
          result?.diagnostics?.[0]?.message || 'Finish the source edit before changing the design.',
        );
      return result;
    };
    editor.onChange = (source, options) => this.capture(source, options);
    editor.onTextEdits = (edits, expectedValue) => this.applyEditorEdits(edits, expectedValue);
    editor.onValidate = () => {
      this.status();
      return !editor.composing && studio.store.session.isValid;
    };
    editor.onSelection = () => this.selectAtCaret();
    editor.onUndo = () => this.history(false);
    editor.onRedo = () => this.history(true);
    const command = studio.command.bind(studio);
    studio.command = (action, event) => {
      if (action === 'save-source') return this.saveSource();
      if (action === 'undo' || action === 'redo') return this.history(action === 'redo');
      return command(action, event);
    };
    const saveSource = document.createElement('button');
    saveSource.className = 'button quiet';
    saveSource.textContent = 'Save source';
    saveSource.title = 'Download the exact source, including an unfinished draft';
    saveSource.onclick = () => this.saveSource();
    $('.code-header [data-action="apply-code"]')?.after(saveSource);
    const context = studio.menus.runContext.bind(studio.menus);
    studio.menus.runContext = (id) =>
      ['undo', 'redo'].includes(id) && studio.menus.textTarget() === editor.input
        ? this.history(id === 'redo')
        : context(id);
    const syncCommand = studio.menus.commands.get('apply-code');
    if (syncCommand) syncCommand.label = 'Synchronize source';
    const formatCommand = studio.menus.commands.get('format');
    if (formatCommand) formatCommand.label = 'Format source';
    studio.copyXaml = async () => {
      const session = studio.store.session,
        spans = studio.store.selection.map((id) => session.sourceAtNode(id)).filter(Boolean),
        text = spans.length
          ? spans.map((span) => session.validSource.slice(span.start, span.end)).join('\n')
          : session.source;
      try {
        await navigator.clipboard.writeText(text);
        notify('Source copied');
      } catch {
        saveFile(
          studio.doc.name,
          text,
          studio.doc.framework === 'HTML' ? 'text/html' : 'application/xml',
        );
      }
    };
    const down = studio.pointerDown.bind(studio);
    studio.pointerDown = (event) => {
      if (studio.tool !== 'hand' && !studio.spaceHeld && !this.prepareEdit()) return;
      return down(event);
    };
    listenStudio(
      studio,
      document,
      'pointerdown',
      (event) => {
        if (editor.host.contains(event.target)) {
          studio.direct?.cancelGesture?.();
          studio.html?.cancelGesture?.();
          if (studio.direct?.inline) studio.direct.finishText(true);
          return;
        }
        // An IME composition must be committed by the editor before a visual action.
        if (
          editor.composing &&
          event.target.closest?.('#canvas-viewport,[data-prop],[data-html-css],[data-action]')
        ) {
          event.preventDefault();
          event.stopPropagation();
          notify('Finish composing the source text before editing the design.');
        }
      },
      true,
    );
    const problems = studio.docking.refreshProblems.bind(studio.docking);
    studio.docking.refreshProblems = () => {
      const source = studio.store.session.diagnostics.map((issue) => ({
        ...issue,
        severity: 'error',
        sourceSync: true,
      }));
      studio.issues = [...source, ...(studio.issues || []).filter((issue) => !issue.sourceSync)];
      problems();
      [...studio.docking.problemsHost.querySelectorAll('[data-dock-issue]')]
        .slice(0, source.length)
        .forEach((button, index) => (button.onclick = () => this.revealDiagnostic(source[index])));
    };
    window.addEventListener('pagehide', () => {
      if (editor.composing) this.persistComposition();
      else this.flush();
      studio.save();
    });
    this.recover();
    this.updateEditor();
    Object.assign(window.xamora, {
      getSession: () => studio.store.session,
      getSource: () => studio.store.session.source,
      setSource: (text) => this.applySource(text),
      flushSource: () => this.flush(),
    });
  }
  /** DOM offsets are LF-normalized; language/AST APIs always consume authored source offsets. */
  get coordinates() {
    const source = this.s.store.session.source;
    if (this.textCoordinates?.source !== source)
      this.textCoordinates = new SourceTextCoordinates(source);
    return this.textCoordinates;
  }
  sourceOffset(offset) {
    return this.coordinates.toSource(offset);
  }
  editorOffset(offset) {
    return this.coordinates.toEditor(offset);
  }
  matchesEditor() {
    return this.coordinates.editorText === this.s.editor.input.value;
  }
  attachStores() {
    for (const store of this.s.stores) this.attach(store);
  }
  attach(store) {
    if (this.bound.has(store) || !store.session) return;
    this.bound.add(store);
    store.addCommitHook(() => {
      if (store === this.s.store && this.s.editor.composing && !this.applying)
        throw Error('Finish composing the source text before editing the design.');
    });
    store.session.addEventListener('change', () => {
      if (store === this.s.store) {
        this.updateEditor();
        this.s.docking.refreshProblems();
        this.s.docking.updateTitles();
      }
    });
  }
  queueRender() {
    if (this.renderFrame) return;
    this.renderFrame = this.s.editor.host.ownerDocument.defaultView.requestAnimationFrame(() => {
      this.renderFrame = null;
      this.renderNow();
    });
  }
  capture(source, { composing = false } = {}) {
    source = this.coordinates.fromEditor(source);
    if (composing) {
      this.composition = {
        documentId: this.s.doc.id,
        text: source,
        base: this.s.store.session.validSource,
      };
      this.persistComposition();
      this.status();
      return;
    }
    this.composition = null;
    try {
      localStorage.removeItem('xamora-source-composition-v1');
    } catch {}
    this.applySource(source);
    this.selectAtCaret();
  }
  /** Preserve every untouched canonical newline interval during non-contiguous replacements. */
  applyEditorEdits(edits, expectedValue) {
    const editor = this.s.editor,
      session = this.s.store.session;
    if (
      editor.composing ||
      editor.input.readOnly ||
      editor.input.disabled ||
      editor.input.value !== expectedValue
    )
      return false;
    // Capture any pending input before using canonical ranges, including invalid drafts.
    this.applySource(this.coordinates.fromEditor(expectedValue));
    if (
      this.s.store.session !== session ||
      editor.input.value !== expectedValue ||
      !this.matchesEditor()
    )
      return false;
    this.s.direct?.cancelGesture?.();
    this.s.html?.cancelGesture?.();
    const coords = this.coordinates;
    const mapped = edits.map((edit) => ({
      start: coords.toSource(edit.start),
      end: coords.toSource(edit.end),
      text: edit.text.replace(/\n/g, coords.newline),
    }));
    this.applying = true;
    let result;
    try {
      result = session.applySourceEdits(mapped, {
        origin: 'code',
        expectedRevision: session.revision,
        expectedVersion: session.buffer.version,
      });
    } finally {
      this.applying = false;
    }
    if (this.s.scopeId && !find(this.s.doc.root, this.s.scopeId)) this.s.scopeId = null;
    this.updateEditor();
    return result?.accepted === true;
  }
  applySource(source) {
    if (this.s.editor.composing)
      return { valid: false, diagnostics: [{ message: 'Finish composing the source text.' }] };
    const session = this.s.store.session;
    if (source === session.source) {
      this.status();
      return {
        accepted: true,
        valid: session.isValid,
        diagnostics: session.diagnostics,
        revision: session.revision,
      };
    }
    this.s.direct?.cancelGesture?.();
    this.s.html?.cancelGesture?.();
    this.applying = true;
    let result;
    try {
      result = session.updateSource(source, { origin: 'code' });
    } finally {
      this.applying = false;
    }
    if (this.s.scopeId && !find(this.s.doc.root, this.s.scopeId)) this.s.scopeId = null;
    this.updateEditor();
    return result;
  }
  flush() {
    if (this.s.editor.composing) return false;
    return this.applySource(this.coordinates.fromEditor(this.s.editor.input.value))?.valid === true;
  }
  prepareEdit() {
    if (!this.flush()) {
      notify(
        this.s.editor.composing
          ? 'Finish composing the source text before editing the design.'
          : 'The source has errors. Fix the source or use Restore last valid source to resume visual editing.',
      );
      return false;
    }
    return true;
  }
  updateEditor() {
    const editor = this.s.editor,
      session = this.s.store.session;
    if (!session) return;
    editor.setSearchContext?.(session);
    // A composing buffer belongs to its document and must never be overwritten by renders.
    if (!editor.composing) {
      editor.setValue(this.coordinates.editorText, { force: true, preserveHistory: true });
      editor.dirty = !session.isValid;
    }
    this.status();
  }
  status() {
    const editor = this.s.editor,
      session = this.s.store.session;
    if (!session) return;
    const issue = session.diagnostics[0],
      invalid = !session.isValid;
    editor.message.classList.toggle('error', invalid);
    editor.message.textContent = editor.composing
      ? 'Composing source…'
      : invalid
        ? `${issue?.line || 1}:${issue?.column || 1} ${issue?.message || 'Invalid source'} · last valid design retained`
        : `${this.s.doc.framework === 'HTML' ? 'HTML' : 'XAML'} · live synchronized · revision ${session.revision}`;
    this.banner.hidden = !invalid;
    this.banner.querySelector('.source-diagnostic').textContent = invalid
      ? `Source error at ${issue?.line || 1}:${issue?.column || 1}. Visual editing paused.`
      : '';
    $('#studio')?.classList.toggle('source-has-errors', invalid);
    $$('[data-action="apply-code"]').forEach((button) => {
      button.disabled = invalid || !!editor.composing;
      button.title = 'Source synchronizes automatically. Ctrl+Enter checks synchronization now.';
    });
  }
  beforeSwitch() {
    const editor = this.s.editor;
    if (editor.composing) {
      this.persistComposition();
      notify('Finish composing the source text before switching documents.');
      return false;
    }
    this.flush();
    this.positions.set(this.s.doc.id, {
      start: editor.input.selectionStart,
      end: editor.input.selectionEnd,
      direction: editor.input.selectionDirection,
      top: editor.input.scrollTop,
      left: editor.input.scrollLeft,
      history: [...editor.editHistory],
      future: [...editor.editFuture],
    });
    return true;
  }
  afterSwitch() {
    const editor = this.s.editor;
    this.attachStores();
    this.updateEditor();
    const saved = this.positions.get(this.s.doc.id);
    editor.editHistory = saved?.history || [];
    editor.editFuture = saved?.future || [];
    editor.input.setSelectionRange(saved?.start || 0, saved?.end || 0, saved?.direction || 'none');
    editor.input.scrollTop = saved?.top || 0;
    editor.input.scrollLeft = saved?.left || 0;
    editor.paint();
    this.status();
  }
  history(redo) {
    const editor = this.s.editor;
    if (editor.composing) {
      notify('Finish composing the source text before undo or redo.');
      return false;
    }
    this.flush();
    if (redo) this.s.store.session.redo();
    else this.s.store.session.undo();
    this.updateEditor();
    return true;
  }
  selectAtCaret() {
    if (this.selecting || this.s.editor.composing || !this.s.store.session.isValid) return;
    let node = this.s.store.session.nodeAtOffset(
      this.sourceOffset(this.s.editor.input.selectionStart),
    );
    while (node && node.kind !== 'element') node = parentOf(this.s.doc.root, node.id);
    if (
      !node ||
      node.kind !== 'element' ||
      (this.s.store.selection.length === 1 && this.s.store.selection[0] === node.id)
    )
      return;
    this.selecting = true;
    try {
      this.s.store.select([node.id]);
    } finally {
      this.selecting = false;
    }
  }
  revealSelection() {
    if (this.selecting || this.s.editor.composing || !this.s.store.session.isValid) return;
    const span = this.s.store.session.sourceAtNode(this.s.store.selection[0]);
    if (!span) return;
    this.s.editor.input.setSelectionRange(
      this.editorOffset(span.start),
      this.editorOffset(Math.min(span.openEnd ?? span.end, span.start + 160)),
    );
    this.s.editor.reveal(this.editorOffset(span.start));
    this.s.editor.cursor();
  }
  revealDiagnostic(issue = this.s.store.session.diagnostics[0]) {
    if (!issue) return;
    if (this.s.docking.control.activate('xaml', { focus: false }) === false) return;
    const editor = this.s.editor,
      source = editor.input.value;
    const index = Number.isFinite(issue.start)
      ? this.editorOffset(Math.min(this.coordinates.source.length, Math.max(0, issue.start)))
      : Number.isFinite(issue.offset)
        ? this.editorOffset(Math.min(this.coordinates.source.length, Math.max(0, issue.offset)))
        : source
            .split('\n')
            .slice(0, Math.max(0, (issue.line || 1) - 1))
            .reduce((n, line) => n + line.length + 1, 0) + Math.max(0, (issue.column || 1) - 1);
    editor.input.ownerDocument.defaultView?.focus();
    editor.input.focus();
    editor.input.setSelectionRange(
      Math.min(index, source.length),
      Math.min(index + 1, source.length),
    );
    editor.reveal(index);
    editor.cursor();
  }
  saveSource() {
    const editor = this.s.editor;
    if (editor.composing) {
      notify('Finish composing the source text before saving.');
      return;
    }
    this.flush();
    saveFile(
      this.s.doc.name,
      this.s.store.session.source,
      this.s.doc.framework === 'HTML' ? 'text/html' : 'application/xml',
    );
  }
  persistComposition() {
    if (this.composition)
      try {
        localStorage.setItem('xamora-source-composition-v1', JSON.stringify(this.composition));
      } catch {}
  }
  recover() {
    for (const key of ['xamora-pending-source', 'xamora-source-composition-v1'])
      try {
        const draft = JSON.parse(localStorage.getItem(key));
        if (!draft) continue;
        const store = this.s.stores.find((store) => store.document.id === draft.documentId);
        if (
          store &&
          (draft.base === store.session.validSource || draft.base === serializeXaml(store.document))
        ) {
          store.session.updateSource(draft.text, { origin: 'recovery' });
          localStorage.removeItem(key);
          notify('Recovered source edits for ' + store.document.name + '.');
        }
      } catch {}
  }
}
