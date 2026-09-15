import type {DesignDocument} from './index.js';
export type HtmlStateKind = 'hover' | 'focus' | 'focus-visible' | 'active' | 'disabled' | 'checked' | 'class' | 'data' | 'named';
export interface HtmlStateDefinition {
  id: string; styleId: string; selector: string; kind: HtmlStateKind; name: string;
  attribute?: string; value?: string; values: Record<string,string>;
  authored: boolean; targetIds: string[]; conditions: string[]; binding?: string;
}
export interface HtmlTransition {
  property: string; duration: number; delay: number; easing: string; behavior: 'normal' | 'allow-discrete';
}
export interface HtmlStatesOptions { elements?: Map<string,Element>; nodeId?: string }
export interface HtmlStateDiagnostic { severity: 'error' | 'warning' | 'info'; message: string; nodeId?: string; start?: number }
export interface HtmlStateCatalog {
  states: HtmlStateDefinition[];
  transitions: Array<{nodeId: string; items: HtmlTransition[]}>;
  diagnostics: HtmlStateDiagnostic[];
}
export interface HtmlStateSelectorToken {
  kind: 'pseudo' | 'class' | 'attribute'; start: number; end: number; raw: string;
  name?: string; operator?: string; value?: string;
}
export function tokenizeHtmlStateSelector(selector: string): HtmlStateSelectorToken[];
export function listHtmlStates(doc: DesignDocument, options?: HtmlStatesOptions): HtmlStateCatalog;
export function createHtmlState(doc: DesignDocument, nodeId: string, config?: {kind?: HtmlStateKind; name?: string; attribute?: string; value?: string; values?: Record<string,string|null>}): HtmlStateDefinition;
export function bindHtmlState(doc: DesignDocument, stateId: string, nodeId: string): HtmlStateDefinition;
export function setHtmlStateProperties(doc: DesignDocument, stateId: string, values: Record<string,string|null>): HtmlStateDefinition;
/** Preserves base declarations; promotes state values above ordinary inline base using explicit !important. */
export function recordHtmlStateProperties(doc: DesignDocument, stateId: string, nodeId: string, values: Record<string,string|null>): HtmlStateDefinition;
export function removeHtmlState(doc: DesignDocument, stateId: string): string;
export function getHtmlTransitions(doc: DesignDocument, nodeId: string, options?: HtmlStatesOptions): HtmlTransition[];
export function setHtmlTransitions(doc: DesignDocument, nodeId: string, items: Array<Partial<HtmlTransition> & {property: string}>, options?: HtmlStatesOptions): HtmlTransition[];
export function getHtmlStateTransitions(doc: DesignDocument, stateId: string): HtmlTransition[];
export function setHtmlStateTransitions(doc: DesignDocument, stateId: string, items: Array<Partial<HtmlTransition> & {property: string}>): HtmlStateDefinition;
export function exportHtmlStateCss(doc: DesignDocument): string;
export type HtmlStateEvent = 'click' | 'dblclick' | 'pointerenter' | 'pointerleave' | 'focusin' | 'focusout' | 'change' | 'input';
export type HtmlStateAction = 'toggle' | 'set' | 'clear';
export interface HtmlStateInteraction {
  id: string; triggerNodeId: string; stateId: string | null; stateName: string;
  targetBinding: string; event: HtmlStateEvent; action: HtmlStateAction;
}
/** Standalone source-visible runtime; not installed until an interaction binding is authored. */
export function exportHtmlStateRuntime(): string;
export function bindHtmlStateInteraction(doc: DesignDocument, stateId: string, config: {triggerNodeId: string; event?: HtmlStateEvent; action?: HtmlStateAction}): HtmlStateInteraction;
export function listHtmlStateInteractions(doc: DesignDocument): HtmlStateInteraction[];
export function removeHtmlStateInteraction(doc: DesignDocument, interactionId: string): boolean;
/** Forces states only in isolated preview DOM; restores selector text, attributes and transition freeze. */
export class HtmlStatePreview {
  constructor(options?: {document?: Document; elements?: Map<string,Element>; sourceDocument?: DesignDocument});
  document: Document | null | undefined;
  elements: Map<string,Element> | null | undefined;
  sourceDocument: DesignDocument | null | undefined;
  active: {state: HtmlStateDefinition; nodeId: string} | null;
  diagnostics: string[];
  setState(state: HtmlStateDefinition, nodeId: string, options?: {transitions?: boolean}): this;
  clear(): this;
  dispose(): void;
}
