// Explicit active-work boundaries. No automatic reattach after user detachment.
const brodexWorkStates=new Map();
async function brodexInvalidateWork(tabId,api=globalThis.chrome){
 const chrome=api;
 if(typeof brodexV2Records!=='undefined')for(const [id,r] of brodexV2Records)if(r.tab_id===tabId)brodexV2Delete(id);
 if(typeof brodexRetryRecords!=='undefined')brodexRetryRecords.delete(tabId);
 await chrome.storage.session.remove('brodexVisual:'+tabId);
 await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'ISOLATED',func:()=>{
  clearTimeout(globalThis.__brodexSnapshot?.expiryTimer);
  globalThis.__brodexSnapshot?.observer?.disconnect();
  globalThis.__brodexSnapshot?.disposeFrames?.();
  globalThis.__brodexSnapshot=null;
  globalThis.__brodexActionV2?.observers?.forEach(o=>o.disconnect());clearTimeout(globalThis.__brodexActionV2?.timer);clearTimeout(globalThis.__brodexActionV2?.uiTimer);globalThis.__brodexActionV2?.ui?.remove();globalThis.__brodexActionV2=null;
  globalThis.__brodexRetryState=null;globalThis.__brodexOverviewTarget=null;
  globalThis.__brodexPointer?.hide?.();clearTimeout(globalThis.__brodexV2PointerTimer);globalThis.__brodexV2PointerTimer=null;globalThis.__brodexV2PointerHost?.remove();globalThis.__brodexV2PointerHost=null;
 }}).catch(()=>{}); // Closed/navigating/inaccessible tab: background guard still blocks actions.
}
function brodexLoseWork(tabId){
 const state=brodexWorkStates.get(tabId);
 if(state&&state.state!=='ended'){state.state='detached';state.invalidation=brodexInvalidateWork(tabId);}
}
async function brodexRequireWork(tabId){
 const state=brodexWorkStates.get(tabId),lease=brodexDebugLeases.get(tabId);
 if(!state||state.state!=='active'||!lease||lease.lost)throw Error('WORK_SESSION_REQUIRED: begin browser_work, then read fresh page');
 const targets=await chrome.debugger.getTargets();
 if(!targets.some(t=>t.tabId===tabId&&t.attached)){
  brodexLoseWork(tabId);throw Error('WORK_SESSION_DETACHED: begin explicitly and read fresh page');
 }
}
async function brodexBrowserWork(args){
 const chrome=typeof brodexOperationChrome==='function'?brodexOperationChrome():globalThis.chrome;
 const id=args.tab_id;
 if(!Number.isInteger(id)||id<0||!['normal','incognito'].includes(args.mode)||!['begin','end','status'].includes(args.action))throw Error('INVALID_WORK_SESSION');
 let tab;try{tab=await chrome.tabs.get(id);}catch{if(args.action!=='end')throw Error('TAB_NOT_FOUND');}
 if(tab&&(tab.incognito?'incognito':'normal')!==args.mode)throw Error('MODE_MISMATCH');
 const old=brodexWorkStates.get(id);
 if(args.action==='status'){
  const attached=Boolean(brodexDebugLeases.get(id)&&!brodexDebugLeases.get(id).lost&&(await chrome.debugger.getTargets()).some(t=>t.tabId===id&&t.attached));
  return {tab_id:id,state:old?.state==='active'&&!attached?'detached':old?.state||'inactive',attached};
 }
 if(args.action==='end'){
  if(old?.invalidation)await old.invalidation;
  brodexWorkStates.set(id,{state:'ended'});
  await brodexInvalidateWork(id,chrome);
  const lease=brodexDebugLeases.get(id);if(lease)await brodexReleaseDebug(id,lease);
  // Do not detach a debugger belonging to another client.
  brodexWorkStates.delete(id);
  return {tab_id:id,state:'ended',snapshots_invalidated:true};
 }
 if(typeof args.expected_url!=='string'||!args.expected_url){const e=Error('EXPECTED_URL_REQUIRED: browser_work begin requires expected_url');e.dispatch_state='not_dispatched';throw e;}
 let url;try{url=new URL(args.expected_url);}catch{const e=Error('INVALID_EXPECTED_URL');e.dispatch_state='not_dispatched';throw e;}
 const started=Date.now(),trace=[];let attachAttempted=false;
 const mark=(stage,data={})=>{if(trace.length<40)trace.push({stage,elapsed_ms:Date.now()-started,...data});};
 mark('precheck',{url_matches:tab.url===url.href,pending_navigation:!!tab.pendingUrl});
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('URL_NOT_SUPPORTED');
 if(tab.url!==url.href||tab.pendingUrl){const e=Error('PAGE_CHANGED');e.dispatch_state='not_dispatched';e.work_diagnostic={version:1,trace,failed_stage:'precheck',debugger_attached:false};throw e;}
 if(old?.state==='active'){
  await brodexRequireWork(id);
  return {tab_id:id,state:'active',already_active:true,next_step:'read_page_or_screenshot'};
 }
 if(old?.invalidation)await old.invalidation;
 await brodexDebugDetaching.get(id);
 await brodexInvalidateWork(id,chrome);
 const state={state:'starting'};brodexWorkStates.set(id,state);
 let lease,baseline,failedStage='before_attach';
 async function sample(stage){
  const rows=await chrome.scripting.executeScript({target:{tabId:id,frameIds:[0]},world:'ISOLATED',func:expected=>({url:location.href,url_matches:location.href===expected,origin:performance.timeOrigin,width:innerWidth,height:innerHeight,scroll_x:scrollX,scroll_y:scrollY,scale:visualViewport?.scale??1}),args:[url.href]});
  const row=rows?.find(r=>r.frameId===0);if(!row?.result)throw Error('DOCUMENT_UNAVAILABLE');
  const v=row.result,changed=baseline?((baseline.documentId&&row.documentId)?baseline.documentId!==row.documentId:baseline.origin!==v.origin):false;
  mark(stage,{url_matches:v.url_matches,document_changed:changed,width:v.width,height:v.height,scroll_x:v.scroll_x,scroll_y:v.scroll_y,scale:v.scale});
  return {...v,documentId:row.documentId,document_changed:changed};
 }
 try{
  baseline=await sample('before_attach');if(!baseline.url_matches)throw Error('PAGE_CHANGED');
  failedStage='attach';attachAttempted=true;mark('attach_requested');
  brodexDebugAttaching.add(id);
  try{await chrome.debugger.attach({tabId:id},'1.3');}finally{brodexDebugAttaching.delete(id);}
  lease={lost:false};brodexDebugLeases.set(id,lease);mark('attach_completed');failedStage='stabilization';
  let last,stable=0,value,urlChanged=false,documentChanged=false,settled=false;
  // Stabilize exact URL and viewport together. Same-document changes require fresh observation, never reuse of action context.
  for(let i=0;i<30;i++){
   value=await sample('stabilization');urlChanged ||= !value.url_matches;documentChanged ||= value.document_changed;
   if(documentChanged)break;
   const key=JSON.stringify([value.width,value.height,value.scroll_x,value.scroll_y,value.scale,value.url]);stable=key===last?stable+1:0;last=key;
   if(stable>=5){settled=true;break;}await new Promise(r=>setTimeout(r,100));
  }
  failedStage='post_stabilization';const current=await chrome.tabs.get(id);mark('post_stabilization',{url_matches:current.url===url.href,pending_navigation:!!current.pendingUrl,document_changed:documentChanged});
  if(documentChanged)throw Error('DOCUMENT_CHANGED_DURING_BEGIN');
  if(current.pendingUrl)throw Error('PAGE_CHANGED');
  if(current.groupId!==tab.groupId||current.windowId!==tab.windowId||!!current.incognito!==!!tab.incognito)throw Error('TASK_MEMBERSHIP_CHANGED');
  const finalSample=await sample('final_document_check');
  if(finalSample.document_changed)throw Error('DOCUMENT_CHANGED_DURING_BEGIN');
  if(finalSample.url!==value.url||current.url!==finalSample.url)throw Error('PAGE_CHANGED_AFTER_STABILIZATION');
  if(['width','height','scroll_x','scroll_y','scale'].some(k=>finalSample[k]!==value[k]))throw Error('VIEWPORT_UNSTABLE');
  const actual=new URL(finalSample.url);
  if(!['http:','https:'].includes(actual.protocol)||actual.username||actual.password||actual.origin!==url.origin)throw Error('URL_NOT_SUPPORTED');
  if(!settled)throw Error('VIEWPORT_UNSTABLE');
  if(state.state!=='starting'||lease.lost||brodexDebugLeases.get(id)!==lease)throw Error('WORK_SESSION_DETACHED');
  state.state='active';
  const {width,height,scroll_x,scroll_y,scale}=value;
  return {tab_id:id,state:'active',current_url:finalSample.url,url_changed_during_begin:urlChanged||finalSample.url!==url.href,same_document:true,fresh_observation_required:true,viewport:{width,height,scroll_x,scroll_y,scale},snapshots_invalidated:true,next_step:'read_fresh_page_or_screenshot_at_current_url_then_reassess',work_diagnostic:{version:1,trace,debugger_attached:true}};
 }catch(error){
  state.state='detached';let cleanup='not_needed';
  if(lease&&!lease.lost){try{await brodexReleaseDebug(id,lease);cleanup='detached';mark('detach_completed');await sample('after_detach');}catch{cleanup='unverified';}}
  error.dispatch_state=attachAttempted?'unknown':'not_dispatched';
  error.work_diagnostic={version:1,trace,failed_stage:failedStage,attach_attempted:attachAttempted,cleanup};throw error;
 }

}
chrome.tabs.onRemoved?.addListener(id=>{brodexWorkStates.delete(id);brodexDebugLeases.delete(id);});
