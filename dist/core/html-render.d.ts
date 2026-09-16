import type { DesignDocument } from './index.js';
export declare class HtmlRenderer {
  elements: Map<string, HTMLElement>;
  frame: HTMLIFrameElement | null;
  onLayout?: () => void;
  render(
    document: DesignDocument,
    host: HTMLElement,
    options?: { interactive?: boolean; onReady?: (renderer: HtmlRenderer) => void },
  ): Map<string, HTMLElement>;
  getClientRect(id: string): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
  elementsAtPoint(clientX: number, clientY: number): HTMLElement[];
  dispose(): void;
}
