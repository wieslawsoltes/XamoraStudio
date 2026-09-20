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
 * Review before apply. Plans are immutable, single-use and owned by this service.
 * This is not native property API migration or exhaustive content-model validation.
 */
export declare class MarkupRefactorService {
  constructor(
    session: DocumentSession,
    options?: { registry?: { get(type: string, namespace?: string): any } },
  );
  readonly session: DocumentSession;
  readonly disposed: boolean;
  /** UTF-16 tag-name ranges; never fabricated for invalid drafts or implicit tags. */
  linkedTagRanges(offset: number): Omit<MarkupRange, 'kind'>[];
  /** A target is an authored AST ID or a UTF-16 offset inside that element. */
  prepareRename(target: string | number, name: string): MarkupRefactorPlan;
  /** Consecutive siblings; intervening text/comments move with the elements. */
  prepareWrap(targets: string | number | (string | number)[], wrapper: string): MarkupRefactorPlan;
  prepareUnwrap(target: string | number): MarkupRefactorPlan;
  apply(plan: MarkupRefactorPlan): { changed: boolean; revision: number; selectedId: string };
  /** Invalidates all outstanding proposals. */
  dispose(): void;
}
