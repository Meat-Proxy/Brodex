'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const storage=require('./metadata-client.cjs');
const registryPath=storage.registryPath;
async function registry(){return storage.registry();}
async function regular(file){const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink())throw Error('REGULAR_FILE_REQUIRED');return st;}
async function hash(file){const h=crypto.createHash('sha256');for await(const chunk of require('node:fs').createReadStream(file))h.update(chunk);return h.digest('hex');}
async function atomic(file,data){data.updated_at=new Date().toISOString();await storage.atomic(file,data);}
// A tab may exist before Chrome exposes its URL. Preserve its identity without
// guessing a destination, waiting for navigation or replaying the opening action.
function historyAddress(tab){
 if(tab.url===undefined||tab.url===null||tab.url==='')return {url:null,url_state:tab.status==='loading'?'pending':'unavailable'};
 if(typeof tab.url!=='string')return {url:'[unsupported]'};
 try{
  const u=new URL(tab.url);
  return {url:['http:','https:'].includes(u.protocol)?u.origin+u.pathname:'[unsupported]'};
 }catch{return {url:'[unsupported]'};}
}
async function handle(command,args,bridge){
 if(command==='collect_download'&&args.user_confirmed!==true)throw Error('EXPLICIT_TRANSFER_AUTHORIZATION_REQUIRED');
 if(command==='sync_task_history')return {disabled:true,reason:'URL history belongs to chat; no new snapshots written'};
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(args.task_id||''))throw Error('INVALID_TASK_ID');
 const all=await registry();
 if(command==='bind_task_workspace'){
  if(!path.isAbsolute(args.workspace)||args.workspace.startsWith('\\\\'))throw Error('LOCAL_ABSOLUTE_WORKSPACE_REQUIRED');
  const root=await fs.realpath(args.workspace);if(!(await fs.stat(root)).isDirectory())throw Error('WORKSPACE_NOT_DIRECTORY');
  if(all[args.task_id]&&all[args.task_id]!==root)throw Error('WORKSPACE_ALREADY_BOUND: do not redirect another task output');
  all[args.task_id]=root;await storage.atomic(registryPath,all);
  return {task_id:args.task_id,workspace:root};
 }
 const root=all[args.task_id];if(!root)throw Error('TASK_WORKSPACE_NOT_BOUND: no fallback to current chat directory');
 if(await fs.realpath(root)!==root)throw Error('WORKSPACE_CHANGED');
 let taskFolder=root;for(const part of ['outputs','brodex',args.task_id]){taskFolder=path.join(taskFolder,part);await fs.mkdir(taskFolder).catch(e=>{if(e.code!=='EEXIST')throw e;});if(await fs.realpath(taskFolder)!==taskFolder)throw Error('DESTINATION_LINK_UNSUPPORTED');}
 if(!Number.isInteger(args.download_id)||args.download_id<0)throw Error('INVALID_DOWNLOAD_ID');
 const receiptFile=path.join(await storage.taskDirectory(args.task_id),'transfer-'+args.download_id+'.json');let receipt;
 receipt=await storage.read(receiptFile);
 if(receipt){
  if(receipt.retired)throw Error('TRANSFER_ALREADY_COMPLETED: retired receipt prevents replay');
  if(receipt.source!==args.expected_filename||receipt.kind!==args.kind||receipt.attempt_id!==(args.attempt_id||null)||args.content_verified!==true)throw Error('TRANSFER_RECEIPT_CONFLICT');
  if(path.dirname(path.dirname(receipt.path))!==taskFolder||await fs.realpath(path.dirname(receipt.path))!==path.dirname(receipt.path))throw Error('DESTINATION_CHANGED');
  // Reconcile a verified copy before consulting Chrome's stale exists flag.
  try{await regular(receipt.path);if(await hash(receipt.path)!==receipt.sha256)throw Error('COPY_VERIFICATION_FAILED: source retained');
   if(receipt.phase==='done')return {...receipt.result,reused:true};
   let sourceStat;try{if(await fs.realpath(receipt.source)!==path.resolve(receipt.source))throw Error('SOURCE_LINK_UNSUPPORTED');sourceStat=await regular(receipt.source);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(sourceStat){if(sourceStat.size!==receipt.bytes||sourceStat.mtimeMs!==receipt.mtimeMs||await hash(receipt.source)!==receipt.sha256)throw Error('SOURCE_CHANGED: source retained');await fs.unlink(receipt.source);}
   receipt.phase='done';receipt.result={task_id:args.task_id,path:receipt.path,bytes:receipt.bytes,sha256:receipt.sha256,moved:true};await atomic(receiptFile,receipt);return {...receipt.result,reused:true};
  }catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const response=await bridge('download_status',{task_id:args.task_id,download_id:args.download_id,...(args.watch_id?{watch_id:args.watch_id}:{})});
 if(!response.ok)throw Error(response.error);const d=response.value.download;
 if(response.value.attribution==='candidate_only'&&args.source_verified!==true)throw Error('DOWNLOAD_SOURCE_NOT_VERIFIED: candidate is not proof of task ownership');
 if(d.state!=='complete')throw Error('DOWNLOAD_NOT_COMPLETE');
 if(!d.exists)throw Error('DOWNLOADED_FILE_MISSING: ask user whether file is visible; expected '+d.filename+'; started '+(d.start_time||'unknown'));
 if(!['safe','accepted','allowlisted','deepScannedSafe'].includes(d.danger))throw Error('DOWNLOAD_SAFETY_NOT_CONFIRMED');
 if(d.filename!==args.expected_filename||args.content_verified!==true)throw Error('VERIFY_EXACT_FILE_AND_CONTENT_FIRST');
 let source;try{source=await fs.realpath(d.filename);}catch(e){if(e.code==='ENOENT')throw Error('DOWNLOADED_FILE_MISSING: ask user whether file is visible; expected '+d.filename+'; started '+(d.start_time||'unknown'));throw e;}if(source!==path.resolve(d.filename))throw Error('SOURCE_LINK_UNSUPPORTED');
 const before=await regular(source);
 const expectedSize=Number.isFinite(d.file_size)&&d.file_size>=0?d.file_size:d.bytes_received;
 if(Number.isFinite(expectedSize)&&expectedSize>=0&&expectedSize!==before.size)throw Error('DOWNLOAD_SIZE_CHANGED');
 const sub=args.kind==='page'?'saved-pages':'downloads';
 // Refuse symlink/junction traversal at every destination directory, including outputs.
 let folder=taskFolder;for(const part of [sub]){folder=path.join(folder,part);await fs.mkdir(folder).catch(e=>{if(e.code!=='EEXIST')throw e;});if(await fs.realpath(folder)!==folder)throw Error('DESTINATION_LINK_UNSUPPORTED');}
 const digest=await hash(source),name=path.basename(source),ext=path.extname(name),stem=name.slice(0,name.length-ext.length);let dest;
 if(receipt){if(receipt.sha256!==digest)throw Error('SOURCE_CHANGED');dest=receipt.path;}
 else for(let i=0;i<10000;i++){dest=path.join(folder,i?stem+' ('+i+')'+ext:name);try{await fs.lstat(dest);}catch(e){if(e.code==='ENOENT')break;throw e;}if(i===9999)throw Error('DESTINATION_COLLISIONS');}
 receipt={source,kind:args.kind,attempt_id:args.attempt_id||null,path:dest,sha256:digest,bytes:before.size,mtimeMs:before.mtimeMs,phase:'copy_planned'};await atomic(receiptFile,receipt);
 await fs.copyFile(source,dest,require('node:fs').constants.COPYFILE_EXCL);
 if(await hash(dest)!==digest)throw Error('COPY_VERIFICATION_FAILED: source retained');
 const after=await regular(source);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino)throw Error('SOURCE_CHANGED: source retained');
 await fs.unlink(source);const result={task_id:args.task_id,path:dest,bytes:after.size,sha256:digest,moved:true};receipt.phase='done';receipt.result=result;await atomic(receiptFile,receipt);return result;
}
// Serialize binds and transfers within this MCP server.
let queue=Promise.resolve();module.exports={handle:(...args)=>{const job=queue.then(()=>args[0]==='sync_task_history'?handle(...args):storage.transaction(args[1].task_id,()=>handle(...args)));queue=job.catch(()=>{});return job;}};
