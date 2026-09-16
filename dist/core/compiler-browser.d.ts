import type { CompilerOptions, CompilerResult } from './semantic-compiler.js';
export interface RenderedCompilerOptions extends CompilerOptions {
  /** Default 10000; maximum 15000. */
  maxRenderedNodes?: number;
}
/** Capture a caller-owned connected DOM. No navigation, source execution or implicit resource loading. */
export declare function compileRenderedDocument(
  root: Element,
  options?: RenderedCompilerOptions,
): CompilerResult;
export interface RenderedCompilerObserverOptions extends RenderedCompilerOptions {
  onResult(result: CompilerResult, revision: number): void;
  onError?(error: unknown): void;
  /** Additional media feature listeners. Call refresh after CSSOM-only edits or custom animation sampling. */
  observeMedia?: string[];
}
export declare function observeRenderedDocument(
  root: Element,
  options: RenderedCompilerObserverOptions,
): {
  refresh(): CompilerResult | null;
  schedule(): void;
  dispose(): void;
  readonly revision: number;
};
