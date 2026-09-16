import type { DesignDocument } from './index.js';

export interface HtmlAnimationTiming {
  /** Milliseconds, nonnegative. */ duration: number;
  /** Milliseconds; negative delays start within the active interval. */ delay: number;
  easing: string;
  /** Infinity produces CSS `infinite`. */ iterations: number;
  direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  fill: 'none' | 'forwards' | 'backwards' | 'both';
  playState: 'running' | 'paused';
}
export interface HtmlAnimationFrame {
  offset: number;
  values: Record<string, string | null>;
  selector?: string;
}
export interface HtmlAnimationDefinition {
  id: string;
  name: string;
  styleId: string;
  authored: boolean;
  /** Duplicate CSS offsets stay in source order and follow the CSS cascade. */
  frames: HtmlAnimationFrame[];
}
export interface HtmlAnimationBinding {
  nodeId: string;
  name: string;
  index: number;
  timing: HtmlAnimationTiming;
}
export interface HtmlAnimationDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: string;
  start?: number;
}
export interface HtmlAnimationOptions {
  /** Renderer's source-node to DOM-element map, required to resolve stylesheet/variable based timing. */
  elements?: Map<string, Element>;
}
export interface HtmlAnimationCatalog {
  definitions: HtmlAnimationDefinition[];
  bindings: HtmlAnimationBinding[];
  diagnostics: HtmlAnimationDiagnostic[];
}
export interface CssSourceDeclaration {
  start: number;
  end: number;
  raw: string;
  property: string;
  value: string;
}
export interface CssSourceFrame {
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
  selector: string;
  offsets: number[];
  values: Record<string, string>;
  declarations: CssSourceDeclaration[];
}
export interface CssSourceRule {
  kind: 'rule' | 'raw' | 'keyframes';
  start: number;
  end: number;
  raw?: string;
  header?: string;
  bodyStart?: number;
  bodyEnd?: number;
  parent?: CssSourceRule | null;
  children?: CssSourceRule[];
  declarations?: CssSourceDeclaration[];
  name?: string;
  rawName?: string;
  frames?: CssSourceFrame[];
}
export interface CssAnimationStylesheet {
  source: string;
  children: CssSourceRule[];
  rules: CssSourceRule[];
  keyframes: CssSourceRule[];
  diagnostics: HtmlAnimationDiagnostic[];
}
export function splitCssList(source: string, delimiter?: string): string[];
export function parseCssAnimationStylesheet(source: string): CssAnimationStylesheet;
export function listHtmlAnimations(
  doc: DesignDocument,
  options?: HtmlAnimationOptions,
): HtmlAnimationCatalog;
export function createHtmlAnimation(
  doc: DesignDocument,
  nodeId: string,
  config?: Partial<HtmlAnimationTiming> & { name?: string; frames?: HtmlAnimationFrame[] },
  options?: HtmlAnimationOptions,
): { id: string; definitionId: string; name: string };
export function bindHtmlAnimation(
  doc: DesignDocument,
  nodeId: string,
  name: string,
  timing?: Partial<HtmlAnimationTiming>,
  options?: HtmlAnimationOptions,
): HtmlAnimationBinding;
export function setHtmlAnimationTiming(
  doc: DesignDocument,
  nodeId: string,
  name: string,
  patch: Partial<HtmlAnimationTiming>,
  options?: HtmlAnimationOptions,
): { nodeId: string; name: string };
export function unbindHtmlAnimation(
  doc: DesignDocument,
  nodeId: string,
  name: string,
  options?: HtmlAnimationOptions,
): { nodeId: string; name: string };
export function setHtmlAnimationKeyframe(
  doc: DesignDocument,
  definitionId: string,
  offset: number,
  values: Record<string, string | null>,
): string;
export function removeHtmlAnimationKeyframe(
  doc: DesignDocument,
  definitionId: string,
  offset: number,
): string;
export function moveHtmlAnimationKeyframe(
  doc: DesignDocument,
  definitionId: string,
  from: number,
  to: number,
): string;
export function duplicateHtmlAnimationKeyframe(
  doc: DesignDocument,
  definitionId: string,
  from: number,
  to: number,
): string;
/** Remove the local definition only; selectors, external stylesheets and script references stay explicit. */
export function removeHtmlAnimation(doc: DesignDocument, definitionId: string): string;
/** Rename same-name local definitions and literal CSS references; scripts and variable-generated names are retained. */
export function renameHtmlAnimation(
  doc: DesignDocument,
  definitionId: string,
  name: string,
): string;
/** Export complete inline stylesheets without losing conditional context, imports or unrelated rules. */
export function exportHtmlAnimationCss(doc: DesignDocument): string;
export const HTML_ANIMATION_PRESETS: Array<
  Partial<HtmlAnimationTiming> & { id: string; label: string; frames: HtmlAnimationFrame[] }
>;
/** Samples actual browser CSS animations. Inline styles and transforms are never overwritten. */
export class HtmlAnimationPreview {
  constructor(options?: { document?: Document; elements?: Map<string, Element> });
  document: Document | null | undefined;
  elements: Map<string, Element> | null | undefined;
  animations: CSSAnimation[];
  currentTime: number;
  playing: boolean;
  /** Unsupported non-millisecond timeline effects encountered while seeking. */
  diagnostics: string[];
  /** Finite active end time; infinite animations use a two-iteration editing window. */
  readonly duration: number;
  refresh(): this;
  seek(milliseconds: number): number;
  play(options?: { from?: number; rate?: number }): this;
  pause(): this;
  stop(): this;
  /** Restore original times, playback rates and playback states, then release references. */
  dispose(): void;
}
