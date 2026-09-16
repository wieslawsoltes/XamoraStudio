export declare class ScrollButtons {
  constructor(viewport: HTMLElement, options?: { label?: string });
  readonly viewport: HTMLElement;
  readonly host: HTMLElement;
  readonly previous: HTMLButtonElement;
  readonly next: HTMLButtonElement;
  update(): void;
  reveal(element: HTMLElement | null): void;
  dispose(): void;
}
