import type { JevSettings, JevCredentials } from './jev-client.js';
export interface JevStorage {
  getItem(key: string): string | null | undefined;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export declare class JevPreferences {
  constructor(options?: { storage?: JevStorage; sessionStorage?: JevStorage; origin?: string });
  readonly value: JevSettings;
  readonly remember: boolean;
  credentials(): JevCredentials;
  save(
    settings: Partial<JevSettings>,
    keys: JevCredentials,
    remember?: boolean,
    confirmDestination?: boolean,
  ): JevSettings;
  clearKeys(): void;
  dispose(): void;
}
