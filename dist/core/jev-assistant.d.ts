import type { DesignDocument, ToolkitRegistry } from './index.js';
import type {
  JevSettings,
  JevCredentials,
  JevClient,
  JevRequest,
  JevResponse,
} from './jev-client.js';
export type JevScope = 'selection' | 'document' | 'application';
export interface JevSnapshot {
  document: DesignDocument;
  source: string;
  revision: number;
  selection: string[];
  scope: JevScope;
  appStamp?: string;
  appContext?: Record<string, unknown>;
  commands?: Array<{ id: string; label: string; enabled?: boolean }>;
  panels?: Array<{ id: string; label: string }>;
  documents?: Array<{ id: string; name: string }>;
}
export interface JevRequestPreview {
  request: JevRequest;
  bytes: number;
  stateAndLargestQuestionBytes: number;
  estimatedTokens: number;
  omitted: string[];
}
export interface GeneratorRequestPreview {
  request: unknown;
  bytes: number;
  generator: true;
  omitted: string[];
}
export interface JevOperation {
  type: string;
  label: string;
  target?: string;
  value?: string;
  property?: string;
}
export interface JevPlan {
  id: string;
  documentId: string;
  revision: number;
  originalSource: string;
  source: string;
  selection: string[];
  scope: JevScope;
  appStamp?: string;
  operations: JevOperation[];
  requests: Array<JevRequestPreview & Partial<JevResponse>>;
  models: string[];
  usage: { input_tokens: number; output_tokens: number };
  createdDocument: DesignDocument | null;
  appAction: {
    type: 'command' | 'show_panel' | 'open_document' | 'select_node';
    id: string;
  } | null;
  complete: boolean;
  stopped: string;
  confidence: number;
  probability: number;
  repair?: boolean;
  generator?: { endpoint: string; model: string; verifiedProbability: number };
}
export interface JevPlanOptions {
  signal?: AbortSignal;
  onRequest?: (preview: JevRequestPreview | GeneratorRequestPreview) => void;
  onProgress?: (message: string) => void;
}
export declare const JEV_COMMAND_IDS: readonly string[];
export declare function redactJevContext(value: unknown, secrets?: string[]): any;
export declare function fitJevRequest(
  model: string,
  state: object,
  questions: JevRequest['questions'],
  budget: number,
  secrets?: string[],
): JevRequestPreview;
export declare function jevLiteralCandidates(prompt: string, extra?: string[]): string[];
export declare class JevAssistant {
  constructor(options: {
    settings?: Partial<JevSettings>;
    credentials?: JevCredentials;
    registry: ToolkitRegistry;
    client?: Pick<JevClient, 'evaluate'>;
    fetch?: typeof globalThis.fetch;
  });
  readonly settings: JevSettings;
  plan(
    snapshot: JevSnapshot,
    prompt: string,
    options: JevPlanOptions & { previewOnly: true },
  ): Promise<JevRequestPreview>;
  plan(
    snapshot: JevSnapshot,
    prompt: string,
    options?: JevPlanOptions & { previewOnly?: false },
  ): Promise<JevPlan>;
}
