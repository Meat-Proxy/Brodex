// Read-only local evidence, deliberately separate from the action guards.
// Hit tests sample points without moving the pointer or changing focus/scroll.
function inspectBrodexDOM(n,{detailed=false,exhausted=()=>false}={}) {
 const parent=n=>n.assignedSlot||n.parentElement||n.getRootNode()?.host||null;
 const contains=(a,b)=>{for(let p=b;p;p=parent(p))if(p===a)return true;return false;};
 let cssVisible=true,pointerEvents=true;
 for(let p=n;p;p=parent(p)){
  const s=getComputedStyle(p);
  if(p.hidden||s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0)cssVisible=false;
 }
 pointerEvents=getComputedStyle(n).pointerEvents!=='none';
 const rects=n.getClientRects();let hasBox=false,inViewport=false;const points=[];
 for(let i=0;i<Math.min(rects.length,8);i++){
  const r=rects[i];if(r.width<=0||r.height<=0)continue;hasBox=true;
  const left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
  if(right<=left||bottom<=top)continue;inViewport=true;
  for(const [fx,fy] of [[.5,.5],[.2,.2],[.8,.2],[.2,.8],[.8,.8]])points.push({x:left+(right-left)*fx,y:top+(bottom-top)*fy});
 }
 // checkVisibility includes skipped rendering (closed details/content-visibility).
 const layoutVisible=typeof n.checkVisibility==='function'?n.checkVisibility({checkOpacity:true,checkVisibilityCSS:true,contentVisibilityAuto:true}):hasBox;
 const rendered=n.isConnected&&cssVisible&&hasBox&&layoutVisible;
 const visibility={connected:n.isConnected,css_visible:cssVisible,has_layout_box:hasBox,rendered,in_viewport:rendered&&inViewport,pointer_events:pointerEvents,occluded:null,
  occlusion:{status:'not_requested',scope:'sampled_points',tested:0,clear:0,blocked:0,unknown:0,rectangles_truncated:rects.length>8}};
 const oc=visibility.occlusion;
 if(!detailed)return visibility;
 if(!rendered||!inViewport||!pointerEvents){oc.status='not_applicable';oc.reason=!rendered?'not_rendered':!inViewport?'outside_viewport':'pointer_events_none';return visibility;}
 oc.status='sampled';
 for(const point of points){
  if(exhausted()){oc.status='partial';oc.reason='inspection_budget';break;}
  let root=n.ownerDocument,hit=null,complete=true;
  try{
   for(let depth=0;depth<16;depth++){
    const next=root.elementFromPoint(point.x,point.y);
    if(!next||next===hit)break;hit=next;
    if(!hit.shadowRoot)break;
    if(depth===15){complete=false;break;}
    root=hit.shadowRoot;
   }
   oc.tested++;if(!complete||!hit)oc.unknown++;else if(contains(n,hit))oc.clear++;else oc.blocked++;
  }catch{oc.tested++;oc.unknown++;}
 }
 if(oc.clear>0)visibility.occluded=false;
 else if(oc.tested===points.length&&oc.blocked===points.length&&points.length)visibility.occluded=true;
 // true means every tested point was blocked, not proof about every pixel.
 if(oc.unknown){oc.status='partial';oc.reason||='hit_test_unavailable';}
 return visibility;
}
if(typeof module!=='undefined')module.exports={inspectBrodexDOM};
