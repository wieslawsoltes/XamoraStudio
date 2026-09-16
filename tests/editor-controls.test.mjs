import test from 'node:test';
import assert from 'node:assert/strict';
import { installDockDOM } from './docking-dom.mjs';
import { MenuBar } from '../dist/controls/menu-bar.js';
import { XamlEditor } from '../dist/core/editor.js';
import { IdeMenu } from '../dist/studio/ide-menu.js';
import { RichProperties } from '../dist/studio/rich-properties.js';
import { SolutionWorkspace } from '../dist/studio/solution-workspace.js';
import { ViewBoard } from '../dist/studio/view-board.js';
import { DocumentStore, clone, find } from '../dist/core/model.js';
import { parseXaml } from '../dist/core/xaml.js';
import { createSolution } from '../dist/core/solution.js';
import { propertyObject } from '../dist/core/authoring.js';
import { dockMinimum, dockRatioLimits, dockGroup, dockSplit } from '../dist/core/docking.js';
function sourceFixture() {
  const dom = installDockDOM(),
    input = dom.element('textarea');
  document.body.append(input);
  input.value = '<Grid/>';
  input.setSelectionRange(0, 0);
  input.setRangeText = (text, a, b, mode) => {
    input.value = input.value.slice(0, a) + text + input.value.slice(b);
    input.setSelectionRange(a + text.length, a + text.length);
  };
  input.select = () => input.setSelectionRange(0, input.value.length);
  const editor = Object.assign(Object.create(XamlEditor.prototype), {
    input,
    editHistory: [],
    editFuture: [],
    lastText: input.value,
    syncedText: input.value,
    hideCompletions() {},
    paint() {},
    validate() {
      return true;
    },
  });
  return { dom, input, editor };
}
test('menu keyboard skips disabled items, enters nested menus, and restores editor focus', () => {
  const dom = installDockDOM(),
    host = dom.element(),
    input = dom.element('textarea');
  document.body.append(input, host);
  input.focus();
  let called = 0;
  const menu = new MenuBar(host, [
    {
      label: 'File',
      children: [
        { label: 'Disabled', enabled: false },
        { label: 'New', children: [{ label: 'View', run: () => called++ }] },
      ],
    },
  ]);
  menu.openRoot(0);
  assert.equal(document.activeElement.textContent, 'New›');
  const key = (k) =>
    menu.keydown({
      key: k,
      target: document.activeElement,
      preventDefault() {},
      stopImmediatePropagation() {},
    });
  key('ArrowRight');
  assert.equal(menu.stack.length, 2);
  assert.equal(document.activeElement.textContent, 'View');
  menu.stack[1].items[0].button.onclick({ stopPropagation() {} });
  assert.equal(called, 1);
  assert.equal(document.activeElement, input);
  assert.equal(menu.stack.length, 0);
  menu.dispose();
});
test('pointer-opening a menu retains the input that had focus before the button', () => {
  const dom = installDockDOM(),
    host = dom.element(),
    input = dom.element('textarea');
  document.body.append(input, host);
  const menu = new MenuBar(host, [{ label: 'File', children: [{ label: 'Open', run() {} }] }]);
  input.focus();
  menu.buttons[0].onpointerdown();
  menu.buttons[0].focus();
  menu.buttons[0].onclick();
  menu.close();
  assert.equal(document.activeElement, input);
  menu.dispose();
});
test('source-buffer undo/redo includes programmatic edits and stays separate from applied source', () => {
  const { input, editor } = sourceFixture();
  input.value = '<Grid><Button/></Grid>';
  editor.changed();
  input.value = '<Canvas/>';
  editor.changed();
  assert.equal(editor.editHistory.length, 2);
  editor.undoBuffer();
  assert.equal(input.value, '<Grid><Button/></Grid>');
  editor.redoBuffer();
  assert.equal(input.value, '<Canvas/>');
  assert.equal(editor.dirty, true);
  editor.undoBuffer();
  editor.undoBuffer();
  assert.equal(input.value, '<Grid/>');
  assert.equal(editor.dirty, false);
});
test('source focused Edit Cut and Undo change only the source buffer', async () => {
  const { input, editor } = sourceFixture();
  let canvasCommands = 0,
    clipboard = '';
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        async writeText(text) {
          clipboard = text;
        },
        async readText() {
          return clipboard;
        },
      },
    },
  });
  const ide = Object.assign(Object.create(IdeMenu.prototype), {
    s: {
      editor,
      command() {
        canvasCommands++;
      },
    },
    bar: { stack: [], host: document.createElement('nav') },
  });
  input.value = '<Grid><Button/></Grid>';
  editor.changed();
  input.setSelectionRange(6, 15);
  input.focus();
  await ide.runContext('cut');
  assert.equal(clipboard, '<Button/>');
  assert.equal(input.value, '<Grid></Grid>');
  assert.equal(canvasCommands, 0);
  await ide.runContext('undo');
  assert.equal(input.value, '<Grid><Button/></Grid>');
  assert.equal(canvasCommands, 0);
  await ide.runContext('select-all');
  assert.equal(input.selectionEnd, input.value.length);
});
test('generic brush color change keeps authored opacity and transforms', () => {
  installDockDOM();
  const store = new DocumentStore(
      parseXaml(
        '<Button><Button.Background><SolidColorBrush Color="Red" Opacity=".4"><SolidColorBrush.Transform><RotateTransform Angle="20"/></SolidColorBrush.Transform></SolidColorBrush></Button.Background></Button>',
      ),
    ),
    s = {
      get doc() {
        return store.document;
      },
      blend: { animation: { record: false } },
      setProps() {
        throw Error('Should preserve brush object');
      },
    },
    rich = Object.assign(Object.create(RichProperties.prototype), {
      s,
      mutate(label, fn) {
        store.transaction(label, fn);
      },
    });
  rich.commit([s.doc.root.id], 'Background', '#00FF00');
  const brush = propertyObject(s.doc.root, 'Background');
  assert.equal(brush.props.Color, '#00FF00');
  assert.equal(brush.props.Opacity, '.4');
  assert.equal(brush.children[0].children[0].props.Angle, '20');
  assert.equal(store.history.length, 1);
  store.undo();
  assert.equal(propertyObject(s.doc.root, 'Background').props.Color, 'Red');
});
test('folder selection prevents file-only solution actions from changing an unrelated document', () => {
  installDockDOM();
  let mutations = 0;
  const sol = Object.assign(Object.create(SolutionWorkspace.prototype), {
    folder: 'Views',
    selectedId: null,
    mutate() {
      mutations++;
    },
  });
  sol.remove();
  sol.duplicate();
  sol.setStartup();
  assert.equal(mutations, 0);
});
test('applying a replacement solution works when all documents change and the old active index is nonzero', () => {
  installDockDOM();
  const old = [parseXaml('<Grid/>'), parseXaml('<Canvas/>')],
    replacement = parseXaml('<StackPanel/>'),
    s = {
      stores: old.map((d) => new DocumentStore(d)),
      active: 1,
      get doc() {
        return this.stores[this.active].document;
      },
      blend: { animation: { stop() {} } },
      docking: { refreshing: false, syncDocuments() {}, control: { activate() {} } },
      editor: { dirty: false, setValue() {} },
      addStore(d) {
        assert.ok(this.doc);
        const st = new DocumentStore(d);
        this.stores.push(st);
        return st;
      },
      render() {
        assert.ok(this.doc);
      },
      save() {},
    };
  const sol = Object.assign(Object.create(SolutionWorkspace.prototype), { s });
  sol.apply({
    documents: [replacement],
    solution: createSolution([replacement]),
    activeId: replacement.id,
  });
  assert.equal(s.stores.length, 1);
  assert.equal(s.doc.id, replacement.id);
  assert.equal(s.active, 0);
});
test('view tiling aborts without dock changes when source guards reject activation', () => {
  let edits = 0;
  const board = Object.assign(Object.create(ViewBoard.prototype), {
    selected: new Set(['a', 'b']),
    s: {
      stores: [{ document: { id: 'a' } }, { document: { id: 'b' } }],
      docking: {
        model: {
          dock() {
            edits++;
          },
        },
      },
    },
    open() {
      return false;
    },
  });
  board.tile();
  assert.equal(edits, 0);
});
test('minimum-size hints compose through nested splits with a compact fallback', () => {
  const panels = new Map([
      ['a', { minWidth: 240, minHeight: 120 }],
      ['b', { minWidth: 300, minHeight: 100 }],
    ]),
    root = dockSplit('horizontal', dockGroup(['a']), dockGroup(['b']));
  assert.deepEqual(dockMinimum(root, panels), { width: 545, height: 172 });
  const [min, max] = dockRatioLimits(root, panels, 1005);
  assert.equal(min, 0.24);
  assert.equal(max, 0.7);
  assert.deepEqual(dockRatioLimits(root, panels, 400), [0.08, 0.92]);
});

test('solution resolver is ready when docking synchronously renders during panel registration', () => {
  installDockDOM();
  const documents = [
    parseXaml('<Grid/>', { name: 'MainView.xaml' }),
    parseXaml('<ResourceDictionary/>', { name: 'Resources.xaml' }),
  ];
  let resolvedDuringRegistration;
  const studio = {
    stores: documents.map((doc) => new DocumentStore(doc)),
    active: 0,
    get doc() {
      return this.stores[this.active].document;
    },
    renderer: {},
    render() {},
    save() {},
    addStore() {},
    switchDocument() {},
    docking: {
      originalSwitch() {},
      registerPanel() {
        assert.equal(typeof studio.solution.resolverFor, 'function');
        resolvedDuringRegistration = studio.solution.resolverFor(studio.doc)(
          'Resources.xaml',
          studio.doc.root,
        );
      },
    },
  };
  class MinimalSolution extends SolutionWorkspace {
    render() {}
  }
  new MinimalSolution(studio);
  assert.equal(resolvedDuringRegistration, studio.stores[1].document.root);
  assert.equal(
    studio.renderer.resourceResolver('Resources.xaml', studio.doc.root),
    resolvedDuringRegistration,
  );
});
