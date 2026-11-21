'use strict';
// Bookkeeping only: no browser commands, permissions, automatic replay or cleanup.
const storage=require('./metadata-client.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const id={type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$',minLength:1,maxLength:100};
const note={type:'string',minLength:1,maxLength:400,description:'Maximum 400 UTF-16 code units; use a concise factual summary, never split notes into artificial transitions.'};
const base={task_id:id,mode:{type:'string',enum:['normal','incognito']}};
const kinds=['inspect','navigate','select','create','modify','move','delete','submit'];
const states=['planned','dispatched','unknown','verified','deviated','failed','cancelled'];
const operationStates=['planned','running','awaiting_verification','verified','failed','cancelled'];
const taskStates=['active','paused','completed'];
const objectSchema=properties=>({type:'object',properties,additionalProperties:false});
const definitions=[
 {name:'get_task_progress',description:'Read compact agent-recorded task/operation state. NOT browser truth or authorization. Normal mode reads workflow through the native host; Chrome must be running; incognito is MCP-process memory only. No browser action. Use history=true only for diagnosis.',inputSchema:{...objectSchema({...base,history:{type:'boolean'}}),required:['task_id','mode']},annotations:{readOnlyHint:true}},
 {name:'record_task_progress',description:'Record task/operation bookkeeping only; never executes or authorizes a browser action. Read revision first. Reuse request_id and identical arguments after an unknown metadata write. create records goal and scope from user instructions; state changes lifecycle; operation records planned/dispatched/unknown/verified/failed/cancelled. Reference the user instruction, never invent permission. Mark dispatched only after dispatch evidence; unknown after uncertain outcome; verified only after observing the expected result. Do not include secrets, form values, message bodies, full URLs or screenshots in notes. Pause blocks new operation records except verification of existing outcomes. Closing a task requires all operations terminal. Normal mode persists in Brodex user data; private mode is memory-only. This does not pause, resume or complete any external agent goal.',inputSchema:{...objectSchema({...base,request_id:id,expected_revision:{type:'integer',minimum:0},change:{type:'string',enum:['create','state','operation']},goal:note,scope:note,task_status:{type:'string',enum:taskStates},operation_id:id,kind:{type:'string',enum:kinds},object_ref:note,authorization_ref:note,operation_status:{type:'string',enum:states},evidence:note,action_request_id:id}),required:['task_id','mode','request_id','expected_revision','change']},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}}
];
// Extend the existing tools rather than adding a second, disconnected journal.
definitions[0].description='Read task/operation summaries. Use operation_id for linked action details; history=true adds bounded events. Records are agent assertions, not permission or browser truth. Normal mode uses Brodex user data, incognito MCP memory only. Never automatically replay unfinished actions.';
definitions[0].inputSchema.properties.operation_id=id;
const props=definitions[1].inputSchema.properties;
props.object_ref={...props.object_ref,description:'For a new action, omit to inherit the sole operation target. Multiple targets require an exact object_ref from object_refs. Batch details belong in desired_state. Explicit mismatches are rejected.'};
props.evidence={...props.evidence,description:'Required for state/operation transitions and action outcomes. For dispatched only, a valid matching dispatch_receipt supplies factual delivery evidence if omitted; never supplies success evidence.'};
props.change.enum.push('action');props.operation_status.enum=operationStates;
Object.assign(props,{success_criterion:note,object_refs:{type:'array',items:{type:'string',minLength:1,maxLength:400},minItems:1,maxItems:100,uniqueItems:true},action_id:id,dispatch_receipt:id,action_status:{type:'string',enum:states},desired_state:note});
definitions[1].description='Record linked task > operation > actions, without executing or authorizing browser work. create requires goal, scope and authorization_ref; state manages lifecycle. Normal journals use Brodex user data without a workspace binding; private journals use MCP memory. operation plans a semantic result with object_ref (summary), optional object_refs (exact targets), success_criterion and authorization_ref. action plans one target with its own action_id, action_request_id, kind and optional desired_state (e.g. checked=true). Action states: planned/dispatched/unknown/verified/deviated/failed/cancelled; deviated means an observed effect differs from desired_state, not permission to retry. Preserve the original expectation and describe the actual effect in evidence; operation states: planned/running/awaiting_verification/verified/failed/cancelled. Only explicit aggregate evidence verifies an operation; all actions must first be terminal. dispatched requires dispatch_receipt returned by a matching sent browser action in this MCP session and privacy mode; missing, failed or unknown results cannot be recorded as dispatched. After restart or lost receipt record unknown and verify by observation. Unknown actions cannot redispatch. Record actual observations, not predictions. For new actions omit object_ref only when the operation has exactly one target; otherwise copy one exact object_refs entry. Put batch details in desired_state. kind and action_request_id remain required. Valid dispatch_receipt supplies delivery evidence when evidence is omitted; all outcome transitions still require explicit evidence. Use the revision returned by each successful write, and stop a sequence on error. Use last revision; reuse metadata request_id and identical args after uncertain writes. Paused tasks forbid new plans/dispatch but permit outcome recording. No secrets, form values, message bodies or full URLs in notes. Records never grant permission. No automatic retries or browser instrumentation.';
props.title={type:'string',minLength:1,maxLength:80};props.change.enum.push('context');
definitions[1].description+=' create requires title as well as goal, scope and authorization_ref. context explicitly updates all four fields with evidence and expected_revision; it does not rename existing Chrome groups.';
definitions.push({name:'start_task',description:'Explicitly start browser work: persist title, goal, scope and user authorization reference before opening tabs or reading pages. Normal uses native storage; incognito MCP memory. Does not open tabs or grant permission. Same task and same context returns existing state; conflicting context requires record_task_progress change:context with revision/evidence. Existing legacy task requires context update. Preserve request_id after uncertain write.',inputSchema:{...objectSchema({...base,request_id:id,title:props.title,goal:note,scope:note,authorization_ref:note}),required:['task_id','mode','request_id','title','goal','scope','authorization_ref']},annotations:{readOnlyHint:false,destructiveHint:false}});

