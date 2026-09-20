export interface OutlineItem {
  id: string;
  parentId?: string | null;
  label: string;
  detail?: string;
  kind?: string;
}
export interface OutlineViewState {
  collapsed?: readonly string[];
  selectedId?: string | null;
  activeId?: string | null;
  query?: string;
  scrollTop?: number;
}
export class OutlineTree {
  constructor(
    host: HTMLElement,
    options?: {
      /** Parents must precede children; data is copied, never mutated. */
      items?: readonly OutlineItem[];
      label?: string;
      rowHeight?: number;
      overscan?: number;
      onSelect?: (id: string) => unknown;
      onActivate?: (id: string) => unknown;
      onError?: (error: unknown) => void;
    },
  );
  readonly element: HTMLElement;
  readonly selectedId: string | null;
  readonly activeId: string | null;
  readonly matchCount: number;
  readonly disposed: boolean;
  getState(): OutlineViewState;
  restoreState(state?: OutlineViewState): void;
  setRowHeight(value: number): void;
  setItems(items: readonly OutlineItem[]): void;
  setFilter(query: string): void;
  setCollapsed(id: string, collapsed?: boolean): boolean;
  expandAll(): void;
  collapseAll(): void;
  select(id: string | null, options?: { notify?: boolean; reveal?: boolean }): boolean;
  activate(id?: string): void;
  reveal(id: string): void;
  focus(id?: string): void;
  render(): void;
  dispose(): void;
}
