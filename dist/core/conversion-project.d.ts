import type { DesignDocument } from './index.js';
import type { CompilerOptions } from './semantic-compiler.js';
export interface ProjectConversionInput {
  id?: string;
  path: string;
  source?: string;
  document?: DesignDocument;
  framework?: string;
  diagnostics?: Array<{ severity: string; message: string }>;
}
export interface ProjectConversionOptions extends Omit<CompilerOptions, 'Parser' | 'plugins'> {
  to?: 'html' | 'xaml';
  framework?: 'WPF' | 'Avalonia';
  scope?: 'document' | 'folder' | 'solution';
  documentId?: string;
  documentPath?: string;
  folder?: string;
  outputFolder?: string;
  collision?: 'rename' | 'skip' | 'error';
  preserveMetadata?: boolean;
  strict?: boolean;
  existingPaths?: string[];
  existingFolders?: string[];
  Parser?: unknown;
  plugins?: unknown[];
}
export interface ProjectConversionEntry {
  id?: string;
  sourcePath: string;
  targetPath: string | null;
  from?: 'html' | 'xaml';
  to?: 'html' | 'xaml';
  status: 'ready' | 'failed' | 'skipped';
  source?: string;
  diagnostics: Array<{ severity: string; code?: string; message: string; [key: string]: unknown }>;
  result?: {
    success: boolean;
    source: string;
    document: DesignDocument;
    diagnostics: unknown[];
    sourceMap: unknown[];
    losses: unknown[];
    metadata: unknown;
  };
}
export interface ProjectConversionPlan {
  version: 1;
  options: ProjectConversionOptions;
  entries: ProjectConversionEntry[];
  summary: {
    total: number;
    ready: number;
    failed: number;
    skipped: number;
    diagnostics: number;
    losses: number;
  };
}
export function planProjectConversion(
  inputs: ProjectConversionInput[],
  options?: ProjectConversionOptions,
  compiler?: Function,
): ProjectConversionPlan;
