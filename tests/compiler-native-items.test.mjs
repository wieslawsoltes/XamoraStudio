import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { compileDocument } from '../dist/core/semantic-compiler.js';
import { compileRenderedDocument } from '../dist/core/compiler-browser.js';
import { walk } from '../dist/core/model.js';

function named(result, name) {
  let found;
  walk(result.document.root, (node) => {
    if (node.props?.['x:Name'] === name) found = node;
  });
  assert(found, name);
  return found;
}
for (const framework of ['WPF', 'Avalonia']) {
  test(`${framework} selector text layout belongs to item text hosts and preserves overrides`, (t) => {
    const window = new Window();
    t.after(() => window.close());
    const result = compileDocument(
      '<html><body><select id="choice" style="text-align:right;white-space:pre-wrap"><option id="first" value="a">Alpha</option><option id="second" selected style="text-align:center">Beta</option></select></body></html>',
      { from: 'html', Parser: window.DOMParser, framework },
    );
    assert(result.success, JSON.stringify(result.diagnostics));
    const choice = named(result, 'choice');
    assert.equal(choice.props.SelectedIndex, '1');
    assert.equal(choice.children.filter((n) => n.kind === 'element').length, 2);
    for (const key of ['TextAlignment', 'TextWrapping', 'TextDecorations'])
      assert.equal(choice.props[key], undefined);
    for (const [id, alignment, label] of [
      ['first', 'Right', 'Alpha'],
      ['second', 'Center', 'Beta'],
    ]) {
      const item = named(result, id);
      assert.equal(item.type, 'ComboBoxItem');
      assert.equal(item.children.length, 1);
      assert.equal(item.children[0].type, 'TextBlock');
      assert.equal(item.children[0].props.TextAlignment, alignment);
      assert.equal(item.children[0].props.TextWrapping, 'Wrap');
      assert.equal(item.children[0].props.Text, label);
    }
    const reverse = compileDocument(result.document, { to: 'html' });
    const html = new window.DOMParser().parseFromString(reverse.source, 'text/html');
    assert.equal(html.getElementById('choice').style.textAlign, 'right');
    assert.deepEqual(
      [...html.querySelectorAll('option')].map((item) => item.textContent),
      ['Alpha', 'Beta'],
    );
    assert.equal(html.getElementById('first').getAttribute('value'), 'a');
    assert.equal(html.getElementById('second').hasAttribute('selected'), true);
  });
  test(`${framework} captured empty selection retains only native-owned selector properties`, (t) => {
    const window = new Window();
    t.after(() => window.close());
    window.document.body.innerHTML =
      '<main><select id="choice" style="text-align:right;white-space:normal"><option id="item">Item</option></select><select id="empty" style="text-align:center"></select></main>';
    window.document.getElementById('choice').selectedIndex = -1;
    for (const preserveMetadata of [true, false]) {
      const result = compileRenderedDocument(window.document.body.firstElementChild, {
        framework,
        preserveMetadata,
      });
      assert(result.success, JSON.stringify(result.diagnostics));
      for (const id of ['choice', 'empty']) {
        const selector = named(result, id);
        assert.equal(selector.props.TextAlignment, undefined);
        assert.equal(selector.props.TextWrapping, undefined);
        assert.equal(selector.props.SelectedIndex, '-1');
      }
      assert.equal(named(result, 'empty').children.length, 0);
      assert.equal(named(result, 'item').children[0].props.TextAlignment, 'Right');
    }
  });
}
