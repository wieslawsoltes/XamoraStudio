import { planProjectConversion } from '../core/conversion-project.js';
import { clone, uid, validateDocument } from '../core/model.js';
import { filePath, validateSolution } from '../core/solution.js';
import { esc, $, notify, saveFile } from './ui.js';

const fingerprint = (snapshot) =>
  JSON.stringify({ documents: snapshot.documents, solution: snapshot.solution });

/** Capture an immutable conversion preview, including pending source drafts. */
export function planSolutionConversion(snapshot, options = {}, compiler) {
  validateSolution(snapshot.documents, snapshot.solution);
  const plan = planProjectConversion(
    snapshot.documents.map((document) => ({ id: document.id, path: filePath(document), document })),
    { ...options, existingFolders: snapshot.solution.folders },
    compiler,
  );
  return { ...plan, base: fingerprint(snapshot), activeId: snapshot.activeId };
}

/** Apply a reviewed plan to a copy. A caller commits this copy as one solution-history step. */
export function applySolutionConversion(
  snapshot,
  plan,
  { allowPartial = false, selected, openResult = false } = {},
) {
  if (!plan || plan.version !== 1 || plan.base !== fingerprint(snapshot))
    throw Error('The solution changed after this preview. Preview the conversion again.');
  if (plan.summary.failed && !allowPartial)
    throw Error('Resolve conversion failures or select “Create successful files only”.');
  const chosen = plan.entries.filter(
    (entry, index) => entry.status === 'ready' && (!selected || selected.includes(index)),
  );
  if (!chosen.length) throw Error('Select at least one converted file to create.');
  const next = clone(snapshot),
    created = [];
  for (const entry of chosen) {
    const doc = clone(entry.result.document);
    doc.id = uid();
    doc.name = entry.targetPath.split('/').at(-1);
    doc.metadata ??= {};
    doc.metadata.solutionPath = entry.targetPath;
    doc.metadata.source = {
      version: 1,
      language: doc.framework === 'HTML' ? 'HTML' : 'XAML',
      text: entry.source,
      validText: entry.source,
      diagnostics: [],
    };
    doc.metadata.conversion = {
      version: 1,
      sourceDocumentId: entry.id,
      sourcePath: entry.sourcePath,
      target: plan.options.to,
      diagnostics: clone(entry.diagnostics),
      losses: clone(entry.result.losses || []),
      sourceMap: clone(entry.result.sourceMap || []),
    };
    validateDocument(doc);
    next.documents.push(doc);
    created.push({ sourceId: entry.id, documentId: doc.id, path: entry.targetPath });
    const parts = entry.targetPath.split('/');
    parts.pop();
    while (parts.length) {
      next.solution.folders.push(parts.join('/'));
      parts.pop();
    }
  }
  next.solution.folders = [...new Set(next.solution.folders)].sort();
  if (openResult)
    next.activeId = (
      created.find((entry) => entry.sourceId === snapshot.activeId) || created[0]
    ).documentId;
  validateSolution(next.documents, next.solution);
  return { snapshot: next, created };
}

