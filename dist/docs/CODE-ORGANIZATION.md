# Code organization and maintenance

## Source ownership

`dist/` is the canonical, directly served browser source. It is not disposable build output. Generated package files belong under `packages/*/dist/`; edit their canonical sources rather than those generated files. Core package ownership remains defined by `scripts/package-layout.mjs` and validated by `scripts/package-graph.mjs`.

The cleanup separates mechanical formatting, application composition, workspace responsibilities and package-build orchestration into independently validated changes. It does not add a parallel document model, change public package import paths or introduce an application bundling requirement.

## Application boundaries

`dist/app.js` composes the base Studio host and feature workspaces in dependency order and handles startup recovery. Importing `dist/studio/studio.js` does not start the app. The host owns the existing document stores, selection, canvas and interaction state.

`studio/ui.js` and `studio/icons.js` own shared DOM helpers, escaping, notification channels, downloads and icon markup. `studio/dialog-host.js` owns modal rendering and focus management. `studio/workspace-files.js` owns file interchange and local persistence. `studio/workspace-dialogs.js` owns workspace commands and dialogs. These delegates receive the host explicitly and never instantiate it. Existing host methods forward to the delegates so feature wrappers retain their entry points.

Keep edits on the shared document/session path. Preserve source drafts, import/export validation, undo transactions and storage schemas during future extractions.

## Package-build boundaries

`scripts/build-packages.mjs` coordinates the graph, declarations, per-package build steps, standalone browser bundles and final import validation.

- `package-build/metadata.mjs` validates manifest versions/dependencies, defines root exports, and copies assets, license and CLI permissions.
- `package-build/emit-modules.mjs` writes canonical ESM source and ESM/CommonJS declarations, including type-only contracts.
- `package-build/bundles.mjs` emits unbundled CommonJS and opt-in browser bundles, with explicit import-rewrite and workspace-resolution helpers.

The sequence and output formats remain unchanged. Normal imports stay unbundled to preserve shared class identity. CLI entry points remain outside library root exports; standalone browser bundles are a separate opt-in phase after all packages have been emitted.

## Review and validation

Use the pinned formatter and the commands in the root `CONTRIBUTING.md`. Keep formatting-only diffs separate from structural changes. Regression tests cover the extracted UI and package-build boundaries; the full validation still includes package tarball consumers and the real-browser suites.

Before accepting a packaging refactor, compare generated file contents as well as running the consumer tests. The initial build-tool extraction reproduced all 297 generated files byte for byte. This is an equivalence check for that refactor, not a permanent file-count constraint.

Large layout, rendering and framework-semantics modules still warrant focused domain-specific review. Do not split them mechanically across the standalone package boundaries or interpret this cleanup as new framework compatibility or production qualification.

## Document-aware workspace libraries

The canonical implementations for canvas, motion/state, HTML, resources/brushes, solution and data authoring live in `dist/workspaces/`. Original Studio paths are identity-preserving reexports. The Studio-only service binding lives in `studio/component-context.js`; reusable libraries never import it. See `WORKSPACE-COMPONENTS.md` for host and lifecycle contracts.
