# Xamora Studio 0.2 — designer workflows

## Try a connected prototype

1. Open **Data** in the left sidebar.
2. Choose **Open connected example**. This adds a typed Projects table and two new views alongside your work.
3. In **Views**, inspect the connections between the project browser and detail view.
4. Choose **Run preview**, select a project, and press **Open selected project**.
5. Edit the project name in the detail view, move focus out of the field, and go back. The preview uses the updated record.
6. Choose **State** to inspect the session data, or **Reset session** to restore its initial values.

Preview changes use an isolated copy. The source database changes only through the data editor. Export a project JSON to retain tables, interactions, annotations, and every view together.

## Nested selection and hit testing

| Gesture | Result |
| --- | --- |
| Click | Select a hit layer; retain a selected ancestor beneath the pointer for easier dragging |
| Ctrl/Command-click | Select the deepest eligible hit |
| Alt-click | Cycle front-to-back through overlapping eligible layers |
| Alt-Shift-click | Cycle in reverse |
| Right-click → Select layer at pointer | Inspect the explicit hit list, including locked layers |
| Shift-click | Toggle a layer in the selection |
| Drag on empty canvas | Select fully enclosed layers; avoid redundant descendants |
| Enter / Shift-Enter | Select a child / logical parent |
| Tab / Shift-Tab | Select the next / previous sibling when focus is on the canvas or layer tree |
| Isolate | Restrict canvas hits and destinations to the selected subtree |
| Escape | Cancel a drag, close a dialog, or leave isolation |

The breadcrumb above the canvas provides direct ancestor selection. Locked layers remain inspectable from the tree but their editing commands and drag handles are disabled. Lock metadata is stored in the project, not authored into native XAML. To edit a child of a locked container, unlock its ancestor.

## Moving and arranging controls

Drag an existing control over another container. A purple boundary, insertion line, or cell highlight shows where it will go. Release to commit one undoable edit. Escape cancels it. Shift-drag keeps the original parent.

- **Canvas:** edit absolute coordinates. Multiple layers preserve relative spacing. Snap uses the 8-pixel grid plus nearby parent/sibling edges and centers; pink guides identify alignment targets.
- **Grid:** choose a cell using the browser’s measured track sizes and gaps. Pixel, star, and Auto tracks need not be equal.
- **StackPanel, WrapPanel, UniformGrid, and common item containers:** reorder at the visible insertion line.
- **DockPanel:** choose a docking edge and an insertion position.
- **Layer tree:** upper/lower row zones insert before/after; the middle zone reparents inside an accepting container. Tree reordering retains authored layout properties.
- **Multiple Canvas siblings:** use Distribute horizontally/vertically for equal gaps. Existing alignment and nudge controls remain available.

The drag planner rejects moving a parent into its child, moving the document root, incompatible content capacity, and locked destinations. Explicit `.Children`, `.Child`, `.Content`, and `.Items` wrappers participate in logical parenting.

## Visual grid editing

Select a Grid and choose **Grid** in the toolbar or **Edit grid tracks** in Editing helpers. Switch between rows and columns; edit Auto/pixel/star sizes, minimum, maximum, and shared group values. Apply commits a validated draft. Add/remove operations update child indexes and spans.

Enable **Show tracks** to display track labels and draggable dividers on the artboard. Divider dragging converts the adjacent tracks to pixel sizes. Minimum/maximum and shared-group metadata is retained in XAML; browser preview does not reproduce all native Grid sizing constraints.

## Raw properties and XAML

The **Raw** tab lists the complete authored attribute map, with filtering, expression labels, mixed multi-selection values, add/update, and explicit removal. An empty input is an authored empty string. The × action removes an attribute.

**Edit JSON** replaces one selected element’s attribute map, or merges edits into multiple selected elements. String values set attributes; null removes them. Complex property elements, templates, and collection contents remain editable through the XAML editor and visual tree.

The code editor offers contextual completions for registered types, properties, toolkit enum values, common property values, resource keys, named elements, binding options, and current design-data paths. Ctrl/Command-Space opens suggestions. Enter/Tab accepts a current suggestion. Completion dismisses when the source/caret no longer matches its replacement range. Formatting, symbols, find/replace, comments, validation, indentation, and explicit Apply remain available.

Apply attempts to preserve identity for unique named elements and unchanged structural positions, keeping saved interactions attached through common code edits. Ambiguous names, namescopes, large structural rewrites, or renamed controls still require connection review. This is a contextual editor, not a native semantic XAML language server.

## Typed data editor

Open **Data → Open data editor**. The editor has five views:

