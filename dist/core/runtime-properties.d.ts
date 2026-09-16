export interface ObservableChange {
  paths: string[];
  revision: number;
}
export declare class ObservableState<
  T extends object = Record<string, unknown>,
> extends EventTarget {
  constructor(value?: T);
  readonly data: T;
  readonly revision: number;
  get(path?: string): unknown;
  set(path: string, value: unknown): unknown;
  batch<R>(action: (data: T) => R): R;
  flush(): void;
  subscribe(listener: (change: ObservableChange, data: T) => void): () => void;
  snapshot(): T;
}
export declare function observable<T extends object>(value: T): ObservableState<T>;
export type PropertySource =
  'animation' | 'local' | 'binding' | 'trigger' | 'style' | 'inherited' | 'default';
export declare const PROPERTY_PRECEDENCE: readonly PropertySource[];
export interface RuntimePropertyMetadata {
  type?: 'number' | 'boolean' | 'string' | 'object';
  defaultValue?: unknown;
  inherits?: boolean;
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  allowAuto?: boolean;
  values?: readonly unknown[];
  defaultBindingMode?: 'OneWay' | 'TwoWay' | 'OneTime' | 'OneWayToSource';
  coerce?: (value: unknown) => unknown;
  validate?: (value: unknown) => boolean;
}
export declare function coerceProperty(value: unknown, metadata?: RuntimePropertyMetadata): unknown;
export declare class RuntimePropertyRegistry {
  constructor(options?: { builtins?: boolean });
  register(type: string, property: string, metadata: RuntimePropertyMetadata): () => void;
  get(type: string, property: string): Readonly<RuntimePropertyMetadata> | undefined;
  list(type: string): Map<string, Readonly<RuntimePropertyMetadata>>;
}
export declare class RuntimePropertyStore extends EventTarget {
  constructor(registry?: RuntimePropertyRegistry);
  readonly registry: RuntimePropertyRegistry;
  set(
    nodeId: string,
    type: string,
    property: string,
    value: unknown,
    source?: PropertySource,
  ): unknown;
  get(nodeId: string, type: string, property: string, inherited?: unknown): unknown;
  entries(nodeId: string): Record<string, unknown>;
  clear(nodeId: string, property: string, source?: PropertySource): boolean;
  reset(): void;
}
