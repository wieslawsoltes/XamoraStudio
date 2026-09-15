export type Framework = 'WPF' | 'Avalonia' | 'WinUI' | 'MAUI' | 'HTML' | (string & {});
export type PropertyValue = string | number | boolean;
export interface ElementNode {
  id: string;
  kind: 'element';
  type: string;
  props: Record<string, PropertyValue>;
  children: DesignNode[];
  namespaceURI?: string;
  scope?: Record<string, string>;
  source?: { start: number; line: number };
}
export interface TextNode { id: string; kind: 'text' | 'comment' | 'cdata' | 'pi'; text: string }
export type DesignNode = ElementNode | TextNode;
export interface Annotation { id: string; x: number; y: number; text: string; author?: string; resolved: boolean }
export interface DesignDocument {
  version: 1;
  id: string;
  name: string;
  framework: Framework;
  root: ElementNode;
  design: { width: number; height: number };
  metadata: Record<string, unknown>;
  annotations: Annotation[];
  preamble?: TextNode[];
  postamble?: TextNode[];
}
export interface PropertyDescriptor { name: string; editor?: string; type?: string; values?: string[] }
export interface ControlDescriptor {
  type: string;
  category: string;
  namespace?: string;
  toolkit?: string;
  description?: string;
  icon?: string;
  container?: boolean;
  singleChild?: boolean;
  templated?: boolean;
  defaults?: Record<string, PropertyValue>;
  properties?: Array<string | PropertyDescriptor>;
  children?: Array<{ type: string; props?: Record<string, PropertyValue>; children?: unknown[] }>;
  render?: (context: { node: ElementNode; properties: Record<string, PropertyValue>; renderer: PreviewRenderer; interactive: boolean }) => Element;
}
export interface ExportResult { content: string; extension?: string; mimeType?: string }
export interface ExportAdapter { serialize(document: DesignDocument): string | ExportResult | Promise<string | ExportResult> }
export declare function element(type: string, props?: Record<string, PropertyValue>, children?: DesignNode[]): ElementNode;
export declare function find(root: DesignNode, id: string): DesignNode | null;
export declare function parentOf(root: DesignNode, id: string): ElementNode | null;
export declare function walk(root: DesignNode, visit: (node: DesignNode, parent: ElementNode | null) => void): void;
export declare function parseXaml(source: string, options?: {name?: string; framework?: Framework}): DesignDocument;
export declare function serializeXaml(document: DesignDocument, options?: {framework?: Framework; indent?: string; lineWidth?: number}): string;
export declare function validateDocument(document: DesignDocument): DesignDocument;
export declare function createDocument(root: ElementNode, framework?: Framework, name?: string): DesignDocument;
export declare function exportHTML(document: DesignDocument, registry: ToolkitRegistry, data?: Record<string, unknown>, resourceResolver?: (source:string,node:ElementNode)=>ElementNode|null): string;
export declare function builtins(): ToolkitRegistry;
export declare class ToolkitRegistry extends EventTarget {
  controls: Map<string, ControlDescriptor>;
  adapters: Map<string, ExportAdapter>;
  registerControl(descriptor: ControlDescriptor): () => boolean;
  registerAdapter(name: string, adapter: ExportAdapter): void;
  get(type: string, namespace?: string): ControlDescriptor | undefined;
  list(): ControlDescriptor[];
  install(manifest: {name: string; version?: string; controls: ControlDescriptor[]}): void;
  create(type: string): ElementNode;
}
export declare class DocumentStore extends EventTarget {
  constructor(document: DesignDocument);
  document: DesignDocument;
  selection: string[];
  revision: number;
  history: Array<{label: string; document: DesignDocument}>;
  future: Array<{label: string; document: DesignDocument}>;
  select(ids: string[]): void;
  transaction(label: string, action: (document: DesignDocument) => void): void;
  setProperty(ids: string[], property: string, value: PropertyValue | null): void;
  insert(parentId: string, node: DesignNode, index?: number): string;
  move(ids: string[], parentId: string, index?: number): void;
  remove(ids: string[]): void;
  undo(): void;
  redo(): void;
}
export declare class PreviewRenderer {
  constructor(registry: ToolkitRegistry);
  sampleData: Record<string, unknown>;
  elements: Map<string, HTMLElement>;
  render(document: DesignDocument, host: HTMLElement, options?: {scope?: ElementNode | null; interactive?: boolean; designTime?: boolean}): Map<string, HTMLElement>;
}