export class CompilerWorkspace {
  constructor(studio) {
    this.s = studio;
    studio.compiler = this;
    this.lastReport = null;
    if (globalThis.window?.xamora)
      window.xamora.compiler = {
        preview: (options) => this.preview(options),
        apply: (plan, options) => this.apply(plan, options),
        show: (options) => this.show(options),
      };
  }
  preview(options = {}) {
    if (this.s.editor.composing) throw Error('Finish composing the source text before converting.');
    this.s.sync?.flush();
    return planSolutionConversion(this.s.solution.snapshot(), options);
  }
  apply(plan, options = {}) {
    if (!this.s.prepareEdit()) return false;
    const result = applySolutionConversion(this.s.solution.snapshot(), plan, options);
    const applied = this.s.solution.mutate(
      'Convert ' + result.created.length + ' document' + (result.created.length === 1 ? '' : 's'),
      (snapshot) => Object.assign(snapshot, result.snapshot),
    );
    if (!applied) return false;
    this.lastReport = {
      version: 1,
      summary: plan.summary,
      options: plan.options,
      created: result.created,
      entries: plan.entries.map(({ result, source, ...entry }) => ({
        ...entry,
        losses: result?.losses || [],
        sourceMap: result?.sourceMap || [],
      })),
    };
    if (options.openResult) this.s.setView('split');
    notify(
      result.created.length +
        ' converted file' +
        (result.created.length === 1 ? '' : 's') +
        ' created. Project → Undo solution change reverses this batch.',
    );
    return result;
  }
  show(options = {}) {
    const s = this.s,
      scope = options.scope || 'document',
      documentId = options.documentId || s.solution.selectedId || s.doc.id;
    const selected = s.stores.find((store) => store.document.id === documentId)?.document || s.doc;
    const folder = options.folder ?? s.solution.folder ?? '',
      to = options.to || (selected.framework === 'HTML' ? 'xaml' : 'html');
    const settings = {
      scope,
      documentId,
      folder,
      to,
      framework: options.framework || 'WPF',
      collision: 'rename',
      preserveMetadata: true,
      strict: false,
      ...options,
    };
    this.currentSettings = settings;
    s.modal(
      'Convert XAML and HTML',
      `<div class="compiler-workspace"><p>Create editable semantic conversions for one document, a folder, or the solution. Review reported approximations and unsupported behavior before using an output.</p><div class="compiler-options"><label>Scope<select data-convert-option="scope"><option value="document">Selected document</option><option value="folder">Folder and descendants</option><option value="solution">Entire solution</option></select></label><label data-convert-document-label>Document<select data-convert-option="documentId">${s.stores.map((store) => `<option value="${esc(store.document.id)}">${esc(filePath(store.document))}</option>`).join('')}</select></label><label data-convert-folder-label>Source folder<select data-convert-option="folder"><option value="">Solution root</option>${s.solution.model.folders.map((path) => `<option value="${esc(path)}">${esc(path)}</option>`).join('')}</select></label><label>Target<select data-convert-target><option value="html">HTML / CSS / JavaScript</option><option value="WPF">WPF XAML</option><option value="Avalonia">Avalonia XAML</option></select></label><label>Output folder<input data-convert-option="outputFolder" placeholder="Beside each source file" value=""></label><label>Existing output paths<select data-convert-option="collision"><option value="rename">Create a unique file name</option><option value="skip">Skip conflicting files</option><option value="error">Report a conversion failure</option></select></label></div><div class="compiler-flags"><label><input type="checkbox" data-convert-option="preserveMetadata" checked> Preserve round-trip metadata</label><label><input type="checkbox" data-convert-option="strict"> Fail on semantic losses</label><label><input type="checkbox" data-convert-partial> Create successful files only</label><label><input type="checkbox" data-convert-open> Open a converted document</label></div><div class="compiler-status" role="status" aria-live="polite"></div><div class="compiler-review"><div class="compiler-files" role="group" aria-label="Conversion files"></div><div class="compiler-detail"><div class="compiler-detail-header"><strong data-convert-filename>Output preview</strong><button type="button" data-convert-source>Show original</button></div><textarea data-convert-preview readonly spellcheck="false" aria-label="Converted source preview"></textarea><div class="compiler-diagnostics" aria-label="Conversion diagnostics"></div></div></div><p class="compiler-note">Original files stay in the solution. Generated files enter the same source, canvas, properties, and undo workflow. One solution undo removes the entire conversion batch.</p></div>`,
      [
        { label: 'Preview again', run: () => this.refresh() },
        { label: 'Download report', run: () => this.downloadPlan() },
        {
          label: 'Create converted files',
          primary: true,
          run: () => {
            const selected = [
              ...$('.compiler-workspace').querySelectorAll('[data-convert-include]:checked'),
            ].map((input) => Number(input.dataset.convertInclude));
            const result = this.apply(this.plan, {
              selected,
              allowPartial: !!$('[data-convert-partial]').checked,
              openResult: !!$('[data-convert-open]').checked,
            });
            if (result) s.closeModal();
          },
        },
      ],
      true,
    );
    for (const input of $('.compiler-workspace').querySelectorAll('[data-convert-option]')) {
      const value = settings[input.dataset.convertOption];
      if (value !== undefined) {
        if (input.type === 'checkbox') input.checked = !!value;
        else input.value = value;
      }
      input.onchange = () => this.refresh();
    }
    $('[data-convert-target]').value = to === 'html' ? 'html' : settings.framework;
    $('[data-convert-target]').onchange = () => this.refresh();
    $('[data-convert-partial]').onchange = () => this.updateApply();
    $('[data-convert-source]').onclick = () => {
      const entry = this.plan?.entries[this.detailIndex];
      if (!entry) return;
      const issue = entry.diagnostics.find((issue) => issue.sourceRange || issue.nodeId);
      s.closeModal();
      s.solution.open(entry.id, 'split');
      if (issue?.nodeId) s.store.select([issue.nodeId]);
      if (issue?.sourceRange) {
        const range = issue.sourceRange;
        s.editor.input.setSelectionRange(range.start, range.end ?? range.start);
        s.editor.reveal(range.start);
        s.editor.input.focus();
      } else s.sync?.revealSelection();
    };
    this.refresh();
  }
  readSettings() {
    const settings = { ...this.currentSettings };
    for (const input of $('.compiler-workspace').querySelectorAll('[data-convert-option]'))
      settings[input.dataset.convertOption] =
        input.type === 'checkbox' ? input.checked : input.value;
    const target = $('[data-convert-target]').value;
    settings.to = target === 'html' ? 'html' : 'xaml';
    if (target !== 'html') settings.framework = target;
    $('[data-convert-document-label]').hidden = settings.scope !== 'document';
    $('[data-convert-folder-label]').hidden = settings.scope !== 'folder';
    return settings;
  }
  refresh() {
    this.plan = null;
    this.detailIndex = 0;
    const status = $('.compiler-status');
    try {
      this.currentSettings = this.readSettings();
      this.plan = this.preview(this.currentSettings);
      const summary = this.plan.summary;
      status.textContent = `${summary.ready} ready · ${summary.failed} failed · ${summary.skipped} skipped · ${summary.losses} semantic losses`;
      $('.compiler-files').innerHTML =
        this.plan.entries
          .map(
            (entry, index) =>
              `<div class="compiler-file ${entry.status}"><input type="checkbox" data-convert-include="${index}" aria-label="Create ${esc(entry.targetPath || entry.sourcePath)}" ${entry.status === 'ready' ? 'checked' : 'disabled'}><button type="button" data-convert-detail="${index}"><span>${esc(entry.sourcePath)}</span><strong>${esc(entry.targetPath || 'No output')}</strong><small>${entry.status} · ${entry.diagnostics.length} diagnostics</small></button></div>`,
          )
          .join('') || '<p>No files match this scope.</p>';
      for (const button of $('.compiler-files').querySelectorAll('[data-convert-detail]'))
        button.onclick = () => this.detail(Number(button.dataset.convertDetail));
      for (const input of $('.compiler-files').querySelectorAll('[data-convert-include]'))
        input.onchange = () => this.updateApply();
      this.detail(this.plan.entries.findIndex((entry) => entry.status === 'ready'));
    } catch (error) {
      status.textContent = error.message;
      $('.compiler-files').replaceChildren();
      this.detail(-1);
    }
    this.updateApply();
  }
  detail(index) {
    this.detailIndex = index < 0 ? 0 : index;
    const entry = this.plan?.entries[this.detailIndex];
    $('[data-convert-filename]').textContent = entry?.targetPath || 'Output preview';
    $('[data-convert-preview]').value = entry?.source || '';
    $('[data-convert-source]').disabled = !entry?.id;
    $('.compiler-diagnostics').innerHTML =
      (entry?.diagnostics || [])
        .map(
          (issue, index) =>
            `<button type="button" class="compiler-issue ${esc(issue.severity)}" data-convert-issue="${index}"><strong>${esc(issue.severity)} · ${esc(issue.code || 'Conversion')}</strong><span>${esc(issue.message)}</span></button>`,
        )
        .join('') ||
      (entry
        ? '<p>No conversion diagnostics.</p>'
        : '<p>Select a file to inspect its generated source and diagnostics.</p>');
    for (const button of $('.compiler-diagnostics').querySelectorAll('[data-convert-issue]'))
      button.onclick = () => {
        const issue = entry.diagnostics[Number(button.dataset.convertIssue)],
          mapping = entry.result?.sourceMap?.find(
            (mapping) => mapping.sourceNodeId === issue.nodeId,
          ),
          range = mapping?.targetRange;
        if (range) {
          const input = $('[data-convert-preview]');
          input.focus();
          input.setSelectionRange(range.start, range.end ?? range.start);
          input.scrollTop =
            Math.max(0, input.value.slice(0, range.start).split('\n').length - 4) * 19;
        }
      };
    for (const button of $('.compiler-files').querySelectorAll('[data-convert-detail]'))
      button.setAttribute(
        'aria-pressed',
        String(Number(button.dataset.convertDetail) === this.detailIndex),
      );
  }
  updateApply() {
    const ready =
        $('.compiler-files')?.querySelectorAll('[data-convert-include]:checked').length || 0,
      button = $('[data-modal-action="2"]');
    if (!button) return;
    const disabled =
      !this.plan || !ready || (!!this.plan.summary.failed && !$('[data-convert-partial]').checked);
    // The reusable dialog keeps the pending-action lock separate from availability.
    if (!this.s.dialogHost?.setActionDisabled?.(2, disabled)) button.disabled = disabled;
    button.textContent = 'Create ' + ready + ' converted file' + (ready === 1 ? '' : 's');
  }
  downloadPlan() {
    if (!this.plan) throw Error('Preview a conversion first.');
    const report = {
      version: 1,
      options: this.plan.options,
      summary: this.plan.summary,
      entries: this.plan.entries.map(({ result, source, ...entry }) => ({
        ...entry,
        losses: result?.losses || [],
        sourceMap: result?.sourceMap || [],
      })),
    };
    saveFile('xamora-conversion-report.json', JSON.stringify(report, null, 2));
  }
}
