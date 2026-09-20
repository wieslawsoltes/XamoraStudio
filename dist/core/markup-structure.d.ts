import type { DocumentSession } from './document-session.js';
export interface MarkupStructureEntry {
  readonly id: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly label: string;
  readonly detail: string;
  readonly kind: 'element' | 'property' | 'resource';
  readonly namespaceURI: string;
  readonly synthetic: boolean;
  readonly range: Readonly<{ start: number; end: number; line: number; column: number }> | null;
  readonly start: number | null;
  readonly end: number | null;
}
export type MarkupRelation = 'parent' | 'first-child' | 'previous-sibling' | 'next-sibling';
/** Queries return no stale locations while source is invalid or the session is disposed. */
export class MarkupStructureIndex {
  constructor(session: DocumentSession);
  readonly builds: number;
  readonly disposed: boolean;
  entries(): readonly MarkupStructureEntry[];
  get(id: string): MarkupStructureEntry | null;
  at(offset: number): MarkupStructureEntry | null;
  path(id: string): readonly MarkupStructureEntry[];
  related(id: string, relation: MarkupRelation): MarkupStructureEntry | null;
  designerId(id: string): string | null;
  dispose(): void;
}
