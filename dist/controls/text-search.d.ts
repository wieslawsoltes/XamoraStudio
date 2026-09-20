export interface EditorTextEdit {
  start: number;
  end: number;
  text: string;
}
export interface TextSearchRange {
  readonly start: number;
  readonly end: number;
}
export interface TextSearchOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  range?: TextSearchRange;
  maxMatches?: number;
}
/** Literal Unicode-simple-fold search; ranges refer to the unmodified UTF-16 snapshot. */
export declare class TextSearchIndex {
  constructor(source: string, query: string, options?: TextSearchOptions);
  readonly source: string;
  readonly query: string;
  readonly range: TextSearchRange;
  readonly matches: readonly TextSearchRange[];
  readonly truncated: boolean;
  selected(start: number, end?: number): number;
  next(
    start: number,
    end?: number,
    backwards?: boolean,
  ): (TextSearchRange & { index: number; wrapped: boolean }) | null;
  replacement(
    value: string,
    index?: number,
  ): { text: string; edits: EditorTextEdit[]; count: number };
}
export declare function applyEditorTextEdits(
  source: string,
  edits: readonly EditorTextEdit[],
): string;
