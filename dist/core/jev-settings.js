import { jevSettings } from './jev-client.js';
const SETTINGS = 'xamora-jev-settings-v1';
const KEYS = 'xamora-jev-session-keys-v1';
/** Preferences never contain credentials; remembering keys is an explicit, endpoint-bound tab session opt-in. */
export class JevPreferences {
  #keys = {};
  constructor({ storage, sessionStorage, origin } = {}) {
    this.storage = storage;
    this.sessionStorage = sessionStorage;
    this.origin = origin;
    this.remember = false;
    try {
      this.value = jevSettings(JSON.parse(storage?.getItem(SETTINGS) || '{}'), origin);
    } catch {
      this.value = jevSettings({}, origin);
    }
    try {
      const saved = JSON.parse(sessionStorage?.getItem(KEYS) || 'null');
      if (
        saved &&
        saved.endpoint === this.value.endpoint &&
        saved.generatorEndpoint === this.value.generatorEndpoint
      ) {
        this.#keys = this.validateKeys(saved.keys);
        this.remember = true;
      } else sessionStorage?.removeItem(KEYS);
    } catch {
      try {
        sessionStorage?.removeItem(KEYS);
      } catch {}
    }
  }
  validateKeys(keys = {}) {
    const result = {};
    for (const key of ['apiKey', 'generatorKey', 'proxyToken']) {
      const value = keys[key] || '';
      if (typeof value !== 'string' || value.length > 4096 || /[\r\n\x00]/.test(value))
        throw Error('Invalid credential.');
      result[key] = value.trim();
    }
    return result;
  }
  /** Only the explicitly constructed transport consumes this snapshot. Never serialize it into a project. */
  credentials() {
    return { ...this.#keys };
  }
  save(settings, keys, remember = false, confirmDestination = false) {
    const next = jevSettings(settings, this.origin),
      secrets = this.validateKeys(keys);
    const changed =
      next.endpoint !== this.value.endpoint ||
      next.generatorEndpoint !== this.value.generatorEndpoint;
    if (changed && !confirmDestination) {
      if (secrets.proxyToken && secrets.proxyToken === this.#keys.proxyToken)
        throw Error(
          'An endpoint changed. Confirm the new destination before forwarding the existing proxy access token.',
        );
      if (
        next.endpoint !== this.value.endpoint &&
        secrets.apiKey === this.#keys.apiKey &&
        secrets.apiKey
      )
        throw Error(
          'The Jev endpoint changed. Clear and re-enter its key to confirm the new destination.',
        );
      if (
        next.generatorEndpoint !== this.value.generatorEndpoint &&
        secrets.generatorKey === this.#keys.generatorKey &&
        secrets.generatorKey
      )
        throw Error(
          'The generator endpoint changed. Clear and re-enter its key to confirm the new destination.',
        );
    }
    // Remove old persisted keys even if storing new preferences fails.
    this.sessionStorage?.removeItem(KEYS);
    this.storage?.setItem(SETTINGS, JSON.stringify(next));
    if (remember)
      this.sessionStorage?.setItem(
        KEYS,
        JSON.stringify({
          endpoint: next.endpoint,
          generatorEndpoint: next.generatorEndpoint,
          keys: secrets,
        }),
      );
    this.value = next;
    this.#keys = secrets;
    this.remember = remember;
    return next;
  }
  clearKeys() {
    this.#keys = {};
    this.remember = false;
    this.sessionStorage?.removeItem(KEYS);
  }
  dispose() {
    this.#keys = {};
  }
}
