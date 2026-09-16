import type { DesignDocument, DesignNode } from './index.js';
export interface CssSelectorPlan {
  readonly parts: readonly (readonly unknown[])[];
  readonly combinators: readonly string[];
  readonly specificity: readonly number[];
  readonly states: readonly string[];
}
export type CssPseudoStates =
  | Record<string, readonly string[] | Record<string, boolean>>
  | Map<string, readonly string[] | Record<string, boolean>>;
export interface CssSelectorContext {
  input: DesignDocument;
  parents: Map<string, DesignNode>;
  previousElements: Map<string, DesignNode>;
  options?: { pseudoStates?: CssPseudoStates; targetId?: string; maxSelectorSteps?: number };
  selectorSteps?: number;
}
export declare function compileCssSelector(
  source: string,
  depth?: number,
  inHas?: boolean,
): CssSelectorPlan | null;
export declare function matchesCssSelector(
  node: DesignNode,
  plan: CssSelectorPlan | null,
  context: CssSelectorContext,
  scope?: DesignNode,
): boolean;
