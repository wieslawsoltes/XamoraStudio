# Responsive CSS and native conversion

The compiler now offers three distinct contracts. None executes authored source code.

| Entry point                                           | Contract                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compileDocument`                                     | Synchronous AST conversion. Stylesheets come from an explicit registry or synchronous resolver. Conditional rules and relative values use supplied environment inputs.                                                                                                                |
| `compileDocumentAsync` / `preloadCompilerStylesheets` | Explicit, bounded resource preparation through a caller-supplied loader, followed by the same synchronous compiler. There is no default network or filesystem loader.                                                                                                                 |
| `compileRenderedDocument` / `observeRenderedDocument` | Capture an already-rendered, caller-owned live DOM. Browser layout resolves intrinsic sizes, flex/grid placement, media/container rules and loaded external CSS. Native Canvas positions represent that measured layout; the observer regenerates output after source/layout changes. |

These APIs ship together in the compiler package, with ESM, CommonJS and declarations. Build the checkout to use new APIs; this change does not publish packages or change the package version.

## Deterministic environment conversion

```js
import { compileDocument } from '@wieslawsoltes/xamora-compiler';

const result = compileDocument(htmlSource, {
  from: 'html',
  framework: 'WPF', // or Avalonia
  baseUrl: 'https://app.example/views/main.html',
  environment: {
    type: 'screen', width: 800, height: 600, resolution: 2,
    'prefers-color-scheme': 'dark',
    supports: { 'display:grid': true },
  },
  stylesheets: {
    'https://app.example/css/main.css': '@import "theme.css"; button { width: 120px }',
    'https://app.example/css/theme.css': 'button { padding: 4px 8px }',
  },
});
```

Node callers also inject `Parser`; the CLI already supplies its DOM parser. An environment is a declared conversion context, not an inferred device. `null` from condition evaluation means unknown, even beneath `not`. Undecidable branches produce `CONDITIONAL_CSS` losses rather than invented styles. A supplied environment selects a snapshot; exported XAML does not independently reevaluate arbitrary CSS media queries.

Supported conditions include media types, comma alternatives, nested `and`/`or`/`not`, min/max and chained numeric ranges, width/height, orientation, aspect ratio, resolution and explicit discrete features. `@supports` uses the host's explicit feature map or callback. `@container` size queries use `containerEnvironment(node, name)` so the host—not a guessed ancestor—supplies the applicable container dimensions. Container style/scroll-state queries and unsupported grouping grammars remain diagnostics in static mode; live browser capture sees their resulting layout.

The selector engine supports structural child/type predicates; An+B `:nth-*` formulas and filtered `of` lists; `:is`, zero-specificity `:where`, `:not`, relative `:has`; language/direction; and form-state predicates. Interaction/validation predicates use explicit `pseudoStates`, keyed by AST ID or HTML ID, and `targetId`. No browsing-history state is read: `:visited` is deliberately unsupported. Generated pseudo-elements and unsupported selectors require adapters; they are not silently treated as normal elements.

Named, anonymous and nested cascade layers preserve declaration order and reverse important-layer precedence. Inline author declarations retain their priority. `revert-layer` rolls back the applicable layer; the supported user-agent inline formatting defaults remain below author origin. This does not introduce an exhaustive browser user-agent stylesheet.

Lengths support absolute units; `em`/`rem`; viewport units with explicit viewport inputs; and bounded dimensional `calc`, `min`, `max`, `clamp`. Percentages need a known containing dimension. Static conversion does not guess intrinsic/shrink-to-fit sizes or solve an entire browser formatting context. Use live capture for actual border-box geometry.

## External resource ownership

Imports resolve relative to their owning stylesheet. The first HTML `base` is respected. Top-level import ordering, import media/supports/layer qualifiers, repeated imports, cycle termination and URL-token rebasing are handled without changing source strings in portable metadata. Disabled, alternate and nonmatching stylesheets do not enter the cascade. Missing resources stay `EXTERNAL_CSS` losses.

```js
import { compileDocumentAsync } from '@wieslawsoltes/xamora-compiler';
const result = await compileDocumentAsync(htmlSource, {
  from: 'html', baseUrl: 'https://app.example/views/main.html',
  signal: controller.signal,
  loadStylesheet: async (url, { signal }) => {
    // Enforce the application's origin/credential policy before performing I/O.
    if (new URL(url).origin !== location.origin) throw Error('Origin is not allowed');
    const response = await fetch(url, { signal, credentials: 'same-origin' });
    if (!response.ok) throw Error(`Stylesheet HTTP ${response.status}`);
    return response.text();
  },
});
```

The example loader is application code, not an implicit compiler capability. Defaults are 128 distinct sheets, 32 import levels, 2,000,000 UTF-8 bytes, 20,000 rules and 2,000,000 selector steps. Async preparation additionally bounds each loader call to 15 seconds and propagates cancellation, even if a loader ignores its signal. Limits fail atomically. `allowMissingStylesheets` permits absent callback results to remain unresolved for the synchronous compiler's diagnostics; loader exceptions still reject.

The CLI resolves local CSS beneath the input root and rejects symlinks or escapes. It never fetches remote stylesheets. Strict mode rejects unresolved external sheets. For example:

```sh
xamora-convert ./views --to xaml --framework WPF --viewport 800x600 --media screen --out-dir ./converted
```

The Studio conversion dialog exposes viewport width/height, media type and color scheme. API callers can additionally supply stylesheet registries and support/container callbacks. Application-authored external network resources are never fetched merely by opening the dialog.

## Intrinsic layout and live updates

```js
import { observeRenderedDocument } from '@wieslawsoltes/xamora-compiler';
const observer = observeRenderedDocument(document.querySelector('#live-view'), {
  framework: 'Avalonia',
  preserveMetadata: true,
  onResult(result, revision) {
    outputEditor.value = result.source; // target must be outside the observed source
    showDiagnostics(result.diagnostics);
  },
  onError: console.error,
});
// After programmatic CSSOM insertRule/deleteRule or custom animation sampling:
observer.refresh();
// Teardown:
observer.dispose();
```

Capture reads live values and browser border boxes without adding marker attributes or changing the source DOM. Generic layout containers become native Canvases; ordinary text and controls retain their native types. Direct text under a measured container receives a measured TextBlock. Borders use native decoration children. Width/height and relative Canvas coordinates come from actual browser geometry, including intrinsic grid tracks, auto-fit, flex wrapping and reflow.

The observer coalesces resize, DOM mutations, ancestor/stylesheet mutations, input/focus/pointer state, scrolling, viewport changes and font completion. It detaches listeners and observers and cancels pending frames on disposal. It does not execute a supplied HTML string, navigate to a URL, or continuously sample every animation frame. The caller owns source rendering, permissions, readiness (including fonts/images), and native target updates.

**Scope of equivalence:** measurement captures layout at the current viewport/state. The browser observer plus a host applying updated results provides responsive regeneration. The output alone is not a native CSS/JavaScript interpreter. Native font shaping, control-template paint, transformed/fragmented content, generated pseudo-elements, shadow trees, embedded media, scroll behavior and unsupported paint effects have explicit diagnostics. Strict capture rejects material losses. This is not a blanket claim of browser-pixel or arbitrary JavaScript equivalence.

## Actual native qualification

`tests/native/generate-fixtures.mjs` produces the target XAML using the real compiler. Each target receives narrow/wide static fixtures with metadata both on and off, plus two measured browser layouts. Expected static values are independently specified; measured values come from Chromium, not from the generated XAML.

`native-compiler.yml` loads these fixtures using WPF on Windows (.NET 10) and Avalonia 12.1.1 on Linux (.NET 10, headless platform). The runners measure/arrange real framework controls and assert their dimensions, attached placement, text, padding and selection. WPF additionally saves and reloads the native object tree. Qualification JSON reports record the actual runtime, assembly, cases and assertions; the workflow result is the authority on whether a revision passed.

This suite qualifies its fixture inventory, not every native property/control or native pixel renderer. Avalonia headless exercises real layout and styling with an in-memory backend, not physical GPU or operating-system input devices. Native loaders process **only trusted repository-owned fixtures**; they are not exposed as an untrusted-XAML service.

## References

[Selectors Level 4](https://www.w3.org/TR/selectors-4/), [Media Queries Level 4](https://www.w3.org/TR/mediaqueries-4/), [Cascade Level 5](https://www.w3.org/TR/css-cascade-5/), [CSS Values Level 4](https://www.w3.org/TR/css-values-4/), [WPF XamlReader](https://learn.microsoft.com/en-us/dotnet/api/system.windows.markup.xamlreader), [Avalonia headless testing](https://docs.avaloniaui.net/docs/testing/setting-up-the-headless-platform).

## Capture state, privacy and lifecycle

`compileRenderedDocument` omits password input values by default, including the
current DOM value, the authored value attribute and that control's prior Xamora
round-trip metadata. The source DOM is not modified. A
`BROWSER_PASSWORD_REDACTED` informational diagnostic records the omission without
including a value. Set `includePasswordValues: true` only when the application
explicitly intends to serialize passwords. This is a password-control policy,
not a general-purpose secret scanner: text, scripts, arbitrary attributes and
other application data remain the caller's responsibility. Static conversion of
an explicitly supplied source string keeps its existing source-preservation contract.

Avalonia password controls use `TextBox.PasswordChar`; WPF uses `PasswordBox`.
Reverse conversion retains an HTML password input even without source metadata.
Unsupported WPF password read-only/text-layout properties are diagnosed instead
of generating unloadable XAML. Explicitly empty select state (`selectedIndex = -1`)
and mixed checkboxes are taken from live DOM properties: the latter becomes native
`IsThreeState="True" IsChecked="{x:Null}"`. This samples state; it does not install a
new native interaction model or make HTML indeterminate state an HTML attribute.

Measured Canvas coordinates are physical offsets, so the capture containers use
`FlowDirection="LeftToRight"` even when the source layout is right-to-left. Text
and native control content retain their own computed direction. Synthetic direct
text hosts do not apply their parent's opacity a second time.

The observer also samples form resets (including externally associated forms),
ancestor scrolling, toggle events and stylesheet link completion. These are
frame-coalesced like ordinary edits. Programmatic CSSOM changes and direct value
assignments without events still require `refresh()`. Initialization rolls back
listeners and observers if setup or the initial result callback throws; late
queued callbacks cannot reconnect a disposed observer.

The capture regression suite runs against source and packaged compiler entrypoints.
Native fixtures additionally cover redacted/opt-in passwords, empty selection,
mixed checkbox state and physical RTL placement. These extend the same native
qualification harness; they are not pixel-identical typography or assistive-
technology certification.

Specifications used for this boundary: [HTML password inputs](<https://html.spec.whatwg.org/multipage/input.html#password-state-(type=password)>),
[CSS group opacity](https://www.w3.org/TR/css-color-4/#transparency), and
[Avalonia TextBox masking](https://docs.avaloniaui.net/controls/input/text-input/textbox).
