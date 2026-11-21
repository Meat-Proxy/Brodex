const brodexPreparations=new Map();
const brodexPreparationCommands=new Set(['act','mouse_click','drag','press_key','upload_file','upload_via_chooser','navigate','operation']);
async function brodexPreparedAction(command,args,api){
 const allowed=command==='prepare_action'?['tab_id','expected_url','snapshot_id','catalog_target','command','parameters','context_regions']:command==='execute_prepared_action'?['tab_id','expected_url','snapshot_id','preparation_id','control_token']:['tab_id','expected_url','failure_id','recovery_mode','snapshot_id','change_ids','reason'];
 if(Object.keys(args).some(k=>!allowed.includes(k)))throw Error('PREPARATION_ARGUMENT_NOT_ALLOWED');
 await api.guard(args.tab_id);await brodexRequireWork(args.tab_id);
 let catalogSource=null;
 if(command==='prepare_action'&&args.catalog_target!==undefined){
  const binding=await brodexCatalogActionObservation(args,api);
  catalogSource={...args.catalog_target,mapping:'exact_node'};
  args={...args,snapshot_id:binding.snapshot_id,parameters:{...args.parameters,element_id:binding.element_id}};delete args.catalog_target;
 }
 const lease=brodexDebugLeases.get(args.tab_id),now=Date.now();
 for(const [id,r] of brodexPreparations)if(now-r.created>300000||r.lease!==brodexDebugLeases.get(r.tab_id))brodexPreparations.delete(id);
 const chrome=typeof brodexOperationChrome==='function'?brodexOperationChrome():globalThis.chrome;
 const call=async payload=>{const v=typeof brodexRunPage==='function'?await brodexRunPage(args,brodexPageAction,{...payload,_show_pointer:false}):(await chrome.scripting.executeScript({target:{tabId:args.tab_id,frameIds:[0]},world:'ISOLATED',func:brodexPageAction,args:[{...payload,expected_url:args.expected_url,_show_pointer:false}]})).find(v=>v.frameId===0)?.result;if(!v)throw Error('DOCUMENT_UNAVAILABLE');if(v.error){const e=Error(v.error);e.retry_diagnostic=v.retry_diagnostic;e.unsupported_diagnostic=v.unsupported_diagnostic;throw e;}return v;};
 let r;
 if(command==='prepare_action'){
  if(!brodexPreparationCommands.has(args.command)||!args.parameters||typeof args.parameters!=='object'||Array.isArray(args.parameters)||['tab_id','expected_url','snapshot_id'].some(k=>k in args.parameters))throw Error('INVALID_PREPARATION_ARGUMENTS');
  if(brodexPreparations.size>=64&&![...brodexPreparations.values()].some(r=>r.tab_id===args.tab_id))throw Error('PREPARATION_RECORD_LIMIT');
  const parameters=structuredClone(args.parameters),visual=await api.read('brodexVisual:'+args.tab_id);
  const coordinate=args.command==='drag'||args.command==='mouse_click'||args.command==='upload_via_chooser'||args.command==='operation'||args.command==='act'&&['click_at','hover_at','wheel_at'].includes(parameters.action);
  if(coordinate&&(!visual||visual.snapshot_id!==args.snapshot_id||visual.prepared||Date.now()-visual.created>30000))throw Error('PREPARATION_OVERVIEW_REQUIRED');
  const regions=args.context_regions||[];
  if(coordinate&&(!regions.length||regions.length>8))throw Error('PREPARED_CONTEXT_REQUIRED');
  const scaled=structuredClone(parameters),scale=(x,y)=>({x:x*visual.viewport.width/visual.width,y:y*visual.viewport.height/visual.height});
  if(coordinate){if(args.command==='drag'){const a=scale(parameters.from_x,parameters.from_y),b=scale(parameters.to_x,parameters.to_y);Object.assign(scaled,{from_x:a.x,from_y:a.y,to_x:b.x,to_y:b.y});}else if(args.command==='operation')scaled.steps=parameters.steps.map(s=>({...s,...scale(s.x,s.y)}));else Object.assign(scaled,scale(parameters.x,parameters.y));}
  r={id:crypto.randomUUID(),tab_id:args.tab_id,expected_url:args.expected_url,frame_id:typeof brodexFrameScope==='function'?brodexFrameScope(args)?.frame_id||0:0,lease,created:now,command:args.command,parameters,coordinate,visual,regions,quick_used:false,state:'preparing'};
  const binding=await call({action:'bind_action_preparation',snapshot_id:args.snapshot_id,preparation_id:r.id,command:r.command,parameters:scaled,context_regions:coordinate?regions.map(v=>({...scale(v.x,v.y),width:v.width*visual.viewport.width/visual.width,height:v.height*visual.viewport.height/visual.height})):[]});
  r.element_offset=binding.element_offset;r.catalog_source=catalogSource;
  for(const [id,old] of brodexPreparations)if(old.tab_id===r.tab_id)brodexPreparations.delete(id);
  brodexPreparations.set(r.id,r);
 }else{
  r=command==='retry_preparation'?[...brodexPreparations.values()].find(r=>r.failure?.failure_id===args.failure_id):brodexPreparations.get(args.preparation_id);
  if(!r||r.tab_id!==args.tab_id||r.expected_url!==args.expected_url||r.lease!==lease)throw Error('PREPARATION_RECORD_UNAVAILABLE');
 }
 if(command==='execute_prepared_action'){
  if(r.state!=='ready'||r.snapshot_id!==args.snapshot_id||r.control_token!==args.control_token||Date.now()-r.prepared>30000)throw Error('PREPARATION_CONTROL_UNAVAILABLE');
  r.state='executing';let entered=false;
  try{
   await call({action:'guard_action_bundle',snapshot_id:r.snapshot_id,preparation_id:r.id});
   const a={...r.parameters,tab_id:r.tab_id,expected_url:r.expected_url,snapshot_id:r.snapshot_id,...(r.element_id?{element_id:r.element_id}:{})};
   entered=true;const result=await brodexInteract(r.command==='operation'?'execute_operation':r.command,r.command==='operation'?{...a,control_image_sha256:r.image_sha256}:a,api,{preparedAction:r});
   r.state='consumed';brodexPreparations.delete(r.id);return {...result,preparation_id:r.id,prepared_request_id:r.parameters.request_id};
  }catch(e){if(!entered)return failPreparation(e);r.state='consumed';brodexPreparations.delete(r.id);throw e;}
 }
 let ids=[];
 if(command==='retry_preparation'){
  const quick=args.recovery_mode==='quick';
  if(r.state!=='failed'||!r.failure?.complete||r.failure.changes.some(c=>!c.exception_allowed))throw Error('RETRY_UNRESOLVED_CHANGES');
  if(quick){if(r.quick_used)throw Error('QUICK_PREPARATION_ALREADY_USED');if(['snapshot_id','change_ids','reason'].some(k=>k in args))throw Error('RETRY_ARGUMENT_NOT_ALLOWED');r.quick_used=true;}
  else{
   if(args.recovery_mode!=='exceptions'||!r.quick_used)throw Error('QUICK_PREPARATION_REQUIRED');
   ids=args.change_ids;
   if(typeof args.reason!=='string'||!args.reason.trim()||!Array.isArray(ids)||new Set(ids).size!==ids.length||r.failure.changes.some(c=>!ids.includes(c.change_id))||ids.some(id=>!r.failure.changes.some(c=>c.change_id===id)))throw Error('RETRY_UNRESOLVED_CHANGES');
   if(!args.snapshot_id||args.snapshot_id===r.snapshot_id)throw Error('RETRY_FRESH_OBSERVATION_REQUIRED');
   if(r.coordinate){const v=await api.read('brodexVisual:'+r.tab_id);if(!v||v.prepared||v.snapshot_id!==args.snapshot_id||v.created<=r.failed_at)throw Error('RETRY_FRESH_OVERVIEW_REQUIRED');}
   // Validate the provided observation before replacing it with preparation control.
   await call({action:'preparation_observation',snapshot_id:args.snapshot_id,preparation_id:r.id});
  }
 }
 r.state='preparing';
 try{
  const observation=await api.handle('read_page',{tab_id:r.tab_id,expected_url:r.expected_url,...(r.frame_id?{frame_id:r.frame_id}:{}),max_chars:1000,max_elements:100,element_offset:r.element_offset,_preparation_id:r.id});r.snapshot_id=observation.page.snapshot_id;
  const payload={snapshot_id:r.snapshot_id,preparation_id:r.id};
  let control=await call({...payload,action:'prepare_action_bundle',...(command==='retry_preparation'?{failure_id:r.failure.failure_id,change_ids:ids}:{})});
  if(r.command==='operation'){
   const pin=await call({...payload,action:'prepare_series',prepared_bundle:true,plan_id:r.parameters.plan_id,steps:r.parameters.steps.map(v=>({...v,x:v.x*r.visual.viewport.width/r.visual.width,y:v.y*r.visual.viewport.height/r.visual.height})),context_regions:r.regions.map(v=>({x:v.x*r.visual.viewport.width/r.visual.width,y:v.y*r.visual.viewport.height/r.visual.height,width:v.width*r.visual.viewport.width/r.visual.width,height:v.height*r.visual.viewport.height/r.visual.height}))});r.steps=pin.steps.map(v=>({...v,x:v.x*r.visual.width/r.visual.viewport.width,y:v.y*r.visual.height/r.visual.viewport.height}));
  }
  const settings=await chrome.storage.local?.get('brodexShowActions')||{};if(r.coordinate&&settings.brodexShowActions!==false)await call({...payload,action:'show_action_preparation'});
  const timing=await brodexTiming.wait(async()=>{control=await call({...payload,action:'guard_action_bundle'});return {key:1};},r.parameters.timing);
  if(!timing.matched)throw Error('TIMING_TIMEOUT: preparation');
  let image;
  if(r.coordinate){
   const vp=observation.page.viewport,shot=await (typeof brodexFrameSend==='function'?brodexFrameSend.bind(null,{tab_id:r.tab_id,snapshot_id:r.snapshot_id,expected_url:r.expected_url}):chrome.debugger.sendCommand.bind(chrome.debugger,{tabId:r.tab_id}))('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,clip:{x:vp.scroll_x,y:vp.scroll_y,width:vp.width,height:vp.height,scale:1}});
   const bytes=Uint8Array.from(atob(shot.data),c=>c.charCodeAt(0)),header=new DataView(bytes.buffer),width=header.getUint32(16),height=header.getUint32(20);
   if(bytes.length>8*1024*1024||width*height>24000000)throw Error('SCREENSHOT_TOO_LARGE');
   const masked=await brodexMaskControlImage(shot.data,width,height,vp,control.review_regions);image={mimeType:'image/png',data:masked.data};r.image_sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',masked.bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(width!==r.visual.width||height!==r.visual.height||JSON.stringify(vp)!==JSON.stringify(r.visual.viewport))throw Error('PREPARATION_VIEWPORT_CHANGED');
   control=await call({...payload,action:'guard_action_bundle'});
   const tab=await chrome.tabs.get(r.tab_id);
   await api.save('brodexVisual:'+r.tab_id,{...r.visual,snapshot_id:r.snapshot_id,created:Date.now(),prepared:true,image_sha256:r.image_sha256,context_regions:r.regions,...(r.command==='operation'?{series:true,plan_id:r.parameters.plan_id,steps:r.steps,window_id:tab.windowId,group_id:tab.groupId,incognito:tab.incognito}:{})});
  }
  r.state='ready';r.control_token=crypto.randomUUID();r.prepared=Date.now();r.element_id=control.element_id;
  if(r.catalog_source)control.control.catalog_target=r.catalog_source;
  return {tab_id:r.tab_id,preparation_id:r.id,snapshot_id:r.snapshot_id,control_token:r.control_token,requires_review:true,dispatched:false,elapsed_ms:Date.now()-now,...(command==='retry_preparation'?{preparation_recovery:{mode:args.recovery_mode,quick_used:r.quick_used}}:{}),control:control.control,ignored_changes:control.ignored_changes,timing:{preparation:timing},...(image?{image,image_sha256:r.image_sha256}:{}),next_step:'review_control_then_execute_prepared_action'};
 }catch(e){return failPreparation(e);}
 async function failPreparation(e){
  r.state='failed';r.failed_at=Date.now();r.failure=e.retry_diagnostic||{failure_id:crypto.randomUUID(),complete:false,changes:[],reason:e.message};
  r.failure.phase='preparation';r.failure.dispatch_state='not_dispatched';r.failure.saved_preparation={preparation_id:r.id,command:r.command,action:r.parameters.action};r.failure.preparation_retry={command:'retry_preparation',quick_available:!r.quick_used&&r.failure.complete&&r.failure.changes.every(c=>c.exception_allowed),exceptions_available:r.quick_used&&r.failure.complete&&r.failure.changes.every(c=>c.exception_allowed)};
  e.dispatch_state='not_dispatched';e.retry_diagnostic=r.failure;
  if(r.coordinate&&r.failure.viewport&&r.failure.changes.length){try{
   const vp=r.failure.viewport;await call({action:'hide_pointer',snapshot_id:r.snapshot_id});
   const shot=await (typeof brodexFrameSend==='function'?brodexFrameSend.bind(null,{tab_id:r.tab_id,snapshot_id:r.snapshot_id,expected_url:r.expected_url}):chrome.debugger.sendCommand.bind(chrome.debugger,{tabId:r.tab_id}))('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,clip:{x:vp.scroll_x,y:vp.scroll_y,width:vp.width,height:vp.height,scale:1}});
   const bytes=Uint8Array.from(atob(shot.data),c=>c.charCodeAt(0)),head=new DataView(bytes.buffer),w=head.getUint32(16),h=head.getUint32(20);if(bytes.length>8*1024*1024||w*h>24000000)throw Error('ERROR_IMAGE_TOO_LARGE');
   const regions=r.failure.changes.map(c=>c.bounds).filter(b=>b?.width>0&&b?.height>0);if(regions.length){const image=await brodexMaskControlImage(shot.data,w,h,vp,regions);e.image={mimeType:'image/png',data:image.data};r.failure.error_image={available:true,kind:'failure',masked:true,capture_is_atomic:false};}
  }catch(captureError){r.failure.error_image={available:false,reason:captureError.message};}}
  throw e;
 }
}

// Preparation recovery never dispatches the future input operation.
async function brodexRetryPreparation(args,api){
 const quick=args.recovery_mode==='quick';
 const allowed=quick?['tab_id','expected_url','failure_id','recovery_mode']:['tab_id','expected_url','failure_id','recovery_mode','snapshot_id','change_ids','reason'];
 if(!['quick','exceptions'].includes(args.recovery_mode)||Object.keys(args).some(k=>!allowed.includes(k)))throw Error('RETRY_ARGUMENT_NOT_ALLOWED');
 await api.guard(args.tab_id);await brodexRequireWork(args.tab_id);
 const record=brodexRetryRecords.get(args.tab_id);
 if(!record||record.kind!=='preparation'||record.used||record.failure_id!==args.failure_id||Date.now()-record.created>300000||record.expected_url!==args.expected_url||record.lease!==brodexDebugLeases.get(args.tab_id))throw Error('RETRY_PREPARATION_UNAVAILABLE');
 if(!record.report.complete||record.report.changes.some(c=>!c.exception_allowed))throw Error('RETRY_UNRESOLVED_CHANGES');
 if(quick&&record.quick_used)throw Error('QUICK_PREPARATION_ALREADY_USED');
 if(!quick){
  if(!record.quick_used)throw Error('QUICK_PREPARATION_REQUIRED');
  if(typeof args.reason!=='string'||!args.reason.trim()||args.reason.length>1000)throw Error('RETRY_REASON_REQUIRED');
  if(!Array.isArray(args.change_ids)||!args.change_ids.length||args.change_ids.length>256||new Set(args.change_ids).size!==args.change_ids.length||record.report.changes.some(c=>!args.change_ids.includes(c.change_id))||args.change_ids.some(id=>!record.report.changes.some(c=>c.change_id===id)))throw Error('RETRY_UNRESOLVED_CHANGES');
 }
 const overview=await api.read('brodexVisual:'+args.tab_id);
 if(!overview||overview.prepared||(quick?overview.snapshot_id!==record.visual.snapshot_id:overview.snapshot_id!==args.snapshot_id||overview.created<=record.created))throw Error('RETRY_FRESH_OVERVIEW_REQUIRED');
 if(overview.width!==record.visual.width||overview.height!==record.visual.height||JSON.stringify(overview.viewport)!==JSON.stringify(record.visual.viewport))throw Error('RETRY_VIEWPORT_CHANGED');
 record.used=true;
 const started=Date.now();
 const result=await brodexInteract('prepare_click',{...record.args,snapshot_id:overview.snapshot_id},api,{original:record,quick,prepare:{failure_id:record.failure_id,change_ids:quick?[]:args.change_ids,quick}});
 // Page-local retry rules stay bound to this control, not the recovery history.
 if(brodexRetryRecords.get(args.tab_id)===record)brodexRetryRecords.delete(args.tab_id);
 return {...result,preparation_recovery:{mode:args.recovery_mode,elapsed_ms:Date.now()-started,saved_preparation:record.action},next_step:'review_control_then_issue_separate_action'};
}

// Retry records never leave the extension worker and expire with the work lease.
const brodexRetryRecords=new Map();
async function brodexRetry(command,args,api){
 const allowed=command==='prepare_retry'?['tab_id','expected_url','failure_id','snapshot_id','change_ids','reason']:['tab_id','expected_url','retry_id','snapshot_id','control_image_sha256','control_token'];
 if(Object.keys(args).some(k=>!allowed.includes(k)))throw Error('RETRY_ARGUMENT_NOT_ALLOWED');
 await api.guard(args.tab_id);await brodexRequireWork(args.tab_id);
 for(const [id,item] of brodexRetryRecords)if(Date.now()-item.created>300000)brodexRetryRecords.delete(id);
 const record=brodexRetryRecords.get(args.tab_id);
 if(!record||Date.now()-record.created>300000||record.expected_url!==args.expected_url||record.lease!==brodexDebugLeases.get(args.tab_id))throw Error('RETRY_RECORD_EXPIRED');
 if(record.kind==='preparation')throw Error('RETRY_PREPARATION_REQUIRED');
 if(command==='prepare_retry'){
  if(record.failure_id!==args.failure_id||record.used||!record.report.complete)throw Error('RETRY_FAILURE_UNAVAILABLE');
  if(typeof args.reason!=='string'||!args.reason.trim()||args.reason.length>1000)throw Error('RETRY_REASON_REQUIRED');
  if(!Array.isArray(args.change_ids)||!args.change_ids.length||args.change_ids.length>256||new Set(args.change_ids).size!==args.change_ids.length)throw Error('RETRY_CHANGES_REQUIRED');
  if(record.report.changes.some(c=>!c.exception_allowed||!args.change_ids.includes(c.change_id))||args.change_ids.some(id=>!record.report.changes.some(c=>c.change_id===id)))throw Error('RETRY_UNRESOLVED_CHANGES');
  if(record.kind==='dom'){
   record.used=true;
   const result=await brodexInteract('prepare_dom_retry',{tab_id:args.tab_id,expected_url:args.expected_url,snapshot_id:args.snapshot_id,failure_id:record.failure_id,change_ids:args.change_ids},api,{original:record});
   record.retry_id=crypto.randomUUID();record.control=args.snapshot_id;record.controlToken=crypto.randomUUID();record.prepared=Date.now();record.consumed=false;record.element_id=result.element_id;
   return {...result,retry_id:record.retry_id,control_token:record.controlToken,saved_action:record.action,next_step:'review_dom_control_then_execute_retry'};
  }
  const overview=await api.read('brodexVisual:'+args.tab_id);
  if(!overview||overview.prepared||overview.snapshot_id!==args.snapshot_id||overview.created<=record.created)throw Error('RETRY_FRESH_OVERVIEW_REQUIRED');
  if(overview.width!==record.visual.width||overview.height!==record.visual.height||JSON.stringify(overview.viewport)!==JSON.stringify(record.visual.viewport))throw Error('RETRY_VIEWPORT_CHANGED');
  record.used=true;
  const token={failure_id:record.failure_id,change_ids:args.change_ids};
  const result=await brodexInteract('prepare_click',{tab_id:args.tab_id,expected_url:args.expected_url,snapshot_id:args.snapshot_id,x:record.args.x,y:record.args.y,context_regions:record.visual.context_regions,timing:record.args.timing},api,{prepare:token,original:record});
  record.retry_id=crypto.randomUUID();record.control=result.snapshot_id;record.hash=result.image_sha256;record.reason=args.reason;record.prepared=Date.now();record.consumed=false;
  return {...result,retry_id:record.retry_id,saved_action:record.action,next_step:'review_control_then_execute_retry'};
 }
 if(record.retry_id!==args.retry_id||record.control!==args.snapshot_id||(record.kind==='dom'?(args.control_image_sha256!==undefined||record.controlToken!==args.control_token):(args.control_token!==undefined||record.hash!==args.control_image_sha256)))throw Error('RETRY_CONTROL_MISMATCH');
 if(record.consumed)throw Error('RETRY_ALREADY_CONSUMED: inspect outcome');
 if(Date.now()-record.prepared>30000)throw Error('RETRY_CONTROL_EXPIRED');
 const v=await api.read('brodexVisual:'+args.tab_id);if(record.kind!=='dom'&&v?.snapshot_id!==record.control)throw Error('RETRY_CONTROL_STALE');
 record.consumed=true;
 const result=await brodexInteract(record.command,{...record.args,...(record.kind==='dom'?{element_id:record.element_id}:{}),snapshot_id:record.control,request_id:'retry-'+record.retry_id},api,{execute:true,original:record});
 return {...result,retry_id:record.retry_id,retry_request_id:'retry-'+record.retry_id};
}

// Mask only the emitted control image; DOM/ancestor/occlusion guards remain unchanged.
async function brodexMaskControlImage(data,width,height,viewport,regions){
 if(!Array.isArray(regions)||!regions.length||regions.length>4104)throw Error('CONTROL_MASK_REGIONS_INVALID');
 const rectangles=regions.map(r=>{
  if(![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0)throw Error('CONTROL_MASK_REGIONS_INVALID');
  const left=Math.max(0,Math.floor((r.x-4)*width/viewport.width)),top=Math.max(0,Math.floor((r.y-4)*height/viewport.height));
  const right=Math.min(width,Math.ceil((r.x+r.width+4)*width/viewport.width)),bottom=Math.min(height,Math.ceil((r.y+r.height+4)*height/viewport.height));
  return {x:left,y:top,width:right-left,height:bottom-top};
 }).filter(r=>r.width>0&&r.height>0);
 if(!rectangles.length)throw Error('CONTROL_MASK_EMPTY');
 const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
 let bitmap,canvas;
 try{
  bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
  if(bitmap.width!==width||bitmap.height!==height)throw Error('CONTROL_MASK_DIMENSIONS_CHANGED');
  canvas=new OffscreenCanvas(width,height);const ctx=canvas.getContext('2d');if(!ctx)throw Error('CONTROL_MASK_UNAVAILABLE');
  ctx.fillStyle='#e5e7eb';ctx.fillRect(0,0,width,height);
  ctx.save();ctx.beginPath();for(const r of rectangles)ctx.rect(r.x,r.y,r.width,r.height);ctx.clip();ctx.drawImage(bitmap,0,0);ctx.restore();
  const blob=await canvas.convertToBlob({type:'image/png'});if(blob.type!=='image/png')throw Error('CONTROL_MASK_FORMAT_INVALID');
  const output=new Uint8Array(await blob.arrayBuffer());if(output.length>8*1024*1024)throw Error('SCREENSHOT_TOO_LARGE: lossless PNG exceeds 8 MiB');
  let binary='';for(let i=0;i<output.length;i+=8192)binary+=String.fromCharCode(...output.subarray(i,i+8192));
  return {data:btoa(binary),bytes:output,mimeType:'image/png',region_count:rectangles.length};
 }finally{bitmap?.close();if(canvas){canvas.width=1;canvas.height=1;}}
}
// Narrow browser operations; the MCP never accepts executable scripts or CDP methods.
// Debugger lifetime is controlled by browser_work begin/end, never idle time.
const brodexDebugLeases=new Map();
const brodexDebugDetaching=new Map();
const brodexChooserBusy=new Set();
function brodexMcpOwnsDebugger(tabId){return brodexDebugLeases.has(tabId)||brodexDebugDetaching.has(tabId)||brodexDebugAttaching.has(tabId);}
const brodexDebugAttaching=new Set();
async function brodexReleaseDebug(tabId,lease){
 if(brodexDebugLeases.get(tabId)!==lease)return;
 clearTimeout(lease.timer);
 const pending=chrome.debugger.detach({tabId});
 brodexDebugDetaching.set(tabId,pending);
 try{await pending;if(brodexDebugLeases.get(tabId)===lease)brodexDebugLeases.delete(tabId);}
 catch(error){
  const stillAttached=(await chrome.debugger.getTargets()).some(t=>t.tabId===tabId&&t.attached);
  if(stillAttached)throw Error('DEBUGGER_RELEASE_FAILED: '+error.message);
  if(brodexDebugLeases.get(tabId)===lease)brodexDebugLeases.delete(tabId);
 }finally{if(brodexDebugDetaching.get(tabId)===pending)brodexDebugDetaching.delete(tabId);}
}
chrome.debugger?.onDetach?.addListener(target=>{const lease=brodexDebugLeases.get(target.tabId);if(lease){clearTimeout(lease.timer);lease.lost=true;brodexDebugLeases.delete(target.tabId);brodexRetryRecords.delete(target.tabId);brodexLoseWork(target.tabId);}});
async function brodexInteract(command,args,api,retryContext=null){
 let mayDispatch=false;let retryIgnored=[];let domPointerHovered=false;
 const routeScope=typeof brodexFrameScope==='function'&&(args.snapshot_id||args.frame_id)?brodexFrameScope({...args,_recovery:Boolean(retryContext?.original)}):null;
 if(routeScope&&command==='navigate')throw Error('FRAME_NAVIGATION_UNSUPPORTED: use a guarded link or navigate the top page');
 if(routeScope||args.frame_id){const originalApi=api;api={...api,handle:(name,a)=>originalApi.handle(name,name==='read_page'?{...a,frame_id:routeScope?.frame_id||args.frame_id}:a)};}
 if(['prepare_action','execute_prepared_action'].includes(command)||command==='retry_preparation'&&[...brodexPreparations.values()].some(r=>r.failure?.failure_id===args.failure_id))return brodexPreparedAction(command,args,api);
 if(command==='retry_preparation')return brodexRetryPreparation(args,api);
 if(['prepare_retry','execute_retry'].includes(command))return brodexRetry(command,args,api);
 try{
 const chrome=typeof brodexOperationChrome==='function'?brodexOperationChrome():globalThis.chrome;
 const {read,save,handle,view}=api;
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 function convertRegions(v){return (args.noncritical_regions||[]).map(r=>({x:r.x*v.viewport.width/v.width,y:r.y*v.viewport.height/v.height,width:r.width*v.viewport.width/v.width,height:r.height*v.viewport.height/v.height}));}
 const http=value=>{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('URL_NOT_SUPPORTED');return u.href;};
 const expected=http(args.expected_url),expectedHash=await brodexSessionPolicy.hash(expected);
 if(!Number.isInteger(args.tab_id)||args.tab_id<0)throw Error('INVALID_TAB_ID');
 async function current(requireExpected=true){
  let tab;try{tab=await chrome.tabs.get(args.tab_id);}catch{throw Error('TAB_NOT_FOUND');}
  http(tab.url);
  if(requireExpected&&(tab.url!==expected||tab.pendingUrl&&tab.pendingUrl!==expected))throw Error('PAGE_CHANGED: inspect list_tabs');
  return tab;
 }
 async function script(payload){
  await brodexRequireWork(args.tab_id);
  await current();
  const settings=await chrome.storage.local?.get('brodexShowActions')||{};
  if(retryContext?.preparedAction)payload={...payload,_prepared_execution:retryContext.preparedAction.id};
  const beforeDispatch=mayDispatch;
  const mutating=['click','fill','select','set_checked','scroll'].includes(payload.action);
  if(mutating)mayDispatch=true; // Lost executeScript response must remain unknown.
  const parameters={...payload,_show_pointer:settings.brodexShowActions!==false&&payload._show_pointer!==false&&payload._verify_pointer!==true,expected_url:expected};
  let value;try{value=typeof brodexRunPage==='function'?await brodexRunPage(args,brodexPageAction,parameters):(await chrome.scripting.executeScript({target:{tabId:args.tab_id,frameIds:[0]},world:'ISOLATED',func:brodexPageAction,args:[parameters]})).find(r=>r.frameId===0)?.result;}catch(e){if(e.brodex_preflight_refusal)mayDispatch=beforeDispatch;throw e;}
  if(!value)throw Error('DOCUMENT_UNAVAILABLE');if(value.error){mayDispatch=beforeDispatch;const e=Error(value.error);if(value.retry_diagnostic)e.retry_diagnostic=value.retry_diagnostic;if(value.unsupported_diagnostic)e.unsupported_diagnostic=value.unsupported_diagnostic;if(value.error==='DOM_CONTEXT_CHANGED'&&value.context_diagnostic)e.context_diagnostic=value.context_diagnostic;throw e;}
  if(value.ignored_changes?.length)retryIgnored=value.ignored_changes;;if(mutating&&value.dispatched!==true)mayDispatch=beforeDispatch;return value;
 }
 async function debug(job){
  await brodexRequireWork(args.tab_id);
  const lease=brodexDebugLeases.get(args.tab_id);
  try{return await job(async(method,params={})=>{
   if(lease.lost||brodexDebugLeases.get(args.tab_id)!==lease)throw Error('WORK_SESSION_DETACHED');
   if(retryContext?.preparedAction&&!mayDispatch&&method==='Input.dispatchMouseEvent'&&params.type==='mousePressed'){
    try{await script({action:'guard_action_bundle',snapshot_id:args.snapshot_id,preparation_id:retryContext.preparedAction.id,_dom_pointer_hover:domPointerHovered});}
    catch(e){e.brodex_preflight_refusal=true;throw e;}
   }
   const beforeInput=mayDispatch;
   if((method.startsWith('Input.')&&!(method==='Input.dispatchMouseEvent'&&params.type==='mouseMoved'&&!(command==='act'&&args.action==='hover_at')))||method==='DOM.setFileInputFiles'||method==='Page.navigateToHistoryEntry')mayDispatch=true;
   try{return typeof brodexFrameSend==='function'?await brodexFrameSend({...args,snapshot_id:undefined,frame_id:routeScope?.frame_id||args.frame_id||0},method,params):await chrome.debugger.sendCommand({tabId:args.tab_id},method,params);}catch(e){if(e.brodex_preflight_refusal)mayDispatch=beforeInput;throw e;}
  });}catch(error){throw error;} // Preserve guard and Chrome error codes.
  // A rejected action does not end active work or change viewport geometry.
 }
 async function observation(){
  try{const tab=await current(false);return await handle('read_page',{tab_id:tab.id,expected_url:tab.url});}
  catch(error){return {error:error.message};}
 }
 const timing=args.timing===undefined?undefined:brodexTiming.normalize(args.timing);
 async function hoverPrepared(send,payload){
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:payload.x,y:payload.y,button:'none',buttons:0,modifiers:0});
  const phase=await brodexTiming.wait(async()=>{await current();await script({action:'validate_prepared',snapshot_id:args.snapshot_id,...payload});return {key:1};},timing);
  if(!phase.matched)throw Error('TIMING_TIMEOUT: after_hover');
  return phase;
 }
 if(command==='wait_stable'){
  if(typeof args.snapshot_id!=='string'||typeof args.element_id!=='string')throw Error('STABILITY_TARGET_REQUIRED');
  const phase=await brodexTiming.wait(()=>script({action:'probe_stability',snapshot_id:args.snapshot_id,element_id:args.element_id,_show_pointer:false}),timing);
  await script({action:'retire_snapshot',snapshot_id:args.snapshot_id,_show_pointer:false});
  return {...phase,outcome:phase.matched?'target_stable':'unverified',reason:phase.matched?undefined:'TIMING_TIMEOUT',fresh_observation_required:true,notice:'Stability is not an action permit. Read fresh DOM or prepare a new reviewed control image.'};
 }
 if(command==='inspect_operation'){brodexValidateSeries(args,false);return {plan_id:args.plan_id,result:await brodexReadSeriesRecord(read,args.tab_id,args.plan_id),retry_action:false};}
 if(command==='execute_operation')return brodexExecuteSeries(args,{read,save,script,debug,current,expectedHash,guardTask:()=>api.guard(args.tab_id)});
 if(command==='read_page_code'){
  await current();
  if(!['page','element'].includes(args.scope))throw Error('INVALID_SCOPE');
  const max=args.max_chars??20000,offset=args.offset??0;
  if(!Number.isInteger(max)||max<100||max>30000||!Number.isInteger(offset)||offset<0||offset>300000)throw Error('INVALID_READ_LIMITS');
  const payload={...args};
  if(args.scope==='element'){
   if(!args.snapshot_id)throw Error('SNAPSHOT_REQUIRED');
   if(args.element_id&&(args.x!==undefined||args.y!==undefined))throw Error('AMBIGUOUS_TARGET');
   if(!args.element_id){
    const v=await read('brodexVisual:'+args.tab_id);
    if(!v||v.snapshot_id!==args.snapshot_id||v.expected_url_hash!==expectedHash||Date.now()-v.created>30000)throw Error('SCREENSHOT_REQUIRED');
    if(!Number.isFinite(args.x)||!Number.isFinite(args.y)||args.x<0||args.y<0||args.x>=v.width||args.y>=v.height)throw Error('INVALID_COORDINATES');
    payload.x=args.x*v.viewport.width/v.width;payload.y=args.y*v.viewport.height/v.height;
   }
  }else if(args.element_id!==undefined||args.x!==undefined||args.y!==undefined)throw Error('AMBIGUOUS_TARGET');
  const code=typeof brodexRunPage==='function'?await brodexRunPage(args,brodexPageCode,payload):(await chrome.scripting.executeScript({target:{tabId:args.tab_id,frameIds:[0]},world:'ISOLATED',func:brodexPageCode,args:[payload]})).find(r=>r.frameId===0)?.result;
  await current();
  if(!code)throw Error('DOCUMENT_UNAVAILABLE');if(code.error)throw Error(code.error);
  return {tab_id:args.tab_id,url:expected,code};
 }
 if(command==='wait_for'){
  if(!['ready','text_present','text_absent','element_present','all'].includes(args.condition))throw Error('INVALID_WAIT_CONDITION');
  const conditions=args.condition==='all'?args.conditions:[{condition:args.condition,text:args.text}];
  if(!Array.isArray(conditions)||!conditions.length||conditions.length>4||conditions.some(c=>!c||!['ready','text_present','text_absent','element_present'].includes(c.condition)))throw Error('INVALID_WAIT_CONDITION');
  if(conditions.some(c=>c.condition!=='ready'&&(typeof c.text!=='string'||!c.text.trim()||c.text.length>1000)))throw Error('WAIT_TEXT_REQUIRED');
  const stableMs=args.stable_ms??0;if(!Number.isInteger(stableMs)||stableMs<0||stableMs>3000)throw Error('INVALID_TIMEOUT');
  const timeout=args.timeout_ms??5000;if(!Number.isInteger(timeout)||timeout<0||timeout>10000)throw Error('INVALID_TIMEOUT');
  const started=Date.now();let latest,matchedSince=null;
  do{
   await current();latest=await handle('read_page',{tab_id:args.tab_id,expected_url:expected,max_chars:30000,max_elements:100});
   const page=latest.page;
   const matched=conditions.every(c=>c.condition==='ready'?latest.status==='complete'&&page.ready_state==='complete':c.condition==='text_present'?page.text.includes(c.text):c.condition==='text_absent'?!page.truncated.text&&!page.truncated.scan&&!page.text.includes(c.text):page.elements.some(e=>e.name.includes(c.text)));
   if(!matched)matchedSince=null;else if(matchedSince===null)matchedSince=Date.now();
   if(matched&&Date.now()-matchedSince>=stableMs)return {matched:true,outcome:'condition_matched',condition:args.condition,stable_ms:stableMs,elapsed_ms:Date.now()-started,observation:latest};
   if(Date.now()-started>=timeout)break;
   await sleep(Math.min(250,timeout-(Date.now()-started)));
  }while(true);
  return {matched:false,outcome:'unverified',reason:'WAIT_TIMEOUT',elapsed_ms:Date.now()-started,observation:latest};
 }
 if(command==='prepare_dom_retry'&&retryContext?.original)return script({...args,action:'prepare_dom_retry'});
 if(command==='inspect_snapshot_changes')return script({action:'inspect_snapshot_changes',snapshot_id:args.snapshot_id,element_ref:args.element_ref,offset:args.offset??0,limit:args.limit??20});
 if(command==='screenshot'||command==='prepare_click'||command==='prepare_operation'){
  await current();
  const series=command==='prepare_operation',preparing=command!=='screenshot';let source,chosen,seriesSteps;
  if(series){brodexValidateSeries(args);if(await brodexReadSeriesRecord(read,args.tab_id,args.plan_id))throw Error('SERIES_PLAN_ALREADY_USED');}
  if(preparing){
   source=await read('brodexVisual:'+args.tab_id);
   if(!source||source.snapshot_id!==args.snapshot_id||source.expected_url_hash!==expectedHash||Date.now()-source.created>30000)throw Error('SCREENSHOT_REQUIRED');
   if(series){
    for(const step of args.steps)if(step.x>=source.width||step.y>=source.height)throw Error('INVALID_COORDINATES');
    seriesSteps=args.steps.map(step=>({...step,x:step.x*source.viewport.width/source.width,y:step.y*source.viewport.height/source.height}));
   }else{
    if(!Number.isFinite(args.x)||!Number.isFinite(args.y)||args.x<0||args.y<0||args.x>=source.width||args.y>=source.height)throw Error('INVALID_COORDINATES');
    chosen={x:args.x*source.viewport.width/source.width,y:args.y*source.viewport.height/source.height};
   }
  }
  if(preparing&&!retryContext){for(const point of (series?seriesSteps:[chosen]))await script({action:'check_overview_target',snapshot_id:source.snapshot_id,...point});}
  let p,v,reviewRegions,preparedSteps,preparationTiming,captureDiagnostic;
  const shot=await debug(async send=>{
   await script({action:'hide_pointer'});
   // Chrome's infobar resizes the viewport asynchronously after attaching.
   // Require six equal samples; never let an image carry pre-resize coordinates.
   let last,stable=0;
   for(let i=0;i<30;i++){
    const snap=await handle('read_page',{tab_id:args.tab_id,expected_url:expected,max_chars:100,max_elements:1});p=snap.page;v=p.viewport;
    const key=JSON.stringify(v);stable=key===last?stable+1:0;last=key;
    if(stable>=5)break;
    await sleep(100);
   }
   if(stable<5)throw Error('VIEWPORT_UNSTABLE: wait before capturing again');
   await current();
   if(preparing){
    if(JSON.stringify(v)!==JSON.stringify(source.viewport))throw Error('STALE_SCREENSHOT: viewport changed');
    const regions=(args.context_regions||[]).map(r=>({x:r.x*v.width/source.width,y:r.y*v.height/source.height,width:r.width*v.width/source.width,height:r.height*v.height/source.height}));
    const prepared=await script({action:series?'prepare_series':'prepare_scoped',snapshot_id:p.snapshot_id,overview_guard:!series&&!retryContext,...chosen,context_regions:regions,...(retryContext?.prepare?{retry_prepare:retryContext.prepare}:{}),...(series?{plan_id:args.plan_id,steps:seriesSteps}:{})});reviewRegions=prepared.review_regions;preparedSteps=prepared.steps;
    const guard=()=>script({action:series?'series_guard':'validate_prepared',snapshot_id:p.snapshot_id,...chosen,...(series?{plan_id:args.plan_id}:{})});
    preparationTiming=await brodexTiming.wait(async()=>{await guard();return {key:1};},timing);if(!preparationTiming.matched)throw Error('TIMING_TIMEOUT: preparation');
   }
   if(!preparing)await script({action:'begin_overview',snapshot_id:p.snapshot_id});
   const {data}=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,clip:{x:v.scroll_x,y:v.scroll_y,width:v.width,height:v.height,scale:1}});
   if(typeof data!=='string'||!data.length||data.length>Math.ceil(8*1024*1024/3)*4)throw Error('SCREENSHOT_TOO_LARGE: lossless PNG exceeds 8 MiB; no lossy or resized fallback');
   await current();captureDiagnostic=await script({action:series?'series_guard':preparing?'validate_prepared':'finish_overview',snapshot_id:p.snapshot_id,...(chosen||{}),...(series?{plan_id:args.plan_id}:{})});
   return data;
  },true);
  // Overview bytes are the original Chrome PNG, without re-encoding or downscaling.
  const bytes=Uint8Array.from(atob(shot),c=>c.charCodeAt(0));
  if(bytes.length<24||![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')throw Error('INVALID_PNG');
  const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=header.getUint32(16),height=header.getUint32(20);
  if(!width||!height||width*height>24000000||bytes.length>8*1024*1024)throw Error('SCREENSHOT_TOO_LARGE: lossless image exceeds pixel or byte limit');
  const emitted=preparing?await brodexMaskControlImage(shot,width,height,v,reviewRegions):{data:shot,bytes,mimeType:'image/png'};
  const image_sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',emitted.bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const image_comparison=preparing?{source_snapshot_id:source.snapshot_id,exact_match:!preparing&&typeof source.image_sha256==='string'&&source.image_sha256===image_sha256}:undefined;
  const tab=await current(),points=series?preparedSteps.map(step=>({...step,x:step.x*width/v.width,y:step.y*height/v.height})):undefined;
  await save('brodexVisual:'+args.tab_id,{snapshot_id:p.snapshot_id,expected_url_hash:expectedHash,width,height,viewport:v,created:Date.now(),prepared:preparing,point:chosen,image_sha256,context_regions:args.context_regions,...(series?{series:true,plan_id:args.plan_id,steps:points,timing:brodexTiming.normalize(timing),window_id:tab.windowId,group_id:tab.groupId,incognito:tab.incognito}:{})});
  return {tab_id:args.tab_id,url:expected,mode:tab.incognito?'incognito':'normal',snapshot_id:p.snapshot_id,width,height,expires_in_ms:30000,frame_id:p.frame_id||0,coordinate_space:'image pixels, origin top-left',image_sha256,image_bytes:emitted.bytes.length,...(!preparing?{capture_diagnostic:captureDiagnostic}:{}),image_encoding:'png_lossless',...(preparationTiming?{timing:{preparation:preparationTiming}}:{}),...(image_comparison?{image_comparison}:{}),prepared:preparing,requires_review:preparing,dispatched:false,...(retryIgnored.length?{ignored_changes:retryIgnored}:{}),...(series?{plan_id:args.plan_id,steps:points}:preparing?{prepared_point:{x:chosen.x*width/v.width,y:chosen.y*height/v.height}}:{}),target_coverage:preparing?{complete:true,scope:'prepared_target_and_context'}:{status:'not_selected'},overview_correspondence:preparing?'fresh_control_requires_review':undefined,control_image:preparing?{masked:true,background:'#e5e7eb',padding_css_px:4,region_count:emitted.region_count,dimensions_preserved:true}:undefined,image:{mimeType:emitted.mimeType,data:emitted.data}};
 }
 if(!['press_key','mouse_click','drag','act','navigate','upload_file','upload_via_chooser'].includes(command))throw Error('UNKNOWN_COMMAND');
 if(typeof args.request_id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(args.request_id))throw Error('INVALID_REQUEST_ID');
 if(args.action_context!==undefined&&(command!=='act'||!['click','fill','select','set_checked','hover'].includes(args.action)))throw Error('INVALID_ACTION_CONTEXT');
 // Hash parameters so receipts never retain typed secrets. Stable key order matters on retry.
 const canonical=JSON.stringify([command,Object.keys(args).sort().map(key=>[key,args[key]])]);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
 const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const key='brodexActionReceipt:'+args.tab_id+':'+args.request_id,previous=await read(key);
 if(previous){
  if(previous.fingerprint!==fingerprint)throw Error('REQUEST_ID_CONFLICT');
  // A receipt is historical evidence, not a fresh failure report or permission to replay.
  if(previous.status==='refused'&&previous.dispatch_state==='not_dispatched')throw Error(previous.error);
  if(previous.status!=='done'){mayDispatch=true;throw Error('OUTCOME_UNKNOWN: inspect page; do not retry under a new request_id');}
  return {...previous.result,reused_request:true};
 }

 const modifierSpec={Alt:{key:'Alt',code:'AltLeft',windowsVirtualKeyCode:18,bit:1},Ctrl:{key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,bit:2},Shift:{key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,bit:8}};
 const modifiers=args.modifiers??[];
 if(!Array.isArray(modifiers)||modifiers.length>3||new Set(modifiers).size!==modifiers.length||modifiers.some(k=>!modifierSpec[k]))throw Error('INVALID_MODIFIERS');
 if(command==='press_key'&&(modifiers.includes('Alt')||(modifiers.includes('Ctrl')&&['Tab','PageUp','PageDown','Enter','Delete'].includes(args.key))))throw Error('BROWSER_SHORTCUT_NOT_SUPPORTED');
 function keySpec(key){const keys={Enter:13,Tab:9,Escape:27,Backspace:8,Delete:46,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Home:36,End:35,PageUp:33,PageDown:34,Space:32};if(keys[key])return {key:key==='Space'?' ':key,code:key,windowsVirtualKeyCode:keys[key]};if(/^[ACVXYZ]$/.test(key||'')&&modifiers.includes('Ctrl')&&!modifiers.includes('Alt'))return {key:key.toLowerCase(),code:'Key'+key,windowsVirtualKeyCode:key.charCodeAt(0)};return null;}
 async function withModifiers(send,job){const held=[];let bits=0,primary,answer;const failures=[];
  try{for(const name of modifiers){const {bit,...spec}=modifierSpec[name];bits|=bit;held.push(name);await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...spec,modifiers:bits});}answer=await job(bits);}
  catch(e){primary=e;}
  finally{for(const name of held.reverse()){const {bit,...spec}=modifierSpec[name];bits&=~bit;try{await send('Input.dispatchKeyEvent',{type:'keyUp',...spec,modifiers:bits});}catch{failures.push(name);}}}
  if(failures.length)throw Error('INPUT_RELEASE_FAILED');if(primary)throw primary;return answer;
 }

 await current();
 if(command==='press_key'||command==='mouse_click'){
  if(!args.snapshot_id)throw Error('SNAPSHOT_REQUIRED');
  if(command==='press_key'&&!keySpec(args.key))throw Error('INVALID_KEY');
  if(command==='mouse_click'&&(!Number.isFinite(args.x)||!Number.isFinite(args.y)||!['left','right'].includes(args.button||'left')))throw Error('INVALID_MOUSE_TARGET');
 }else if(command==='drag'){
  if(!args.snapshot_id)throw Error('SNAPSHOT_REQUIRED');
  for(const k of ['from_x','from_y','to_x','to_y'])if(!Number.isFinite(args[k]))throw Error('INVALID_COORDINATES');
  if(args.duration_ms!==undefined&&(!Number.isInteger(args.duration_ms)||args.duration_ms<200||args.duration_ms>3000))throw Error('INVALID_DURATION');
 }else if(command==='act'){
  if(!['click','fill','select','set_checked','scroll','click_at','hover','hover_at','wheel_at'].includes(args.action))throw Error('INVALID_ACTION');
  if(typeof args.snapshot_id!=='string'||!args.snapshot_id)throw Error('SNAPSHOT_REQUIRED');
  if(args.action==='fill'&&(typeof args.text!=='string'||args.text.length>10000))throw Error('INVALID_TEXT');
  if(args.action==='select'&&(typeof args.value!=='string'||args.value.length>1000))throw Error('INVALID_VALUE');
  if(args.action==='set_checked'&&typeof args.checked!=='boolean')throw Error('INVALID_CHECKED');
  if(args.action==='scroll')for(const key of ['delta_x','delta_y'])if(args[key]!==undefined&&(!Number.isInteger(args[key])||Math.abs(args[key])>10000))throw Error('INVALID_SCROLL');
  if(['click_at','hover_at'].includes(args.action)&&(!Number.isFinite(args.x)||!Number.isFinite(args.y)))throw Error('INVALID_COORDINATES');
  if(args.action==='hover_at'&&['element_id','noncritical_regions','modifiers','button','delta_x','delta_y'].some(k=>args[k]!==undefined))throw Error('AMBIGUOUS_HOVER_TARGET');
  if(args.action==='wheel_at'){
   if(!Number.isFinite(args.x)||!Number.isFinite(args.y))throw Error('INVALID_COORDINATES');
   if(args.element_id!==undefined||args.noncritical_regions!==undefined||args.modifiers!==undefined)throw Error('AMBIGUOUS_WHEEL_TARGET');
   for(const k of ['delta_x','delta_y'])if(args[k]!==undefined&&(!Number.isInteger(args[k])||Math.abs(args[k])>10000))throw Error('INVALID_SCROLL');
   if(!(args.delta_x||args.delta_y))throw Error('WHEEL_DELTA_REQUIRED');
  }
 }else if(['upload_file','upload_via_chooser'].includes(command)){
  if(args.user_confirmed!==true)throw Error('EXPLICIT_FILE_AUTHORIZATION_REQUIRED');
  if(typeof args.file_path!=='string'||! /^[a-zA-Z]:[\\/]/.test(args.file_path)||/[\x00-\x1f]/.test(args.file_path)||args.file_path.slice(2).includes(':'))throw Error('LOCAL_ABSOLUTE_FILE_REQUIRED');
  if(!args.snapshot_id||(command==='upload_file'&&!args.element_id))throw Error('SNAPSHOT_REQUIRED');
  if(command==='upload_via_chooser'&&(!Number.isFinite(args.x)||!Number.isFinite(args.y)))throw Error('INVALID_COORDINATES');
 }else{if(!['goto','back','reload'].includes(args.action))throw Error('INVALID_NAVIGATION');if(args.action==='goto')http(args.url);}

 await save(key,{status:'pending',fingerprint});
 let result;
 try{
  if(command==='press_key'){
   result=await debug(async send=>{await script({action:'keyboard_guard',snapshot_id:args.snapshot_id});await current();return withModifiers(send,async bits=>{const spec=keySpec(args.key);let pressed=false;try{pressed=true;await send('Input.dispatchKeyEvent',{type:'keyDown',...spec,modifiers:bits,...(args.key==='Enter'&&!(bits&3)?{text:'\r',unmodifiedText:'\r'}:args.key==='Space'&&!(bits&3)?{text:' ',unmodifiedText:' '}:{})});}finally{if(pressed)await send('Input.dispatchKeyEvent',{type:'keyUp',...spec,modifiers:bits});}return {dispatched:true,released:true};});});
  }else if(command==='mouse_click'){
   const v=await read('brodexVisual:'+args.tab_id);
   if(!v||v.snapshot_id!==args.snapshot_id||v.expected_url_hash!==expectedHash||Date.now()-v.created>30000||!brodexDebugLeases.has(args.tab_id))throw Error('SCREENSHOT_REQUIRED');
   if(args.x<0||args.y<0||args.x>=v.width||args.y>=v.height)throw Error('COORDINATES_OUTSIDE_IMAGE');
   const x=args.x*v.viewport.width/v.width,y=args.y*v.viewport.height/v.height,button=args.button||'left';
   result=await debug(async send=>{
    await script({action:'coordinate_target',snapshot_id:args.snapshot_id,x,y,target_aware:true,prepared_required:true,noncritical_regions:convertRegions(v)});
    const phase=await hoverPrepared(send,{x,y});
    return withModifiers(send,async bits=>{let pressed=false;try{await current();await script({action:'validate_prepared',snapshot_id:args.snapshot_id,x,y});pressed=true;await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button,buttons:button==='left'?1:2,clickCount:1,modifiers:bits});}finally{if(pressed)await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button,buttons:0,clickCount:1,modifiers:bits});await script({action:'pointer_result'}).catch(()=>{});}return {dispatched:true,released:true,button,timing:{after_hover:phase}};});
   });
  }else if(command==='drag'){
   const v=await read('brodexVisual:'+args.tab_id);
   if(!v||v.snapshot_id!==args.snapshot_id||v.expected_url_hash!==expectedHash||Date.now()-v.created>30000||!brodexDebugLeases.has(args.tab_id))throw Error('SCREENSHOT_REQUIRED');
   for(const [x,y] of [[args.from_x,args.from_y],[args.to_x,args.to_y]])if(x<0||y<0||x>=v.width||y>=v.height)throw Error('COORDINATES_OUTSIDE_IMAGE');
   const start={x:args.from_x*v.viewport.width/v.width,y:args.from_y*v.viewport.height/v.height},end={x:args.to_x*v.viewport.width/v.width,y:args.to_y*v.viewport.height/v.height};
   result=await debug(async send=>{
    const endTarget=await script({action:'coordinate_target',snapshot_id:args.snapshot_id,...end,allow_iframe:args.allow_iframe===true});
    const startTarget=await script({action:'coordinate_target',snapshot_id:args.snapshot_id,...start,allow_iframe:args.allow_iframe===true});
    if((startTarget.frame_token||null)!==(endTarget.frame_token||null))throw Error('FRAME_CHANGED: drag must stay in one frame');
    const frameToken=startTarget.frame_token||null;
    return withModifiers(send,async bits=>{
    let pressed=false,last=start;const duration=args.duration_ms??700,steps=Math.max(12,Math.ceil(duration/35));
    try{
     await current();
     await send('Input.dispatchMouseEvent',{type:'mouseMoved',...start,buttons:0,modifiers:bits});
     await script({action:'drag_guard',snapshot_id:args.snapshot_id,...start,frame_token:frameToken});
     pressed=true;await send('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1,modifiers:bits});
     for(let i=1;i<=steps;i++){
      await sleep(duration/steps);await current();
      const p={x:start.x+(end.x-start.x)*i/steps,y:start.y+(end.y-start.y)*i/steps};
      await script({action:'drag_guard',snapshot_id:args.snapshot_id,...p,frame_token:frameToken});
      last=p;await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p,button:'left',buttons:1,modifiers:bits});
     }
    }finally{
     if(pressed)await send('Input.dispatchMouseEvent',{type:'mouseReleased',...last,button:'left',buttons:0,clickCount:1,modifiers:bits});
     await script({action:'pointer_result'}).catch(()=>{});
    }
    return {dispatched:true,button:'left',released:true,verification:'Mouse sequence completed; inspect page or screenshot to verify object movement.'};
    });
   });
  }else if(command==='upload_via_chooser'){
   if(brodexChooserBusy.has(args.tab_id))throw Error('FILE_CHOOSER_BUSY');
   const visual=await read('brodexVisual:'+args.tab_id);
   if(!visual||visual.snapshot_id!==args.snapshot_id||visual.expected_url_hash!==expectedHash||Date.now()-visual.created>30000||!brodexDebugLeases.has(args.tab_id))throw Error('SCREENSHOT_REQUIRED');
   if(args.x<0||args.y<0||args.x>=visual.width||args.y>=visual.height)throw Error('COORDINATES_OUTSIDE_IMAGE');
   const x=args.x*visual.viewport.width/visual.width,y=args.y*visual.viewport.height/visual.height;
   brodexChooserBusy.add(args.tab_id);
   try{result=await debug(async send=>{
    let timer,listener,intercepted=false,armed=false,resolveEvent;
    const eventPromise=new Promise(resolve=>{resolveEvent=resolve;});
    try{
     await current();
     const {frameTree}=await send('Page.getFrameTree');
     listener=(target,method,params)=>{
      if(target.tabId===args.tab_id&&!target.sessionId&&method==='Page.fileChooserOpened'&&armed){armed=false;resolveEvent(params);}
     };
     chrome.debugger.onEvent.addListener(listener);
     await send('Page.enable');
     await send('Page.setInterceptFileChooserDialog',{enabled:true});intercepted=true;
     await script({action:'coordinate_target',snapshot_id:args.snapshot_id,x,y,file_chooser:true});
     await current();armed=true;
     timer=setTimeout(()=>resolveEvent(null),8000);
     await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
     await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
     const event=await eventPromise;
     if(!event)throw Error('FILE_CHOOSER_TIMEOUT: inspect page before another attempt');
     if(event.frameId!==frameTree.frame.id||!event.backendNodeId||event.mode!=='selectSingle')throw Error('FILE_CHOOSER_UNSUPPORTED');
     await current();
     const {node}=await send('DOM.describeNode',{backendNodeId:event.backendNodeId});
     const attrs={};for(let i=0;i<(node.attributes||[]).length;i+=2)attrs[node.attributes[i]]=node.attributes[i+1];
     if(node.nodeName!=='INPUT'||attrs.type?.toLowerCase()!=='file'||'webkitdirectory' in attrs||'disabled' in attrs)throw Error('FILE_CHOOSER_UNSUPPORTED');
     await send('DOM.setFileInputFiles',{backendNodeId:event.backendNodeId,files:[args.file_path]});
     return {assigned:true,chooser_intercepted:true,verification:'File assigned to the main-frame chooser opened by this click. Verify upload on the website.'};
    }finally{
     armed=false;clearTimeout(timer);if(listener)chrome.debugger.onEvent.removeListener(listener);
     if(intercepted)await send('Page.setInterceptFileChooserDialog',{enabled:false});
    }
   });}finally{brodexChooserBusy.delete(args.tab_id);}
  }else if(command==='upload_file'){
   result=await debug(async send=>{
    const field=await script({...args,action:'validate_file'});
    if(field.embedded||routeScope){
     const point=field.point;if(!point)throw Error('FILE_INPUT_LOCATION_UNAVAILABLE');
     if(typeof brodexEmbeddedFileTarget!=='function')throw Error('EMBEDDED_ADAPTER_UNAVAILABLE');
     const resolved=await brodexEmbeddedFileTarget(args,point);
     try{
      const check=await script({...args,action:'validate_file'});if(check.index!==field.index||check.point.x!==point.x||check.point.y!==point.y)throw Error('STALE_ELEMENT');
      await current();mayDispatch=true;await chrome.debugger.sendCommand(resolved.target,'DOM.setFileInputFiles',{backendNodeId:resolved.backendNodeId,files:[args.file_path]});
      return {assigned:true,verification:'File assigned to the guarded embedded input; verify the website outcome.'};
     }finally{await resolved.cleanup();}
    }
    const doc=await send('DOM.getDocument',{depth:0});
    const nodes=await send('DOM.querySelectorAll',{nodeId:doc.root.nodeId,selector:'input[type="file"]'});
    const nodeId=nodes.nodeIds[field.index];if(!nodeId)throw Error('FILE_INPUT_NOT_FOUND');
    const check=await script({...args,action:'validate_file'});if(check.index!==field.index)throw Error('STALE_ELEMENT');
    await current();await send('DOM.setFileInputFiles',{nodeId,files:[args.file_path]});
    return {assigned:true,verification:'File assigned; the website may upload immediately. Verify page outcome.'};
   });
  }else if(command==='act'){
   if(args.action==='hover_at'){
    const visual=await read('brodexVisual:'+args.tab_id);
    if(!visual||visual.snapshot_id!==args.snapshot_id||visual.expected_url_hash!==expectedHash||Date.now()-visual.created>30000||!brodexDebugLeases.has(args.tab_id))throw Error('SCREENSHOT_REQUIRED');
    if(args.x<0||args.y<0||args.x>=visual.width||args.y>=visual.height)throw Error('COORDINATES_OUTSIDE_IMAGE');
    const x=args.x*visual.viewport.width/visual.width,y=args.y*visual.viewport.height/visual.height;
    result=await debug(async send=>{
     await script({action:'coordinate_target',snapshot_id:args.snapshot_id,x,y,target_aware:true,prepared_required:true});
     const phase=await brodexTiming.wait(async()=>{await current();await script({action:'validate_prepared',snapshot_id:args.snapshot_id,x,y});return {key:1};},timing);
     if(!phase.matched)throw Error('TIMING_TIMEOUT: before_hover');
     await current();await script({action:'validate_prepared',snapshot_id:args.snapshot_id,x,y});
     await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',buttons:0,modifiers:0});
     // Hover may intentionally replace the target or reveal an overlay. No press follows.
     await script({action:'retire_snapshot',snapshot_id:args.snapshot_id,_show_pointer:false});
     return {dispatched:true,input_method:'pointer_hover',pressed:false,fresh_observation_required:true,timing:{before_hover:phase},verification:'Pointer moved without pressing. Inspect tooltip/menu or use wait_after. This result never authorizes a click at the old coordinates.'};
    });
   }else if(args.action==='click_at'){
    const visual=await read('brodexVisual:'+args.tab_id);
    if(!visual||visual.snapshot_id!==args.snapshot_id||visual.expected_url_hash!==expectedHash||Date.now()-visual.created>30000||!brodexDebugLeases.has(args.tab_id))throw Error('SCREENSHOT_REQUIRED');
    if(args.x<0||args.y<0||args.x>=visual.width||args.y>=visual.height)throw Error('COORDINATES_OUTSIDE_IMAGE');
    const x=args.x*visual.viewport.width/visual.width,y=args.y*visual.viewport.height/visual.height;
    result=await debug(async send=>{
     await script({action:'coordinate_target',snapshot_id:args.snapshot_id,x,y,target_aware:true,prepared_required:true,noncritical_regions:convertRegions(visual)});
     const phase=await hoverPrepared(send,{x,y});await current();
     let pressed=false;
     try{pressed=true;await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});}
     finally{if(pressed)await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});}
     await script({action:'pointer_result'}).catch(()=>{});
     return {dispatched:true,timing:{after_hover:phase}};
    });
   }else if(args.action==='wheel_at'){
    const visual=await read('brodexVisual:'+args.tab_id);
    if(!visual||visual.snapshot_id!==args.snapshot_id||visual.expected_url_hash!==expectedHash||Date.now()-visual.created>30000||!brodexDebugLeases.has(args.tab_id))throw Error('SCREENSHOT_REQUIRED');
    if(args.x<0||args.y<0||args.x>=visual.width||args.y>=visual.height)throw Error('COORDINATES_OUTSIDE_IMAGE');
    const x=args.x*visual.viewport.width/visual.width,y=args.y*visual.viewport.height/visual.height;
    result=await debug(async send=>{
     await script({action:'coordinate_target',snapshot_id:args.snapshot_id,x,y,target_aware:true,prepared_required:true,wheel_guard:true});
     await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',buttons:0,modifiers:0});
     // Real hover may open an overlay. The same strict guard runs throughout the wait.
     const hoverTiming=await brodexTiming.wait(async()=>{await script({action:'validate_prepared',snapshot_id:args.snapshot_id,x,y,wheel_guard:true});return {key:1};},timing);
     if(!hoverTiming.matched)throw Error('TIMING_TIMEOUT: after_hover');
     await current();
     await send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:args.delta_x||0,deltaY:args.delta_y||0,button:'none',buttons:0,modifiers:0,pointerType:'mouse'});
     await script({action:'pointer_result'}).catch(()=>{});
     return {dispatched:true,input_method:'pointer_wheel',timing:{after_hover:hoverTiming},verification:'Wheel delivered; inspect actual scrolling or zoom. Never assume the requested displacement occurred.'};
    });
   }else if(args.action==='click'){
    result=await script(args);
    if(result.pointer_click_required){
     const initial=result;
     result=await debug(async send=>{
      await current();
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:initial.x,y:initial.y,button:'none',buttons:0});
      domPointerHovered=true;
      // Hover, debugger attachment or layout can change the target: validate again.
      const target=await script({...args,_verify_pointer:true});
      if(!target.pointer_click_required||Math.abs(target.x-initial.x)>0.5||Math.abs(target.y-initial.y)>0.5)throw Error('STALE_ELEMENT: target moved');
      let pressed=false;
      try{
       pressed=true;
       await send('Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',buttons:1,clickCount:1});
      }catch(e){if(e.brodex_preflight_refusal)pressed=false;throw e;
      }finally{
       if(pressed)await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',buttons:0,clickCount:1});
       await script({action:'pointer_result'}).catch(()=>{});
      }
      return {dispatched:true,input_method:'dom_target_pointer',verification:'Inspect the resulting state; input dispatch does not prove success.'};
     });
    }
   }else if(args.action==='fill'){
    result=await script(args);
    if(result.editor_input_required){
     result=await debug(async send=>{
      await current();
      const checked=await script({...args,_verify_editor:true,_verify_pointer:true});
      if(!checked.editor_input_required)throw Error('EDITOR_TARGET_CHANGED');
      await send('Input.insertText',{text:args.text});
      return {dispatched:true,input_method:'contenteditable_browser',verification:'Inspect editor and send separately; text insertion does not submit.'};
     });
    }
   }else if(args.action==='hover'){


    result=await debug(async send=>{
     await current();
     const target=await script(args);
     await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:target.x,y:target.y,button:'none',buttons:0});
     const phase=await brodexTiming.wait(()=>script({action:'probe_stability',snapshot_id:args.snapshot_id,element_id:args.element_id,_show_pointer:false}),timing);
     return {dispatched:true,timing:{after_hover:phase},verification:'Pointer moved without pressing. Stability only refers to the hovered target, not proof of a loaded menu. Inspect a fresh observation or use wait_after.'};
    });
   }else result=await script(args);
  }else{
   await current();
   if(args.action==='goto'){const url=http(args.url);mayDispatch=true;await chrome.tabs.update(args.tab_id,{url});}
   if(args.action==='reload'){mayDispatch=true;await chrome.tabs.reload(args.tab_id);}
   if(args.action==='back')await debug(async send=>{
    await current();const history=await send('Page.getNavigationHistory');const entry=history.entries[history.currentIndex-1];if(!entry)throw Error('NO_PREVIOUS_PAGE');http(entry.url);await send('Page.navigateToHistoryEntry',{entryId:entry.id});
   });
   result={dispatched:true};
  }
  result={action:args.action,...result,...(retryIgnored.length?{ignored_changes:retryIgnored}:{}),dispatch_state:result.dispatched===true?'sent':result.dispatched===false?'not_sent':'unknown',outcome:'unverified'};
  await save(key,{status:'done',fingerprint,result});if(result.dispatched&&!retryContext?.preparedAction)for(const [id,r] of brodexPreparations)if(r.tab_id===args.tab_id)brodexPreparations.delete(id);if(result.dispatched&&!retryContext)brodexRetryRecords.delete(args.tab_id);
 }catch(error){await save(key,{status:mayDispatch?'unknown':'refused',dispatch_state:mayDispatch?'unknown':'not_dispatched',fingerprint,error:error.message}).catch(()=>{});throw error;}
 await sleep(150);
 // A dispatched click is not proof of the user's outcome. Return evidence separately.
 return {...result,frame_id:routeScope?.frame_id||0,observation:await observation()};
 }catch(error){
  error.dispatch_state=mayDispatch?'unknown':'not_dispatched';if(mayDispatch)for(const [id,r] of brodexPreparations)if(r.tab_id===args.tab_id)brodexPreparations.delete(id);
  if(error.retry_diagnostic){
   const d=error.retry_diagnostic;d.dispatch_state=error.dispatch_state;
   try{
    const v=await api.read('brodexVisual:'+args.tab_id);
    const dom=d.kind==='dom',preparation=command==='prepare_click'&&(!retryContext?.original||retryContext.original.kind==='preparation');
    const supported=preparation||dom&&command==='act'&&['click','fill','select','set_checked','hover'].includes(args.action)||Boolean(retryContext?.original)||command==='mouse_click'||command==='act'&&['click_at','wheel_at','hover_at'].includes(args.action);
    const original=retryContext?.original;
    const action=original?.action||{action_id:crypto.randomUUID(),tab_id:args.tab_id,command,action:args.action||command,x:args.x,y:args.y,button:args.button,modifiers:args.modifiers,delta_x:args.delta_x,delta_y:args.delta_y};
    action.kind=dom?'dom':'coordinate';if(dom)action.target_ref=d.target_ref;d.saved_action=action;d.retry_available=supported&&!mayDispatch&&d.complete&&d.changes.every(c=>c.exception_allowed);
    if(supported&&!mayDispatch&&(preparation||dom||v?.prepared||original)){
     if(brodexRetryRecords.size>=64&&!brodexRetryRecords.has(args.tab_id))brodexRetryRecords.delete(brodexRetryRecords.keys().next().value);
     brodexRetryRecords.set(args.tab_id,{kind:preparation?'preparation':dom?'dom':'coordinate',quick_used:original?.quick_used||retryContext?.quick===true,failure_id:d.failure_id,created:Date.now(),expected_url:args.expected_url,lease:brodexDebugLeases.get(args.tab_id),command:original?.command||command,args:original?.args||JSON.parse(JSON.stringify(args)),action,visual:original?.visual||(preparation?{...v,context_regions:args.context_regions}:v),report:d,used:false});
    }
    if(preparation){const rec=brodexRetryRecords.get(args.tab_id);d.phase='preparation';d.retry_available=false;d.preparation_retry={quick_available:!rec?.quick_used&&d.complete&&d.changes.every(c=>c.exception_allowed),exceptions_available:Boolean(rec?.quick_used)&&d.complete&&d.changes.every(c=>c.exception_allowed),command:'retry_preparation'};}
    if(dom){d.error_image={available:false,required:false};throw error;}
    await brodexRequireWork(args.tab_id);
    const chrome=typeof brodexOperationChrome==='function'?brodexOperationChrome():globalThis.chrome;
    await chrome.scripting.executeScript({target:{tabId:args.tab_id,frameIds:[0]},world:'ISOLATED',func:brodexPageAction,args:[{action:'hide_pointer',expected_url:args.expected_url}]});
    const vp=d.viewport;
    const shot=await (typeof brodexFrameSend==='function'?brodexFrameSend.bind(null,args):chrome.debugger.sendCommand.bind(chrome.debugger,{tabId:args.tab_id}))('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,clip:{x:vp.scroll_x,y:vp.scroll_y,width:vp.width,height:vp.height,scale:1}});
    const bytes=Uint8Array.from(atob(shot.data),c=>c.charCodeAt(0)),head=new DataView(bytes.buffer),w=head.getUint32(16),h=head.getUint32(20);
    if(bytes.length>8*1024*1024||w*h>24000000)throw Error('ERROR_IMAGE_TOO_LARGE');
    const regions=d.changes.map(c=>c.bounds).filter(r=>r&&r.width>0&&r.height>0);
    if(!regions.length)regions.push({x:0,y:0,width:vp.width,height:vp.height});
    const masked=await brodexMaskControlImage(shot.data,w,h,vp,regions);
    error.image={mimeType:'image/png',data:masked.data};d.error_image={width:w,height:h,masked:true,kind:'failure',coordinate_space:'CSS pixels for bounds; image pixels scaled by viewport',capture_is_atomic:false};
   }catch(captureError){if(captureError===error)throw error;d.error_image={available:false,reason:captureError.message};d.retry_available=false;if(d.preparation_retry)d.preparation_retry={command:'retry_preparation',quick_available:false,exceptions_available:false};const rec=brodexRetryRecords.get(args.tab_id);if(rec?.failure_id===d.failure_id)rec.used=true;}
  }
  throw error;
 }
}







