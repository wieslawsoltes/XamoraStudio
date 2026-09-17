# @wieslawsoltes/xamora-compiler

Bidirectional semantic XAML and HTML compiler with document, folder, and solution conversion.

This package is built from the same canonical modules used by Xamora Studio. ESM and CommonJS consumers share modules across package boundaries; all public entry points include TypeScript declarations. Browser applications can use a bundler.

See [package architecture and installation](https://github.com/wieslawsoltes/XamoraStudio/blob/main/docs/PACKAGES.md), [runtime guide](https://github.com/wieslawsoltes/XamoraStudio/blob/main/docs/WEB-RUNTIME.md), and [source](https://github.com/wieslawsoltes/XamoraStudio).

MIT licensed.

## Named profiles and live capture

```js
import { compileResponsiveVariants, compileRenderedDocument } from '@wieslawsoltes/xamora-compiler';
const result = compileResponsiveVariants(htmlSource, {
  framework: 'WPF',
  // In Node, also provide the HTML DOMParser implementation in Parser.
  variants: [
    { name: 'phone', width: 380, height: 700 },
    { name: 'desktop', width: 900, height: 600 },
  ],
});
for (const { name, environment, result: converted } of result.profiles) {
  console.log(name, environment.width, converted.success, converted.losses);
}
const captured = compileRenderedDocument(document.querySelector('main'));
```

Profiles are synchronous semantic conversions with distinct supplied environments, not an autonomous responsive native runtime. All one-to-32 profile descriptors are validated before compiler callbacks execute. Width and height override a base `viewport` as well as media-query dimensions, so viewport units and queries agree. Results include each profile's diagnostics; an unsuccessful profile makes the aggregate unsuccessful. A host still selects and applies a profile.

Live capture omits both authored and current password input values **before generating source metadata**. Only `includePasswordValues: true` opts into exporting the current password; do not enable it without consent. This is targeted input redaction, not a general secret scanner: authored scripts, data attributes or arbitrary text may contain unrelated secrets.

`observeMedia` adds to the default color-scheme, reduced-motion and forced-colors listeners, rather than replacing them. A failed observer setup rolls back installed listeners/observers. Document stylesheet loads and ancestor scroll events also schedule coalesced recapture. `dispose()` stops subsequent notifications, including pending font readiness.

The source example is in `dist/examples/CompilerFidelityLab/`.
