/** WPF-like style and resource evaluation for browser previews. Native objects remain authored XAML. */
import {clone,element,isElement,isProperty,localName,parentOf} from './model.js';
import {resolveBinding} from './design-data.js';

const resourceRef=value=>typeof value==='string'?value.match(/^\{(?:StaticResource|DynamicResource)\s+([^}]+)\}$/)?.[1]?.trim():null;
const childrenOf=(node,name)=>node.children?.flatMap(c=>isProperty(c)&&localName(c.type).endsWith('.'+name)?c.children:[c]).filter(isElement)||[];

/** Entries are ordered from low to high precedence: merged dictionaries, then local entries. */
export function resourceEntries(node,resolveSource,seen=new Set()) {
  if(!node||seen.has(node))return [];
  const next=new Set(seen);next.add(node);
  if(localName(node.type||'')!=='ResourceDictionary'){
    return (node.children||[]).filter(c=>isProperty(c)&&/\.(Resources|Styles)$/.test(c.type)).flatMap(property=>property.children.filter(isElement).flatMap(c=>localName(c.type)==='ResourceDictionary'?resourceEntries(c,resolveSource,next):[c]));
  }
  const out=[],source=node.props?.Source;
  if(source&&resolveSource&&!next.has('source:'+source)){
    const sourceSeen=new Set(next);sourceSeen.add('source:'+source);
    const loaded=resolveSource(source,node);
    const root=loaded?.root||loaded;
    if(root)out.push(...resourceEntries(root,resolveSource,sourceSeen));
  }
  for(const property of node.children||[])if(isProperty(property)&&property.type.endsWith('.MergedDictionaries'))for(const dictionary of property.children.filter(isElement))out.push(...resourceEntries(dictionary,resolveSource,next));
  out.push(...(node.children||[]).filter(c=>isElement(c)&&!isProperty(c)));
  return out;
}

function scopes(doc,node){const result=[],seen=new Set();let current=node;while(current&&!seen.has(current.id)){seen.add(current.id);result.push(current);current=parentOf(doc.root,current.id);}if(!result.some(n=>n.id===doc.root.id))result.push(doc.root);return result;}
export function findResource(doc,node,key,resolveSource){for(const scope of scopes(doc,node)){const entries=resourceEntries(scope,resolveSource);for(let i=entries.length-1;i>=0;i--)if(entries[i].props?.['x:Key']===key)return entries[i];}return undefined;}

function targetType(style){return String(style.props?.TargetType||style.props?.Selector||'').replace(/^\{x:Type\s+|\}$/g,'').trim();}
/** A local style replaces the implicit style. Only BasedOn supplies style inheritance. */
export function selectStyles(doc,node,resolveSource){
  for(const property of ['Style','Theme']){
    const explicit=node.props?.[property];
    if(explicit!==undefined){if(explicit==='{x:Null}')return [];const key=resourceRef(explicit),found=key&&findResource(doc,node,key,resolveSource);return found&&['Style','ControlTheme'].includes(localName(found.type))?[found]:[];}
    const inline=node.children?.find(c=>isProperty(c)&&c.type.endsWith('.'+property))?.children.find(c=>['Style','ControlTheme'].includes(localName(c.type||'')));
    if(inline)return [inline];
  }
  for(const scope of scopes(doc,node)){const entries=resourceEntries(scope,resolveSource);for(let i=entries.length-1;i>=0;i--){const candidate=entries[i];if(!['Style','ControlTheme'].includes(localName(candidate.type))||candidate.props['x:Key'])continue;const target=targetType(candidate);if(target===node.type||target===localName(node.type))return [candidate];}}
  return [];
}

export function setters(node){return childrenOf(node,'Setters').filter(c=>localName(c.type)==='Setter');}
export function setterValue(setter){if(setter.props?.Value!==undefined)return setter.props.Value;return setter.children?.find(c=>isProperty(c)&&c.type.endsWith('.Value'))?.children.find(isElement)||setter.children?.find(c=>isElement(c)&&!isProperty(c));}
export function triggerConditions(trigger){const type=localName(trigger.type||'');if(type==='Trigger'||type==='DataTrigger')return [trigger];if(type==='MultiTrigger'||type==='MultiDataTrigger')return childrenOf(trigger,'Conditions').filter(c=>localName(c.type)==='Condition');return [];}
function equalValue(a,b){if(a===b)return true;if(a==null||b==null)return a==null&&b==null;return String(a).toLowerCase()===String(b).toLowerCase();}
function transientProperties(transient,node){if(transient instanceof Map)return transient.get(node.id)||{};if(transient&&typeof transient==='object')return transient[node.id]&&typeof transient[node.id]==='object'?transient[node.id]:transient;return {};}

