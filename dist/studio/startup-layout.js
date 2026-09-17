import { createDockLayout, dockGroups } from '../core/docking.js';
import { notify } from './ui.js';

/** Compose the first-run layout after optional panels are registered, not during registration. */
export function initialStudioLayout(panels, documents, compact = false) {
  const ids = [...panels],
    layout = createDockLayout(ids, { documents, preset: compact ? 'compact' : 'designer' });
  if (ids.includes('solution')) {
    layout.hidden = layout.hidden.filter((id) => id !== 'solution');
    if (compact) layout.autoHide.left.unshift('solution');
    else {
      const left = dockGroups(layout).find((group) => group.panels.includes('layers'));
      if (left) {
        left.panels.unshift('solution');
        left.active = 'solution';
      } else layout.hidden.push('solution');
    }
  }
  return layout;
}

/** Restore the original saved intent once the complete panel registry exists. */
export function finishDockingStartup(studio, savedLayout) {
  const docking = studio.docking,
    model = docking.model,
    mode = studio.view;
  let restored = false;
  if (savedLayout) {
    try {
      model.load(savedLayout, { reconcile: true });
      restored = true;
    } catch {
      notify('The saved layout could not be restored. Your documents are unchanged.');
    }
  }
  if (!restored)
    model.load(
      initialStudioLayout(
        model.panels.keys(),
        studio.stores.map((store) => 'document:' + store.document.id),
        docking.control.window.innerWidth < 900,
      ),
    );
  docking.syncCanvas();
  docking.control.render();
  if (!restored && ['design', 'code', 'views'].includes(mode)) docking.setView(mode);
  docking.layoutChanged('Restore completed workspace');
  // Construction is synchronous: these are registration/setup steps, not user layout edits.
  model.history.length = 0;
  model.future.length = 0;
}
