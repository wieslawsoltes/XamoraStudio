import { CodeEditor } from '../../controls/code-editor.js';
const editor = new CodeEditor(document.querySelector('#editor'), {
  language: 'JSON',
  languageProvider: {
    validate(source) { JSON.parse(source); },
    format: source => JSON.stringify(JSON.parse(source), null, 2),
    complete: (source, caret) => [{ label: 'true', detail: 'Boolean literal', insertText: 'true', start: caret, end: caret }],
  },
  onApply(source) { document.querySelector('#result').textContent = `Applied ${source.length} characters`; },
});
editor.setValue('{"title":"Reusable editor","enabled":true}');
for (const command of ['format', 'find', 'apply']) document.querySelector('#' + command).onclick = () => editor[command]();
document.querySelector('#readonly').onchange = event => editor.setReadOnly(event.target.checked);
window.editorLab = editor;
