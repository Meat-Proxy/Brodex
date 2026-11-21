'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {inventory,stageCopy}=require('./native-data-migration.cjs');
const local=process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local');
async function source(){
 const packages=path.join(local,'Packages'),found=[];
 for(const entry of await fs.readdir(packages,{withFileTypes:true})){
  if(!/^OpenAI\.Codex_[a-zA-Z0-9]+$/.test(entry.name))continue;
  const dir=path.join(packages,entry.name,'LocalCache','Local','Brodex','Data');
  try{await fs.lstat(dir);found.push(dir);}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 if(found.length!==1)throw Error(found.length?'MIGRATION_SOURCE_AMBIGUOUS':'MIGRATION_SOURCE_NOT_FOUND');return found[0];
}
let queue=Promise.resolve();
async function run(args){
 if(!args||Object.keys(args).some(k=>!['action','migration_id'].includes(k))||!['plan','stage','activate'].includes(args.action)||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(args.migration_id||''))throw Error('INVALID_MIGRATION_REQUEST');
 const origin=await source();if(args.action==='activate')return require('./native-storage-activate.cjs').activate(local,args.migration_id,origin);const destination=path.join(local,'Brodex','Data'),plan=await inventory(origin);
 const counts={};for(const f of plan.files){const name=path.basename(f.relative).replace(/^transfer-\d+\.json$/,'transfer-*.json');counts[name]=(counts[name]||0)+1;}
 const summary={executor:'chrome_native_host',native_pid:process.pid,migration_id:args.migration_id,source:origin,proposed_destination:destination,file_count:plan.files.length,total_bytes:plan.total_bytes,types:counts,active_storage_changed:false,source_retained:true};
 if(args.action==='plan')return {...summary,phase:'planned'};
 const parent=path.join(local,'Brodex','Migration');await fs.mkdir(parent,{recursive:true});
 const physical=await fs.realpath(parent);if(physical.toLowerCase()!==path.resolve(parent).toLowerCase())throw Error('NATIVE_MIGRATION_PATH_REDIRECTED');
 const staged=await stageCopy(origin,path.join(parent,args.migration_id));
 return {...summary,phase:staged.phase,staging:staged.staging,next_step:'stop old writers; revalidate source and stage; activate only together with native-only journal routing'};
}
module.exports={handle:args=>{const job=queue.then(()=>run(args));queue=job.catch(()=>{});return job;}};
