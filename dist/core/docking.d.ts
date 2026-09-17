export type DockEdge = 'left' | 'right' | 'top' | 'bottom';
export type DockPosition = DockEdge | 'center';
export interface DockRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DockPanelDescriptor {
  id: string;
  title?: string;
  minWidth?: number;
  minHeight?: number;
  kind?: 'tool' | 'document';
  icon?: string;
  documentId?: string;
  onClose?: () => boolean | void;
}
export interface DockGroup {
  type: 'group';
  id: string;
  kind: 'tool' | 'document';
  panels: string[];
  active: string | null;
}
export interface DockSplit {
  type: 'split';
  id: string;
  axis: 'horizontal' | 'vertical';
  ratio: number;
  first: DockNode;
  second: DockNode;
}
export type DockNode = DockGroup | DockSplit;
export interface DockFloating {
  id: string;
  root: DockNode;
  rect: DockRect;
  maximized: boolean;
  /** Requested popup host; restored layouts remain in-page until a user explicitly reopens it. */
  browserWindow?: DockRect;
}
export interface DockPlacement {
  groupId: string;
  index: number;
  edge: DockEdge;
  kind?: 'tool' | 'document';
  floatingRect?: DockRect;
}
export interface DockLayoutState {
  version: 1;
  modeRestore?: DockLayoutState;
  root: DockNode | null;
  floating: DockFloating[];
  autoHide: Record<DockEdge, string[]>;
  autoHideSize?: Partial<Record<DockEdge, number>>;
  hidden: string[];
  activePanel: string | null;
  placements: Record<string, DockPlacement>;
  pinned: string[];
  zoomedGroup: string | null;
}
export type DockLocation =
  | { kind: 'group'; group: DockGroup; index: number; floating: DockFloating | null }
  | { kind: 'autoHide'; edge: DockEdge; index: number }
  | { kind: 'hidden' };
export declare function dockGroup(
  panels?: string[],
  kind?: 'tool' | 'document',
  id?: string,
): DockGroup;
export declare function dockSplit(
  axis: 'horizontal' | 'vertical',
  first: DockNode,
  second: DockNode,
  ratio?: number,
  id?: string,
): DockSplit;
export declare function walkDock(
  node: DockNode | null,
  visit: (node: DockNode, parent: DockNode | null) => void,
  parent?: DockNode | null,
): void;
export declare function findDock(layout: DockLayoutState, id: string): DockNode | null;
export declare function dockGroups(layout: Pick<DockLayoutState, 'root' | 'floating'>): DockGroup[];
export declare function locatePanel(layout: DockLayoutState, id: string): DockLocation | null;
export declare function clampFloat(
  rect: Partial<DockRect>,
  width?: number,
  height?: number,
): DockRect;
export declare function validateDockLayout(layout: unknown, known?: Set<string>): DockLayoutState;
export declare function createDockLayout(
  panelIds: string[],
  options?: {
    documents?: string[];
    preset?: 'designer' | 'coding' | 'animation' | 'compact';
    keepEmptyDocumentGroups?: boolean;
  },
): DockLayoutState;
export interface DockLayoutOptions {
  /** Preserve docked empty document groups. Defaults to false for standalone compatibility. */
  keepEmptyDocumentGroups?: boolean;
}
export declare class DockLayout extends EventTarget {
  constructor(
    panels?: Array<DockPanelDescriptor | string>,
    layout?: DockLayoutState | null,
    options?: DockLayoutOptions,
  );
  readonly keepEmptyDocumentGroups: boolean;
  setKeepEmptyDocumentGroups(value: boolean): boolean;
  pruneEmptyGroups(): boolean;
  panels: Map<string, DockPanelDescriptor>;
  state: DockLayoutState;
  history: DockLayoutState[];
  future: DockLayoutState[];
  transaction(
    label: string,
    action: (draft: DockLayoutState) => void,
    options?: { history?: boolean },
  ): boolean;
  batch(label: string, action: (model: DockLayout) => void): boolean;
  register(panel: DockPanelDescriptor): string;
  unregister(id: string): void;
  activate(id: string): boolean;
  show(id: string): boolean;
  hide(ids: string | string[]): boolean;
  dock(
    ids: string | string[],
    targetId: string | null,
    position?: DockPosition,
    index?: number,
    options?: { activate?: boolean },
  ): boolean;
  float(ids: string | string[], rect?: DockRect): boolean;
  dockBack(id: string): boolean;
  autoHide(ids: string | string[], edge?: DockEdge): boolean;
  setAutoHideSize(edge: DockEdge, size: number): boolean;
  resizeSplit(id: string, ratio: number): boolean;
  setFloatRect(id: string, rect: DockRect): boolean;
  setBrowserWindow(id: string, rect: DockRect | null, options?: { history?: boolean }): boolean;
  raiseFloat(id: string): boolean;
  maximizeFloat(id: string): boolean;
  zoomGroup(id: string | null): boolean;
  pin(id: string): boolean;
  undo(): boolean;
  redo(): boolean;
  serialize(): string;
  load(layout: string | DockLayoutState, options?: { reconcile?: boolean }): boolean;
}

export declare function dockMinimum(
  node: DockNode | null,
  panels: Map<string, DockPanelDescriptor>,
  options?: { chromeHeight?: number },
): { width: number; height: number };
export declare function dockRatioLimits(
  node: DockSplit,
  panels: Map<string, DockPanelDescriptor>,
  size: number,
  options?: { chromeHeight?: number },
): [number, number];
