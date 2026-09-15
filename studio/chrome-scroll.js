import {ScrollButtons} from '../controls/scroll-buttons.js';
/** Keep primary horizontal command bars navigable without scrollbar rows. */
export class ChromeScroll {
 constructor(studio){this.strips=[];for(const selector of ['.topbar','.ide-menubar','.toolbar','.statusbar']){const node=document.querySelector(selector);if(!node)continue;const parent=node.parentElement,next=node.nextSibling,strip=new ScrollButtons(node,{label:selector.slice(1).replaceAll('-',' ')});strip.host.classList.add('chrome-scroll-wrapper');parent.insertBefore(strip.host,next);this.strips.push(strip);}studio.density.addEventListener('change',()=>requestAnimationFrame(()=>this.strips.forEach(s=>s.update())));}
 dispose(){this.strips.forEach(s=>s.dispose());}
}
