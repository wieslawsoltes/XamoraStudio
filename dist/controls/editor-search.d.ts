import type { CodeEditor } from './code-editor.js';
import type { TextSearchIndex } from './text-search.js';
/** Usually obtained through CodeEditor.search. All UI offsets use textarea-normalized text. */
export declare class EditorSearch {
  constructor(editor: CodeEditor, host: HTMLElement);
  readonly host: HTMLElement;
  readonly query: HTMLInputElement;
  readonly replacement: HTMLInputElement;
  readonly status: HTMLElement;
  readonly model: TextSearchIndex | null;
  readonly disposed: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  setContext(key: unknown): void;
  setReplaceVisible(value: boolean): void;
  open(options?: { replace?: boolean; seed?: boolean }): boolean;
  close(): void;
  refresh(paint?: boolean): void;
  move(backwards?: boolean, options?: { focus?: boolean }): boolean;
  replace(all?: boolean): boolean;
  dispose(): void;
}
