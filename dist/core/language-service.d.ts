import type { DocumentSession } from './document-session.js';
export interface SemanticLocation {
  nodeId: string;
  kind: 'element' | 'resource' | 'html-id';
  name: string;
  start: number;
  end: number;
  line: number;
  column: number;
  scopeId: string;
  declaration?: boolean;
  id?: string;
  renamable?: boolean;
  type?: string;
  selectionRange?: { start: number; end: number };
  dynamic?: boolean;
  unsupported?: string;
}
export interface SemanticDiagnostic extends SemanticLocation {
  severity: 'warning' | 'error';
  code: string;
  message: string;
}
export interface SemanticCompletion {
  label: string;
  detail: string;
  start: number;
  end: number;
  insertText: string;
  caretOffset?: number;
}
/** Local literal markup references only. Native runtime lookup, dynamic scripts and external files are not analyzed. */
export class SemanticLanguageService {
  constructor(
    session: DocumentSession,
    options?: {
      registry?: { get(type: string): any; list(): any[] };
      context?: Record<string, unknown>;
    },
  );
  readonly session: DocumentSession;
  symbols(): SemanticLocation[];
  definitionAt(offset: number): SemanticLocation[];
  referencesAt(offset: number, options?: { includeDeclaration?: boolean }): SemanticLocation[];
  rename(
    offset: number,
    newName: string,
    options?: { expectedRevision?: number },
  ): { count: number; revision: number; declaration?: SemanticLocation };
  diagnostics(): SemanticDiagnostic[];
  completions(
    source: string,
    offset: number,
    context?: Record<string, unknown>,
  ): SemanticCompletion[];
}
