/** Legacy application services. Reusable workspace packages do not import this adapter. */
import { notify, saveFile } from './ui.js';
export function studioComponentOptions(studio) {
  if (studio.workspaceOptions) return studio.workspaceOptions;
  return {
    root: document,
    domScope: studio.documentScope,
    ...(studio.documentScope
      ? {
          scheduleFrame: (callback) => studio.documentScope.frame(callback),
          cancelFrame: (id) => studio.documentScope.cancelFrame(id),
        }
      : {}),
    api: window.xamora || {},
    storage: window.localStorage,
    notify,
    saveFile,
    styles: {
      'html-animation': new URL('../styles/html-animation.css', import.meta.url).href,
      'html-states': new URL('../styles/html-states.css', import.meta.url).href,
    },
  };
}
