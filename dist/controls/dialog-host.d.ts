export interface DialogActionContext {
  host: DialogHost;
  dialog: HTMLElement;
  body: HTMLElement;
  /** Aborted on close/replacement; the callback must cooperate with cancellation. */
  signal: AbortSignal;
}
export interface DialogAction {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  closeOnSuccess?: boolean;
  run(context: DialogActionContext): unknown | Promise<unknown>;
}
export interface DialogOptions {
  title?: string;
  /** Strings are literal text. Elements retain identity and return to their original parent. */
  content?: string | HTMLElement;
  /** Explicitly trusted application HTML only; never use untrusted documents here. */
  html?: string;
  actions?: DialogAction[];
  wide?: boolean;
  cancelLabel?: string | false;
  closeLabel?: string;
  dismissOnEscape?: boolean;
  dismissOnOverlay?: boolean;
  /** Optional caller-owned focus restoration, e.g. a live field in a same-origin popup. */
  returnFocus?: () => void;
  initialFocus?: (dialog: HTMLElement) => HTMLElement | null | undefined;
}
export class DialogHost {
  constructor(host: HTMLElement);
  readonly host: HTMLElement;
  readonly document: Document;
  readonly isOpen: boolean;
  readonly element: HTMLElement | null;
  readonly body: HTMLElement | null;
  readonly disposed: boolean;
  open(options?: DialogOptions): HTMLElement;
  focus(): void;
  /** Updates application-owned availability without clearing an in-flight action lock. */
  setActionDisabled(index: number, disabled: boolean): boolean;
  showError(message: unknown): void;
  close(restoreFocus?: boolean): boolean;
  dispose(): void;
}
