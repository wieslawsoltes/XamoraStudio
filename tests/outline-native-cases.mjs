/** Shared actual-DOM cases used by the HTTP browser gate and local in-memory qualification. */
export async function runOutlineNativeCases(api, host) {
  const {
    MarkupStructureIndex,
    SourceTextCoordinates,
    OutlineTree,
    DocumentStore,
    DocumentSession,
    parseHtml,
  } = api;
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const source =
    '<!doctype html><html><body><table><tr><td>Cell</td></tr></table><svg><g id="shapes"><circle r="10"/></g></svg><math><mrow><mi>x</mi></mrow></math><template><p id="inert">Inert</p></template></body></html>';
  const store = new DocumentStore(parseHtml(source));
  const session = new DocumentSession(store, { source });
  const index = new MarkupStructureIndex(session);
  const entries = index.entries();
  check(
    entries.find((n) => n.label === 'tbody')?.synthetic,
    'Implied tbody has no invented source tag',
  );
  check(
    entries.find((n) => n.label === 'circle')?.namespaceURI === 'http://www.w3.org/2000/svg',
    'SVG namespace retained',
  );
  check(
    entries.find((n) => n.label === 'mi')?.namespaceURI === 'http://www.w3.org/1998/Math/MathML',
    'MathML namespace retained',
  );
  const template = index.path(entries.find((n) => n.detail === '#inert').id);
  check(template.at(-2).label === 'template', 'Template content keeps its canonical owner');
  check(
    index.at(source.indexOf('r="10"')).label === 'circle',
    'Foreign caret resolves to authored source',
  );
  index.dispose();
  session.dispose();
  const selected = [],
    activated = [];
  const data = [
    { id: 'root', label: 'Root' },
    ...Array.from({ length: 10000 }, (_, i) => ({
      id: 'r' + i,
      parentId: 'root',
      label: 'Item ' + i,
    })),
  ];
  const tree = new OutlineTree(host, {
    items: data,
    onSelect: (id) => selected.push(id),
    onActivate: (id) => activated.push(id),
  });
  tree.focus('r9999');
  await new Promise((resolve) => requestAnimationFrame(resolve));
  check(tree.rows.size < 40, 'Only viewport and ancestry should be mounted');
  const row = tree.rows.get('r9999');
  check(
    row.parentElement.getAttribute('role') === 'group',
    'Child ownership uses actual ARIA groups',
  );
  const bounds = tree.element.getBoundingClientRect(),
    rect = row.getBoundingClientRect();
  check(
    rect.top >= bounds.top - 2 && rect.bottom <= bounds.bottom + 3,
    'Last row is actually visible',
  );
  check(
    tree.element.getAttribute('aria-activedescendant') === row.id,
    'Focused row is a real active descendant',
  );
  tree.element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
  );
  check(tree.activeId === 'root', 'Home navigates without selecting');
  check(selected.length === 0, 'Keyboard focus does not author a selection');
  tree.element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
  );
  tree.element.dispatchEvent(
    new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
  );
  tree.element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  check(selected[0] === 'r0' && activated[0] === 'r0', 'Separate selection/activation actions');
  tree.setFilter('Item 9999');
  check(tree.matchCount === 1 && tree.visible.length === 2, 'Filtering retains ancestors');
  const saved = tree.getState();
  tree.setFilter('none');
  check(tree.visible.length === 0, 'Empty filter result');
  tree.restoreState(saved);
  check(tree.matchCount === 1, 'Filter and view-state restoration');
  tree.dispose();
  check(host.children.length === 0, 'Dispose removes only owned DOM');
  const input = document.createElement('textarea');
  host.append(input);
  const coordinates = new SourceTextCoordinates('\uFEFF<Grid>\r\n  <Button/>\r\n</Grid>');
  input.value = coordinates.source;
  check(input.value === coordinates.editorText, 'Real textarea exposes LF-normalized API value');
  const sourceStart = coordinates.source.indexOf('Button');
  input.setSelectionRange(coordinates.toEditor(sourceStart), coordinates.toEditor(sourceStart + 6));
  check(
    input.value.slice(input.selectionStart, input.selectionEnd) === 'Button',
    'DOM/source coordinate selection',
  );
  check(coordinates.toSource(input.selectionStart) === sourceStart, 'Source selection round trip');
  check(
    coordinates.fromEditor(input.value) === coordinates.source,
    'Canonical CRLF preserved on flush',
  );
  input.remove();
  return { nativeNamespaces: 3, virtualItems: data.length, sourceCoordinates: true };
}
