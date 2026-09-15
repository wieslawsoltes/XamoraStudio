/** Structured, resource-aware XAML property paths used by authoring and animation. */
import {element,find,walk,parentOf,localName,isProperty,reidentify} from './model.js';
import {findResource} from './styling.js';

const XAML_NS='http://schemas.microsoft.com/winfx/2006/xaml';
const blocked = new Set(['__proto__','prototype','constructor']);
export function propertySegments(path) {
  const source=String(path||'').trim(); if(!source)throw Error('A property path is required.');
  if(/^(Canvas|Grid|DockPanel|Panel)\.[A-Za-z_]\w*$/.test(source)){const [owner,name]=source.split('.');if(blocked.has(name))throw Error('Invalid property path.');return [{owner,name}];}
  const tokens=[]; let token='',depth=0;
  for(const c of source){if(c==='(')depth++; if(c===')')depth--; if(depth<0)throw Error('Unbalanced property path.'); if(c==='.'&&depth===0){if(!token)throw Error('Invalid property path.');tokens.push(token);token='';}else token+=c;}
  if(depth||!token)throw Error('Invalid property path.');tokens.push(token);
  const result=[];
  for(let raw of tokens){const indexes=[...raw.matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1]));raw=raw.replace(/\[\d+\]/g,'');if(raw[0]==='('&&raw.at(-1)===')')raw=raw.slice(1,-1);const pieces=raw.split('.');if(pieces.length>2||!pieces.every(p=>/^[A-Za-z_][\w:]*$/.test(p)&&!blocked.has(p)))throw Error(`Unsupported property path: ${source}`);result.push({owner:pieces.length===2?pieces[0]:null,name:pieces.at(-1)});for(const index of indexes)result.push({index});}
  return result;
}
export function scopedResource(doc,node,key,resolveSource){return findResource(doc,node,key,resolveSource);}
function rootOf(doc){return doc?.root||doc;}
export function namedTarget(doc,name,scopeId=null) {
  const root=rootOf(doc),scope=scopeId&&typeof scopeId==='object'?scopeId:scopeId?find(root,scopeId):root;if(!scope)return null;if(!name)return scope;
  const hits=[];const inspect=n=>{if(n!==scope&&['ControlTemplate','DataTemplate','ItemsPanelTemplate'].includes(localName(n.type||'')))return;if(n.props?.['x:Name']===name||n.props?.Name===name)hits.push(n);for(const child of n.children||[])inspect(child);};inspect(scope);return hits.length===1?hits[0]:null;
}
export function ensureName(doc,node,prefix='Animated') {
  if(node.props['x:Name']||node.props.Name)return node.props['x:Name']||node.props.Name;
  const used=new Set();walk(rootOf(doc),n=>{if(n.props?.['x:Name'])used.add(n.props['x:Name']);if(n.props?.Name)used.add(n.props.Name);});let stem=String(prefix).replace(/[^A-Za-z0-9_]/g,'')||'Animated';if(!/^[A-Za-z_]/.test(stem))stem='Animated'+stem;let name=stem,i=1;while(used.has(name))name=stem+(i++);node.props['x:Name']=name;rootOf(doc).props['xmlns:x']??=XAML_NS;return name;
}
function directKey(node,segment){if(segment.owner&&['Canvas','Grid','DockPanel','Panel'].includes(localName(segment.owner)))return `${segment.owner}.${segment.name}`;if(segment.owner&&Object.hasOwn(node?.props||{},`${segment.owner}.${segment.name}`))return `${segment.owner}.${segment.name}`;return segment.name;}
function propertyNode(node,name){return node?.children?.find(c=>c.kind==='element'&&isProperty(c)&&localName(c.type).split('.').at(-1)===name);}
function objects(node){return (node?.children||[]).flatMap(c=>c.kind!=='element'?[]:isProperty(c)&&['Children','GradientStops'].includes(localName(c.type).split('.').at(-1))?objects(c):!isProperty(c)?[c]:[]);}
function defaultValue(name){if(['Opacity','ScaleX','ScaleY','ScaleZ','M11','M22'].includes(name))return '1';if(['IsEnabled','IsVisible'].includes(name))return 'True';if(name==='Visibility')return 'Visible';if(name==='RenderTransformOrigin')return '0,0';if(['Margin','Padding'].includes(name))return '0,0,0,0';if(['Background','Fill','Color'].includes(name))return '#00000000';return '0';}
function objectFor(doc,node,segment,next,create) {
  if('index'in segment)return objects(node)[segment.index]||null;
  if(['Children','GradientStops'].includes(segment.name))return propertyNode(node,segment.name)||node;
  let prop=propertyNode(node,segment.name),obj=prop&&objects(prop)[0];if(obj)return obj;
  const key=directKey(node,segment),value=node?.props?.[key];const resource=typeof value==='string'&&/^\{(?:StaticResource|DynamicResource)\s+([^}]+)\}$/.exec(value)?.[1];
  if(resource){const found=scopedResource(doc,node,resource.trim());if(found){if(!create)return found;obj=reidentify(found);delete obj.props['x:Key'];}}
  if(!create){if(value!==undefined&&['Background','Foreground','Fill','Stroke','BorderBrush'].includes(segment.name))return {kind:'element',type:'SolidColorBrush',props:{Color:String(value)},children:[]};return null;}
  if(!node?.children)throw Error('The property path has no writable owner.');
  if(!obj){let type=next?.owner?localName(next.owner):['Background','Foreground','Fill','Stroke','BorderBrush'].includes(segment.name)?'SolidColorBrush':segment.name==='RenderTransform'||segment.name==='LayoutTransform'?'TransformGroup':segment.name==='Effect'?'DropShadowEffect':segment.name;obj=element(type);if(type==='SolidColorBrush')obj.props.Color=value!==undefined&&!String(value).startsWith('{')?String(value):'#00000000';}
  if(!prop){prop=element(`${localName(node.type)}.${segment.name}`);node.children.push(prop);}prop.children=[obj];delete node.props[key];return obj;
}
export function readPropertyPath(doc,node,path) {
  const segments=propertySegments(path);let current=node;
  for(let i=0;i<segments.length;i++){const seg=segments[i];if(i===segments.length-1&&!('index'in seg)){if(!current)return defaultValue(seg.name);const key=directKey(current,seg);if(Object.hasOwn(current.props||{},key))return current.props[key];const valueNode=propertyNode(current,seg.name);if(valueNode){const value=objects(valueNode)[0];if(value?.props?.Color!==undefined)return value.props.Color;if(value?.text!==undefined)return value.text;const text=(valueNode.children||[]).filter(n=>n.kind==='text').map(n=>n.text).join('').trim();if(text)return text;}return defaultValue(seg.name);}current=objectFor(doc,current,seg,segments[i+1],false);}
  return current;
}
export function writePropertyPath(doc,node,path,value) {
  const segments=propertySegments(path);let current=node;
  for(let i=0;i<segments.length-1;i++){current=objectFor(doc,current,segments[i],segments[i+1],true);if(!current)throw Error('The indexed property path does not exist.');}
  const last=segments.at(-1);if('index'in last)throw Error('Animation paths must end in a property.');const key=directKey(current,last);if(value===null||value===undefined)delete current.props[key];else current.props[key]=String(value);const prop=propertyNode(current,last.name);if(prop)current.children=current.children.filter(c=>c!==prop);return node;
}
const transformDefaults={ScaleTransform:{ScaleX:'1',ScaleY:'1'},SkewTransform:{AngleX:'0',AngleY:'0'},RotateTransform:{Angle:'0'},TranslateTransform:{X:'0',Y:'0'}};
export function transformGroup(node,create=false,doc=null) {
  let prop=propertyNode(node,'RenderTransform'),existing=prop&&objects(prop)[0];
  if(!existing&&doc&&node.props.RenderTransform){const match=/^\{(?:StaticResource|DynamicResource)\s+([^}]+)\}$/.exec(node.props.RenderTransform);if(match){const found=scopedResource(doc,node,match[1].trim());if(found)existing=create?reidentify(found):found;}}
  if(localName(existing?.type||'')==='TransformGroup'){if(create&&!prop){delete existing.props['x:Key'];prop=element(`${localName(node.type)}.RenderTransform`,{},[existing]);node.children.push(prop);delete node.props.RenderTransform;}return existing;}
  if(!create)return existing||null;
  const group=element('TransformGroup',{},existing?[existing]:Object.entries(transformDefaults).map(([type,props])=>element(type,props)));if(existing)delete existing.props['x:Key'];if(!prop){prop=element(`${localName(node.type)}.RenderTransform`);node.children.push(prop);}prop.children=[group];delete node.props.RenderTransform;return group;
}
export const TRANSFORM_PATHS=Object.freeze({ScaleX:'(UIElement.RenderTransform).(TransformGroup.Children)[0].(ScaleTransform.ScaleX)',ScaleY:'(UIElement.RenderTransform).(TransformGroup.Children)[0].(ScaleTransform.ScaleY)',SkewX:'(UIElement.RenderTransform).(TransformGroup.Children)[1].(SkewTransform.AngleX)',SkewY:'(UIElement.RenderTransform).(TransformGroup.Children)[1].(SkewTransform.AngleY)',Angle:'(UIElement.RenderTransform).(TransformGroup.Children)[2].(RotateTransform.Angle)',X:'(UIElement.RenderTransform).(TransformGroup.Children)[3].(TranslateTransform.X)',Y:'(UIElement.RenderTransform).(TransformGroup.Children)[3].(TranslateTransform.Y)'});
export function ensureTransformPath(doc,node,requested) {
  let requestedPath=TRANSFORM_PATHS[requested]||String(requested);if(!requestedPath.includes('RenderTransform'))return requestedPath;
  const seg=propertySegments(requestedPath),last=seg.at(-1),type=last.owner&&localName(last.owner);if(!transformDefaults[type])return requestedPath;
  const group=transformGroup(node,true,doc);let children=objects(group),index=children.findIndex(n=>localName(n.type)===type);if(index<0){const wrapper=propertyNode(group,'Children')||group;wrapper.children.push(element(type,transformDefaults[type]));children=objects(group);index=children.length-1;}
  return `(UIElement.RenderTransform).(TransformGroup.Children)[${index}].(${type}.${last.name})`;
}
