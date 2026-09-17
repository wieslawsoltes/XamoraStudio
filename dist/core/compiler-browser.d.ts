import type { CssEnvironment } from './compiler-environment.js';
import type { DesignDocument } from './index.js';
import type { CompilerOptions, CompilerResult } from './semantic-compiler.js';
export interface RenderedCompilerOptions extends CompilerOptions {
  /** Default 10000; maximum 15000. */
  maxRenderedNodes?: number;
  /** Defaults to false. Opt in only after obtaining consent to export live password values. */
  includePasswordValues?: boolean;
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

export interface ResponsiveCompilerVariant extends CssEnvironment {
  /** Unique portable identifier: starts with a letter, followed by up to 63 letters/digits/_/-. */
  name: string;
  /** Viewport dimensions in CSS pixels, greater than zero and at most 100000. */
  width: number;
  height: number;
}
export interface ResponsiveCompilerOptions extends CompilerOptions {
  /** One to 32 point-in-time environments, validated before any compilation hooks run. */
  variants: readonly ResponsiveCompilerVariant[];
}
export interface ResponsiveCompilerResult {
  version: 1;
  success: boolean;
  profiles: { name: string; environment: CssEnvironment; result: CompilerResult }[];
}
/** Synchronous semantic HTML-to-XAML profiles, not autonomous native responsive behavior. */
export declare function compileResponsiveVariants(
  input: string | DesignDocument,
  options: ResponsiveCompilerOptions,
): ResponsiveCompilerResult;