/** Return a cloned effective node, so setters never mutate document or shared brush resources. */
export function resolveStyle(doc,node,{context={},root=context,transient={},resolveSource}={}){
  const effective=clone(node),properties={},objects=new Map(),triggers=[],active=[];
  const visited=new Set(),styles=[];
  const collect=style=>{if(!style||visited.has(style.id))return;visited.add(style.id);const base=resourceRef(style.props?.BasedOn);if(base)collect(findResource(doc,node,base,resolveSource));styles.push(style);};
  selectStyles(doc,node,resolveSource).forEach(collect);
  const apply=setter=>{const property=setter.props?.Property,target=setter.props?.TargetName;if(!property||target&&target!==(node.props['x:Name']||node.props.Name))return;const value=setterValue(setter);if(isElement(value)){objects.set(property,clone(value));delete properties[property];}else if(value!==undefined){properties[property]=value;objects.delete(property);}};
  for(const style of styles){setters(style).forEach(apply);triggers.push(...(style.children||[]).filter(c=>isProperty(c)&&c.type.endsWith('.Triggers')).flatMap(c=>c.children.filter(isElement)));}
  triggers.push(...(node.children||[]).filter(c=>isProperty(c)&&c.type.endsWith('.Triggers')).flatMap(c=>c.children.filter(isElement)));
  const state={IsMouseOver:false,IsPressed:false,IsFocused:false,IsKeyboardFocused:false,IsKeyboardFocusWithin:false,IsEnabled:true,IsChecked:false,IsSelected:false,...properties,...node.props,...transientProperties(transient,node)};
  for(const trigger of triggers){const conditions=triggerConditions(trigger);if(!conditions.length)continue;const matches=conditions.every(condition=>{
    const p=condition.props;if(p.SourceName&&p.SourceName!==(node.props['x:Name']||node.props.Name))return false;
    const actual=p.Binding!==undefined?resolveBinding(p.Binding,context,root):state[p.Property];
    return equalValue(actual,p.Value);
  });if(matches){active.push(trigger);setters(trigger).forEach(apply);}}
  // Local attributes and local property elements have higher precedence than style setters/triggers.
  Object.assign(properties,node.props,transientProperties(transient,node));
  for(const child of node.children||[])if(isProperty(child)){const property=localName(child.type).split('.').at(-1);if(!Object.hasOwn(node.props,property))delete properties[property];}
  for(const [property,value] of objects){if(Object.hasOwn(node.props,property)||node.children.some(c=>isProperty(c)&&c.type.endsWith('.'+property)))continue;effective.children.push(element(localName(node.type)+'.'+property,{},[value]));}
  effective.props={...properties};
  return {properties,node:effective,triggers,active};
}

export const DESIGN_NAMESPACE='http://schemas.microsoft.com/expression/blend/2008';
export function ensureDesignNamespace(doc){const root=doc.root;let prefix=Object.keys(root.props).find(k=>k.startsWith('xmlns:')&&root.props[k]===DESIGN_NAMESPACE)?.slice(6);if(!prefix){prefix='d';let i=1;while(root.props['xmlns:'+prefix]&&root.props['xmlns:'+prefix]!==DESIGN_NAMESPACE)prefix='d'+i++;root.props['xmlns:'+prefix]=DESIGN_NAMESPACE;}let mc=Object.keys(root.props).find(k=>k.startsWith('xmlns:')&&root.props[k]==='http://schemas.openxmlformats.org/markup-compatibility/2006')?.slice(6);if(!mc){mc='mc';let i=1;while(root.props['xmlns:'+mc])mc='mc'+i++;root.props['xmlns:'+mc]='http://schemas.openxmlformats.org/markup-compatibility/2006';}const key=mc+':Ignorable',tokens=new Set(String(root.props[key]||'').split(/\s+/).filter(Boolean));tokens.add(prefix);root.props[key]=[...tokens].join(' ');return prefix;}
