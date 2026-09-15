export type DensityMode = 'compact' | 'standard' | 'comfortable';
export interface DensityOption {readonly id:DensityMode;readonly label:string;readonly description:string}
export declare const DENSITY_KEY:string;
export declare const DENSITY_MODES:readonly DensityOption[];
export declare function validDensity(value:unknown):value is DensityMode;
export declare class WorkspaceDensity extends EventTarget {
  constructor(options?:{root?:HTMLElement;storage?:Pick<Storage,'getItem'|'setItem'>|null});
  readonly value:DensityMode;
  set(value:DensityMode,options?:{persist?:boolean}):boolean;
}
