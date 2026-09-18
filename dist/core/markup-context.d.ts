export interface CompletionAttribute {
  name: string;
  value: string;
  start: number;
  quote: string | null;
}
export interface MarkupCompletionFrame {
  type: string;
  start: number;
  attributes: Map<string, string>;
  namespaces: Map<string, string>;
  namespaceURI: string;
  attribute: CompletionAttribute | null;
}
export interface MarkupCompletionContext {
  start: number;
  quote: string | null;
  blocked: boolean;
  stack: MarkupCompletionFrame[];
  customElements: string[];
  tag: MarkupCompletionFrame | null;
  attribute: CompletionAttribute | null;
  rawText: string | null;
}
export declare function markupCompletionContext(
  source: string,
  offset?: number,
  options?: { html?: boolean },
): MarkupCompletionContext;
export declare function htmlChildNamespace(parent?: MarkupCompletionFrame, name?: string): string;
