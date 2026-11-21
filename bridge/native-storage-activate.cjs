'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {inventory}=require('./native-data-migration.cjs');
const same=(a,b)=>JSON.stringify(a.files.map(({mtime_ms,...r})=>r))===JSON.stringify(b.files.map(({mtime_ms,...r})=>r));
async function activate(local,id,source){
 const base=path.join(local,'Brodex'),root=path.join(base,'Data'),stage=path.join(base,'Migration',id),marker=path.join(base,'native-storage-active.json'),pending=path.join(base,'native-storage-pending.json');
 async function json(p){const s=await fs.lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size>8*1024*1024||await fs.realpath(p)!==path.resolve(p))throw Error('MIGRATION_STATE_UNSAFE');return JSON.parse(await fs.readFile(p,'utf8'));}
 try{const m=await json(marker);if(m.migration_id!==id||m.owner!=='native'||m.root!==root)throw Error('MIGRATION_ALREADY_ACTIVE_CONFLICT');return {phase:'active',root,reused:true,source_retained:true};}catch(e){if(e.code!=='ENOENT')throw e;}
 const manifest=await json(path.join(stage,'migration-state.json'));
 if(manifest.phase!=='verified_not_active'||manifest.source!==source||manifest.staging!==stage)throw Error('MIGRATION_STAGE_INVALID');
 if(!same(await inventory(source,{fence:id}),manifest))throw Error('MIGRATION_SOURCE_CHANGED_RESTAGE_REQUIRED');
 let intent;
 try{intent=await json(pending);if(intent.migration_id!==id||intent.root!==root)throw Error('MIGRATION_PENDING_CONFLICT');}catch(e){if(e.code!=='ENOENT')throw e;}
 let destinationExists=true;try{await fs.lstat(root);}catch(e){if(e.code!=='ENOENT')throw e;destinationExists=false;}
 if(destinationExists&&!intent)throw Error('MIGRATION_DESTINATION_EXISTS');
 if(!destinationExists&&!same(await inventory(path.join(stage,'data')),manifest))throw Error('MIGRATION_STAGE_CHANGED');
 const lock=path.join(source,'metadata.lock'),ownerFile=path.join(lock,'owner.json');
 // pid 0 is deliberately unrecoverable by old data-store versions: retained
 // source is frozen, never a fallback writer after native activation.
 try{await fs.mkdir(lock);await fs.writeFile(ownerFile,JSON.stringify({pid:0,token:id,native_migration_fence:true}),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const o=await json(ownerFile);if(o.token!==id||o.pid!==0||o.native_migration_fence!==true)throw Error('MIGRATION_SOURCE_WRITER_NOT_STOPPED');}
 const current=await inventory(source,{fence:id});if(!same(current,manifest))throw Error('MIGRATION_SOURCE_CHANGED_RESTAGE_REQUIRED');
 if(!destinationExists){
  const data=path.join(stage,'data');if(!same(await inventory(data),manifest))throw Error('MIGRATION_STAGE_CHANGED');
  if(!intent)await fs.writeFile(pending,JSON.stringify({migration_id:id,root,source}),{flag:'wx'});
  await fs.rename(data,root);
 }
 if(!same(await inventory(root),manifest))throw Error('MIGRATION_DESTINATION_MISMATCH');
 const state={schema:1,owner:'native',migration_id:id,root,source,activated_at:new Date().toISOString()};
 const tmp=marker+'.'+require('node:crypto').randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(state),{flag:'wx'});await fs.rename(tmp,marker);
 return {phase:'active',root,source_retained:true,source_frozen:true};
}
module.exports={activate};
