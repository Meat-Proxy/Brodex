'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const storage=require('./data-store.cjs');
const marker=path.join(path.dirname(storage.root),'native-storage-active.json');
let lease=null,queue=Promise.resolve();
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
async function active(){const s=await fs.lstat(marker).catch(e=>{if(e.code==='ENOENT')throw Error('NATIVE_STORAGE_NOT_ACTIVE');throw e;});if(!s.isFile()||s.isSymbolicLink())throw Error('NATIVE_STORAGE_MARKER_UNSAFE');const m=JSON.parse(await fs.readFile(marker,'utf8'));if(m.schema!==1||m.owner!=='native'||path.resolve(m.root)!==path.resolve(storage.root))throw Error('NATIVE_STORAGE_MARKER_INVALID');}
async function finish(){const old=lease;if(!old)return;old.release();await old.done;lease=null;}
async function validateLease(a){if(!lease||lease.id!==a.lease||lease.pid!==a.client_pid)throw Error('NATIVE_STORAGE_LEASE_LOST');}
function file(key){if(typeof key!=='string'||!(key==='task-workspaces.json'||/^tasks\/[a-zA-Z0-9_-]{1,100}\/(workflow\.json|download-attempts\.json|transfer-\d+\.json)$/.test(key)))throw Error('NATIVE_STORAGE_KEY_INVALID');return path.join(storage.root,...key.split('/'));}
async function safeRead(key){const p=file(key);try{const st=await fs.lstat(p);if(!st.isFile()||st.isSymbolicLink()||st.size>8*1024*1024||await fs.realpath(p)!==path.resolve(p))throw Error('NATIVE_STORAGE_FILE_UNSAFE_OR_LIMIT');return JSON.parse(await fs.readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function run(a){
 const fields={begin:['lease','client_pid','task_id'],end:['lease','client_pid'],read:['lease','client_pid','key'],write:['lease','client_pid','key','data'],task_ids:['lease','client_pid']};
 if(!a||!fields[a.action]||Object.keys(a).some(k=>k!=='action'&&!fields[a.action].includes(k)))throw Error('NATIVE_STORAGE_ARGUMENTS_INVALID');
 if(a.action==='end'){if(!lease)return {released:false};await validateLease(a);await finish();return {released:true};}
 await require('./native-storage-init.cjs').initialize(storage.root);
 await active();
 if(a.action==='begin'){
  if(!uuid(a.lease)||!Number.isInteger(a.client_pid)||a.client_pid<=0)throw Error('NATIVE_STORAGE_ARGUMENTS_INVALID');
  if(lease){if(lease.id===a.lease&&lease.pid===a.client_pid)return {acquired:true};
   try{process.kill(lease.pid,0);}catch(e){if(e.code==='ESRCH')await finish();else throw Error('NATIVE_STORAGE_BUSY');}
   if(lease)throw Error('NATIVE_STORAGE_BUSY');
  }
  let resolve,reject;const acquired=new Promise((a,b)=>{resolve=a;reject=b;});
  const state={id:a.lease,pid:a.client_pid};lease=state;
  state.done=storage.transaction(a.task_id,()=>new Promise(release=>{state.release=release;resolve({acquired:true});}));
  state.done.catch(e=>{if(lease===state)lease=null;reject(e);});return acquired;
 }
 if(a.lease)await validateLease(a);else if(lease)throw Error('NATIVE_STORAGE_BUSY');
 if(a.action==='read')return safeRead(a.key);
 if(a.action==='task_ids')return storage.taskIds();
 if(a.action==='write'){
  await validateLease(a);const target=file(a.key),body=JSON.stringify(a.data);
  if(!body||Buffer.byteLength(body)>8*1024*1024)throw Error('NATIVE_STORAGE_PAYLOAD_LIMIT');
  if(a.key==='task-workspaces.json'){if(!a.data||Array.isArray(a.data)||typeof a.data!=='object'||Object.entries(a.data).some(([k,v])=>! /^[a-zA-Z0-9_-]{1,100}$/.test(k)||typeof v!=='string'||!path.isAbsolute(v)))throw Error('NATIVE_STORAGE_REGISTRY_INVALID');}
  else {if(a.key.endsWith('/download-attempts.json')?!Array.isArray(a.data):!a.data||typeof a.data!=='object'||Array.isArray(a.data))throw Error('NATIVE_STORAGE_DOCUMENT_INVALID');await storage.taskDirectory(a.key.split('/')[1]);}
  await storage.atomic(target,a.data);return {written:true};
 }
}
module.exports={handle:a=>{const p=queue.then(()=>run(a));queue=p.catch(()=>{});return p;}};
