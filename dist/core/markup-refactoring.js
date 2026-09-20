/** Reviewable AST refactoring over the canonical concrete-source transaction path. */
import {
  clone,
  element,
  find,
  walk,
  localName,
  isProperty,
  isXamlInline,
  isXamlInlineContainer,
  validateDocument,
} from './model.js';
import { builtins } from './registry.js';
import { patchDocumentSource } from './document-session.js';
import { HTML_NAMESPACE, HTML_VOID } from './html.js';
import { htmlChildNamespace } from './markup-context.js';

const qname = /^(?:[A-Za-z_][\w-]*:)?[A-Za-z_][\w-]*$/;
const native = new Set([
  '',
  'http://schemas.microsoft.com/winfx/2006/xaml/presentation',
  'https://github.com/avaloniaui',
]);
const protectedHTML = new Set(['html', 'head', 'body', 'template']);
const contentControls = new Set([
  'Button',
  'Label',
  'CheckBox',
  'RadioButton',
  'ToggleButton',
  'ContentControl',
  'ContentPresenter',
  'ControlTemplate',
  'DataTemplate',
]);
const owned = (node, parent) =>
  isProperty(node) &&
  localName(node.type).startsWith(localName(parent.type) + '.') &&
  (node.namespaceURI || '') === (parent.namespaceURI || '');
const signature = (node, html, inherited = {}) => {
  if (node.kind !== 'element') return [node.kind, node.text];
  const scope = { ...inherited };
  if (!html)
    for (const [key, value] of Object.entries(node.props || {})) {
      if (key === 'xmlns') scope[''] = value;
      else if (key.startsWith('xmlns:')) scope[key.slice(6)] = value;
    }
  const namespace =
    node.namespaceURI ??
    (html ? HTML_NAMESPACE : scope[node.type.includes(':') ? node.type.split(':')[0] : ''] || '');
  return [
    'element',
    node.type,
    namespace,
    Object.entries(node.props || {}).sort(([a], [b]) => a.localeCompare(b)),
    (node.children || []).map((n) => signature(n, html, scope)),
  ];
};
const shape = (doc) =>
  JSON.stringify([
    doc.framework,
    (doc.preamble || []).map((n) => signature(n, false)),
    signature(doc.root, doc.framework === 'HTML'),
    (doc.postamble || []).map((n) => signature(n, false)),
    doc.framework === 'HTML' ? doc.metadata?.html?.doctype || '' : null,
  ]);
const frozen = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
};
const subtreeIds = (nodes) => {
  const ids = [];
  for (const node of nodes) walk(node, (n) => ids.push(n.id));
  return ids;
};