export type DataType = 'string' | 'number' | 'boolean' | 'date' | 'json';
export interface DataColumn { name: string; type: DataType; required?: boolean; unique?: boolean; default?: unknown }
export interface DataRecord { _id: string; [property: string]: unknown }
export interface DataTable { id: string; name: string; columns: DataColumn[]; rows: DataRecord[] }
export interface DataRelationship { id: string; fromTable: string; fromColumn: string; toTable: string; toColumn: string; onDelete: 'restrict' | 'cascade' | 'setNull' }
export type FilterOperator = 'eq' | 'ne' | 'contains' | 'startsWith' | 'gt' | 'gte' | 'lt' | 'lte' | 'isNull' | 'notNull';
export interface DataQuery { id?: string; name?: string; tableId: string; filters?: Array<{column: string; operator: FilterOperator; value?: unknown}>; joins?: Array<{tableId: string; localColumn: string; foreignColumn: string; as: string; kind: 'inner' | 'left'}>; sort?: {column: string; direction: 'asc' | 'desc'}; limit?: number }
export interface DesignData { version: 1; tables: DataTable[]; relationships: DataRelationship[]; queries: DataQuery[]; objects: Record<string, unknown> }
export declare function createDatabase(): DesignData;
export declare function validateDatabase(database: DesignData): DesignData;
export declare function queryRows(database: DesignData, query: DataQuery): DataRecord[];
export declare function databaseContext(database: DesignData): Record<string, unknown>;
export declare function readPath(root: unknown, path: string): unknown;
export declare function writePath(root: object, path: string, value: unknown): void;
export declare function bindingPaths(value: unknown, prefix?: string): string[];
export declare function parseBinding(expression: string): {path: string; options: Record<string, string>} | null;
export declare function resolveBinding(expression: unknown, context: unknown, root?: unknown): unknown;
export declare class DesignDatabase {
  constructor(data?: DesignData);
  data: DesignData;
  transaction(action: (data: DesignData) => void): this;
  addTable(name: string, columns?: DataColumn[]): string;
  addColumn(tableId: string, column: DataColumn): void;
  insert(tableId: string, values?: Record<string, unknown>): string;
  update(tableId: string, rowId: string, values: Record<string, unknown>): void;
  remove(tableId: string, rowId: string): void;
}
export type PreviewEventName = 'Click' | 'Change' | 'PointerEnter' | 'PointerLeave' | 'DoubleClick' | 'SelectionChanged' | 'PointerDown' | 'PointerUp' | 'GotFocus' | 'LostFocus';
export interface PrototypeAction { type: 'navigate' | 'back' | 'setData' | 'toggleData' | 'increment' | 'setProperty' | 'toggleVisibility' | 'selectRecord' | 'insertRecord' | 'updateRecord' | 'deleteRecord' | 'openOverlay' | 'closeOverlay' | 'startStoryboard' | 'stopStoryboard' | 'goToState'; storyboardId?: string; groupId?: string; stateName?: string; useTransitions?: boolean; targetViewId?: string; targetId?: string; property?: string; path?: string; value?: unknown; tableId?: string; rowId?: string }
export interface Interaction { id: string; sourceId: string; event: PreviewEventName; actions: PrototypeAction[]; enabled?: boolean; condition?: {path: string; operator: FilterOperator; value?: unknown} }
export interface BindingProvenance { contextPath?: string | null; recordLocator?: {tableId: string; rowId: string; suffix: string[]} }
export interface PreviewInput extends BindingProvenance { expression?: string; value: unknown; context?: unknown; viewId?: string; node?: ElementNode; property?: string; rowId?: string }
export interface PreviewEvent { viewId: string; nodeId: string; id: string; instanceId: string; runtimeNodeId?: string; rowId?: string; event: PreviewEventName; value?: unknown; context?: unknown }
export interface PreviewRenderer { onEvent?: (event: PreviewEvent) => void; onInput?: (change: PreviewInput) => boolean | void; describeContext?: (context: unknown) => BindingProvenance }
export declare class PrototypeSession extends EventTarget {
  constructor(documents: DesignDocument[], database: DesignData, startViewId?: string);
  database: DesignDatabase;
  context: Record<string, any>;
  currentViewId: string;
  overlayViewId: string | null;
  history: string[];
  reset(): void;
  document(viewId?: string): DesignDocument;
  dispatch(viewId: string, nodeId: string, event: PreviewEventName, payload?: Partial<PreviewEvent>): {connections: number; viewId: string};
  describeContext(context: unknown): BindingProvenance;
  writeBinding(change: PreviewInput): boolean;
  writeValue(path: string, value: unknown, options?: {notify?: boolean}): boolean;
}
export interface Completion { label: string; detail: string; start: number; end: number; insertText: string; caretOffset?: number }
export declare function completeXaml(source: string, offset: number, options: {registry: ToolkitRegistry; document?: DesignDocument; context?: Record<string, unknown>}): Completion[];
export declare function contentChildren(node: ElementNode): ElementNode[];
export declare function contentHost(node: ElementNode): ElementNode;
export declare function logicalParent(root: ElementNode, id: string): ElementNode | null;
export declare function isLocked(document: DesignDocument, id: string): boolean;
export declare function gridTrackIndex(sizes: number[], position: number, gap?: number): number;
export declare function definitions(node: ElementNode, axis: 'Row' | 'Column'): ElementNode[];
export declare function writeDefinitions(node: ElementNode, axis: 'Row' | 'Column', definitions: ElementNode[]): void;
export declare function insertTrack(node: ElementNode, axis: 'Row' | 'Column', index: number, value?: string): void;
export declare function removeTrack(node: ElementNode, axis: 'Row' | 'Column', index: number): void;
export declare function reconcileIdentities(previous: ElementNode, next: ElementNode): ElementNode;
export interface DropPlan { allowed: boolean; reason?: string; parentId?: string; hostId?: string; beforeId?: string | null; preserveLayout?: boolean; nodeIds?: string[]; kind?: string; updates?: Record<string, Record<string, string>> }
export declare function planDrop(options: {root: ElementNode; registry: ToolkitRegistry; ids: string[]; parentId: string; beforeId?: string | null; preserveLayout?: boolean; point?: {x: number; y: number}; grab?: {x: number; y: number}; originalRects?: Record<string, {x: number; y: number; width: number; height: number}>; grid?: {rows: number[]; columns: number[]; row: number; column: number}; dock?: string}): DropPlan;
export declare function applyDropPlan(document: DesignDocument, plan: DropPlan): void;

