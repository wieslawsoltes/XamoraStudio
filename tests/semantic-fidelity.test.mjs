import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { compileDocument } from '../dist/core/semantic-compiler.js';
import { parseXaml } from '../dist/core/xaml.js';
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

test('CSS compact child, adjacent and general sibling combinators skip text and comments', () => {
  const result = fromHtml(
    '<main><button id="first">A</button> <!-- gap --> <button id="second">B</button><span></span><button id="third">C</button></main>',
    'main>button {width:80px} #first+button {height:30px} #first~button {opacity:.5}',
  );
  assert.equal(find(result, 'first').props.Width, '80');
  assert.equal(find(result, 'second').props.Height, '30');
  assert.equal(find(result, 'third').props.Height, undefined);
  assert.equal(find(result, 'third').props.Opacity, '.5');
});
test('CSS ancestor matching backtracks past a nearer nonmatching child relationship', () => {
  const result = fromHtml(
    '<main><section><div><section><button id="target">T</button></section></div></section></main>',
    'main>section button {width:37px}',
  );
  assert.equal(find(result, 'target').props.Width, '37');
});
test('selector strings retain commas, colons and combinators and support attribute operators', () => {
  const result = fromHtml(
    '<button id="target" data-token="a,b:c>+~" data-words="one two" lang="en-US">T</button>',
    '[data-token="a,b:c>+~"]{width:41px}[data-words~="two"]{height:42px}[lang|="EN" i]{opacity:.7}',
  );
  assert.equal(find(result, 'target').props.Width, '41');
  assert.equal(find(result, 'target').props.Height, '42');
  assert.equal(find(result, 'target').props.Opacity, '.7');
  assert.ok(!result.losses.some((d) => d.code === 'DYNAMIC_SELECTOR'));
});
test('CSS specificity compares columns without decimal carry or source-order overflow', () => {
  const classes = Array.from({ length: 12 }, (_, i) => 'c' + i);
  const result = fromHtml(
    `<button id="target" class="${classes.join(' ')}">T</button>`,
    '#target{width:71px}' +
      classes.map((c) => '.' + c).join('') +
      '{width:99px}' +
      'button{width:3px}'.repeat(1100),
  );
  assert.equal(find(result, 'target').props.Width, '71');
});
test('duplicate declarations retain important priority in both inline and stylesheet blocks', () => {
  const result = fromHtml(
    '<button id="a" style="width:21px !important;width:99px">A</button><button id="b">B</button>',
    '#b{width:31px !important;width:88px} button{width:100px}',
  );
  assert.equal(find(result, 'a').props.Width, '21');
  assert.equal(find(result, 'b').props.Width, '31');
});
test('inline important beats selector important and comments do not alter strings', () => {
  const result = fromHtml(
    '<button id="target" style="WIDTH:7px ! /* note */ important; font-family:\'A/*B*/C\'">T</button>',
    '#target{width:8px!important}',
  );
  assert.equal(find(result, 'target').props.Width, '7');
  assert.equal(find(result, 'target').props.FontFamily, "'A/*B*/C'");
});
test('margin and padding longhands cascade against shorthands before thickness lowering', () => {
  const result = fromHtml(
    '<button id="target" style="padding:1px 2px 3px 4px;padding-left:9px;margin-left:13px">T</button>',
    'button{padding-left:7px!important;margin:5px 6px}',
  );
  assert.equal(find(result, 'target').props.Padding, '7,1,2,3');
  assert.equal(find(result, 'target').props.Margin, '13,5,6,5');
});
test('variables resolve nested fallbacks, preserve case, and never replace quoted var text', () => {
  const result = fromHtml(
    '<button id="target" style="width:var(--Size);height:var(--size);padding:var(--absent,var(--pad, 2px 4px));font-family:\'var(--Size)\'">T</button>',
    ':root{--Size:15px;--size:25px}',
  );
  const p = find(result, 'target').props;
  assert.equal(p.Width, '15');
  assert.equal(p.Height, '25');
  assert.equal(p.Padding, '4,2,4,2');
  assert.equal(p.FontFamily, "'var(--Size)'");
});
test('custom properties inherit computed values rather than resolving again in a descendant', () => {
  const result = fromHtml(
    '<div style="--base:10px;--derived:var(--base)"><button id="target" style="--base:20px;width:var(--derived)">T</button></div>',
  );
  assert.equal(find(result, 'target').props.Width, '10');
});
test('CSS variable cycles include unused fallback references and fail to a usable fallback', () => {
  const result = fromHtml(
    '<button id="target" style="width:var(--a, 17px);height:var(--c, 19px)">T</button>',
    ':root{--ok:5px;--a:var(--ok,var(--b));--b:var(--a);--c:var(--c)}',
  );
  assert.equal(find(result, 'target').props.Width, '17');
  assert.equal(find(result, 'target').props.Height, '19');
});
test('initial custom properties mask inherited values for the full descendant chain', () => {
  const result = fromHtml(
    '<div style="--size:20px"><div style="--size:initial"><button id="target" style="width:var(--size, 9px)">T</button></div></div>',
  );
  assert.equal(find(result, 'target').props.Width, '9');
});
test('unset inherits only inherited CSS properties, unlike explicit inherit', () => {
  const result = fromHtml(
    '<div style="width:123px;color:red;padding:2px 3px"><button id="a" style="width:unset;color:unset;padding:inherit">A</button><button id="b" style="width:inherit">B</button></div>',
  );
  assert.equal(find(result, 'a').props.Width, 'Auto');
  assert.equal(find(result, 'a').props.Foreground, 'red');
  assert.equal(find(result, 'a').props.Padding, '3,2,3,2');
  assert.equal(find(result, 'b').props.Width, '123');
});
test('invalid variables reject strict conversion and use unset instead of reviving earlier declarations', () => {
  const result = fromHtml(
    '<button id="target" style="width:50px;width:var(--missing)">T</button>',
    '',
    { strict: true },
  );
  assert.equal(result.success, false);
  assert.equal(find(result, 'target').props.Width, 'Auto');
  assert.ok(result.losses.some((d) => d.code === 'CSS_VARIABLE'));
});
test('a deferred variable shorthand and a later longhand retain declaration precedence', () => {
  const result = fromHtml(
    '<button id="target" style="--box:1px 2px;padding:var(--box);padding-left:8px">T</button>',
  );
  assert.equal(find(result, 'target').props.Padding, '8,1,2,1');
});
test('CSS escaped identifiers match authored IDs without false pseudo parsing', () => {
  const result = fromHtml('<button id="name:part">T</button>', '#name\\:part{width:36px}');
  assert.equal(find(result, 'name:part').props.Width, '36');
});

