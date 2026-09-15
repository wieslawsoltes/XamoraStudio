/** UI density is a local presentation preference, separate from design and dock history. */
export const DENSITY_KEY = 'xamora-ui-density-v1';
export const DENSITY_MODES = Object.freeze([
  Object.freeze({id:'compact',label:'Compact',description:'Tighter controls and rows; more workspace'}),
  Object.freeze({id:'standard',label:'Standard',description:'Balanced spacing and control sizes'}),
  Object.freeze({id:'comfortable',label:'Comfortable',description:'Larger controls and more breathing room'})
]);
export const validDensity = value => DENSITY_MODES.some(mode => mode.id === value);
const browserStorage = () => {try{return globalThis.localStorage;}catch{return null;}};
export class WorkspaceDensity extends EventTarget {
  constructor({root=document.documentElement,storage=browserStorage()}={}) {
    super();this.root=root;this.storage=storage;let saved;
    try{saved=storage?.getItem(DENSITY_KEY);}catch{}
    this.value=validDensity(saved)?saved:'compact';root.dataset.density=this.value;
  }
  set(value,{persist=true}={}) {
    if(!validDensity(value))throw Error('Choose Compact, Standard, or Comfortable density.');
    const previous=this.value;this.value=value;this.root.dataset.density=value;
    if(persist)try{this.storage?.setItem(DENSITY_KEY,value);}catch{}
    if(previous===value)return false;
    this.dispatchEvent(new Event('change'));return true;
  }
}
