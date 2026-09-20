import type { DocumentSession } from './document-session.js';
import type { MarkupRange } from './language-service.js';
export type MarkupRefactorKind = 'rename' | 'wrap' | 'unwrap';
export interface MarkupRefactorPlan {
  readonly kind: MarkupRefactorKind;
  readonly title: string;
  readonly before: string;
  readonly after: string;
  readonly selectedId: string;
  readonly affectedNodeIds: readonly string[];
  readonly warnings: readonly string[];
  readonly revision: number;
  readonly documentId: string;
}
/** AST-first plans preflight concrete source, semantic structure and namespaces.
 * Review a plan before apply. Plans are immutable, single-use and owned by this service.
 * This is not full native control/property API migration or an HTML content-model validator.
 */
export declare class MarkupRefactorService {
  constructor(
    session: DocumentSession,
    options?: { registry?: { get(type: string, namespace?: string): any } },
  );
  readonly session: DocumentSession;
  /** UTF-16 tag-name ranges only; never fabricated for an invalid draft or implicit HTML tag. */
  linkedTagRanges(offset: number): Omit<MarkupRange, 'kind'>[];
  /** A target is an authored AST node ID or a UTF-16 caret offset inside that element. */
  prepareRename(target: string | number, name: string): MarkupRefactorPlan;
  /** Multiple targets must be consecutive siblings; intervening text/comments move with them. */
  prepareWrap(targets: string | number | (string | number)[], wrapper: string): MarkupRefactorPlan;
  prepareUnwrap(target: string | number): MarkupRefactorPlan;
  apply(plan: MarkupRefactorPlan): { changed: boolean; revision: number; selectedId: string };
}
