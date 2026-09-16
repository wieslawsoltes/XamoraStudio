/** Isolated DOM realm for reusable-control tests, without Studio or layout assumptions. */
import { Window } from 'happy-dom';
export function controlDOM(t) {
  const window = new Window();
  const frames = new Map();
  let nextFrame = 0;
  const globals = {
    window,
    document: window.document,
    DOMParser: window.DOMParser,
    HTMLElement: window.HTMLElement,
    MouseEvent: window.MouseEvent,
    ResizeObserver: window.ResizeObserver,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => {
    frames.clear();
    window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    window,
    document: window.document,
    flushFrames() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
    },
    host() {
      const host = window.document.createElement('div');
      window.document.body.append(host);
      return host;
    },
  };
}
