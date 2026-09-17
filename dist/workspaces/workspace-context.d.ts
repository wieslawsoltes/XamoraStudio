export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface WorkspaceDocumentScope {
  readonly activeElement: Element | null;
  query(selector: string): Element | null;
  all(selector: string): Element[];
  owns(target: Node): boolean;
  listen(
    target: EventTarget,
    type: string,
    callback: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): () => void;
}
export interface WorkspaceOptions {
  /** Explicit caller-owned routing for live panels hosted in multiple documents. */
  domScope?: WorkspaceDocumentScope;
  root: Element | Document;
  dialogRoot?: HTMLElement | null;
  elements?: Record<string, Element | (() => Element | null)>;
  api?: Record<string, any>;
  storage?: WorkspaceStorage;
  notify?: (message: string) => void;
  saveFile?: (name: string, content: string | Blob, mime: string) => void;
  styles?: Record<string, string>;
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
}
export function esc(value: unknown): string;
export function field(name: string, label: string, value?: unknown, type?: string): string;
export function select(
  name: string,
  label: string,
  options: (string | [string, string])[],
  value?: string,
): string;
export function createMemoryStorage(): WorkspaceStorage;
export class WorkspaceContext {
  constructor(options: WorkspaceOptions);
  readonly activeElement: Element | null;
  readonly root: Element | Document;
  readonly document: Document;
  readonly window: Window;
  readonly dialogRoot: HTMLElement | null;
  readonly options: WorkspaceOptions;
  readonly api: Record<string, any>;
  readonly storage: WorkspaceStorage;
  readonly disposed: boolean;
  query<T extends Element = HTMLElement>(selector: string, root?: ParentNode): T | null;
  all<T extends Element = HTMLElement>(selector: string, root?: ParentNode): T[];
  notify(message: unknown): void;
  saveFile(name: string, content: string | Blob, mime?: string): void;
  add(cleanup: () => void): () => void;
  own<T extends { dispose?(): void; remove?(): void }>(value: T): T;
  track<T extends Element>(node: T): T;
  override<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): T[K];
  listen(
    target: EventTarget | null,
    type: string,
    callback: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): () => void;
  unlisten(
    target: EventTarget,
    type: string,
    callback: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  handler(target: object, key: string, callback: Function): Function;
  frame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
  timeout(callback: () => void, duration?: number): number;
  clearTimeout(id: number): void;
  stylesheet(name: string): void;
  dispose(): void;
}
export class WorkspaceComponent {
  constructor(options: WorkspaceOptions);
  readonly environment: WorkspaceContext;
  readonly disposed: boolean;
  dispose(): void;
}

/** Shared document semantics are supplied by the application, never reconstructed by a panel. */
export interface WorkspaceHost {
  workspaceOptions: WorkspaceOptions;
  readonly doc: import('@wieslawsoltes/xamora-contracts').DesignDocument;
  readonly store: import('@wieslawsoltes/xamora-contracts').DocumentStore;
  stores: import('@wieslawsoltes/xamora-contracts').DocumentStore[];
  readonly selected: import('@wieslawsoltes/xamora-contracts').ElementNode[];
  registry: import('@wieslawsoltes/xamora-contracts').ToolkitRegistry;
  renderer: import('@wieslawsoltes/xamora-contracts').PreviewRenderer;
  active: number;
  scopeId: string | null;
  prepareEdit(): boolean;
  render(): void;
  renderCanvas(): void;
  renderInspector(): void;
  drawSelection(): void;
  setProps(ids: string[], key: string, value: unknown): void;
  propertyChanged(event: Event): void;
  command(name: string, event?: Event): unknown;
  modal(title: string, trustedHtml: string, actions?: readonly unknown[], wide?: boolean): void;
  closeModal(): void;
  save(): void;
  leftHost(tab?: string): HTMLElement;
  inspectorHost(tab?: string): HTMLElement;
  /** Optional application-specific integrations; the per-component service inventory documents their use. */
  [extension: string]: any;
}
export interface CanvasWorkspaceHost extends WorkspaceHost {
  pointerDown(event: PointerEvent): void;
  pointerMove(event: PointerEvent): void;
  pointerUp(event: PointerEvent, cancel?: boolean): void;
  contextMenu(x: number, y: number): void;
  drop(event: DragEvent, target?: unknown, canvas?: boolean): void;
  rectFor(id: string): { x: number; y: number; width: number; height: number } | null;
}
export interface MotionWorkspaceHost extends WorkspaceHost {
  readonly features?: { editable(): boolean; [service: string]: any };
}
export interface TimelineWorkspaceHost extends WorkspaceHost {
  blend: { animation: any; [service: string]: any };
}
export interface ResourceWorkspaceHost extends WorkspaceHost {
  field(key: string, title: string, value: unknown, options?: unknown, full?: boolean): string;
}
export interface SolutionWorkspaceHost extends WorkspaceHost {
  addStore(document: import('@wieslawsoltes/xamora-contracts').DesignDocument): unknown;
  switchDocument(index: number): unknown;
  docking: WorkspacePanelService;
}
export interface HtmlWorkspaceHost extends WorkspaceHost {
  changeFramework(framework: string): void;
  solution: { newFile(type?: string): unknown; [service: string]: any };
  docking: WorkspacePanelService;
}
export interface DataWorkspaceHost extends WorkspaceHost {}
export interface WorkspacePanelService {
  timelineHost: HTMLElement;
  registerPanel(options: {
    id: string;
    title: string;
    content: HTMLElement;
    icon?: string;
    onClose?: () => void;
  }): { show(): void; close(): void; dispose(): void };
  [service: string]: any;
}
