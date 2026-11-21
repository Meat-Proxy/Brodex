'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
function createProbe(root=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Brodex','StorageProbe')){
 const valid=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
 const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
 async function dir(create){if(create)await fs.mkdir(root,{recursive:true});const st=await fs.lstat(root);if(!st.isDirectory()||st.isSymbolicLink())throw Error('PROBE_PATH_UNSAFE');const logical=require('node:fs').realpathSync(root);if(!same(logical,path.resolve(root)))throw Error('PROBE_PATH_UNSAFE');return fs.realpath(root);}
 return async args=>{
  if(!args||Object.keys(args).some(k=>!['action','probe_id'].includes(k))||!['create','inspect','remove'].includes(args.action)||!valid(args.probe_id))throw Error('INVALID_STORAGE_PROBE');
  const physical=await dir(args.action==='create'),file=path.join(root,args.probe_id+'.json');
  let created=false;
  if(args.action==='create'){
   const data={schema:1,purpose:'brodex-native-storage-probe',probe_id:args.probe_id,writer_pid:process.pid,created_at:new Date().toISOString()};
   try{await fs.writeFile(file,JSON.stringify(data),{flag:'wx',mode:0o600});created=true;}catch(e){if(e.code!=='EEXIST')throw e;}
  }
  const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>1024)throw Error('PROBE_FILE_UNSAFE');
  const bytes=await fs.readFile(file),data=JSON.parse(bytes);if(data.schema!==1||data.purpose!=='brodex-native-storage-probe'||data.probe_id!==args.probe_id||!Number.isInteger(data.writer_pid))throw Error('PROBE_CONTENT_MISMATCH');
  const physicalFile=await fs.realpath(file);if(!same(path.dirname(physicalFile),physical))throw Error('PROBE_FILE_UNSAFE');
  const result={probe_id:args.probe_id,executor:'chrome_native_host',native_pid:process.pid,parent_pid:process.ppid,writer_pid:data.writer_pid,node_executable:process.execPath,logical_directory:root,physical_directory:physical,physical_file:physicalFile,path_redirected:!same(path.resolve(root),physical),bytes:st.size,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),created,reused:args.action==='create'&&!created};
  if(args.action==='remove'){await fs.unlink(file);result.removed=true;}
  else result.verified=true;
  return result;
 };
}
module.exports={createProbe,handle:createProbe()};
