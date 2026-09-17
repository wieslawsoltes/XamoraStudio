/** Compose the designer host and its feature workspaces in dependency order. */
import { ExperienceWorkspace } from './studio/experience-workspace.js';
import { Studio } from './studio/studio.js';
import { $, esc, download } from './studio/ui.js';
import { EditorWorkspace } from './studio/editor-workspace.js';
import { CompilerWorkspace } from './studio/compiler-workspace.js';
import { DockingStudio } from './studio/docking-studio.js';
import { BlendFeatures } from './studio/blend-features.js';
import { DesignerFeatures } from './studio/features.js';

try {
  const studio = new Studio();
  new DesignerFeatures(studio);
  new BlendFeatures(studio);
  new DockingStudio(studio);
  new EditorWorkspace(studio);
  new CompilerWorkspace(studio);
  new ExperienceWorkspace(studio);
} catch (error) {
  console.error(error);
  document.getElementById('app').innerHTML =
    `<div style="padding:40px;font:16px system-ui;color:#363540"><h1>Xamora Studio could not open this workspace</h1><p>${esc(error.message)}</p><button id="recover-workspace" style="padding:12px;border:1px solid #ddd;border-radius:6px">Back up saved data and reopen samples</button></div>`;
  $('#recover-workspace').onclick = () => {
    const saved = localStorage.getItem('xamora-workspace-v1');
    if (saved) download('xamora-recovery.json', saved, 'application/json');
    localStorage.removeItem('xamora-workspace-v1');
    location.reload();
  };
}
