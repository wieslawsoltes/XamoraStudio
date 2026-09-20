import type { DesignDocument, DesignNode, DocumentStore, Framework } from './index.js';
import type { SourceTextBuffer, SourceTextEdit } from './source-text-buffer.js';

export interface SourceDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  code?: string;
  line?: number;
  column?: number;
  start?: number;
  end?: number;
}
export interface SourceAttributeRange {
  name: string;
  fullStart: number;
  start: number;
  nameEnd: number;
  end: number;
  quote?: string;
  valueStart?: number;
  valueEnd?: number;
}
export interface SourceRange {
  nodeId: string;
  kind: string;
  start: number;
  end: number;
  line: number;
  column: number;
  type?: string;
  openEnd?: number;
  closeStart?: number;
  attrs?: SourceAttributeRange[];
  synthetic?: boolean;
}
export interface SourceSnapshot {
  version: 1;
  language: 'XAML' | 'HTML';
  text: string;
  validText: string;
  diagnostics: SourceDiagnostic[];
}
export interface SourceAdapter {
  parse(source: string, options?: { name?: string; framework?: Framework }): DesignDocument;
  serialize(document: DesignDocument): string;
  serializeNode?(node: DesignNode, parentType?: string): string;
}
export interface SourceUpdateResult {
  accepted: boolean;
  valid: boolean;
  revision: number;
  diagnostics: SourceDiagnostic[];
}
export interface SourceChange {
  origin: string;
  revision: number;
  source: string;
  valid: boolean;
  diagnostics: SourceDiagnostic[];
}
export interface SourceProcessingStats {
  fullParses: number;
  localParses: number;
  fullScans: number;
  localScans: number;
  /** UTF-16 units supplied to the semantic parser and lexical scanner. */
  charactersParsed: number;
  charactersScanned: number;
  incrementalUpdates: number;
  fullUpdates: number;
}
export interface SourceProcessingUpdate {
  mode: 'initial' | 'full' | 'incremental-attribute' | 'incremental-text' | 'incremental-invalid';
  reason: string;
  input?: 'range' | 'snapshot';
  charactersParsed?: number;
  charactersScanned?: number;
  range?: { start: number; oldEnd: number; newEnd: number } | null;
}
export declare const sourceAdapters: Record<'XAML' | 'HTML', SourceAdapter>;
/** Reconciles stable IDs in next in place without changing its semantic contents. */
export declare function reconcileDocumentIds(
  previous: DesignDocument,
  next: DesignDocument,
): DesignDocument;
/** Exact source patches; ambiguous browser-repaired structures fail atomically. */
export declare function patchDocumentSource(
  source: string,
  before: DesignDocument,
  after: DesignDocument,
  options?: { adapter?: SourceAdapter; index?: unknown },
): string;
export declare class DocumentSession extends EventTarget {
  readonly disposed: boolean;
  constructor(
    store: DocumentStore,
    options?: { source?: string; adapters?: Record<string, SourceAdapter>; incremental?: boolean },
  );
  readonly store: DocumentStore;
  readonly language: 'XAML' | 'HTML';
  readonly source: string;
  readonly validSource: string;
  readonly isValid: boolean;
  readonly diagnostics: SourceDiagnostic[];
  readonly revision: number;
  readonly buffer: SourceTextBuffer;
  readonly processingStats: SourceProcessingStats;
  readonly lastUpdate: SourceProcessingUpdate;
  updateSource(
    text: string,
    options?: { origin?: string; expectedRevision?: number },
  ): SourceUpdateResult;
  /** One atomic transaction; offsets refer to the same original source snapshot. */
  applySourceEdits(
    edits: SourceTextEdit[],
    options?: { origin?: string; expectedRevision?: number; expectedVersion?: number },
  ): SourceUpdateResult;
  discardDraft(): boolean;
  serialize(options?: { draft?: boolean }): string;
  /** Canonical current range; DesignNode.source remains an import-time compatibility hint. */
  sourceAtNode(id: string): SourceRange | null;
  nodeAtOffset(offset: number): DesignNode | null;
  undo(): void;
  redo(): void;
  refresh(options?: { emit?: boolean }): this;
  dispose(): void;
}
