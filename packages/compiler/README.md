# @wieslawsoltes/xamora-compiler

Bidirectional semantic XAML and HTML compiler with document, folder, and solution conversion.

This package is built from the same canonical modules used by Xamora Studio. ESM and CommonJS consumers share modules across package boundaries; all public entry points include TypeScript declarations. Browser applications can use a bundler.

See [package architecture and installation](https://github.com/wieslawsoltes/XamoraStudio/blob/main/docs/PACKAGES.md), [runtime guide](https://github.com/wieslawsoltes/XamoraStudio/blob/main/docs/WEB-RUNTIME.md), and [source](https://github.com/wieslawsoltes/XamoraStudio).

Logical CSS sizing, spacing and offsets share the physical-property cascade after
flow resolution. The standalone `compiler-logical` subpath exposes name-mapping
helpers and `CssFlowContext` declarations; browser measurement and static conversion
use the same canonical compiler. See the
[responsive and logical CSS contracts](https://github.com/wieslawsoltes/XamoraStudio/blob/main/docs/RESPONSIVE-COMPILER.md)
for supported values, source-preserving reverse edits and explicit fidelity losses.

MIT licensed.
