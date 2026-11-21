// Permissioned frame routing. Only fixed isolated-world functions are injected.
// A frame route is bound to Chrome document IDs, not to a URL or a DOM index alone.
const brodexFrameRoutes=new Map();
function brodexFrameProbe(){
 try{
  if(document.readyState==='loading'||!document.documentElement)return {supported:false,reason:'FRAME_DOCUMENT_LOADING'};
  const url=new URL(location.href);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return {supported:false};
  const path=[];let w=window;
  while(w!==w.parent){if(path.length>=8)return {supported:false,reason:'FRAME_DEPTH_LIMIT'};const p=w.parent;let index=-1;for(let i=0;i<Math.min(p.length,256);i++)if(p[i]===w){index=i;break;}if(index<0)return {supported:false,reason:'FRAME_PATH_UNAVAILABLE'};path.unshift(index);w=p;}
  return {supported:true,url:url.href,path,width:innerWidth,height:innerHeight};
 }catch{return {supported:false,reason:'FRAME_UNAVAILABLE'};}
}
function brodexFrameBoundary(a){
 const store=globalThis.__brodexFrameBoundaryPins??=new Map();
 for(const [id,p] of store)if(Date.now()-p.created>300000)store.delete(id);
 const parent=n=>n.assignedSlot||n.parentElement||n.getRootNode()?.host||null;
 const style=n=>{const c=getComputedStyle(n);return [c.display,c.visibility,c.opacity,c.pointerEvents,c.transform,c.zoom,c.clipPath,c.overflow,c.position,c.zIndex].join('|');};
 const rect=n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height,n.clientLeft,n.clientTop,n.clientWidth,n.clientHeight];};
 const state=n=>JSON.stringify([Array.from(n.attributes,v=>[v.name,v.value]),n.hidden,n.inert,n.scrollLeft,n.scrollTop]);
 const viewport=()=>[innerWidth,innerHeight,scrollX,scrollY];
 if(a.action==='pin'){
  const target=window.frames[a.child_index];if(!target)return {error:'FRAME_UNAVAILABLE'};
  const stack=[document.documentElement];let host=null,count=0;
  while(stack.length){const n=stack.pop();if(++count>50000)return {error:'FRAME_SCAN_LIMIT'};if(n.matches('iframe,frame')&&n.contentWindow===target){host=n;break;}stack.push(...n.children);if(n.shadowRoot)stack.push(...n.shadowRoot.children);}
  if(!host)return {error:'FRAME_HOST_UNAVAILABLE'};
  const nodes=[];for(let n=host;n;n=parent(n)){const c=getComputedStyle(n);if(c.transform!=='none'||(c.zoom&&Number(c.zoom)!==1))return {error:'FRAME_TRANSFORM_UNSUPPORTED'};nodes.push({n,parent:parent(n),style:style(n),state:state(n),rect:rect(n)});}
  if(store.size>=32)store.delete(store.keys().next().value);
  const r=rect(host),p={host,target,nodes,viewport:viewport(),created:Date.now()};store.set(a.id,p);
  return {x:r[0]+r[4],y:r[1]+r[5],width:r[6],height:r[7],viewport:p.viewport};
 }
 const p=store.get(a.id);if(!p||p.host.contentWindow!==p.target)return {error:'FRAME_BOUNDARY_EXPIRED'};
 if(JSON.stringify(viewport())!==JSON.stringify(p.viewport))return {error:'FRAME_VIEWPORT_CHANGED'};
 for(const old of p.nodes){const n=old.n;if(!n.isConnected||parent(n)!==old.parent||style(n)!==old.style||state(n)!==old.state||rect(n).some((v,i)=>Math.abs(v-old.rect[i])>0.5))return {error:'FRAME_BOUNDARY_CHANGED'};const c=getComputedStyle(n);if(n.hidden||n.inert||c.display==='none'||c.visibility!=='visible'||Number(c.opacity)===0)return {error:'FRAME_NOT_VISIBLE'};}
 if(a.point){const {x,y}=a.point;if(x<0||y<0||x>=innerWidth||y>=innerHeight)return {error:'FRAME_POINT_OUTSIDE_VIEWPORT'};let root=document,hit=null;
  for(let i=0;i<32;i++){const n=root.elementFromPoint(x,y);if(!n||n===hit)break;hit=n;if(!n.shadowRoot)break;root=n.shadowRoot;}
  if(hit!==p.host)return {error:'FRAME_OCCLUDED'};
 }
 if(a.focus){let n=document.activeElement;for(let i=0;i<32&&n?.shadowRoot?.activeElement;i++)n=n.shadowRoot.activeElement;if(n!==p.host)return {error:'FRAME_FOCUS_CHANGED'};}
 return {valid:true};
}
function brodexFrameState(tabId){
 const lease=brodexDebugLeases.get(tabId);let state=brodexFrameRoutes.get(tabId);
 if(!state||state.lease!==lease){state={lease,observed:new Map(),snapshots:new Map(),current:null};if(brodexFrameRoutes.size>=64)brodexFrameRoutes.delete(brodexFrameRoutes.keys().next().value);brodexFrameRoutes.set(tabId,state);}
 return state;
}
function brodexFrameScope(args){
 if(!args.snapshot_id&&!(args.frame_id>0))return null;
 const state=brodexFrameState(args.tab_id);
 const id=args.snapshot_id||state.current;
 const entry=state.snapshots.get(id);
 if(args.snapshot_id&&entry&&state.current!==id&&!args._recovery)throw Error('STALE_SNAPSHOT: another frame observation replaced this snapshot');
 if(args.frame_id!==undefined&&args.frame_id!==0&&(!entry||entry.scope?.frame_id!==args.frame_id))throw Error('FRAME_OBSERVATION_REQUIRED');
 return entry?.scope||null;
}
async function brodexFrameInject(tabId,documentId,func,args){
 const results=await chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},world:'ISOLATED',func,args});
 const value=results.find(r=>r.documentId===documentId)?.result;
 if(!value)throw Error('FRAME_DOCUMENT_CHANGED');if(value.error)throw Error(value.error);return value;
}
async function brodexFrameGuard(scope,point,focus=false){
 if(!scope)return point;
 if(Date.now()-scope.created>60000||brodexDebugLeases.get(scope.tab_id)!==scope.lease)throw Error('FRAME_OBSERVATION_EXPIRED');
 let p=point;
 for(let i=scope.boundaries.length-1;i>=0;i--){const b=scope.boundaries[i];if(p)p={x:p.x+b.x,y:p.y+b.y};await brodexFrameInject(scope.tab_id,b.document_id,brodexFrameBoundary,[{action:'guard',id:b.id,point:p,focus}]);}
 return p;
}
async function brodexReadScopedPage(args,maxChars,maxElements,offset,elementOffset){
 const chrome=brodexOperationChrome();
 const state=brodexFrameState(args.tab_id),frameId=args.frame_id??0;
 if(args.group&&state.current!==args.group.snapshot_id)throw Error('GROUP_SNAPSHOT_STALE: read_page again');
 if(!Number.isInteger(frameId)||frameId<0)throw Error('INVALID_FRAME_ID');
 async function enumerate(){
  // Probe the current committed DOM; do not wait for every third-party frame's
  // document_idle. Loading frames explicitly decline a route in FrameProbe.
  const results=await chrome.scripting.executeScript({target:{tabId:args.tab_id,allFrames:true},world:'ISOLATED',injectImmediately:true,func:brodexFrameProbe});
  const frames=results.filter(r=>r.result?.supported&&r.documentId&&r.result.path.length<=8).map(r=>({frame_id:r.frameId,document_id:r.documentId,...r.result}));
  const bounded=frames.sort((a,b)=>a.frame_id-b.frame_id).slice(0,64);bounded.total=frames.length;return bounded;
 }
 let scope=null,frames;
 if(frameId!==0){
  const observed=state.observed.get(frameId);if(!observed)throw Error('FRAME_OBSERVATION_REQUIRED: read the top page and select an observed frame_id');
  frames=await enumerate();const selected=frames.find(f=>f.frame_id===frameId);
  if(!selected||selected.document_id!==observed.document_id||selected.url!==observed.url)throw Error('FRAME_DOCUMENT_CHANGED: read the top page again');
  const boundaries=[];
  for(let depth=0;depth<selected.path.length;depth++){
   const parentPath=JSON.stringify(selected.path.slice(0,depth)),parent=frames.find(f=>JSON.stringify(f.path)===parentPath);
   if(!parent)throw Error('FRAME_PARENT_UNAVAILABLE');
   const id=crypto.randomUUID(),box=await brodexFrameInject(args.tab_id,parent.document_id,brodexFrameBoundary,[{action:'pin',id,child_index:selected.path[depth]}]);
   boundaries.push({id,document_id:parent.document_id,...box});
  }
  scope={tab_id:args.tab_id,frame_id:frameId,document_id:selected.document_id,url:selected.url,boundaries,created:Date.now(),lease:state.lease};
  await brodexFrameGuard(scope);
 }
 const results=await chrome.scripting.executeScript({target:scope?{tabId:args.tab_id,documentIds:[scope.document_id]}:{tabId:args.tab_id,frameIds:[0]},world:'ISOLATED',injectImmediately:true,func:brodexReadPage,args:[scope?.url||args.expected_url,maxChars,maxElements,offset,elementOffset,{group:args.group,preparation_id:args._preparation_id,catalog_target:args._catalog_target}]});
 const result=results.find(r=>scope?r.documentId===scope.document_id:r.frameId===0),page=result?.result;
 if(!page)throw Error('PAGE_READ_NO_RESULT');if(page.error)throw Error(page.error);
 if(scope)await brodexFrameGuard(scope);
 if(!scope&&page.coverage.iframes_not_read>0){frames=await enumerate();state.observed=new Map(frames.map(f=>[f.frame_id,f]));}
 else if(!scope)state.observed.clear();
 page.frame_id=frameId;
 if(scope&&page.url.length>1000){page.url=page.url.slice(0,1000);page.url_truncated=true;}
 if(scope)page.frame_scope={frame_id:frameId,document_id:scope.document_id,coordinates:'frame_viewport',parent_boundaries_checked:true};
 if(!scope&&frames){page.frames=frames.filter(f=>f.frame_id!==0).map(f=>({frame_id:f.frame_id,url:f.url.slice(0,1000),url_truncated:f.url.length>1000,depth:f.path.length}));page.coverage.frame_routes_available=page.frames.length;page.coverage.frame_routes_truncated=frames.total>frames.length;}
 const previous=state.snapshots.get(state.current);
 if(previous?.document_id&&previous.document_id!==result.documentId)try{await brodexFrameInject(args.tab_id,previous.document_id,brodexPageAction,[{action:'retire_snapshot',expected_url:previous.url,snapshot_id:state.current,_show_pointer:false}]);}catch{/* Expired/detached document cleanup does not rebind a target. */}
 state.current=page.snapshot_id;state.snapshots.set(page.snapshot_id,{scope,document_id:result.documentId,url:scope?.url||page.url,created:Date.now()});
 for(const [id,r] of state.snapshots)if(Date.now()-r.created>60000||state.snapshots.size>16)state.snapshots.delete(id);
 return page;
}
async function brodexRunPage(args,func,payload){
 let scope;try{scope=brodexFrameScope({...args,snapshot_id:payload.snapshot_id||args.snapshot_id});
 if(scope){
  await brodexFrameGuard(scope);
  if(['click','fill','select','set_checked','validate_file'].includes(payload.action)){
   const point=await brodexFrameInject(args.tab_id,scope.document_id,brodexPageAction,[{action:'frame_action_point',expected_url:scope.url,snapshot_id:payload.snapshot_id,element_id:payload.element_id,_show_pointer:false}]);
   await brodexFrameGuard(scope,point);
  }
 }
 }catch(e){e.brodex_preflight_refusal=true;throw e;}
 const results=await chrome.scripting.executeScript({target:scope?{tabId:args.tab_id,documentIds:[scope.document_id]}:{tabId:args.tab_id,frameIds:[0]},world:'ISOLATED',func,args:[{...payload,expected_url:scope?.url||args.expected_url}]});
 const value=results.find(r=>scope?r.documentId===scope.document_id:r.frameId===0)?.result;
 if(!value)throw Error(scope?'FRAME_DOCUMENT_CHANGED':'DOCUMENT_UNAVAILABLE');return value;
}
async function brodexFrameSend(args,method,params){
 try{const scope=brodexFrameScope(args);
 if(scope){
  if(method==='Input.dispatchMouseEvent'&&params.type==='mouseReleased'){
   // Cleanup must remain possible after an overlay, focus change or boundary refusal.
   params={...params,x:params.x+scope.boundaries.reduce((n,b)=>n+b.x,0),y:params.y+scope.boundaries.reduce((n,b)=>n+b.y,0)};
  }else if(method==='Input.dispatchMouseEvent'||method==='DOM.getNodeForLocation'){const point=await brodexFrameGuard(scope,{x:params.x,y:params.y});params={...params,...(method==='DOM.getNodeForLocation'?{x:Math.round(point.x),y:Math.round(point.y)}:point)};}
  else if(method==='Page.captureScreenshot'){
   await brodexFrameGuard(scope);let x=0,y=0;
   for(let i=scope.boundaries.length-1;i>=0;i--){const b=scope.boundaries[i];x+=b.x;y+=b.y;if(x<0||y<0||x+params.clip.width>b.viewport[0]||y+params.clip.height>b.viewport[1])throw Error('FRAME_SCREENSHOT_CLIPPED: scroll the frame into view and read again');}
   const top=scope.boundaries[0].viewport;params={...params,clip:{...params.clip,x:x+top[2],y:y+top[3]}};
   const zoom=typeof chrome.tabs.getZoom==='function'?await chrome.tabs.getZoom(args.tab_id):1;
   if(!Number.isFinite(zoom)||zoom<=0)throw Error('FRAME_ZOOM_UNAVAILABLE');
   params.clip={...params.clip,x:params.clip.x*zoom,y:params.clip.y*zoom,width:params.clip.width*zoom,height:params.clip.height*zoom};
  }else if(method.startsWith('Input.')&&params.type!=='keyUp')await brodexFrameGuard(scope,undefined,true);
 }else if(method==='Page.captureScreenshot'){
  // Native viewport capture avoids CSS/DIP clipping mismatch under browser zoom.
  const {clip,...nativeViewport}=params;params=nativeViewport;
 }
 }catch(e){e.brodex_preflight_refusal=true;throw e;}
 return chrome.debugger.sendCommand({tabId:args.tab_id},method,params);
}
async function brodexEmbeddedFileTarget(args,localPoint){
 const scope=brodexFrameScope(args),sessions=[];
 let point=scope?await brodexFrameGuard(scope,localPoint):localPoint,target={tabId:args.tab_id};
 const cleanup=async()=>{for(const s of sessions.reverse())try{await chrome.debugger.sendCommand(s.parent,'Target.detachFromTarget',{sessionId:s.id});}catch{}};
 try{
  for(let depth=0;depth<9;depth++){
   const found=await chrome.debugger.sendCommand(target,'DOM.getNodeForLocation',{x:Math.round(point.x),y:Math.round(point.y),includeUserAgentShadowDOM:false});
   if(!found.backendNodeId)throw Error('FILE_INPUT_NOT_FOUND');
   const {node}=await chrome.debugger.sendCommand(target,'DOM.describeNode',{backendNodeId:found.backendNodeId});
   const attrs={};for(let i=0;i<(node.attributes||[]).length;i+=2)attrs[node.attributes[i]]=node.attributes[i+1];
   if(node.nodeName==='INPUT'&&attrs.type?.toLowerCase()==='file'&&!('webkitdirectory' in attrs)&&!('disabled' in attrs))return {target,backendNodeId:found.backendNodeId,cleanup};
   if(!['IFRAME','FRAME'].includes(node.nodeName)||!node.frameId)throw Error('FILE_INPUT_TARGET_UNSUPPORTED');
   const {model}=await chrome.debugger.sendCommand(target,'DOM.getBoxModel',{backendNodeId:found.backendNodeId}),q=model.content;
   if(!q||Math.abs(q[1]-q[3])>.5||Math.abs(q[0]-q[6])>.5)throw Error('FRAME_TRANSFORM_UNSUPPORTED');
   const attached=await chrome.debugger.sendCommand(target,'Target.attachToTarget',{targetId:node.frameId,flatten:true});
   if(!attached.sessionId)throw Error('FRAME_TARGET_UNAVAILABLE');sessions.push({parent:target,id:attached.sessionId});target={tabId:args.tab_id,sessionId:attached.sessionId};point={x:point.x-q[0],y:point.y-q[1]};
  }
  throw Error('FRAME_DEPTH_LIMIT');
 }catch(e){await cleanup();throw e;}
}
