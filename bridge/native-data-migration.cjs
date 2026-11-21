'use strict';
// Preparation only: never activates storage, deletes source, or moves artifacts.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const allowed=name=>/^(workflow\.json|download-attempts\.json|transfer-\d+\.json)$/.test(name);
const taskId=name=>/^[a-zA-Z0-9_-]{1,100}$/.test(name);
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
async function directory(p){const s=await fs.lstat(p);if(!s.isDirectory()||s.isSymbolicLink()||!same(await fs.realpath(p),path.resolve(p)))throw Error('MIGRATION_DIRECTORY_UNSAFE');}
async function file(p){const s=await fs.lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size>8*1024*1024)throw Error('MIGRATION_FILE_UNSAFE');const bytes=await fs.readFile(p);if(bytes.length!==s.size)throw Error('MIGRATION_SOURCE_CHANGED');JSON.parse(bytes);return {bytes,stat:s};}
async function inventory(source,options={}){
 source=path.resolve(source);await directory(source);const records=[];let total=0;
 async function add(relative){const {bytes,stat}=await file(path.join(source,relative));total+=bytes.length;if(records.length>=10000||total>64*1024*1024)throw Error('MIGRATION_BUDGET_EXCEEDED');records.push({relative:relative.split(path.sep).join('/'),bytes:bytes.length,sha256:digest(bytes),mtime_ms:stat.mtimeMs});}
 for(const entry of await fs.readdir(source,{withFileTypes:true})){
  if(entry.name==='metadata.lock'){
   if(!options.fence)throw Error('MIGRATION_WRITER_ACTIVE_OR_UNRESOLVED');
   await directory(path.join(source,entry.name));const o=JSON.parse((await file(path.join(source,entry.name,'owner.json'))).bytes);
   if(o.pid!==0||o.token!==options.fence||o.native_migration_fence!==true)throw Error('MIGRATION_WRITER_ACTIVE_OR_UNRESOLVED');continue;
  }
  if(entry.name==='task-workspaces.json'){await add(entry.name);continue;}
  if(entry.name!=='tasks')throw Error('MIGRATION_UNRECOGNIZED_ENTRY');
  await directory(path.join(source,'tasks'));
  for(const task of await fs.readdir(path.join(source,'tasks'),{withFileTypes:true})){
   if(!taskId(task.name))throw Error('MIGRATION_TASK_ID_INVALID');const dir=path.join(source,'tasks',task.name);await directory(dir);
   for(const item of await fs.readdir(dir,{withFileTypes:true})){
    if(!allowed(item.name))throw Error('MIGRATION_UNRECOGNIZED_TASK_ENTRY');await add(path.join('tasks',task.name,item.name));
   }
  }
 }
 records.sort((a,b)=>a.relative.localeCompare(b.relative));return {schema:1,source,files:records,total_bytes:total};
}
function equalInventory(a,b){return JSON.stringify(a)===JSON.stringify(b);}
async function stageCopy(source,staging){
 source=path.resolve(source);staging=path.resolve(staging);
 const relation=path.relative(source,staging);if(!relation||(!relation.startsWith('..'+path.sep)&&relation!=='..'&&!path.isAbsolute(relation)))throw Error('MIGRATION_STAGE_INSIDE_SOURCE');
 const reverse=path.relative(staging,source);if(!reverse||(!reverse.startsWith('..'+path.sep)&&reverse!=='..'&&!path.isAbsolute(reverse)))throw Error('MIGRATION_SOURCE_INSIDE_STAGE');
 const before=await inventory(source);await directory(path.dirname(staging));
 // A new stage only. Never merge/overwrite an existing or partially copied stage.
 await fs.mkdir(staging);await directory(staging);
 const stateFile=path.join(staging,'migration-state.json');
 await fs.writeFile(stateFile,JSON.stringify({phase:'copying',source,created_at:new Date().toISOString()}),{flag:'wx',mode:0o600});
 try{
  const data=path.join(staging,'data');await fs.mkdir(data);
  for(const expected of before.files){
   const input=path.join(source,expected.relative),output=path.join(data,expected.relative),read=await file(input);
   if(digest(read.bytes)!==expected.sha256||read.stat.mtimeMs!==expected.mtime_ms)throw Error('MIGRATION_SOURCE_CHANGED');
   await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,read.bytes,{flag:'wx',mode:0o600});
   const copy=await file(output);if(copy.bytes.length!==expected.bytes||digest(copy.bytes)!==expected.sha256)throw Error('MIGRATION_COPY_MISMATCH');
  }
  if(!equalInventory(before,await inventory(source)))throw Error('MIGRATION_SOURCE_CHANGED');
  const actual=await inventory(data);if(JSON.stringify(actual.files.map(({mtime_ms,...r})=>r))!==JSON.stringify(before.files.map(({mtime_ms,...r})=>r)))throw Error('MIGRATION_COPY_MISMATCH');
  const result={phase:'verified_not_active',...before,staging,source_retained:true};await fs.writeFile(stateFile,JSON.stringify(result,null,2));return result;
 }catch(e){await fs.writeFile(stateFile,JSON.stringify({phase:'failed_not_active',source,error:e.code||e.message}));throw e;}
}
module.exports={inventory,stageCopy};
