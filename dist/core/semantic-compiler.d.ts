import type { DesignDocument, DesignNode } from './index.js';

export declare const SEMANTIC_COMPILER_VERSION: 1;
export declare const WEB_NAMESPACE: 'urn:xamora:web';
export type CompilerLanguage = 'xaml' | 'html';
export interface CompilerRange {
  start: number;
  end: number;
  line?: number;
  column?: number;
}
export interface CompilerDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  nodeId?: string;
  sourceRange?: CompilerRange;
  line?: number;
  column?: number;
}
export interface CompilerSourceMap {
  sourceNodeId: string;
  targetNodeId: string;
  sourceRange?: CompilerRange;
  targetRange?: CompilerRange;
}
export interface CompilerPluginContext {
  document: DesignDocument;
  framework: 'WPF' | 'Avalonia';
  report(
    severity: CompilerDiagnostic['severity'],
    code: string,
    message: string,
    loss?: boolean,
  ): CompilerDiagnostic;
}
export interface SemanticCompilerPlugin {
  name?: string;
  /** Return a shared AST node to claim this conversion, or null to use built-in mappings. */
  xamlToHtml?(node: DesignNode, context: CompilerPluginContext): DesignNode | null | undefined;
  htmlToXaml?(node: DesignNode, context: CompilerPluginContext): DesignNode | null | undefined;
}
export interface CompilerEnvironment {
  type?: 'screen' | 'print' | 'speech';
  width?: number;
  height?: number;
  /** Initial font size used for media-query em/rem units, not the element font size. */
  fontSize?: number;
  resolution?: number;
  colorScheme?: 'light' | 'dark';
  reducedMotion?: 'reduce' | 'no-preference';
  pointer?: 'none' | 'fine' | 'coarse';
  hover?: 'none' | 'hover';
  anyPointer?: 'none' | 'fine' | 'coarse';
  anyHover?: 'none' | 'hover';
  forcedColors?: 'none' | 'active';
  features?: Record<string, string | number | boolean>;
}
export type CompilerSupports =
  Record<string, boolean> | ((condition: string) => boolean | null | undefined);
export interface CompilerOptions {
  /** Explicit environment. Absent/unknown conditions diagnose a loss rather than guessing. */
  environment?: CompilerEnvironment;
  supports?: CompilerSupports;
  evaluateCondition?: (
    kind: 'media' | 'supports' | 'container',
    query: string,
    node: DesignNode,
  ) => boolean | null | undefined;
  /** Pseudo-state names to HTML IDs/shared AST IDs. Never reads ambient browser interaction. */
  selectorState?: Record<string, readonly string[]>;
  /** Supplied UTF-8 stylesheet text keyed by canonical URL or authored href. Never fetched. */
  stylesheets?: ReadonlyMap<string, string> | Record<string, string>;
  baseUrl?: string;
  /** Emit native property/layout adapters. Also defaults preserveMetadata to false. */
  nativeOutput?: boolean;
  from?: CompilerLanguage;
  to?: CompilerLanguage;
  framework?: 'WPF' | 'Avalonia';
  /** Generated document name. */
  name?: string;
  /** Name used when importing source text. */
  sourceName?: string;
  /** Defaults to !nativeOutput. Preserves source-only authoring semantics as inert metadata. */
  preserveMetadata?: boolean;
  /** Reject any conversion carrying a behavioral loss. Preview output remains available. */
  strict?: boolean;
  /** Explicitly restore authored HTML scripts, handlers and active embedded documents. */
  allowScripts?: boolean;
  /** Required for HTML source in Node. Browser callers use the native DOMParser. */
  Parser?: new () => { parseFromString(source: string, type: 'text/html'): unknown };
  plugins?: SemanticCompilerPlugin[];
  resolveSource?: (
    source: string,
    node: DesignNode,
  ) => DesignDocument | DesignNode | null | undefined;
}
export interface CompilerResult {
  success: boolean;
  source: string;
  document: DesignDocument | null;
  diagnostics: CompilerDiagnostic[];
  sourceMap: CompilerSourceMap[];
  losses: CompilerDiagnostic[];
  metadata: {
    version: 1;
    from: CompilerLanguage;
    to: CompilerLanguage;
    preserved: boolean;
    sourceNodeCount?: number;
    targetNodeCount?: number;
    stylesheetDependencies?: string[];
    environment?: CompilerEnvironment;
    browserCapture?: {
      viewport: { width: number; height: number };
      root: { x: number; y: number; width: number; height: number };
      mode: 'measured';
      live: false;
    };
    geometry?: Array<{
      sourceElementId: string | null;
      targetNodeId: string;
      targetName: string | null;
      rect: { x: number; y: number; width: number; height: number };
    }>;
  };
}
/** Synchronous and side-effect free; no input mutation, resource fetching, or code execution. */
export declare function compileDocument(
  source: string | DesignDocument,
  options?: CompilerOptions,
): CompilerResult;
export interface CompiledInteractionContext {
  data: Record<string, unknown>;
  element: Element;
  refresh(): void;
}
export interface CompiledInteractionOptions {
  data?: Record<string, unknown>;
  handlers?: Record<string, (event: Event, context: CompiledInteractionContext) => void>;
  onChange?: (data: Record<string, unknown>) => void;
}
/** Connect only named application callbacks and simple Binding paths; never evaluates source. */
export declare function attachCompiledInteractions(
  root: Element,
  options?: CompiledInteractionOptions,
): {
  refresh(): void;
  dispose(): void;
};
