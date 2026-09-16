export type ObjectPropertyPath = readonly (string | number)[];
export type ObjectValueKind =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'function'
  | 'symbol'
  | 'bigint'
  | 'unsupported';
export interface ObjectInspectionOptions {
  maxDepth?: number;
  maxEntries?: number;
  readOnly?: boolean;
}
export interface ObjectCloneOptions {
  maxNodes?: number;
}
export interface ObjectPropertyNode {
  readonly path: readonly string[];
  readonly key: string;
  readonly kind: ObjectValueKind | 'accessor';
  readonly value: unknown;
  readonly readOnly: boolean;
  readonly children: readonly ObjectPropertyNode[];
  readonly note?: string;
  readonly truncated?: boolean;
}
export function objectPathKey(path: ObjectPropertyPath): string;
export function objectValueKind(value: unknown): ObjectValueKind;
export function getObjectProperty(value: unknown, path: ObjectPropertyPath): unknown;
export function inspectObjectProperties(
  value: unknown,
  options?: ObjectInspectionOptions,
): ObjectPropertyNode;
export function cloneObjectGraph<T>(value: T, options?: ObjectCloneOptions): T;
export function editObjectProperty(
  source: unknown,
  path: ObjectPropertyPath,
  value: unknown,
  options?: ObjectCloneOptions & { operation?: 'set' | 'add' | 'remove' },
): unknown;
