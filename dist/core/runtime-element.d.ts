import type {ApplicationOptions, XamlApplication} from './web-runtime.js';
import type {ObservableState} from './runtime-properties.js';

/** Defaults passed to each hosted application. Shadow DOM is enabled by default. */
export type XamlElementOptions<T extends object = Record<string, unknown>> = ApplicationOptions<T> & {
  shadow?: boolean;
};

export interface XamlViewElement<T extends object = Record<string, unknown>> extends HTMLElement {
  /** The currently mounted application; null after disconnection or disposal. */
  readonly application: XamlApplication<T> | null;
  /** Explicit source overrides src. Changes reload while connected. */
  source: string;
  /** Data survives disconnection. Assigning a new root remounts the application. */
  get data(): T;
  set data(value: T | ObservableState<T>);
  /** Reload current source/src, rejecting load errors and emitting xamora-error. */
  reload(): Promise<XamlApplication<T> | null>;
  /** Stop clocks, unsubscribe and abort pending source loads. */
  dispose(): void;
}

export interface XamlViewElementConstructor<T extends object = Record<string, unknown>> {
  new (): XamlViewElement<T>;
  readonly observedAttributes: readonly string[];
}

/** DOM-safe to import in Node; call only when customElements/HTMLElement exist. */
export function registerXamlElement<T extends object = Record<string, unknown>>(name?: string, options?: XamlElementOptions<T>): XamlViewElementConstructor<T>;
