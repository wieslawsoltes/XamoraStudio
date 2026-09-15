/** Position actions independently from the selected element's type label. */
export function placeSelectionToolbar(rect,size,label,viewport,gap=6){
 const clamp=(n,a,b)=>Math.max(a,Math.min(n,Math.max(a,b)));
 const l=label||{x:rect.x,y:rect.y-23,width:80,height:22};
 let x=l.x+l.width+gap,y=clamp(l.y+(l.height-size.height)/2,gap,viewport.height-size.height-gap);
 if(x+size.width>viewport.width-gap){x=rect.x;y=l.y-size.height-gap;}
 if(y<gap){x=rect.x;y=Math.max(rect.y,l.y+l.height)+gap;}
 return {x:clamp(x,gap,viewport.width-size.width-gap),y:clamp(y,gap,viewport.height-size.height-gap)};
}
