import type {DesignDocument,DesignNode,DocumentStore,Framework} from './index.js';

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
  parse(source: string, options?: {name?: string; framework?: Framework}): DesignDocument;
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
export declare const sourceAdapters: Record<'XAML' | 'HTML',SourceAdapter>;
/** Reconciles stable IDs in next in place without changing its semantic contents. */
export declare function reconcileDocumentIds(previous: DesignDocument, next: DesignDocument): DesignDocument;
/** Exact source patches; ambiguous browser-repaired structures fail atomically. */
export declare function patchDocumentSource(source: string, before: DesignDocument, after: DesignDocument, options?: {adapter?: SourceAdapter; index?: unknown}): string;
export declare class DocumentSession extends EventTarget {
  constructor(store: DocumentStore, options?: {source?: string; adapters?: Record<string,SourceAdapter>});
  readonly store: DocumentStore;
  readonly language: 'XAML' | 'HTML';
  readonly source: string;
  readonly validSource: string;
  readonly isValid: boolean;
  readonly diagnostics: SourceDiagnostic[];
  readonly revision: number;
  updateSource(text: string, options?: {origin?: string; expectedRevision?: number}): SourceUpdateResult;
  discardDraft(): boolean;
  serialize(options?: {draft?: boolean}): string;
  sourceAtNode(id: string): SourceRange | null;
  nodeAtOffset(offset: number): DesignNode | null;
  undo(): void;
  redo(): void;
  refresh(options?: {emit?: boolean}): this;
  dispose(): void;
}