props.kind.description='Required when creating a NEW operation or NEW action. Optional on updates; if provided must equal the original kind. Not used for task create/context/state. inspect=read/check; navigate=change page; select=choose; create=create an artifact (including downloading a file); modify=edit; move=transfer; delete=remove; submit=send. Agent chooses from the intended result; no default.';
// Preserve the common limit once on fields with specialized descriptions.
for(const key of ['object_ref','evidence'])props[key]={...props[key],description:props[key].description+' '+note.description};
definitions[1].description+=' New operation requires kind; operation updates may omit kind. New action also requires kind. Text notes are limited to 400 UTF-16 code units. Prefer record_task_progress_chain for dependent metadata writes; never predict a revision after an unchecked response.';
const stepProps={...props};for(const k of ['task_id','mode','expected_revision'])delete stepProps[k];
definitions.push({name:'record_task_progress_chain',description:'Apply 1-20 dependent journal writes for ONE task, without browser actions. Supply initial expected_revision and unique stable request_id per step. Prevalidate all steps; execute in order, passing actual returned revision. Stop on first failure, preserving earlier committed writes. Not an atomic batch. Never automatically retry after failure/transport loss: inspect progress and resume only unapplied steps with their original IDs. Does not grant permission or invent evidence.',inputSchema:{...objectSchema({...base,expected_revision:{type:'integer',minimum:0},steps:{type:'array',minItems:1,maxItems:20,items:{...objectSchema(stepProps),required:['request_id','change']}}}),required:['task_id','mode','expected_revision','steps']},annotations:{readOnlyHint:false}});
function fieldError(code,field,details={}){const e=Error(code+': '+field+(details.max_length?' length '+details.actual_length+', maximum '+details.max_length:''));e.validation={field,...details};return e;}
function validateChain(a){
 if(!a||Object.keys(a).some(k=>!['task_id','mode','expected_revision','steps'].includes(k))||!Array.isArray(a.steps)||!a.steps.length||a.steps.length>20)throw Error('WORKFLOW_CHAIN_INVALID');
 const ids=new Set();for(const [i,s] of a.steps.entries()){
  if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!Object.hasOwn(stepProps,k)))throw Error('WORKFLOW_CHAIN_STEP_INVALID');
  if(ids.has(s.request_id))throw Error('WORKFLOW_CHAIN_DUPLICATE_REQUEST');ids.add(s.request_id);
  try{validate('record_task_progress',{...s,task_id:a.task_id,mode:a.mode,expected_revision:a.expected_revision});}catch(e){e.chain={failed_step:i+1,committed_steps:0,metadata_write_state:'not_written'};throw e;}
 }
}

