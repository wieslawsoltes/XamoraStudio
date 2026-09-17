import { notify } from './ui.js';

export const LAYOUT_PREFERENCES_KEY = 'xamora-layout-preferences-v1';
const defaults = Object.freeze({ keepEmptyDocumentGroups: true, showCanvasTips: false });

export function readLayoutPreferences(storage) {
  const result = { ...defaults };
  try {
    const saved = JSON.parse(
      (storage ?? globalThis.localStorage)?.getItem(LAYOUT_PREFERENCES_KEY) || '{}',
    );
    for (const key of Object.keys(result))
      if (typeof saved?.[key] === 'boolean') result[key] = saved[key];
  } catch {}
  return result;
}

/** Per-browser chrome preferences; never written into authored documents or undo history. */
export class LayoutPreferences {
  constructor(studio, { storage } = {}) {
    this.studio = studio;
    this.storage = storage;
    this.value = readLayoutPreferences(storage);
    studio.layoutPreferences = this;
    this.hint = studio.docking.canvas.querySelector('.canvas-hint');
    this.commands = [
      ['keepEmptyDocumentGroups', 'layout:keep-empty-documents', 'Keep empty document panels'],
      ['showCanvasTips', 'layout:canvas-tips', 'Show canvas navigation tips'],
    ].map(([key, id, label]) => ({
      id,
      label,
      checked: () => this.value[key],
      run: () => this.set(key, !this.value[key]),
    }));
    this.menu = studio.menus.menus.find((menu) => menu.label === 'View');
    this.menu?.children.push({ separator: true }, ...this.commands);
    this.separator = this.menu?.children[this.menu.children.length - this.commands.length - 1];
    for (const command of this.commands) studio.menus.commands.set(command.id, command);
    this.apply();
  }
  apply() {
    this.studio.docking.model.setKeepEmptyDocumentGroups(this.value.keepEmptyDocumentGroups);
    if (this.hint) {
      this.hint.hidden = !this.value.showCanvasTips;
      this.hint.dataset.tipsVisible = String(this.value.showCanvasTips);
    }
  }
  set(key, value) {
    if (this.disposed) return false;
    if (!Object.hasOwn(defaults, key) || typeof value !== 'boolean')
      throw TypeError('Unknown or invalid layout preference.');
    if (this.value[key] === value) return false;
    // Validate/apply the model first, so a rejected batch cannot save an unapplied preference.
    if (key === 'keepEmptyDocumentGroups')
      this.studio.docking.model.setKeepEmptyDocumentGroups(value);
    this.value = { ...this.value, [key]: value };
    this.apply();
    try {
      (this.storage ?? globalThis.localStorage)?.setItem(
        LAYOUT_PREFERENCES_KEY,
        JSON.stringify(this.value),
      );
    } catch {
      notify('This layout preference applies now but could not be saved in this browser.');
    }
    return true;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const command of this.commands) {
      if (this.studio.menus.commands.get(command.id) === command)
        this.studio.menus.commands.delete(command.id);
    }
    if (this.menu)
      this.menu.children = this.menu.children.filter(
        (entry) => entry !== this.separator && !this.commands.includes(entry),
      );
    if (this.studio.layoutPreferences === this) delete this.studio.layoutPreferences;
  }
}
