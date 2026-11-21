// Serial, guarded state changes. No arbitrary clicks, scripts, selectors or automatic replay.
function brodexValidateSeries(args,preparing=true){
 if(!/^[a-zA-Z0-9_-]{1,40}$/.test(args.plan_id||''))throw Error('INVALID_PLAN_ID');
 if(!preparing)return;
 if(!Array.isArray(args.steps)||args.steps.length<2||args.steps.length>20)throw Error('INVALID_SERIES');
 const ids=new Set();
 for(const s of args.steps){
  if(!s||Object.keys(s).some(k=>!['id','kind','x','y','desired'].includes(k))||!/^[a-zA-Z0-9_-]{1,40}$/.test(s.id||'')||ids.has(s.id)||!['set_checked','ctrl_select'].includes(s.kind)||typeof s.desired!=='boolean'||![s.x,s.y].every(n=>Number.isFinite(n)&&n>=0))throw Error('INVALID_SERIES_STEP');
  ids.add(s.id);
 }
}
function brodexStoredSeriesResult(value){return value?.status==='running'?{...value,status:'stopped',reason:'SERIES_INTERRUPTED',dispatch_state:'unknown',retry_action:false,next_step:'inspect_partial_outcome_before_new_plan'}:value;}
async function brodexReadSeriesRecord(read,tabId,planId){
 const record=await read('brodexOperationReceipt:'+tabId+':'+planId);if(record)return brodexStoredSeriesResult(record);
 const index=await read('brodexOperationIndex:'+tabId)||[];
 return index.includes(planId)?{plan_id:planId,status:'stopped',reason:'SERIES_INTERRUPTED',dispatch_state:'unknown',steps:[],retry_action:false,next_step:'inspect_partial_outcome_before_new_plan'}:null;
}
async function brodexExecuteSeries(args,io){
 brodexValidateSeries(args,false);
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(args.request_id||'')||!/^[a-f0-9]{64}$/.test(args.control_image_sha256||''))throw Error('SERIES_CONTROL_REQUIRED');
 const {read,save,script,debug,current,expectedHash}=io;
 const key='brodexOperationReceipt:'+args.tab_id+':'+args.plan_id;
 const old=await brodexReadSeriesRecord(read,args.tab_id,args.plan_id);
 if(old)return {...brodexStoredSeriesResult(old),reused_request:true,retry_action:false};
 const visual=await read('brodexVisual:'+args.tab_id);
 if(!visual?.series||visual.plan_id!==args.plan_id||visual.snapshot_id!==args.snapshot_id||visual.image_sha256!==args.control_image_sha256||visual.expected_url_hash!==expectedHash||Date.now()-visual.created>30000)throw Error('SERIES_CONTROL_REQUIRED');
 const hoverTiming=brodexTiming.normalize(args.timing||visual.timing),resultTiming=brodexTiming.normalize(args.result_timing,{timeout_ms:5000});
 const total=args.total_timeout_ms??25000;
 if(!Number.isInteger(total)||total<1000||total>25000)throw Error('INVALID_SERIES_TIMEOUT');
 const indexKey='brodexOperationIndex:'+args.tab_id,index=await read(indexKey)||[];
 if(index.length>=256)throw Error('SERIES_HISTORY_LIMIT: 256 recorded plans for this tab; no receipts are evicted or replayed');
 const began=performance.now(),deadline=began+total;
 const result={plan_id:args.plan_id,request_id:args.request_id,status:'running',steps:visual.steps.map(s=>({id:s.id,kind:s.kind,request_id:args.plan_id+'_'+s.id,status:'planned',desired:s.desired,dispatched:false})),effective_timing:{hover:hoverTiming,result:resultTiming,total_timeout_ms:total},retry_action:false,dispatch_state:'not_sent'};
 // Reserve the ID first: a worker crash between writes still cannot replay it.
 await save(indexKey,[...index,args.plan_id]);await save(key,result);
 const guardDeadline=()=>{if(performance.now()>=deadline)throw Error('SERIES_TIMEOUT');};
 const page=(action,step)=>script({action,plan_id:args.plan_id,snapshot_id:args.snapshot_id,...(step?{step_id:step.id}:{})});
 async function boundary(){guardDeadline();const tab=await current();if(tab.windowId!==visual.window_id||tab.groupId!==visual.group_id||tab.incognito!==visual.incognito)throw Error('SERIES_TAB_CONTEXT_CHANGED');await io.guardTask();guardDeadline();}
 try{
  for(let index=0;index<visual.steps.length;index++){
   const step=visual.steps[index],entry=result.steps[index];result.active_step=entry.id;
   await boundary();
   const before=await page('series_guard',step);guardDeadline();
   if(before.before===step.desired){await page('series_commit',step);entry.status='verified';entry.already_satisfied=true;await save(key,result);continue;}
   await page('series_point',step);await boundary();
   const x=step.x*visual.viewport.width/visual.width,y=step.y*visual.viewport.height/visual.height;
   await debug(async send=>{
    // Hover is separately recorded: it may change the page before the click is sent.
    entry.pointer_moved='unknown';await save(key,result);await boundary();
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',buttons:0,modifiers:0});
    entry.pointer_moved=true;
    entry.hover_timing=await brodexTiming.wait(async()=>{await boundary();await page('series_guard',step);return {key:1};},hoverTiming,{deadline});
    if(!entry.hover_timing.matched)throw Error('TIMING_TIMEOUT: after_hover');
    await boundary();await page('series_guard',step);guardDeadline();
    entry.status='unknown';await save(key,result);await boundary();
    let held=false,pressed=false,releaseFailed=false;
    const modifiers=step.kind==='ctrl_select'?2:0;
    try{
     if(modifiers){held=true;await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers});}
     // Keydown can itself change the UI; recheck before mousePressed.
     await boundary();await page('series_guard',step);guardDeadline();
     pressed=true;await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1,modifiers});
    }finally{
     if(pressed)try{await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1,modifiers});}catch{releaseFailed=true;}
     if(held)try{await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers:0});}catch{releaseFailed=true;}
     if(releaseFailed)throw Error('INPUT_RELEASE_FAILED');
    }
    entry.dispatched=true;entry.status='sent';await save(key,result);
   });
   entry.result_timing=await brodexTiming.wait(async()=>{await boundary();return page('series_verify',step);},resultTiming,{deadline});
   if(!entry.result_timing.matched)throw Error('SERIES_POSTCONDITION_UNVERIFIED');
   await boundary();await page('series_commit',step);
   entry.status='verified';await save(key,result);
  }
  result.status='verified';
 }catch(error){
  result.status='stopped';result.reason=(String(error.message).match(/^[A-Z][A-Z0-9_]+/)||['OPERATION_FAILED'])[0];
  const entry=result.steps.find(s=>s.id===result.active_step);
  if(entry&&entry.status==='planned')entry.status='not_sent';
  if(result.reason==='INPUT_RELEASE_FAILED')result.input_state='unknown';
 }
 result.elapsed_ms=Math.round(performance.now()-began);
 result.dispatch_state=result.steps.some(s=>s.status==='unknown'||s.pointer_moved==='unknown')?'unknown':result.steps.some(s=>s.dispatched)?'sent':'not_sent';
 result.next_step=result.status==='verified'?'verify_aggregate_task_result':'inspect_partial_outcome_before_new_plan';
 await save(key,result);
 return result;
}

