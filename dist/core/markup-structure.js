/** Read-only structural navigation over a canonical source session. No parsing or DOM work. */
const XAML = 'http://schemas.microsoft.com/winfx/2006/xaml';
const EMPTY = Object.freeze([]);

export class MarkupStructureIndex {
  constructor(session) {
    if (!session?.store || typeof session.sourceAtNode !== 'function')
      throw new TypeError('MarkupStructureIndex requires a source session.');
    this.session = session;
    this.builds = 0;
    this.disposed = false;
    this.clear();
  }
  clear() {
    this.items = EMPTY;
    this.byId = new Map();
    this.children = new Map();
    this.intervals = null;
    this.root = null;
    this.source = null;
    this.revision = -1;
  }
  ensure() {
    const session = this.session;
    if (this.disposed || session.disposed || !session.isValid) {
      if (this.root) this.clear();
      return false;
    }
    const doc = session.store.document;
    if (
      this.root === doc.root &&
      this.source === session.source &&
      this.revision === session.revision
    )
      return true;
    const items = [],
      byId = new Map(),
      children = new Map();
    const html = doc.framework === 'HTML';
    const visit = (node, parentId, depth, inherited) => {
      if (node.kind !== 'element') return;
      const namespaces = Object.assign(Object.create(null), inherited);
      for (const [key, value] of Object.entries(node.props || {}))
        if (key === 'xmlns' || key.startsWith('xmlns:')) namespaces[key.slice(6)] = value;
      let name = '',
        resource = '';
      if (html) name = node.props?.id || '';
      else
        for (const [key, value] of Object.entries(node.props || {})) {
          const [prefix, local] = key.split(':');
          if ((namespaces[prefix] === XAML && local === 'Name') || key === 'Name') name = value;
          if (namespaces[prefix] === XAML && local === 'Key') resource = value;
        }
      const span = session.sourceAtNode(node.id);
      const authored = !!span && !span.synthetic && Number.isInteger(span.nameStart);
      const range = authored
        ? Object.freeze({
            start: span.nameStart,
            end: span.nameEnd,
            ...session.index.position(span.nameStart),
          })
        : null;
      const property = !html && node.type.split(':').at(-1).includes('.');
      const item = Object.freeze({
        id: node.id,
        parentId,
        depth,
        label: node.type,
        detail: resource ? `{${resource}}` : name ? `#${name}` : '',
        kind: property ? 'property' : resource ? 'resource' : 'element',
        namespaceURI:
          node.namespaceURI ||
          namespaces[node.type.includes(':') ? node.type.split(':')[0] : ''] ||
          '',
        synthetic: !authored,
        range,
        start: authored ? span.start : null,
        end: authored ? span.end : null,
      });
      items.push(item);
      byId.set(item.id, item);
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(item.id);
      for (const child of node.children || []) visit(child, item.id, depth + 1, namespaces);
    };
    visit(doc.root, null, 0, Object.create(null));
    for (const [id, list] of children) children.set(id, Object.freeze(list));
    // Augmented interval tree: caret lookup does not scan every preceding sibling.
    const ranges = items
      .filter((item) => item.range)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const interval = (lo, hi) => {
      if (lo >= hi) return null;
      const mid = (lo + hi) >>> 1,
        item = ranges[mid];
      const left = interval(lo, mid),
        right = interval(mid + 1, hi);
      return {
        item,
        left,
        right,
        minStart: ranges[lo].start,
        maxEnd: Math.max(item.end, left?.maxEnd || 0, right?.maxEnd || 0),
      };
    };
    this.items = Object.freeze(items);
    this.byId = byId;
    this.children = children;
    this.intervals = interval(0, ranges.length);
    this.root = doc.root;
    this.source = session.source;
    this.revision = session.revision;
    this.builds++;
    return true;
  }
  entries() {
    return this.ensure() ? this.items : EMPTY;
  }
  get(id) {
    return this.ensure() ? this.byId.get(id) || null : null;
  }
  at(offset) {
    if (
      !this.ensure() ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= this.source.length
    )
      return null;
    let best = null;
    const search = (tree) => {
      if (!tree || tree.minStart > offset || tree.maxEnd <= offset) return;
      const item = tree.item;
      if (
        item.start <= offset &&
        offset < item.end &&
        (!best ||
          item.end - item.start < best.end - best.start ||
          (item.end - item.start === best.end - best.start && item.depth > best.depth))
      )
        best = item;
      search(tree.left);
      search(tree.right);
    };
    search(this.intervals);
    return best;
  }
  path(id) {
    if (!this.ensure()) return EMPTY;
    const result = [];
    for (let item = this.byId.get(id); item; item = this.byId.get(item.parentId)) result.push(item);
    return result.reverse();
  }
  related(id, relation) {
    if (!['parent', 'first-child', 'previous-sibling', 'next-sibling'].includes(relation))
      throw new TypeError('Choose parent, first-child, previous-sibling or next-sibling.');
    const item = this.get(id);
    if (!item) return null;
    if (relation === 'parent') return this.byId.get(item.parentId) || null;
    if (relation === 'first-child') return this.byId.get(this.children.get(id)?.[0]) || null;
    const siblings = this.children.get(item.parentId),
      index = siblings.indexOf(id);
    return this.byId.get(siblings[index + (relation === 'next-sibling' ? 1 : -1)]) || null;
  }
  designerId(id) {
    let item = this.get(id);
    while (item?.kind === 'property') item = this.byId.get(item.parentId);
    return item?.id || null;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.session = null;
  }
}
