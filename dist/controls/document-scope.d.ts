/** Explicit routing to registered portal roots, not arbitrary global documents. */
export declare class DocumentScope {
  constructor(document: Document, workspace?: HTMLElement | null);
  readonly document: Document;
  readonly window: Window;
  readonly disposed: boolean;
  readonly activeElement: Element | null;
  add(
    document: Document,
    options?: { root?: Document | HTMLElement; workspace?: HTMLElement | Document },
  ): () => void;
  listen(
    target: EventTarget,
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
  query(selector: string): Element | null;
  all(selector: string): Element[];
  owns(target: Node): boolean;
  frame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
  dispose(): void;
}
