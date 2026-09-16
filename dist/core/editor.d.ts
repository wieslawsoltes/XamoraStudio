import { CodeEditor } from '../controls/code-editor.js';
import type { CodeEditorOptions, CodeLanguageProvider } from '../controls/code-editor.js';
import { ToolkitRegistry } from './registry.js';
export { mapTextSelection } from '../controls/code-editor.js';
export declare function createMarkupLanguageProvider(
  language?: string,
  registry?: ToolkitRegistry,
): CodeLanguageProvider;
export declare class XamlEditor extends CodeEditor {
  constructor(host: HTMLElement, options?: CodeEditorOptions & { registry?: ToolkitRegistry });
  registry?: ToolkitRegistry;
  getLanguageProvider(): CodeLanguageProvider;
}
