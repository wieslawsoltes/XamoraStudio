import type {
  ObjectPropertyPath,
  ObjectInspectionOptions,
  ObjectCloneOptions,
  ObjectPropertyNode,
} from './object-properties.js';
export interface ObjectPropertyChange {
  readonly path: ObjectPropertyPath;
  readonly operation: 'set' | 'add' | 'remove';
  readonly reset: boolean;
  readonly value: unknown;
  readonly previous: unknown;
  readonly next: unknown;
  readonly grid: ObjectPropertyGrid;
}
export interface ObjectPropertyGridOptions extends ObjectInspectionOptions, ObjectCloneOptions {
  value?: unknown;
  defaultValue?: unknown;
  filter?: string;
  expandedDepth?: number;
  allowStructureChanges?: boolean;
  /** Controls whether type selectors appear. Applications may still call setProperty. */
  allowTypeChanges?: boolean;
  onChange?: (change: ObjectPropertyChange) => void | boolean | string;
}
export class ObjectPropertyGrid {
  constructor(host: HTMLElement, options?: ObjectPropertyGridOptions);
  readonly host: HTMLElement;
  readonly value: unknown;
  readonly disposed: boolean;
  filter: string;
  onChange?: ObjectPropertyGridOptions['onChange'];
  describe(value?: unknown): ObjectPropertyNode;
  setValue(value: unknown): boolean;
  setFilter(filter: string): void;
  setExpanded(path: ObjectPropertyPath, expanded: boolean): boolean;
  setProperty(path: ObjectPropertyPath, value: unknown): boolean;
  addProperty(parentPath: ObjectPropertyPath, name: string, value: unknown): boolean;
  removeProperty(path: ObjectPropertyPath): boolean;
  reset(path: ObjectPropertyPath): boolean;
  dispose(): void;
}