| View | Operations |
| --- | --- |
| Records | Add/delete records, edit typed cells, filter all displayed values, sort columns, follow foreign-key choices, bind a collection |
| Schema | Add/edit/delete columns; string, number, boolean, date, and JSON types; required/unique/default values; table names |
| Relationships | Many-to-one foreign keys with unique targets; restrict, cascade, or set-null deletion |
| Queries | Multiple filters, indexed inner/left joins, sorting, row limit, run/inspect output, saved named results |
| Objects | Expandable object tree, scalar editing, add/remove paths, and whole-object JSON editing |

The project-wide database lives in the first document containing `metadata.dataModel`, otherwise the first workspace document becomes its owner. Data edits use that document’s undo history. The data editor’s Undo/Redo buttons operate on the owner’s complete history. A workspace currently resolves one active database; importing another workspace with its own database does not automatically merge the two databases.

CSV import creates a new typed table and checks the entire batch before committing. Database JSON import replaces the design database in an undoable edit. CSV and JSON export are available from the data toolbar. Dates use YYYY-MM-DD. Data limits are 100 tables and 20,000 records; table rendering shows the first 500 filtered rows. Joined intermediate output is capped at 20,000 rows to prevent accidental unbounded expansion.

Renaming a table or column changes its binding path. Column renames update database relationships and query references. Authored XAML bindings and interaction paths require review after schema renaming. Deleting columns used by saved queries fails validation until the dependency is removed.

This is an in-project design database. It has no SQL server, authenticated remote database connector, migration service, or production data synchronization.

## Bind the object model

Select a control and choose **Connect data**. Typical bindings:

```xml
<ListBox ItemsSource="{Binding Tables.Projects}" />
<TextBlock Text="{Binding Selection.Projects.Name}" />
<TextBox Text="{Binding Selection.Projects.Name, Mode=TwoWay}" />
<TextBox Text="{Binding App.Search, Mode=TwoWay, UpdateSourceTrigger=PropertyChanged}" />
<StackPanel DataContext="{Binding Selection.Projects}">
    <TextBox Text="{Binding Name, Mode=TwoWay}" />
</StackPanel>
```

Roots include authored object data such as `App`, the `Tables` collections, `Queries` results, and `Selection` records. `$root` accesses the root from an inherited context. Numeric bracket indexes are accepted. Basic fallback, null substitution, and string formatting work for reads. Query projections are read-only; update their source table instead.

ItemsSource repeats a DataTemplate for supported item containers. Each instance keeps an authored source ID plus a separate runtime instance ID. Inherited contexts inside repeated templates are evaluated. DataGrid supports basic text columns/automatic columns. These mappings are browser approximations, not native virtualization or full editing-column engines.

TwoWay table writes validate against the column type, uniqueness, required values, and foreign keys. A successful change refreshes Tables, Selection, and Queries. A rejected change leaves the database and context unchanged and does not dispatch a Change connector. Context provenance identifies a record by table ID and record ID, so a preceding interaction does not redirect a later input into the wrong row.

## Multiple views and interactions

Choose **Views** in the workspace toolbar. All page artboards appear together; switch to Responsive comparison for 390, 768, and 1100 pixel versions of the active page. Double-click a control in a thumbnail to return to its editable page.

Drag a purple connection port from one page to another. Select the actual source control, trigger, and ordered actions in the connection editor. Existing connection curves open that editor. The **Flow** inspector lists interactions for the current selection.

Triggers are Click, Change, PointerEnter, PointerLeave, DoubleClick, and SelectionChanged. Actions include navigation/back, overlay open/close, set/toggle/increment data, property/visibility changes, record selection, and record insert/update/delete. Conditions compare a data path against a value. Values accept JSON literals, `$event.value`, `$event.rowId`, or `{"path":"App.Counter"}`.

Actions from an event run as one rollback boundary. A missing destination or invalid data operation cancels the event’s state changes. Preview includes view selection, back navigation, viewport sizing, reset, state inspection, and a recent-event log. Native code-behind and arbitrary .NET handlers are not executed.

The workspace JSON stores the prototype graph. XAML export preserves authored native bindings and properties; it does not synthesize native application code from prototype actions. HTML export contains a rendered view and current design data; the multi-view prototype runtime is supplied as reusable JavaScript source, not bundled into the standalone HTML snapshot.


## Docking workspace in 0.4

Panels described above now have independent docking windows. Drag tabs/title bars to rearrange them; use the compass for tabbing or splitting, the pin for auto-hide, and Window for layout presets, named layouts, import/export and recovery of closed windows. Use the dedicated [docking guide](DOCKING.md) for all gestures, shortcuts and extension APIs. Canvas and source-editor instances survive panel moves. Switching between design pages retains the existing source validation guard.


## Editor workspace in 0.5

The [editor workflow guide](EDITOR-WORKFLOWS.md) covers the new solution tree, full menu bar, explicit editor modes, direct canvas text/rotation/path controls, visual property/resource editing, retained view cards, inline connections, grouped keyframes and canvas recording. Existing data, nested selection, container drop and prototype workflows described above remain available through their IDE menus.