export declare function snapBounds(rect: {x: number; y: number; width: number; height: number}, targets: Array<{x: number; y: number; width: number; height: number}>, threshold?: number): {x: number; y: number; width: number; height: number; guides: Array<{axis: 'x' | 'y'; at: number; from: number; to: number}>};


/** Motion authoring is WPF-specific; sampling never mutates the source document. */
export type AnimationValueType = 'Double' | 'Color' | 'Point' | 'Thickness' | 'Object' | 'Boolean';
export type AnimationValues = Map<string, Record<string, PropertyValue>>;
export interface AnimationKey { id: string; node: ElementNode; index: number; time: number; value: PropertyValue; mode: string; kind: string; raw?: string; paced?: boolean }
export interface AnimationTrack { id: string; node: ElementNode; targetId: string | null; targetName: string; property: string; type: AnimationValueType; duration: number; frames: AnimationKey[] }
export interface StoryboardInfo { id: string; node: ElementNode; name: string; duration: number }
export interface AnimationScope { targetId?: string | null; nameScopeId?: string | null }
export interface AnimationSample { overrides: AnimationValues; values: AnimationValues; warnings: string[] }
export declare const ANIMATION_PROPERTIES: readonly string[];
export declare const EASINGS: readonly string[];
export declare const TRANSFORM_PATHS: Readonly<Record<'ScaleX' | 'ScaleY' | 'SkewX' | 'SkewY' | 'Angle' | 'X' | 'Y', string>>;
export declare function parseTime(value: unknown, fallback?: number): number;
export declare function formatTime(seconds: number): string;
export declare function simpleDuration(node: ElementNode): number;
export declare function activeDuration(node: ElementNode, duration?: number): number;
export declare function ease(progress: number, name?: string | ElementNode, mode?: string, options?: Record<string, unknown>): number;
export declare function splineProgress(progress: number, spline?: string | number[]): number;
export declare function interpolate(a: PropertyValue, b: PropertyValue, progress: number, type?: AnimationValueType): PropertyValue;
export declare function valueType(property: string, value?: unknown): AnimationValueType;
export declare function keyframes(track: ElementNode): AnimationKey[];
export declare function listStoryboards(doc: DesignDocument): StoryboardInfo[];
export declare function storyboardTracks(doc: DesignDocument, story: ElementNode, scope?: AnimationScope): AnimationTrack[];
export declare function sampleStoryboard(doc: DesignDocument, story: ElementNode, time: number, options?: AnimationScope & {baseDocument?: DesignDocument}): AnimationSample;
export declare function applyAnimationValues(doc: DesignDocument, values: AnimationValues | AnimationSample): DesignDocument;
export declare function resourcesFor(doc: DesignDocument, owner?: ElementNode): ElementNode;
export declare function createStoryboard(doc: DesignDocument, name?: string, duration?: number): ElementNode;
export declare function addTrack(doc: DesignDocument, story: ElementNode, target: string | ElementNode, property: string, explicitType?: AnimationValueType): ElementNode;
export declare function setKeyframe(track: ElementNode, time: number, value: PropertyValue, options?: {interpolation?: 'Linear' | 'Discrete' | 'Spline' | 'Easing'; mode?: string; easing?: string; easingMode?: string; spline?: string}): ElementNode;
export interface AnimationClockOptions { duration?: number; now?: () => number; schedule?: (callback: () => void) => number; cancel?: (id: number) => void }
export declare class AnimationPlayer extends EventTarget {
  constructor(options?: AnimationClockOptions);
  duration: number; time: number; rate: number; loop: boolean; playing: boolean;
  play(): void; pause(): void; stop(): void; seek(time: number): void;
}
export declare function readPropertyPath(doc: DesignDocument, node: ElementNode, path: string): PropertyValue | undefined;
export declare function writePropertyPath(doc: DesignDocument, node: ElementNode, path: string, value: PropertyValue): void;
export declare function ensureTransformPath(doc: DesignDocument, node: ElementNode, requested: string): string;
export declare function transformGroup(node: ElementNode, create?: boolean, doc?: DesignDocument | null): ElementNode | null;
export declare function namedTarget(doc: DesignDocument, name: string, scopeId?: string | null): ElementNode | null;
export declare function ensureName(doc: DesignDocument, node: ElementNode, prefix?: string): string;
export interface VisualStateGroupInfo { id: string; node: ElementNode; ownerId: string; name: string; states: ElementNode[]; transitions: ElementNode[] }
export interface VisualStateEntry { group: VisualStateGroupInfo; state: ElementNode; start: number; before: AnimationValues; transition: ElementNode | null; duration: number; generated: number; explicit: ElementNode | null }
export declare function stateGroups(doc: DesignDocument): VisualStateGroupInfo[];
export declare function createStateGroup(doc: DesignDocument, owner?: ElementNode | string, name?: string): ElementNode;
export declare function createState(group: ElementNode | VisualStateGroupInfo, name?: string): ElementNode;
export declare function stateStoryboard(state: ElementNode): ElementNode;
export declare function chooseTransition(group: ElementNode | VisualStateGroupInfo, from: string, to: string): ElementNode | null;
export declare class VisualStateRuntime {
  constructor(doc: DesignDocument, options?: AnimationScope & {baseDocument?: DesignDocument});
  doc: DesignDocument; baseDocument: DesignDocument; warnings: string[]; active: Map<string, VisualStateEntry>;
  groups(): VisualStateGroupInfo[];
  go(groupId: string, stateName: string, time?: number, useTransitions?: boolean): VisualStateEntry;
  sample(time?: number): AnimationValues;
  sampleEntry(entry: VisualStateEntry | string, time?: number): AnimationValues;
  reset(groupId?: string | null): void;
}
export type ResourceResolver = (source: string,node:ElementNode) => DesignDocument | ElementNode | null | undefined;
export declare function resourceEntries(node: ElementNode, resolveSource?: ResourceResolver): ElementNode[];
export declare function findResource(doc: DesignDocument, node: ElementNode, key: string, resolveSource?: ResourceResolver): ElementNode | undefined;
export declare function scopedResource(doc: DesignDocument, node: ElementNode, key: string, resolveSource?: ResourceResolver): ElementNode | undefined;
export declare function selectStyles(doc: DesignDocument, node: ElementNode, resolveSource?: ResourceResolver): ElementNode[];
export declare function resolveStyle(doc: DesignDocument, node: ElementNode, options?: {context?: Record<string, unknown>; root?: Record<string, unknown>; transient?: Record<string, unknown> | Map<string, Record<string, unknown>>; resolveSource?: ResourceResolver}): {properties: Record<string, PropertyValue>; node: ElementNode; triggers: ElementNode[]; active: ElementNode[]};
export declare function brushNode(doc: DesignDocument, node: ElementNode, property: string): ElementNode | undefined;
export declare function brushCSS(brush: ElementNode): string;
export declare function transformMatrix(node: ElementNode): number[];
export declare function applyAppearance(el: HTMLElement, node: ElementNode, doc: DesignDocument, properties?: Record<string, PropertyValue>): HTMLElement;
export declare function designProperties(node: ElementNode, doc?: DesignDocument): Record<string, PropertyValue>;
export declare function isDesignElement(node: ElementNode, doc?: DesignDocument): boolean;
export declare function sampleDesignData(node: ElementNode, count?: number): Record<string, unknown>[];
export declare function ensureDesignNamespace(doc: DesignDocument): string;
export interface PathCommand { type: string; values: number[] }
export interface PathPoint { command: number; offset: number; x: number; y: number; control: boolean }
export declare function parsePath(source: string): PathCommand[];
export declare function serializePath(commands: PathCommand[]): string;
export declare function pathPoints(commands: PathCommand[] | string): PathPoint[];
export declare function movePathPoint(commands: PathCommand[], point: PathPoint | number, x: number, y: number): PathCommand[];
export declare function movePathPoint(commands: string, point: PathPoint | number, x: number, y: number): string;
export declare function shapeToPath(node: ElementNode): string;
export interface PreviewRenderer { document: DesignDocument; runtimeTemplates: Array<{ownerId: string; tree: ElementNode}>; templateOwners: Map<string, string>; resourceResolver?: ResourceResolver }
export interface MotionBaseline { css: string; style: Record<string, string>; text: string; children: Node[]; textChanged: boolean; disabled?: boolean; value?: unknown; checked?: boolean }
export declare function motionDocument(renderer: PreviewRenderer): DesignDocument;
export declare function motionBase(renderer: PreviewRenderer, doc?: DesignDocument): DesignDocument;
export declare function captureMotion(renderer: PreviewRenderer): Map<string, MotionBaseline>;
export declare function restoreMotion(renderer: PreviewRenderer, baselines: Map<string, MotionBaseline>, options?: {inputs?: boolean}): void;
export declare function patchMotion(renderer: PreviewRenderer, doc: DesignDocument, overrides: AnimationValues, baselines: Map<string, MotionBaseline>, options?: {inputs?: Map<string, Record<string, unknown>>}): DesignDocument;
export declare function motionDiagnostics(doc: DesignDocument): Array<{id: string; line: number; severity: 'warning'; message: string}>;

export * from './docking.js';

export * from './solution.js';
export * from './authoring.js';
export * from './timeline-editing.js';

export * from './html.js';
export * from './html-render.js';
