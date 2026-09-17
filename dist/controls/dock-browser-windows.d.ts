import type { DockRect } from '../core/docking.js';
import type { DockWorkspace } from './dock-workspace.js';
export interface DockBrowserWindow {
  id: string;
  window: Window;
  document: Document;
  host: HTMLElement;
  panels: string[];
}
export interface DockBrowserWindowOptions {
  /** Application ancestor classes required by its scoped panel styles. */
  bodyClass?: string;
  /** Host adapter/testing seam. Must return a new same-origin about:blank Window or null. */
  openWindow?: (features: string, sourceWindow: Window) => Window | null;
  /** Register application query/event portals here; the returned cleanup runs before reclamation completes. */
  onOpen?: (host: DockBrowserWindow) => void | (() => void);
  onClose?: (id: string) => void;
}
export interface OpenDockWindowOptions {
  wholeGroup?: boolean;
  rect?: Partial<DockRect>;
  sourceWindow?: Window;
}
/** Same-origin dependent popup hosts. Layout and live document state stay with the owner workspace. */
export class DockBrowserWindows {
  constructor(control: DockWorkspace, options?: DockBrowserWindowOptions);
  readonly disposed: boolean;
  list(): DockBrowserWindow[];
  pending(): string[];
  open(ids: string | string[], options?: OpenDockWindowOptions): string | null;
  reopen(id: string, options?: OpenDockWindowOptions): string | null;
  focus(id: string): boolean;
  return(id: string): boolean;
  dispose(): void;
}
