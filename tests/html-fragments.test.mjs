import test from 'node:test';
import assert from 'node:assert/strict';
import { controlDOM } from './control-fixture.mjs';
import {
  createDocument,
  element,
  textNode,
  DocumentStore,
  find,
  validateDocument,
} from '../dist/core/model.js';
import {
  HTML_NAMESPACE,
  SVG_NAMESPACE,
  MATHML_NAMESPACE,
  parseHtml,
  parseHtmlFragment,
  insertHtmlFragment,
  projectHtmlNodes,
  serializeHtml,
  serializeHtmlNode,
  isHtmlElement,
  isHtmlVoid,
  canContainHtmlChildren,
  htmlBody,
  htmlDiagnostics,
  moveHtmlNode,
} from '../dist/core/html.js';
import { HtmlWorkspace } from '../dist/workspaces/html-workspace.js';
import { LabHost } from '../dist/examples/WorkspaceLab/host.js';
import { BlendFeatures } from '../dist/workspaces/blend-features.js';
import { TimelineWorkspace } from '../dist/workspaces/timeline-workspace.js';
import { SolutionWorkspace } from '../dist/workspaces/solution-workspace.js';
const foreign = (type, children = [], namespaceURI = SVG_NAMESPACE) => ({
  ...element(type, {}, children),
  namespaceURI,
});

for (const type of ['style', 'script', 'xmp'])
  test(`foreign ${type} text is escaped instead of becoming raw HTML`, () => {
    const n = foreign(type, [textNode('a < b & </' + type + '><circle/>')]);
    const html = serializeHtmlNode(n);
    assert.match(html, /a &lt; b &amp;/);
    assert(html.includes('&lt;/' + type + '&gt;&lt;circle/&gt;'));
    assert.doesNotThrow(() => validateDocument(createDocument(n, 'HTML')));
  });

test('HTML raw-text validation remains active for both text and CDATA source nodes', () => {
  for (const type of ['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes'])
    for (const kind of ['text', 'cdata']) {
      const n = element(type, {}, [{ ...textNode('</' + type + '><p>escape'), kind }]);
      n.namespaceURI = HTML_NAMESPACE;
      assert.throws(() => validateDocument(createDocument(n, 'HTML')), /Escape the closing/);
    }
});

test('foreign void-looking and preformatted-looking names retain ordinary element semantics', () => {
  assert.equal(serializeHtmlNode(foreign('source', [textNode('value')])), '<source>value</source>');
  assert.equal(serializeHtmlNode(foreign('pre', [textNode('\nvalue')])), '<pre>\nvalue</pre>');
  assert.equal(
    serializeHtmlNode(element('pre', {}, [textNode('\nvalue')])),
    '<pre>\n\nvalue</pre>',
  );
  assert.equal(isHtmlVoid(foreign('input')), false);
  assert.equal(isHtmlVoid(element('input')), true);
  assert.equal(isHtmlElement(foreign('body')), false);
  assert.equal(canContainHtmlChildren(foreign('title')), true);
  assert.equal(canContainHtmlChildren(element('title')), false);
  assert.equal(canContainHtmlChildren(textNode('text')), false);
});

test('foreign template elements project real children, not a missing HTML template content', (t) => {
  const { document } = controlDOM(t);
  const template = document.createElementNS(SVG_NAMESPACE, 'template');
  template.append(document.createTextNode('foreign text'));
  const projected = projectHtmlNodes([template])[0];
  assert.equal(projected.namespaceURI, SVG_NAMESPACE);
  assert.equal(projected.children[0].text, 'foreign text');
  assert.equal(serializeHtmlNode(projected), '<template>foreign text</template>');
});

test('DOM projection keeps foreign CDATA character data as safe canonical text', () => {
  // happy-dom does not implement CDATASection; test the standard DOM node record directly.
  // Native parsing/CDATA round trips are exercised separately in the Chromium suite.
  const native = {
    nodeType: 1,
    localName: 'style',
    namespaceURI: SVG_NAMESPACE,
    attributes: [],
    childNodes: [{ nodeType: 4, nodeValue: 'a > b && c < d' }],
  };
  const nodes = projectHtmlNodes([native]);
  assert.equal(nodes[0].children[0].text, 'a > b && c < d');
  assert.equal(serializeHtmlNode(nodes[0]), '<style>a &gt; b &amp;&amp; c &lt; d</style>');
});

