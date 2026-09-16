# npm packages and release engineering

Xamora's packages are built from the same `dist/core` and `dist/controls` modules imported by the designer. The browser studio retains its existing buildless imports; packaging does not replace its parser, object model, renderer, controls, history, or editing tools. The private root workspace is not published. Seventeen base packages form the runtime, designer SDK and standalone controls; an optional eighteenth package adds the semantic compiler and CLI.

## Package boundaries

All names use the `@wieslawsoltes/` scope and a coordinated version. Internal dependency versions are exact so a release uses a compatible AST and runtime contract.

| Package                      | Contents                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `xamora-contracts`           | Type-only public AST, rendering, animation, and extension contracts; its JavaScript entry is empty                                           |
| `xamora-model`               | Universal document nodes, validation, transactions, compact undo history, toolkit registry                                                   |
| `xamora-data`                | Data tables, relationships, queries, binding paths, CSV import/export                                                                        |
| `xamora-styling`             | Resources, styles, brushes, property paths, vector geometry                                                                                  |
| `xamora-animation`           | XAML storyboards, clock sampling, visual states, timeline editing                                                                            |
| `xamora-markup`              | XAML/HTML parsing and serialization, source buffer/index, document synchronization, semantic language service, CSS animation/state authoring |
| `xamora-renderer`            | Shared DOM/CSS renderer, HTML iframe renderer, motion application, optional GPU overlay                                                      |
| `xamora-control-primitives`  | Standalone menus, scroll strips and density preferences; no runtime dependencies                                                             |
| `xamora-docking`             | DOM-free docking model, live-DOM workspace and independent styles; depends only on primitives                                                |
| `xamora-code-editor`         | Language-neutral source editor, buffer history, language-provider hooks and independent styles; no runtime dependencies                      |
| `xamora-property-grid`       | Descriptor-based controlled property fields, grouping/filtering, validation/reset events and independent styles; no runtime dependencies     |
| `xamora-dialogs`             | Modal hosting, focus/inert ownership, controlled async actions and standalone CSS; no runtime dependencies                                   |
| `xamora-controls`            | Compatibility/convenience reexports of canonical docking, editor, property grid, dialog and primitive controls; CSS assets                   |
| `xamora-designer`            | Drop planning, layout editing, solution/resource authoring, prototypes, code editor, examples                                                |
| `xamora-properties`          | Observable state and extensible runtime property metadata/value precedence                                                                   |
| `xamora-runtime`             | Standalone application host, binding updates, commands, events, lifecycle, resources, animation, optional custom element                     |
| `xamora`                     | Convenience SDK aggregating executable package APIs                                                                                          |
| `xamora-compiler` (optional) | Semantic document/project conversion, Node CLI, dependent asset discovery/copy                                                               |

The contracts package breaks type dependencies such as a control descriptor referring to rendering services. It exports these names using `export type`, not nonexistent JavaScript constructors. Actual constructors always come from their owning executable package. For example, the SDK's `DocumentStore` and the model package's `DocumentStore` are the same function when loaded through ESM, and also the same function when loaded through CommonJS. As with most dual-format packages, mixing ESM and CommonJS in one process creates separate module-format instances; select one format for a running application.

## Building and testing

Node 22 or newer is required for development and Node consumption. The application itself runs in a modern browser supporting ES2022, DOMParser, Web Animations, and native modules; GPU overlays remain optional.

```sh
npm ci
npm run check
npm test
npm run test:package
npx playwright install --with-deps --only-shell chromium
npm run test:browser
```

`test:package` builds once, packs actual npm tarballs, installs them into temporary consumers outside the checkout, and verifies ESM, CommonJS, shared constructor identity, document transactions, strict TypeScript ESM/CommonJS consumers, and a custom-control lifecycle registration. It also installs each package with only its declared transitive dependency closure, so an umbrella installation cannot conceal missing package dependencies. Type checking does not use `skipLibCheck`. The build rejects unowned core modules, unresolved relative imports, undeclared dependencies in emitted JavaScript/declarations, and inconsistent internal versions.

The package builder produces unbundled ESM, unbundled CommonJS with source maps, and TypeScript declarations. Existing handwritten declarations are preserved; the legacy public declaration file is split into owning modules, and TypeScript emits declarations for remaining JavaScript APIs. Generic helpers inherited from JavaScript can still have `any` parameter types; this is not a promise that every pre-existing internal helper has a fully constrained generic API. Runtime, properties, compiler, and the established public object-model contracts have explicit declarations.

`npm run build` writes `packages/*/dist` and temporary `.package-build` output. It does not rewrite canonical modules or deploy the studio. `node scripts/package-manifests.mjs` is an authoring command: run it after adding a package-owned module, then refresh the lockfile with `npm install --package-lock-only`.

## Consuming packages

These are the intended package imports once a release is published. No npm release is made automatically by building, packing, testing, pushing, or merging.

```js
import { mountXaml } from '@wieslawsoltes/xamora-runtime';
import { builtins } from '@wieslawsoltes/xamora-model';

const registry = builtins();
const application = mountXaml(document.querySelector('#app'), `
  <StackPanel xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
    <TextBlock Text="{Binding Greeting}" />
    <Button Content="Change greeting" Command="ChangeGreeting" />
  </StackPanel>
