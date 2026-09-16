export interface CssEnvironment {
  type?: 'screen' | 'print' | string;
  width?: number;
  height?: number;
  /** CSS pixels per em/rem. For media queries initialFontSize defaults to 16. */
  fontSize?: number;
  rootFontSize?: number;
  initialFontSize?: number;
  percentBase?: number;
  /** Resolution in CSS dppx. */
  resolution?: number;
  viewport?: { width: number; height: number };
  smallViewport?: { width: number; height: number };
  largeViewport?: { width: number; height: number };
  dynamicViewport?: { width: number; height: number };
  supports?: Record<string, boolean> | ((condition: string) => boolean | null | undefined);
  [feature: string]: unknown;
}
/** Null means unresolved, invalid or outside the dimensional grammar; never evals source. */
export declare function resolveCssLength(
  source: string,
  environment?: CssEnvironment,
): number | null;
/** Null is unknown, including under `not`. Host feature inputs are authoritative. */
export declare function evaluateCssCondition(
  source: string,
  environment?: CssEnvironment,
  kind?: 'media' | 'supports',
  depth?: number,
): boolean | null;
