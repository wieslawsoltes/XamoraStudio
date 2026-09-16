import { element, find, walk, localName, parentOf, clone } from '../core/model.js';
import { resourcesFor } from '../core/animation.js';
import { filePath, relativePath } from '../core/solution.js';
import { findResource } from '../core/styling.js';
import { propertyObject, colorParts, argb, setLiteral } from '../core/authoring.js';
import { brushCSS } from '../core/appearance.js';
import { WorkspaceComponent, esc } from './workspace-context.js';
export class ResourceWorkspace extends WorkspaceComponent {
  /** @param {import('./workspace-context.js').ResourceWorkspaceHost} s
   * @param {import('./workspace-context.js').WorkspaceOptions} [workspaceOptions] */
  constructor(s, workspaceOptions = s.workspaceOptions) {
    super(workspaceOptions);
    try {
      this.s = s;
      this.query = '';
      this.scope = 'solution';
      this.environment.override(s, 'renderAssets', () => this.render());
      const command = s.command.bind(s);
      this.environment.override(s, 'command', (action, e) => {
        if (action === 'edit-resources' || action === 'add-resource') {
          s.docking.control.show('assets');
          if (action === 'add-resource') this.create('SolidColorBrush');
          return;
        }
        if (action === 'edit-brush' || action === 'edit-transforms' || action === 'edit-effects') {
          s.docking.control.show('properties');
          s.rich.expanded.add(
            action === 'edit-brush'
              ? 'brush'
              : action === 'edit-transforms'
                ? 'transforms'
                : 'effects',
          );
          s.renderInspector();
          s.inspectorHost('design')
            .querySelector(
              `[data-rich-section="${action === 'edit-brush' ? 'brush' : action === 'edit-transforms' ? 'transforms' : 'effects'}"]`,
            )
            ?.scrollIntoView({ block: 'nearest' });
          return;
        }
        return command(action, e);
      });
    } catch (error) {
      try {
        this.environment.dispose();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'ResourceWorkspace initialization failed.');
      }
      throw error;
    }
  }
  entries() {
    const list = [];
    for (const store of this.s.stores) {
      const doc = store.document;
      if (this.scope === 'document' && doc.id !== this.s.doc.id) continue;
      walk(doc.root, (node) => {
        if (node.props?.['x:Key']) list.push({ doc, node });
      });
    }
    return list;
  }
  create(type) {
    const s = this.s;
    if (!s.prepareEdit()) return;
    let id;
    s.store.transaction('Create ' + type, (doc) => {
      const holder = resourcesFor(doc),
        stem =
          {
            SolidColorBrush: 'Brush',
            LinearGradientBrush: 'Gradient',
            Style: 'Style',
            ControlTemplate: 'Template',
          }[type] || 'Resource',
        used = new Set(holder.children.map((n) => n.props?.['x:Key']));
      let key = stem,
        i = 2;
      while (used.has(key)) key = stem + i++;
      const resource =
        type === 'SolidColorBrush'
          ? element(type, { 'x:Key': key, Color: '#2563EB' })
          : type === 'LinearGradientBrush'
            ? element(type, { 'x:Key': key, StartPoint: '0,0', EndPoint: '1,1' }, [
                element('GradientStop', { Color: '#2563EB', Offset: '0' }),
                element('GradientStop', { Color: '#7C3AED', Offset: '1' }),
              ])
            : type === 'Style'
              ? element(type, { 'x:Key': key, TargetType: s.selected[0]?.type || 'Button' }, [
                  element('Setter', { Property: 'Background', Value: '#2563EB' }),
                ])
              : element('ControlTemplate', { 'x:Key': key, TargetType: 'Button' }, [
                  element('Border', { Background: '#2563EB', CornerRadius: '6' }, [
                    element('ContentPresenter'),
                  ]),
                ]);
      holder.children.push(resource);
      doc.root.props['xmlns:x'] ??= 'http://schemas.microsoft.com/winfx/2006/xaml';
      id = resource.id;
    });
    this.selected = id;
    this.render();
  }
  merge(doc, targetDoc) {
    if (doc.id === targetDoc.id) throw Error('A dictionary cannot merge itself.');
    const path = relativePath(filePath(targetDoc), filePath(doc));
    let holder = resourcesFor(doc);
    if (localName(holder.type) !== 'ResourceDictionary') {
      const dictionary = element('ResourceDictionary', {}, holder.children);
      holder.children = [dictionary];
      holder = dictionary;
    }
    let merged = holder.children.find((n) => n.type?.endsWith('.MergedDictionaries'));
    if (!merged) {
      merged = element('ResourceDictionary.MergedDictionaries');
      holder.children.unshift(merged);
    }
    if (!merged.children.some((n) => n.props.Source === path))
      merged.children.push(element('ResourceDictionary', { Source: path }));
  }
  apply(entry, property) {
    const s = this.s,
      ids = [...s.store.selection];
    if (!ids.length) {
      this.environment.notify('Select a control on the canvas.');
      return;
    }
    if (!s.prepareEdit()) return;
    try {
      s.store.transaction('Apply resource', (doc) => {
        if (entry.doc.id !== doc.id) {
          if (localName(entry.doc.root.type) !== 'ResourceDictionary')
            throw Error(
              'Move this resource into a shared ResourceDictionary to use it in another file.',
            );
          this.merge(doc, entry.doc);
        }
        for (const id of ids) {
          const node = find(doc.root, id);
          if (
            findResource(doc, node, entry.node.props['x:Key'], s.solution.resolve)?.id !==
            entry.node.id
          )
            throw Error(
              'A closer resource shadows this key. Rename or select an accessible resource.',
            );
          setLiteral(node, property, `{StaticResource ${entry.node.props['x:Key']}}`);
        }
      });
    } catch (e) {
      this.environment.notify(e.message);
    }
  }
  render() {
    const s = this.s,
      host = s.leftHost('assets');
    if (!host) return;
    const active = this.environment.document.activeElement,
      wasSearch = active?.id === 'resource-search',
      caret = active?.selectionStart,
      scroll = host.scrollTop,
      all = this.entries(),
      entries = all.filter((e) =>
        (e.node.props['x:Key'] + ' ' + e.node.type + ' ' + filePath(e.doc))
          .toLowerCase()
          .includes(this.query.toLowerCase()),
      ),
      entry = all.find((e) => e.node.id === this.selected),
      dicts = s.stores
        .map((st) => st.document)
        .filter((d) => localName(d.root.type) === 'ResourceDictionary' && d.id !== s.doc.id);
    host.innerHTML = `<section class="resource-workbench-tools"><div class="rich-row"><input id="resource-search" placeholder="Find a resource…" value="${esc(this.query)}"><select id="resource-scope"><option value="solution">Solution</option><option value="document">Current file</option></select></div><div class="rich-row"><button data-new-resource="SolidColorBrush">+ Brush</button><button data-new-resource="LinearGradientBrush">+ Gradient</button><button data-new-resource="Style">+ Style</button><button data-new-resource="ControlTemplate">+ Template</button></div></section><div class="resource-browser">${entries.map((e) => `<button data-resource="${e.node.id}" class="resource-row ${e.node.id === this.selected ? 'active' : ''}"><span class="swatch" data-swatch="${e.node.id}"></span><span><strong>${esc(e.node.props['x:Key'])}</strong><small>${esc(localName(e.node.type))} · ${esc(filePath(e.doc))}</small></span></button>`).join('') || '<p class="feature-help">No matching resources.</p>'}</div><section class="resource-detail" id="resource-detail"></section><section class="panel-section"><h4>Merged dictionaries</h4><div class="rich-row"><select id="merge-dictionary" aria-label="Resource dictionary">${dicts.map((d) => `<option value="${d.id}">${esc(filePath(d))}</option>`).join('')}</select><button id="merge-add" ${dicts.length ? '' : 'disabled'}>Merge</button></div><div id="merged-list"></div></section>`;
    this.environment.query('#resource-scope').value = this.scope;
    this.environment.handler(this.environment.query('#resource-scope'), 'onchange', (e) => {
      this.scope = e.target.value;
      this.render();
    });
    this.environment.handler(this.environment.query('#resource-search'), 'oninput', (e) => {
      this.query = e.target.value;
      this.render();
    });
    this.environment
      .all('[data-new-resource]', host)
      .forEach((b) =>
        this.environment.handler(b, 'onclick', () => this.create(b.dataset.newResource)),
      );
    this.environment.all('[data-resource]', host).forEach((b) =>
      this.environment.handler(b, 'onclick', () => {
        this.selected = b.dataset.resource;
        this.render();
      }),
    );
    for (const e of entries) {
      const swatch = host.querySelector(`[data-swatch="${e.node.id}"]`);
      swatch.style.background = brushCSS(e.node) || 'var(--accent-soft)';
    }
    this.environment.handler(this.environment.query('#merge-add'), 'onclick', () => {
      if (!s.prepareEdit()) return;
      try {
        s.store.transaction('Merge dictionary', (doc) =>
          this.merge(
            doc,
            dicts.find((d) => d.id === this.environment.query('#merge-dictionary').value),
          ),
        );
      } catch (e) {
        this.environment.notify(e.message);
      }
    });
    const merged = [];
    walk(s.doc.root, (n) => {
      if (localName(n.type || '') === 'ResourceDictionary' && n.props.Source) merged.push(n);
    });
    this.environment.query('#merged-list').innerHTML = merged
      .map(
        (n) =>
          `<div class="rich-row"><span title="${esc(n.props.Source)}">${esc(n.props.Source)}</span><button data-merge-up="${n.id}" title="Move earlier">↑</button><button data-merge-remove="${n.id}" title="Remove merge">×</button></div>`,
      )
      .join('');
    this.environment.all('[data-merge-remove],[data-merge-up]', host).forEach((b) =>
      this.environment.handler(b, 'onclick', () => {
        if (!s.prepareEdit()) return;
        s.store.transaction('Edit merged dictionaries', (doc) => {
          const id = b.dataset.mergeRemove || b.dataset.mergeUp,
            p = parentOf(doc.root, id),
            index = p.children.findIndex((n) => n.id === id);
          if (b.dataset.mergeRemove) p.children.splice(index, 1);
          else if (index > 0)
            [p.children[index], p.children[index - 1]] = [p.children[index - 1], p.children[index]];
        });
      }),
    );
    if (entry) this.details(this.environment.query('#resource-detail'), entry);
    host.scrollTop = scroll;
    if (wasSearch) {
      this.environment.query('#resource-search').focus();
      if (Number.isInteger(caret))
        this.environment.query('#resource-search').setSelectionRange(caret, caret);
    }
  }
  details(host, entry) {
    const s = this.s,
      { doc, node } = entry,
      refs = s.solution.references(doc.id, node.id);
    host.innerHTML = `<h4>${esc(localName(node.type))}</h4><label>Resource key<input id="resource-key" value="${esc(node.props['x:Key'])}"></label>${node.props.Color !== undefined ? `<div class="rich-row"><input id="resource-color" type="color" value="${colorParts(node.props.Color)?.rgb || '#2563eb'}"><input id="resource-value" value="${esc(node.props.Color)}"></div>` : ''}<div class="rich-row"><button id="resource-edit">Edit visually</button><button id="resource-copy">Duplicate</button><button id="resource-delete" ${refs.length ? 'disabled' : ''} title="${refs.length ? 'Remove references before deleting' : 'Delete resource'}">Delete</button></div><div class="rich-row"><select id="resource-apply-property">${(localName(node.type) === 'Style' ? ['Style'] : localName(node.type) === 'ControlTemplate' ? ['Template'] : ['Background', 'Foreground', 'Fill', 'Stroke', 'BorderBrush']).map((key) => `<option>${key}</option>`).join('')}</select><button id="resource-apply">Apply to selection</button></div><details><summary>${refs.length} references</summary>${refs.map((ref, i) => `<button data-resource-reference="${i}">${esc(filePath(s.stores.find((st) => st.document.id === ref.documentId).document))} · ${esc(ref.property)}</button>`).join('')}</details>`;
    this.environment.handler(this.environment.query('#resource-key'), 'onchange', (e) =>
      s.solution.renameKey(doc.id, node.id, e.target.value),
    );
    for (const key of ['resource-color', 'resource-value'])
      this.environment.listen(this.environment.query('#' + key), 'change', (e) => {
        if (!s.prepareEdit()) return;
        s.stores
          .find((st) => st.document.id === doc.id)
          .setProperty(
            [node.id],
            'Color',
            key === 'resource-color'
              ? argb(e.target.value, colorParts(node.props.Color)?.alpha ?? 1)
              : e.target.value,
          );
        s.renderCanvas();
        this.render();
      });
    this.environment.handler(this.environment.query('#resource-apply'), 'onclick', () =>
      this.apply(entry, this.environment.query('#resource-apply-property').value),
    );
    this.environment.handler(this.environment.query('#resource-edit'), 'onclick', () => {
      s.solution.open(doc.id, 'design');
      if (s.doc.id !== doc.id) return;
      s.store.select([node.id]);
      s.docking.control.show('properties');
      if (localName(node.type) === 'ControlTemplate') {
        s.scopeId = node.id;
        s.render();
        s.fit();
      }
    });
    this.environment.handler(this.environment.query('#resource-delete'), 'onclick', () => {
      if (!s.prepareEdit()) return;
      s.stores.find((st) => st.document.id === doc.id).remove([node.id]);
      this.selected = null;
      this.render();
    });
    this.environment.handler(this.environment.query('#resource-copy'), 'onclick', () => {
      if (!s.prepareEdit()) return;
      const store = s.stores.find((st) => st.document.id === doc.id),
        copy = s.uniqueClone(node),
        parent = parentOf(doc.root, node.id),
        keys = new Set(parent.children.map((n) => n.props?.['x:Key']));
      let key = node.props['x:Key'] + 'Copy',
        i = 2;
      while (keys.has(key)) key = node.props['x:Key'] + 'Copy' + i++;
      copy.props['x:Key'] = key;
      store.transaction('Duplicate resource', () => parent.children.push(copy));
      this.selected = copy.id;
      this.render();
    });
    this.environment.all('[data-resource-reference]', host).forEach((b) =>
      this.environment.handler(b, 'onclick', () => {
        const ref = refs[Number(b.dataset.resourceReference)];
        s.solution.open(ref.documentId, 'split');
        if (s.doc.id === ref.documentId) s.store.select([ref.nodeId]);
      }),
    );
  }
  dispose() {
    if (this.disposed) return;
    super.dispose();
  }
}