/** Plans are immutable, session-owned and single-use. Preparation never edits the document. */
export class MarkupRefactorService {
  #plans = new WeakMap();
  #applying = false;
  constructor(session, { registry = builtins() } = {}) {
    if (!session?.store || typeof session.sourceAtNode !== 'function')
      throw new TypeError('MarkupRefactorService requires a DocumentSession.');
    this.session = session;
    this.registry = registry;
    this.disposed = false;
  }
  get document() {
    return this.session.store.document;
  }
  get html() {
    return this.document.framework === 'HTML';
  }
  ready() {
    if (this.disposed || this.session.disposed)
      throw Error('This refactoring session is disposed.');
    if (this.#applying) throw Error('A refactoring transaction is already active.');
    if (!this.session.isValid || this.session.source !== this.session.validSource)
      throw Error('Fix source errors before refactoring. The current draft has not been changed.');
  }
  target(value) {
    this.ready();
    let node;
    if (typeof value === 'string') node = find(this.document.root, value);
    else if (Number.isSafeInteger(value) && value >= 0 && value < this.session.source.length) {
      const span = (this.session.index?.spans || [])
        .filter((s) => s.kind === 'element' && !s.synthetic && s.start <= value && value < s.end)
        .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
      node = span && find(this.document.root, span.nodeId);
    }
    const span = node && this.session.sourceAtNode(node.id);
    if (!node || node.kind !== 'element' || !span || span.synthetic)
      throw Error('Choose an authored element with an explicit source tag.');
    if (!this.html && isProperty(node))
      throw Error('Choose the owning XAML control, not its property-element wrapper.');
    if (
      this.html &&
      (node.namespaceURI || HTML_NAMESPACE) === HTML_NAMESPACE &&
      protectedHTML.has(node.type)
    )
      throw Error('Document and template boundaries must be edited explicitly in source.');
    if (span.closeNameStart === undefined && !span.selfClosing && !span.void)
      throw Error('Make this element’s closing tag explicit before refactoring.');
    if (
      this.html &&
      !span.void &&
      span.selfClosing &&
      (node.namespaceURI || HTML_NAMESPACE) === HTML_NAMESPACE &&
      span.closeNameStart === undefined
    )
      throw Error('Make this HTML element’s closing tag explicit before refactoring.');
    return { node, span };
  }
  /** Exact UTF-16 tag-name locations, not text/comment/attribute lookalikes. */
  linkedTagRanges(offset) {
    try {
      const { node, span } = this.target(offset);
      if (!(
        (offset >= span.nameStart && offset <= span.nameEnd) ||
        (offset >= span.closeNameStart && offset <= span.closeNameEnd)
      ))
        return [];
      return [
        [span.nameStart, span.nameEnd],
        ...(span.closeNameStart === undefined ? [] : [[span.closeNameStart, span.closeNameEnd]]),
      ].map(([start, end]) => ({
        start,
        end,
        nodeId: node.id,
        ...this.session.index.position(start),
      }));
    } catch {
      return [];
    }
  }
  parents() {
    const result = new Map();
    walk(this.document.root, (node, parent) => {
      if (parent) result.set(node.id, parent);
    });
    return result;
  }
  namespace(name, owner) {
    if (this.html) return owner?.namespaceURI || HTML_NAMESPACE;
    const prefix = name.includes(':') ? name.split(':')[0] : '',
      key = prefix ? 'xmlns:' + prefix : 'xmlns',
      parents = this.parents();
    for (let n = owner; n; n = parents.get(n.id))
      if (Object.hasOwn(n.props || {}, key)) return n.props[key];
    if (prefix) throw Error(`Declare the ${prefix} namespace prefix before using it.`);
    return '';
  }
  name(value, owner) {
    if (
      typeof value !== 'string' ||
      value.length > 160 ||
      !qname.test(value) ||
      (this.html && value.includes(':'))
    )
      throw Error('Enter a supported tag name, not markup or a property name.');
    return this.html && (owner?.namespaceURI || HTML_NAMESPACE) === HTML_NAMESPACE
      ? value.toLowerCase()
      : value;
  }
  descriptor(node) {
    const ns = node.namespaceURI || '';
    // Registry.get has a legacy unqualified fallback; do not treat foreign Button as native.
    if (native.has(ns)) return this.registry.get(localName(node.type), ns);
    const descriptor = this.registry.get(node.type, ns);
    return node.type.includes(':') || descriptor?.namespaceURI === ns ? descriptor : undefined;
  }
  container(node, children) {
    if (this.html) return; // Native HTML parse + full namespace-aware comparison is authoritative.
    const visual = children.filter((n) => n.kind === 'element' && !isProperty(n));
    if (isProperty(node)) {
      const property = localName(node.type).split('.').at(-1);
      if (!['Children', 'Child', 'Content', 'Items', 'Inlines'].includes(property))
        throw Error(
          'Restructure resource and non-content property collections explicitly in source.',
        );
      if (property === 'Inlines' && visual.some((n) => !isXamlInline(n)))
        throw Error('An Inlines collection requires inline elements.');
      if (['Child', 'Content'].includes(property) && visual.length > 1)
        throw Error(`${node.type} accepts only one visual child.`);
      return;
    }
    const descriptor = this.descriptor(node),
      content = native.has(node.namespaceURI || '') && contentControls.has(localName(node.type));
    if (isXamlInlineContainer(node) && visual.some((n) => !isXamlInline(n)))
      throw Error(
        'Text containers accept inline elements; wrap visual controls in InlineUIContainer.',
      );
    if (!isXamlInlineContainer(node) && visual.some(isXamlInline))
      throw Error('Inline elements need a TextBlock or Span-like container.');
    if ((descriptor?.singleChild || content) && visual.length > 1)
      throw Error(`${node.type} accepts only one visual child.`);
    if (descriptor && !descriptor.container && !content && visual.length)
      throw Error(`${node.type} is not a visual container.`);
  }
  prepareRename(target, value) {
    const { node } = this.target(target),
      name = this.name(value, node),
      expected = clone(this.document),
      next = find(expected.root, node.id);
    if (!this.html && this.namespace(name, node) !== this.namespace(node.type, node))
      throw Error(
        'Tag renaming must stay in the same XML namespace; edit namespace changes explicitly.',
      );
    if (
      this.html &&
      (node.namespaceURI || HTML_NAMESPACE) === HTML_NAMESPACE &&
      (protectedHTML.has(name) || HTML_VOID.has(node.type) !== HTML_VOID.has(name))
    )
      throw Error(
        'Keep the same HTML tag termination kind; document/template boundaries require explicit source editing.',
      );
    next.type = name;
    if (!this.html)
      for (const child of next.children) {
        if (!owned(child, node)) continue;
        const prefix = child.type.includes(':') ? child.type.split(':')[0] + ':' : '';
        child.type =
          prefix +
          localName(name) +
          '.' +
          localName(child.type).slice(localName(node.type).length + 1);
      }
    this.container(next, next.children);
    const parent = this.parents().get(node.id);
    // Content wrappers get the same single-child and inline rules as their owners.
    if (
      parent &&
      (!isProperty(parent) || /\.(Children|Child|Content|Items|Inlines)$/.test(parent.type))
    )
      this.container(
        parent,
        parent.children.map((n) => (n.id === node.id ? next : n)),
      );
    return this.plan(
      'rename',
      expected,
      next.id,
      subtreeIds([node]),
      [
        'Existing properties, bindings and event handlers are retained. This does not migrate framework APIs or external code-behind.',
      ],
      `Rename ${node.type} to ${name}`,
    );
  }
  prepareWrap(targets, value) {
    const values = Array.isArray(targets) ? targets : [targets];
    if (!values.length) throw Error('Choose sibling elements to wrap.');
    const entries = [
        ...new Map(
          values.map((id) => {
            const e = this.target(id);
            return [e.node.id, e];
          }),
        ).values(),
      ],
      parents = this.parents(),
      parent = parents.get(entries[0].node.id);
    if (!parent || entries.some((e) => parents.get(e.node.id)?.id !== parent.id))
      throw Error('Choose sibling elements within one explicit container, not a document root.');
    const positions = entries
        .map((e) => parent.children.findIndex((n) => n.id === e.node.id))
        .sort((a, b) => a - b),
      selected = new Set(entries.map((e) => e.node.id)),
      first = positions[0],
      last = positions.at(-1),
      moving = parent.children.slice(first, last + 1);
    if (moving.some((n) => n.kind === 'element' && !selected.has(n.id)))
      throw Error('Select consecutive sibling elements before wrapping.');
    this.name(value, parent);
    const namespaceURI = this.html
        ? htmlChildNamespace(
            {
              type: parent.type,
              namespaceURI: parent.namespaceURI || HTML_NAMESPACE,
              attributes: new Map(Object.entries(parent.props)),
            },
            value,
          )
        : this.namespace(value, parent),
      name = this.name(value, { ...parent, namespaceURI }),
      wrapper = { ...element(name), namespaceURI };
    if (
      this.html &&
      namespaceURI === HTML_NAMESPACE &&
      (protectedHTML.has(name) || HTML_VOID.has(name))
    )
      throw Error('Choose a normal container for the wrapper.');
    if (!this.html) {
      if (!this.descriptor(wrapper)?.container)
        throw Error('Choose a registered container for wrapping.');
      wrapper.scope = clone(parent.scope || {});
      wrapper.space = parent.space;
      // Optional parser metadata must never create an undefined history value.
      if (wrapper.space === undefined) delete wrapper.space;
    }
    this.container(wrapper, moving);
    const expected = clone(this.document),
      nextParent = find(expected.root, parent.id);
    wrapper.children = nextParent.children.splice(first, last - first + 1, wrapper);
    this.container(nextParent, nextParent.children);
    return this.plan(
      'wrap',
      expected,
      wrapper.id,
      [parent.id, ...subtreeIds(moving)],
      [
        'Wrapping may change layout, inheritance, selectors and data context. No properties are moved onto the wrapper.',
      ],
      `Wrap in ${name}`,
    );
  }
  prepareUnwrap(target) {
    const { node, span } = this.target(target),
      parent = this.parents().get(node.id);
    if (!parent || span.closeNameStart === undefined || !node.children.length)
      throw Error(
        'Choose a nonempty element with explicit opening and closing tags, not the document root.',
      );
    if (
      !this.html &&
      (Object.keys(node.props).some(
        (k) => k === 'xmlns' || k.startsWith('xmlns:') || k === 'xml:space',
      ) ||
        node.children.some(isProperty))
    )
      throw Error(
        'Move namespace declarations, xml:space and property elements explicitly before removing this wrapper.',
      );
    const expected = clone(this.document),
      nextParent = find(expected.root, parent.id),
      index = nextParent.children.findIndex((n) => n.id === node.id),
      children = nextParent.children[index].children;
    nextParent.children.splice(index, 1, ...children);
    this.container(nextParent, nextParent.children);
    const properties = Object.keys(node.props);
    return this.plan(
      'unwrap',
      expected,
      children.find((n) => n.kind === 'element')?.id || parent.id,
      [parent.id, ...subtreeIds([node])],
      [
        `Removing ${node.type} also removes its attributes${properties.length ? ': ' + properties.join(', ') : ''}. Layout, inheritance and references may change.`,
      ],
      `Unwrap ${node.type}`,
    );
  }
  stamp() {
    return {
      source: this.session.source,
      revision: this.session.revision,
      version: this.session.buffer.version,
      state: JSON.stringify(this.document),
    };
  }
  assertCurrent(data) {
    if (this.disposed || this.session.disposed || !this.session.isValid)
      throw Error('The refactoring session is no longer available.');
    if (
      data.source !== this.session.source ||
      data.revision !== this.session.revision ||
      data.version !== this.session.buffer.version ||
      data.state !== JSON.stringify(this.document)
    )
      throw Error('The document changed. Review a new refactoring proposal.');
  }
  plan(kind, expected, selectedId, affectedNodeIds, warnings, title) {
    this.ready();
    const data = this.stamp(),
      before = data.source;
    validateDocument(expected);
    const after = patchDocumentSource(before, this.document, expected, {
      adapter: this.session.adapter,
      index: this.session.index,
    });
    const parsed = this.session.adapter.parse(after, {
      name: this.document.name,
      framework: this.document.framework,
    });
    if (shape(validateDocument(parsed)) !== shape(expected))
      throw Error(
        'This refactor would change additional structure, text or namespaces during parsing. Make the source container explicit or choose another tag.',
      );
    this.assertCurrent(data);
    const plan = frozen({
      kind,
      title,
      before,
      after,
      selectedId,
      affectedNodeIds: [...new Set(affectedNodeIds)],
      warnings,
      revision: data.revision,
      documentId: this.document.id,
    });
    this.#plans.set(plan, { ...data, root: clone(expected.root) });
    return plan;
  }
  apply(plan) {
    this.ready();
    const data = plan && this.#plans.get(plan);
    if (!data)
      throw Error('This refactoring proposal is unknown, consumed, or belongs to another session.');
    this.assertCurrent(data);
    const changed = plan.before !== plan.after;
    this.#applying = true;
    try {
      const expected = { ...this.document, root: clone(data.root) };
      const parsed = this.session.adapter.parse(plan.after, {
        name: this.document.name,
        framework: this.document.framework,
      });
      if (shape(validateDocument(parsed)) !== shape(expected))
        throw Error('The parser configuration changed. Review a new refactoring proposal.');
      // Adapters are caller-provided code; reentrant changes invalidate the proposal too.
      this.assertCurrent(data);
      if (changed) {
        // Final hook checks the exact reviewed source after the session's source patch hook.
        const removeCheck = this.session.store.addCommitHook(({ document }) => {
          if (document.metadata?.source?.text !== plan.after || shape(document) !== shape(expected))
            throw Error(
              'The applied source differs from the reviewed proposal. No refactor was committed.',
            );
        });
        try {
          this.session.store.transaction(plan.title, (draft) => {
            draft.root = clone(data.root);
          });
        } finally {
          removeCheck();
        }
      }
      this.#plans.delete(plan);
    } finally {
      this.#applying = false;
    }
    this.session.store.select([plan.selectedId]);
    return { changed, revision: this.session.revision, selectedId: plan.selectedId };
  }
  dispose() {
    this.disposed = true;
    this.#plans = new WeakMap();
  }
}
