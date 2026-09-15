import {isElement,isProperty,localName,parentOf,walk} from './model.js';
import {findResource,DESIGN_NAMESPACE} from './styling.js';
const numeric=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
const point=(value,fallback=[0,0])=>{const parts=String(value??'').split(/[,\s]+/).map(Number);return parts.length>=2&&parts.every(Number.isFinite)?parts.slice(0,2):fallback;};
const cssColor=value=>typeof value==='string'&&/^#[0-9a-f]{8}$/i.test(value)?'#'+value.slice(3)+value.slice(1,3):String(value??'');
export const identity=()=>[1,0,0,1,0,0];
/** Affine matrices use DOM/SVG [a,b,c,d,e,f] convention; multiply(a,b) applies b first. */
export function multiply(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
const translation=(x,y)=>[1,0,0,1,x,y];
export function transformMatrix(node){if(!node)return identity();const p=node.props||{},type=localName(node.type||'');if(type==='TransformGroup'){return (node.children||[]).flatMap(c=>isProperty(c)&&c.type.endsWith('.Children')?c.children:[c]).filter(isElement).reduce((matrix,child)=>multiply(transformMatrix(child),matrix),identity());}
  const cx=numeric(p.CenterX),cy=numeric(p.CenterY);let matrix=identity();
  if(type==='TranslateTransform')return translation(numeric(p.X),numeric(p.Y));
  if(type==='ScaleTransform')matrix=[numeric(p.ScaleX,1),0,0,numeric(p.ScaleY,1),0,0];
  else if(type==='RotateTransform'){const angle=numeric(p.Angle)*Math.PI/180;matrix=[Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),0,0];}
  else if(type==='SkewTransform')matrix=[1,Math.tan(numeric(p.AngleY)*Math.PI/180),Math.tan(numeric(p.AngleX)*Math.PI/180),1,0,0];
  else if(type==='MatrixTransform'){const values=String(p.Matrix||'1,0,0,1,0,0').split(/[,\s]+/).map(Number);return values.length===6&&values.every(Number.isFinite)?values:identity();}
  return multiply(translation(cx,cy),multiply(matrix,translation(-cx,-cy)));
}
function propertyObject(node,name){return node.children?.find(c=>isProperty(c)&&c.type.endsWith('.'+name))?.children.find(isElement);}
export function brushNode(doc,node,property){const direct=propertyObject(node,property);if(direct)return direct;const key=String(node.props?.[property]||'').match(/^\{(?:StaticResource|DynamicResource)\s+([^}]+)\}$/)?.[1];return key?findResource(doc,node,key):undefined;}
function stopsOf(brush){return (brush.children||[]).flatMap(c=>isProperty(c)&&c.type.endsWith('.GradientStops')?c.children:[c]).filter(c=>localName(c.type||'')==='GradientStop').map(c=>({offset:numeric(c.props.Offset),color:cssColor(c.props.Color||'Transparent')})).sort((a,b)=>a.offset-b.offset);}
export function brushCSS(brush){if(!brush)return '';const p=brush.props||{},type=localName(brush.type||'');if(type==='SolidColorBrush')return cssColor(p.Color||'Transparent');const stops=stopsOf(brush).map(s=>`${s.color} ${s.offset*100}%`).join(',');if(!stops)return '';const repeat=p.SpreadMethod==='Repeat'?'repeating-':'';if(type==='LinearGradientBrush'){const start=point(p.StartPoint,[0,0]),end=point(p.EndPoint,[1,1]),angle=Math.atan2(end[0]-start[0],start[1]-end[1])*180/Math.PI;return `${repeat}linear-gradient(${angle}deg,${stops})`;}
  if(type==='RadialGradientBrush'){const center=point(p.Center,[.5,.5]);return `${repeat}radial-gradient(ellipse ${numeric(p.RadiusX,.5)*100}% ${numeric(p.RadiusY,.5)*100}% at ${center[0]*100}% ${center[1]*100}%,${stops})`;}
  return '';
}
function box(value){const a=String(value).split(/[,\s]+/).map(v=>numeric(v));return (a.length===1?[a[0],a[0],a[0],a[0]]:a.length===2?[a[1],a[0],a[1],a[0]]:[a[1]||0,a[2]||0,a[3]||0,a[0]||0]).map(n=>n+'px').join(' ');}
/** Apply appearance only. Canvas anchors are handled by the parent-aware renderer. */
export function applyAppearance(el,node,doc,properties=node.props){const s=el.style,p=properties||{},transform=propertyObject(node,'RenderTransform');if(transform){s.transform=`matrix(${transformMatrix(transform).map(n=>Math.abs(n)<1e-12?0:n).join(',')})`;const origin=point(p.RenderTransformOrigin,[0,0]);s.transformOrigin=origin.map(n=>n*100+'%').join(' ');}
  if(p.Opacity!==undefined&&Number.isFinite(Number(p.Opacity)))s.opacity=String(Math.min(1,Math.max(0,Number(p.Opacity))));
  for(const [property,css] of [['Width','width'],['Height','height'],['MinWidth','minWidth'],['MinHeight','minHeight'],['MaxWidth','maxWidth'],['MaxHeight','maxHeight'],['FontSize','fontSize']])if(p[property]!==undefined){if(p[property]==='Auto')s[css]='auto';else if(Number.isFinite(Number(p[property])))s[css]=Number(p[property])+'px';}
  for(const property of ['Margin','Padding'])if(p[property]!==undefined&&!String(p[property]).startsWith('{'))s[property.toLowerCase()]=box(p[property]);
  for(const [property,css] of [['Background','background'],['Fill','background'],['Foreground','color'],['BorderBrush','borderColor']]){const brush=brushNode(doc,node,property),value=brush?brushCSS(brush):p[property]!==undefined&&!String(p[property]).startsWith('{')?cssColor(p[property]):'';if(value)s[css]=value;}
  if(p.BorderThickness!==undefined){s.borderWidth=box(p.BorderThickness);s.borderStyle='solid';}
  if(p.CornerRadius!==undefined)s.borderRadius=String(p.CornerRadius).split(',').map(v=>numeric(v)+'px').join(' ');
  const effect=propertyObject(node,'Effect');if(effect){const ep=effect.props,type=localName(effect.type);if(type==='BlurEffect')s.filter=`blur(${Math.max(0,numeric(ep.Radius,5))}px)`;if(type==='DropShadowEffect'){const direction=numeric(ep.Direction,315)*Math.PI/180,depth=numeric(ep.ShadowDepth,5),x=Math.cos(direction)*depth,y=-Math.sin(direction)*depth;s.filter=`drop-shadow(${x}px ${y}px ${Math.max(0,numeric(ep.BlurRadius,5))}px ${cssColor(ep.Color||'Black')})`;}}
  const clip=propertyObject(node,'Clip');if(clip&&localName(clip.type)==='RectangleGeometry'){const rect=String(clip.props.Rect||'').split(/[,\s]+/).map(Number);if(rect.length===4&&rect.every(Number.isFinite))s.clipPath=`polygon(${rect[0]}px ${rect[1]}px,${rect[0]+rect[2]}px ${rect[1]}px,${rect[0]+rect[2]}px ${rect[1]+rect[3]}px,${rect[0]}px ${rect[1]+rect[3]}px)`;}
  const collapsed=p.Visibility==='Collapsed'||p.IsVisible!==undefined&&String(p.IsVisible).toLowerCase()==='false';if(collapsed){if(s.display!=='none')el._visibleDisplay=s.display;s.display='none';}else if(s.display==='none'&&(p.Visibility!==undefined||p.IsVisible!==undefined)){s.display=el._visibleDisplay||'';}
  if(p.Visibility==='Hidden')s.visibility='hidden';else if(p.Visibility!==undefined)s.visibility='';
  return el;
}
function namespaceAt(doc,node,prefix){let current=node;while(current){if(Object.hasOwn(current.props||{},'xmlns:'+prefix))return current.props['xmlns:'+prefix];current=doc?parentOf(doc.root,current.id):null;}return doc?.root?.props?.['xmlns:'+prefix];}
export function isDesignElement(node,doc){if(node?.namespaceURI===DESIGN_NAMESPACE)return true;const prefix=node?.type?.includes(':')?node.type.split(':')[0]:null;return !!prefix&&namespaceAt(doc,node,prefix)===DESIGN_NAMESPACE;}
export function designProperties(node,doc){const result={};for(const [key,value] of Object.entries(node.props||{})){const at=key.indexOf(':');if(at<0||key.startsWith('xmlns:'))continue;const prefix=key.slice(0,at);if(namespaceAt(doc,node,prefix)===DESIGN_NAMESPACE)result[key.slice(at+1)]=value;}return result;}
export function sampleDesignData(node,count=5){count=Math.max(0,Math.min(100,Math.floor(numeric(count,5))));const fields=new Set(),forbidden=new Set(['__proto__','constructor','prototype']);walk(node,n=>{for(const value of Object.values(n.props||{})){const match=String(value).match(/^\{Binding\s+(?:Path\s*=\s*)?([\w.]+)/);if(match&&!['Path','RelativeSource','ElementName'].includes(match[1])&&match[1].split('.').every(p=>p&&!forbidden.has(p)))fields.add(match[1]);}});if(!fields.size)fields.add('Name');return Array.from({length:count},(_,index)=>{const row={};for(const path of fields){const parts=path.split('.');let target=row;for(const part of parts.slice(0,-1)){if(target[part]!==undefined&&(target[part]===null||typeof target[part]!=='object'))target[part]={};target=target[part]??={};}const key=parts.at(-1);target[key]=/^(Is|Has|Can)[A-Z]/.test(key)?index%2===0:/Count|Price|Amount|Total|Age|Quantity/i.test(key)?(index+1)*10:`${key} ${index+1}`;}return row;});}
