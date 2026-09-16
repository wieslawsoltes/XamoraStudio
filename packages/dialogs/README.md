# @wieslawsoltes/xamora-dialogs

Reusable modal presentation extracted from Xamora Studio. No runtime dependencies, DOM access at import time, or dependency on Studio/document models. Ships unbundled ESM/CommonJS, explicit TypeScript declarations, scoped CSS and an opt-in self-contained browser bundle.

## Usage

These imports target the built package or a future published release; extraction does not publish npm packages.

```js
import { DialogHost } from '@wieslawsoltes/xamora-dialogs';
import '@wieslawsoltes/xamora-dialogs/dialog-host.css';

const root = document.body.appendChild(document.createElement('div'));
const dialogs = new DialogHost(root);
dialogs.open({
  title: 'Confirm changes',
  content: 'Apply the reviewed changes?',
  actions: [{
    label: 'Apply',
    primary: true,
    closeOnSuccess: true,
    async run({ signal }) {
      await saveChanges({ signal }); // Your application owns persistence.
    },
  }],
});
// On application teardown:
// dialogs.dispose(); root.remove();
```

`open(options)` returns the dialog element. `element`, `body` and `isOpen` describe the active dialog; `focus()`, `showError(message)`, `close()` and `dispose()` are explicit lifecycle operations. `close()` is idempotent. Only one control can own a host until disposed. Place hosts directly beneath `document.body`, outside transformed/isolated stacking contexts. Shadow-root hosting is not supported.

`content` strings are literal text. An element from the same document is moved without cloning and returned to its original sibling position on close. A node moved elsewhere by the application is not reclaimed. `html` is an explicitly trusted-markup path for application-authored templates, **not a sanitizer**; never pass untrusted document content. Title, labels and errors remain literal text.

Actions are application-owned callbacks. While a callback is pending, action buttons are disabled to prevent duplicate submissions; close/cancel remain available. Closing, replacing or disposing aborts the callback's signal, but the callback must cooperate to cancel its work. Late success/error results cannot affect a replacement dialog. If an abort listener synchronously disposes the host or opens a newer dialog, the superseded `open()` call throws rather than overwriting that newer state. Errors are shown in a `role="alert"` element. Return `false` to keep a `closeOnSuccess` action open; automatic closing is otherwise opt-in. Actions are not transactions: persistence and rollback belong to the application.

The top dialog owns focus, Tab/Shift+Tab wrapping and Escape. Background branches are inert while open, and prior inert attributes/focus are restored on close. Independent hosts can stack; only the top host responds to Escape. `dismissOnEscape`, `dismissOnOverlay`, `cancelLabel` (or `false`), `closeLabel`, `wide` and `initialFocus(dialog)` configure presentation. Use the CSS custom properties `--panel`, `--text`, `--line`, `--input`, `--accent`, `--danger` and `--dialog-z-index` to theme the control. Assistive-technology qualification is separate from automated DOM/browser tests.

For browser-only use, import `./browser` and load `dialog-host.css`. Do not mix a bundled constructor with unbundled instances when sharing a modal stack. The compatibility facade also exports `DialogHost` through `@wieslawsoltes/xamora-controls` and its `./dialog-host` subpath.

See [Dialog Lab](https://wieslawsoltes.github.io/XamoraStudio/examples/DialogLab/), [package architecture](https://github.com/wieslawsoltes/XamoraStudio/blob/main/docs/PACKAGES.md) and the [WAI-ARIA modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

MIT licensed. No npm publication or version bump is performed by this extraction.
