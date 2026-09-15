export interface CliOptions {
  input?: string;
  from: 'auto' | 'xaml' | 'html';
  to?: 'xaml' | 'html';
  framework: 'WPF' | 'Avalonia';
  outDir?: string;
  preserveMetadata: boolean;
  strict: boolean;
  dryRun: boolean;
  solution: boolean;
  report?: string;
  help?: boolean;
}
export interface ConversionInput {
  id: string;
  path: string;
  source?: string;
  document?: object;
  framework: string;
}
export const HELP: string;
export function parseArguments(argv: string[]): CliOptions;
export function collectConversionEntries(input: string, options?: {
  cwd?: string;
  from?: 'auto' | 'xaml' | 'html';
  solution?: boolean;
  outDir?: string;
}): Promise<{entries: ConversionInput[]; skipped: {path: string; reason: string}[]; root: string}>;
export function runCli(argv: string[], environment?: {
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  planner?: (entries: ConversionInput[], options: object) => {
    entries: Array<{sourcePath: string; targetPath?: string; status: string; source?: string; result?: {source?: string; diagnostics?: object[]; losses?: object[]; sourceMap?: object[]}; diagnostics?: object[]}>;
    summary: {ready?: number; failed?: number; skipped?: number; diagnostics?: number; losses?: number};
  };
  Parser?: typeof DOMParser;
}): Promise<0 | 1 | 2>;
