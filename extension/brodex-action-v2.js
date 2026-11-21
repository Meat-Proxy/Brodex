// Versioned coordinator. Detailed controls, reports and allowances are RAM-only.
const brodexV2Records=new Map();
function brodexV2Delete(id){const r=brodexV2Records.get(id);if(r)clearTimeout(r.timer);brodexV2Records.delete(id);}
async function brodexActionV2(args,api){
 const P=brodexActionPolicy;
 P.keys(args,['phase','tab_id','expected_url','snapshot_id','action','preparation_id','control_token','report_id','exceptions','image']);
 if(args.phase==='capabilities')return {protocol:'brodex-action/2',methods:P.operations,limits:{nodes:512,changes:256,control_ms:30000,record_ms:300000},quick_retry:false};
 if(!['prepare','control','retry','execute'].includes(args.phase)||!Number.isInteger(args.tab_id)||typeof args.expected_url!=='string')throw Error('V2_INVALID_ARGUMENTS');
 if(args.image!==undefined&&typeof args.image!=='boolean')throw Error('V2_INVALID_IMAGE');
 if(args.phase==='prepare'){P.validateAction(args.action);if(args.action.target.catalog_target){if(args.snapshot_id!==undefined||args.action.context?.element_ids?.length)throw Error('V2_CATALOG_CONFLICT');}else if(!P.id(args.snapshot_id))throw Error('V2_OBSERVATION_REQUIRED');}
 else if(!P.id(args.preparation_id))throw Error('V2_PREPARATION_REQUIRED');
 const allowed={prepare:['phase','tab_id','expected_url','snapshot_id','action','image'],control:['phase','tab_id','expected_url','preparation_id','image'],retry:['phase','tab_id','expected_url','preparation_id','report_id','image'],execute:['phase','tab_id','expected_url','preparation_id','control_token','report_id','exceptions']};P.keys(args,allowed[args.phase]);
 await api.guard(args.tab_id);await brodexRequireWork(args.tab_id);
 const chrome=brodexOperationChrome(),tab=await chrome.tabs.get(args.tab_id),lease=brodexDebugLeases.get(args.tab_id);
 if(tab.url!==args.expected_url||tab.pendingUrl)throw Error('V2_DOCUMENT_CHANGED');
 for(const [id,r] of brodexV2Records)if(Date.now()-r.created>300000||r.lease!==brodexDebugLeases.get(r.tab_id))brodexV2Delete(id);
 let r=args.phase==='prepare'?null:brodexV2Records.get(args.preparation_id);
 if(r&&(r.tab_id!==args.tab_id||r.url!==args.expected_url||r.lease!==lease))throw Error('V2_CONTROL_UNAVAILABLE');
 if(args.phase!=='prepare'&&!r)throw Error('V2_CONTROL_UNAVAILABLE');
 const show=(await chrome.storage.local.get('brodexShowActions')).brodexShowActions!==false;
 async function identity(){await api.guard(args.tab_id);await brodexRequireWork(args.tab_id);const t=await chrome.tabs.get(args.tab_id);if(r.lease!==brodexDebugLeases.get(args.tab_id)||t.url!==r.url||t.pendingUrl||t.groupId!==r.group||t.windowId!==r.window||t.incognito!==r.incognito)throw Error('V2_SESSION_CHANGED');}
 const call=async(phase,extra={})=>{
  await identity();if(r.scope)await brodexFrameGuard(r.scope);
  const rows=await chrome.scripting.executeScript({target:{tabId:r.tab_id,documentIds:[r.documentId]},world:'ISOLATED',func:brodexActionPageV2,args:[{phase,preparation_id:r.id,snapshot_id:r.snapshot,expected_url:r.pageUrl,...extra}]});
  const v=rows.find(x=>x.documentId===r.documentId)?.result;if(!v)throw Error('V2_DOCUMENT_CHANGED');if(v.error)throw Error(v.error);if(r.scope)await brodexFrameGuard(r.scope,['prepare','guard','perform'].includes(phase)?v.point:undefined);return v;
 };
 async function image(kind,control){
  try{
   await call('hide');
   const capture={format:'png',fromSurface:true,captureBeyondViewport:false};
   const shot=r.scope?await brodexFrameSend({tab_id:r.tab_id,snapshot_id:r.snapshot},'Page.captureScreenshot',{...capture,clip:{x:0,y:0,width:control.viewport.width,height:control.viewport.height,scale:1}}):await chrome.debugger.sendCommand({tabId:r.tab_id},'Page.captureScreenshot',capture);
   const bytes=Uint8Array.from(atob(shot.data),x=>x.charCodeAt(0)),d=new DataView(bytes.buffer),width=d.getUint32(16),height=d.getUint32(20);
   if(bytes.length>8*1024*1024||width*height>24000000)throw Error('SCREENSHOT_TOO_LARGE');
   const after=await call('inspect');
   if(!equalViewport(control.viewport,after.viewport))throw Error('V2_CAPTURE_VIEWPORT_CHANGED');
   const regions=kind==='failure'?control.report.changes.map(c=>c.bounds).filter(Boolean):control.regions;
   const selected=regions.length?regions:control.regions;
   const masked=await brodexMaskControlImage(shot.data,width,height,control.viewport,selected);
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',masked.bytes)),x=>x.toString(16).padStart(2,'0')).join('');
   return {image:{mimeType:'image/png',data:masked.data},evidence:{kind,image_id:crypto.randomUUID(),baseline_id:control.baseline_id,sha256:hash,width,height,masked:true,capture_is_atomic:false,capture_report:after.report,correspondence:after.report.changes.length||after.report.blockers.length?'changed_during_capture':'checked'}};
  }catch(e){return {evidence:{kind,available:false,reason:safeError(e)}};}
 }
 const safeError=e=>/^[A-Z0-9_: ]{1,120}$/.test(e.message)?e.message:'V2_ADAPTER_ERROR';
 function equalViewport(a,b){return JSON.stringify(a)===JSON.stringify(b);}
 async function feedback(failed,control){await call('feedback',{show,failed,regions:failed?control.report.changes.map(c=>c.bounds).filter(Boolean):control.regions}).catch(()=>{});}
 async function ready(control){
  r.report=control.report;r.control=control;r.token=crypto.randomUUID();r.prepared=Date.now();r.state=control.report.blockers.length?'blocked':'ready';
  const picture=(r.action.method==='coordinate'||args.image===true||r.state==='blocked')?await image(r.state==='blocked'?'failure':'control',control):{};
  if(picture.evidence?.capture_report){
   const cap=picture.evidence.capture_report;
   // A changed capture is evidence for review, never silently promoted to a new baseline.
   if(cap.changes.length||cap.blockers.length){r.report=cap;r.control.report=cap;}
   if(cap.blockers.length)r.state='blocked';
  }
  if(r.action.method==='coordinate'&&(!picture.image||picture.evidence?.correspondence!=='checked'))r.state='blocked';
  await feedback(r.state==='blocked',control);
  return {protocol:'brodex-action/2',mode:r.incognito?'incognito':'normal',status:r.state,action_id:r.actionId,preparation_id:r.id,control_token:r.state==='ready'?r.token:null,report:r.report,control:{baseline_id:control.baseline_id,target:control.target,point:control.point,regions:control.regions,viewport:control.viewport},execution:{dispatch_state:'not_dispatched',stages:[]},...picture};
 }
 if(args.phase==='prepare'){
  const catalogSource=args.action.target.catalog_target;
  if(catalogSource){
   const binding=await brodexCatalogActionObservation({tab_id:args.tab_id,expected_url:args.expected_url,command:'act',parameters:{action:'click'},catalog_target:catalogSource,protocol:2},api);
   args={...args,snapshot_id:binding.snapshot_id,action:{...args.action,target:{element_id:binding.element_id}}};
  }
  if(brodexV2Records.size>=64&&!Array.from(brodexV2Records.values()).some(x=>x.tab_id===args.tab_id))throw Error('V2_RECORD_LIMIT');
  // Reuse the existing observation; do not inject into an unobserved nested document.
  const scope=brodexFrameScope({tab_id:args.tab_id,snapshot_id:args.snapshot_id});
  if(scope)await brodexFrameGuard(scope);
  const probe=await chrome.scripting.executeScript({target:scope?{tabId:args.tab_id,documentIds:[scope.document_id]}:{tabId:args.tab_id,frameIds:[0]},world:'ISOLATED',func:()=>({url:location.href,snapshot:globalThis.__brodexSnapshot?.id})});
  const current=probe.find(x=>scope?x.documentId===scope.document_id:x.frameId===0);if(!current?.documentId||current.result?.snapshot!==args.snapshot_id||current.result.url!==(scope?.url||args.expected_url))throw Error('V2_OBSERVATION_CHANGED');
  let action=structuredClone(args.action),overviewViewport;
  if(action.method==='coordinate'){
   const v=await api.read('brodexVisual:'+args.tab_id);
   if(!v||v.prepared||v.snapshot_id!==args.snapshot_id||Date.now()-v.created>30000)throw Error('V2_OVERVIEW_REQUIRED');
   const sx=v.viewport.width/v.width,sy=v.viewport.height/v.height;
   overviewViewport=v.viewport;
   action.target={x:action.target.x*sx,y:action.target.y*sy};action.context.regions=action.context.regions.map(z=>({x:z.x*sx,y:z.y*sy,width:z.width*sx,height:z.height*sy}));
  }
  for(const [id,old] of brodexV2Records)if(old.tab_id===args.tab_id)brodexV2Delete(id);
  r={id:crypto.randomUUID(),actionId:crypto.randomUUID(),tab_id:args.tab_id,url:args.expected_url,snapshot:args.snapshot_id,documentId:current.documentId,pageUrl:scope?.url||args.expected_url,scope,action,lease,group:tab.groupId,window:tab.windowId,incognito:tab.incognito,created:Date.now(),state:'preparing'};
  brodexV2Records.set(r.id,r);
  const recordId=r.id;r.timer=setTimeout(()=>brodexV2Delete(recordId),300000);
  const control=await call('prepare',{action,overviewViewport});
  if(catalogSource){control.report.coverage.overview_comparison='catalog_target_fields_and_fresh_context';control.report.catalog_source=catalogSource;}
  return ready(control);
 }
 if(args.phase==='control'||args.phase==='retry'){
  if(args.phase==='retry'&&(r.state!=='blocked'||args.report_id!==r.report?.report_id||r.mainSent||r.report.blockers.length||!r.report.coverage.complete))throw Error('V2_RETRY_NOT_AVAILABLE');
  if(args.phase==='control'&&!['ready','blocked'].includes(r.state))throw Error('V2_CONTROL_CONSUMED');
  // Keep the last failure changes visible when rebasing; new changes are returned as well.
  const previous=r.report,control=await call('rebase');
  const keys=new Set(control.report.changes.map(c=>c.object_ref+'|'+c.property));
  if(args.phase==='retry')for(const c of previous.changes)if(!keys.has(c.object_ref+'|'+c.property))control.report.changes.push({...c,from_previous_report:true});
  if(control.report.changes.length>256){control.report.coverage.complete=false;control.report.blockers.push({code:'CHANGE_REPORT_INCOMPLETE'});}
  return ready(control);
 }
 if(r.state!=='ready'||r.token!==args.control_token||r.report.report_id!==args.report_id||Date.now()-r.prepared>30000)throw Error('V2_CONTROL_UNAVAILABLE');
 const exceptions=P.allowances(args.exceptions||[],r.report);
 r.state='executing';r.token=null;const stages=[];let main='not_dispatched';
 const receiptKey='brodexActionReceipt:v2:'+r.id+':'+r.prepared;
 async function send(method,params,primary){await identity();if(r.scope){if(method==='Input.dispatchMouseEvent'){const point=await brodexFrameGuard(r.scope,{x:params.x,y:params.y});params={...params,...point};}else await brodexFrameGuard(r.scope,undefined,true);}if(primary){main='unknown';r.mainSent=true;await api.save(receiptKey,{status:'pending',result:{dispatch_state:'unknown'}});}await chrome.debugger.sendCommand({tabId:r.tab_id},method,params);if(primary)main='sent';}
 function releasePoint(point){return r.scope?{x:point.x+r.scope.boundaries.reduce((n,b)=>n+b.x,0),y:point.y+r.scope.boundaries.reduce((n,b)=>n+b.y,0)}:point;}
 async function check(){const control=await call('guard',{allowances:exceptions});if(control.blocked){r.report=control.report;r.control=control;const e=Error('V2_CHANGED');e.control=control;throw e;}return control;}
 try{
  let control=await check();const op=r.action.operation,par=r.action.parameters||{};
  const pointer=['click','hover','wheel'].includes(op)||op==='set_checked'&&r.action.method==='dom_pointer';
  if(op==='set_checked'&&control.target.checked===par.checked){main='no_op';stages.push({kind:op,state:main});}
  else if(pointer){
   const movedPoint={...control.point};
   await call('pointer',{show});
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',...control.point,button:'none',buttons:0},op==='hover');stages.push({kind:'pointer_move',state:'sent'});
   if(op!=='hover')control=await check();
   if(op==='click'||op==='set_checked'){
    // Never chase a target after movement: the sent pointer location must still be the current point.
    if(!equalViewport(movedPoint,control.point))throw Error('V2_POINTER_TARGET_MOVED');
    const button=par.button||'left',buttons={left:1,right:2,middle:4}[button];let pressed=false;
    try{pressed=true;await send('Input.dispatchMouseEvent',{type:'mousePressed',...control.point,button,buttons,clickCount:1},true);stages.push({kind:'mouse_down',state:'sent'});}
    finally{if(pressed){try{await chrome.debugger.sendCommand({tabId:r.tab_id},'Input.dispatchMouseEvent',{type:'mouseReleased',...releasePoint(control.point),button,buttons:0,clickCount:1});stages.push({kind:'mouse_up',state:'sent'});}catch(e){main='partial';throw e;}}}
   }else if(op==='wheel'){await send('Input.dispatchMouseEvent',{type:'mouseWheel',...control.point,deltaX:par.delta_x||0,deltaY:par.delta_y||0,button:'none',buttons:0},true);stages.push({kind:'wheel',state:'sent'});}
  }else if(op==='insert_text') {await send('Input.insertText',{text:par.text},true);stages.push({kind:'text_input',state:'sent'});}
  else if(op==='press_key'){
   const codes={Enter:13,Tab:9,Escape:27,Space:32,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Backspace:8,Delete:46,Home:36,End:35};
   const key=par.key==='Space'?' ':par.key,params={key,code:par.key==='Space'?'Space':par.key,windowsVirtualKeyCode:codes[par.key]};
   try{await send('Input.dispatchKeyEvent',{type:'keyDown',...params},true);stages.push({kind:'key_down',state:'sent'});}
   finally{try{await chrome.debugger.sendCommand({tabId:r.tab_id},'Input.dispatchKeyEvent',{type:'keyUp',...params});stages.push({kind:'key_up',state:'sent'});}catch(e){main='partial';throw e;}}
  }else{
   main='unknown';r.mainSent=true;await api.save(receiptKey,{status:'pending',result:{dispatch_state:'unknown'}});
   const result=await call('perform',{allowances:exceptions});if(result.blocked){main='not_dispatched';r.mainSent=false;const e=Error('V2_CHANGED');e.control=result;throw e;}
   main=result.dispatch_state;stages.push({kind:op,state:main});
  }
  r.state='consumed';let verification={status:'unverified'},post;
  try{verification=(await call('verify')).verification;post=await call('inspect');}catch(e){verification={status:'unverified',reason:safeError(e)};}
  await api.save(receiptKey,{status:'done',result:{dispatch_state:main,outcome:verification.status}});
  if(r.action.method==='dom')await feedback(false,r.control);
  const result={protocol:'brodex-action/2',status:'completed',action_id:r.actionId,preparation_id:r.id,execution:{dispatch_state:main,stages},verification,...(post?{report:post.report}:{})};
  await call('finish').catch(()=>{});brodexV2Delete(r.id);return result;
 }catch(e){
  r.state=main==='not_dispatched'?'blocked':'consumed';
  let control=e.control;
  if(!control)try{control=await call('inspect');control.report.blockers.push({code:safeError(e)});}catch{control={...r.control,report:{report_id:crypto.randomUUID(),changes:[],blockers:[{code:safeError(e)}],coverage:{complete:false}}};}
  r.report=control.report;r.control=control;
  const picture=await image('failure',control);await feedback(true,control);
  await api.save(receiptKey,{status:main==='not_dispatched'?'blocked':'unknown',result:{dispatch_state:main}});
  if(main!=='not_dispatched'){await call('finish').catch(()=>{});brodexV2Delete(r.id);}
  return {protocol:'brodex-action/2',status:r.state,action_id:r.actionId,preparation_id:r.id,execution:{dispatch_state:main,stages},report:r.report,retry_available:main==='not_dispatched'&&r.report.coverage.complete&&!r.report.blockers.length,...picture};
 }finally{exceptions.length=0;}
}
