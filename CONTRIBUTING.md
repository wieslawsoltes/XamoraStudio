# Contributing to Xamora Studio

## Source and generated output

The tracked `dist/` directory is the canonical, directly served browser source. Edit it deliberately; do not delete it as build output or add it to a blanket formatter ignore rule. Generated package artifacts live in `packages/*/dist/` and must not be edited by hand.

- `dist/core/`: shared document, parser, compiler, runtime and rendering modules.
- `dist/controls/`: reusable browser controls.
- `dist/studio/`: designer workspace features and host integration.
- `dist/app.js`: application composition and startup recovery.
- `dist/studio/studio.js`: the base workspace host; importing this module does not start the app.
- `dist/studio/ui.js` and `dist/studio/icons.js`: shared UI primitives; keep duplicate helpers out of feature modules.
- `scripts/`: development, validation, packaging and release tooling.
- `tests/`: regression tests and preservation fixtures.

Keep public import paths and package ownership stable during refactoring. A new core module must have an owner in the package layout. Do not move core code into the application layer or add a dependency on Studio to a standalone runtime package.

## Formatting

Use Node.js 22 or newer and install the locked development tools:

```sh
npm ci
npm run format
npm run format:check
```

Prettier is pinned to an exact version in the root development dependencies. `.editorconfig` supplies consistent editor defaults. Use two-space indentation, semicolons, single-quoted JavaScript strings and a 100-column target. Long literal strings may exceed that target.

Embedded-language formatting is disabled to preserve authored markup inside JavaScript strings. HTML uses strict whitespace sensitivity. Round-trip fixtures, example documents and XAML are excluded intentionally; change them only as part of a documented behavior change. Generated package output and lockfiles are not formatter inputs.

Do not hand-edit generated package declarations or bundles. Hand-authored declarations in `dist/` are source and are formatted normally.

## Validation and pull requests

```sh
npm run format:check
npm run check
npm test
npm run test:package
npx playwright install --with-deps --only-shell chromium
npm run test:browser
```

Keep mechanical formatting separate from behavior changes and structural refactoring. Open one focused pull request per task, add regression coverage for moved responsibilities, and wait for syntax, unit, package-consumer and browser validation before merging. Preserve existing source synchronization, undo history, serialization and standalone package contracts.

A cleanup does not establish additional framework compatibility, renderer qualification or npm publication. Releases remain a separate explicit operation.
