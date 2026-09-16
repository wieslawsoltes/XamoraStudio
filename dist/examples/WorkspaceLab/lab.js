import { LabHost } from './host.js';
import { CanvasController } from '../../workspaces/canvas-controller.js';
import { BlendFeatures } from '../../workspaces/blend-features.js';
import { TimelineWorkspace } from '../../workspaces/timeline-workspace.js';
import { SolutionWorkspace } from '../../workspaces/solution-workspace.js';
import { RichProperties } from '../../workspaces/rich-properties.js';
import { ResourceWorkspace } from '../../workspaces/resource-workspace.js';
import { DataEditor } from '../../workspaces/data-editor.js';
import { HtmlWorkspace } from '../../workspaces/html-workspace.js';
const host = new LabHost(document.querySelector('#host'), document.querySelector('#dialogs'), {
  notify: text => { document.querySelector('#message').textContent = text; },
});
const parts = [];
const own = part => { parts.push(part); return part; };
own(new CanvasController(host));
own(new BlendFeatures(host));
own(new TimelineWorkspace(host));
own(new SolutionWorkspace(host));
host.rich = own(new RichProperties(host));
host.resources = own(new ResourceWorkspace(host));
host.data = own(new DataEditor(host));
own(new HtmlWorkspace(host));
host.store.select([host.doc.root.children[0].id]);
host.resources.render();
host.data.sidebar();
window.workspaceLab = { host, parts, dispose() { for (const part of parts.splice(0).reverse()) part.dispose(); host.dispose(); } };
window.addEventListener('pagehide', () => window.workspaceLab.dispose(), {once:true});