test('mixed text, formatting, links, and line breaks keep their order without metadata', () => {
  const first = fromHtml(
    '<p id="text">Hello <strong>bold</strong> and <em>italic</em><br>then <a href="https://example.test">link</a>!</p>',
    '',
    { preserveMetadata: false },
  );
  assert.equal(first.success, true);
  const text = find(first, 'text');
  assert.equal(text.props.Text, undefined);
  assert.deepEqual(
    text.children.filter((c) => c.kind === 'element').map((c) => c.type),
    ['Bold', 'Italic', 'LineBreak', 'Hyperlink'],
  );
  assert.equal(first.losses.length, 0);
  const back = compileDocument(first.source, { preserveMetadata: false });
  const paragraph = native(back).getElementById('text');
  assert.equal(paragraph.textContent, 'Hello bold and italicthen link!');
  assert.equal(paragraph.querySelectorAll('br').length, 1);
  assert.equal(paragraph.querySelector('a').getAttribute('href'), 'https://example.test');
});
test('nested spans become native inline Spans rather than child TextBlocks', () => {
  const first = fromHtml(
    '<p id="text">One <span style="color:red">red <span>inner</span></span> end</p>',
    '',
    { preserveMetadata: false },
  );
  const n = find(first, 'text');
  assert.equal(n.children.find((c) => c.kind === 'element').type, 'Span');
  assert.equal(
    n.children.find((c) => c.kind === 'element').children.find((c) => c.kind === 'element').type,
    'Span',
  );
  assert.equal(first.losses.length, 0);
});
test('XAML Inlines property syntax lowers and round-trips without duplicating old inline objects', () => {
  const source = xml(
    '<TextBlock x:Name="text"><TextBlock.Inlines><Run Text="Before "/><Bold>bold</Bold><LineBreak/><Run Text="tail"/></TextBlock.Inlines></TextBlock>',
  );
  const first = compileDocument(source);
  assert.ok(!first.losses.some((d) => ['UNKNOWN_CONTROL', 'PROPERTY_ELEMENT'].includes(d.code)));
  const htmlDoc = native(first);
  assert.equal(htmlDoc.getElementById('text').textContent, 'Before boldtail');
  htmlDoc.querySelector('strong').textContent = 'edited';
  const second = compileDocument(htmlDoc.documentElement.outerHTML, { from: 'html', Parser });
  const third = native(compileDocument(second.source));
  assert.equal(third.getElementById('text').textContent, 'Before editedtail');
  assert.equal(third.querySelectorAll('strong').length, 1);
});
test('rich button content is a single native TextBlock and an unchanged synthetic host unwraps on return', () => {
  const first = fromHtml('<button id="target">Click <strong>here</strong> now</button>');
  const button = find(first, 'target');
  assert.equal(button.props.Content, undefined);
  assert.equal(button.children.length, 1);
  assert.equal(button.children[0].type, 'TextBlock');
  const back = native(compileDocument(first.source));
  assert.equal(back.getElementById('target').textContent, 'Click here now');
  assert.equal(back.querySelector('button>strong')?.textContent, 'here');
});
test('editing a rich synthetic text host retains its authored formatting instead of discarding it', () => {
  const first = fromHtml('<button id="target">Click <strong>here</strong></button>');
  find(first, 'target').children[0].props.Foreground = '#FF001122';
  const back = native(compileDocument(first.document));
  assert.ok(back.querySelector('button>span'));
  assert.equal(back.querySelector('button>span').style.color, '#001122FF');
});
test('preformatted content, repeated spaces and newlines survive XAML serialization and return', () => {
  const first = fromHtml('<pre id="text">one  two\n  three</pre>');
  assert.equal(find(first, 'text').props['xml:space'], 'preserve');
  assert.equal(find(first, 'text').props.TextWrapping, 'NoWrap');
  assert.equal(
    native(compileDocument(first.source)).querySelector('pre').textContent,
    'one  two\n  three',
  );
  const xaml = compileDocument(
    xml('<TextBlock x:Name="text" xml:space="preserve">one  <Bold>two</Bold>\n  three</TextBlock>'),
  );
  assert.equal(native(xaml).getElementById('text').style.whiteSpace, 'pre-wrap');
});
test('native multiline TextBox emits textarea and HTML textarea retains editable multiline content', () => {
  const first = compileDocument(
    xml('<TextBox x:Name="input" AcceptsReturn="True" Text="first&#10;second"/>'),
  );
  const doc = native(first);
  assert.equal(doc.getElementById('input').tagName, 'TEXTAREA');
  assert.equal(doc.getElementById('input').value, 'first\nsecond');
  const second = fromHtml('<textarea id="input" readonly>one\ntwo</textarea>');
  assert.equal(find(second, 'input').props.AcceptsReturn, 'True');
  assert.equal(find(second, 'input').props.IsReadOnly, 'True');
  assert.equal(native(compileDocument(second.source)).querySelector('textarea').value, 'one\ntwo');
});
test('single selection and radio group names are represented in native XAML and back', () => {
  const first = fromHtml(
    '<div><select id="choice"><option>one</option><option selected>two</option></select><input type="radio" id="radio" name="group" checked></div>',
  );
  assert.equal(find(first, 'choice').props.SelectedIndex, '1');
  assert.equal(find(first, 'radio').props.GroupName, 'group');
  const back = native(compileDocument(first.source));
  assert.equal(back.querySelector('select').selectedIndex, 1);
  assert.equal(back.querySelector('input[type=radio]').name, 'group');
  assert.equal(back.querySelector('input[type=radio]').checked, true);
  const xaml = compileDocument(
    xml(
      '<ComboBox SelectedIndex="1"><ComboBox.Items><ComboBoxItem Content="one"/><ComboBoxItem Content="two"/></ComboBox.Items></ComboBox>',
    ),
  );
  assert.equal(native(xaml).querySelector('select').selectedIndex, 1);
});
test('multiple selection is never silently claimed as equivalent to a native ComboBox', () => {
  const result = fromHtml(
    '<select multiple><option selected>A</option><option selected>B</option></select>',
    '',
    { strict: true },
  );
  assert.equal(result.success, false);
  assert.ok(result.losses.some((d) => d.code === 'MULTIPLE_SELECTION'));
});
test('rich headers use object syntax and retain summary formatting on return', () => {
  const first = fromHtml(
    '<details id="target" open><summary>Read <strong>this</strong></summary><p>Body</p></details>',
  );
  assert.equal(find(first, 'target').props.Header, undefined);
  assert.equal(find(first, 'target').children[0].type, 'Expander.Header');
  const back = native(compileDocument(first.source));
  assert.equal(back.querySelectorAll('summary').length, 1);
  assert.equal(back.querySelector('summary>strong').textContent, 'this');
});
test('absolute CSS units and RGB functions produce native numeric and ARGB values', () => {
  const first = fromHtml(
    '<button id="target" style="width:1in;height:2.54cm;font-size:12pt;padding:1mm 1pc;color:rgba(255, 0, 128, .5);background-color:rgb(0% 50% 100% / 25%)">T</button>',
  );
  const p = find(first, 'target').props;
  assert.equal(p.Width, '96');
  assert.equal(p.Height, '96');
  assert.equal(p.FontSize, '16');
  assert.equal(p.Foreground, '#80FF0080');
  assert.equal(p.Background, '#400080FF');
  assert.equal(p.Padding.split(',')[0], '16');
});
test('unsupported modern color spaces reject strict conversion instead of emitting invalid native colors', () => {
  const result = fromHtml('<button style="color:color(display-p3 1 0 0)">T</button>', '', {
    strict: true,
  });
  assert.equal(result.success, false);
  assert.ok(result.losses.some((d) => d.code === 'CSS_VALUE'));
});
test('unchanged XAML thickness spellings survive canonical CSS box expansion on reverse conversion', () => {
  const first = compileDocument(
    xml('<Button x:Name="target" Margin="4" Padding="2,6" Content="T"/>'),
  );
  const second = compileDocument(first.source, { from: 'html', Parser });
  assert.equal(find(second, 'target').props.Margin, '4');
  assert.equal(find(second, 'target').props.Padding, '2,6');
});

