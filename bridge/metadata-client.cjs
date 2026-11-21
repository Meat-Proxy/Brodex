'use strict';
// MCP owns semantics; native host exclusively owns durable metadata I/O.
const {AsyncLocalStorage}=require('node:async_hooks'),crypto=require('node:crypto');
const scope=new AsyncLocalStorage();let transport,queue=Promise.resolve();
const valid=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
function configure(fn){transport=fn;}
async function rpc(args){if(!transport)throw Error('NATIVE_STORAGE_NOT_CONFIGURED');const r=await transport('native_metadata',args,10000);if(!r.ok)throw Error(r.error||'NATIVE_STORAGE_FAILED');return r.value;}
async function transaction(task,fn){
 if(!valid(task))throw Error('INVALID_TASK_ID');if(scope.getStore())return fn();
 const job=queue.then(async()=>{
  const lease=crypto.randomUUID(),client_pid=process.pid;let result,error;
  try{await rpc({action:'begin',lease,client_pid,task_id:task});result=await scope.run({lease,client_pid},fn);}catch(e){error=e;}
  try{await rpc({action:'end',lease,client_pid});}catch(e){if(!error)error=e;}
  if(error)throw error;return result;
 });queue=job.catch(()=>{});return job;
}
async function call(action,extra={}){return rpc({action,...scope.getStore(),...extra});}
function key(file){return file.replaceAll('\\','/');}
async function read(file){return call('read',{key:key(file)});}
async function atomic(file,data){if(!scope.getStore())throw Error('NATIVE_STORAGE_TRANSACTION_REQUIRED');return call('write',{key:key(file),data});}
function assertSafeNote(text){if(typeof text!=='string')return;if(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\bBearer\s+\S+|\b(?:sk-(?:proj-)?|ghp_|github_pat_)[A-Za-z0-9_-]{16,}|\b(?:password|passwd|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+/i.test(text))throw Error('SENSITIVE_WORKFLOW_NOTE: do not persist credentials');}
module.exports={configure,transaction,read,atomic,assertSafeNote,registryPath:'task-workspaces.json',
 taskDirectory:async task=>{if(!valid(task))throw Error('INVALID_TASK_ID');return 'tasks/'+task;},
 registry:async()=>await read('task-workspaces.json')||{},taskIds:()=>call('task_ids'),
 exists:async file=>(await read(file))!==null};
