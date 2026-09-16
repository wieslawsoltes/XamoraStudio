import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { compileDocument } from '../dist/core/semantic-compiler.js';
import { walk } from '../dist/core/model.js';
const window = new Window(),
  Parser = window.DOMParser;
const html = (body, css = '') =>
  `<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`;
const fromHtml = (body, css = '', options = {}) =>
  compileDocument(html(body, css), { from: 'html', Parser, ...options });
const xml = (body) =>
  `<UserControl xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">${body}</UserControl>`;
function find(result, name) {
  let found;
  walk(result.document.root, (node) => {
    if (node.props?.['x:Name'] === name) found = node;
  });
  assert.ok(found, name + ': ' + result.diagnostics.map((d) => d.message).join('\n'));
  return found;
}
const native = (result) => new Parser().parseFromString(result.source, 'text/html');

test('uniform CSS boxes retain compact native thickness after cascade and unit conversion', () => {
  for (const framework of ['WPF', 'Avalonia']) {
    for (const style of [
      'padding:12px;margin:12px;border-width:12px',
      'padding:9pt 12px 0.125in 12px;margin:12px 12px;border-width:12px 12px 12px',
      'padding:1px;padding-top:12px;padding-right:12px;padding-bottom:12px;padding-left:12px;margin:12px;border-width:12px',
      '--space:12px;padding:var(--space);margin:var(--space);border-width:var(--space)',
    ]) {
      const result = fromHtml(`<button id="target" style="${style}">T</button>`, '', {
        framework,
        preserveMetadata: false,
      });
      assert.equal(result.success, true);
      for (const key of ['Padding', 'Margin', 'BorderThickness'])
        assert.equal(find(result, 'target').props[key], '12', `${framework} ${key}: ${style}`);
    }
  }
  const result = fromHtml('<button id="target" style="padding:0;margin:-2px">T</button>');
  assert.equal(find(result, 'target').props.Padding, '0');
  assert.equal(find(result, 'target').props.Margin, '-2');
});

test('nonuniform box edits win over a preserved compact native thickness', () => {
  const source = compileDocument(xml('<Button x:Name="target" Padding="12" Content="T"/>'));
  const parsed = native(source);
  parsed.getElementById('target').style.paddingLeft = '24px';
  const back = compileDocument(parsed.documentElement.outerHTML, { from: 'html', Parser });
  assert.equal(back.success, true);
  assert.equal(find(back, 'target').props.Padding, '24,12,12,12');
});
