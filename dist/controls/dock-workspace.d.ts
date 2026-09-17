import type {
  DockBrowserWindows,
  DockBrowserWindowOptions,
  OpenDockWindowOptions,
} from './dock-browser-windows.js';
import { DockLayout } from '../core/docking.js';
export interface DockWorkspaceOptions {
  /** Defaults to workspace-scoped shortcuts. Studio opts into document-wide shortcuts. */
  browserWindows?: boolean | DockBrowserWindowOptions;
  keyboardScope?: 'workspace' | 'document';
  beforeActivate?: (id: string) => boolean | void;
  onChange?: (label: string) => void;
  onVisibility?: (id: string, visible: boolean) => void;
}
export declare class DockWorkspace extends EventTarget {
  constructor(host: HTMLElement, model: DockLayout, options?: DockWorkspaceOptions);
  readonly document: Document;
  readonly window: Window;
  readonly windows?: DockBrowserWindows;
  host: HTMLElement;
  model: DockLayout;
  contents: Map<string, HTMLElement>;
  visible: Set<string>;
  flyout: string | null;
  mount(id: string, node: HTMLElement): HTMLElement;
  unmount(id: string): HTMLElement | null;
  render(): void;
  openWindow(ids: string | string[], options?: OpenDockWindowOptions): string | null;
  returnWindow(id: string): boolean;
  move(
    ids: string | string[],
    target?: string | null,
    position?: 'left' | 'right' | 'top' | 'bottom' | 'center',
    index?: number,
  ): boolean;
  dockBack(id: string): boolean;
  query<T extends Element = HTMLElement>(selector: string): T | null;
  queryAll<T extends Element = HTMLElement>(selector: string): T[];
  activate(id: string, options?: { focus?: boolean }): boolean;
  show(id: string): boolean;
  hide(id: string): boolean;
  focus(id: string): void;
  title(id: string): string;
  closeFlyout(): void;
  closeMenu(): void;
  dispose(): void;
}
