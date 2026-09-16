import type { DesignDocument, DesignNode } from './index.js';
import type { CompilerOptions } from './semantic-compiler.js';
export declare function compilerStylesheetUrl(href: string, baseUrl?: string): string;
export declare function parseCompilerCssImport(
  source: string,
): { href: string; layer: string | null; supports: string | null; media: string } | null;
export declare function rebaseCompilerCssUrls(source: string, baseUrl: string): string;
/** Low-level mutable compiler context. Prefer compileDocument for application use. */
export declare function collectCompilerCss(context: {
  input: DesignDocument;
  options: CompilerOptions;
  cssRules: unknown[];
  report(
    severity: string,
    code: string,
    message: string,
    node: DesignNode,
    loss?: boolean,
  ): unknown;
  [key: string]: unknown;
}): void;
