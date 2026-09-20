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

/** Plans are read-only, session-owned and single-use. No source/model mutation occurs until apply. */
export class MarkupRefactorService {
  #plans = new WeakMap();
  constructor(session, { registry = builtins() } = {}) {
    if (!session?.store || typeof session.sourceAtNode !== 'function')
      throw new TypeError('MarkupRefactorService requires a DocumentSession.');
    this.session = session;
    this.registry = registry;
  }
  get document() {
    return this.session.store.document;
  }
  get html() {
    return this.document.framework === 'HTML';
  }
  ready() {
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
    // An HTML trailing slash is not an actual self-close outside foreign content.
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
  /** Exact name locations; attributes/text/comment lookalikes never form extra links. */
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
  container(node, children) {
    if (this.html) return; // The native parser and whole-tree comparison are authoritative.
    const visual = children.filter((n) => n.kind === 'element' && !isProperty(n)),
      descriptor = native.has(node.namespaceURI || '')
        ? this.registry.get(localName(node.type))
        : this.registry.get(node.type, node.namespaceURI);
    if (isXamlInlineContainer(node) && visual.some((n) => !isXamlInline(n)))
      throw Error(
        'Text containers accept inline elements; wrap visual controls in InlineUIContainer.',
      );
    if (
      !isXamlInlineContainer(node) &&
      localName(node.type) !== 'InlineUIContainer' &&
      visual.some(isXamlInline)
    )
      throw Error('Inline elements need a TextBlock or Span-like container.');
    if (descriptor?.singleChild && visual.length > 1)
      throw Error(`${node.type} accepts only one visual child.`);
    if (
      descriptor &&
      !descriptor.container &&
      visual.length &&
      !['Button', 'Label', 'CheckBox', 'RadioButton', 'ToggleButton', 'ContentControl'].includes(
        localName(node.type),
      )
    )
      throw Error(`${node.type} is not a visual container.`);
  }
  prepareRename(target, value) {
    const { node } = this.target(target),
      name = this.name(value, node),
      expected = clone(this.document),
      next = find(expected.root, node.id),
      warnings = [
        'Existing properties, bindings and event handlers are retained. This does not migrate framework APIs or external code-behind.',
      ];
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
    const affected = [node.id];
    if (!this.html)
      for (const child of next.children) {
        if (!owned(child, node)) continue;
        // Keep an existing property-prefix alias while changing the owner's local name.
        const prefix = child.type.includes(':') ? child.type.split(':')[0] + ':' : '';
        child.type =
          prefix +
          localName(name) +
          '.' +
          localName(child.type).slice(localName(node.type).length + 1);
        affected.push(child.id);
      }
    this.container(next, next.children);
    const parent = this.parents().get(node.id);
    if (
      !this.html &&
      parent &&
      isProperty(parent) &&
      /\.Inlines$/.test(parent.type) &&
      !isXamlInline(next)
    )
      throw Error('An Inlines collection requires inline elements.');
    if (parent && !isProperty(parent))
      this.container(
        parent,
        parent.children.map((n) => (n.id === node.id ? next : n)),
      );
    return this.plan(
      'rename',
      expected,
      next.id,
      affected,
      warnings,
      `Rename ${node.type} to ${name}`,
    );
  }
  prepareWrap(targets, value) {
    const ids = [...new Set(Array.isArray(targets) ? targets : [targets])],
      entries = ids.map((id) => this.target(id)),
      parents = this.parents(),
      parent = parents.get(entries[0]?.node.id);
    if (!entries.length || !parent || entries.some((e) => parents.get(e.node.id)?.id !== parent.id))
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
      const descriptor = native.has(namespaceURI)
        ? this.registry.get(localName(name))
        : this.registry.get(name, namespaceURI);
      if (!descriptor?.container) throw Error('Choose a registered container for wrapping.');
      if (isProperty(parent) && /\.Inlines$/.test(parent.type) && !isXamlInline(wrapper))
        throw Error('An Inlines collection requires an inline wrapper.');
    }
    this.container(wrapper, moving);
    const expected = clone(this.document),
      nextParent = find(expected.root, parent.id);
    wrapper.children = nextParent.children.splice(first, last - first + 1, wrapper);
    if (!isProperty(parent)) this.container(nextParent, nextParent.children);
    return this.plan(
      'wrap',
      expected,
      wrapper.id,
      [parent.id, ...moving.map((n) => n.id)],
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
    if (
      !this.html &&
      isProperty(parent) &&
      /\.Inlines$/.test(parent.type) &&
      node.children.some((n) => n.kind === 'element' && !isXamlInline(n))
    )
      throw Error('Unwrapping would place non-inline elements in an Inlines collection.');
    const expected = clone(this.document),
      nextParent = find(expected.root, parent.id),
      index = nextParent.children.findIndex((n) => n.id === node.id),
      children = nextParent.children[index].children;
    nextParent.children.splice(index, 1, ...children);
    if (!isProperty(parent)) this.container(nextParent, nextParent.children);
    const properties = Object.keys(node.props);
    return this.plan(
      'unwrap',
      expected,
      children.find((n) => n.kind === 'element')?.id || parent.id,
      [parent.id, node.id, ...children.map((n) => n.id)],
      [
        `Removing ${node.type} also removes its attributes${properties.length ? ': ' + properties.join(', ') : ''}. Layout, inheritance and references may change.`,
      ],
      `Unwrap ${node.type}`,
    );
  }
  plan(kind, expected, selectedId, affectedNodeIds, warnings, title) {
    const before = this.session.source;
    validateDocument(expected);
    const after = patchDocumentSource(before, this.document, expected, {
      adapter: this.session.adapter,
      index: this.session.index,
    });
    const parsed = this.session.adapter.parse(after, {
      name: this.document.name,
      framework: this.document.framework,
    });
    validateDocument(parsed);
    if (shape(parsed) !== shape(expected))
      throw Error(
        'This refactor would change additional structure, text or namespaces during parsing. Make the source container explicit or choose another tag.',
      );
    const plan = frozen({
      kind,
      title,
      before,
      after,
      selectedId,
      affectedNodeIds: [...new Set(affectedNodeIds)],
      warnings,
      revision: this.session.revision,
      documentId: this.document.id,
    });
    this.#plans.set(plan, {
      root: expected.root,
      source: before,
      revision: plan.revision,
      version: this.session.buffer.version,
    });
    return plan;
  }
  apply(plan) {
    this.ready();
    const data = plan && this.#plans.get(plan);
    if (!data)
      throw Error('This refactoring proposal is unknown, consumed, or belongs to another session.');
    if (
      plan.documentId !== this.document.id ||
      data.source !== this.session.source ||
      data.revision !== this.session.revision ||
      data.version !== this.session.buffer.version
    )
      throw Error('The document changed. Review a new refactoring proposal.');
    // Recheck the preview through the authoritative adapter before entering a transaction.
    const expected = { ...this.document, root: clone(data.root) };
    const parsed = this.session.adapter.parse(plan.after, {
      name: this.document.name,
      framework: this.document.framework,
    });
    if (shape(validateDocument(parsed)) !== shape(expected))
      throw Error('The parser configuration changed. Review a new refactoring proposal.');
    this.session.store.transaction(plan.title, (draft) => {
      draft.root = clone(data.root);
    });
    this.#plans.delete(plan);
    this.session.store.select([plan.selectedId]);
    return {
      changed: plan.before !== plan.after,
      revision: this.session.revision,
      selectedId: plan.selectedId,
    };
  }
}
