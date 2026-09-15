/** Compact, reversible patches over acyclic structured document values. */
export declare const DEFAULT_HISTORY_LIMIT: 100;
export declare const DEFAULT_HISTORY_BYTE_LIMIT: number;
export type ValueDelta =
  | {type:'value'; before:unknown; after:unknown}
  | {type:'text'; start:number; removed:string; inserted:string}
  | {type:'object'; changes:PropertyDelta[]; keys?:{before:string[];after:string[]}}
  | {type:'array'; changes:Array<{index:number;delta:ValueDelta}>}
  | {type:'splice'; index:number;removed:unknown[];inserted:unknown[]}
  | {type:'moves';moves:Array<{from:number;to:number}>}
  | {type:'keyed-array';key:'id'|'_id';order:ValueDelta|null;changes:PropertyDelta[]};
export interface PropertyDelta {key:string;before:boolean;after:boolean;delta:ValueDelta}
export interface HistoryPatch {version:1;delta:ValueDelta;estimatedBytes:number}
export interface HistoryOptions {historyLimit?:number;historyByteLimit?:number}
export interface HistoryStatistics {
  entries:number;pastEntries:number;futureEntries:number;estimatedBytes:number;
  entryLimit:number;byteLimit:number;droppedEntries:number;
}
export interface DocumentHistoryEntry<T=unknown> {
  label:string;
  patch:HistoryPatch;
  estimatedBytes:number;
  /** Materialized on access while the patch is retained; never cached by the store. */
  readonly document:T;
}
export interface LegacyDocumentHistoryEntry<T=unknown> {label:string;document:T;patch?:never;estimatedBytes?:never}
export type DocumentHistoryItem<T=unknown> = DocumentHistoryEntry<T> | LegacyDocumentHistoryEntry<T>;
export declare function validateHistoryValue<T>(value:T):T;
/** Estimated retained payload, not an engine-specific heap measurement. */
export declare function estimateHistoryBytes(value:unknown):number;
export declare function createHistoryPatch(before:unknown,after:unknown):HistoryPatch|null;
/** Returns a new value, sharing unchanged subtrees with the input. */
export declare function applyHistoryPatch<T>(document:T,patch:HistoryPatch,options?:{direction?:'forward'|'backward'}):T;