test('HTML-specific diagnostics and document helpers do not misclassify foreign names', () => {
  const html = element('body');
  const doc = createDocument(element('html', {}, [foreign('body'), html, foreign('img')]), 'HTML');
  assert.equal(htmlBody(doc), html);
  assert.deepEqual(htmlDiagnostics(doc), []);
  doc.root.children.push(element('img'));
  assert.equal(htmlDiagnostics(doc).length, 1);
});

test('fragment parser returns identities and namespaces without an artificial html/body wrapper', (t) => {
  const { window } = controlDOM(t);
  const nodes = parseHtmlFragment('before<!-- note --><b data-a="">bold &amp; text</b>after', {
    Parser: window.DOMParser,
  });
  assert.deepEqual(
    nodes.map((n) => n.kind),
    ['text', 'comment', 'element', 'text'],
  );
  assert.equal(nodes[2].namespaceURI, HTML_NAMESPACE);
  assert.equal(nodes[2].children[0].text, 'bold & text');
  assert.equal(nodes[2].props['data-a'], '');
  const again = parseHtmlFragment('<b>again</b>', { Parser: window.DOMParser });
  assert.notEqual(again[0].id, nodes[2].id);
});

test('table fragments use browser context to retain rows and generate their row group', (t) => {
  controlDOM(t);
  const result = parseHtmlFragment('<tr><td>A</td><td>B</td></tr>', { context: element('table') });
  assert.equal(result[0].type, 'tbody');
  assert.equal(result[0].children[0].type, 'tr');
  assert.equal(result[0].children[0].children.length, 2);
});

test('template fragments project inert template contents recursively', (t) => {
  controlDOM(t);
  const result = parseHtmlFragment('<template><b>nested</b></template>', {
    context: element('template'),
  });
  assert.equal(result[0].type, 'template');
  assert.equal(result[0].children[0].type, 'b');
  assert.equal(result[0].children[0].children[0].text, 'nested');
});

test('SVG fragment children preserve namespace and case-sensitive attribute names', (t) => {
  controlDOM(t);
  const result = parseHtmlFragment('<linearGradient id="g"><stop offset="1"/></linearGradient>', {
    context: foreign('svg'),
  });
  assert.equal(result[0].type, 'linearGradient');
  assert.equal(result[0].namespaceURI, SVG_NAMESPACE);
  assert.equal(result[0].children[0].namespaceURI, SVG_NAMESPACE);
});

test('invalid fragment arguments fail before touching the host tree', (t) => {
  controlDOM(t);
  assert.throws(() => parseHtmlFragment(42), /text/);
  assert.throws(() => parseHtmlFragment('x'.repeat(2_000_001)), /2 MB/);
  assert.throws(() => parseHtmlFragment('x', { context: textNode('bad') }), /context/);
  assert.throws(
    () => parseHtmlFragment('x', { context: foreign('node', [], 'urn:unknown') }),
    /namespace/,
  );
  assert.throws(() => parseHtmlFragment('x', { ancestors: Array(151) }), /ancestry/);
});

test('fragment insertion is undoable and returns the exact untouched original source after undo', (t) => {
  controlDOM(t);
  const source = '<!doctype html>\n<html><body><main id="target">before</main></body></html>';
  const doc = parseHtml(source),
    store = new DocumentStore(doc),
    parent = htmlBody(doc).children[0];
  let added;
  store.transaction('Insert fragment', (draft) => {
    added = insertHtmlFragment(draft, parent.id, '<b>new</b><i>more</i>');
  });
  assert.equal(added.length, 2);
  assert.equal(find(store.document.root, parent.id).children.length, 3);
  const identities = added.map((n) => n.id);
  store.undo();
  assert.equal(serializeHtml(store.document), source);
  store.redo();
  assert(identities.every((id) => find(store.document.root, id)));
});

