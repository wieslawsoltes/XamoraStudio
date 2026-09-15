/** Optional custom element adapter. Importing this module does not require a DOM. */
import {createApplication} from './web-runtime.js';
import {ObservableState} from './runtime-properties.js';

const registrations = new WeakMap();

/**
 * Register a self-contained runtime host. Explicit .source wins over the src
 * attribute; otherwise the element loads src or an application/xaml script.
 * Async source changes cannot mount stale fetch results. Removing the element
 * releases subscriptions and clocks; reconnecting mounts the current data.
 */
export function registerXamlElement(name = 'xamora-view', options = {}) {
  const registry = globalThis.customElements;
  const BaseElement = globalThis.HTMLElement;
  if (!registry || !BaseElement) throw new Error('Custom elements require a browser DOM. Register after the DOM is available.');
  if (!/^[a-z][a-z0-9._-]*-[a-z0-9._-]+$/.test(name)) throw new Error('Use a lowercase custom element name containing a hyphen.');
  let registered = registrations.get(registry);
  if (!registered) registrations.set(registry, registered = new Map());
  if (registered.has(name)) return registered.get(name);
  if (registry.get(name)) throw new Error(`The custom element ${name} is already registered by another implementation.`);
  const {shadow = true, source: defaultSource, data: defaultData, ...applicationOptions} = options;

  class XamlViewElement extends BaseElement {
    static get observedAttributes() { return ['src', 'framework']; }

    constructor() {
      super();
      this._source = undefined;
      this._resolvedSource = undefined;
      // Plain defaults are per instance; an explicit ObservableState is shared.
      this._data = defaultData instanceof ObservableState ? defaultData : new ObservableState(defaultData ?? {}).snapshot();
      this._application = null;
      this._generation = 0;
      this._controller = null;
      this._host = null;
      if (shadow) this.attachShadow({mode: 'open'});
    }

    get application() { return this._application; }
    get source() { return this._source ?? this._resolvedSource ?? defaultSource ?? ''; }
    set source(value) {
      if (typeof value !== 'string') throw new TypeError('source must be a XAML string.');
      this._source = value;
      this._queueRefresh();
    }
    get data() {
      const data = this._application?.data ?? this._data ?? {};
      return data instanceof ObservableState ? data.data : data;
    }
    set data(value) {
      if (!value || typeof value !== 'object') throw new TypeError('data must be an object or ObservableState.');
      this._data = value;
      this._queueRefresh();
    }

    connectedCallback() { this._queueRefresh(); }
    disconnectedCallback() { this.dispose(); }
    attributeChangedCallback() { this._queueRefresh(); }

    _queueRefresh() {
      if (this.isConnected) this.reload().catch(() => {});
    }

    async reload() {
      const generation = ++this._generation;
      this._controller?.abort();
      const controller = new AbortController();
      this._controller = controller;
      if (!this.isConnected) return null;
      try {
        let source = this._source;
        if (source === undefined) {
          const src = this.getAttribute('src');
          if (src) {
            const url = new URL(src, this.ownerDocument.baseURI);
            const fetcher = applicationOptions.fetch || globalThis.fetch;
            const response = await fetcher(url, {signal: controller.signal});
            if (!response.ok) throw new Error(`Unable to load ${url}: HTTP ${response.status}.`);
            source = await response.text();
          } else {
            source = defaultSource ?? this.querySelector('script[type="application/xaml"]')?.textContent ?? this._resolvedSource ?? '';
          }
        }
        if (generation !== this._generation || !this.isConnected) return null;
        if (!source.trim()) throw new Error('Provide .source, a src attribute, or an application/xaml script.');
        const framework = this.getAttribute('framework') || applicationOptions.framework;
        const application = createApplication({
          ...applicationOptions,
          ...(framework ? {framework} : {}),
          source,
          data: this._data ?? this._application?.state ?? {}
        });
        const previous = this._application;
        if (!this._host) {
          this._host = this.ownerDocument.createElement('div');
          this._host.setAttribute('part', 'application');
          (this.shadowRoot || this).append(this._host);
        }
        previous?.dispose();
        this._application = null;
        try { application.mount(this._host); }
        catch (error) { application.dispose(); throw error; }
        this._application = application;
        this._resolvedSource = source;
        this._data = application.state;
        this.dispatchEvent(new CustomEvent('xamora-ready', {detail: {application}, bubbles: true, composed: true}));
        return application;
      } catch (error) {
        if (generation !== this._generation || controller.signal.aborted) return null;
        this.dispatchEvent(new CustomEvent('xamora-error', {detail: {error}, bubbles: true, composed: true}));
        throw error;
      } finally {
        if (this._controller === controller) this._controller = null;
      }
    }

    dispose() {
      this._generation++;
      this._controller?.abort();
      this._controller = null;
      if (this._application) this._data = this._application.state;
      this._application?.dispose();
      this._application = null;
    }
  }

  registry.define(name, XamlViewElement);
  registered.set(name, XamlViewElement);
  return XamlViewElement;
}
