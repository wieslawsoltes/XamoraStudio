/** UTF-16 offsets against the original source snapshot. */
export interface SourceTextEdit { start: number; end: number; text: string; }
export interface SourceTextPosition { line: number; column: number; }
export interface SourceTextBufferStats {
  /** Code units scanned for line endings; excludes prefix/suffix comparison. */
  charsScanned: number;
  updates: number;
  fullResets: number;
  diffCharsCompared: number;
  offsetsShifted: number;
}
export interface SourceTextEditResult {
  accepted: boolean;
  changed: boolean;
  version: number;
  edits: SourceTextEdit[];
  changedRange: {start: number; oldEnd: number; newEnd: number} | null;
  reason?: 'version-conflict' | 'invalid-edit' | 'overlapping-edits' | 'version-exhausted';
  error?: string;
}
/**
 * Immutable-string storage with an incremental sorted line index, not a rope.
 * Replacement copies the string and shifts following offsets; line-ending
 * scanning only visits edited text and its immediate boundaries.
 */
export declare class SourceTextBuffer {
  constructor(text?: string, options?: {version?: number});
  readonly text: string;
  readonly version: number;
  readonly length: number;
  readonly lineCount: number;
  /** Defensive copies: modifying these values does not mutate the buffer. */
  readonly lineStarts: number[];
  readonly stats: SourceTextBufferStats;
  fork(): SourceTextBuffer;
  /** One-based line/column, counting UTF-16 units including newline characters. */
  positionAt(offset: number): SourceTextPosition;
  /** Clamps to the last offset belonging to the requested line. */
  offsetAt(position?: Partial<SourceTextPosition>): number;
  /** Atomically applies original-snapshot ranges, independent of input order. */
  applyEdits(edits: readonly SourceTextEdit[], options?: {expectedVersion?: number}): SourceTextEditResult;
  replace(text: string, options?: {expectedVersion?: number}): SourceTextEditResult;
}
export declare function computeSourceEdit(before: string, after: string): SourceTextEdit | null;
