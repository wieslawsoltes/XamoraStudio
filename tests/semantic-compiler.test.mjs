import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {compileDocument,attachCompiledInteractions} from '../dist/core/semantic-compiler.js';
import {parseXaml} from '../dist/core/xaml.js';
import {parseHtml} from '../dist/core/html.js';
import {element,walk} from '../dist/core/model.js';
const window=new Window(),Parser=window.DOMParser;
const xml=body=>`<UserControl xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">${body}</UserControl>`;
const html=body=>`<!DOCTYPE html><html><head></head><body>${body}</body></html>`;
const fromHtml=(source,options={})=>compileDocument(source,{from:'html',Parser,...options});
const find=(document,type)=>{let result;walk(document.root,node=>{if(node.type===type&&!result)result=node;});return result;};
const native=result=>new Parser().parseFromString(result.source,'text/html');

test('compiles fixed grid tracks, spans, attached placement and source ranges',()=>{
 const source=xml('<Grid><Grid.ColumnDefinitions><ColumnDefinition Width="80"/><ColumnDefinition Width="2*"/></Grid.ColumnDefinitions><Button x:Name="ok" Grid.Column="1" Grid.RowSpan="2" Width="120" Content="Save"/></Grid>');
 const result=compileDocument(source);assert.equal(result.success,true);const dom=native(result),button=dom.querySelector('button');assert.equal(button.textContent,'Save');assert.equal(button.style.gridColumn,'2');assert.equal(button.style.gridRow,'1 / span 2');assert.equal(button.style.width,'120px');assert.match(dom.querySelector('[style*="display: grid"]').style.gridTemplateColumns,/80px minmax\(0, 2fr\)/);
 for(const map of result.sourceMap){if(!map.targetRange)continue;assert.equal(result.source[map.targetRange.start],'<');if(map.sourceRange)assert.equal(source[map.sourceRange.start],'<');}
 assert.equal(parseXaml(source).root.type,'UserControl');
});
test('stack, wrap, canvas and border defaults follow preview layout conventions',()=>{
 const result=compileDocument(xml('<StackPanel Height="80"><WrapPanel><Button Width="100"/></WrapPanel><Canvas><Border Canvas.Left="5" Canvas.Right="9" Canvas.Top="6" Canvas.Bottom="8"/></Canvas></StackPanel>'));
 const dom=native(result),wrap=dom.querySelector('[style*="flex-wrap"]'),border=dom.querySelector('[style*="border-style"]');assert.equal(wrap.style.flexDirection,'row');assert.equal(wrap.style.flexShrink,'0');assert.equal(border.style.left,'5px');assert.equal(border.style.right,'');assert.equal(border.style.top,'6px');assert.equal(border.style.bottom,'');assert.equal(border.style.borderWidth,'0px');
});
test('scoped resources and implicit style scalar setters are reused from the designer',()=>{
 const source=xml('<UserControl.Resources><SolidColorBrush x:Key="Accent" Color="#FFAA0000"/><Style TargetType="Button"><Setter Property="Padding" Value="8,4"/><Setter Property="Background" Value="{StaticResource Accent}"/></Style></UserControl.Resources><StackPanel><Button Content="Outer"/><StackPanel><StackPanel.Resources><SolidColorBrush x:Key="Accent" Color="#FF00AA00"/></StackPanel.Resources><Button Content="Inner"/></StackPanel></StackPanel>');
 const result=compileDocument(source);assert.equal(result.success,true);const buttons=native(result).querySelectorAll('button');assert.match(buttons[0].getAttribute('style'),/#AA0000FF/i);assert.match(buttons[1].getAttribute('style'),/#00AA00FF/i);assert.equal(buttons[0].style.padding,'4px 8px');
});
test('dynamic resources and unsupported templates have explicit behavioral losses',()=>{
 const result=compileDocument(xml('<UserControl.Resources><SolidColorBrush x:Key="Accent" Color="Red"/></UserControl.Resources><Button Background="{DynamicResource Accent}"><Button.Template><ControlTemplate><Border/></ControlTemplate></Button.Template></Button>'),{strict:true});assert.equal(result.success,false);assert.ok(result.losses.some(d=>d.code==='DYNAMIC_RESOURCE'));assert.ok(result.losses.some(d=>d.code==='PROPERTY_ELEMENT'));assert.ok(result.source.includes('<button'));
});
test('HTML static cascade includes specificity, important, descendant and inherited values',()=>{
 const result=fromHtml('<html><head><style>body { color: #abcdef; } .card {display:grid;grid-template-columns:80px 1fr;padding:4px} button {width:10px!important} #save {width:20px} .card > button {height:30px}</style></head><body><main class="card"><button id="save" style="width:40px">Save</button></main></body></html>');
 assert.equal(result.success,true);const button=find(result.document,'Button');assert.equal(button.props.Width,'10');assert.equal(button.props.Height,'30');assert.equal(button.props.Foreground,'#abcdef');assert.equal(find(result.document,'ColumnDefinition').props.Width,'80');
});
test('unknown selectors, relative CSS values and external stylesheets are reported',()=>{
 const result=fromHtml('<html><head><link rel="stylesheet" href="site.css"><style>button:hover {color:red} @media(max-width:800px){button{width:40px}}</style></head><body><button style="width:50%;filter:blur(2px)">Hi</button></body></html>',{strict:true});assert.equal(result.success,false);for(const code of ['EXTERNAL_CSS','DYNAMIC_SELECTOR','CONDITIONAL_CSS','CSS_VALUE','CSS_PROPERTY'])assert.ok(result.losses.some(d=>d.code===code),code);
});
test('XAML to HTML and back applies edited properties and text while retaining unknowns',()=>{
 const result=compileDocument(xml('<Button Width="100" Content="Before" Tag="retained" CustomProperty="future"/>'));
 const edited=result.source.replace('width: 100px','width: 160px').replace('>Before<','>After<'),back=fromHtml(edited);assert.equal(back.success,true);const button=find(back.document,'Button');assert.equal(button.props.Width,'160');assert.equal(button.props.Content,'After');assert.equal(button.props.CustomProperty,'future');assert.equal(button.props.Tag,'retained');assert.match(back.document.root.props['mc:Ignorable'],/web/);assert.ok(back.document.root.props['xmlns:mc']);
});
test('checkbox and radio caption stays visible and reverses edits',()=>{
 for(const type of ['CheckBox','RadioButton']){const result=compileDocument(xml(`<${type} Content="Remember me" IsChecked="True"/>`));const dom=native(result),label=dom.querySelector('label'),input=label.querySelector('input');assert.equal(label.textContent,'Remember me');assert.equal(input.checked,true);const back=fromHtml(result.source.replace('>Remember me<','>Changed caption<'));assert.equal(find(back.document,type).props.Content,'Changed caption');assert.equal(find(back.document,type).props.IsChecked,'True');}
});
test('HTML metadata restores native tag/class/CSS while reflecting XAML scalar edits',()=>{
 const first=fromHtml(html('<section class="card" data-custom="yes" style="width:100px;filter:contrast(2)"><button>Go</button></section>'));const root=first.document.root;root.props.Width='170';const second=compileDocument(first.document);assert.equal(second.success,true);const section=native(second).querySelector('section');assert.equal(section.className,'card');assert.equal(section.getAttribute('data-custom'),'yes');assert.equal(section.style.width,'170px');assert.equal(section.style.filter,'contrast(2)');
});
test('input values map to Text or Password without invalid Value properties',()=>{
 const result=fromHtml(html('<div><input value="hello"><input type="password" value="secret"></div>'));assert.equal(find(result.document,'TextBox').props.Text,'hello');assert.equal(find(result.document,'TextBox').props.Value,undefined);assert.equal(find(result.document,'PasswordBox').props.Password,'secret');
});
test('portable metadata remains optional and errors never mutate an AST',()=>{
 const doc=parseXaml(xml('<Button Future="1"/>')),snapshot=structuredClone(doc),result=compileDocument(doc,{preserveMetadata:false});assert.equal(result.success,true);assert.ok(result.losses.length);assert.ok(!result.source.includes('data-xamora-xaml'));assert.deepEqual(doc,snapshot);assert.equal(compileDocument('<Grid>').success,false);assert.equal(compileDocument(doc,{framework:'MAUI'}).success,false);
});
test('untrusted portable metadata has validation diagnostics instead of exceptions',()=>{
 const result=fromHtml(html('<div data-xamora-xaml="invalid">hello</div>'));assert.equal(result.success,true);assert.ok(result.diagnostics.some(d=>d.code==='INVALID_METADATA'));
});
test('HTML scripts and active handlers remain inert unless explicitly restored',()=>{
 const first=fromHtml('<html onclick="window.bad=1"><head><script>window.bad=2</script></head><body><div onclick="window.bad=3"><iframe srcdoc="&lt;script&gt;window.bad=4&lt;/script&gt;"></iframe><a href="javascript:window.bad=5">Go</a></div><script>window.bad=6</script></body></html>');assert.ok(first.losses.some(d=>d.code==='SCRIPT_PRESERVED'));const second=compileDocument(first.document),dom=native(second);assert.equal(dom.querySelector('script'),null);assert.equal(dom.documentElement.getAttribute('onclick'),null);assert.equal(dom.querySelector('[onclick]'),null);assert.equal(dom.querySelector('iframe').getAttribute('srcdoc'),null);assert.equal(dom.querySelector('a').getAttribute('href'),null);const explicit=native(compileDocument(first.document,{allowScripts:true}));assert.ok(explicit.querySelector('script'));
});
test('plugins extend semantic mappings using the shared AST',()=>{
 const result=compileDocument(xml('<FancyBadge Text="New"/>'),{plugins:[{name:'badge',xamlToHtml(node){if(node.type==='FancyBadge')return element('mark',{},[{id:'badge_text',kind:'text',text:node.props.Text}]);}}]});assert.equal(result.success,true);assert.match(result.source,/<mark>New<\/mark>/);assert.ok(!result.losses.some(d=>d.code==='UNKNOWN_CONTROL'));
});
test('WPF storyboard emits stable paused CSS keyframes and complete auto-reverse cycles',()=>{
 const source=xml('<UserControl.Resources><Storyboard x:Key="Fade"><DoubleAnimation Storyboard.TargetName="target" Storyboard.TargetProperty="Opacity" From="0" To="1" Duration="0:00:02" AutoReverse="True" RepeatBehavior="2x"/></Storyboard></UserControl.Resources><Button x:Name="target" Content="Go"/>');const result=compileDocument(source),again=compileDocument(source);assert.equal(result.success,true);assert.match(result.source,/@keyframes xamora_Fade_1/);assert.match(native(result).querySelector('button').style.animation,/4 alternate.*paused/);assert.equal(result.source,again.source);
});
test('CSS inline animation imports numeric keyframes, repeats and Loaded activation',()=>{
 const result=fromHtml('<html><head><style>@keyframes fade {from {opacity:0} to {opacity:1}}</style></head><body><button style="animation:fade 2s linear 1s 4 alternate both">Go</button></body></html>');assert.equal(result.success,true);const track=find(result.document,'DoubleAnimationUsingKeyFrames');assert.ok(track);assert.equal(track.props.Duration,'0:00:02');assert.equal(track.props.BeginTime,'0:00:01');assert.equal(track.props.RepeatBehavior,'2x');assert.equal(track.props.AutoReverse,'True');assert.ok(find(result.document,'EventTrigger'));
});
test('CSS rotation animations use shared transform property paths',()=>{
 const result=fromHtml('<html><head><style>@keyframes spin {from {rotate:0deg} to {rotate:180deg}}</style></head><body><button style="animation:spin 1s linear">Go</button></body></html>');assert.equal(result.success,true);const track=find(result.document,'DoubleAnimationUsingKeyFrames');assert.match(track.props['Storyboard.TargetProperty'],/RotateTransform.Angle/);assert.ok(find(result.document,'RotateTransform'));
});
test('compiled interaction bridge resolves explicit handlers and refreshes simple binding paths',()=>{
 const result=compileDocument(xml('<StackPanel><TextBlock Text="{Binding title}"/><Button Click="increment" Content="Update"/></StackPanel>'));const container=window.document.createElement('div');container.innerHTML=native(result).body.innerHTML;const data={title:'Before'},bridge=attachCompiledInteractions(container,{data,handlers:{increment(){data.title='After';}}});assert.equal(container.querySelector('span').textContent,'Before');container.querySelector('button').click();assert.equal(container.querySelector('span').textContent,'After');bridge.dispose();data.title='Stable';container.querySelector('button').click();assert.equal(container.querySelector('span').textContent,'After');
});
test('CSS grid auto placement reserves explicit cells and materializes implicit native rows',()=>{
 const result=fromHtml(html('<div style="display:grid;grid-template-columns:100px 1fr"><button>A</button><button>B</button><button style="grid-column:2;grid-row:2">C</button><button>D</button></div>'));assert.equal(result.success,true);const buttons=[];walk(result.document.root,node=>{if(node.type==='Button')buttons.push(node);});assert.deepEqual(buttons.map(node=>[node.props['Grid.Row'],node.props['Grid.Column']]),[['0','0'],['0','1'],['1','1'],['1','0']]);assert.equal(find(result.document,'Grid.RowDefinitions').children.length,2);
});
test('strict mode rejects target-native property incompatibilities and Avalonia animation adapters',()=>{
 const native=fromHtml(html('<div style="display:grid;padding:20px"><button>Go</button></div>'),{strict:true});assert.equal(native.success,false);assert.ok(native.losses.some(d=>d.code==='NATIVE_PROPERTY'));
 const avalonia=fromHtml('<html><head><style>@keyframes fade{from{opacity:0}to{opacity:1}}</style></head><body><button style="animation:fade 1s linear">Go</button></body></html>',{framework:'Avalonia',strict:true});assert.equal(avalonia.success,false);assert.ok(avalonia.losses.some(d=>d.code==='TARGET_ANIMATION_ADAPTER'));assert.equal(find(avalonia.document,'Storyboard'),undefined);
});
test('portable namespace declarations do not overwrite application prefixes',()=>{
 const first=compileDocument('<UserControl xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:web="urn:company" xmlns:mc="urn:other"><web:Badge/></UserControl>'),back=fromHtml(first.source);assert.equal(back.success,true);assert.equal(back.document.root.props['xmlns:web'],'urn:company');assert.equal(back.document.root.props['xmlns:mc'],'urn:other');assert.equal(back.document.root.props['xmlns:web1'],'urn:xamora:web');assert.equal(compileDocument(back.source).success,true);
});
test('removing compiled grid columns does not resurrect old definitions from metadata',()=>{
 const first=compileDocument(xml('<Grid><Grid.ColumnDefinitions><ColumnDefinition Width="50" MinWidth="20"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions><Button/></Grid>'));
 const back=fromHtml(first.source.replace('grid-template-columns: 50px minmax(0, 1fr);',''));assert.equal(back.success,true);assert.equal(find(back.document,'Grid.ColumnDefinitions'),undefined);
});
