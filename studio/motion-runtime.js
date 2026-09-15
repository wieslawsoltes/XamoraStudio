import {clone,find,isElement,isProperty,localName,parentOf} from '../core/model.js';
import {sampleStoryboard,applyAnimationValues,activeDuration,simpleDuration,parseTime} from '../core/animation.js';
import {VisualStateRuntime,stateGroups} from '../core/states.js';
import {resolveStyle,findResource} from '../core/styling.js';
import {motionDocument,motionBase,captureMotion,restoreMotion,patchMotion} from '../core/motion-render.js';
const type=n=>localName(n?.type||'');
const merge=(target,source)=>{for(const [id,props] of source)target.set(id,{...target.get(id),...props});};

/** Clocks and input states belong to one isolated preview view. */
export class MotionRuntime {
  constructor(doc,{now=()=>performance.now(),schedule=fn=>requestAnimationFrame(fn),cancel=id=>cancelAnimationFrame(id)}={}) {
    this.now=now;this.scheduleFrame=schedule;this.cancelFrame=cancel;this.started=now();
    this.doc=clone(doc);this.states=new VisualStateRuntime(this.doc);this.clocks=new Map();this.inputs=new Map();this.triggerEdges=new Set();this.baselines=new Map();this.disposed=false;this.loaded=false;this.lastCommand=0;
  }
  get time(){return (this.now()-this.started)/1000;}
  bind(renderer){
    this.renderer=renderer;this.doc=motionDocument(renderer);this.base=motionBase(renderer,this.doc);this.states.doc=this.base;this.states.baseDocument=this.base;this.baselines=captureMotion(renderer);this.initializing=true;
    if(!this.loaded){this.loaded=true;for(const id of renderer.elements.keys())this.event(id,'Loaded');for(const group of stateGroups(this.doc).filter(g=>renderer.elements.has(g.ownerId))){const initial=group.states.find(n=>['Normal','Unchecked','Unfocused'].includes(n.props['x:Name']||n.props.Name));if(initial)this.states.go(group.id,initial.props['x:Name']||initial.props.Name,this.time,false);}}
    for(const id of renderer.elements.keys())this.event(id,'DataChanged');this.initializing=false;this.tick();
  }
  start(storyId,targetId,name){
    if(!find(this.doc.root,storyId))throw Error('Storyboard no longer exists.');
    const owner=this.renderer?.templateOwners?.get(targetId)||targetId,nameScopeId=this.renderer?.runtimeTemplates?.find(t=>t.ownerId===owner)?.tree.id;
    this.clocks.set(name||storyId,{storyId,targetId,nameScopeId,start:this.time,paused:null});this.schedule();
  }
  stop(key){if(key){this.clocks.delete(key);for(const [name,c] of this.clocks)if(c.storyId===key)this.clocks.delete(name);}else this.clocks.clear();this.tick();}
  command(action){if(action.type==='startStoryboard')this.start(action.storyboardId,action.targetId);else if(action.type==='stopStoryboard')this.stop(action.storyboardId);else if(action.type==='goToState'){this.states.go(action.groupId,action.stateName,this.time,action.useTransitions!==false);this.schedule();}}
  commands(actions){for(const action of actions||[])if(action.serial>this.lastCommand){this.command(action);this.lastCommand=action.serial;}}
  event(nodeId,event){
    const node=find(this.doc.root,nodeId);if(!node)return;const transient=this.inputs.get(nodeId)||{};
    Object.assign(transient,event==='PointerEnter'?{IsMouseOver:true}:event==='PointerLeave'?{IsMouseOver:false,IsPressed:false}:event==='PointerDown'?{IsPressed:true}:event==='PointerUp'?{IsPressed:false}:event==='GotFocus'?{IsKeyboardFocused:true,IsFocused:true}:event==='LostFocus'?{IsKeyboardFocused:false,IsFocused:false}:{});this.inputs.set(nodeId,transient);
    const mapped={PointerEnter:'MouseEnter',PointerLeave:'MouseLeave',PointerDown:'MouseDown',PointerUp:'MouseUp'}[event]||event;
    const ancestors=[];let ancestor=node;while(ancestor){ancestors.push(ancestor);ancestor=parentOf(this.doc.root,ancestor.id);}
    const direct=ancestors.flatMap(owner=>owner.children.filter(n=>isProperty(n)&&n.type.endsWith('.Triggers')).flatMap(n=>n.children).filter(t=>owner===node||type(t)==='EventTrigger')).filter(t=>!t.props?.SourceName||t.props.SourceName===(node.props['x:Name']||node.props.Name));
    const styled=resolveStyle(this.doc,node,{context:this.renderer?.contextFor(node)||{},root:this.renderer?.sampleData||{},transient});
    for(const trigger of [...direct,...styled.triggers]){
      if(type(trigger)==='EventTrigger'&&[mapped,event].includes((trigger.props.RoutedEvent||'').split('.').pop()))this.runActions(trigger,nodeId);
      if(type(trigger)!=='EventTrigger'){const edge=nodeId+':'+trigger.id,active=styled.active.includes(trigger),was=this.triggerEdges.has(edge);if(active!==was){active?this.triggerEdges.add(edge):this.triggerEdges.delete(edge);const property=trigger.children.find(n=>isProperty(n)&&n.type.endsWith(active?'.EnterActions':'.ExitActions'));if(property)this.runActions(property,nodeId);}}
    }
    const desired=event==='PointerEnter'?'MouseOver':event==='PointerLeave'?'Normal':event==='PointerDown'?'Pressed':event==='PointerUp'?(transient.IsMouseOver?'MouseOver':'Normal'):event==='GotFocus'?'Focused':event==='LostFocus'?'Unfocused':null;
    if(desired)for(const group of stateGroups(this.doc).filter(g=>g.ownerId===nodeId||this.renderer?.templateOwners?.get(g.ownerId)===nodeId))if(group.states.some(n=>(n.props['x:Name']||n.props.Name)===desired))this.states.go(group.id,desired,this.time,true);
    if(!this.initializing)this.tick();
  }
  runActions(container,targetId){
    const actions=container.children.flatMap(n=>isProperty(n)&&n.type.endsWith('.Actions')?n.children:[n]).filter(isElement);
    for(const action of actions){
      if(type(action)==='BeginStoryboard'){const inline=action.children.flatMap(n=>isProperty(n)&&n.type.endsWith('.Storyboard')?n.children:[n]).find(n=>type(n)==='Storyboard'),key=action.props.Storyboard?.match(/^\{StaticResource\s+([^}]+)}/)?.[1],story=inline||(key&&findResource(this.doc,find(this.doc.root,targetId),key));if(story)this.start(story.id,targetId,action.props['x:Name']||action.props.Name);}
      else if(['StopStoryboard','RemoveStoryboard'].includes(type(action)))this.stop(action.props.BeginStoryboardName);
      else if(type(action)==='PauseStoryboard'){const clock=this.clocks.get(action.props.BeginStoryboardName);if(clock&&clock.paused===null)clock.paused=this.time;}
      else if(type(action)==='SeekStoryboard'){const clock=this.clocks.get(action.props.BeginStoryboardName);if(clock){const story=find(this.doc.root,clock.storyId),origin=action.props.Origin==='Duration'?simpleDuration(story):0,offset=parseTime(action.props.Offset);clock.start=(clock.paused??this.time)-Math.max(0,origin+offset);}}
      else if(type(action)==='ResumeStoryboard'){const clock=this.clocks.get(action.props.BeginStoryboardName);if(clock&&clock.paused!==null){clock.start+=this.time-clock.paused;clock.paused=null;}}
    }
  }
  schedule(){if(!this.frame&&!this.disposed&&!this.initializing)this.frame=this.scheduleFrame(()=>{this.frame=null;this.tick();});}
  needsFrame(){const time=this.time;for(const clock of this.clocks.values()){const n=find(this.doc.root,clock.storyId);if(n&&clock.paused===null&&time-clock.start<parseTime(n.props.BeginTime)+activeDuration(n)/(Number(n.props.SpeedRatio)||1))return true;}for(const entry of this.states.active.values()){const story=entry.state.children.flatMap(n=>isProperty(n)&&n.type.endsWith('.Storyboard')?n.children:[n]).find(n=>type(n)==='Storyboard');if(time-entry.start<entry.duration+(story?activeDuration(story):0))return true;}return false;}
  tick(){
    if(this.disposed||!this.renderer||this.initializing)return;const doc=clone(this.doc),time=this.time,values=this.states.sample(time);
    for(const clock of this.clocks.values()){const story=find(this.doc.root,clock.storyId);if(story)merge(values,sampleStoryboard(this.doc,story,(clock.paused??time)-clock.start,{baseDocument:this.base,targetId:clock.targetId,nameScopeId:clock.nameScopeId}).overrides);}
    try{applyAnimationValues(doc,values);}catch(error){this.warning=error.message;}
    patchMotion(this.renderer,doc,values,this.baselines,{inputs:this.inputs});if(this.needsFrame())this.schedule();
  }
  dispose(){this.disposed=true;if(this.frame)this.cancelFrame(this.frame);this.frame=null;this.clocks.clear();this.states.reset();if(this.renderer)restoreMotion(this.renderer,this.baselines);}
}
