/** Compatibility adapter: XAML/HTML semantics over the standalone editing surface. */
import { CodeEditor } from '../controls/code-editor.js';
import { parseHtml, completeHtml, formatHtml } from './html.js';
import { completeXaml } from './xaml-language.js';
import { serializeXaml, parseXaml } from './xaml.js';
export { mapTextSelection } from '../controls/code-editor.js';

export function createMarkupLanguageProvider(language = 'XAML', registry) {
  return {
    validate: (source) => {
      (language === 'HTML' ? parseHtml : parseXaml)(source);
    },
    format: (source) =>
      language === 'HTML' ? formatHtml(source) : serializeXaml(parseXaml(source)),
    complete: (source, caret, context) =>
      language === 'HTML'
        ? completeHtml(source, caret)
        : completeXaml(source, caret, { registry, ...context }),
    indent: (before) => (/<[^/!?][^>]*>$/.test(before) && !before.endsWith('/>') ? '    ' : ''),
    toggleComment: (text) =>
      text.trim().startsWith('<!--')
        ? text.replace('<!--', '').replace('-->', '').trim()
        : `<!-- ${text} -->`,
    tokenize: (source) =>
      source
        .split(/(<!--[^]*?-->|"[^"\n]*"|'[^'\n]*'|<\/?[\w:.-]+|\/?>|[\w:.-]+(?=\s*=))/g)
        .map((text) => ({
          text,
          kind: text.startsWith('<!--')
            ? 'comment'
            : text[0] === '"' || text[0] === "'"
              ? 'string'
              : text[0] === '<' || text === '>' || text === '/>'
                ? 'tag'
                : /^[\w:.-]+$/.test(text)
                  ? 'attr'
                  : undefined,
        })),
  };
}
export class XamlEditor extends CodeEditor {
  constructor(host, options = {}) {
    super(host, { ...options, language: options.language || 'XAML' });
    this.registry = options.registry;
  }
  getLanguageProvider() {
    return createMarkupLanguageProvider(this.language || 'XAML', this.registry);
  }
}
