import type { DesignNode } from './index.js';
import type { CompilerDiagnostic } from './semantic-compiler.js';
/** Mutates this output node, optionally returning a native Border wrapper. */
export declare function lowerNativeHtmlNode(
  node: DesignNode,
  css: Record<string, string>,
  framework: 'WPF' | 'Avalonia',
  report: (
    severity: CompilerDiagnostic['severity'],
    code: string,
    message: string,
    loss: boolean,
  ) => unknown,
): DesignNode;
