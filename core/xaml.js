import {parseHtml,serializeHtml,htmlDiagnostics} from './html.js';
import {MOTION_TYPES} from './motion-schema.js';
import {motionDiagnostics} from './motion-diagnostics.js';
import {element,uid,localName,walk,clone,createDocument,isElement,validateDocument} from './model.js';
export const namespaces={WPF:'http://schemas.microsoft.com/winfx/2006/xaml/presentation',Avalonia:'https://github.com/avaloniaui',WinUI:'http://schemas.microsoft.com/winfx/2006/xaml/presentation',MAUI:'http://schemas.microsoft.com/dotnet/2021/maui'};
const X='http://schemas.microsoft.com/winfx/2006/xaml';
export const escapeXML=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\t/g,'&#9;').replace(/\r/g,'&#13;').replace(/\n/g,'&#10;');
const decode=s=>s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,(_,e)=>e[0]==='#'?String.fromCodePoint(parseInt(e.slice(e[1]==='x'?2:1),e[1]==='x'?16:10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[e]));
export class XamlError extends Error {constructor(message,source,index){const before=source.slice(0,index);super(message);this.line=before.split('\n').length;this.column=before.length-before.lastIndexOf('\n');this.name='XamlError';}}
/** Safe XML subset parser: preserves unknown nodes/markup extensions; never activates XAML. */
export function parseXaml(source,{name='MainView.xaml',framework}={}) {
  if(framework==='HTML'||/\.html?$/i.test(name))return parseHtml(source,{name});
  if(source.charCodeAt(0)===0xFEFF)source=source.slice(1);
  if(source.length>2_000_000)throw new XamlError('XAML is larger than the 2 MB import limit.',source,0);
  if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(source))throw new XamlError('Invalid XML character.',source,0);
  if(/<!DOCTYPE|<!ENTITY/i.test(source))throw new XamlError('Document types and entity declarations are not supported.',source,0);
  const holder={children:[],scope:{xml:'http://www.w3.org/XML/1998/namespace'}},stack=[holder];let i=0,count=0;
  const lineStarts=[0];for(let k=0;k<source.length;k++)if(source[k]==='\n')lineStarts.push(k+1);const lineAt=at=>{let lo=0,hi=lineStarts.length;while(lo<hi){const mid=(lo+hi)>>1;if(lineStarts[mid]<=at)lo=mid+1;else hi=mid;}return lo;};
  const fail=(m,at=i)=>{throw new XamlError(m,source,at);};
  const append=n=>{if(++count>15000)fail('Too many nodes.');stack.at(-1).children.push(n);};
  const checkEntities=s=>{for(const match of s.matchAll(/&#(x[0-9a-fA-F]+|\d+);/g)){const v=match[1],cp=parseInt(v[0]==='x'?v.slice(1):v,v[0]==='x'?16:10);if(!(cp===9||cp===10||cp===13||cp>=32&&cp<=0xD7FF||cp>=0xE000&&cp<=0xFFFD||cp>=0x10000&&cp<=0x10FFFF))fail('Invalid numeric character reference.');}if(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(s))fail('Unescaped & or unknown entity.');};
  while(i<source.length){
    if(source.startsWith('<!--',i)){const end=source.indexOf('-->',i+4);if(end<0)fail('Unclosed comment.');const value=source.slice(i+4,end);if(value.includes('--'))fail('Comments cannot contain --.');append({id:uid(),kind:'comment',text:value});i=end+3;continue;}
    if(source.startsWith('<![CDATA[',i)){if(stack.length===1)fail('CDATA must be inside the root element.');const end=source.indexOf(']]>',i+9);if(end<0)fail('Unclosed CDATA.');append({id:uid(),kind:'cdata',text:source.slice(i+9,end)});i=end+3;continue;}
    if(/^<\?xml(?:\s|\?>)/.test(source.slice(i))&&i!==0)fail('The XML declaration must be first.');
    if(source.startsWith('<?',i)){const end=source.indexOf('?>',i+2);if(end<0)fail('Unclosed processing instruction.');append({id:uid(),kind:'pi',text:source.slice(i+2,end)});i=end+2;continue;}
    if(source[i]!=='<'){let end=source.indexOf('<',i);if(end<0)end=source.length;const raw=source.slice(i,end);checkEntities(raw);if(raw.trim()||stack.at(-1).space==='preserve'||stack.length>1&&!raw.includes('\n'))append({id:uid(),kind:'text',text:decode(raw)});i=end;continue;}
    if(source.startsWith('</',i)){const m=source.slice(i).match(/^<\/\s*([\w.:-]+)\s*>/);if(!m)fail('Invalid closing tag.');if(stack.length===1||stack.at(-1).type!==m[1])fail(`Unexpected closing tag </${m[1]}>.`);stack.pop();i+=m[0].length;continue;}
    const start=i,m=source.slice(i).match(/^<([A-Za-z_][\w.:-]*)/);if(!m)fail('Expected an XML element.');i+=m[0].length;const node=element(m[1]);node.source={start,line:lineAt(start)};let closed=false;
    while(i<source.length){const ws=source.slice(i).match(/^\s*/)[0];i+=ws.length;if(source.startsWith('/>',i)){i+=2;closed=true;break;}if(source[i]==='>'){i++;break;}if(!ws)fail('Attributes must be separated by whitespace.');const a=source.slice(i).match(/^([A-Za-z_][\w.:-]*)\s*=\s*(["'])/);if(!a)fail('Expected a quoted attribute.');i+=a[0].length;const end=source.indexOf(a[2],i);if(end<0)fail(`Unclosed ${a[1]} attribute.`);if(Object.hasOwn(node.props,a[1]))fail(`Duplicate attribute ${a[1]}.`);const raw=source.slice(i,end);if(raw.includes('<'))fail('Escape < in attribute values.');checkEntities(raw);if(a[1].split(':').length>2)fail('Invalid qualified attribute name.');Object.defineProperty(node.props,a[1],{value:decode(raw.replace(/\r\n|[\r\n\t]/g,' ')),enumerable:true,writable:true,configurable:true});i=end+1;}
    if(i>=source.length&&!source.endsWith('>'))fail('Unclosed opening tag.');if(node.type.split(':').length>2)fail('Invalid qualified element name.');node.scope={...stack.at(-1).scope};for(const [k,v] of Object.entries(node.props))if(k==='xmlns')node.scope['']=v;else if(k.startsWith('xmlns:'))node.scope[k.slice(6)]=v;for(const k of [node.type,...Object.keys(node.props)])if(k.includes(':')&&!k.startsWith('xmlns:')&&!node.scope[k.split(':')[0]])fail('Undeclared namespace prefix '+k.split(':')[0]);node.namespaceURI=node.scope[node.type.includes(':')?node.type.split(':')[0]:'']||'';node.space=node.props['xml:space']||stack.at(-1).space;append(node);if(!closed){stack.push(node);if(stack.length>150)fail('XAML nesting exceeds 150 levels.');}
  }
  if(stack.length!==1)fail(`Unclosed <${stack.at(-1).type}>.`,source.length);
  const roots=holder.children.filter(isElement);if(roots.length!==1)fail('XAML must have exactly one root element.',0);
  if(holder.children.some(n=>n.kind==='text'&&n.text.trim()))fail('Text cannot appear outside the root.',0);
  const root=roots[0];const ns=root.namespaceURI||root.props.xmlns;const detected=ns===namespaces.Avalonia?'Avalonia':ns===namespaces.MAUI?'MAUI':'WPF';
  const doc=createDocument(root,framework||detected,name);doc.preamble=holder.children.slice(0,holder.children.indexOf(root));doc.postamble=holder.children.slice(holder.children.indexOf(root)+1);doc.design.width=Number(root.props.Width)||1100;doc.design.height=Number(root.props.Height)||760;try{validateDocument(doc);}catch(error){fail(error.message,0);}return doc;
}
const priority=k=>k==='xmlns'?0:k.startsWith('xmlns:')?1:k==='x:Class'?2:k==='x:Key'?3:k==='x:Name'||k==='Name'?4:k.startsWith('Grid.')||k.startsWith('Canvas.')||k.startsWith('DockPanel.')?5:6;
export function serializeNode(n,depth=0,{indent='    ',lineWidth=112}={}) {
  const pad=indent.repeat(depth);if(n.kind==='text')return pad+escapeXML(n.text);if(n.kind==='comment')return `${pad}<!--${n.text}-->`;if(n.kind==='cdata')return `${pad}<![CDATA[${n.text}]]>`;if(n.kind==='pi')return `${pad}<?${n.text}?>`;
  const entries=Object.entries(n.props).sort(([a],[b])=>priority(a)-priority(b));const attrs=entries.map(([k,v])=>`${k}="${escapeXML(v)}"`);let opening=pad+'<'+n.type;
  if(opening.length+attrs.join(' ').length>lineWidth&&attrs.length>2)opening+=attrs.map(a=>'\n'+pad+indent+a).join('');else if(attrs.length)opening+=' '+attrs.join(' ');
  if(!n.children.length)return opening+' />';
  if(n.children.some(c=>['text','cdata'].includes(c.kind))||n.space==='preserve')return opening+'>'+n.children.map(c=>c.kind==='text'?escapeXML(c.text):serializeNode(c,0,{indent,lineWidth:Infinity})).join('')+`</${n.type}>`;
  return opening+'>\n'+n.children.map(c=>serializeNode(c,depth+1,{indent,lineWidth})).join('\n')+`\n${pad}</${n.type}>`;
}
export function serializeXaml(doc,{framework=doc.framework,...format}={}) {
  if(doc.framework==='HTML')return serializeHtml(doc);
  const root=clone(doc.root);if(framework!==doc.framework){const old=namespaces[doc.framework];for(const key of Object.keys(root.props))if((key==='xmlns'||key.startsWith('xmlns:'))&&root.props[key]===old)root.props[key]=namespaces[framework]||root.props[key];adaptCommon(root,doc.framework,framework);}
  return [...(doc.preamble||[]).map(n=>serializeNode(n,0,format)),serializeNode(root,0,format),...(doc.postamble||[]).map(n=>serializeNode(n,0,format))].join('\n')+'\n';
}
function adaptCommon(root,from,to){walk(root,n=>{if(!isElement(n))return;const p=n.props;
  if(to==='Avalonia'&&p.Visibility!==undefined&&!String(p.Visibility).startsWith('{')&&p.Visibility!=='Hidden'){p.IsVisible=p.Visibility==='Visible'?'True':'False';delete p.Visibility;}
  if(to==='WPF'){if(p.IsVisible!==undefined&&!String(p.IsVisible).startsWith('{')){p.Visibility=String(p.IsVisible).toLowerCase()==='false'?'Collapsed':'Visible';delete p.IsVisible;}if(localName(n.type)==='Grid'){for(const axis of ['Row','Column']){const key=`${axis}Definitions`;if(p[key]){n.children.unshift(element(`Grid.${key}`,{},String(p[key]).split(',').map(v=>element(`${axis}Definition`,{[axis==='Row'?'Height':'Width']:v.trim()}))));delete p[key];}}}}
});}
export function diagnostics(doc,registry){if(doc.framework==='HTML')return htmlDiagnostics(doc);const list=[],names=new Map();walk(doc.root,(n,p)=>{if(!isElement(n))return;const t=localName(n.type),line=n.source?.line||1;const add=(severity,message)=>list.push({id:n.id,line,severity,message});const name=n.props['x:Name']||n.props.Name;if(name){if(names.has(name))add('warning',`Duplicate name “${name}”; verify template namescopes.`);names.set(name,n.id);}if(!registry.get(n.type,n.namespaceURI)&&!t.includes('.')&&!MOTION_TYPES.includes(t)&&!['SolidColorBrush','Color','Double','String','Style','Setter','ControlTheme','ControlTemplate','DataTemplate','ResourceDictionary','RowDefinition','ColumnDefinition','Trigger','MultiTrigger','DataTrigger','Condition'].includes(t))add('info',`${n.type} is preserved; register a toolkit renderer for an accurate preview.`);
  for(const k of ['Width','Height','MinWidth','MinHeight','MaxWidth','MaxHeight']){const v=n.props[k];if(v!==undefined&&!String(v).startsWith('{')&&v!=='Auto'&&(!Number.isFinite(Number(v))||Number(v)<0))add('error',`${k} must be a nonnegative number, Auto, or a markup extension.`);}
  if(doc.framework==='WPF'&&n.props.Spacing!==undefined)add('warning','WPF StackPanel has no Spacing property. Use child margins.');
  if(doc.framework==='WPF'&&(n.props.RowDefinitions||n.props.ColumnDefinitions))add('warning','Use explicit Grid definition elements for broad WPF version compatibility.');
  if(doc.framework==='WPF'&&t==='ControlTheme')add('warning','ControlTheme is Avalonia-specific; use a WPF Style with a template setter.');
  if(doc.framework==='Avalonia'&&Object.keys(n.props).some(k=>k==='Visibility'))add('warning','Avalonia uses IsVisible instead of Visibility.');
  if(doc.framework==='WinUI'||doc.framework==='MAUI')add('info',`${doc.framework} is a preservation adapter; native semantics are not validated.`);
  const descriptor=registry.get(n.type,n.namespaceURI);if(descriptor?.singleChild&&n.children.filter(c=>isElement(c)&&!localName(c.type).includes('.')).length>1)add('error',`${n.type} accepts only one visual child.`);
  const xmlns=Object.fromEntries(Object.entries(n.scope||{}).map(([k,v])=>['xmlns:'+k,v]));Object.assign(xmlns,doc.root.props);for(const name of [n.type,...Object.keys(n.props)])if(name.includes(':')&&!name.startsWith('xmlns:')){const prefix=name.split(':')[0];if(prefix!=='xml'&&!xmlns[`xmlns:${prefix}`]&&!n.props[`xmlns:${prefix}`])add('warning',`Namespace prefix ${prefix} is not declared on the root or element.`);}
});return list.concat(motionDiagnostics(doc));}
export function newRoot(type='UserControl',framework='WPF'){return element(type,{xmlns:namespaces[framework]||namespaces.WPF,'xmlns:x':X,Width:'1100',Height:'760',Background:'#FFFFFF'});}
