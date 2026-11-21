// In-memory only. No URLs, DOM, values or screenshots in operation telemetry.
const brodexOperations=(()=>{
 let active=null,serial=0;
 const stoppedTabs=new Set(),stoppedTasks=new Set(),pending=new Set();
 const blocked=a=>stoppedTabs.has(a.tab_id)||stoppedTasks.has(a.task_id);
 const matches=(a,s)=>s.tab_ids.includes(a.tab_id)||(a.task_id&&a.task_id===s.task_id);
 function assert(t){if(t?.cancelled)throw Error('OPERATION_CANCELLED: inspect outcome before resuming');}
 function begin(command,args){const t={id:++serial,command,args:{tab_id:args.tab_id,task_id:args.task_id},started:Date.now(),progress:Date.now(),stage:'dispatch',cancelled:false};if(blocked(args))throw Error('TASK_STOPPED: explicit resume required');active=t;return t;}
 function describe(t=active){if(!t)return null;const elapsed=Date.now()-t.progress;return {operation_id:t.id,command:t.command,tab_id:t.args.tab_id,task_id:t.args.task_id,stage:t.stage,elapsed_ms:Date.now()-t.started,no_progress_ms:elapsed,state:t.cancelled?'stopping':elapsed>=10000?'suspected_stall':'running',outcome:t.cancelled?'unknown':'pending'};}
 function facade(root=globalThis.chrome){
  const ticket=active;
  assert(ticket);
  function wrap(obj,path){return new Proxy(obj,{get(o,key){const v=o[key];if(typeof v==='function')return (...args)=>{
   assert(ticket);if(ticket){ticket.stage=path+'.'+String(key);ticket.progress=Date.now();}
   const r=v.apply(o,args);
   // Chrome promises are not cancelled by a transport timeout. Keep the queue
   // quarantined until they settle, then reject any late continuation.
   if(r&&typeof r.then==='function')return r.then(async value=>{if(ticket?.cancelled&&path+'.'+String(key)==='chrome.debugger.attach')await root.debugger.detach(args[0]);assert(ticket);if(ticket)ticket.progress=Date.now();return value;},error=>{assert(ticket);throw error;});
   assert(ticket);return r;
  };return v&&typeof v==='object'?wrap(v,path+'.'+String(key)):v;}});}
  return wrap(root,'chrome');
 }
 function register(command,args){const entry={command,args,cancelled:blocked(args)};pending.add(entry);return entry;}
 function stop(s){for(const id of s.tab_ids)stoppedTabs.add(id);stoppedTasks.add(s.task_id);for(const e of pending)if(matches(e.args,s))e.cancelled=true;if(active&&matches(active.args,s))active.cancelled=true;}
 function resume(s){if(active&&matches(active.args,s))throw Error('OPERATION_UNRESOLVED: cannot resume before old command settles');for(const id of s.tab_ids)stoppedTabs.delete(id);stoppedTasks.delete(s.task_id);}
 return {facade,begin,describe,assert,register,stop,resume,blocked,
  finish:t=>{if(active===t)active=null;},remove:e=>pending.delete(e),
  status:s=>({active:active&&matches(active.args,s)?describe():null,queue_blocker:describe(),queued:[...pending].filter(e=>matches(e.args,s)).length,stopped:stoppedTasks.has(s.task_id)||s.tab_ids.some(id=>stoppedTabs.has(id))})};
})();
function brodexOperationChrome(){return brodexOperations.facade();}
function brodexControlBound(p,ms=2000){let timer;return Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CLEANUP_PENDING')),ms);})]).finally(()=>clearTimeout(timer));}
async function brodexTaskControl(args){
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(args.task_id)||!['status','stop','resume'].includes(args.action)||!['normal','incognito'].includes(args.mode)||!Array.isArray(args.tab_ids)||args.tab_ids.length>20||args.tab_ids.some(id=>!Number.isInteger(id)||id<0))throw Error('INVALID_TASK_CONTROL');
 // Mode validation must not depend on page scripts or the ordinary queue.
 await Promise.all(args.tab_ids.map(async id=>{let tab;try{tab=await brodexControlBound(chrome.tabs.get(id));}catch(e){if(!/No tab with id|Invalid tab ID|TAB_NOT_FOUND/i.test(e.message))throw e;return;}if((tab.incognito?'incognito':'normal')!==args.mode)throw Error('MODE_MISMATCH');}));
 if(args.action==='resume')brodexOperations.resume(args);
 if(args.action==='stop'){
  brodexOperations.stop(args);
  const cleanup=await Promise.all(args.tab_ids.map(async id=>{
   const state=brodexWorkStates.get(id);if(state)state.state='stopping';
   const lease=brodexDebugLeases.get(id);if(lease)lease.lost=true;
   // Detach does not wait for an executeScript invalidation that may be hung.
   const detach=lease?brodexReleaseDebug(id,lease):Promise.resolve();
   const invalidate=brodexInvalidateWork(id);
   const results=await Promise.allSettled([brodexControlBound(detach),brodexControlBound(invalidate)]);
   return {tab_id:id,debugger:results[0].status==='fulfilled'?(brodexDebugAttaching.has(id)?'attach_pending':'released'):'cleanup_pending',snapshot_cleanup:results[1].status==='fulfilled'?'complete':'pending'};
  }));
  return {...brodexOperations.status(args),cleanup,retry_action:false,notice:'Stop is not rollback; browser calls already sent may have an unknown outcome. Resume never replays actions.'};
 }
 return brodexOperations.status(args);
}

