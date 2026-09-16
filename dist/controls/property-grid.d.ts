export type PropertyGridValue = string | number | boolean | undefined;
export interface PropertyGridChoice {
  value: string | number | boolean;
  label?: string;
}
export interface PropertyGridField {
  name: string;
  label?: string;
  value?: PropertyGridValue;
  defaultValue?: PropertyGridValue;
  type?: 'text' | 'number' | 'boolean' | 'color';
  options?: readonly (string | number | boolean | PropertyGridChoice)[];
  group?: string;
  full?: boolean;
  readOnly?: boolean;
  mixed?: boolean;
  resettable?: boolean;
  required?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  validate?: (
    value: PropertyGridValue,
    property: Readonly<PropertyGridField>,
  ) => void | boolean | string;
}
export interface PropertyGridChange {
  readonly property: Readonly<PropertyGridField>;
  readonly name: string;
  readonly value: PropertyGridValue;
  readonly previous: PropertyGridValue;
  readonly reset: boolean;
  readonly grid: PropertyGrid;
}
export interface PropertyGridOptions {
  properties?: readonly PropertyGridField[];
  onChange?: (change: PropertyGridChange) => void | boolean | string;
  onReset?: (change: PropertyGridChange) => void | boolean | string;
  /** Custom renderers are trusted application code. Include one root and a data-prop input. */
  fieldRenderer?: (property: Readonly<PropertyGridField>) => string;
  /** External mode leaves native change/reset events for an application-owned transaction adapter. */
  eventMode?: 'managed' | 'external';
  searchable?: boolean;
  filter?: string;
}
export declare function renderPropertyField(
  property: Readonly<PropertyGridField>,
  options?: { legacy?: boolean },
): string;
export declare class PropertyGrid {
  constructor(host: HTMLElement, options?: PropertyGridOptions);
  readonly host: HTMLElement;
  readonly properties: readonly Readonly<PropertyGridField>[];
  readonly disposed: boolean;
  filter: string;
  onChange?: PropertyGridOptions['onChange'];
  onReset?: PropertyGridOptions['onReset'];
  getProperty(name: string): Readonly<PropertyGridField> | undefined;
  getValue(name: string): PropertyGridValue;
  setProperties(properties: readonly PropertyGridField[]): boolean;
  setValue(name: string, value: PropertyGridValue): boolean;
  setFilter(filter: string): void;
  reset(name: string): boolean;
  dispose(): void;
}
