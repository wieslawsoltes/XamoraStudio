import type { EditorTextEdit } from './text-search.js';
import type { EditorSearch } from './editor-search.js';
import type { EditorVirtualizationOptions, EditorViewportState } from './code-viewport.js';
export interface CodeCompletion {
  label: string;
  detail?: string;
  insertText: string;
  start: number;
  end: number;
  caretOffset?: number;
}
export interface CodeToken {
  text: string;
  kind?: 'comment' | 'string' | 'tag' | 'attr' | 'keyword' | 'number';
}
/** Provider methods are synchronous and must not modify the live editor. */
export interface CodeLanguageProvider {
  validate?(source: string): void | boolean | string;
  format?(source: string): string;
  tokenize?(source: string): CodeToken[];
  complete?(source: string, caret: number, context: Record<string, unknown>): CodeCompletion[];
  indent?(beforeCaret: string): string;
  toggleComment?(selectedLines: string): string;
}
export interface CodeSelection {
  start: number;
  end: number;
}
export interface CodeEditorOptions {
  language?: string;
  languageProvider?: CodeLanguageProvider;
  readOnly?: boolean;
  /** Default: virtualize at 1000 logical lines, with eight overscan lines. */
  virtualization?: boolean | EditorVirtualizationOptions;
  onApply?: (source: string) => void | boolean;
  onSelection?: (selection: CodeSelection) => void;
  onChange?: (source: string, options: { defer: boolean; composing: boolean }) => void;
  /** Synchronous document-owner hook. Return true only after committing the full batch
   * and updating this surface through setValue. false never falls back to local editing. */
  onTextEdits?: (edits: readonly EditorTextEdit[], expectedValue: string) => boolean;
}
export declare class CodeEditor {
  constructor(host: HTMLElement, options?: CodeEditorOptions);
  readonly host: HTMLElement;
  readonly input: HTMLTextAreaElement;
  readonly highlight: HTMLPreElement;
  readonly lines: HTMLElement;
  readonly message: HTMLElement;
  readonly completions: HTMLElement;
  language: string;
  dirty: boolean;
  composing: boolean;
  disposed: boolean;
  onApply?: CodeEditorOptions['onApply'];
  onSelection?: CodeEditorOptions['onSelection'];
  onChange?: CodeEditorOptions['onChange'];
  onTextEdits?: CodeEditorOptions['onTextEdits'];
  readonly search: EditorSearch;
  onValidate?: () => boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onSemanticCommand?: (command: string) => void;
  getLanguageContext?: () => Record<string, unknown>;
  getCompletions?: (
    source: string,
    caret: number,
    context: Record<string, unknown>,
  ) => CodeCompletion[];
  getLanguageProvider(): CodeLanguageProvider;
  setLanguageProvider(provider?: CodeLanguageProvider, language?: string): void;
  setLanguage(language?: string): void;
  getValue(): string;
  setValue(value: string, options?: { force?: boolean; preserveHistory?: boolean }): boolean;
  setReadOnly(value: boolean): void;
  focus(): void;
  changed(options?: { defer?: boolean; composing?: boolean }): void;
  readonly viewport: EditorViewportState;
  setVirtualization(value?: boolean | EditorVirtualizationOptions): void;
  refreshLayout(): void;
  paint(): void;
  cursor(notify?: boolean): void;
  validate(): boolean;
  apply(): boolean;
  format(): void | boolean;
  find(options?: { replace?: boolean; seed?: boolean }): boolean;
  findNext(backwards?: boolean): boolean;
  setSearchContext(key: unknown): void;
  applyTextEdits(edits: readonly EditorTextEdit[], options?: { expectedValue?: string }): boolean;
  complete(): void;
  hideCompletions(): void;
  reveal(index: number): void;
  revealName(name: string): void;
  undoBuffer(): boolean;
  redoBuffer(): boolean;
  keydown(event: KeyboardEvent): void;
  dispose(): void;
}
export declare function mapTextSelection(
  before: string,
  after: string,
  start: number,
  end?: number,
): CodeSelection;
