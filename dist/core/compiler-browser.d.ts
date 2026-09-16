import type { DesignDocument } from './index.js';
import type { CompilerOptions, CompilerResult, CompilerEnvironment } from './semantic-compiler.js';
export interface BrowserCompilerOptions {
  framework?: 'WPF' | 'Avalonia';
  name?: string;
  strict?: boolean;
  /** Between 1 and 50,000; default 10,000. */
  maxNodes?: number;
  /** Password values are omitted unless explicitly enabled. */
  includePasswordValues?: boolean;
}
/** Read a connected DOM tree at its current layout/state. Does not run/load source. */
export declare function compileRenderedDocument(
  root: Element | Document,
  options?: BrowserCompilerOptions,
): CompilerResult;
export interface RenderedDocumentObserverOptions extends BrowserCompilerOptions {
  onResult(result: CompilerResult): void;
  onError?(error: unknown): void;
  mediaQueries?: string[];
}
/** Frame-coalesced DOM/layout/state observation. Dispose detaches all observers and listeners. */
export declare function observeRenderedDocument(
  root: Element | Document,
  options: RenderedDocumentObserverOptions,
): {
  refresh(): CompilerResult | null;
  dispose(): void;
};
export interface ResponsiveCompilerVariant extends CompilerEnvironment {
  name: string;
  width: number;
  height: number;
}
export declare function compileResponsiveVariants(
  input: string | DesignDocument,
  options: CompilerOptions & { variants: ResponsiveCompilerVariant[] },
): {
  version: 1;
  success: boolean;
  profiles: Array<{ name: string; environment: CompilerEnvironment; result: CompilerResult }>;
};
