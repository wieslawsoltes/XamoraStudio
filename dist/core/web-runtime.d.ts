import type {
  DesignDocument,
  ElementNode,
  ToolkitRegistry,
  PreviewRenderer,
  AnimationPlayer,
} from './index.js';
import type {
  ObservableState,
  RuntimePropertyRegistry,
  RuntimePropertyStore,
} from './runtime-properties.js';
export interface RuntimeDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  nodeId?: string;
  line?: number;
  column?: number;
}
export interface RuntimeEventContext<T extends object = Record<string, unknown>> {
  application: XamlApplication<T>;
  data: T;
  context: unknown;
  node?: ElementNode;
  element?: Element;
  event?: string;
  value?: unknown;
  [key: string]: unknown;
}
export type RuntimeCommand<T extends object = Record<string, unknown>> =
  | ((parameter: unknown, context: RuntimeEventContext<T>) => unknown)
  | {
      execute(parameter: unknown, context: RuntimeEventContext<T>): unknown;
      canExecute?(parameter: unknown, context: RuntimeEventContext<T>): boolean;
    };
export type RuntimeConverter =
  | ((value: unknown, parameter?: string, application?: XamlApplication<any>) => unknown)
  | {
      convert(value: unknown, parameter?: string, application?: XamlApplication<any>): unknown;
      convertBack?(value: unknown, parameter?: string, application?: XamlApplication<any>): unknown;
    };
export type RuntimePlugin<T extends object = Record<string, unknown>> =
  | ((application: XamlApplication<T>) => void | (() => void))
  | { setup(application: XamlApplication<T>): void | (() => void) };
export interface ApplicationOptions<T extends object = Record<string, unknown>> {
  source?: string;
  document?: DesignDocument;
  name?: string;
  framework?: string;
  data?: T | ObservableState<T>;
  registry?: ToolkitRegistry;
  propertyRegistry?: RuntimePropertyRegistry;
  commands?: Record<string, RuntimeCommand<T>>;
  events?: Record<string, (context: RuntimeEventContext<T>) => unknown>;
  converters?: Record<string, RuntimeConverter>;
  resources?: Record<string, string | number | boolean | ElementNode>;
  theme?: string | ElementNode | DesignDocument;
  resourceResolver?: (source: string) => ElementNode | DesignDocument | undefined;
  plugins?: RuntimePlugin<T>[];
  fetch?: typeof globalThis.fetch;
  onDiagnostic?: (diagnostic: RuntimeDiagnostic) => void;
}
export interface RuntimePlayer extends AnimationPlayer {
  storyboard: ElementNode;
  dispose(): void;
}
export declare const RUNTIME_STYLES: string;
export declare class XamlApplication<
  T extends object = Record<string, unknown>,
> extends EventTarget {
  constructor(options?: ApplicationOptions<T>);
  readonly data: T;
  readonly state: ObservableState<T>;
  readonly registry: ToolkitRegistry;
  readonly propertyRegistry: RuntimePropertyRegistry;
  readonly properties: RuntimePropertyStore;
  readonly renderer: PreviewRenderer;
  readonly source: string;
  readonly document: DesignDocument | null;
  readonly diagnostics: RuntimeDiagnostic[];
  readonly disposed: boolean;
  readonly host?: Element | ShadowRoot | null;
  mount(host: Element | ShadowRoot): this;
  unmount(): void;
  invalidate(): void;
  refresh(): this;
  updateSource(
    source: string,
    options?: { name?: string; framework?: string },
  ): { valid: boolean; diagnostics: RuntimeDiagnostic[] };
  updateDocument(document: DesignDocument): this;
  load(
    url: string,
    options?: {
      fetch?: typeof globalThis.fetch;
      signal?: AbortSignal;
      name?: string;
      framework?: string;
    },
  ): Promise<this>;
  setData(path: string, value: unknown): unknown;
  setResource(key: string, value: string | number | boolean | ElementNode | undefined): this;
  setTheme(dictionary?: string | ElementNode | DesignDocument): this;
  registerDictionary(source: string, dictionary: string | ElementNode | DesignDocument): () => void;
  loadDictionary(
    url: string,
    options?: { fetch?: typeof globalThis.fetch; signal?: AbortSignal },
  ): Promise<() => void>;
  findNode(nameOrId: string): ElementNode | null;
  findName(name: string): Element | null;
  getValue(nameOrId: string, property: string): unknown;
  setValue(nameOrId: string, property: string, value: unknown): unknown;
  clearValue(nameOrId: string, property: string): boolean;
  updateSourceBinding(nameOrId: string, property: string): boolean;
  registerCommand(name: string, command: RuntimeCommand<T>): () => void;
  registerEvent(name: string, handler: (context: RuntimeEventContext<T>) => unknown): () => boolean;
  registerConverter(name: string, converter: RuntimeConverter): () => void;
  use(plugin: RuntimePlugin<T>): this;
  playStoryboard(
    nameOrId: string,
    options?: {
      rate?: number;
      loop?: boolean;
      autoplay?: boolean;
      now?: () => number;
      schedule?: (callback: FrameRequestCallback) => number;
      cancel?: (id: number) => void;
    },
  ): RuntimePlayer;
  goToState(group: string, state: string, options?: { transitions?: boolean }): unknown;
  stopAnimations(): void;
  dispose(): void;
}
export declare function createApplication<T extends object = Record<string, unknown>>(
  options?: ApplicationOptions<T>,
): XamlApplication<T>;
export declare function mountXaml<T extends object = Record<string, unknown>>(
  host: Element | ShadowRoot,
  source: string,
  options?: ApplicationOptions<T>,
): XamlApplication<T>;
