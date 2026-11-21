'use strict';
// Brodex-owned metadata only. Never scans/downloads or deletes user artifacts.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const root=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Brodex','Data');
const registryPath=path.join(root,'task-workspaces.json');
const cursors=new Map();
const retentionMs=30*86400000,maxFileBytes=8*1024*1024;
const valid=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
// Use Node's component-wise resolver on Windows. Native realpath reports MSIX
// virtual-store backing paths even without a symlink/junction. The logical
// resolver still follows actual links, so comparison rejects redirected paths.
const logicalRealpath=async value=>process.platform==='win32'?require('node:fs').realpathSync(value):fs.realpath(value);
async function directory(dir){await fs.mkdir(dir,{recursive:true});const st=await fs.lstat(dir);if(!st.isDirectory()||st.isSymbolicLink()||!same(await logicalRealpath(dir),path.resolve(dir)))throw Error('BRODEX_DATA_PATH_UNSAFE');return dir;}
async function regular(file){const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>maxFileBytes)throw Error('BRODEX_DATA_FILE_UNSAFE');return st;}
async function atomic(file,data){const body=JSON.stringify(data,null,2);if(Buffer.byteLength(body)>maxFileBytes)throw Error('BRODEX_METADATA_LIMIT');const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(tmp,body,{flag:'wx',mode:0o600});await fs.rename(tmp,file);}finally{await fs.unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
async function init(){await directory(root);return root;}
async function registry(){await init();try{await regular(registryPath);return JSON.parse(await fs.readFile(registryPath,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}}
async function taskDirectory(task){if(!valid(task))throw Error('INVALID_TASK_ID');await init();return directory(path.join(root,'tasks',task));}
function aged(date,now){const time=Date.parse(date);return Number.isFinite(time)&&now-time>=retentionMs;}
function compactWorkflow(s,now){if(s.retired||s.status!=='completed'||!aged(s.updated_at,now))return s;
 const terminal=new Set(['verified','deviated','failed','cancelled']);if(s.operations?.some(o=>!terminal.has(o.status)||o.actions?.some(a=>!terminal.has(a.status))))return s;
 return {schema:s.schema,task_id:s.task_id,mode:s.mode,status:'completed',revision:s.revision,created_at:s.created_at,updated_at:s.updated_at,retired:true,operations:[],events:[],receipts:s.receipts||[]};
}
function compactAttempts(items,now){return items.map(a=>{
 if(a.retired||!a.downloads?.length||!a.downloads.every(d=>d.collected||a.phase==='completed'&&d.source_verified&&d.state==='complete'&&d.exists===true&&!d.inspection_error)||!aged(a.completed_at||a.updated_at||a.retention_started_at,now))return a;
 return {attempt_id:a.attempt_id,task_id:a.task_id,mode:a.mode,started_at:a.started_at,updated_at:a.updated_at,phase:'retired',retired:true,downloads:a.downloads.map(d=>({download_id:d.download_id,start_time:d.start_time,identity:d.identity,...(d.identity_version?{identity_version:d.identity_version}:{}),source_verified:true,...(d.collected?{collected:{sha256:d.collected.sha256}}:{})}))};
});}
async function maintain(task){const dir=await taskDirectory(task),now=Date.now(),names=await fs.readdir(dir);let compacted=0;
 // A bounded pass, fail-closed on active writer locks. No user files are considered.
 try{await fs.access(path.join(dir,'workflow.lock'));return {compacted:0,busy:true};}catch(e){if(e.code!=='ENOENT')throw e;}
 const eligible=names.filter(n=>/^(workflow\.json|download-attempts\.json|transfer-\d+\.json)$/.test(n)).sort(),start=(cursors.get(task)||0)%Math.max(1,eligible.length);cursors.set(task,start+100);
 for(const name of [...eligible.slice(start),...eligible.slice(0,start)].slice(0,100)){
  const file=path.join(dir,name);await regular(file);const old=JSON.parse(await fs.readFile(file,'utf8'));let next=old;
  if(name==='workflow.json')next=compactWorkflow(old,now);
  else if(name==='download-attempts.json')next=compactAttempts(old.map(a=>a.updated_at||a.retention_started_at||a.retired?a:{...a,retention_started_at:new Date(now).toISOString()}),now);
  else if(old.phase==='done'&&aged(old.updated_at||old.retention_started_at,now))next={phase:'retired',retired:true,sha256:old.sha256,attempt_id:old.attempt_id||null};
  else if(!old.updated_at&&!old.retention_started_at&&!old.retired)next={...old,retention_started_at:new Date(now).toISOString()};
  if(JSON.stringify(next)!==JSON.stringify(old)){await atomic(file,next);compacted++;}
 }return {compacted};
}
// One lock shared by all service journals for a task. A crash leaves an explicit
// stale lock rather than allowing an unknown transfer to repeat.
async function transaction(task,fn){if(!valid(task))throw Error('INVALID_TASK_ID');await init();const lock=path.join(root,'metadata.lock'),ownerFile=path.join(lock,'owner.json'),token=crypto.randomUUID();
 try{await fs.mkdir(lock);}catch(e){if(e.code!=='EEXIST')throw e;
  let owner;try{const st=await fs.lstat(lock);if(st.isSymbolicLink()||!same(await logicalRealpath(lock),path.resolve(lock)))throw Error('unsafe');await regular(ownerFile);owner=JSON.parse(await fs.readFile(ownerFile));}catch{throw Error('BRODEX_METADATA_LOCKED');}
  if(!Number.isInteger(owner.pid)||owner.pid<=0)throw Error('BRODEX_METADATA_LOCKED');
  try{process.kill(owner.pid,0);throw Error('BRODEX_METADATA_LOCKED');}catch(e){if(e.code!=='ESRCH')throw Error('BRODEX_METADATA_LOCKED');}
  // No recursive deletion: only the known owner file and now-empty lock directory.
  await fs.unlink(ownerFile);await fs.rmdir(lock);await fs.mkdir(lock);
 }
 await fs.writeFile(ownerFile,JSON.stringify({pid:process.pid,token}),{flag:'wx',mode:0o600});
 try{await maintain(task);return await fn();}finally{const owner=JSON.parse(await fs.readFile(ownerFile));if(owner.token===token){await fs.unlink(ownerFile);await fs.rmdir(lock);}}}
function assertSafeNote(text){if(typeof text!=='string')return;if(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\bBearer\s+\S+|\b(?:sk-(?:proj-)?|ghp_|github_pat_)[A-Za-z0-9_-]{16,}|\b(?:password|passwd|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+/i.test(text))throw Error('SENSITIVE_WORKFLOW_NOTE: do not persist credentials');}
async function taskIds(){await init();try{return (await fs.readdir(path.join(root,'tasks'),{withFileTypes:true})).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&valid(e.name)).map(e=>e.name);}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function hasTask(task){if(!valid(task))throw Error('INVALID_TASK_ID');try{const st=await fs.lstat(path.join(root,'tasks',task));return st.isDirectory()&&!st.isSymbolicLink();}catch(e){if(e.code==='ENOENT')return false;throw e;}}
module.exports={root,registryPath,init,registry,taskDirectory,taskIds,hasTask,transaction,maintain,atomic,assertSafeNote,compactWorkflow,compactAttempts};