test('unchanged HTML inline CSS retains exact comments, fallback declarations and priority', () => {
  const style =
    '/* keep */ width : 23px !important; width:99px; --note:"var(--x)"; color:red; color:rgb(0 0 255);';
  const first = fromHtml(`<button id="target" style='${style}'>T</button>`);
  const back = native(compileDocument(first.source));
  assert.equal(back.getElementById('target').getAttribute('style'), style);
  find(first, 'target').props.Width = '45';
  const edited = native(compileDocument(first.document));
  const value = edited.getElementById('target').getAttribute('style');
  assert.match(value, /\/\* keep \*\//);
  assert.match(value, /color:red; color:rgb\(0 0 255\);/);
  assert.match(value, /width: 45px !important;/);
  assert.doesNotMatch(value, /99px/);
});
test('substitution never merges a number and identifier into a new dimension token', () => {
  const result = fromHtml('<button id="target" style="--n:10;width:var(--n)px">T</button>', '', {
    strict: true,
  });
  assert.equal(result.success, false);
  assert.notEqual(find(result, 'target').props.Width, '10');
  assert.ok(result.losses.some((d) => d.code === 'CSS_VALUE'));
});
test('explicit box longhand inheritance reads the parent computed component', () => {
  const result = fromHtml(
    '<div style="padding:2px 4px 6px 8px"><button id="target" style="padding:0;padding-left:inherit">T</button></div>',
  );
  assert.equal(find(result, 'target').props.Padding, '8,0,0,0');
});
test('whitespace collapses as one inline stream without merging words or keeping edge spaces', () => {
  const result = fromHtml(
    '<p id="target"> \n One   <b> bold </b>   next <i>word</i>  end  <br>  line </p>',
    '',
    { preserveMetadata: false },
  );
  const back = native(compileDocument(result.source, { preserveMetadata: false })).getElementById(
    'target',
  );
  assert.equal(back.textContent, 'One bold next word endline');
  assert.equal(back.querySelectorAll('br').length, 1);
});
test('CSS pre-line keeps line breaks while collapsing spaces across formatted runs', () => {
  const result = fromHtml(
    '<p id="target" style="white-space:pre-line">One   <b> bold </b>  \n  next  line\nlast</p>',
    '',
    { preserveMetadata: false },
  );
  const back = native(compileDocument(result.source, { preserveMetadata: false })).getElementById(
    'target',
  );
  assert.equal(back.textContent, 'One bold\nnext line\nlast');
});
test('style-supplied AcceptsReturn selects a real textarea using effective properties', () => {
  const result = compileDocument(
    xml(
      '<UserControl.Resources><Style x:Key="Multi" TargetType="TextBox"><Setter Property="AcceptsReturn" Value="True"/></Style></UserControl.Resources><TextBox x:Name="target" Style="{StaticResource Multi}" Text="a&#10;b"/>',
    ),
  );
  assert.equal(native(result).getElementById('target').tagName, 'TEXTAREA');
  assert.equal(native(result).getElementById('target').value, 'a\nb');
});
test('conversion leaves shared source AST unchanged and produces ranges for new inlines', () => {
  const source = xml(
    '<Button x:Name="target"><TextBlock>Hello <Bold>world</Bold></TextBlock></Button>',
  );
  const doc = parseXaml(source),
    before = JSON.stringify(doc);
  const result = compileDocument(doc);
  assert.equal(JSON.stringify(doc), before);
  assert.ok(
    result.sourceMap.every((m) => m.targetRange && m.targetRange.end > m.targetRange.start),
  );
  const back = compileDocument(result.source, { from: 'html', Parser });
  assert.equal(back.success, true);
  assert.ok(back.sourceMap.every((m) => m.sourceRange && m.targetRange));
});
test('edited selection changes the selected option rather than restoring its earlier baseline', () => {
  const first = fromHtml(
    '<select id="target"><option selected>A</option><option>B</option></select>',
  );
  find(first, 'target').props.SelectedIndex = '1';
  const back = compileDocument(first.document);
  assert.equal(native(back).getElementById('target').selectedIndex, 1);
  const again = compileDocument(back.source, { from: 'html', Parser });
  assert.equal(find(again, 'target').props.SelectedIndex, '1');
});

test('native inline formatting retains bold and italic defaults over inherited normal values', () => {
  const result = fromHtml(
    '<p style="font-weight:normal;font-style:normal">A <strong id="bold">B <strong id="heavy">C</strong></strong><em id="italic">D</em></p>',
    '',
    { preserveMetadata: false },
  );
  assert.equal(find(result, 'bold').props.FontWeight, '700');
  assert.equal(find(result, 'heavy').props.FontWeight, '900');
  assert.equal(find(result, 'italic').props.FontStyle, 'italic');
  assert.ok(!result.losses.some((d) => d.code === 'CSS_VALUE'));
});
test('authored inline font overrides beat defaults and relative weights become native numbers', () => {
  const result = fromHtml(
    '<p style="font-weight:700"><strong id="normal" style="font-weight:normal">A</strong><span id="lighter" style="font-weight:lighter">B</span></p>',
    '',
    { preserveMetadata: false },
  );
  assert.equal(find(result, 'normal').props.FontWeight, 'normal');
  assert.equal(find(result, 'lighter').props.FontWeight, '400');
});
test('XAML Bold defaults have fixed weight rather than HTML relative bolder weight', () => {
  const result = compileDocument(
    xml('<TextBlock FontWeight="Bold"><Bold x:Name="target">T</Bold></TextBlock>'),
    { preserveMetadata: false },
  );
  assert.match(native(result).getElementById('target').getAttribute('style'), /font-weight: bold;/);
});
