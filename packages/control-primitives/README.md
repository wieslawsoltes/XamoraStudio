# @wieslawsoltes/xamora-control-primitives

Small DOM controls extracted from the Studio: `MenuBar`, `ScrollButtons`, and `WorkspaceDensity`. This package has no runtime dependencies and does not import the designer, docking, parsers or renderers.

```js
import { MenuBar, ScrollButtons } from '@wieslawsoltes/xamora-control-primitives';
import '@wieslawsoltes/xamora-control-primitives/menu-bar.css';
import '@wieslawsoltes/xamora-control-primitives/scroll-buttons.css';
const menu = new MenuBar(host, [{ label: 'File', children: [{ label: 'Save', run: save }] }]);
const strip = new ScrollButtons(tabViewport, { label: 'documents' });
container.append(strip.host);
// Dispose before permanently removing the controls.
menu.dispose(); strip.dispose();
```

Menus retain application-level Alt/F10 navigation and popup focus restoration. Mount one application menu per document. Scroll strips support buttons, keyboard and native scrolling. Density sets a `data-density` presentation preference on a supplied root; styling the density of application content is the consumer's responsibility.

`./browser` provides a self-contained ESM bundle. Ordinary ESM and CommonJS imports expose the same source modules as the backwards-compatible `@wieslawsoltes/xamora-controls` exports. All entry points include declarations. Importing does not touch the DOM; constructing controls requires a browser with ResizeObserver. MIT licensed.
