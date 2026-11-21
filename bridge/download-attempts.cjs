'use strict';
// Durable normal-mode attempts, session-memory-only private attempts. Never store general history.
const storage=require('./metadata-client.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const privateAttempts=new Map();
// Read-only existence probe before entering the transaction which creates task
// directories. A restarted process has no private Map entry to identify mode.
async function hasNormalJournal(task){if(!valid(task))throw Error('INVALID_TASK_ID');return storage.exists('tasks/'+task+'/download-attempts.json');}
const valid=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
const hint=s=>{const u=new URL(s);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('HTTP_URL_REQUIRED');return u.origin+u.pathname;};
async function call(bridge,name,args){const r=await bridge(name,args);if(!r.ok){const e=Error(r.error||'BRIDGE_FAILED');e.dispatch_state=r.error_info?.dispatch_state||r.dispatch_state||'unknown';throw e;}return r.value;}
async function folder(task){return storage.taskDirectory(task);}

async function normal(task){const file=path.join(await folder(task),'download-attempts.json'),data=await storage.read(file)||[];if(!Array.isArray(data))throw Error('INVALID_JOURNAL');return {file,data};}
async function read(task){const n=await normal(task);return {...n,all:[...n.data,...(privateAttempts.get(task)||[])]};}
async function save(task,a){
 a.updated_at=new Date().toISOString();
 if(a.mode==='incognito'){const list=privateAttempts.get(task)||[];privateAttempts.set(task,[...list.filter(x=>x.attempt_id!==a.attempt_id),structuredClone(a)]);return;}
 const n=await normal(task);const data=[...n.data.filter(x=>x.attempt_id!==a.attempt_id),a];
 await storage.atomic(n.file,data);
}
async function get(task,id){if(!valid(id))throw Error('INVALID_ATTEMPT_ID');const a=(privateAttempts.get(task)||[]).find(x=>x.attempt_id===id)||(await read(task)).all.find(x=>x.attempt_id===id);if(!a)throw Error('ATTEMPT_NOT_FOUND: private attempts do not survive MCP restart');if(a.retired)throw Error('DOWNLOAD_ATTEMPT_RETIRED: ID reserved; do not repeat');return a;}
const summary=d=>({download_id:d.download_id,start_time:d.start_time,filename:d.filename,state:d.state,error:d.error||null,bytes_received:d.bytes_received,total_bytes:d.total_bytes,file_size:d.file_size,paused:d.paused,exists:d.exists,danger:d.danger,mime:d.mime});
const identity=d=>crypto.createHash('sha256').update(JSON.stringify([d.download_id,d.start_time,d.url])).digest('hex');
// Compatibility is restricted to the former blob serialization, not ID/time alone.
function matchesIdentity(b,d){if(b.identity===identity(d))return true;if(b.identity_version||!d.url?.startsWith('blob:'))return false;const u=new URL(d.url);return b.identity===identity({...d,url:u.origin+u.pathname});}
function reconcile(a){
 const ds=a.downloads||[];
 a.linked_status=!ds.length?'unassigned':ds.some(d=>d.inspection_error)?'inspection_required':ds.some(d=>d.state==='interrupted')?'error':ds.every(d=>d.collected)?'all_linked_transferred':ds.every(d=>d.state==='complete')?'all_linked_complete':'in_progress';
 const complete=ds.length>0&&ds.every(d=>d.source_verified&&!d.inspection_error&&(d.collected||d.state==='complete'&&d.exists===true));
 if(complete){a.phase='completed';a.completed_at||=new Date().toISOString();a.completion_scope='linked_downloads';}
 else if(a.phase==='completed'){a.phase='inspection_required';delete a.completed_at;}
}
function windowBase(a){const step=current(a);return step.action_at||step.prepared_at||a.started_at;}
async function history(a,bridge,windowStart){const start=Date.parse(windowStart||windowBase(a));if(!Number.isFinite(start)||start<Date.parse(a.started_at)||start>Date.now()+1000)throw Error('INVALID_ATTEMPT_WINDOW');return call(bridge,'download_history',{started_after:new Date(start).toISOString(),started_before:new Date(start+600000).toISOString(),mode:a.mode});}
async function lookup(a,b,bridge){const start=Date.parse(b.start_time);const h=await call(bridge,'download_history',{started_after:new Date(start-1).toISOString(),started_before:new Date(start+1).toISOString(),mode:a.mode});const d=h.downloads.find(d=>d.download_id===b.download_id);if(!d||!matchesIdentity(b,d))throw Error('DOWNLOAD_IDENTITY_CHANGED_OR_MISSING');return d;}
// Old journals remain usable: the former single action becomes the first step.
function steps(a){
 if(!a.steps)a.steps=[{step_id:'initial',phase:a.phase,prepared_at:a.started_at,source:a.source,...(a.action_at?{action_at:a.action_at}:{})}];
 return a.steps;
}
function current(a){return steps(a).at(-1);}
const continuable=new Set(['form_opened','generation_started','report_ready','not_dispatched']);
async function handle(name,args,bridge,privateMode=false){
 if(name==='prepare_download_attempt'){
  if(!valid(args.attempt_id))throw Error('INVALID_ATTEMPT_ID');if(!privateMode)await folder(args.task_id);
  const {all}=privateMode?{all:privateAttempts.get(args.task_id)||[]}:await read(args.task_id);const old=all.find(a=>a.attempt_id===args.attempt_id);
  if(old){
   if(old.retired)throw Error('DOWNLOAD_ATTEMPT_RETIRED');
   if(old.tab_id!==args.tab_id||old.expected_filename!==(args.expected_filename||null))throw Error('REQUEST_ID_CONFLICT');
   if(!args.step_id)return {attempt:old,reused:true,next:'Inspect the current step; use an explicit new step_id only after its outcome is established.'};
   if(!valid(args.step_id))throw Error('INVALID_STEP_ID');
   const known=steps(old).find(s=>s.step_id===args.step_id);
   if(known){if(known.source!==hint(args.expected_url))throw Error('REQUEST_ID_CONFLICT');return {attempt:old,step:known,reused:true};}
   const prev=current(old);
   if(old.phase==='completed'||!continuable.has(prev.outcome)||!prev.inspected_at)throw Error('STEP_OUTCOME_REQUIRES_INSPECTION');
   const ts=await call(bridge,'list_tasks',{}),t=ts.tasks.find(t=>t.task_id===args.task_id),tab=t?.tabs?.find(t=>t.tab_id===args.tab_id);
   if(!tab||t.needs_restore||tab.url!==args.expected_url||tab.mode!==old.mode)throw Error('TASK_TAB_CHANGED');
   const step={step_id:args.step_id,phase:'prepared',prepared_at:new Date().toISOString(),source:hint(args.expected_url)};
   old.steps.push(step);old.phase='prepared';await save(args.task_id,old);return {attempt:old,step};
  }
  const tasks=await call(bridge,'list_tasks',{});const task=tasks.tasks.find(t=>t.task_id===args.task_id);
  const tab=task?.tabs?.find(t=>t.tab_id===args.tab_id);if(!tab||task.needs_restore)throw Error('TASK_TAB_RESTORE_REQUIRED');
  if(tab.url!==args.expected_url)throw Error('PAGE_CHANGED');
  if(args.expected_filename&&(/[\\/\x00-\x1f]/.test(args.expected_filename)||args.expected_filename.length>255))throw Error('INVALID_FILENAME');
  const a={attempt_id:args.attempt_id,task_id:args.task_id,tab_id:args.tab_id,mode:tab.mode,source:hint(args.expected_url),expected_filename:args.expected_filename||null,started_at:new Date().toISOString(),phase:'prepared',downloads:[]};
  if(args.previous_attempt_id){await get(args.task_id,args.previous_attempt_id);a.previous_attempt_id=args.previous_attempt_id;}
  if(args.step_id&&!valid(args.step_id))throw Error('INVALID_STEP_ID');
  a.steps=[{step_id:args.step_id||'initial',phase:'prepared',prepared_at:a.started_at,source:a.source}];
  await save(args.task_id,a);return {attempt:a,next:'Execute this step once, inspect downloads and the page, then record its observed outcome.'};
 }
 if(name==='list_download_attempts')return {attempts:privateMode?(privateAttempts.get(args.task_id)||[]):(await read(args.task_id)).all};
 const a=await get(args.task_id,args.attempt_id);
 if(name==='execute_download_attempt'){
  const step=current(a);
  if((args.step_id||'initial')!==step.step_id)throw Error('CURRENT_STEP_REQUIRED');
  if(step.phase!=='prepared'||a.phase==='completed')return {attempt:a,dispatched:false,reused:true,next:'Outcome may be unknown. Inspect; never repeat this action automatically.'};
  try{
  if(Date.now()-Date.parse(step.prepared_at)>120000)throw Error('PREPARATION_EXPIRED: inspect and record not_dispatched before preparing a new step');
  if(hint(args.expected_url)!==step.source)throw Error('PAGE_CHANGED');
  if(args.action==='click'&&(!args.snapshot_id||!args.element_id)||args.action==='click_at'&&(!args.snapshot_id||!Number.isFinite(args.x)||!Number.isFinite(args.y))||args.action==='download_file'&&(!args.url||!args.filename))throw Error('ACTION_ARGUMENTS_REQUIRED');
  if(!['click','click_at','download_file'].includes(args.action))throw Error('ACTION_NOT_SUPPORTED');
  const ts=await call(bridge,'list_tasks',{});const task=ts.tasks.find(t=>t.task_id===args.task_id);const tab=task?.tabs?.find(t=>t.tab_id===a.tab_id);
  if(!tab||task.needs_restore||tab.url!==args.expected_url||tab.mode!==a.mode)throw Error('TASK_TAB_CHANGED');
  }catch(e){e.dispatch_state='not_dispatched';throw e;}
  // Write-ahead: a crash on either side of dispatch must never cause a second click.
  a.phase='outcome_unknown';a.action_at=new Date().toISOString();step.phase='outcome_unknown';step.action_at=a.action_at;await save(args.task_id,a);
  let result;try{
   const common={tab_id:a.tab_id,expected_url:args.expected_url,request_id:'dl-'+crypto.createHash('sha256').update(JSON.stringify([args.task_id,a.attempt_id,step.step_id])).digest('hex')};
   if(args.action==='download_file')result=await call(bridge,'download_file',{...common,task_id:args.task_id,url:args.url,filename:args.filename});
   else result=await call(bridge,'act',{...common,action:args.action,snapshot_id:args.snapshot_id,...(args.action==='click'?{element_id:args.element_id}:{x:args.x,y:args.y})});
  }catch(e){if(e.dispatch_state==='not_dispatched')a.phase='not_dispatched';step.phase=a.phase;a.last_error=e.dispatch_state==='not_dispatched'?'ACTION_NOT_DISPATCHED':'ACTION_OUTCOME_REQUIRES_INSPECTION';await save(args.task_id,a);return {attempt:a,error:e.message,error_info:require('./result-envelope.cjs').failure(e).error_info,next:'Inspect history and site before any retry.'};}
  a.phase='action_sent';step.phase='action_sent';if(result.download_id!==undefined){a.direct_download_id=result.download_id;await save(args.task_id,a);const h=await history(a,bridge);const d=h.downloads.find(d=>d.download_id===result.download_id);if(d)a.downloads.push({...summary(d),identity:identity(d),identity_version:2,source_verified:true,basis:'direct_download_id'});}
  reconcile(a);await save(args.task_id,a);return {attempt:a,result};
 }
 if(name==='inspect_download_attempt'){
  const h=await history(a,bridge,args.window_start);const linked=[];
  if(a.direct_download_id!==undefined&&!a.downloads.some(b=>b.download_id===a.direct_download_id)){const d=h.downloads.find(d=>d.download_id===a.direct_download_id);if(d)a.downloads.push({...summary(d),identity:identity(d),identity_version:2,source_verified:true,basis:'direct_download_id'});}
  for(const b of a.downloads){try{const d=await lookup(a,b,bridge);Object.assign(b,summary(d));delete b.inspection_error;linked.push({...d,source_verified:b.source_verified===true});}catch(e){b.inspection_error='DOWNLOAD_INSPECTION_REQUIRED';linked.push({...b,inspection_error:e.message});}}
  reconcile(a);
  a.last_checked_at=new Date().toISOString();current(a).inspected_at=a.last_checked_at;await save(args.task_id,a);
  return {attempt:a,tracked:linked,candidates:h.downloads.filter(d=>!a.downloads.some(b=>b.download_id===d.download_id)),events:h.events,possibly_truncated:h.possibly_truncated,window_expired:Date.now()>Date.parse(args.window_start||windowBase(a))+600000,warning:'Candidates are unassigned. Missing matches do not prove that no download started. Only linked metadata is persisted.'};
 }
 if(name==='record_download_step_outcome'){
  const step=current(a);
  if(args.step_id!==step.step_id)throw Error('CURRENT_STEP_REQUIRED');
  if(!['form_opened','generation_started','report_ready','download_started','failed','unknown','not_dispatched'].includes(args.outcome))throw Error('INVALID_STEP_OUTCOME');
  if(typeof args.evidence!=='string'||!args.evidence.trim()||args.evidence.length>400)throw Error('OUTCOME_EVIDENCE_REQUIRED');
  if(!step.inspected_at||Date.parse(step.inspected_at)<Date.parse(step.action_at||step.prepared_at))throw Error('DOWNLOAD_INSPECTION_REQUIRED');
  if(step.outcome===args.outcome&&step.evidence===args.evidence)return {attempt:a,reused:true};
  // Resolved actions cannot be rewritten to manufacture permission for another click.
  if(step.outcome&&step.outcome!=='unknown'&&!(step.outcome==='generation_started'&&args.outcome==='report_ready'))throw Error('STEP_OUTCOME_ALREADY_RECORDED');
  if(args.outcome==='not_dispatched'){
   if(step.phase!=='not_dispatched'&&!(step.phase==='prepared'&&Date.now()-Date.parse(step.prepared_at)>120000))throw Error('DISPATCH_NOT_RULED_OUT');
  }else if(!['action_sent','outcome_unknown'].includes(step.phase))throw Error('STEP_NOT_DISPATCHED');
  step.outcome=args.outcome;step.evidence=args.evidence;step.observed_at=new Date().toISOString();
  if(a.phase!=='completed')a.phase=args.outcome==='unknown'?'outcome_unknown':args.outcome;
  await save(args.task_id,a);return {attempt:a,next:continuable.has(args.outcome)?'Continue only with a distinct observed next action; prepare a new step_id in this attempt.':'Inspect and verify; do not repeat the action.'};
 }
 if(name==='confirm_download_source'){
  if(args.source_verified!==true)throw Error('SOURCE_VERIFICATION_REQUIRED');
  const h=await history(a,bridge,args.observed_start_time);const d=h.downloads.find(d=>d.download_id===args.download_id);if(!d)throw Error('DOWNLOAD_OUTSIDE_ATTEMPT_WINDOW');
  if(d.by_extension_id)throw Error('EXTENSION_DOWNLOAD_NOT_SITE_CANDIDATE');
  // Claims in other tasks must never be stolen, even when concurrent windows overlap.
  const registry=await storage.registry();
  for(const taskId of new Set([...Object.keys(registry),...await storage.taskIds()]))for(const other of (await read(taskId)).all)if(other.downloads.some(b=>matchesIdentity(b,d))&&(taskId!==args.task_id||other.attempt_id!==a.attempt_id))throw Error('DOWNLOAD_ALREADY_LINKED');
  if(!a.downloads.some(b=>matchesIdentity(b,d))){delete a.completed_at;a.downloads.push({...summary(d),identity:identity(d),identity_version:2,source_verified:true,basis:'agent_verified_site_and_file'});}
  const linked=a.downloads.find(b=>matchesIdentity(b,d));Object.assign(linked,summary(d));delete linked.inspection_error;reconcile(a);
  await save(args.task_id,a);return {attempt:a};
 }
 throw Error('UNKNOWN_ATTEMPT_COMMAND');
}
// Used only by collect_download after an explicit verified association.
async function status(args,bridge){
 const a=await get(args.task_id,args.attempt_id);const b=a.downloads.find(b=>b.download_id===args.download_id&&b.source_verified);if(!b)throw Error('DOWNLOAD_NOT_LINKED');const d=await lookup(a,b,bridge);
 if(d.state==='complete'&&d.exists){
  const digest=async file=>{const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink())throw Error('REGULAR_FILE_REQUIRED');const h=crypto.createHash('sha256');for await(const chunk of require('node:fs').createReadStream(file))h.update(chunk);return h.digest('hex');};
  let current;try{current=await digest(d.filename);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(current)for(const attempt of (await read(args.task_id)).all)for(const prior of attempt.downloads){
   if(!prior.source_verified||Date.parse(prior.start_time)>Date.parse(b.start_time)||prior.start_time===b.start_time&&prior.download_id>=b.download_id)continue;
   if(prior.collected?.sha256===current)throw Error('DUPLICATE_RETAINED: first copy already transferred; leave this file in Downloads');
   try{Object.assign(prior,summary(await lookup(attempt,prior,bridge)));}catch(e){if(!/IDENTITY_CHANGED_OR_MISSING/.test(e.message))throw e;}
   const base=s=>path.basename(s||'').replace(/ \(\d+\)(?=\.[^.]+$)/,'').toLowerCase();
   if(prior.state==='in_progress'&&base(prior.filename)===base(d.filename))throw Error('FIRST_DOWNLOAD_PENDING: inspect earlier download before moving possible duplicate');
   if(prior.state==='complete'&&prior.filename!==d.filename){try{if(await digest(prior.filename)===current)throw Error('FIRST_DOWNLOAD_REQUIRED: transfer earlier verified file '+prior.download_id+'; leave duplicate in Downloads');}catch(e){if(e.code!=='ENOENT')throw e;}}
  }
 }
 return {ok:true,value:{download:d,attribution:'verified_attempt'}};
}
async function collected(args,result){const a=await get(args.task_id,args.attempt_id),b=a.downloads.find(b=>b.download_id===args.download_id);if(b){b.collected={path:result.path,sha256:result.sha256,bytes:result.bytes};reconcile(a);await save(args.task_id,a);}}
let privateQueue=Promise.resolve();const serial=fn=>async(...args)=>{
 const isHandle=fn===handle,a=isHandle?args[1]:args[0],task=a.task_id;
 let privateMode=!!(a.attempt_id&&(privateAttempts.get(task)||[]).some(x=>x.attempt_id===a.attempt_id));
 if(isHandle&&args[0]==='prepare_download_attempt'){const response=await call(args[2],'list_tasks',{});const tab=response.tasks.find(t=>t.task_id===task)?.tabs?.find(t=>t.tab_id===a.tab_id);if(!tab)throw Error('TASK_TAB_RESTORE_REQUIRED');privateMode=tab.mode==='incognito';}
 if(isHandle&&args[0]==='list_download_attempts'&&!await hasNormalJournal(task))return {attempts:structuredClone(privateAttempts.get(task)||[])};
 if(privateMode){const job=privateQueue.then(()=>fn(...args,true));privateQueue=job.catch(()=>{});return job;}return storage.transaction(task,()=>fn(...args,false));
 };
module.exports={handle:serial(handle),status:serial(status),collected:serial(collected)};
