export interface EditorVirtualizationOptions {
  threshold?: number;
  overscan?: number;
}
export interface EditorVisibleRange {
  startLine: number;
  endLine: number;
  start: number;
  end: number;
}
export interface EditorViewportState {
  virtualized: boolean;
  lineCount: number;
  startLine: number;
  endLine: number;
  renderedLines: number;
}
export class EditorLineIndex {
  constructor(source?: string);
  readonly source: string;
  readonly starts: Uint32Array;
  readonly length: number;
  /** Returns a zero-based logical line for a UTF-16 source offset. */
  lineAt(offset: number): number;
  offsetAt(line: number): number;
  visibleRange(
    scrollTop: number,
    height: number,
    lineHeight: number,
    overscan?: number,
  ): EditorVisibleRange;
}
export interface IndexedEditorToken {
  start: number;
  end: number;
  kind?: 'comment' | 'string' | 'tag' | 'attr' | 'keyword' | 'number';
}
export function indexEditorTokens(
  source: string,
  provider?: { tokenize?(source: string): { text: string; kind?: string }[] },
): IndexedEditorToken[] | null;
export function renderEditorTokens(
  source: string,
  tokens: IndexedEditorToken[] | null,
  start?: number,
  end?: number,
  matches?: readonly { start: number; end: number }[],
): string;
export function editorVirtualization(options?: boolean | EditorVirtualizationOptions): {
  threshold: number;
  overscan: number;
};
