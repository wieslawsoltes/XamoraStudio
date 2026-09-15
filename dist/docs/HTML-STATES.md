# HTML interaction states and transitions

The HTML **States & transitions** tool window authors ordinary CSS state rules and transition properties. It is separate from the CSS keyframe timeline, so both remain dockable and visible together. Source edits, state controls, property recording and undo/redo use the document's shared `DocumentSession`.

## Author a state

Open an HTML document, select an element, then use the **States** toolbar button or **Animation → Visual states**. The window exposes the base appearance, supported pseudo states, and reusable named, class and data-attribute states.

Supported pseudo states are `:hover`, `:focus`, `:focus-visible`, `:active`, `:disabled` and `:checked`. Their behavior in exported HTML is supplied by the browser. A named state uses an ordinary `data-xamora-state` token; class and data states use their corresponding authored selectors.

Create a state, edit its CSS properties, and select it to preview its appearance. Remove a value to let the underlying cascade apply. State selectors and their surrounding conditional rules remain visible in source. Imported local rules are discovered where their selectors fit the supported state representation; arbitrary selector editing remains available in code.

## Record property and canvas edits

Select a state and enable state recording. CSS changes from Properties or canvas gestures are captured into that state in one document transaction. The original inline base declarations are restored before commit. State recording and keyframe recording are mutually exclusive.

Ordinary inline styles have higher cascade priority than ordinary stylesheet declarations. When the base contains a conflicting inline property, recorded state values explicitly author `!important` in the state rule. This makes the real exported CSS produce the same state value as the designer while preserving the original inline base text. The priority is visible in source. An existing inline `!important` conflict is rejected with guidance to edit that priority; the designer does not pretend a stylesheet rule can override it.

## Edit and preview transitions

The transition editor works with the base element or the selected state rule. Each item has a CSS property, duration and delay in milliseconds, an easing function and `normal`/`allow-discrete` behavior. Negative delays and comma-separated transition lists are supported. Empty or removed lists have ordinary CSS behavior rather than a hidden designer animation definition.

Trigger the selected state to observe the browser's native transition, or reset to the base appearance. Preview temporarily enables transitions in the design iframe. No sampled values or preview play state enter the document or history. Transition interpolation, interruption/reversal, discrete properties, custom properties and unsupported features follow the browser's CSS implementation. The designer does not supply a separate interpolation engine.

See [CSS Transitions Level 1](https://www.w3.org/TR/css-transitions-1/) for the timing/list model and [CSS Transitions Level 2](https://www.w3.org/TR/css-transitions-2/) for `transition-behavior` and discrete transition semantics.

## Bind a named state to an interaction

The interaction editor binds a trigger element to a named state with a **toggle**, **set** or **clear** action. Events include click, double-click, pointer enter/leave, focus in/out, change and input. Bindings can be inspected and removed without replacing existing event attributes or handlers.

Authoring the first binding inserts a small, readable event-delegation script in the HTML source. The script reads the authored binding data and updates state tokens on the bound targets. It has no dependency on Xamora or a package CDN. Native pseudo states need no such script. The script executes in interactive Preview and in exported HTML; the design iframe continues to block authored script execution.

Use **Animation → Open HTML interaction example** to open `HtmlInteractionLab.html`, or import [the sample file](../examples/HtmlInteractionLab.html). The sample combines pseudo states, transition timing and explicit named-state interaction.

## Reuse the core

```js
import {
  createHtmlState, setHtmlTransitions, bindHtmlStateInteraction,
  HtmlStatePreview,
} from '../dist/core/index.js';

let expanded;
store.transaction('Add expanded state', doc => {
  expanded = createHtmlState(doc, targetId, {
    kind: 'named', name: 'expanded',
    values: {opacity: '1', transform: 'translateY(0)'},
  });
  setHtmlTransitions(doc, targetId, [
    {property: 'opacity', duration: 250, easing: 'ease-out'},
    {property: 'transform', duration: 250, easing: 'ease-out'},
  ]);
  bindHtmlStateInteraction(doc, expanded.id, {
    triggerNodeId: buttonId, event: 'click', action: 'toggle',
  });
});

const preview = new HtmlStatePreview({
  document: iframe.contentDocument,
  elements: renderedElements,
  sourceDocument: store.document,
});
preview.setState(expanded, targetId, {transitions: true});
preview.clear();
preview.dispose();
```

The module also exports discovery, binding, value editing, state deletion, transition list access, interaction listing/removal and standalone runtime generation. TypeScript declarations accompany the core. Mutation functions must run inside a store transaction when editing a live studio document.

## Preview ownership and preservation

`HtmlStatePreview` changes only the preview DOM. It translates supported pseudo-selector tokens in their original local stylesheet positions, preserving rule order, media/supports/layer context and cascade. It restores stylesheet text, temporary attributes, form state and the transition-freeze stylesheet when cleared or disposed. The state tool releases its preview when it closes or changes documents.

Authored CSS is edited through source ranges, preserving unrelated rules, comments and declaration spelling. The outer document session patches the enclosing HTML and source mappings. Undo restores the source, state properties, transition timing and runtime bindings together.

## Boundaries

- Local style elements are editable. External stylesheets must be imported to author their state rules; native preview can still use supported browser effects.
- Supported pseudo states are represented explicitly. Arbitrary pseudo-elements, complex selector semantics, CSS nesting and other selectors remain source-driven where they cannot be mapped safely.
- This tool does not generate arbitrary JavaScript Web Animations programs or author scroll/view-linked timelines.
- CSS transition behavior is qualified by targeted Chromium tests, not every browser/device or every CSS interpolation case.
- State discovery scans local CSS. It is not an incremental CSS compiler or an unrestricted CSS semantic language server.

Run `npm test`, `npm run check`, and `node tests/browser-html-states.mjs` with Playwright/Chromium installed. See [validation](VALIDATION.md) for the release's actual test results.
