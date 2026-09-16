# @wieslawsoltes/xamora-code-editor

Standalone editing surface extracted from Xamora Studio. No runtime dependencies, XAML parser, application singleton or document store is required. The package includes ESM/CommonJS entry points, declarations, a standalone browser bundle and scoped CSS.

```js
import { CodeEditor } from '@wieslawsoltes/xamora-code-editor';
import '@wieslawsoltes/xamora-code-editor/assets/code-editor.css';

const editor = new CodeEditor(document.querySelector('#editor'), {
  language: 'JSON',
  languageProvider: {
    validate(source) { JSON.parse(source); },
    format: source => JSON.stringify(JSON.parse(source), null, 2),
  },
  onApply(source) { saveDocument(source); },
});
editor.setValue('{"enabled":true}');
// At teardown: editor.dispose();
```

Give the host a height (for example, 400px). Without a CSS-aware bundler, link the CSS asset and import the `browser` entry instead. Token highlighting escapes text; providers return token objects, never trusted HTML.

The control owns buffer history, find/replace, selection mapping, completion UI, IME notifications and validation timing. Synchronous language-provider methods supply parsing, formatting, completions, extra indentation and line-comment transformations. Optional external undo/redo/validation/completion callbacks preserve application-owned document history. `setValue` refuses dirty-buffer replacement unless `force` is explicit. Apply callbacks can reject by returning false or throwing. `dispose` clears timers, listeners and mounted markup; the caller owns persisted documents.

Use `XamlEditor` from `@wieslawsoltes/xamora-designer/editor` for the existing XAML/HTML language adapter. Its parser dependencies are deliberately not part of this package. The legacy `mapTextSelection` export forwards to the same implementation. This is a lightweight textarea-based editor, not a Monaco replacement: language hooks are synchronous and rendering is not line-virtualized.

See the source example `dist/examples/EditorLab/`. Package preparation does not publish npm releases.
