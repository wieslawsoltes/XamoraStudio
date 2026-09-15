# HTML animation authoring

HTML animations are authored as ordinary CSS `@keyframes` and element animation properties inside the HTML document. The timeline, CSS property panels, source editor and canvas all commit through the same document session. Exported HTML runs without the designer or an animation runtime dependency.

## Use the timeline

Open an HTML page, select an element, and open **Animation → Objects and timeline** (or the docked timeline). Choose Fade in, Slide up, Scale in, Pulse, Spin or Color shift and create an animation. The animation selector also discovers local keyframes imported in style elements, including nested media/supports/layer rules.

The toolbar exposes the animation name, target binding, binding removal and deletion. Timing fields edit duration and delay in milliseconds, iteration count (including `infinite`), normal/reverse/alternate directions, fill behavior, and CSS easing. Play/pause, stop, time input, scrubbing, loop preview and playback rate control the design preview. Preview looping is independent of the authored CSS iteration count.

Each row displays a target and its CSS keyframes. Drag a diamond to move it, double-click a lane to add a key, or use **Key at playhead**. Frame snapping uses 60 fps and can be disabled. The key inspector edits offsets, individual CSS values, property removal and per-keyframe easing. Copy/paste/duplicate and delete operate on selected keyframes. Keyboard transport and key navigation are available while the timeline has focus.

## Record direct editing

Enable **Record**, move the playhead, then edit a CSS property or drag/resize an element on the design canvas. Recordable property changes become keyframe values and the element's authored base style is restored before the transaction commits. The operation creates one undo entry. Removing a property records its resolved cascade value when the rendered element is available; unresolved removals roll back instead of losing the base value.

The recording time is mapped into the animation's directed local progress, accounting for delay, repeat count, fractional iterations and alternating directions. Layout switches such as `display` and `position`, plus animation/transition configuration, remain ordinary authored changes. CSS interpolation follows browser rules; properties that are not interpolable do not acquire custom interpolation semantics.

## Source, preservation and runtime

`core/html-animation.js` provides a CSS range tree for keyframes and nested rule groups. Editing one definition patches its source range and preserves unrelated stylesheet content. The outer `DocumentSession` then patches the enclosing HTML source, updates selection ranges, and commits history. Source edits to keyframes refresh the timeline and preview.

Renaming updates local keyframe definitions and literal `animation`/`animation-name` references in style elements and inline styles. Dynamic names in JavaScript, generated strings, variables and external stylesheets need source-level coordination. Deleting through the UI removes target bindings before removing the definition; the standalone low-level removal API removes only the specified definition.

The design renderer pauses native CSS animation objects through the Web Animations API. Seeking samples those objects at the requested time. It does not write sampled colors, transforms or dimensions into the AST or history. The interactive HTML preview uses the original authored CSS, scripts and play states in its existing isolated iframe.

## Reuse the core

```js
import {
  DocumentStore, DocumentSession, parseHtml,
  createHtmlAnimation, setHtmlAnimationKeyframe,
  listHtmlAnimations, HtmlAnimationPreview,
} from './dist/core/index.js';

const source = '<html><head></head><body><button id="go">Go</button></body></html>';
const store = new DocumentStore(parseHtml(source));
const session = new DocumentSession(store, {source});
const button = store.document.root.children.find(n => n.type === 'body').children[0];
let animation;
store.transaction('Add entrance animation', doc => {
  animation = createHtmlAnimation(doc, button.id, {
    name: 'entrance', duration: 800, easing: 'ease-out', fill: 'both',
    frames: [
      {offset: 0, values: {opacity: '0', translate: '0 24px'}},
      {offset: 1, values: {opacity: '1', translate: '0 0'}},
    ],
  });
});
store.transaction('Edit midpoint', doc => {
  setHtmlAnimationKeyframe(doc, animation.definitionId, 0.5, {opacity: '0.8'});
});
console.log(session.serialize()); // HTML with ordinary, readable CSS
console.log(listHtmlAnimations(store.document));
// Supply the rendered iframe document to control its native CSS effects:
// const preview = new HtmlAnimationPreview({document: iframe.contentDocument});
// preview.seek(400); preview.dispose();
```

`HtmlAnimationPreview` supports seek/play/pause/stop, refresh and disposal. Disposal restores the captured animation state. The standalone core has TypeScript declarations and exports from the core entrypoint. CSS parsing and document edits run without a browser; HTML parsing and native effect sampling require a DOM/browser.

## Example and validation

Import [HtmlMotionLab.html](../examples/HtmlMotionLab.html) into the designer, or open it directly in a browser. It includes grouped offsets, per-frame easing, colors, transforms, independent rotation, filter/clip-path, multiple animations, negative delay, runtime pause, and reduced-motion handling.

Run `npm test` and `npm run check`. The Chromium integration test is `node tests/browser-html-motion.mjs` after installing Playwright and Chromium as documented in [document synchronization](DOCUMENT-SYNC.md#validation). It exercises actual interpolation, source changes, property recording, shared undo/redo, keyframe dragging, timing edits and isolated exported preview. CI runs both synchronization and HTML animation browser tests before publication.

## Current boundaries

- External stylesheet effects can play and seek in the native preview; import their CSS into a local style element to edit their keyframe definitions in the timeline.
- Named scroll/view-timeline keyframe ranges are preserved in source. The millisecond timeline does not author or drive scroll-linked timelines.
- Arbitrary JavaScript-generated Web Animations effects, transition/state authoring, and dynamic animation-name expressions remain source-driven. The timeline edits CSS keyframe animations.
- CSS variables, cascade layers, selector matching, registered custom properties, interpolation and layout are evaluated by the browser. Unsupported browser features retain their source and do not receive emulated semantics.
- This is a source-range editor with full stylesheet scans, not an incremental CSS compiler or a full CSS semantic language server.

See [CSS Animations Level 1](https://www.w3.org/TR/css-animations-1/) and [Web Animations](https://www.w3.org/TR/web-animations-1/) for the browser timing and interpolation model.
