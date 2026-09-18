/** Verify the published static bytes, including the nested HTML authoring module. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = process.env.PAGES_URL || 'https://wieslawsoltes.github.io/XamoraStudio/';
const files = [
  'controls/code-viewport.js',
  'examples/VirtualEditorLab/index.html',
  'examples/VirtualEditorLab/lab.js',
  'index.html',
  'app.js',
  'studio/html-workspace.js',
  'core/html.js',
  'styles/density.css',
  'examples/DockingDemo.html',
  'core/document-session.js',
  'core/source-syntax.js',
  'studio/document-sync.js',
  'core/html-animation.js',
  'studio/html-animation-workspace.js',
  'styles/html-animation.css',
  'examples/HtmlMotionLab.html',
  'core/source-text-buffer.js',
  'core/history.js',
  'core/language-service.js',
  'studio/language-workspace.js',
  'core/html-states.js',
  'studio/html-states-workspace.js',
  'styles/html-states.css',
  'examples/HtmlInteractionLab.html',
  'core/web-runtime.js',
  'core/runtime-properties.js',
  'core/runtime-element.js',
  'styles/runtime.css',
  'examples/StandaloneApp/index.html',
  'examples/StandaloneApp/app.js',
  'examples/StandaloneApp/MainView.xaml',
  'core/semantic-compiler.js',
  'core/compiler-selectors.js',
  'core/compiler-environment.js',
  'core/compiler-css.js',
  'core/compiler-logical.js',
  'docs/NATIVE-COMPILER-CI.md',
  'core/compiler-browser.js',
  'core/compiler-resources.js',
  'docs/RESPONSIVE-COMPILER.md',
  'core/conversion-project.js',
  'studio/compiler-workspace.js',
  'styles/compiler.css',
  'examples/WorkspaceLab/index.html',
  'examples/WorkspaceLab/host.js',
  'examples/WorkspaceLab/lab.js',
  'workspaces/workspace-context.js',
  'workspaces/canvas-controller.js',
  'workspaces/animation-editor.js',
  'workspaces/html-workspace.js',
  'workspaces/resource-workspace.js',
  'workspaces/solution-workspace.js',
  'workspaces/data-editor.js',
  'controls/dock-workspace.js',
  'controls/docking.css',
  'controls/code-editor.js',
  'controls/code-editor.css',
  'controls/property-grid.js',
  'controls/object-property-grid.js',
  'controls/object-properties.js',
  'examples/NestedPropertiesLab/index.html',
  'examples/NestedPropertiesLab/lab.js',
  'controls/property-grid.css',
  'controls/dialog-host.js',
  'controls/dialog-host.css',
  'studio/dialog-host.js',
  'studio/jev-workspace.js',
  'styles/jev.css',
  'examples/ControlsLab/index.html',
  'examples/EditorLab/index.html',
  'examples/PropertyGridLab/index.html',
  'examples/DialogLab/index.html',
  'examples/DialogLab/lab.js',
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expected = new Map(
  await Promise.all(
    files.map(async (path) => [
      path,
      digest(await readFile(new URL('../dist/' + path, import.meta.url))),
    ]),
  ),
);
let failure = '';
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    for (const path of files) {
      const url = new URL(path, base);
      url.searchParams.set('verify', process.env.GITHUB_SHA || String(Date.now()));
      const response = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        headers: { 'cache-control': 'no-cache' },
      });
      if (!response.ok) throw Error(path + ': HTTP ' + response.status);
      if (digest(Buffer.from(await response.arrayBuffer())) !== expected.get(path))
        throw Error(path + ': published bytes do not match this commit');
    }
    console.log('Verified ' + files.length + ' deployed files at ' + base);
    process.exit(0);
  } catch (error) {
    failure = error.message;
    console.log('Waiting for Pages (' + (attempt + 1) + '/30): ' + failure);
    if (attempt < 29) await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}
throw Error('Pages publication did not match: ' + failure);
