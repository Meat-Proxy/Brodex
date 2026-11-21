// Temporary content-free DOM guard diagnostics; never persist page payloads.
function brodexSafeContextDiagnostic(d){
 if(!d||d.version!==1||!['initial','recheck'].includes(d.stage)||!['mutation','attachment','identity','state','style','geometry','structure'].includes(d.reason)||!['target','target_context','selected_context','ancestor'].includes(d.region))return undefined;
 if(!Number.isFinite(d.snapshot_age_ms)||d.snapshot_age_ms<0||!Number.isInteger(d.changed_objects_observed)||d.changed_objects_observed<1||d.changed_objects_observed>128)return undefined;
 return {version:1,stage:d.stage,reason:d.reason,region:d.region,snapshot_age_ms:Math.round(d.snapshot_age_ms),changed_objects_observed:d.changed_objects_observed,count_is_lower_bound:true,count_capped:d.count_capped===true,mutation_kinds:['attributes','structure','text'].filter(k=>Array.isArray(d.mutation_kinds)&&d.mutation_kinds.includes(k))};
}
// Independent Brodex native channel. Only fixed, read-only page extraction.
importScripts('brodex-page-reader.js','brodex-page-code.js','brodex-embedded.js');
importScripts('brodex-catalog-reader.js');
importScripts('brodex-action-policy.js','brodex-action-page-v2.js','brodex-action-v2.js');
importScripts('brodex-ax-adapter.js','brodex-catalog-ax.js');
importScripts('brodex-timing.js','brodex-series.js','brodex-page-action.js','brodex-interactions.js','brodex-tasks.js','brodex-files.js');
importScripts('brodex-tab-groups.js','brodex-session-policy.js');
importScripts('brodex-operation-control.js','brodex-work-session.js','brodex-readiness.js');
importScripts('brodex-diagnostics.js','brodex-activate-tab.js','brodex-tab-visibility.js');
const brodexMcp = (()=>{
 const host='com.brodex.bridge';let port=null;let queue=Promise.resolve();let outstanding=0;
 const readiness=brodexReadiness({busy:()=>outstanding>0});
 const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
 const storageReady=brodexSessionPolicy.initialize(chrome);
 async function read(key){if(key.startsWith('brodexDownloadWatch:'))return brodexSessionPolicy.getWatch(key);return (await chrome.storage.session.get(key))[key];}
 async function save(key,value){if(key.startsWith('brodexDownloadWatch:'))return brodexSessionPolicy.putWatch(key,value);await chrome.storage.session.set({[key]:await brodexSessionPolicy.sanitize(key,value)});}
 const diagnostics=brodexDiagnostics({read,save});
 const pendingTaskEvents=[];let taskEventTimer=null,lastTaskEvent=0;
 async function flushTaskEvents(){if(!pendingTaskEvents.length)return;const wait=100-(Date.now()-lastTaskEvent);if(wait>0)await new Promise(r=>setTimeout(r,wait));const events=pendingTaskEvents.splice(0);try{await tasks.handle('_refresh_tasks',{events});}catch(error){pendingTaskEvents.unshift(...events);throw error;}}
 function taskEvent(event){tasks.observe(event);if(event.type==='removed'||event.type==='replaced')pendingTaskEvents.push(event);else if(!pendingTaskEvents.length)pendingTaskEvents.push({type:'changed'});lastTaskEvent=Date.now();if(!taskEventTimer)taskEventTimer=setTimeout(()=>{taskEventTimer=null;dispatch({command:'_refresh_tasks',args:{}});},100);}

 if(typeof self!=='undefined'){
  self.addEventListener('error',()=>{diagnostics.record('extension_runtime','failed','UNHANDLED_ERROR');});
  self.addEventListener('unhandledrejection',()=>{diagnostics.record('extension_runtime','failed','UNHANDLED_REJECTION');});
 }
 const files=brodexFiles({read,save,view});
 const tasks=brodexTasks({read,save,view,reopen:args=>handle('open_tab',{...args,_restoring:true})});
 async function allowed(){return new Promise((resolve,reject)=>chrome.extension.isAllowedIncognitoAccess(value=>chrome.runtime.lastError?reject(Error(chrome.runtime.lastError.message)):resolve(value)));}
 function view(tab){return {tab_id:tab.id,window_id:tab.windowId,group_id:tab.groupId??-1,active:tab.active===true,mode:tab.incognito?'incognito':'normal',url:tab.url||'',title:tab.title||'',status:tab.status||'unknown'};}
 async function groupTab(state,tab,args){
 const chrome=brodexOperationChrome();
  state.groups??={};
  let group;const saved=state.groups[tab.windowId];
  if(saved!==undefined){try{group=await chrome.tabGroups.get(saved);}catch{} }
  if(group&&group.windowId!==tab.windowId)group=null;
  if(group){
   await chrome.tabs.group({tabIds:[tab.id],groupId:group.id});
  }else{
   const id=await chrome.tabs.group({tabIds:[tab.id],createProperties:{windowId:tab.windowId}});
   state.groups[tab.windowId]=id;
   const label=(args.group_name||state.groupName||args.task_id).replace(/^Brodex\s*[·:—-]?\s*/i,'').trim()||args.task_id;
   state.groupName=label;
   group=await chrome.tabGroups.update(id,{title:'Brodex · '+label,color:'blue',collapsed:false});
  }
  return group;
 }
 async function handle(command,args){
 const chrome=brodexOperationChrome();
  await storageReady;
  await flushTaskEvents();
  if(args.tab_id!==undefined&&['browser_work','read_page','read_page_code','press_key','mouse_click','drag','upload_via_chooser','upload_file','act','navigate','wait_for','screenshot','inspect_snapshot_changes','prepare_click','prepare_retry','execute_retry','retry_preparation','prepare_action','execute_prepared_action','wait_stable','prepare_operation','execute_operation','inspect_operation'].includes(command)&&!(command==='browser_work'&&args.action!=='begin'))await tasks.guard(args.tab_id,{begin:command==='browser_work'&&args.action==='begin'}).catch(e=>{e.dispatch_state='not_dispatched';throw e;});
  if(command==='action_v2')return brodexActionV2(args,{read,save,handle,guard:tabId=>tasks.guard(tabId)});
  if(command==='list_tab_groups')return brodexGroups.list(args);
  if(command==='watch_tab_group')return brodexGroups.watch(args);
  if(command==='browser_work')return brodexBrowserWork(args);
  if(['read_page','read_page_code','press_key','mouse_click','drag','upload_via_chooser','upload_file','act','navigate','wait_for','screenshot','inspect_snapshot_changes','prepare_click','prepare_retry','execute_retry','retry_preparation','prepare_action','execute_prepared_action','wait_stable','prepare_operation','execute_operation','inspect_operation'].includes(command)&&command!=='inspect_operation')await brodexRequireWork(args.tab_id).catch(e=>{e.dispatch_state='not_dispatched';throw e;});
  if(command==='activate_tab')return brodexActivateTab(args);
  if(command==='get_diagnostics')return diagnostics.list(args);
  if(['download_history','watch_downloads','list_downloads','download_status','download_file','save_page'].includes(command)){
   if(['watch_downloads','download_file','save_page'].includes(command)){
    const task=await tasks.load(args.task_id);
    if(!task.tabs.includes(args.tab_id))throw Error('TAB_NOT_OWNED_BY_TASK');
    if((await tasks.describe(args.task_id)).needs_restore)throw Error('TASK_RESTORE_REQUIRED');
   }
   return files.handle(command,args);
  }
  if(['_browser_identity','_refresh_tasks','list_tasks','restore_task','attach_tab','rename_group','task_group','delete_task_group','ungroup_task_group'].includes(command))return tasks.handle(command,args);
  if(command==='status')return {connected:true,version:chrome.runtime.getManifest().version_name,incognito_allowed:await allowed(),capabilities:['action_v2','delete_task_group','ungroup_task_group','task_group','list_tab_groups','watch_tab_group','browser_task_control','browser_work','check_ready','activate_tab','get_diagnostics','press_key','mouse_click','download_history','read_page_code','drag','upload_via_chooser','upload_file','watch_downloads','list_downloads','download_status','download_file','save_page','list_tasks','restore_task','attach_tab','rename_group','list_tabs','open_tab','close_tab','read_page','act','navigate','wait_for','screenshot','inspect_snapshot_changes','prepare_click','prepare_retry','execute_retry','retry_preparation','prepare_action','execute_prepared_action','wait_stable','prepare_operation','execute_operation','inspect_operation']};
  if(['press_key','mouse_click','read_page_code','drag','upload_via_chooser','upload_file','act','navigate','wait_for','screenshot','inspect_snapshot_changes','prepare_click','prepare_retry','execute_retry','retry_preparation','prepare_action','execute_prepared_action','wait_stable','prepare_operation','execute_operation','inspect_operation'].includes(command))return brodexInteract(command,args,{read,save,handle,view,guard:tabId=>tasks.guard(tabId)});
  if(command==='list_tabs')return brodexListVisibleTabs(view);
  if(command==='read_page'){
   if(args.catalog!==undefined)brodexValidateCatalog(args);
   if(args.group!==undefined){const g=args.group;if(!g||typeof g!=='object'||Array.isArray(g)||Object.keys(g).some(k=>!['snapshot_id','group_id','cursor','limit'].includes(k))||typeof g.snapshot_id!=='string'||g.snapshot_id.length>100||typeof g.group_id!=='string'||g.group_id.length>100||(g.cursor!==undefined&&(typeof g.cursor!=='string'||g.cursor.length>100))||(g.limit!==undefined&&(!Number.isInteger(g.limit)||g.limit<1||g.limit>100))||args.text_offset||args.element_offset)throw Error('INVALID_GROUP_READ');}

   if(!Number.isInteger(args.tab_id)||args.tab_id<0)throw Error('INVALID_TAB_ID');
   const expected=new URL(args.expected_url);
   if(!['http:','https:'].includes(expected.protocol)||expected.username||expected.password)throw Error('URL_NOT_SUPPORTED');
   const maxChars=args.max_chars??20000,maxElements=args.max_elements??100,offset=args.text_offset??0,elementOffset=args.element_offset??0;
   if(!Number.isInteger(maxChars)||maxChars<100||maxChars>30000||!Number.isInteger(maxElements)||maxElements<1||maxElements>100||!Number.isInteger(offset)||offset<0||offset>1000000)throw Error('INVALID_READ_LIMITS');
   if(!Number.isInteger(elementOffset)||elementOffset<0||elementOffset>30000)throw Error('INVALID_READ_LIMITS');
   let tab;try{tab=await chrome.tabs.get(args.tab_id);}catch{throw Error('TAB_NOT_FOUND');}
   if(tab.url!==expected.href||tab.pendingUrl&&tab.pendingUrl!==expected.href)throw Error('PAGE_CHANGED: inspect list_tabs');
   const page=args.catalog!==undefined?await brodexReadCatalog(args):await brodexReadScopedPage(args,maxChars,maxElements,offset,elementOffset);
   const current=await chrome.tabs.get(tab.id);
   if(current.url!==expected.href||current.pendingUrl&&current.pendingUrl!==expected.href)throw Error('PAGE_CHANGED: discard snapshot and inspect list_tabs');
   await brodexRequireWork(args.tab_id);
   return {...view(current),page};
  }
  if(!validId(args.task_id))throw Error('INVALID_TASK_ID: use 1-100 ASCII letters, digits, underscore or hyphen');
  const taskKey='brodexMcpTask:'+args.task_id;
  const state=await tasks.load(args.task_id);
  if(command==='close_tab'){
   if(!Number.isInteger(args.tab_id)||(!state.tabs.includes(args.tab_id)||(state.attached?.includes(args.tab_id)&&args.user_confirmed!==true)))throw Error('TAB_NOT_OWNED_BY_TASK');
   let tab;try{tab=await chrome.tabs.get(args.tab_id);}catch{return {closed:true,already_closed:true,tab_id:args.tab_id};}
   await chrome.tabs.remove(tab.id);await tasks.handle('_refresh_tasks',{events:[{type:'removed',tab_id:tab.id,window_closing:false,deliberate:true}]});return {closed:true,tab_id:tab.id};
  }
  if(command!=='open_tab')throw Error('UNKNOWN_COMMAND');
  if(!args._restoring&&(await tasks.describe(args.task_id)).needs_restore)throw Error('TASK_GROUP_UNAVAILABLE: ask user to open saved group, explicitly bind it, or explicitly request a new copy');
  if(!validId(args.request_id))throw Error('INVALID_REQUEST_ID');
  if(args.group_name!==undefined&&(typeof args.group_name!=='string'||!args.group_name.trim()||args.group_name.length>80||/[\x00-\x1f\x7f]/.test(args.group_name)))throw Error('INVALID_GROUP_NAME');
  if(!['normal','incognito'].includes(args.mode))throw Error('EXPLICIT_MODE_REQUIRED');
  const url=new URL(args.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('URL_NOT_SUPPORTED');
  if(args.window_id!==undefined&&(!Number.isInteger(args.window_id)||args.window_id<0))throw Error('INVALID_WINDOW_ID');
  const incognito=args.mode==='incognito';
  if(incognito&&!await allowed())throw Error('INCOGNITO_NOT_ALLOWED: enable Brodex incognito permission in Chrome once; no normal fallback');
  const requestKey='brodexMcpRequest:'+args.task_id+':'+args.request_id;
  const fingerprint=await brodexSessionPolicy.hash(JSON.stringify([url.href,args.mode,args.window_id??null]));
  const previous=await read(requestKey);
  if(previous){
   if(previous.fingerprint!==fingerprint)throw Error('REQUEST_ID_CONFLICT');
   if(previous.status!=='done')throw Error('OUTCOME_UNKNOWN: inspect list_tabs; do not automatically retry with another request_id');
   let tab;try{tab=await chrome.tabs.get(previous.tab_id);}catch{throw Error('PREVIOUS_TAB_CLOSED: use a new request_id only for an intentional new tab');}
   if(tab.incognito!==incognito)throw Error('MODE_MISMATCH');
   return {...view(tab),reused_request:true};
  }
  let win;
  if(args.window_id!==undefined){win=await chrome.windows.get(args.window_id);if(win.type!=='normal'||win.incognito!==incognito)throw Error('WINDOW_MODE_MISMATCH');}
  else if(state.windows[args.mode]!==undefined){try{win=await chrome.windows.get(state.windows[args.mode]);}catch{}if(win&&(win.type!=='normal'||win.incognito!==incognito))throw Error('WINDOW_MODE_MISMATCH');}
  const registered=win&&state.groups[win.id]!==undefined;
  if(args.window_id!==undefined&&!registered&&args.user_confirmed!==true)throw Error('EXPLICIT_PERSONAL_WINDOW_OPEN_REQUIRED');
  if(args.window_id!==undefined&&!registered&&state.personalCreated.length>=20)throw Error('PERSONAL_TAB_LIMIT: 20 tracked personal tabs');
  if(registered&&(await chrome.tabs.query({groupId:state.groups[win.id]})).length>=20)throw Error('GROUP_TAB_LIMIT: 20 open tabs; ask user before expanding');
  // Persist intent before any mutation. Never silently duplicate an unknown result.
  await save(requestKey,{status:'pending',fingerprint});
  let tab;
  try{
   if(win)tab=await chrome.tabs.create({windowId:win.id,url:url.href,active:true});
   else{
    win=await chrome.windows.create({type:'normal',incognito,focused:true,url:url.href});
    if(!win||!Number.isInteger(win.id)||win.incognito!==incognito)throw Error('CREATED_WINDOW_INVALID');
    const id=win.tabs?.find(t=>Number.isInteger(t.id))?.id;if(id===undefined)throw Error('CREATED_TAB_MISSING');
    tab=await chrome.tabs.get(id);
   }
   if(!Number.isInteger(tab.id)||tab.windowId!==win.id||tab.incognito!==incognito)throw Error('CREATED_TAB_MODE_MISMATCH');
   state.windows[args.mode]=win.id;state.tabs.push(tab.id);
   if(args._restore_record){state.records=state.records.filter(r=>r.record_id!==args._restore_record);state.records.push({record_id:args._restore_record,tab_id:tab.id,mode:args.mode,status:'active'});}
   await save(taskKey,state);
   let group;
   if(args.window_id!==undefined&&!registered){state.attached.push(tab.id);state.personalCreated.push(tab.id);await tasks.persist(args.task_id,state);}
   else{group=await groupTab(state,tab,args);await save(taskKey,state);await tasks.persist(args.task_id,state);}
   tab=await chrome.tabs.get(tab.id);
   await save(requestKey,{status:'done',fingerprint,tab_id:tab.id});
   return {...view(tab),group_name:group?.title};
  }catch(error){await save(requestKey,{status:'unknown',fingerprint,tab_id:tab?.id,error:error.message}).catch(()=>{});throw error;}
 }
 function dispatch(message){
  if(message.command==='browser_task_control')return brodexTaskControl(message.args||{}).then(value=>({id:message.id,ok:true,value}),error=>({id:message.id,ok:false,error:error.message}));
  if(message.command==='check_ready')return readiness(message.args||{}).then(value=>({id:message.id,ok:true,value}),error=>({id:message.id,ok:false,error:error.message}));
  const queued=Date.now();outstanding++;const entry=brodexOperations.register(message.command,message.args||{});
  const job=queue.then(async()=>{const started=Date.now();let ticket;try{
   if(entry.cancelled)throw Error("OPERATION_CANCELLED: queued command not dispatched");
   ticket=brodexOperations.begin(message.command,message.args||{});
   const value=await handle(message.command,message.args||{});
   brodexOperations.assert(ticket);
   const metrics={queue_ms:started-queued,operation_ms:Date.now()-started};
   if(message.command!=='get_diagnostics'&&message.command!=='_refresh_tasks')await diagnostics.record(message.command,'succeeded',null,message.command==='restore_task'?(value.needs_restore?'unresolved':'completed'):message.command==='_browser_identity'?(value.verified?'verified':'unverified'):'not_attempted',metrics);
   return {id:message.id,ok:true,value};
  }catch(error){await diagnostics.record(message.command,'failed',error,'not_attempted',{queue_ms:started-queued,operation_ms:Date.now()-started});return {id:message.id,ok:false,error:error.message,...(error.retry_diagnostic?{retry_diagnostic:error.retry_diagnostic}:{}),...(error.image?{image:error.image}:{}),...(error.work_diagnostic?{work_diagnostic:error.work_diagnostic}:{}),...(error.unsupported_diagnostic?{unsupported_diagnostic:brodexSafeUnsupportedDiagnostic(error.unsupported_diagnostic)}:{}),...(error.context_diagnostic?{context_diagnostic:brodexSafeContextDiagnostic(error.context_diagnostic)}:{}),...(['not_dispatched','unknown'].includes(error.dispatch_state)?{dispatch_state:error.dispatch_state}:{})};}finally{brodexOperations.finish(ticket);brodexOperations.remove(entry);}});
  queue=job.catch(()=>{});return job.finally(()=>{outstanding--;});
 }
 function connect(){
  if(port)return;
  try{
   const current=chrome.runtime.connectNative(host);port=current;
   current.onMessage.addListener(message=>{if(message.event==='brodex_browser_identity'){dispatch({command:'_browser_identity',args:{identity:message.identity}});return;}dispatch(message).then(response=>{try{current.postMessage(response);}catch{}});});
   current.onDisconnect.addListener(()=>{const error=chrome.runtime.lastError?.message||'disconnected';if(port===current){port=null;setTimeout(connect,2000);}save('brodexMcpConnection',{connected:false,error}).catch(()=>{});diagnostics.record('native_connection','failed','NATIVE_DISCONNECTED','pending');});
   save('brodexMcpConnection',{connected:true}).catch(()=>{});
   diagnostics.record('native_connection','connected',null,'port_created');
  }catch(error){port=null;save('brodexMcpConnection',{connected:false,error:error.message}).catch(()=>{});diagnostics.record('native_connection','failed','NATIVE_CONNECT_FAILED','pending');}
 }
 chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='brodex-mcp-reconnect')connect();});
 chrome.alarms.create('brodex-mcp-reconnect',{periodInMinutes:1});
 chrome.tabs.onRemoved?.addListener((id,info)=>taskEvent({type:'removed',tab_id:id,window_id:info.windowId,window_closing:info.isWindowClosing}));
 chrome.tabs.onUpdated?.addListener((id,change,t)=>{if(change.groupId!==undefined)taskEvent({type:'membership',tab_id:id,group_id:change.groupId,window_id:t.windowId});else if(change.url&&tasks.tracks(id))taskEvent({type:'url',tab_id:id});});
 chrome.tabs.onCreated?.addListener(t=>{if(t.groupId>=0)taskEvent({type:'membership',tab_id:t.id,group_id:t.groupId,window_id:t.windowId});});
 chrome.tabs.onReplaced?.addListener((added,removed)=>taskEvent({type:'replaced',added,removed}));
 for(const name of ['onCreated','onUpdated','onMoved','onRemoved'])chrome.tabGroups[name]?.addListener(g=>taskEvent({type:name,group_id:g.id,window_id:g.windowId}));
 chrome.windows.onRemoved?.addListener(id=>taskEvent({type:'window_removed',window_id:id}));
 connect();
 return {dispatch};
})();

function brodexSafeUnsupportedDiagnostic(d){const out={};const fields={stage:['initial','recheck','prepare_hit_test','prepare_context'],region:['target','target_context','selected_context','critical_context'],node_kind:['iframe','frame','canvas','video','shadow_host'],relation:['target','ancestor','descendant','other_context_node']};for(const [k,allowed] of Object.entries(fields))if(allowed.includes(d?.[k]))out[k]=d[k];return out;}
