export interface MenuEntry {
  label?: string;
  separator?: boolean;
  shortcut?: string;
  enabled?: boolean | (() => boolean);
  checked?: boolean | (() => boolean);
  children?: MenuEntry[] | (() => MenuEntry[]);
  run?: () => void | Promise<void>;
}
export declare class MenuBar {
  constructor(
    host: HTMLElement,
    menus: MenuEntry[],
    options?: { onError?: (error: Error) => void },
  );
  openRoot(index: number, focus?: boolean): void;
  close(restoreFocus?: boolean): void;
  dispose(): void;
}
