import {
  compileRenderedDocument,
  observeRenderedDocument,
} from '../../core/compiler-browser.js';

const get = (id) => document.getElementById(id);
let observer, result, loaded = false, active = true, epoch = 0, frame = 0;
const urls = new Map();
function failed(error) {
  result = null;
  get('download').disabled = true;
  get('status').textContent = `Capture failed: ${error.message || error}`;
}
function show(value) {
  result = value;
  get('output').value = value.source;
  get('download').disabled = !value.success;
  get('status').textContent = value.success
    ? `${value.metadata.rendered.nodes} measured elements · ${value.losses.length} fidelity notices · ${get('framework').value} · ${get('source').contentWindow.innerWidth}px viewport`
    : 'Capture failed; see diagnostics.';
  get('diagnostics').replaceChildren(...value.diagnostics.map((diagnostic) => {
    const row = document.createElement('div');
    row.className = 'diagnostic';
    const code = document.createElement('strong');
    code.textContent = diagnostic.code + ' · ';
    row.append(code, document.createTextNode(diagnostic.message));
    return row;
  }));
}
function connect() {
  observer?.dispose();
  observer = null;
  if (!loaded || !active) return;
  try {
    const root = get('source').contentDocument.getElementById('surface');
    const options = { framework: get('framework').value, onResult: show, onError: failed };
    if (get('live').checked) observer = observeRenderedDocument(root, options);
    else show(compileRenderedDocument(root, options));
  } catch (error) { failed(error); }
}
async function sourceReady() {
  const token = ++epoch;
  const doc = get('source').contentDocument;
  if (!doc?.getElementById('surface')) {
    failed(new Error('Serve this directory over HTTP to load the example.'));
    return;
  }
  await doc.fonts.ready;
  if (token !== epoch || !active || doc !== get('source').contentDocument) return;
  loaded = true;
  connect();
}
get('source').addEventListener('load', () => void sourceReady().catch(failed));
if (get('source').contentDocument?.getElementById('surface')) void sourceReady().catch(failed);
get('viewport').addEventListener('change', () => {
  get('source').style.width = get('viewport').value + 'px';
  if (frame) cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (active) observer ? observer.refresh() : connect();
  });
});
get('framework').addEventListener('change', connect);
get('live').addEventListener('change', connect);
get('capture').addEventListener('click', () => observer ? observer.refresh() : connect());
get('download').addEventListener('click', () => {
  if (!result?.success) return;
  const url = URL.createObjectURL(new Blob([result.source], { type: 'application/xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = get('framework').value === 'WPF' ? 'CapturedView.xaml' : 'CapturedView.axaml';
  link.click();
  urls.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 1000));
});
window.addEventListener('pagehide', () => {
  active = false;
  epoch++;
  observer?.dispose();
  observer = null;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url); }
  urls.clear();
});
window.addEventListener('pageshow', (event) => {
  active = true;
  if (event.persisted) void sourceReady().catch(failed);
});
