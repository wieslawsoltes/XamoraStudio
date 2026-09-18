export declare const JEV_RECIPES: Readonly<
  Record<'blank' | 'login' | 'contact' | 'dashboard' | 'settings' | 'card' | 'list', string>
>;
export declare const JEV_PALETTES: Readonly<
  Record<'neutral' | 'dark' | 'blue' | 'green' | 'violet', readonly string[]>
>;
export declare function jevTemplate(options?: {
  recipe?: keyof typeof JEV_RECIPES;
  framework?: 'HTML' | 'WPF' | 'Avalonia' | 'WinUI';
  palette?: keyof typeof JEV_PALETTES;
  title?: string;
}): string;
