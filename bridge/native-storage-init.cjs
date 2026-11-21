'use strict';
// Native-host-only first-run initialization. Existing metadata is never adopted silently.
const fs=require('node:fs/promises'),path=require('node:path');
async function initialize(root){
 const base=path.dirname(root),marker=path.join(base,'native-storage-active.json');
 await fs.mkdir(base,{recursive:true});
 const st=await fs.lstat(base);if(!st.isDirectory()||st.isSymbolicLink()||path.resolve(await fs.realpath(base)).toLowerCase()!==path.resolve(base).toLowerCase())throw Error('NATIVE_STORAGE_PATH_UNSAFE');
 try{await fs.access(marker);return;}catch(e){if(e.code!=='ENOENT')throw e;}
 const lock=path.join(base,'first-run.lock');
 await fs.mkdir(lock).catch(e=>{if(e.code==='EEXIST')throw Error('NATIVE_STORAGE_INITIALIZATION_BUSY');throw e;});
 try{
  try{await fs.access(marker);return;}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const n of ['native-storage-pending.json','Migration'])try{await fs.access(path.join(base,n));throw Error('NATIVE_STORAGE_MIGRATION_REQUIRED');}catch(e){if(e.code!=='ENOENT')throw e;}
  let data;
  try{data=await fs.lstat(root);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(data){if(!data.isDirectory()||data.isSymbolicLink()||(await fs.readdir(root)).length)throw Error('NATIVE_STORAGE_MIGRATION_REQUIRED');}
  else await fs.mkdir(root);
  await fs.writeFile(marker,JSON.stringify({schema:1,owner:'native',root:path.resolve(root),initialized_at:new Date().toISOString(),fresh_install:true}),{flag:'wx',mode:0o600});
 }finally{await fs.rmdir(lock);}
}
module.exports={initialize};
