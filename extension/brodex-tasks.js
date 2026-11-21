// Current group snapshots only. No URL matching, navigation history or auto-recovery.
function brodexTasks({read,save,view,reopen}){
 const key='brodexTaskRegistry',prefix='brodexMcpTask:',owners=new Map(),revoked=new Set();
 const valid=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
 const hint=url=>{try{const u=new URL(url);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.origin+u.pathname:null;}catch{return null;}};
 const api=()=>brodexOperationChrome();
 async function epoch(){let e=await read('brodexBrowserEpoch');if(!e){e='extension-'+crypto.randomUUID();await save('brodexBrowserEpoch',e);}return e;}
 function normalize(old={}){
  if(old.schema===4)return old;
  const bindings={};
  for(const r of [...(old.records||[]),...(old.pendingRecords||[])]){
   if(r.attached||r.status==='closed'||!(r.group_id>=0))continue;
   const id=String(r.group_id);bindings[id]??={id:r.group_id,epoch:r.epoch,mode:r.mode||'normal',windowId:r.window_id,status:'unavailable',records:[]};
   if(!bindings[id].records.some(n=>n.tab_id===r.tab_id))bindings[id].records.push({record_id:r.record_id||crypto.randomUUID(),tab_id:r.tab_id,url:hint(r.url),index:r.index??bindings[id].records.length});
  }
  return {schema:4,groupName:old.groupName,bindings,attached:old.attached||[],personalCreated:[],tabs:[],windows:{},groups:{},records:[]};
 }
 async function registry(){const c=api(),all=(await c.storage.local.get(key))[key]||{};for(const id of Object.keys(all))all[id]=normalize(all[id]);return all;}
 async function loadRaw(id){let s=await read(prefix+id);if(!s)s=(await registry())[id];s=normalize(s);s.attached??=[];s.personalCreated??=[];return s;}
 function flatten(s){s.tabs=[...s.attached];s.windows={};s.groups={};s.records=[];for(const b of Object.values(s.bindings)){
  for(const r of b.records)s.records.push({...r,group_id:b.id,window_id:b.windowId,epoch:b.epoch,mode:b.mode,status:b.status==='open'?'active':'pending'});
  if(b.status==='open'){s.tabs.push(...b.records.map(r=>r.tab_id));s.windows[b.mode]=b.windowId;s.groups[b.windowId]=b.id;}
 }s.tabs=[...new Set(s.tabs)];}
 async function commit(id,s){
  flatten(s);await save(prefix+id,s);const c=api(),all=await registry();
  const bindings=Object.fromEntries(Object.entries(s.bindings).filter(([,b])=>b.mode==='normal'));
  if(Object.keys(bindings).length||s.copyPlan?.mode==='normal')all[id]={schema:4,groupName:s.groupName,bindings,...(s.copyPlan?.mode==='normal'?{copyPlan:s.copyPlan}:{})};else delete all[id];
  await c.storage.local.set({[key]:all});
  for(const [tab,o] of owners)if(o.task===id)owners.delete(tab);
  for(const b of Object.values(s.bindings))if(b.status==='open')for(const r of b.records)owners.set(r.tab_id,{task:id,group:b.id});
 }
 async function refresh(id,events=[]){
  const c=api(),s=await loadRaw(id),e=await epoch();
  for(const b of Object.values(s.bindings)){
   if(b.deletePending){b.status='deletion_pending';continue;}
   if(b.epoch!==e){b.status='unavailable';continue;}
   const removed=new Map(events.filter(x=>x.type==='removed').map(x=>[x.tab_id,x]));
   for(const x of events)if(x.type==='replaced'){const r=b.records.find(r=>r.tab_id===x.removed);if(r)r.tab_id=x.added;}
   // Explicit individual close and user-confirmed removals are not recovery records.
   const before=b.records,individual=b.records.filter(r=>removed.get(r.tab_id)?.window_closing===false);
   let g;try{g=await c.tabGroups.get(b.id);}catch{}
   if(g){
    const w=await c.windows.get(g.windowId);if(!!w.incognito!==(b.mode==='incognito')){b.status='unavailable';continue;}
    const tabs=await c.tabs.query({groupId:b.id});
    const current=tabs.filter(t=>!!t.incognito===(b.mode==='incognito'));
    b.records=current.map(t=>({record_id:b.records.find(r=>r.tab_id===t.id)?.record_id||crypto.randomUUID(),tab_id:t.id,index:t.index,url:hint(t.url)}));
    b.status='open';b.windowId=g.windowId;b.name=g.title||'';
   }else{
    // The API cannot distinguish menu close/delete from closing the final tabs.
    // Preserve ambiguous evidence, never silently recreate it or call it deletion.
    if(before.length&&individual.length===before.length&&!individual.every(r=>removed.get(r.tab_id)?.deliberate)){b.status='closure_unknown';continue;}
    b.records=b.records.filter(r=>!individual.includes(r));
    // A missing group may be closed, deleted, or in transit. Never infer deletion.
    const kept=[];for(const r of b.records){
     if(removed.get(r.tab_id)?.window_closing===true){kept.push(r);continue;}
     let t;try{t=await c.tabs.get(r.tab_id);}catch{}
     if(t&&t.groupId!==b.id){revoked.add(r.tab_id);continue;}
     kept.push(r);
    }
    b.records=kept;if(b.status!=='closure_unknown')b.status='unavailable';
    if(!b.records.length){delete s.bindings[b.id];continue;}
   }
  }
  const attached=[];for(const tab of s.attached){if(events.some(x=>x.type==='removed'&&x.tab_id===tab)||Object.values(s.bindings).some(b=>b.status==='open'&&b.records.some(r=>r.tab_id===tab)))continue;try{await c.tabs.get(tab);attached.push(tab);}catch{}}
  s.attached=attached;s.personalCreated=s.personalCreated.filter(t=>attached.includes(t));
  await commit(id,s);return s;
 }
 async function persist(id,s){
  const c=api(),e=await epoch();s=normalize(s);
  for(const gid of new Set(Object.values(s.groups||{}))){
   if(s.bindings[gid])continue;const g=await c.tabGroups.get(gid),w=await c.windows.get(g.windowId);
   s.bindings[gid]={id:gid,epoch:e,mode:w.incognito?'incognito':'normal',windowId:g.windowId,name:g.title||'',status:'open',records:[]};
  }
  await commit(id,s);return refresh(id);
 }
 async function describe(id){const s=await refresh(id),c=api(),tabs=[];for(const tid of s.tabs){try{tabs.push({...view(await c.tabs.get(tid)),ownership:s.attached.includes(tid)?'attached':'group_member'});}catch{}}
  return {task_id:id,pipeline_version:4,group_name:s.groupName,tabs,groups:Object.values(s.bindings).map(b=>({group_id:b.id,window_id:b.windowId,mode:b.mode,name:b.name,status:b.status,tab_count:b.records.length,...(b.deletePending?{pending_operation:{operation_id:b.deletePending.request_id,stage:b.deletePending.stage,tab_ids:b.deletePending.tab_ids}}:{})})),needs_restore:Object.values(s.bindings).some(b=>b.status!=='open'&&!b.deletePending),next_step:Object.values(s.bindings).some(b=>b.deletePending)?'inspect_pending_group_deletion':Object.keys(s.bindings).length?'continue_open_group_or_ask_user_to_open_saved_group':'continue_task_in_new_group',copy_pending:!!s.copyPlan};
 }
 // Called synchronously by Chrome listeners, before queued persistence.
 function observe(x){if(x.type==='membership'){
  const o=owners.get(x.tab_id);if(o&&o.group!==x.group_id){revoked.add(x.tab_id);if(typeof brodexLoseWork==='function')brodexLoseWork(x.tab_id);}
 }if(x.type==='removed'){owners.delete(x.tab_id);revoked.delete(x.tab_id);}}
 async function guard(tabId,{begin=false}={}){
  if(revoked.has(tabId)){if(!begin)throw Error('TASK_MEMBERSHIP_CHANGED: stop and explicitly reassess this tab');revoked.delete(tabId);}
  const o=owners.get(tabId);if(o){const t=await api().tabs.get(tabId);if(t.groupId!==o.group){revoked.add(tabId);throw Error('TASK_MEMBERSHIP_CHANGED');}}
 }
 async function handle(command,args){
  const c=api();
  if(command==='_browser_identity'){
   if(!/^[a-f0-9]{64}$/.test(args.identity||''))return {verified:false};
   const previous=await epoch(),next='browser-'+args.identity;
   if(previous.startsWith('extension-')){const all=await registry(),session=await c.storage.session.get(null);for(const entry of Object.values(all))for(const b of Object.values(entry.bindings))if(b.epoch===previous)b.epoch=next;await c.storage.local.set({[key]:all});for(const [k,v] of Object.entries(session))if(k.startsWith(prefix)){const s=normalize(v);for(const b of Object.values(s.bindings))if(b.epoch===previous)b.epoch=next;await save(k,s);}}
   await save('brodexBrowserEpoch',next);await handle('_refresh_tasks',{});return {verified:true};
  }
  if(command==='_refresh_tasks'||command==='list_tasks'){
   const all=await registry(),session=await c.storage.session.get(null),ids=new Set([...Object.keys(all),...Object.keys(session).filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length))]);
   const events=args.events||[],tasks=[];for(const id of ids){await refresh(id,events);if(command==='list_tasks')tasks.push(await describe(id));}return command==='list_tasks'?{tasks}:{updated:true};
  }
  if(!valid(args.task_id))throw Error('INVALID_TASK_ID');const id=args.task_id;
  if(command==='restore_task'){
   if(args.reopen_missing)throw Error('EXPLICIT_GROUP_COPY_REQUIRED: use task_group action copy with user_confirmed');
   return {...await describe(id),candidates:[],reopened:[],automatic_url_search:false};
  }
  let s=await refresh(id);

  if(command==='delete_task_group'){
   if(args.user_confirmed!==true)throw Error('EXPLICIT_USER_AUTHORIZATION_REQUIRED');
   if(!['normal','incognito'].includes(args.mode))throw Error('EXPLICIT_MODE_REQUIRED');
   if(!valid(args.request_id)||!Number.isInteger(args.group_id)||args.group_id<0||!Array.isArray(args.expected_tab_ids)||!args.expected_tab_ids.length||args.expected_tab_ids.length>1000||args.expected_tab_ids.some(x=>!Number.isInteger(x)||x<0)||new Set(args.expected_tab_ids).size!==args.expected_tab_ids.length)throw Error('INVALID_GROUP_DELETE_ARGUMENTS');
   const receiptKey='brodexGroupDeleteV2:'+id+':'+args.request_id,prior=await read(receiptKey);
   if(prior)return {...prior.result,operation_id:args.request_id,replayed:true,retry_action:false,next_step:'inspect_current_state; do_not_repeat'};
   const b=s.bindings[args.group_id];if(!b||b.mode!==args.mode)throw Error('GROUP_NOT_REGISTERED');
   if(b.deletePending)return {deleted:false,stage:b.deletePending.stage,operation_id:b.deletePending.request_id,outcome:'previous_operation_requires_inspection',expected_tab_ids:b.deletePending.tab_ids,retry_action:false};
   if(b.epoch!==await epoch()||b.status!=='open')throw Error('SAVED_GROUP_DELETE_UNSUPPORTED: open and bind the saved group first');
   if(b.ungroupPending)throw Error('GROUP_UNGROUP_OUTCOME_UNKNOWN');
   const g=await c.tabGroups.get(b.id),w=await c.windows.get(g.windowId);
   if(!!w.incognito!==(args.mode==='incognito'))throw Error('MODE_MISMATCH');
   const equal=ts=>ts.length===args.expected_tab_ids.length&&ts.every(t=>args.expected_tab_ids.includes(t.id)&&t.groupId===b.id&&t.windowId===g.windowId&&!!t.incognito===(args.mode==='incognito'));
   const original=await c.tabs.query({groupId:b.id});if(!equal(original))throw Error('GROUP_MEMBERSHIP_CHANGED');
   let stage='prepared',ungrouped=false,closeSent=false;
   const pending={request_id:args.request_id,tab_ids:[...args.expected_tab_ids],window_id:g.windowId,stage};
   async function checkpoint(next){stage=next;pending.stage=next;s=await loadRaw(id);s.bindings[b.id]??=b;s.bindings[b.id].deletePending={...pending};await commit(id,s);await save(receiptKey,{result:{deleted:false,stage,outcome:'interrupted_or_running',expected_tab_ids:args.expected_tab_ids,retry_action:false}});}
   async function observeTargets(){const all=await c.tabs.query({});return all.filter(t=>args.expected_tab_ids.includes(t.id));}
   function unchanged(ts){return ts.length===original.length&&ts.every(t=>{const old=original.find(o=>o.id===t.id);return old&&t.groupId===-1&&t.windowId===g.windowId&&!!t.incognito===(args.mode==='incognito')&&t.url===old.url&&(t.pendingUrl||'')===(old.pendingUrl||'');});}
   async function partial(reason){let open;try{open=(await observeTargets()).map(t=>t.id);}catch{}const result={deleted:false,operation_id:args.request_id,stage,ungrouped,close_dispatched:closeSent,outcome:'partial_or_unknown',reason,open_tab_ids:open??null,saved_group_deleted:'unknown',retry_action:false,next_step:'inspect_before_any_further_action'};try{await save(receiptKey,{result});}catch{}return result;}
   try{
    await checkpoint('prepared');
    if(!equal(await c.tabs.query({groupId:b.id})))return await partial('GROUP_MEMBERSHIP_CHANGED');
    await checkpoint('ungroup_dispatching');
    if(!equal(await c.tabs.query({groupId:b.id})))return await partial('GROUP_MEMBERSHIP_CHANGED');
    await c.tabs.ungroup(args.expected_tab_ids);
    if((await c.tabs.query({groupId:b.id})).length||!unchanged(await observeTargets()))return await partial('UNGROUP_RESULT_CHANGED');
    ungrouped=true;await checkpoint('ungroup_verified');
    await checkpoint('close_dispatching');
    // Last observation after durable writes, immediately before close. Chrome offers no atomic compare-and-close.
    if(!unchanged(await observeTargets()))return await partial('TARGET_CHANGED_BEFORE_CLOSE');
    closeSent=true;await c.tabs.remove(args.expected_tab_ids);
    if((await observeTargets()).length)return await partial('TABS_REMAIN_AFTER_CLOSE');
    await checkpoint('closed_verified');
    s=await loadRaw(id);delete s.bindings[b.id];if(s.copyPlan?.source===b.id)delete s.copyPlan;await commit(id,s);
    const result={deleted:true,operation_id:args.request_id,stage:'completed',ungrouped:true,closed_tab_ids:args.expected_tab_ids,registry_removed:true,saved_group_deleted:'unknown',verification:'ungroup_completed_and_exact_tabs_closed; saved_menu_not_readable_via_API',retry_action:false};
    await save(receiptKey,{result});return result;
   }catch{return await partial('GROUP_DELETE_STAGE_FAILED');}
  }

  if(command==='ungroup_task_group'){
   if(args.user_confirmed!==true)throw Error('EXPLICIT_USER_AUTHORIZATION_REQUIRED');
   if(!['normal','incognito'].includes(args.mode))throw Error('EXPLICIT_MODE_REQUIRED');
   if(!valid(args.request_id)||!Number.isInteger(args.group_id)||args.group_id<0||!Array.isArray(args.expected_tab_ids)||!args.expected_tab_ids.length||args.expected_tab_ids.some(x=>!Number.isInteger(x)||x<0)||new Set(args.expected_tab_ids).size!==args.expected_tab_ids.length)throw Error('INVALID_GROUP_UNGROUP_ARGUMENTS');
   const receiptKey='brodexGroupUngroup:'+id+':'+args.request_id;
   if(await read(receiptKey))throw Error('GROUP_UNGROUP_ALREADY_ATTEMPTED: inspect group; never replay');
   const b=s.bindings[args.group_id];if(!b||b.mode!==args.mode)throw Error('GROUP_NOT_REGISTERED');
   if(b.epoch!==await epoch()||b.status!=='open')throw Error('SAVED_GROUP_UNGROUP_UNSUPPORTED: only open registered groups');
   if(b.ungroupPending)throw Error('GROUP_UNGROUP_OUTCOME_UNKNOWN: inspect before another attempt');
   const equal=ts=>ts.length===args.expected_tab_ids.length&&ts.every(x=>args.expected_tab_ids.includes(x.id)&&x.groupId===b.id&&!!x.incognito===(args.mode==='incognito'));
   let tabs=await c.tabs.query({groupId:b.id});if(!equal(tabs))throw Error('GROUP_MEMBERSHIP_CHANGED');
   const g=await c.tabGroups.get(b.id),w=await c.windows.get(g.windowId);if(!!w.incognito!==(args.mode==='incognito'))throw Error('MODE_MISMATCH');
   b.ungroupPending={request_id:args.request_id};await commit(id,s);
   // Record intent before mutation. Any ambiguous result blocks automatic replay.
   await save(receiptKey,{group_id:b.id,state:'prepared'});
   tabs=await c.tabs.query({groupId:b.id});if(!equal(tabs))throw Error('GROUP_MEMBERSHIP_CHANGED');
   await save(receiptKey,{group_id:b.id,state:'outcome_unknown'});
   await c.tabs.ungroup(args.expected_tab_ids);
   const remaining=await c.tabs.query({groupId:b.id});
   const all=await c.tabs.query({});
   const affected=all.filter(t=>args.expected_tab_ids.includes(t.id));
   const verified=remaining.length===0&&affected.length===args.expected_tab_ids.length&&affected.every(t=>t.groupId===-1&&t.windowId===g.windowId&&!!t.incognito===(args.mode==='incognito'));
   if(!verified)return {ungrouped:false,outcome:'partial_or_changed',remaining_tab_ids:remaining.map(t=>t.id),retry_action:false,saved_group_deleted:'unknown'};
   s=await loadRaw(id);delete s.bindings[args.group_id];if(s.copyPlan?.source===args.group_id)delete s.copyPlan;
   await commit(id,s);await save(receiptKey,{group_id:args.group_id,state:'verified'});
   return {ungrouped:true,group_id:args.group_id,open_tab_ids:args.expected_tab_ids,registry_removed:true,saved_group_deleted:'unknown',verification:'all_expected_tabs_open_ungrouped; saved_menu_requires_external_check',retry_action:false};
  }

  if(command==='attach_tab'){
   if(args.user_confirmed!==true)throw Error('EXPLICIT_USER_AUTHORIZATION_REQUIRED');
   if(args.restore_record_id)throw Error('GROUP_BIND_REQUIRED: use task_group bind, not per-tab recovery');
   const t=await c.tabs.get(args.tab_id),u=new URL(args.expected_url);if(!hint(u.href)||t.url!==u.href||t.pendingUrl&&t.pendingUrl!==u.href)throw Error('PAGE_CHANGED_OR_URL_UNSUPPORTED');
   const all=await registry(),session=await c.storage.session.get(null),e=await epoch();
   for(const [other,v] of Object.entries(all))if(other!==id&&Object.values(v.bindings).some(b=>b.id===t.groupId&&b.epoch===e))throw Error('TAB_BELONGS_TO_OTHER_TASK');
   for(const [k,v] of Object.entries(session))if(k.startsWith(prefix)&&k!==prefix+id){const other=normalize(v);if(other.attached?.includes(t.id)||Object.values(other.bindings).some(b=>b.id===t.groupId&&b.epoch===e))throw Error('TAB_BELONGS_TO_OTHER_TASK');}
   if(!s.tabs.includes(t.id))s.attached.push(t.id);revoked.delete(t.id);await commit(id,s);return describe(id);
  }
  if(command==='task_group'){
   if(args.user_confirmed!==true)throw Error('EXPLICIT_USER_AUTHORIZATION_REQUIRED');
   if(!['normal','incognito'].includes(args.mode))throw Error('EXPLICIT_MODE_REQUIRED');
   if(args.action==='bind'){
    const g=await c.tabGroups.get(args.group_id),w=await c.windows.get(g.windowId);if(!!w.incognito!==(args.mode==='incognito'))throw Error('MODE_MISMATCH');
    const all=await registry(),session=await c.storage.session.get(null),e=await epoch();
    for(const [other,v] of Object.entries(all))if(other!==id&&Object.values(v.bindings).some(b=>b.id===g.id&&b.epoch===e))throw Error('GROUP_BELONGS_TO_OTHER_TASK');
    for(const [k,v] of Object.entries(session))if(k.startsWith(prefix)&&k!==prefix+id&&Object.values(normalize(v).bindings).some(b=>b.id===g.id&&b.epoch===e))throw Error('GROUP_BELONGS_TO_OTHER_TASK');
    if(args.previous_group_id!==undefined){const old=s.bindings[args.previous_group_id];if(!old||old.mode!==args.mode||old.status==='open')throw Error('PREVIOUS_GROUP_NOT_UNAVAILABLE');delete s.bindings[args.previous_group_id];if(s.copyPlan?.source===args.previous_group_id)delete s.copyPlan;}
    s.bindings[g.id]={id:g.id,epoch:e,mode:args.mode,windowId:g.windowId,name:g.title||'',status:'open',records:[]};await commit(id,s);return describe(id);
   }
   const b=s.bindings[args.group_id];if(!b||b.mode!==args.mode)throw Error('GROUP_NOT_REGISTERED');
   if(args.action==='forget'){
    // Removes only the registry binding; never mutates the browser group.
    if(b.epoch===await epoch()&&b.status==='open')for(const r of b.records){revoked.add(r.tab_id);if(typeof brodexLoseWork==='function')brodexLoseWork(r.tab_id);}
    delete s.bindings[args.group_id];if(s.copyPlan?.source===args.group_id)delete s.copyPlan;await commit(id,s);return {forgotten:true,...await describe(id)};
   }
   if(args.action==='copy'){
    if(b.deletePending)throw Error('GROUP_DELETE_PENDING: inspect partial deletion; do not restore a copy');
    if(Object.values(s.bindings).some(g=>g.status==='open'))throw Error('TASK_ALREADY_HAS_OPEN_GROUP');if(s.copyPlan)throw Error('COPY_OUTCOME_REQUIRES_REVIEW');
    if(b.records.length>20)throw Error('GROUP_TAB_LIMIT: copy requires more than 20 tabs');
    if(!b.records.length||b.records.some(r=>!r.url))throw Error('GROUP_COPY_URLS_INCOMPLETE');
    // Store intent before opening. Never automatically retry a partially completed copy.
    s.copyPlan={mode:b.mode,source:b.id,records:b.records.map(r=>({url:r.url,request_id:'copy-'+crypto.randomUUID()})),completed:[]};await commit(id,s);
    for(const r of s.copyPlan.records){const result=await reopen({task_id:id,request_id:r.request_id,url:r.url,mode:b.mode,group_name:s.groupName});s=await loadRaw(id);s.copyPlan.completed.push(result.tab_id);await commit(id,s);}
    delete s.bindings[b.id];delete s.copyPlan;await commit(id,s);return {created_copy:true,restoration_attempt:true,urls_sanitized:true,...await describe(id)};
   }
   throw Error('INVALID_GROUP_ACTION');
  }
  if(command==='rename_group'){
   const b=s.bindings[args.group_id];if(!b||b.status!=='open')throw Error('GROUP_NOT_REGISTERED');
   if(typeof args.name!=='string'||!args.name.trim()||args.name.length>80||/[\x00-\x1f\x7f]/.test(args.name))throw Error('INVALID_GROUP_NAME');
   const name='Brodex · '+args.name.replace(/^Brodex\s*[·:—-]?\s*/i,'').trim(),g=await c.tabGroups.update(b.id,{title:name});s.groupName=name;b.name=name;await commit(id,s);return {group_id:g.id,name:g.title};
  }
  throw Error('UNKNOWN_COMMAND');
 }
 return {handle,load:refresh,persist,describe,observe,guard,tracks:tabId=>owners.has(tabId)};
}
