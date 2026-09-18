/** Source-backed semantic operations for literal markup references. No markup or scripts execute. */
import { walk, localName } from './model.js';
import { completeXaml, completionContext } from './xaml-language.js';
import { completeHtml, HTML_CSS } from './html.js';
import { builtins } from './registry.js';
const XAML = 'http://schemas.microsoft.com/winfx/2006/xaml';
const nativeNamespaces = new Set([
  '',
  'http://schemas.microsoft.com/winfx/2006/xaml/presentation',
  'https://github.com/avaloniaui',
  'http://schemas.microsoft.com/dotnet/2021/maui',
]);
const scopes = new Set([
  'Style',
  'ControlTemplate',
  'DataTemplate',
  'ItemsPanelTemplate',
  'FrameworkTemplate',
]);
const idrefs = new Set([
  'for',
  'list',
  'form',
  'headers',
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'aria-owns',
  'aria-activedescendant',
  'aria-details',
  'aria-errormessage',
  'popovertarget',
  'commandfor',
]);
const cssValues = {
  display: ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'none', 'contents'],
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  'flex-direction': ['row', 'column', 'row-reverse', 'column-reverse'],
  'justify-content': ['start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'],
  'align-items': ['start', 'center', 'end', 'stretch', 'baseline'],
  'animation-fill-mode': ['none', 'forwards', 'backwards', 'both'],
  'animation-direction': ['normal', 'reverse', 'alternate', 'alternate-reverse'],
  'animation-play-state': ['running', 'paused'],
  'animation-timing-function': [
    'linear',
    'ease',
    'ease-in',
    'ease-out',
    'ease-in-out',
    'steps(2, end)',
    'cubic-bezier(0.4, 0, 0.2, 1)',
  ],
  overflow: ['visible', 'hidden', 'auto', 'scroll'],
  color: ['transparent', 'currentColor', 'inherit', '#000000', '#ffffff'],
  'font-weight': ['normal', 'bold', '400', '500', '600', '700'],
};
const cssProperties = [
  ...new Set([
    ...HTML_CSS,
    ...Object.keys(cssValues),
    'animation',
    'animation-name',
    'animation-duration',
    'animation-delay',
    'animation-iteration-count',
    'transition',
    'transition-property',
    'transition-duration',
    'transition-timing-function',
    'transform-origin',
    'visibility',
    'z-index',
    'cursor',
    'object-fit',
    'aspect-ratio',
    'filter',
    'clip-path',
    'fill',
    'stroke',
  ]),
];
const primitiveLiteral = (value) => value && !/[\s{}&<>"']/u.test(value);
const lower = (s) => String(s).toLowerCase();

export class SemanticLanguageService {
  constructor(session, { registry = builtins(), context = {} } = {}) {
    this.session = session;
    this.registry = registry;
    this.context = context;
    this._source = null;
    this._revision = -1;
  }
  get document() {
    return this.session.store.document;
  }
  _position(start) {
    if (this.session.index?.position) return this.session.index.position(start);
    const prefix = this._source.slice(0, start);
    return { line: prefix.split('\n').length, column: start - prefix.lastIndexOf('\n') };
  }
  _location(node, kind, name, start, end, extra = {}) {
    return { nodeId: node.id, kind, name, start, end, ...this._position(start), ...extra };
  }
  _namespace(node, prefix) {
    for (let n = node; n; n = this.parents.get(n.id)) {
      const value = n.props?.[prefix ? 'xmlns:' + prefix : 'xmlns'];
      if (value !== undefined) return value;
    }
    return '';
  }
  _native(node) {
    const prefix = node.type?.includes(':') ? node.type.split(':')[0] : '';
    return nativeNamespaces.has(this._namespace(node, prefix));
  }
  _xamlAttribute(node, key, name) {
    const split = key.split(':');
    return split.length === 2 && split[1] === name && this._namespace(node, split[0]) === XAML;
  }
  _nameScope(node) {
    for (let n = node; n; n = this.parents.get(n.id))
      if (n.kind === 'element' && this._native(n) && scopes.has(localName(n.type))) return n.id;
    return this.document.root.id;
  }
  _resourceScope(node) {
    for (let n = this.parents.get(node.id); n; n = this.parents.get(n.id)) {
      if (n.kind !== 'element') continue;
      const type = localName(n.type);
      if (type.endsWith('.Resources') && this._native(n)) return this.parents.get(n.id)?.id || n.id;
      if (type === 'ResourceDictionary' && this._native(n)) {
        const p = this.parents.get(n.id);
        return p && localName(p.type).endsWith('.Resources')
          ? this.parents.get(p.id)?.id || n.id
          : n.id;
      }
    }
    return this.document.root.id;
  }
  _htmlScope(node) {
    for (let n = this.parents.get(node.id); n; n = this.parents.get(n.id))
      if (
        n.type === 'template' &&
        (!n.namespaceURI || n.namespaceURI === 'http://www.w3.org/1999/xhtml')
      )
        return n.id;
    return this.document.root.id;
  }
  _scopeChain(node) {
    const ids = [];
    for (let n = node; n; n = this.parents.get(n.id)) ids.push(n.id);
    return ids;
  }
  _ensure() {
    if (this._source === this.session.validSource && this._revision === this.session.revision)
      return;
    this._source = this.session.validSource;
    this._revision = this.session.revision;
    this.parents = new Map();
    this.nodes = new Map();
    this._declarations = [];
    this._references = [];
    this._outline = [];
    this._unsafeCss = false;
    this._encodedReferences = new Set();
    walk(this.document.root, (node, parent) => {
      this.nodes.set(node.id, node);
      if (parent) this.parents.set(node.id, parent);
    });
    const html = this.document.framework === 'HTML';
    for (const node of this.nodes.values()) {
      if (node.kind !== 'element') continue;
      const span = this.session.sourceAtNode(node.id);
      if (!span) continue;
      const attrs = span.attrs || [];
      let declared = false;
      for (const attr of attrs) {
        const value = String(node.props[attr.name] ?? ''),
          raw = this._source.slice(attr.valueStart, attr.valueEnd);
        let kind;
        if (html && attr.name === 'id') kind = 'html-id';
        else if (!html && this._xamlAttribute(node, attr.name, 'Key')) kind = 'resource';
        else if (
          !html &&
          (this._xamlAttribute(node, attr.name, 'Name') ||
            (attr.name === 'Name' && this._native(node)))
        )
          kind = 'element';
        if (!kind || !primitiveLiteral(value) || attr.valueStart === undefined) continue;
        let unsupported;
        for (
          let ancestor = this.parents.get(node.id);
          kind === 'resource' && ancestor;
          ancestor = this.parents.get(ancestor.id)
        )
          if (/\.(?:MergedDictionaries|ThemeDictionaries)$/.test(ancestor.type || ''))
            unsupported =
              'Resources inside merged or theme dictionaries require project-level lookup before rename.';
        const entry = this._location(node, kind, value, attr.valueStart, attr.valueEnd, {
          id: `${node.id}:${attr.name}`,
          attribute: attr.name,
          declaration: true,
          scopeId: html
            ? this._htmlScope(node)
            : kind === 'resource'
              ? this._resourceScope(node)
              : this._nameScope(node),
          renamable: raw === value && !/[&\\]/.test(raw) && !unsupported,
          unsupported,
          type: node.type,
          selectionRange: { start: attr.valueStart, end: attr.valueEnd },
        });
        this._declarations.push(entry);
        this._outline.push(entry);
        declared = true;
      }
      if (!declared)
        this._outline.push(
          this._location(
            node,
            'element',
            node.type,
            span.nameStart ?? span.start,
            span.nameEnd ?? span.openEnd ?? span.end,
            {
              id: node.id,
              renamable: false,
              type: node.type,
              scopeId: html ? this._htmlScope(node) : this._nameScope(node),
              selectionRange: {
                start: span.nameStart ?? span.start,
                end: span.nameEnd ?? span.openEnd ?? span.end,
              },
            },
          ),
        );
      for (const attr of attrs) {
        if (attr.valueStart === undefined) continue;
        const raw = this._source.slice(attr.valueStart, attr.valueEnd);
        if (html) this._htmlReferences(node, attr, raw);
        else this._xamlReferences(node, attr, raw);
      }
      if (html && node.type === 'style')
        for (const child of node.children || []) {
          const range = this.session.sourceAtNode(child.id);
          if (range && child.kind === 'text')
            this._cssReferences(node, this._source.slice(range.start, range.end), range.start);
        }
    }
    this._references.sort((a, b) => a.start - b.start);
    this._outline.sort((a, b) => a.start - b.start);
  }
  _addReference(node, kind, name, start, end, extra = {}) {
    if (!primitiveLiteral(name) || start === end) return;
    this._references.push(
      this._location(node, kind, name, start, end, {
        scopeId:
          kind === 'html-id'
            ? this._htmlScope(node)
            : kind === 'resource'
              ? this._resourceScope(node)
              : this._nameScope(node),
        ...extra,
      }),
    );
  }
  _xamlReferences(node, attr, raw) {
    const absolute = attr.valueStart,
      property = attr.name,
      decoded = String(node.props[property] ?? '');
    if (decoded !== raw) {
      if (
        ['Storyboard.TargetName', 'TargetName', 'SourceName', 'ElementName'].includes(property) &&
        primitiveLiteral(decoded)
      )
        this._encodedReferences.add('element:' + decoded);
      for (const match of decoded.matchAll(
        /(?:ElementName\s*=\s*['"]?|\{\w+:Reference\s+(?:Name\s*=\s*)?)([A-Za-z_][\w.-]*)/g,
      ))
        this._encodedReferences.add('element:' + match[1]);
      for (const match of decoded.matchAll(
        /\{(?:\w+:)?(?:StaticResource|DynamicResource|ThemeResource)\s+(?:ResourceKey\s*=\s*)?([A-Za-z_][\w.-]*)/g,
      ))
        this._encodedReferences.add('resource:' + match[1]);
      return;
    }
    if (
      this._native(node) &&
      ['Storyboard.TargetName', 'TargetName', 'SourceName', 'ElementName'].includes(property) &&
      primitiveLiteral(raw)
    )
      this._addReference(node, 'element', raw, absolute, absolute + raw.length);
    if (!raw.startsWith('{') || raw.startsWith('{}')) return;
    const quotedAt = (index) => {
      let quote = null;
      for (let i = 0; i < index; i++) {
        if (quote) {
          if (raw[i] === quote) quote = null;
        } else if (raw[i] === '"' || raw[i] === "'") quote = raw[i];
      }
      return !!quote;
    };
    for (const match of raw.matchAll(/\bElementName\s*=\s*(['"]?)([A-Za-z_][\w.-]*)\1/g)) {
      const binding = raw
        .slice(0, match.index)
        .match(/\{(?:(\w+):)?(?:Binding|MultiBinding)\b[^{}]*$/);
      if (
        !quotedAt(match.index) &&
        binding &&
        (!binding[1] || nativeNamespaces.has(this._namespace(node, binding[1])))
      ) {
        const start = absolute + match.index + match[0].lastIndexOf(match[2]);
        this._addReference(node, 'element', match[2], start, start + match[2].length);
      }
    }
    for (const match of raw.matchAll(
      /\{([\w]+):Reference\s+(?:Name\s*=\s*)?([A-Za-z_][\w.-]*)\s*\}/g,
    ))
      if (!quotedAt(match.index) && this._namespace(node, match[1]) === XAML) {
        const start =
          absolute + match.index + match[0].indexOf(match[2], match[0].indexOf('Reference') + 9);
        this._addReference(node, 'element', match[2], start, start + match[2].length);
      }
    for (const match of raw.matchAll(
      /\{(?:(\w+):)?(StaticResource|DynamicResource|ThemeResource)\s+(?:ResourceKey\s*=\s*)?([A-Za-z_][\w.-]*)\s*\}/g,
    ))
      if (
        !quotedAt(match.index) &&
        (!match[1] || nativeNamespaces.has(this._namespace(node, match[1])))
      ) {
        const start = absolute + match.index + match[0].lastIndexOf(match[3]);
        this._addReference(node, 'resource', match[3], start, start + match[3].length, {
          dynamic: match[2] !== 'StaticResource',
        });
      }
  }
  _htmlReferences(node, attr, raw) {
    const decoded = String(node.props[attr.name] ?? '');
    if (decoded !== raw) {
      if (idrefs.has(attr.name))
        for (const name of decoded.split(/\s+/)) this._encodedReferences.add('html-id:' + name);
      if (['href', 'xlink:href'].includes(attr.name) && decoded.startsWith('#'))
        this._encodedReferences.add('html-id:' + decoded.slice(1));
      if (attr.name === 'style')
        for (const match of decoded.matchAll(/url\(\s*['"]?#([\w-]+)/g))
          this._encodedReferences.add('html-id:' + match[1]);
      return;
    }
    if (idrefs.has(attr.name))
      for (const match of raw.matchAll(/\S+/g))
        this._addReference(
          node,
          'html-id',
          match[0],
          attr.valueStart + match.index,
          attr.valueStart + match.index + match[0].length,
        );
    else if (['href', 'xlink:href'].includes(attr.name) && /^#[A-Za-z_-][\w-]*$/.test(raw))
      this._addReference(node, 'html-id', raw.slice(1), attr.valueStart + 1, attr.valueEnd);
    if (
      attr.name === 'style' ||
      ['fill', 'stroke', 'filter', 'clip-path', 'mask'].includes(attr.name)
    )
      this._cssUrls(node, raw, attr.valueStart);
  }
  _cssUrls(node, css, start) {
    let quote = null;
    for (let i = 0; i < css.length; i++) {
      if (quote) {
        if (css[i] === '\\') i++;
        else if (css[i] === quote) quote = null;
        continue;
      }
      if (css.startsWith('/*', i)) {
        const end = css.indexOf('*/', i + 2);
        i = end < 0 ? css.length : end + 1;
        continue;
      }
      if (css[i] === '"' || css[i] === "'") {
        quote = css[i];
        continue;
      }
      if (css.slice(i, i + 4).toLowerCase() !== 'url(') continue;
      const match = css.slice(i).match(/^url\(\s*(['"]?)#([A-Za-z_-][\w-]*)\1\s*\)/i);
      if (match) {
        const at = start + i + match[0].indexOf('#') + 1;
        this._addReference(node, 'html-id', match[2], at, at + match[2].length);
        i += match[0].length - 1;
      }
    }
  }
  _cssReferences(node, css, start) {
    this._cssUrls(node, css, start);
    let segment = 0,
      quote = null,
      comment = false;
    const contexts = [];
    for (let i = 0; i < css.length; i++) {
      if (comment) {
        if (css.startsWith('*/', i)) {
          comment = false;
          i++;
        }
        continue;
      }
      if (!quote && css.startsWith('/*', i)) {
        comment = true;
        i++;
        continue;
      }
      if (quote) {
        if (css[i] === '\\') i++;
        else if (css[i] === quote) quote = null;
        continue;
      }
      if (css[i] === '"' || css[i] === "'") {
        quote = css[i];
        continue;
      }
      if (css[i] === '{') {
        const selector = css
          .slice(segment, i)
          .replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));
        const container =
          /^\s*@(media|supports|layer|container|scope|document|(?:-\w+-)?keyframes)\b/.test(
            selector,
          );
        const inDeclaration = contexts.at(-1) === 'declaration';
        if (inDeclaration) this._unsafeCss = true;
        if (!inDeclaration && !/^\s*@/.test(selector)) {
          if (selector.includes('\\')) this._unsafeCss = true;
          const unquoted = selector.replace(/(['"])(?:\\.|(?!\1)[\s\S])*?\1/g, (match) =>
            ' '.repeat(match.length),
          );
          for (const match of unquoted.matchAll(/#([A-Za-z_-][\w-]*)/g)) {
            if (
              unquoted[match.index - 1] === '\\' ||
              unquoted[match.index + match[0].length] === '\\'
            )
              continue;
            const at = start + segment + match.index + 1;
            this._addReference(node, 'html-id', match[1], at, at + match[1].length);
          }
          for (const match of selector.matchAll(
            /\[\s*(id|for|href)\s*=\s*(['"])(#?)([A-Za-z_-][\w-]*)\2\s*\]/g,
          )) {
            if (match[1] === 'href' && !match[3]) continue;
            const at = start + segment + match.index + match[0].lastIndexOf(match[4]);
            this._addReference(node, 'html-id', match[4], at, at + match[4].length);
          }
        }
        contexts.push(container ? 'container' : 'declaration');
        segment = i + 1;
      } else if (css[i] === '}') {
        contexts.pop();
        segment = i + 1;
      } else if (css[i] === ';' && contexts.at(-1) !== 'declaration') segment = i + 1;
    }
  }
  _lookup(kind, name, occurrence, declarations = this._declarations) {
    const matches = declarations.filter((item) => item.kind === kind && item.name === name);
    if (kind !== 'resource') return matches.filter((item) => item.scopeId === occurrence.scopeId);
    const node = this.nodes.get(occurrence.nodeId),
      chain = this._scopeChain(node);
    if (!chain.includes(occurrence.scopeId)) chain.unshift(occurrence.scopeId);
    for (const scope of chain) {
      const local = matches.filter((item) => item.scopeId === scope);
      if (local.length) return local;
    }
    return [];
  }
  _at(offset) {
    return [...this._declarations, ...this._references]
      .filter((item) => item.start <= offset && offset <= item.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  }
  symbols() {
    this._ensure();
    return this._outline.map((item) => ({ ...item }));
  }
  definitionAt(offset) {
    this._ensure();
    const item = this._at(offset);
    return item ? this._lookup(item.kind, item.name, item).map((item) => ({ ...item })) : [];
  }
  referencesAt(offset, { includeDeclaration = true } = {}) {
    this._ensure();
    const declaration = this.definitionAt(offset);
    if (declaration.length !== 1) return [];
    const target = declaration[0],
      result = this._references.filter((reference) => {
        const resolved = this._lookup(reference.kind, reference.name, reference);
        return resolved.length === 1 && resolved[0].id === target.id;
      });
    return [...(includeDeclaration ? [target] : []), ...result]
      .sort((a, b) => a.start - b.start)
      .map((item) => ({ ...item }));
  }
  rename(offset, newName, { expectedRevision = this.session.revision } = {}) {
    this._ensure();
    if (!this.session.isValid) throw Error('Fix source errors before renaming a symbol.');
    if (expectedRevision !== this.session.revision)
      throw Error('The document revision changed. Run Rename again.');
    const definitions = this.definitionAt(offset);
    if (definitions.length !== 1)
      throw Error(
        definitions.length
          ? 'The symbol is ambiguous in this scope.'
          : 'Place the caret on a named element, resource key, HTML id, or a supported reference.',
      );
    const target = definitions[0],
      pattern =
        target.kind === 'html-id'
          ? /^[A-Za-z_-][\w-]*$/
          : target.kind === 'resource'
            ? /^[A-Za-z_][\w.-]*$/
            : /^[A-Za-z_][\w]*$/;
    if (target.unsupported) throw Error(target.unsupported);
    if (!pattern.test(newName) || !pattern.test(target.name) || !target.renamable)
      throw Error(
        'Rename requires an unescaped literal identifier supported by this markup language.',
      );
    if (this._encodedReferences.has(target.kind + ':' + target.name))
      throw Error('Encoded literal references require manual review before renaming this symbol.');
    if (target.kind === 'html-id' && this._unsafeCss)
      throw Error(
        'Escaped or nested CSS selectors require manual review before renaming HTML ids.',
      );
    if (newName === target.name)
      return { count: 0, revision: this.session.revision, declaration: target };
    const next = this._declarations.map((item) =>
        item.id === target.id ? { ...item, name: newName } : item,
      ),
      occurrences = this.referencesAt(offset);
    for (const item of occurrences) {
      const resolved = this._lookup(item.kind, newName, item, next);
      if (resolved.length !== 1 || resolved[0].id !== target.id)
        throw Error('The new name collides with another declaration or changes reference scope.');
    }
    for (const reference of this._references) {
      if (reference.name !== newName) continue;
      const before = this._lookup(reference.kind, reference.name, reference)
          .map((item) => item.id)
          .sort()
          .join('|'),
        after = this._lookup(reference.kind, reference.name, reference, next)
          .map((item) => item.id)
          .sort()
          .join('|');
      if (before !== after)
        throw Error('The new name would capture an existing reference. Choose another name.');
    }
    const edits = [
      ...new Map(
        occurrences.map((item) => [
          item.start + ':' + item.end,
          { start: item.start, end: item.end, text: newName },
        ]),
      ).values(),
    ];
    let result;
    if (this.session.applySourceEdits)
      result = this.session.applySourceEdits(edits, {
        origin: 'semantic-rename',
        expectedRevision,
      });
    else {
      let text = this._source;
      for (const edit of [...edits].sort((a, b) => b.start - a.start))
        text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
      result = this.session.updateSource(text, { origin: 'semantic-rename', expectedRevision });
    }
    if (!result.accepted || !result.valid)
      throw Error(result.diagnostics?.[0]?.message || 'Rename could not be applied.');
    this._ensure();
    return {
      count: edits.length,
      revision: this.session.revision,
      declaration: this._declarations.find(
        (item) =>
          item.nodeId === target.nodeId && item.kind === target.kind && item.name === newName,
      ),
    };
  }
  diagnostics() {
    this._ensure();
    if (!this.session.isValid) return [];
    const output = [],
      seen = new Set();
    for (const declaration of this._declarations) {
      const matches = this._lookup(declaration.kind, declaration.name, declaration);
      if (matches.length > 1) {
        const key = declaration.kind + ':' + declaration.scopeId + ':' + declaration.name;
        if (!seen.has(key)) {
          seen.add(key);
          output.push({
            ...declaration,
            severity: 'warning',
            code: 'ambiguous-declaration',
            message: `Duplicate ${declaration.kind === 'resource' ? 'resource key' : 'name'} “${declaration.name}” in the same scope.`,
          });
        }
      }
    }
    for (const reference of this._references) {
      if (
        reference.kind === 'resource' ||
        (reference.kind === 'html-id' && reference.scopeId !== this.document.root.id)
      )
        continue;
      const matches = this._lookup(reference.kind, reference.name, reference);
      if (!matches.length)
        output.push({
          ...reference,
          severity: 'warning',
          code: 'unresolved-local-reference',
          message: `No local ${reference.kind === 'html-id' ? 'HTML id' : 'named element'} “${reference.name}” is declared in this scope.`,
        });
    }
    return output;
  }
  /** Read only committed concrete ranges; invalid drafts never navigate the old tree. */
  _structureReady(start, end = start) {
    return (
      this.session.isValid &&
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start >= 0 &&
      end >= start &&
      end <= this.session.validSource.length
    );
  }
  _range(start, end, kind, nodeId) {
    return { start, end, kind, ...(nodeId ? { nodeId } : {}), ...this._position(start) };
  }
  /** Innermost authored element at the caret; synthetic HTML wrappers are not source elements. */
  elementAt(offset) {
    if (!this._structureReady(offset)) return null;
    this._ensure();
    const span = (this.session.index?.spans || [])
      .filter((s) => s.kind === 'element' && !s.synthetic && s.start <= offset && offset < s.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    return span ? this._range(span.start, span.end, 'element', span.nodeId) : null;
  }
  /** The opposite tag name, only when the caret is in an actual paired opening/closing tag. */
  matchingTagAt(offset) {
    if (!this._structureReady(offset)) return null;
    this._ensure();
    const span = this.elementAt(offset);
    if (!span) return null;
    const source = this.session.sourceAtNode(span.nodeId);
    if (!Number.isInteger(source.closeNameStart)) return null;
    if (offset >= source.start && offset < source.openEnd)
      return this._range(source.closeNameStart, source.closeNameEnd, 'closing-tag', span.nodeId);
    if (offset >= source.closeStart && offset < source.end)
      return this._range(source.nameStart, source.nameEnd, 'opening-tag', span.nodeId);
    return null;
  }
  /** Strictly increasing, nested UTF-16 selection ranges from a token to the document. */
  selectionRanges(start, end = start) {
    if (!this._structureReady(start, end)) return [];
    this._ensure();
    const candidates = [];
    const add = (a, b, kind, id) => {
      if (
        Number.isInteger(a) &&
        Number.isInteger(b) &&
        a >= 0 &&
        b <= this._source.length &&
        b > a &&
        a <= start &&
        b >= end &&
        (start !== end || start < b)
      )
        candidates.push(this._range(a, b, kind, id));
    };
    for (const span of this.session.index?.spans || []) {
      if (span.synthetic || span.start > start || span.end < end) continue;
      if (span.kind === 'element') {
        add(span.nameStart, span.nameEnd, 'tag-name', span.nodeId);
        add(span.closeNameStart, span.closeNameEnd, 'tag-name', span.nodeId);
        for (const attr of span.attrs || []) {
          add(
            attr.nameStart ?? attr.start,
            (attr.nameStart ?? attr.start) + attr.name.length,
            'attribute-name',
            span.nodeId,
          );
          add(attr.valueStart, attr.valueEnd, 'attribute-value', span.nodeId);
          add(attr.start, attr.end, 'attribute', span.nodeId);
        }
        add(span.start, span.openEnd, 'opening-tag', span.nodeId);
        add(span.closeStart, span.end, 'closing-tag', span.nodeId);
        add(span.openEnd, span.closeStart, 'content', span.nodeId);
        add(span.start, span.end, 'element', span.nodeId);
      } else {
        const delimiter = span.kind === 'comment' ? [4, 3] : span.kind === 'cdata' ? [9, 3] : null;
        if (delimiter) add(span.start + delimiter[0], span.end - delimiter[1], 'text', span.nodeId);
        add(span.start, span.end, span.kind, span.nodeId);
      }
    }
    add(0, this._source.length, 'document');
    // Malformed/recovered HTML may yield crossing lexical spans. Never return crossing selections.
    const result = [];
    let current = { start, end };
    for (const range of candidates.sort((a, b) => a.end - a.start - (b.end - b.start))) {
      if (
        range.start <= current.start &&
        range.end >= current.end &&
        (range.start !== current.start || range.end !== current.end)
      ) {
        result.push(range);
        current = range;
      }
    }
    return result;
  }
  completions(source, offset, context = {}) {
    this._ensure();
    const before = source.slice(0, offset),
      token = before.match(/[\w.-]*$/)?.[0] || '',
      start = offset - token.length;
    const make = (values, detail, at = start, transform = (value) => value) =>
      [...new Set(values)]
        .filter((value) => lower(value).startsWith(lower(source.slice(at, offset))))
        .map((value) => ({
          label: value,
          detail,
          start: at,
          end: offset,
          insertText: transform(value),
        }));
    let node =
      this.session.nodeAtOffset(Math.min(offset, Math.max(0, this._source.length - 1))) ||
      this.document.root;
    if (node.kind === 'comment') return [];
    while (node && node.kind !== 'element') node = this.parents.get(node.id);
    node ??= this.document.root;
    const occurrence = { nodeId: node.id, scopeId: this._nameScope(node) },
      names = (kind) => [
        ...new Set(
          this._declarations
            .filter(
              (item) =>
                item.kind === kind &&
                this._lookup(kind, item.name, {
                  ...occurrence,
                  scopeId: kind === 'html-id' ? this._htmlScope(node) : occurrence.scopeId,
                }).length === 1,
            )
            .map((item) => item.name),
        ),
      ];
    if (this.document.framework === 'HTML') {
      if (node.type === 'script') return [];
      if (
        /(?:for|list|form|headers|aria-(?:labelledby|describedby|controls|owns|activedescendant|details|errormessage))\s*=\s*["'][^"']*$/i.test(
          before,
        ) ||
        /(?:href|xlink:href)\s*=\s*["']#[^"']*$/i.test(before) ||
        /url\(\s*["']?#[\w-]*$/.test(before)
      )
        return make(names('html-id'), 'Local HTML id');
      const style =
        before.lastIndexOf('<style') > before.lastIndexOf('</style') ||
        /style\s*=\s*["'][^"']*$/i.test(before);
      if (style) {
        if (before.lastIndexOf('/*') > before.lastIndexOf('*/')) return [];
        const value = before.match(/([a-z-]+)\s*:\s*([^;{}]*)$/i);
        if (value) {
          const at = offset - value[2].length;
          let values =
            cssValues[value[1]] ||
            (['background', 'background-color', 'fill', 'stroke'].includes(value[1])
              ? cssValues.color
              : []);
          if (value[1] === 'animation-name')
            values = [...this._source.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);
          return make(values, 'CSS ' + value[1] + ' value', at);
        }
        if (/#[\w-]*$/.test(before)) return make(names('html-id'), 'Local CSS id');
        return make(cssProperties, 'CSS property', start, (value) => value + ': ');
      }
      const scan = completionContext(before);
      if (scan.blocked) return [];
      const tail = scan.start < 0 ? '' : before.slice(scan.start),
        attribute = tail.match(/([\w:-]+)\s*=\s*(["'])([^"']*)$/);
      if (attribute) {
        const key = attribute[1],
          value = attribute[3],
          values =
            key === 'role'
              ? [
                  'button',
                  'checkbox',
                  'dialog',
                  'grid',
                  'heading',
                  'link',
                  'list',
                  'listbox',
                  'menu',
                  'menuitem',
                  'navigation',
                  'option',
                  'progressbar',
                  'radio',
                  'region',
                  'slider',
                  'status',
                  'switch',
                  'tab',
                  'tabpanel',
                  'textbox',
                  'tree',
                ]
              : key === 'type'
                ? node.type === 'button'
                  ? ['button', 'submit', 'reset']
                  : [
                      'text',
                      'password',
                      'email',
                      'number',
                      'checkbox',
                      'radio',
                      'range',
                      'date',
                      'time',
                      'search',
                      'tel',
                      'url',
                      'file',
                      'hidden',
                      'submit',
                      'button',
                      'reset',
                      'color',
                    ]
                : key === 'target'
                  ? ['_self', '_blank', '_parent', '_top']
                  : key === 'loading'
                    ? ['lazy', 'eager']
                    : key === 'dir'
                      ? ['ltr', 'rtl', 'auto']
                      : [
                            'aria-hidden',
                            'aria-expanded',
                            'aria-selected',
                            'aria-checked',
                            'contenteditable',
                            'draggable',
                            'spellcheck',
                          ].includes(key)
                        ? ['true', 'false']
                        : [];
        return make(values, 'HTML ' + key + ' value', offset - value.length);
      }
      const existing = new Set([...tail.matchAll(/([\w:-]+)\s*=/g)].map((match) => match[1]));
      return completeHtml(source, offset).filter(
        (item) => item.detail !== 'HTML attribute' || !existing.has(item.label),
      );
    }
    const scan = completionContext(before);
    if (scan.blocked) return [];
    if (
      /(?:ElementName\s*=|(?:Storyboard\.TargetName|TargetName|SourceName)\s*=\s*["']|\{\w+:Reference\s+(?:Name\s*=\s*)?)[\w.-]*$/.test(
        before,
      )
    )
      return make(names('element'), 'Named element in this namescope');
    if (
      /\{(?:\w+:)?(?:StaticResource|DynamicResource|ThemeResource)\s+(?:ResourceKey\s*=\s*)?[\w.-]*$/.test(
        before,
      )
    )
      return make(names('resource'), 'Visible local resource');
    const framework = this.document.framework,
      registry = {
        get: (type) => this.registry.get(type),
        list: () =>
          this.registry
            .list()
            .filter((item) => !item.frameworks || item.frameworks.includes(framework)),
      };
    let entries = completeXaml(source, offset, {
      registry,
      document: this.document,
      context: { ...this.context, ...context },
    });
    const excluded =
      framework === 'WPF'
        ? new Set(['IsVisible', 'Watermark', 'Classes', 'PointerPressed', 'PlaceholderText'])
        : framework === 'Avalonia'
          ? new Set(['Visibility', 'PlaceholderText'])
          : new Set();
    return entries.filter((item) => !excluded.has(item.label));
  }
}