`, {
  registry,
  data: { Greeting: 'Hello from Xamora' },
  commands: {
    ChangeGreeting: (_parameter, { application }) => {
      application.setData('Greeting', 'The same XAML runtime runs without the designer');
    },
  },
});
// Later, when the application's owner is removed:
// application.dispose();
```

Use exported module subpaths to narrow imports, such as `@wieslawsoltes/xamora-model/model`, `@wieslawsoltes/xamora-markup/document-session`, or `@wieslawsoltes/xamora-runtime/runtime-element`. ESM and CommonJS have separate conditional declarations (`.d.ts` and `.d.cts`). Runtime, SDK and standalone control packages also export ESM `./browser` bundles with declarations. These optional bundles include their dependency graph and need no import map or bundler; use one standalone bundle per application to keep module identities consistent. Normal package imports keep shared dependencies external for bundler deduplication.

The runtime injects its scoped base styles automatically. The same canonical stylesheet is available as `@wieslawsoltes/xamora-runtime/runtime.css`. Controls expose `./docking.css`, `./density.css`, and `./scroll-buttons.css`; designer code-editor styling is `@wieslawsoltes/xamora-designer/editor.css`. Standalone editor and property grid styles are `@wieslawsoltes/xamora-code-editor/code-editor.css` and `@wieslawsoltes/xamora-property-grid/property-grid.css`. Dialog styling is `@wieslawsoltes/xamora-dialogs/dialog-host.css`. See [reusable control boundaries and examples](REUSABLE-CONTROLS.md). CSS exports are marked as side effects so bundlers retain explicit stylesheet imports.

To inspect an unpublished local release:

```sh
npm run pack:packages
# Install the .artifacts/npm/*.tgz files together into another project.
# npm install /absolute/path/to/.artifacts/npm/*.tgz
```

The optional compiler package provides the `xamora-convert` executable and browser-compatible compiler APIs. Only the CLI depends on Happy DOM to parse HTML outside a browser. The executable is ESM; the compiler APIs support both ESM and CommonJS. See [compiler CLI workflows](COMPILER-CLI.md) and [standalone runtime behavior](WEB-RUNTIME.md).

## Release preparation and future publication

The packaging structure follows [ReactiveWeb's package entry points](https://github.com/wieslawsoltes/ReactiveWeb/blob/main/package.json), [ESM/CommonJS/browser build](https://github.com/wieslawsoltes/ReactiveWeb/blob/main/scripts/build.mjs), [installed-tarball consumer checks](https://github.com/wieslawsoltes/ReactiveWeb/blob/main/scripts/package-test.mjs), and [immutable artifact publication](https://github.com/wieslawsoltes/ReactiveWeb/blob/main/.github/workflows/npm-publish.yml). Xamora adds coordinated workspace packages and an explicitly disabled-by-default publication switch.

```sh
npm run version:packages -- 0.8.1
npm install --package-lock-only
npm run release:check
npm run test:package
npm run pack:packages
npm run release:verify
```

The version command changes manifests only. It does not create a commit, tag, GitHub release, or npm publication. `release:check` verifies package metadata, exact internal dependencies, an acyclic executable package graph, and lockfile alignment. `pack:packages` builds tarballs in dependency order and writes `release.json` plus `SHA256SUMS.txt`. Each record contains the package/version, filename, SHA-256 checksum, npm integrity, and checked-out commit. `release:verify` checks those exact bytes and uses `npm pack --dry-run --ignore-scripts` to inspect each tarball without invoking npm publication. The separately available `release:dry-run` command invokes `npm publish --dry-run --ignore-scripts`; it is reserved for an explicitly selected future publication workflow.

`.github/workflows/npm-release.yml` runs only by manual workflow dispatch. The default `publish: false` validates, tests, packs, verifies the tarballs with `npm pack --dry-run`, and uploads reviewable artifacts. There is no push, tag, pull-request, or Pages publication trigger for npm.

For a future authorized npm release, configure npm trusted publishing for each scoped package and this repository/workflow/environment, or provide an `NPM_TOKEN` secret in the `npm` GitHub environment. An environment protection rule can require human release approval. Ensure the GitHub account has ownership of the npm scope/package names; repository write access alone does not grant npm ownership. First publication may require creating the packages with an npm publication token before trusted publishing can be configured.

When publication is deliberately enabled, supply an existing `vVERSION` tag and the full expected commit SHA. The workflow checks out that revision, validates the version and exact commit, runs all validation, and publishes the checksum-verified artifacts with provenance. The publication script additionally resolves the actual tag reference to the expected commit; a branch with a version-like name does not satisfy this check. Internal packages publish in dependency order. If a version is already present, its npm integrity must match the local artifact; mismatches stop publication. Successful uploads are checked against the registry integrity. Prerelease versions require the `next` distribution tag.

The private root and generated build/test directories are excluded from npm artifacts. Source remains authoritative in Git; tarballs include runtime files, declarations, source maps where generated, CSS assets, the package README, and the MIT license. Native WPF/Avalonia binaries, application code-behind, arbitrary CLR libraries, and browser-incompatible native controls are not bundled by this infrastructure. Their extension and interoperability boundaries are described in [the runtime architecture](WEB-FRAMEWORK-ARCHITECTURE.md).
