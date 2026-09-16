import type { DesignDocument, DesignNode } from './index.js';
import type {
  CompilerOptions,
  CompilerEnvironment,
  CompilerSupports,
  CompilerDiagnostic,
} from './semantic-compiler.js';
export declare function cssClosing(source: string, start: number): number;
export declare function evaluateMediaQuery(
  query: string,
  environment?: CompilerEnvironment,
): boolean | null;
export declare function evaluateSupportsCondition(
  condition: string,
  supports?: CompilerSupports,
): boolean | null;
export declare function stylesheetUrl(href: string, baseUrl?: string): string;
export declare function parseStylesheetImport(
  raw: string,
): { href: string; media: string; layer: string | null; supports: string | null } | null;
export interface CompilerCssRule {
  header: string;
  values: Array<[string, string]>;
  conditions: Array<{ kind: 'media' | 'supports' | 'container'; query: string }>;
  layer: { order: number; children: Map<string, unknown> };
  node: DesignNode;
}
export declare function collectCompilerCss(
  input: DesignDocument,
  options: CompilerOptions,
  report: (
    severity: CompilerDiagnostic['severity'],
    code: string,
    message: string,
    node: DesignNode,
    loss: boolean,
  ) => unknown,
): { rules: CompilerCssRule[]; dependencies: string[]; baseUrl: string };
export declare function matchesCssConditions(
  rule: CompilerCssRule,
  options: CompilerOptions,
  node: DesignNode,
): boolean | null;
