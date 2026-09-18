export interface JevSettings {
  endpoint: string;
  model: string;
  timeoutMs: number;
  retries: number;
  maxRequestBytes: number;
  maxSteps: number;
  minConfidence: number;
  minProbability: number;
  includeSource: boolean;
  includeOtherDocuments: boolean;
  generatorEnabled: boolean;
  generatorEndpoint: string;
  generatorModel: string;
  generatorMaxTokens: number;
  generatorTokenParameter: 'max_tokens' | 'max_completion_tokens';
}
export interface JevCredentials {
  apiKey?: string;
  generatorKey?: string;
  proxyToken?: string;
}
export interface JevQuestion {
  type: 'choice' | 'noul' | 'score';
  instructions: string | object | unknown[];
  criteria?: Record<string, string | null> | string[];
}
export interface JevRequest {
  model: string;
  state: string | object | unknown[];
  questions: Record<string, JevQuestion>;
}
export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export interface JevNoulAnswer {
  type: 'noul';
  noul: number;
}
export interface JevScoreAnswer {
  type: 'score';
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  legend: Record<string, string>;
}
export type JevAnswer = JevChoiceAnswer | JevNoulAnswer | JevScoreAnswer;
export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}
export interface AITransportOptions extends JevCredentials {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  body?: unknown;
  maxResponseBytes?: number;
}
export declare const JEV_DEFAULTS: Readonly<JevSettings>;
export declare function jsonBytes(value: unknown): number;
export declare function aiEndpoint(value: string, origin?: string): string;
export declare function jevEndpoint(value: string, origin?: string): string;
export declare class AITransportError extends Error {
  constructor(message: string, options?: { code?: string; status?: number });
  readonly code: string;
  readonly status: number;
}
export declare function jevSettings(input?: Partial<JevSettings>, origin?: string): JevSettings;
export declare function validateJevRequest(request: JevRequest, maxBytes?: number): number;
export declare function validateJevResponse(data: unknown, request: JevRequest): JevResponse;
export declare function aiJSON(url: string, options?: AITransportOptions): Promise<any>;
export declare class JevClient {
  constructor(
    options?: Partial<JevSettings> & AITransportOptions & { origin?: string },
    transport?: AITransportOptions,
  );
  readonly settings: JevSettings;
  evaluate(
    state: JevRequest['state'],
    questions: Record<string, JevQuestion>,
    options?: { signal?: AbortSignal },
  ): Promise<JevResponse>;
  models(options?: {
    signal?: AbortSignal;
  }): Promise<Array<{ name: string; description?: string; release_date?: string }>>;
}
