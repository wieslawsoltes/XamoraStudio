import { clone, uid } from '../core/model.js';
import {
  DesignDatabase,
  createDatabase,
  validateDatabase,
  tableBy,
  DATA_TYPES,
  validName,
  parseValue,
  queryRows,
  databaseContext,
  bindingPaths,
  readPath,
  writePath,
  parseCSV,
  toCSV,
} from '../core/design-data.js';
import { esc, $, $$, notify, field, select, saveFile } from './ui.js';

export class DataEditor {
  constructor(studio) {
    this.s = studio;
    this.tableId = null;
    this.filter = '';
    this.mode = 'records';
    this.sort = { column: '', direction: 'asc' };
  }
  get owner() {
    return this.s.stores.find((s) => s.document.metadata?.dataModel) || this.s.stores[0];
  }
  get db() {
    return this.owner.document.metadata?.dataModel || createDatabase();
  }
  context() {
    return databaseContext(this.db);
  }
  mutate(label, action) {
    const store = this.owner,
      database = new DesignDatabase(this.db);
    action(database);
    validateDatabase(database.data);
    store.transaction(label, (doc) => {
      doc.metadata ??= {};
      doc.metadata.dataModel = database.data;
    });
    this.s.save();
    this.s.features?.refreshData();
  }
  sidebar() {
    const db = this.db;
    this.s.leftHost('data').innerHTML =
      `<div class="panel-section"><div class="section-heading">Design database<span class="spacer"></span><button class="icon-button" data-action="data-table-new" title="New table">+</button></div><p class="feature-help">Typed records, object data, and queries connected to your previews.</p><button class="button" data-action="database" style="width:100%">Open data editor</button><button class="button quiet" data-action="interactive-demo" style="width:100%;margin-top:6px">Open connected example</button></div><div class="data-sidebar-group"><h4>TABLES</h4>${db.tables.map((t) => `<button class="page-row" data-open-table="${t.id}"><span>▤</span>${esc(t.name)}<span class="spacer"></span><span class="badge">${t.rows.length}</span></button>`).join('') || '<p class="feature-help">No tables yet.</p>'}<h4>QUERIES</h4>${db.queries.map((q) => `<button class="page-row" data-open-query="${q.id}">⌕ ${esc(q.name)}</button>`).join('') || '<p class="feature-help">Create reusable filtered views.</p>'}<h4>BINDING SOURCES</h4>${['App', 'Tables', 'Queries', 'Selection'].map((p) => `<button class="page-row" data-binding-source="${p}">◇ ${p}</button>`).join('')}</div>`;
    $$('[data-open-table]').forEach(
      (b) =>
        (b.onclick = () => {
          this.tableId = b.dataset.openTable;
          this.open();
        }),
    );
    $$('[data-open-query]').forEach(
      (b) => (b.onclick = () => this.queryDialog(b.dataset.openQuery)),
    );
    $$('[data-binding-source]').forEach(
      (b) => (b.onclick = () => this.bindingDialog(b.dataset.bindingSource)),
    );
  }
  open() {
    const db = this.db;
    if (!tableBy(db, this.tableId)) this.tableId = db.tables[0]?.id || null;
    const table = tableBy(db, this.tableId);
    this.s.modal(
      'Design data',
      `<div class="database-toolbar"><div class="feature-tabs"><button data-data-mode="records" class="${this.mode === 'records' ? 'active' : ''}">Records</button><button data-data-mode="schema" class="${this.mode === 'schema' ? 'active' : ''}">Schema</button><button data-data-mode="relations" class="${this.mode === 'relations' ? 'active' : ''}">Relationships</button><button data-data-mode="queries" class="${this.mode === 'queries' ? 'active' : ''}">Queries</button><button data-data-mode="objects" class="${this.mode === 'objects' ? 'active' : ''}">Objects</button></div><span class="spacer"></span><button class="button" id="database-undo" title="Undo an edit on the database owner page">Undo</button><button class="button" id="database-redo" title="Redo an edit on the database owner page">Redo</button><button class="button" id="database-import">Import</button><button class="button" id="database-export">Export</button></div><div class="database-layout"><aside class="database-nav"><div class="section-heading">Tables<button class="icon-button" id="new-data-table">+</button></div>${db.tables.map((t) => `<button class="page-row ${t.id === this.tableId ? 'active' : ''}" data-table="${t.id}">${esc(t.name)}<span class="spacer"></span>${t.rows.length}</button>`).join('')}<div class="feature-help">Changes are saved in your design project. Preview sessions use an isolated copy.</div></aside><section class="database-main" id="database-main"></section></div>`,
      [],
      true,
    );
    $('.modal').classList.add('database-modal');
    this.renderMain(table);
    $$('[data-data-mode]').forEach(
      (b) =>
        (b.onclick = () => {
          this.mode = b.dataset.dataMode;
          this.open();
        }),
    );
    $$('[data-table]').forEach(
      (b) =>
        (b.onclick = () => {
          this.tableId = b.dataset.table;
          this.open();
        }),
    );
    $('#database-undo').disabled = !this.owner.history.length;
    $('#database-redo').disabled = !this.owner.future.length;
    $('#database-undo').onclick = () => {
      this.owner.undo();
      this.s.save();
      this.s.features.refreshData();
      this.open();
    };
    $('#database-redo').onclick = () => {
      this.owner.redo();
      this.s.save();
      this.s.features.refreshData();
      this.open();
    };
    $('#new-data-table').onclick = () => this.tableDialog();
    $('#database-export').onclick = () => this.exportDialog();
    $('#database-import').onclick = () => this.importDialog();
  }
  renderMain(table) {
    const host = $('#database-main');
    if (this.mode === 'objects') {
      this.renderObjects(host);
      return;
    }
    if (this.mode === 'relations') {
      this.renderRelations(host);
      return;
    }
    if (this.mode === 'queries') {
      this.renderQueries(host);
      return;
    }
    if (!table) {
      host.innerHTML =
        '<div class="data-empty"><h3>Design with real data</h3><p>Create your first table, or load a sample database with projects and people.</p><button class="button primary" id="database-sample">Load sample data</button><button class="button" id="database-first-table">Create table</button></div>';
      $('#database-sample').onclick = () => this.loadSample();
      $('#database-first-table').onclick = () => this.tableDialog();
      return;
    }
    if (this.mode === 'schema') {
      host.innerHTML = `<div class="data-heading"><h3>${esc(table.name)} schema</h3><span class="spacer"></span><button class="button" id="rename-table">Rename table</button><button class="button" id="delete-table">Delete table</button><button class="button primary" id="new-column">+ Column</button></div><table class="data-table"><thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Unique</th><th>Default</th><th></th></tr></thead><tbody><tr><td>_id</td><td>string</td><td>Yes</td><td>Primary key</td><td>Generated</td><td></td></tr>${table.columns.map((c) => `<tr><td>${esc(c.name)}</td><td><span class="badge">${esc(c.type)}</span></td><td>${c.required ? 'Yes' : 'No'}</td><td>${c.unique ? 'Yes' : 'No'}</td><td>${esc(c.default == null ? 'null' : typeof c.default === 'object' ? JSON.stringify(c.default) : c.default)}</td><td><button class="button" data-edit-column="${esc(c.name)}">Edit</button></td></tr>`).join('')}</tbody></table>`;
      $('#new-column').onclick = () => this.columnDialog();
      $('#rename-table').onclick = () => this.tableDialog(table.id);
      $('#delete-table').onclick = () => this.deleteTable(table);
      $$('[data-edit-column]').forEach(
        (b) => (b.onclick = () => this.columnDialog(b.dataset.editColumn)),
      );
      return;
    }
    let rows = table.rows.filter((r) =>
      JSON.stringify(r).toLowerCase().includes(this.filter.toLowerCase()),
    );
    if (this.sort.column && !table.columns.some((c) => c.name === this.sort.column))
      this.sort = { column: '', direction: 'asc' };
    if (this.sort.column)
      rows = queryRows(
        { ...this.db, tables: this.db.tables.map((t) => (t.id === table.id ? { ...t, rows } : t)) },
        { tableId: table.id, sort: this.sort },
      );
    host.innerHTML = `<div class="data-heading"><div><h3>${esc(table.name)}</h3><span class="feature-help">${rows.length} records · ${table.columns.length} columns</span></div><span class="spacer"></span><input id="records-filter" class="compact-input" placeholder="Filter records…" value="${esc(this.filter)}"><button class="button" id="bind-table">Bind to selection</button><button class="button primary" id="new-record">+ Record</button></div><div class="data-scroll"><table class="data-table editable"><thead><tr><th class="row-number">#</th>${table.columns.map((c) => `<th><button data-sort-column="${esc(c.name)}">${esc(c.name)} <small>${c.type}</small>${this.sort.column === c.name ? (this.sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}<th></th></tr></thead><tbody>${rows
      .slice(0, 500)
      .map(
        (r, i) =>
          `<tr data-record="${r._id}"><td class="row-number" title="${r._id}">${i + 1}</td>${table.columns.map((c) => `<td>${this.cellEditor(table, r, c)}</td>`).join('')}<td><button class="icon-button" data-delete-record="${r._id}" title="Delete record">×</button></td></tr>`,
      )
      .join(
        '',
      )}</tbody></table>${!rows.length ? '<div class="data-empty">No matching records.</div>' : ''}${rows.length > 500 ? '<p class="feature-help">Showing the first 500 matches. Filter to narrow the table.</p>' : ''}</div>`;
    $('#records-filter').oninput = (e) => {
      const caret = e.target.selectionStart;
      this.filter = e.target.value;
      this.renderMain(tableBy(this.db, this.tableId));
      $('#records-filter').focus();
      $('#records-filter').setSelectionRange(caret, caret);
    };
    $('#new-record').onclick = () => this.recordDialog();
    $('#bind-table').onclick = () => this.bindingDialog('Tables.' + table.name);
    $$('[data-sort-column]').forEach(
      (b) =>
        (b.onclick = () => {
          this.sort = {
            column: b.dataset.sortColumn,
            direction:
              this.sort.column === b.dataset.sortColumn && this.sort.direction === 'asc'
                ? 'desc'
                : 'asc',
          };
          this.renderMain(tableBy(this.db, this.tableId));
        }),
    );
    $$('[data-cell-column]').forEach(
      (input) =>
        (input.onchange = () => {
          const id = input.closest('[data-record]').dataset.record;
          try {
            const value = input.type === 'checkbox' ? input.checked : input.value;
            this.mutate('Edit data cell', (db) =>
              db.update(table.id, id, { [input.dataset.cellColumn]: value }),
            );
            input.classList.remove('invalid');
          } catch (error) {
            input.classList.add('invalid');
            notify(error.message);
          }
        }),
    );
    $$('[data-delete-record]').forEach(
      (b) =>
        (b.onclick = () => {
          try {
            this.mutate('Delete data record', (db) => db.remove(table.id, b.dataset.deleteRecord));
            this.renderMain(tableBy(this.db, this.tableId));
          } catch (error) {
            notify(error.message);
          }
        }),
    );
  }
  cellEditor(table, row, column) {
    const name = column.name,
      value = row[name],
      relation = this.db.relationships.find(
        (r) => r.fromTable === table.id && r.fromColumn === name,
      );
    if (relation) {
      const target = tableBy(this.db, relation.toTable);
      return `<select data-cell-column="${esc(name)}" aria-label="${esc(name)}"><option value="">null</option>${target.rows.map((r) => `<option value="${esc(r[relation.toColumn])}" ${r[relation.toColumn] === value ? 'selected' : ''}>${esc(r[relation.toColumn])}</option>`).join('')}</select>`;
    }
    if (column.type === 'boolean')
      return `<input type="checkbox" data-cell-column="${esc(name)}" aria-label="${esc(name)}" ${value ? 'checked' : ''}>`;
    return `<input data-cell-column="${esc(name)}" aria-label="${esc(name)}" type="${column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}" value="${esc(value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : value)}" placeholder="null">`;
  }
  tableDialog(id) {
    const old = tableBy(this.db, id);
    this.s.modal(
      old ? 'Rename table' : 'New table',
      field('name', 'Table name', old?.name || 'NewTable') +
        '<p>Use letters, numbers, and underscores. The table is exposed as Tables.Name in preview data. Renaming changes binding paths; update existing XAML bindings and interaction paths after the rename.</p>',
      [
        {
          label: old ? 'Rename' : 'Create table',
          primary: true,
          run: () => {
            const name = $('[name=name]').value.trim();
            if (!validName(name)) throw Error('Use a valid identifier.');
            this.mutate(old ? 'Rename data table' : 'Create data table', (db) => {
              if (old) db.transaction((data) => (tableBy(data, old.id).name = name));
              else
                this.tableId = db.addTable(name, [
                  { name: 'Name', type: 'string', required: true, default: 'New record' },
                ]);
            });
            this.mode = 'schema';
            this.open();
          },
        },
      ],
    );
  }
  deleteTable(table) {
    this.s.modal(
      'Delete table',
      `<p>Remove ${esc(table.name)} and its ${table.rows.length} records? This can be undone in the database owner page.</p>`,
      [
        {
          label: 'Delete table',
          primary: true,
          run: () => {
            this.mutate('Delete data table', (db) =>
              db.transaction((data) => {
                if (
                  data.relationships.some(
                    (r) => r.fromTable === table.id || r.toTable === table.id,
                  ) ||
                  data.queries.some(
                    (q) => q.tableId === table.id || q.joins?.some((j) => j.tableId === table.id),
                  )
                )
                  throw Error('Remove relationships and queries using this table first.');
                data.tables = data.tables.filter((t) => t.id !== table.id);
              }),
            );
            this.tableId = null;
            this.open();
          },
        },
      ],
    );
  }
  columnDialog(name) {
    const table = tableBy(this.db, this.tableId),
      old = table?.columns.find((c) => c.name === name);
    if (!table) return;
    this.s.modal(
      old ? 'Edit column' : 'Add column',
      field('column-name', 'Column name', old?.name || 'NewColumn') +
        (old
          ? '<p>Renaming updates database queries and relationships. Update XAML bindings and interaction property paths that use the old name.</p>'
          : '') +
        select('column-type', 'Type', DATA_TYPES, old?.type || 'string') +
        field(
          'column-default',
          'Default value',
          old?.default == null
            ? ''
            : typeof old.default === 'object'
              ? JSON.stringify(old.default)
              : String(old.default),
        ) +
        `<div class="check-row"><label><input type="checkbox" name="required" ${old?.required ? 'checked' : ''}> Required</label><label><input type="checkbox" name="unique" ${old?.unique ? 'checked' : ''}> Unique</label></div>`,
      [
        ...(old
          ? [
              {
                label: 'Delete column',
                run: () => {
                  this.mutate('Delete data column', (db) =>
                    db.transaction((data) => {
                      if (
                        data.relationships.some(
                          (r) =>
                            (r.fromTable === table.id && r.fromColumn === name) ||
                            (r.toTable === table.id && r.toColumn === name),
                        )
                      )
                        throw Error('Remove this column’s relationships first.');
                      const t = tableBy(data, table.id);
                      t.columns = t.columns.filter((c) => c.name !== name);
                      t.rows.forEach((r) => delete r[name]);
                    }),
                  );
                  this.open();
                },
              },
            ]
          : []),
        {
          label: 'Save column',
          primary: true,
          run: () => {
            const column = {
              name: $('[name=column-name]').value.trim(),
              type: $('[name=column-type]').value,
              required: $('[name=required]').checked,
              unique: $('[name=unique]').checked,
            };
            const raw = $('[name=column-default]').value;
            column.default = parseValue(raw, column.type, !column.required);
            this.mutate('Edit data schema', (db) => {
              if (!old) db.addColumn(table.id, column);
              else
                db.transaction((data) => {
                  const t = tableBy(data, table.id);
                  t.columns[t.columns.findIndex((c) => c.name === name)] = column;
                  t.rows.forEach((r) => {
                    r[column.name] = parseValue(r[name], column.type, !column.required);
                    if (name !== column.name) delete r[name];
                  });
                  for (const relation of data.relationships) {
                    if (relation.fromTable === table.id && relation.fromColumn === name)
                      relation.fromColumn = column.name;
                    if (relation.toTable === table.id && relation.toColumn === name)
                      relation.toColumn = column.name;
                  }
                  for (const q of data.queries) {
                    if (q.tableId === table.id) {
                      for (const f of q.filters || [])
                        if (f.column === name) f.column = column.name;
                      if (q.sort?.column === name) q.sort.column = column.name;
                    }
                    for (const j of q.joins || []) {
                      if (q.tableId === table.id && j.localColumn === name)
                        j.localColumn = column.name;
                      if (j.tableId === table.id && j.foreignColumn === name)
                        j.foreignColumn = column.name;
                    }
                  }
                });
            });
            this.open();
          },
        },
      ],
    );
  }
  recordDialog() {
    const table = tableBy(this.db, this.tableId);
    this.s.modal(
      'New ' + table.name + ' record',
      table.columns
        .map((c) =>
          c.type === 'boolean'
            ? select(c.name, c.name, ['true', 'false'], String(c.default ?? false))
            : field(
                c.name,
                c.name + (c.required ? ' *' : ''),
                c.default == null
                  ? ''
                  : typeof c.default === 'object'
                    ? JSON.stringify(c.default)
                    : c.default,
                c.type === 'date' ? 'date' : c.type === 'number' ? 'number' : 'text',
              ),
        )
        .join(''),
      [
        {
          label: 'Add record',
          primary: true,
          run: () => {
            const values = {};
            for (const c of table.columns) values[c.name] = $('[name="' + c.name + '"]').value;
            this.mutate('Add data record', (db) => db.insert(table.id, values));
            this.mode = 'records';
            this.open();
          },
        },
      ],
    );
  }
  renderRelations(host) {
    host.innerHTML = `<div class="data-heading"><h3>Relationships</h3><span class="spacer"></span><button class="button primary" id="add-relation">+ Relationship</button></div><p class="feature-help">Foreign keys are validated on every edit. Choose restricted, cascading, or nullable deletion.</p><div class="relationship-list">${this.db.relationships.map((r) => `<div class="relationship-card"><strong>${esc(tableBy(this.db, r.fromTable)?.name)}.${esc(r.fromColumn)}</strong><span>many → one</span><strong>${esc(tableBy(this.db, r.toTable)?.name)}.${esc(r.toColumn)}</strong><span class="badge">${esc(r.onDelete || 'restrict')}</span><button class="icon-button" data-delete-relation="${r.id}" title="Delete relationship">×</button></div>`).join('') || '<div class="data-empty">No relationships yet.</div>'}</div>`;
    $('#add-relation').onclick = () => this.relationDialog();
    $$('[data-delete-relation]').forEach(
      (b) =>
        (b.onclick = () => {
          this.mutate('Delete relationship', (db) =>
            db.transaction(
              (d) =>
                (d.relationships = d.relationships.filter(
                  (r) => r.id !== b.dataset.deleteRelation,
                )),
            ),
          );
          this.renderRelations(host);
        }),
    );
  }
  relationDialog() {
    const tables = this.db.tables;
    if (tables.length < 1) {
      notify('Create a table first.');
      return;
    }
    this.s.modal(
      'Create relationship',
      select(
        'from-table',
        'From table',
        tables.map((t) => [t.id, t.name]),
      ) +
        '<div id="from-column"></div>' +
        select(
          'to-table',
          'Referenced table',
          tables.map((t) => [t.id, t.name]),
        ) +
        '<div id="to-column"></div>' +
        select(
          'on-delete',
          'When referenced record is deleted',
          ['restrict', 'cascade', 'setNull'],
          'restrict',
        ),
      [
        {
          label: 'Create relationship',
          primary: true,
          run: () => {
            const rel = {
              id: uid(),
              fromTable: $('[name=from-table]').value,
              fromColumn: $('[name=from-column]').value,
              toTable: $('[name=to-table]').value,
              toColumn: $('[name=to-column]').value,
              onDelete: $('[name=on-delete]').value,
            };
            this.mutate('Create relationship', (db) =>
              db.transaction((data) => data.relationships.push(rel)),
            );
            this.mode = 'relations';
            this.open();
          },
        },
      ],
    );
    const update = () => {
      const from = tableBy(this.db, $('[name=from-table]').value),
        to = tableBy(this.db, $('[name=to-table]').value);
      $('#from-column').innerHTML = select(
        'from-column',
        'Foreign-key column',
        from.columns.map((c) => c.name),
      );
      $('#to-column').innerHTML = select('to-column', 'Unique target column', [
        '_id',
        ...to.columns.filter((c) => c.unique).map((c) => c.name),
      ]);
    };
    $('[name=from-table]').onchange = update;
    $('[name=to-table]').onchange = update;
    update();
  }
  renderQueries(host) {
    host.innerHTML = `<div class="data-heading"><h3>Saved queries</h3><span class="spacer"></span><button class="button primary" id="add-query">+ Query</button></div>${this.db.queries.map((q) => `<div class="query-card"><div><strong>${esc(q.name)}</strong><p class="feature-help">${esc(tableBy(this.db, q.tableId)?.name || 'Missing table')} · ${q.filters?.length || 0} filters · ${q.joins?.length || 0} joins</p></div><span class="spacer"></span><button class="button" data-bind-query="${esc(q.name)}">Bind</button><button class="button" data-edit-query="${q.id}">Edit query</button></div>`).join('') || '<div class="data-empty">Create a reusable filtered or joined data view.</div>'}`;
    $('#add-query').onclick = () => this.queryDialog();
    $$('[data-edit-query]').forEach(
      (b) => (b.onclick = () => this.queryDialog(b.dataset.editQuery)),
    );
    $$('[data-bind-query]').forEach(
      (b) => (b.onclick = () => this.bindingDialog('Queries.' + b.dataset.bindQuery)),
    );
  }
  queryDialog(id) {
    if (!this.db.tables.length) {
      notify('Create a table first.');
      return;
    }
    const current = this.db.queries.find((q) => q.id === id) || {
      id: uid(),
      name: 'NewQuery',
      tableId: this.tableId || this.db.tables[0].id,
      filters: [],
      joins: [],
      sort: { column: '', direction: 'asc' },
      limit: 100,
    };
    const q = clone(current);
    const show = () => {
      const table = tableBy(this.db, q.tableId) || this.db.tables[0];
      this.s.modal(
        'Visual query builder',
        `<div class="form-columns">${field('query-name', 'Query name', q.name)}${select(
          'query-table',
          'Source table',
          this.db.tables.map((t) => [t.id, t.name]),
          q.tableId,
        )}</div><div class="section-heading">Filters (all must match)<span class="spacer"></span><button class="button" id="query-add-filter">+ Filter</button></div><div id="query-filters">${q.filters
          .map(
            (f, i) =>
              `<div class="query-filter" data-filter="${i}">${select(
                'filter-column',
                'Column',
                table.columns.map((c) => c.name),
                f.column,
              )}${select('filter-op', 'Operator', ['eq', 'ne', 'contains', 'startsWith', 'gt', 'gte', 'lt', 'lte', 'isNull', 'notNull'], f.operator)}${field('filter-value', 'Value', f.value ?? '')}<button data-remove-filter="${i}" class="icon-button">×</button></div>`,
          )
          .join(
            '',
          )}</div><div class="section-heading">Joins<span class="spacer"></span><button class="button" id="query-add-join">+ Join</button></div>${q.joins
          .map(
            (j, i) =>
              `<div class="query-join" data-join="${i}">${select(
                'join-table',
                'Table',
                this.db.tables.map((t) => [t.id, t.name]),
                j.tableId,
              )}${field('join-local', 'Local column', j.localColumn)}${field('join-foreign', 'Foreign column', j.foreignColumn)}${field('join-as', 'Alias', j.as)}${select('join-kind', 'Kind', ['left', 'inner'], j.kind)}<button data-remove-join="${i}" class="icon-button">×</button></div>`,
          )
          .join(
            '',
          )}<div class="form-columns">${select('query-sort', 'Sort column', ['', ...table.columns.map((c) => c.name)], q.sort.column)}${select('query-direction', 'Direction', ['asc', 'desc'], q.sort.direction)}${field('query-limit', 'Maximum records', q.limit, 'number')}</div><button class="button" id="query-run">Run query</button><pre class="query-result" id="query-result">Run to inspect results.</pre>`,
        [
          ...(id
            ? [
                {
                  label: 'Delete query',
                  run: () => {
                    this.mutate('Delete query', (db) =>
                      db.transaction((d) => (d.queries = d.queries.filter((x) => x.id !== id))),
                    );
                    this.mode = 'queries';
                    this.open();
                  },
                },
              ]
            : []),
          {
            label: 'Save query',
            primary: true,
            run: () => {
              capture();
              if (!validName(q.name)) throw Error('Use a valid query name.');
              queryRows(this.db, q);
              this.mutate('Save query', (db) =>
                db.transaction((data) => {
                  if (data.queries.some((x) => x.name === q.name && x.id !== q.id))
                    throw Error('Query names must be unique.');
                  data.queries = data.queries.filter((x) => x.id !== q.id);
                  data.queries.push(q);
                }),
              );
              this.mode = 'queries';
              this.open();
            },
          },
        ],
        true,
      );
      const capture = () => {
        q.name = $('[name=query-name]').value.trim();
        q.tableId = $('[name=query-table]').value;
        q.sort = {
          column: $('[name=query-sort]').value,
          direction: $('[name=query-direction]').value,
        };
        q.limit = Number($('[name=query-limit]').value);
        q.filters = $$('[data-filter]').map((row) => {
          const column = $('[name=filter-column]', row).value,
            c = table.columns.find((c) => c.name === column),
            operator = $('[name=filter-op]', row).value,
            raw = $('[name=filter-value]', row).value;
          return {
            column,
            operator,
            value: ['isNull', 'notNull'].includes(operator)
              ? null
              : parseValue(raw, c?.type || 'string'),
          };
        });
        q.joins = $$('[data-join]').map((row) => ({
          tableId: $('[name=join-table]', row).value,
          localColumn: $('[name=join-local]', row).value,
          foreignColumn: $('[name=join-foreign]', row).value,
          as: $('[name=join-as]', row).value,
          kind: $('[name=join-kind]', row).value,
        }));
      };
      $('#query-add-filter').onclick = () => {
        try {
          capture();
          q.filters.push({
            column: table.columns[0]?.name || '_id',
            operator: 'contains',
            value: '',
          });
          show();
        } catch (e) {
          notify(e.message);
        }
      };
      $('#query-add-join').onclick = () => {
        capture();
        q.joins.push({
          tableId: this.db.tables[0].id,
          localColumn: table.columns[0]?.name || '_id',
          foreignColumn: '_id',
          as: 'Related',
          kind: 'left',
        });
        show();
      };
      $$('[data-remove-filter]').forEach(
        (b) =>
          (b.onclick = () => {
            capture();
            q.filters.splice(Number(b.dataset.removeFilter), 1);
            show();
          }),
      );
      $$('[data-remove-join]').forEach(
        (b) =>
          (b.onclick = () => {
            capture();
            q.joins.splice(Number(b.dataset.removeJoin), 1);
            show();
          }),
      );
      $('[name=query-table]').onchange = () => {
        q.tableId = $('[name=query-table]').value;
        q.filters = [];
        q.joins = [];
        show();
      };
      $('#query-run').onclick = () => {
        try {
          capture();
          $('#query-result').textContent = JSON.stringify(queryRows(this.db, q), null, 2);
        } catch (error) {
          $('#query-result').textContent = error.message;
        }
      };
    };
    show();
  }
  renderObjects(host) {
    const objects = this.db.objects || {};
    const tree = (value, path = '', depth = 0) =>
      Object.entries(value)
        .map(([key, v]) => {
          const p = path ? path + '.' + key : key;
          if (v && typeof v === 'object')
            return `<details open class="object-branch"><summary>${esc(key)} <small>${Array.isArray(v) ? 'array' : 'object'}</small></summary>${tree(v, p, depth + 1)}</details>`;
          return `<div class="object-property"><label title="${esc(p)}">${esc(key)}</label>${typeof v === 'boolean' ? `<select data-object-path="${esc(p)}" data-value-type="boolean"><option ${v ? 'selected' : ''}>true</option><option ${!v ? 'selected' : ''}>false</option></select>` : `<input data-object-path="${esc(p)}" data-value-type="${v === null ? 'json' : typeof v}" value="${esc(v === null ? 'null' : v)}">`}<button class="icon-button" data-delete-object="${esc(p)}" title="Remove property">×</button></div>`;
        })
        .join('');
    host.innerHTML = `<div class="data-heading"><h3>Object model</h3><span class="spacer"></span><button class="button" id="object-json">Edit JSON</button><button class="button primary" id="object-add">+ Property</button></div><p class="feature-help">Object properties are exposed at the binding root. Use App.Counter or App.Search in controls and interaction actions.</p><div class="object-tree">${tree(objects)}</div>`;
    $$('[data-object-path]').forEach(
      (input) =>
        (input.onchange = () => {
          try {
            let type = input.dataset.valueType;
            if (type === 'object') type = 'json';
            const value = parseValue(input.value, type);
            this.mutate('Edit object value', (db) =>
              db.transaction((d) => writePath(d.objects, input.dataset.objectPath, value)),
            );
          } catch (e) {
            notify(e.message);
          }
        }),
    );
    $$('[data-delete-object]').forEach(
      (b) =>
        (b.onclick = () => {
          this.mutate('Remove object property', (db) =>
            db.transaction((d) => {
              const parts = b.dataset.deleteObject.split('.'),
                key = parts.pop(),
                parent = parts.length ? readPath(d.objects, parts.join('.')) : d.objects;
              delete parent[key];
            }),
          );
          this.renderObjects(host);
        }),
    );
    $('#object-add').onclick = () => this.objectDialog();
    $('#object-json').onclick = () => this.jsonObjectDialog();
  }
  objectDialog() {
    this.s.modal(
      'Add object property',
      field('object-path', 'Property path', 'App.NewValue') +
        select('object-type', 'Value type', ['string', 'number', 'boolean', 'json'], 'string') +
        field('object-value', 'Value', ''),
      [
        {
          label: 'Add property',
          primary: true,
          run: () => {
            const path = $('[name=object-path]').value,
              value = parseValue($('[name=object-value]').value, $('[name=object-type]').value);
            this.mutate('Add object property', (db) =>
              db.transaction((d) => writePath(d.objects, path, value)),
            );
            this.mode = 'objects';
            this.open();
          },
        },
      ],
    );
  }
  jsonObjectDialog() {
    this.s.modal(
      'Edit object JSON',
      `<textarea id="object-json-value" style="height:300px">${esc(JSON.stringify(this.db.objects, null, 2))}</textarea>`,
      [
        {
          label: 'Apply object model',
          primary: true,
          run: () => {
            const value = JSON.parse($('#object-json-value').value);
            if (!value || typeof value !== 'object' || Array.isArray(value))
              throw Error('Use a JSON object.');
            this.mutate('Replace object model', (db) => db.transaction((d) => (d.objects = value)));
            this.mode = 'objects';
            this.open();
          },
        },
      ],
    );
  }
  bindingDialog(path = '') {
    if (!this.s.selected.length) {
      notify('Select a control to bind, then open its data source.');
      return;
    }
    const paths = bindingPaths({ ...this.s.doc.metadata.sampleData, ...this.context() }),
      n = this.s.selected[0];
    this.s.modal(
      'Connect data to selection',
      select(
        'bind-property',
        'Target property',
        [
          'DataContext',
          'Text',
          'Content',
          'ItemsSource',
          'SelectedItem',
          'IsChecked',
          'IsVisible',
          'Value',
          'Background',
        ],
        path.startsWith('Tables.') || path.startsWith('Queries.') ? 'ItemsSource' : 'Text',
      ) +
        `<label>Data path<input name="bind-path" list="design-binding-paths" value="${esc(path)}"><datalist id="design-binding-paths">${paths.map((p) => `<option value="${esc(p)}">`).join('')}</datalist></label>` +
        select('bind-mode', 'Binding mode', ['OneWay', 'TwoWay', 'OneTime'], 'OneWay') +
        '<p>DataContext is inherited. ItemsSource repeats item templates. TwoWay input changes are local to the preview session.</p>',
      [
        {
          label: 'Apply binding',
          primary: true,
          run: () => {
            const property = $('[name=bind-property]').value,
              path = $('[name=bind-path]').value.trim(),
              mode = $('[name=bind-mode]').value;
            if (path) readPath(this.context(), path);
            this.s.setProps(
              this.s.store.selection,
              property,
              `{Binding ${path}${mode !== 'OneWay' ? ', Mode=' + mode : ''}}`,
            );
            this.s.closeModal();
            notify(`${property} connected to ${path}`);
          },
        },
      ],
    );
  }
  importDialog() {
    this.s.modal(
      'Import design data',
      '<p>Import a design-database JSON file, or CSV as a new typed table. Existing records are kept when importing CSV.</p><input id="data-import-file" type="file" accept=".json,.csv"><label>CSV table name<input id="csv-table-name" value="ImportedData"></label>',
      [
        {
          label: 'Import data',
          primary: true,
          run: async () => {
            const file = $('#data-import-file').files[0];
            if (!file) throw Error('Choose a file.');
            if (file.size > 8_000_000) throw Error('Use files under 8 MB.');
            const text = await file.text();
            if (file.name.toLowerCase().endsWith('.csv')) {
              const rows = parseCSV(text),
                headers = rows.shift();
              if (!headers?.length) throw Error('CSV must contain a header.');
              const name = $('#csv-table-name').value,
                columns = headers.map((name, i) => {
                  const values = rows.map((r) => r[i]).filter((v) => v !== '' && v !== undefined);
                  const type =
                    values.length && values.every((v) => /^(true|false)$/i.test(v))
                      ? 'boolean'
                      : values.length && values.every((v) => Number.isFinite(Number(v)))
                        ? 'number'
                        : 'string';
                  return { name, type };
                });
              this.mutate('Import CSV', (db) => {
                const id = uid();
                db.transaction((data) => {
                  if (rows.some((r) => r.length !== headers.length))
                    throw Error('Every CSV row must match the header column count.');
                  data.tables.push({
                    id,
                    name,
                    columns,
                    rows: rows.map((row) =>
                      Object.fromEntries([
                        ['_id', uid()],
                        ...columns.map((c, i) => [
                          c.name,
                          parseValue(c.type === 'boolean' ? row[i].toLowerCase() : row[i], c.type),
                        ]),
                      ]),
                    ),
                  });
                });
                this.tableId = id;
              });
            } else {
              const data = validateDatabase(JSON.parse(text));
              this.mutate('Import database', (db) => (db.data = clone(data)));
            }
            this.mode = 'records';
            this.open();
          },
        },
      ],
    );
  }
  exportDialog() {
    const table = tableBy(this.db, this.tableId);
    this.s.modal(
      'Export data',
      '<p>Save the complete typed database with relationships and queries, or export the current table as CSV.</p>',
      [
        {
          label: 'Database JSON',
          primary: true,
          run: () => {
            saveFile('xamora-design-data.json', JSON.stringify(this.db, null, 2));
            this.open();
          },
        },
        ...(table
          ? [
              {
                label: table.name + ' CSV',
                run: () => {
                  saveFile(table.name + '.csv', toCSV(table), 'text/csv');
                  this.open();
                },
              },
            ]
          : []),
      ],
    );
  }
  loadSample() {
    this.mutate('Load sample database', (db) => {
      let name = 'Projects',
        i = 2;
      while (tableBy(db.data, name)) name = 'Projects' + i++;
      const id = db.addTable(name, [
        { name: 'Name', type: 'string', required: true },
        { name: 'Status', type: 'string', default: 'Active' },
        { name: 'Progress', type: 'number', default: 0 },
        { name: 'Owner', type: 'string' },
        { name: 'Due', type: 'date' },
        { name: 'Completed', type: 'boolean', default: false },
      ]);
      for (const row of [
        {
          Name: 'Brand refresh',
          Status: 'Active',
          Progress: 72,
          Owner: 'Mia',
          Due: '2026-10-24',
          Completed: false,
        },
        {
          Name: 'Website experience',
          Status: 'Active',
          Progress: 48,
          Owner: 'Noah',
          Due: '2026-11-02',
          Completed: false,
        },
        {
          Name: 'Design system',
          Status: 'Review',
          Progress: 94,
          Owner: 'Alex',
          Due: '2026-10-18',
          Completed: false,
        },
      ])
        db.insert(id, row);
      this.tableId = id;
    });
    this.mode = 'records';
    this.open();
  }
}
