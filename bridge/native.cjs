'use strict';
// Chrome launches this host. MCP clients communicate over a local named pipe.
const net=require('node:net'),crypto=require('node:crypto');
const {ORIGIN,config,lines,equalToken}=require('./common.cjs');
if(process.argv[2]!==ORIGIN)process.exit(1);
 const cfg=config(),pending=new Map();
const browserIdentity=require('./browser-identity.cjs')();
function send(message){const data=Buffer.from(JSON.stringify(message));if(data.length>1024*1024)throw Error('Native message too large');const size=Buffer.alloc(4);size.writeUInt32LE(data.length);process.stdout.write(Buffer.concat([size,data]));}
const server=net.createServer(socket=>{
 socket.on('error',()=>{});socket.setTimeout(35000,()=>socket.destroy());let used=false;
 lines(socket,message=>{
  if(used||!equalToken(message.token,cfg.token)){socket.destroy();return;}used=true;
  // Only authenticated MCP clients reach this narrow native-owned probe.
  if(['native_storage_probe','native_storage_migration','native_metadata'].includes(message.command)){
   (message.command==='native_metadata'?require('./native-metadata.cjs'):message.command==='native_storage_probe'?require('./native-storage-probe.cjs'):require('./native-migration-command.cjs')).handle(message.args||{}).then(value=>{if(!socket.destroyed)socket.end(JSON.stringify({ok:true,value})+'\n');},e=>{if(!socket.destroyed)socket.end(JSON.stringify({ok:false,error:e.code||e.message})+'\n');});return;
  }
  if(!['action_v2','delete_task_group','ungroup_task_group','task_group','list_tab_groups','watch_tab_group','browser_task_control','browser_work','check_ready','activate_tab','get_diagnostics','press_key','mouse_click','download_history','read_page_code','drag','upload_via_chooser','upload_file','watch_downloads','list_downloads','download_status','download_file','save_page','list_tasks','restore_task','attach_tab','rename_group','status','list_tabs','open_tab','close_tab','read_page','act','navigate','wait_for','screenshot','inspect_snapshot_changes','prepare_click','prepare_retry','execute_retry','prepare_action','execute_prepared_action','retry_preparation','wait_stable','prepare_operation','execute_operation','inspect_operation'].includes(message.command)){socket.end(JSON.stringify({ok:false,error:'UNKNOWN_COMMAND',dispatch_state:'not_dispatched',error_info:{code:'UNKNOWN_COMMAND',phase:'native_validation',dispatch_state:'not_dispatched',retry_action:false,next_step:'check_command_support'}})+'\n');return;}
  const id=crypto.randomUUID();
  const timer=setTimeout(()=>{pending.delete(id);socket.end(JSON.stringify({ok:false,error:'BROWSER_TIMEOUT: inspect tabs before retrying; reuse request_id'})+'\n');},30000);
  pending.set(id,{socket,timer});
  socket.once('close',()=>{clearTimeout(timer);pending.delete(id);});
  send({id,command:message.command,args:message.args||{}});
 },()=>socket.destroy(),12*1024*1024);
});
server.on('error',error=>{process.stderr.write('Brodex native bridge: '+error.code+'\n');process.exit(1);});
server.listen(cfg.pipe);
send({event:'brodex_browser_identity',identity:browserIdentity});
// Chrome -> native replies may carry a PNG. Native -> Chrome stays <=1 MiB.
const receive=require('./native-frames.cjs').createReceiver(message=>{
 const request=pending.get(message.id);if(!request)return;
 clearTimeout(request.timer);pending.delete(message.id);request.socket.end(JSON.stringify(message)+'\n');
});
process.stdin.on('data',chunk=>{try{receive(chunk);}catch{process.exit(1);}});
function stop(){for(const {socket,timer} of pending.values()){clearTimeout(timer);socket.destroy();}server.close();process.exit(0);}
process.stdin.on('end',stop);process.stdin.on('error',stop);

