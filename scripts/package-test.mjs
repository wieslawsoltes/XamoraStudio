import { npmInvocation } from './package-process.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { graph, root } from './package-graph.mjs';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, cwd, label) {
  if (command === npm) ({ command, args } = npmInvocation(args));
  const r = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
  assert.equal(r.status, 0, `${label}\n${r.stdout || ''}${r.stderr || ''}${r.error || ''}`);
  return r.stdout;
}
const current = await graph();
const temporary = await mkdtemp(join(tmpdir(), 'xamora-packages-'));
try {
  const tarballs = [];
  for (const entry of current.entries) {
    const manifest = JSON.parse(await readFile(join(entry.directory, 'package.json'), 'utf8'));
    const packed = JSON.parse(
      run(
        npm,
        ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary],
        entry.directory,
        `pack ${entry.name}`,
      ),
    )[0];
    assert.equal(packed.name, manifest.name);
    assert.equal(packed.version, manifest.version);
    const files = new Set(packed.files.map((item) => item.path));
    for (const path of [
      'dist/esm/index.js',
      'dist/esm/index.d.ts',
      'dist/cjs/index.cjs',
      'dist/cjs/index.d.cts',
      'README.md',
      'LICENSE',
    ])
      assert(files.has(path), `${entry.name} missing ${path}`);
    const leaves = (value) =>
      typeof value === 'string' ? [value] : Object.values(value).flatMap(leaves);
    for (const value of Object.values(manifest.exports))
      for (const path of leaves(value))
        assert(files.has(path.replace(/^\.\//, '')), `${entry.name} missing export ${path}`);
    for (const path of files)
      assert(
        !/(^|\/)(node_modules|tests|test-results|\.git)(\/|$)/.test(path),
        `Unexpected tarball content ${path}`,
      );
    tarballs.push(join(temporary, packed.filename));
  }
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: 'xamora-package-consumer',
      version: '1.0.0',
      private: true,
      type: 'module',
    }),
  );
  run(
    npm,
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', ...tarballs],
    consumer,
    'install actual tarballs outside checkout',
  );
  // Each package must also work with only its declared transitive dependencies.
  const byName = new Map(
    current.entries.map((entry, index) => [entry.name, { entry, tarball: tarballs[index] }]),
  );
  for (const entry of current.entries) {
    const closure = new Set();
    async function collect(name) {
      if (closure.has(name)) return;
      closure.add(name);
      const p = JSON.parse(
        await readFile(join(byName.get(name).entry.directory, 'package.json'), 'utf8'),
      );
      for (const dep of Object.keys(p.dependencies || {})) if (byName.has(dep)) await collect(dep);
    }
    await collect(entry.name);
    const isolated = join(temporary, 'isolated-' + entry.id);
    await mkdir(isolated);
    await writeFile(
      join(isolated, 'package.json'),
      JSON.stringify({
        name: 'isolated-' + entry.id,
        version: '1.0.0',
        private: true,
        type: 'module',
      }),
    );
    run(
      npm,
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        ...[...closure].map((name) => byName.get(name).tarball),
      ],
      isolated,
      `install declared dependency closure ${entry.name}`,
    );
    await writeFile(
      join(isolated, 'consumer.ts'),
      `import * as api from ${JSON.stringify(entry.name)}; void api;\n`,
    );
    run(
      process.execPath,
      [
        resolve(root, 'node_modules/typescript/bin/tsc'),
        '--ignoreConfig',
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--lib',
        'ES2022,DOM',
        'consumer.ts',
      ],
      isolated,
      `isolated strict types ${entry.name}`,
    );
    run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import * as api from ${JSON.stringify(entry.name)};if(!api)throw Error('Import failed');`,
      ],
      isolated,
      `isolated runtime import ${entry.name}`,
    );
  }
  for (const entry of current.entries) {
    const manifest = JSON.parse(await readFile(join(entry.directory, 'package.json'), 'utf8'));
    for (const subpath of Object.keys(manifest.exports)) {
      if (subpath === '.' || !manifest.exports[subpath]?.import) continue;
      const specifier = entry.name + subpath.slice(1);
      run(
        process.execPath,
        ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)});`],
        consumer,
        `ESM subpath ${specifier}`,
      );
      run(
        process.execPath,
        ['-e', `require(${JSON.stringify(specifier)});`],
        consumer,
        `CommonJS subpath ${specifier}`,
      );
    }
  }
  if (byName.has('@wieslawsoltes/xamora-compiler')) {
    const input = join(consumer, 'source');
    await mkdir(join(input, 'images'), { recursive: true });
    await writeFile(
      join(input, 'view.xaml'),
      '<StackPanel xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><TextBlock Text="Packed CLI"/><Image Source="images/logo.png"/></StackPanel>',
    );
    const asset = Buffer.from([137, 80, 78, 71, 0, 255]);
    await writeFile(join(input, 'images/logo.png'), asset);
    const bin =
      process.platform === 'win32'
        ? join(consumer, 'node_modules/@wieslawsoltes/xamora-compiler/dist/esm/cli/index.js')
        : join(consumer, 'node_modules/.bin/xamora-convert');
    run(
      process.execPath,
      [bin, input, '--to', 'html', '--out-dir', join(consumer, 'html')],
      consumer,
      'installed compiler bin XAML and assets',
    );
    assert.match(await readFile(join(consumer, 'html/view.html'), 'utf8'), /Packed CLI/);
    assert.deepEqual(await readFile(join(consumer, 'html/images/logo.png')), asset);
    run(
      process.execPath,
      [
        bin,
        join(consumer, 'html'),
        '--from',
        'html',
        '--to',
        'xaml',
        '--out-dir',
        join(consumer, 'roundtrip'),
      ],
      consumer,
      'installed compiler bin HTML parsing',
    );
    assert.match(await readFile(join(consumer, 'roundtrip/view.xaml'), 'utf8'), /Packed CLI/);
  }
  for (const mode of ['esm', 'cjs']) {
    const script =
      mode === 'esm'
        ? `import * as old from '@wieslawsoltes/xamora-controls'; import * as dock from '@wieslawsoltes/xamora-docking'; import * as primitives from '@wieslawsoltes/xamora-control-primitives'; import * as editor from '@wieslawsoltes/xamora-code-editor'; import * as properties from '@wieslawsoltes/xamora-property-grid'; import * as dialogs from '@wieslawsoltes/xamora-dialogs';`
        : `const old = require('@wieslawsoltes/xamora-controls'), dock = require('@wieslawsoltes/xamora-docking'), primitives = require('@wieslawsoltes/xamora-control-primitives'), editor = require('@wieslawsoltes/xamora-code-editor'), properties = require('@wieslawsoltes/xamora-property-grid'), dialogs = require('@wieslawsoltes/xamora-dialogs');`;
    run(
      process.execPath,
      [
        ...(mode === 'esm' ? ['--input-type=module'] : []),
        '-e',
        script +
          `
      if (old.DockBrowserWindows !== dock.DockBrowserWindows || old.DocumentScope !== primitives.DocumentScope || old.DockLayout !== dock.DockLayout || old.DockWorkspace !== dock.DockWorkspace || old.ScrollButtons !== primitives.ScrollButtons || old.CodeEditor !== editor.CodeEditor || old.PropertyGrid !== properties.PropertyGrid || old.DialogHost !== dialogs.DialogHost) throw Error('Compatibility facade duplicated a constructor');
      const layout = new dock.DockLayout(['first', 'second']); layout.float('first'); layout.undo();
    `,
      ],
      consumer,
      `${mode} control facade identity`,
    );
  }
  const names = current.entries.map((entry) => entry.name);
  for (const mode of ['esm', 'cjs']) {
    const imports = names
      .map((name, index) =>
        mode === 'esm'
          ? `import * as p${index} from ${JSON.stringify(name)};`
          : `const p${index}=require(${JSON.stringify(name)});`,
      )
      .join('\n');
    const body = `${mode === 'esm' ? "import assert from 'node:assert/strict';" : "const assert=require('node:assert/strict');"}\n${imports}\nconst model=p${names.indexOf('@wieslawsoltes/xamora-model')}; const sdk=p${names.indexOf('@wieslawsoltes/xamora')};\nassert.equal(model.DocumentStore,sdk.DocumentStore);assert.equal(model.ToolkitRegistry,sdk.ToolkitRegistry);\nconst document=model.createDocument(model.element('Grid'));const store=new model.DocumentStore(document);store.setProperty([document.root.id],'Width',120);assert.equal(store.document.root.props.Width,'120');store.undo();assert.equal(store.document.root.props.Width,undefined);\nassert.equal(typeof p${names.indexOf('@wieslawsoltes/xamora-runtime')}.mountXaml,'function');\nconsole.log('${mode.toUpperCase()} imports, shared class identity, document transactions: passed');\n`;
    await writeFile(join(consumer, mode === 'esm' ? 'consumer.mjs' : 'consumer.cjs'), body);
    process.stdout.write(
      run(
        process.execPath,
        [mode === 'esm' ? 'consumer.mjs' : 'consumer.cjs'],
        consumer,
        `${mode} consumer`,
      ),
    );
  }
  const typeConsumer = `import {DockWorkspace, DockBrowserWindows, DockLayout, type DockBrowserWindowOptions} from '@wieslawsoltes/xamora-docking';
import {DocumentScope} from '@wieslawsoltes/xamora-control-primitives';
import {WorkspaceContext} from '@wieslawsoltes/xamora-workspace-context';
const scope = new DocumentScope(globalThis.document, globalThis.document.body);
const browserOptions: DockBrowserWindowOptions = {onOpen(info) { return scope.add(info.document, {root:info.host,workspace:info.host}); }};
const docking = new DockWorkspace(globalThis.document.body, new DockLayout(['doc']), {browserWindows:browserOptions});
const windowId:string|null=docking.openWindow('doc',{rect:{width:640},wholeGroup:true});
if(windowId) docking.returnWindow(windowId);
const windows:DockBrowserWindows|undefined = docking.windows; void windows;
new WorkspaceContext({root:globalThis.document,domScope:scope});
// @ts-expect-error Popup adapters return a Window, not a panel identifier.
const invalidBrowser:DockBrowserWindowOptions={openWindow:()=> 'unsafe'};
import {cssBoxLonghands, physicalCssProperty, cssBoxFamily, type CssFlowContext} from '@wieslawsoltes/xamora-compiler/compiler-logical';
const flow: CssFlowContext = {direction:'rtl','writing-mode':'horizontal-tb'};
const physical: string|null = physicalCssProperty('padding-inline-start', flow);
const expanded: string[]|null = cssBoxLonghands('padding-inline');
const family: string|null = cssBoxFamily('inline-size',flow); void [physical,expanded,family];
// @ts-expect-error Flow inputs are strings, not a numeric direction.
physicalCssProperty('inline-size', {direction:2});
import {compileRenderedDocument, observeRenderedDocument} from '@wieslawsoltes/xamora-compiler';
compileRenderedDocument(globalThis.document.body, {includePasswordValues:false});
observeRenderedDocument(globalThis.document.body, {includePasswordValues:false, onResult(result) {void result.source;}}).dispose();
// @ts-expect-error Password capture must be an explicit boolean.
compileRenderedDocument(globalThis.document.body, {includePasswordValues:'false'});
import { ObjectPropertyGrid, type ObjectPropertyChange, editObjectProperty } from '@wieslawsoltes/xamora-property-grid';
const nestedGrid = new ObjectPropertyGrid(globalThis.document.createElement('div'), {value:{items:[1]},onChange(change:ObjectPropertyChange){void change.path;return true;}});
nestedGrid.setProperty(['items',0],2); nestedGrid.addProperty([], 'nested', {value:true}); nestedGrid.dispose();
editObjectProperty({a:1},['a'],2);
// @ts-expect-error Property paths are segments, not a dotted string.
editObjectProperty({}, 'a.b', 1);
import { type CanvasWorkspaceHost } from '@wieslawsoltes/xamora-workspace-context';
import { CanvasController } from '@wieslawsoltes/xamora-canvas-workspace';
import { BlendFeatures, TimelineWorkspace } from '@wieslawsoltes/xamora-motion-workspace';
import { SolutionWorkspace } from '@wieslawsoltes/xamora-solution-workspace';
import { RichProperties, ResourceWorkspace } from '@wieslawsoltes/xamora-resource-workspace';
import { DataEditor } from '@wieslawsoltes/xamora-data-workspace';
import { HtmlWorkspace } from '@wieslawsoltes/xamora-html-workspace';
declare const workspaceHost: CanvasWorkspaceHost;
new CanvasController(workspaceHost, {root: globalThis.document.body}).dispose();
// @ts-expect-error A document-aware host is required.
new CanvasController({});
void [BlendFeatures, TimelineWorkspace, SolutionWorkspace, RichProperties, ResourceWorkspace, DataEditor, HtmlWorkspace];
import { DialogHost, type DialogOptions } from '@wieslawsoltes/xamora-dialogs';
import { DialogHost as CompatibleDialog } from '@wieslawsoltes/xamora-controls';
const dialogOptions: DialogOptions = { title: 'Review', actions: [{ label: 'Save', async run(context) { const signal: AbortSignal = context.signal; void signal; } }] };
const dialogHost: CompatibleDialog = new DialogHost(globalThis.document.createElement('div')); dialogHost.open(dialogOptions); dialogHost.setActionDisabled(0, true); dialogHost.dispose();
// @ts-expect-error An action callback is required.
const invalidDialog: DialogOptions = { actions: [{ label: 'Missing callback' }] };
import { PropertyGrid, type PropertyGridField } from '@wieslawsoltes/xamora-property-grid';
import { PropertyGrid as CompatibleGrid, CodeEditor as CompatibleEditor } from '@wieslawsoltes/xamora-controls';
const fields: PropertyGridField[] = [{ name: 'Width', type: 'number', value: 100, min: 0, validate(value) { return typeof value === 'number'; } }];
const grid: CompatibleGrid = new PropertyGrid(globalThis.document.createElement('div'), { properties: fields, onChange(change) { void [change.name, change.value, change.reset]; return true; } });
grid.setValue('Width', 120); grid.dispose();
// @ts-expect-error PropertyGrid fields use scalar values, not arbitrary objects.
const invalidField: PropertyGridField = { name: 'Width', value: {} };
void [grid, CompatibleEditor];
import { CodeEditor, type CodeLanguageProvider } from '@wieslawsoltes/xamora-code-editor';
import { XamlEditor } from '@wieslawsoltes/xamora-designer/editor';
const languageProvider: CodeLanguageProvider = { validate(source) { JSON.parse(source); }, format: source => JSON.stringify(JSON.parse(source), null, 2) };
const editorHost = globalThis.document.createElement('div');
const editor = new CodeEditor(editorHost, { virtualization: { threshold: 1000, overscan: 8 }, language: 'JSON', languageProvider, onChange(source, options) { void [source, options.composing]; } });
editor.refreshLayout(); editor.setVirtualization(true); const rendered: number = editor.viewport.renderedLines; void rendered;
const markupEditor: CodeEditor = new XamlEditor(editorHost); void [editor, markupEditor];
// @ts-expect-error provider formatter must return text
const invalidProvider: CodeLanguageProvider = { format: () => 42 };
import {markupCompletionContext, htmlChildNamespace, type MarkupCompletionContext} from '@wieslawsoltes/xamora-markup/markup-context';
const completionContext: MarkupCompletionContext = markupCompletionContext('<svg><', 6, {html:true});
const childNamespace: string = htmlChildNamespace(completionContext.stack.at(-1)); void childNamespace;
// @ts-expect-error Completion offsets are UTF-16 numbers, not strings.
markupCompletionContext('<Grid', '5');
import {DocumentStore,createDocument,element,type DesignDocument} from '@wieslawsoltes/xamora-model';\nimport {DocumentSession} from '@wieslawsoltes/xamora-markup';\nimport {ToolkitRegistry} from '@wieslawsoltes/xamora';\nimport {mountXaml} from '@wieslawsoltes/xamora-runtime';\nimport {mountXaml as browserMount} from '@wieslawsoltes/xamora-runtime/browser';\nimport type {DocumentStore as StoreContract} from '@wieslawsoltes/xamora-contracts';\n// @ts-expect-error Contracts are type-only, not runtime constructors.\nnew StoreContract();\nvoid browserMount;\nconst document:DesignDocument=createDocument(element('Grid'));const store=new DocumentStore(document);store.setProperty([document.root.id],'Width',120);\n// @ts-expect-error Objects cannot be assigned as scalar properties.\nstore.setProperty([document.root.id],'Width',{});\nconst registry:ToolkitRegistry=new ToolkitRegistry();registry.registerControl({type:'CustomCard',category:'Custom',mount({application,element}){application.setData('Mounted',true);const handler=()=>application.invalidate();element.addEventListener('click',handler);return()=>element.removeEventListener('click',handler);}});void[store,registry,DocumentSession,mountXaml];\n`;
  await writeFile(join(consumer, 'consumer.ts'), typeConsumer);
  await writeFile(
    join(consumer, 'consumer.cts'),
    `import logical=require('@wieslawsoltes/xamora-compiler/compiler-logical');const flow:logical.CssFlowContext={direction:'rtl'};const mapped:string|null=logical.physicalCssProperty('inline-size',flow);void mapped;import dialogs=require('@wieslawsoltes/xamora-dialogs');import controls=require('@wieslawsoltes/xamora-controls');const modal:controls.DialogHost=new dialogs.DialogHost(globalThis.document.createElement('div'));modal.dispose();import propertyGrid=require('@wieslawsoltes/xamora-property-grid');const grid:controls.PropertyGrid=new propertyGrid.PropertyGrid(globalThis.document.createElement('div'),{properties:[{name:'Flag',type:'boolean',value:false}]});grid.dispose();import model=require('@wieslawsoltes/xamora-model');import runtime=require('@wieslawsoltes/xamora-runtime');const document:model.DesignDocument=model.createDocument(model.element('Grid'));const store=new model.DocumentStore(document);void[store,runtime.mountXaml];\n`,
  );
  run(
    process.execPath,
    [
      resolve(root, 'node_modules/typescript/bin/tsc'),
      '--ignoreConfig',
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--lib',
      'ES2022,DOM',
      'consumer.ts',
      'consumer.cts',
    ],
    consumer,
    'strict TypeScript ESM/CommonJS consumers',
  );
  console.log(
    `Verified ${current.entries.length} installed npm tarballs and strict TypeScript consumers without skipLibCheck.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