test('insertion failure, no-op parsing and invalid index leave the caller-owned AST unchanged', (t) => {
  controlDOM(t);
  const doc = parseHtml('<main>A</main><input><table></table>');
  const body = htmlBody(doc),
    main = body.children[0],
    input = body.children[1],
    table = body.children[2];
  const before = JSON.stringify(doc);
  assert.throws(() => insertHtmlFragment(doc, input.id, '<b>B</b>'), /cannot contain/);
  assert.throws(() => insertHtmlFragment(doc, main.id, '<b>B</b>', { index: -1 }), /index/);
  assert.throws(() => insertHtmlFragment(doc, main.id, '<b>B</b>', { index: 0.5 }), /index/);
  assert.throws(() => insertHtmlFragment(doc, table.id, 'not a cell'), /cell/);
  assert.deepEqual(insertHtmlFragment(doc, main.id, ''), []);
  assert.equal(JSON.stringify(doc), before);
});

test('full-document safety limits are checked before attaching projected fragment nodes', (t) => {
  controlDOM(t);
  const root = element(
    'div',
    {},
    Array.from({ length: 14999 }, () => textNode('a')),
  );
  const doc = createDocument(root, 'HTML'),
    before = root.children.length;
  assert.throws(() => insertHtmlFragment(doc, root.id, '<b>B</b>'), /safety limit/);
  assert.equal(root.children.length, before);
});

test('moving text children under a foreign title does not apply HTML title restrictions', () => {
  const title = foreign('title'),
    child = foreign('text', [textNode('Caption')]);
  const doc = createDocument(foreign('svg', [title, child]), 'HTML');
  moveHtmlNode(doc, child.id, title.id);
  assert.equal(title.children[0], child);
});

function workspace(t) {
  const dom = controlDOM(t),
    messages = [];
  const host = new LabHost(dom.host(), dom.host(), { notify: (message) => messages.push(message) });
  host.renderNotes = () => {};
  host.menus.menus.push({ label: 'Edit', children: [] });
  const parts = [new BlendFeatures(host), new TimelineWorkspace(host), new SolutionWorkspace(host)];
  const html = new HtmlWorkspace(host);
  parts.push(html);
  t.after(() => {
    for (const part of parts.reverse()) part.dispose();
    host.dispose();
  });
  host.importText('<main id="target">Before</main>', 'fragments.html');
  host.store.select([htmlBody(host.doc).children[0].id]);
  return { ...dom, host, html, messages };
}

test('standalone workspace fragment action shares source/undo and rejects stale targets', (t) => {
  const { host, html, messages } = workspace(t);
  const id = host.selected[0].id,
    count = host.store.history.length;
  const nodes = html.insertFragment('<b>Inserted</b>');
  assert.equal(nodes.length, 1);
  assert.equal(host.store.history.length, count + 1);
  assert.match(serializeHtml(host.doc), /Before<b>Inserted<\/b>/);
  assert.deepEqual(host.store.selection, [nodes[0].id]);
  host.store.undo();
  assert.equal(find(host.doc.root, id).children.length, 1);
  const before = JSON.stringify(host.doc);
  assert.equal(html.insertFragment('<b>No</b>', element('div')), null);
  assert.equal(JSON.stringify(host.doc), before);
  assert(messages.some((message) => message.includes('cannot contain')));
});

test('toolbox SVG creation produces real foreign nodes and contextual shape children', (t) => {
  const { host, html, messages } = workspace(t);
  const [svg] = html.insert('svg');
  assert.equal(svg.namespaceURI, SVG_NAMESPACE);
  assert.equal(svg.children[0].namespaceURI, SVG_NAMESPACE);
  const [circle] = html.insert('circle', svg);
  assert.equal(circle.namespaceURI, SVG_NAMESPACE);
  assert.equal(circle.props.r, '50');
  const before = JSON.stringify(host.doc);
  assert.equal(html.insert('circle', htmlBody(host.doc)), null);
  assert.equal(JSON.stringify(host.doc), before);
  assert.match(messages.at(-1), /SVG container/);
});

test('fragment commands and exported callbacks are cleaned up when their workspace is disposed', (t) => {
  const { host, html } = workspace(t);
  const command = host.menus.commands.get('html-insert-fragment');
  assert(command.enabled());
  const api = html.environment.api.html;
  assert.equal(typeof api.insertFragment, 'function');
  const before = JSON.stringify(host.doc);
  html.dispose();
  assert.equal(host.menus.commands.has(command.id), false);
  assert(!host.menus.menus.find((menu) => menu.label === 'Edit').children.includes(command));
  assert.equal(api.insertFragment('<b>Stale</b>'), null);
  command.run();
  assert.equal(JSON.stringify(host.doc), before);
  assert.equal(host.dialogHost.isOpen, false);
});