const terminal=new Set(['verified','deviated','failed','cancelled']);
const allowed={planned:['dispatched','unknown','failed','cancelled'],dispatched:['verified','deviated','unknown','failed'],unknown:['verified','deviated','failed'],deviated:[],verified:[],failed:[],cancelled:[]};
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(Object.keys(x).sort().map(k=>[k,x[k]]))).digest('hex');
function validate(command,a){
 for(const k of ['title','goal','scope','object_ref','authorization_ref','success_criterion','evidence','desired_state'])storage.assertSafeNote(a?.[k]);for(const value of a?.object_refs||[])storage.assertSafeNote(value);
 if(command==='record_task_progress_chain')return validateChain(a);
 const d=definitions.find(d=>d.name===command);if(!d)throw Error('UNKNOWN_WORKFLOW_COMMAND');
 if(!a||typeof a!=='object'||Array.isArray(a))throw Error('INVALID_WORKFLOW_ARGUMENTS');
 const props=d.inputSchema.properties;
 for(const [k,v] of Object.entries(a)){const s=props[k];if(s?.type==='string'&&typeof v==='string'&&s.maxLength&&v.length>s.maxLength)throw fieldError('WORKFLOW_FIELD_TOO_LONG',k,{actual_length:v.length,max_length:s.maxLength});}
 for(const k of Object.keys(a)){const s=props[k],v=a[k];if(!s)throw Error('UNEXPECTED_WORKFLOW_FIELD');
  if(s.type==='string'&&(typeof v!=='string'||!v.trim()||v.length>s.maxLength||s.pattern&&!new RegExp(s.pattern).test(v)||/[\x00-\x1f\x7f]/.test(v)))throw Error('INVALID_WORKFLOW_FIELD');
  if(s.type==='boolean'&&typeof v!=='boolean'||s.type==='integer'&&(!Number.isSafeInteger(v)||v<0)||s.enum&&!s.enum.includes(v))throw Error('INVALID_WORKFLOW_FIELD');
  if(s.type==='array'&&(!Array.isArray(v)||v.length<1||v.length>s.maxItems||new Set(v).size!==v.length||v.some(x=>typeof x!=='string'||!x.trim()||x.length>400||/[\x00-\x1f\x7f]/.test(x))))throw Error('INVALID_WORKFLOW_FIELD');
 }
 for(const k of d.inputSchema.required)if(a[k]===undefined)throw Error('MISSING_WORKFLOW_FIELD');
 if(command==='record_task_progress'){
  const fields={create:['title','goal','scope','authorization_ref'],context:['title','goal','scope','authorization_ref','evidence'],state:['task_status','evidence'],operation:['operation_id','kind','object_ref','object_refs','success_criterion','authorization_ref','operation_status','evidence'],action:['operation_id','action_id','action_request_id','kind','object_ref','desired_state','action_status','dispatch_receipt','evidence']}[a.change];
  for(const k of Object.keys(a))if(!['task_id','mode','request_id','expected_revision','change',...fields].includes(k))throw Error('UNEXPECTED_CHANGE_FIELD');
 }
}
function migrate(old){
 if(!old||old.schema===2)return old;
 if(old.schema!==1)throw Error('WORKFLOW_FILE_INVALID');
 const s=structuredClone(old);s.schema=2;s.migrated_from=1;
 for(const o of s.operations){
  const previous=o.status;o.object_refs=[o.object_ref];o.success_criterion='Legacy operation: inspect original evidence before continuing';o.legacy=true;o.actions=[];
  if(previous!=='planned')o.actions.push({id:'legacy',kind:o.kind,object_ref:o.object_ref,status:previous,...(o.action_request_id?{action_request_id:o.action_request_id}:{}),...(o.evidence?{evidence:o.evidence}:{}),legacy:true,created_at:o.created_at,updated_at:o.updated_at});
  if(['dispatched','unknown'].includes(previous))o.status='running';
  delete o.action_request_id;
 }
 return s;
}
// Resolve only unambiguous recorded identity; never infer authorization or success.
function normalize(old,a){
 const n={...a};
 if(n.change!=='action')return n;
 const o=old?.operations.find(o=>o.id===n.operation_id);
 if(!o)return n;
 if(!o.actions.some(x=>x.id===n.action_id)&&n.action_status==='planned'){
  if(n.object_ref===undefined){
   if(o.object_refs.length!==1)throw Error('ACTION_TARGET_REQUIRED');
   n.object_ref=o.object_refs[0];
  }
 }
 // Called only after verifyDispatch; this records delivery, never completion.
 if(n.action_status==='dispatched'&&n.dispatch_receipt&&!n.evidence)
  n.evidence='Matching dispatch receipt verified; browser command sent, outcome unverified.';
 return n;
}
function reduce(old,a){
 const now=new Date().toISOString();let s=old?structuredClone(old):null;
 if(!s){if(a.change!=='create'||!a.title||!a.goal||!a.scope||!a.authorization_ref)throw Error(a.change!=='create'?'WORKFLOW_NOT_CREATED':'WORKFLOW_CREATE_FIELDS_REQUIRED: title, goal, scope, authorization_ref');
  s={schema:2,task_id:a.task_id,mode:a.mode,status:'active',title:a.title,goal:a.goal,scope:a.scope,authorization_ref:a.authorization_ref,revision:0,created_at:now,updated_at:now,operations:[],events:[],receipts:[]};
 }else if(a.change==='create')throw Error('WORKFLOW_ALREADY_EXISTS');
 if(a.change==='context'){
  if(s.status==='completed')throw Error('WORKFLOW_COMPLETED');
  if(!a.title||!a.goal||!a.scope||!a.authorization_ref||!a.evidence)throw Error('TASK_CONTEXT_FIELDS_REQUIRED');
  for(const k of ['title','goal','scope','authorization_ref'])s[k]=a[k];
 }else if(a.change==='state'){
  if(!a.task_status||!a.evidence)throw Error('STATE_EVIDENCE_REQUIRED');
  if(s.status==='completed')throw Error('WORKFLOW_COMPLETED');
  if(a.task_status==='completed'&&s.operations.some(o=>!terminal.has(o.status)||o.actions.some(x=>!terminal.has(x.status))))throw Error('UNRESOLVED_OPERATIONS');
  s.status=a.task_status;
 }else if(a.change==='operation'){
  if(s.status==='completed')throw Error('WORKFLOW_COMPLETED');
  if(!a.operation_id||!a.operation_status)throw Error('OPERATION_FIELDS_REQUIRED');
  let o=s.operations.find(o=>o.id===a.operation_id);
  if(!o){if(!a.kind)throw fieldError('WORKFLOW_REQUIRED_FIELD','kind',{required_for:'new_operation'});if(s.status!=='active'||a.operation_status!=='planned'||!a.kind||!a.object_ref||!a.authorization_ref||!a.success_criterion)throw Error('OPERATION_PLAN_REQUIRED');
   if(s.operations.length>=100)throw Error('WORKFLOW_OPERATION_LIMIT');
   o={id:a.operation_id,kind:a.kind,object_ref:a.object_ref,object_refs:a.object_refs||[a.object_ref],success_criterion:a.success_criterion,authorization_ref:a.authorization_ref,status:'planned',actions:[],created_at:now};s.operations.push(o);
  }else{
   for(const k of ['kind','object_ref','authorization_ref','success_criterion','object_refs'])if(a[k]!==undefined&&JSON.stringify(a[k])!==JSON.stringify(o[k]))throw Error('OPERATION_IDENTITY_CONFLICT');
   const transitions={planned:['running','failed','cancelled'],running:['awaiting_verification','verified','failed','cancelled'],awaiting_verification:['running','verified','failed','cancelled'],verified:[],failed:[],cancelled:[]};
   if(!transitions[o.status]?.includes(a.operation_status))throw Error('INVALID_OPERATION_TRANSITION');
   if(s.status==='paused'&&a.operation_status==='running')throw Error('WORKFLOW_PAUSED');
   if(!a.evidence)throw Error('OPERATION_EVIDENCE_REQUIRED');
   if((terminal.has(a.operation_status)||a.operation_status==='awaiting_verification')&&o.actions.some(x=>!terminal.has(x.status)))throw Error('UNRESOLVED_ACTIONS');
   o.status=a.operation_status;
  }
  if(a.evidence)o.evidence=a.evidence;o.updated_at=now;
 }else if(a.change==='action'){
  if(s.status==='completed')throw Error('WORKFLOW_COMPLETED');
  const o=s.operations.find(o=>o.id===a.operation_id);
  if(!o)throw Error('OPERATION_NOT_FOUND');if(terminal.has(o.status))throw Error('OPERATION_TERMINAL');
  if(!a.action_id||!a.action_status)throw Error('ACTION_FIELDS_REQUIRED');
  let x=o.actions.find(x=>x.id===a.action_id);
  if(!x){if(!a.kind)throw fieldError('WORKFLOW_REQUIRED_FIELD','kind',{required_for:'new_action'});
   if(s.status!=='active'||a.action_status!=='planned'||!a.kind||!a.object_ref||!a.action_request_id)throw Error('ACTION_PLAN_REQUIRED');
   if(!o.object_refs.includes(a.object_ref))throw Error('ACTION_TARGET_OUT_OF_SCOPE');
   if(o.actions.length>=100||s.operations.reduce((n,o)=>n+o.actions.length,0)>=500)throw Error('WORKFLOW_ACTION_LIMIT');
   if(s.operations.some(op=>op.actions.some(x=>x.action_request_id===a.action_request_id)))throw Error('ACTION_REQUEST_CONFLICT');
   if(s.operations.some(op=>op.actions.some(x=>x.object_ref===a.object_ref&&['dispatched','unknown'].includes(x.status))))throw Error('ACTION_OUTCOME_UNRESOLVED');
   x={id:a.action_id,action_request_id:a.action_request_id,kind:a.kind,object_ref:a.object_ref,...(a.desired_state?{desired_state:a.desired_state}:{}),status:'planned',created_at:now};o.actions.push(x);
   if(o.status==='awaiting_verification')o.status='running';
  }else{
   for(const k of ['action_request_id','kind','object_ref','desired_state'])if(a[k]!==undefined&&a[k]!==x[k])throw Error('ACTION_IDENTITY_CONFLICT');
   if(!allowed[x.status]?.includes(a.action_status))throw Error('INVALID_ACTION_TRANSITION');
   if(!a.evidence)throw Error('ACTION_EVIDENCE_REQUIRED');
   if(s.status==='paused'&&a.action_status==='dispatched')throw Error('WORKFLOW_PAUSED');
   if(a.action_status==='dispatched'&&s.operations.some(op=>op.actions.some(other=>other!==x&&other.object_ref===x.object_ref&&['dispatched','unknown'].includes(other.status))))throw Error('ACTION_OUTCOME_UNRESOLVED');
   x.status=a.action_status;
   if(['dispatched','unknown'].includes(x.status))o.status='running';
  }
  if(a.evidence)x.evidence=a.evidence;x.updated_at=now;o.updated_at=now;
 }
 s.revision++;s.updated_at=now;
 s.events.push({revision:s.revision,time:now,change:a.change,...(a.operation_id?{operation_id:a.operation_id,status:a.action_status||a.operation_status}:{status:s.status}),...(a.action_id?{action_id:a.action_id}:{}),...(a.evidence?{evidence:a.evidence}:{})});s.events=s.events.slice(-200);
 return s;
}
function createStore(registryPath=storage.registryPath,verifyDispatch=require('./action-evidence.cjs').verify){
 const privateStates=new Map();let queue=Promise.resolve();
 async function directory(task,create){return storage.taskDirectory(task);}

 async function read(file){const s=await storage.read(file);if(s===null)return null;if(Buffer.byteLength(JSON.stringify(s))>524288||![1,2].includes(s.schema)||!Array.isArray(s.operations)||!Array.isArray(s.receipts)||!Array.isArray(s.events)||!Number.isSafeInteger(s.revision))throw Error('WORKFLOW_FILE_INVALID');return s;}
 function view(s,a){
  if(!s)return {exists:false,task_id:a.task_id,mode:a.mode,revision:0};
  const {receipts,events,operations,...v}=s;
  const summary=o=>{const {actions,...rest}=o;const action_counts={};for(const x of actions)action_counts[x.status]=(action_counts[x.status]||0)+1;return {...rest,action_counts,action_count:actions.length};};
  const result={exists:true,...v,operations:operations.map(summary),recorded_by:'agent',authorization:'not_granted_by_this_record',persistence:a.mode==='normal'?'brodex_user_data':'mcp_process_memory',...(a.history?{events}:{})};
  if(a.operation_id){const o=operations.find(o=>o.id===a.operation_id);if(!o)throw Error('OPERATION_NOT_FOUND');result.operations=[summary(o)];result.operation=o;}
  return result;
 }

 async function run(command,a){
  const starting=command==='start_task';validate(command,a);
  if(starting){command='record_task_progress';a={...a,change:'create',expected_revision:0};validate(command,a);}
  const dir=a.mode==='normal'?await directory(a.task_id,command==='record_task_progress'):null,file=dir&&path.join(dir,'workflow.json');let lock;
  try{
   const old=migrate(file?await read(file):privateStates.get(a.task_id)||null);
   if(old&&(old.task_id!==a.task_id||old.mode!==a.mode))throw Error('WORKFLOW_IDENTITY_MISMATCH');
   if(command==='get_task_progress')return view(old,a);
   if(starting&&old){
    const previous=old.receipts.find(r=>r.id===a.request_id);if(previous&&previous.fingerprint!==hash(a))throw Error('WORKFLOW_REQUEST_CONFLICT');
    if(['title','goal','scope','authorization_ref'].some(k=>old[k]!==a[k]))throw Error('TASK_CONTEXT_CONFLICT: update context explicitly with revision');
    return {...view(old,a),reused_task:true,browser_action_executed:false};
   }
   if(old?.retired)throw Error('WORKFLOW_RETIRED: task ID remains reserved; do not replay');
   const fingerprint=hash(a),receipt=old?.receipts.find(r=>r.id===a.request_id);
   if(receipt){if(receipt.fingerprint!==fingerprint)throw Error('WORKFLOW_REQUEST_CONFLICT');return {task_id:a.task_id,revision:old.revision,applied_revision:receipt.revision,reused_request:true};}
   if(a.expected_revision!==(old?.revision||0))throw Error('WORKFLOW_REVISION_CONFLICT');
   if(a.change==='action'&&a.action_status==='dispatched'){
    const x=old?.operations.find(o=>o.id===a.operation_id)?.actions.find(x=>x.id===a.action_id);
    verifyDispatch(a.dispatch_receipt,x?.action_request_id,a.mode);
   }
   const normalized=normalize(old,a);const s=reduce(old,normalized);s.receipts.push({id:a.request_id,fingerprint,revision:s.revision});s.receipts=s.receipts.slice(-200);
   const body=JSON.stringify(s,null,2);if(Buffer.byteLength(body)>524288)throw Error('WORKFLOW_SIZE_LIMIT');
   if(file)await storage.atomic(file,s);
   else privateStates.set(a.task_id,s);
   return {task_id:a.task_id,revision:s.revision,task_status:s.status,...(a.operation_id?{operation_id:a.operation_id,operation_status:s.operations.find(o=>o.id===a.operation_id)?.status}:{}),...(a.action_id?{action_id:a.action_id,action_status:a.action_status}:{}),recorded:true,browser_action_executed:false};
  }finally{if(lock)await fs.rmdir(lock)}
 }

 async function execute(command,args){
  if(command!=='record_task_progress_chain')return run(command,args);
  validateChain(args);let revision=args.expected_revision;const results=[];
  for(const [i,step] of args.steps.entries()){
   try{
    const result=await run('record_task_progress',{...step,task_id:args.task_id,mode:args.mode,expected_revision:revision});
    if(result.reused_request)throw Error('WORKFLOW_CHAIN_REPLAY_REQUIRES_INSPECTION');
    if(!Number.isSafeInteger(result.revision))throw Error('WORKFLOW_CHAIN_INVALID_RESULT');
    revision=result.revision;results.push(result);
   }catch(e){e.chain={failed_step:i+1,committed_steps:results.length,last_confirmed_revision:revision,results,metadata_write_state:'inspect_required',remaining_steps_not_run:args.steps.length-i-1};throw e;}
  }
  return {task_id:args.task_id,revision,committed_steps:results.length,results,browser_action_executed:false};
 }

 return {handle(command,args){const job=queue.then(()=>args.mode==='incognito'?execute(command,args):storage.transaction(args.task_id,()=>execute(command,args)));queue=job.catch(()=>{});return job;}};
}
const store=createStore();module.exports={definitions,validate,createStore,handle:store.handle};
