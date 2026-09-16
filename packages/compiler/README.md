# @wieslawsoltes/xamora-compiler

Bidirectional semantic XAML and HTML compiler with document, folder, and solution conversion.

This package is built from the same canonical modules used by Xamora Studio. ESM and CommonJS consumers share modules across package boundaries; all public entry points include TypeScript declarations. Browser applications can use a bundler.

See [package architecture and installation](https://github.com/wieslawsoltes/XamoraStudio/blob/main/docs/PACKAGES.md), [runtime guide](https://github.com/wieslawsoltes/XamoraStudio/blob/main/docs/WEB-RUNTIME.md), and [source](https://github.com/wieslawsoltes/XamoraStudio).

MIT licensed.

### CSS environments and browser layout capture

The compiler exports `compileResponsiveVariants`, `evaluateMediaQuery`,
`evaluateSupportsCondition`, `compileRenderedDocument` and
`observeRenderedDocument` alongside `compileDocument`. Static compilation accepts
explicit media/supports/pseudo-state context and supplied external stylesheet
text; no network requests or script evaluation occur. `nativeOutput: true` opts
into native panel wrappers and gap adapters.

Browser capture reads a connected DOM at its current viewport and exports native
measured boxes, current form state, editable text and source ranges. Its observer
recaptures layout/interaction changes and has an explicit `dispose()` lifecycle.
This is not a live native CSS engine: typography, themes and unsupported paints
carry loss diagnostics. Strict mode does not silently accept them.

See `docs/SEMANTIC-COMPILER.md`, `docs/COMPILER-CLI.md` and the hosted
`examples/CompilerFidelityLab/`. The added CI jobs are configured to qualify generated
fixtures with real WPF and Avalonia layout/rendering. No npm publication is needed
to build or test the packages.
