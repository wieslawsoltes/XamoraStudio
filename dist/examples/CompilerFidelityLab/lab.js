import {
  compileRenderedDocument,
  observeRenderedDocument,
} from "../../core/compiler-browser.js";
const get = (id) => document.getElementById(id);
let observer,
  result,
  loaded = false,
  active = true;
function show(value) {
  result = value;
  get("output").value = value.source;
  get("download").disabled = !value.success;
  get("status").textContent = value.success
    ? `${value.metadata.geometry.length} measured elements · ${value.losses.length} fidelity notices · ${get("framework").value} · ${value.metadata.browserCapture.viewport.width}px viewport`
    : "Capture failed; see diagnostics.";
  get("diagnostics").replaceChildren(
    ...value.diagnostics.map((diagnostic) => {
      const row = document.createElement("div");
      row.className = "diagnostic";
      const code = document.createElement("strong");
      code.textContent = diagnostic.code + " · ";
      row.append(code, document.createTextNode(diagnostic.message));
      return row;
    }),
  );
}
function connect() {
  observer?.dispose();
  observer = null;
  if (!loaded || !active) return;
  const root = get("source").contentDocument.getElementById("surface");
  const options = { framework: get("framework").value, onResult: show };
  if (get("live").checked) observer = observeRenderedDocument(root, options);
  show(compileRenderedDocument(root, options));
}
async function sourceReady() {
  const doc = get("source").contentDocument;
  if (!doc?.getElementById("surface")) {
    get("status").textContent =
      "The example could not be loaded. Serve this directory over HTTP.";
    return;
  }
  await doc.fonts.ready;
  loaded = true;
  connect();
}
get("source").addEventListener("load", sourceReady);
if (get("source").contentDocument?.getElementById("surface"))
  void sourceReady();
get("viewport").addEventListener("change", () => {
  get("source").style.width = get("viewport").value + "px";
  requestAnimationFrame(() => (observer ? observer.refresh() : connect()));
});
get("framework").addEventListener("change", connect);
get("live").addEventListener("change", connect);
get("capture").addEventListener("click", () =>
  observer ? observer.refresh() : connect(),
);
get("download").addEventListener("click", () => {
  if (!result?.success) return;
  const url = URL.createObjectURL(
    new Blob([result.source], { type: "application/xml" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download =
    get("framework").value === "WPF"
      ? "CapturedView.xaml"
      : "CapturedView.axaml";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener("pagehide", () => {
  active = false;
  observer?.dispose();
  observer = null;
});
window.addEventListener("pageshow", () => {
  active = true;
  connect();
});
