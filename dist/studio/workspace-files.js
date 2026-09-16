/** Workspace file interchange and local persistence. */
import { uid, validateDocument } from '../core/model.js';
import { parseXaml } from '../core/xaml.js';
import { $, toast } from './ui.js';

export function chooseFile(studio, accept, callback) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => {
    if (input.files[0])
      Promise.resolve(callback(input.files[0])).catch((error) => toast(error.message));
  };
  input.click();
}

export async function importFile(studio, file) {
  if (!studio.prepareEdit()) return;
  if (file.size > 15_000_000) throw Error('Import files up to 15 MB.');
  const text = await file.text();
  if (file.name.endsWith('.json') || file.name.endsWith('.xamora')) {
    const data = JSON.parse(text);
    if (data.format === 'xamora-workspace' && Array.isArray(data.documents)) {
      data.documents.forEach(validateDocument);
      for (const m of data.toolkits || []) studio.registry.install(m);
      const remap = new Map(),
        seen = new Set(studio.stores.map((s) => s.document.id));
      for (const d of data.documents) {
        const old = d.id;
        if (seen.has(old)) {
          d.id = uid();
          remap.set(old, d.id);
        }
        seen.add(d.id);
      }
      for (const d of data.documents)
        for (const c of d.metadata?.interactions || [])
          for (const a of c.actions || [])
            if (remap.has(a.targetViewId)) a.targetViewId = remap.get(a.targetViewId);
      data.documents.forEach((d) => studio.addStore(d));
      studio.switchDocument(studio.stores.length - data.documents.length);
      toast(`${data.documents.length} pages imported`);
    } else if (data.version && data.root) {
      validateDocument(data);
      studio.addStore(data);
      studio.switchDocument(studio.stores.length - 1);
    } else if (data.controls) {
      studio.registry.install(data);
      studio.save();
      studio.leftTab = 'toolkit';
      studio.renderLeft();
      toast('Toolkit installed');
    } else throw Error('Unrecognized JSON file.');
  } else studio.importText(text, file.name);
}

export function importText(studio, text, name = 'Imported.xaml') {
  if (!studio.prepareEdit()) return;
  const doc = parseXaml(text, { name });
  studio.addStore(doc);
  studio.switchDocument(studio.stores.length - 1);
  toast(doc.framework === 'HTML' ? 'HTML imported' : 'XAML imported');
  return doc.id;
}

export function workspaceData(studio) {
  return {
    format: 'xamora-workspace',
    version: 1,
    documents: studio.stores.map((s) => s.document),
    toolkits: [...studio.registry.toolkits.values()],
    solution: studio.solution?.model,
    activeId: studio.doc.id,
    exportedAt: new Date().toISOString(),
  };
}

export function svgSnapshot(studio) {
  const host = $('#artboard').cloneNode(true);
  host.removeAttribute('id');
  host.querySelectorAll('[data-node-id]').forEach((n) => n.removeAttribute('data-node-id'));
  const w = studio.artSize.width,
    h = studio.artSize.height;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:system-ui;font-size:14px;color:#292834;background:white">${host.innerHTML}</div></foreignObject></svg>`;
}

export function save(studio) {
  try {
    localStorage.setItem(
      'xamora-workspace-v1',
      JSON.stringify({
        documents: studio.stores.map((s) => s.document),
        active: studio.active,
        toolkits: [...studio.registry.toolkits.values()],
        solution: studio.solution?.model,
      }),
    );
    $('#save-state').textContent = 'Saved on this device';
  } catch (error) {
    $('#save-state').textContent = 'Local storage full · Export to save';
    toast('Device storage is full. Export your project to keep a copy.');
  }
}
