import type { DesignDocument } from './index.js';
import type { CompilerOptions, CompilerResult } from './semantic-compiler.js';
export interface AsyncCompilerOptions extends CompilerOptions {
  loadStylesheet?: (
    url: string,
    context: { signal: AbortSignal; nodeId: string },
  ) => string | undefined | Promise<string | undefined>;
  signal?: AbortSignal;
  /** Leave absent resources unresolved so compileDocument can report EXTERNAL_CSS. Exceptions still reject. */
  allowMissingStylesheets?: boolean;
  /** Per-resource deadline, default 15000 ms, maximum 120000. */
  stylesheetTimeout?: number;
}
/** Throws for missing resources, cancellation, deadlines and limits. No global fetch or filesystem access. */
export declare function preloadCompilerStylesheets(
  input: string | DesignDocument,
  options: AsyncCompilerOptions & Required<Pick<AsyncCompilerOptions, 'loadStylesheet'>>,
): Promise<Map<string, string>>;
export declare function compileDocumentAsync(
  input: string | DesignDocument,
  options?: AsyncCompilerOptions,
): Promise<CompilerResult>;
