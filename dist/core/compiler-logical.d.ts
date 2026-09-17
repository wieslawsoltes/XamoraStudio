/** Already-computed CSS flow values, not declaration source or a device environment. */
export interface CssFlowContext {
  direction?: string;
  'writing-mode'?: string;
}
export declare function cssBoxLonghands(property: string): string[] | null;
/** Unknown names are returned unchanged; unsupported flow modes return null for logical names. */
export declare function physicalCssProperty(property: string, css?: CssFlowContext): string | null;
export declare function cssBoxFamily(property: string, css?: CssFlowContext): string | null;
