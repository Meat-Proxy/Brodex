// Execute the real native host, with a private test pipe and simulated Chrome frames.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
(async()=>{
 const source=path.resolve(__dirname,'../bridge'),fixture=path.resolve(__dirname,'../.test-output/native-fixture');fs.mkdirSync(fixture,{recursive:true});
 for(const n of fs.readdirSync(source).filter(n=>n.endsWith('.cjs')))fs.copyFileSync(path.join(source,n),path.join(fixture,n));
 fs.copyFileSync(path.resolve(__dirname,'../bridge/native.cjs'),path.join(fixture,'native.cjs'));
 fs.writeFileSync(path.join(fixture,'allowed-origin.txt'),'chrome-extension://'+'a'.repeat(32)+'/');
 const pipe='\\\\.\\pipe\\brodex-test-'+crypto.randomUUID(),token='a'.repeat(64);fs.writeFileSync(path.join(fixture,'bridge-config.json'),JSON.stringify({pipe,token}));
 const {ORIGIN}=require(path.join(fixture,'common.cjs')),child=spawn(process.execPath,[path.join(fixture,'native.cjs'),ORIGIN],{stdio:['pipe','pipe','pipe']});
 let bytes=Buffer.alloc(0),forwarded=0,stderr='',readyResolve;const ready=new Promise(resolve=>readyResolve=resolve);child.stderr.on('data',b=>stderr+=b);
 child.stdout.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);while(bytes.length>=4&&bytes.length>=4+bytes.readUInt32LE(0)){const len=bytes.readUInt32LE(0),msg=JSON.parse(bytes.subarray(4,4+len));bytes=bytes.subarray(4+len);if(msg.event){readyResolve();continue;}forwarded++;assert.equal(msg.command,'action_v2');const data=Buffer.from(JSON.stringify({id:msg.id,ok:true,value:{protocol:'brodex-action/2',phase:msg.args.phase}})),header=Buffer.alloc(4);header.writeUInt32LE(data.length);child.stdin.write(Buffer.concat([header,data]));}});
 const rpc=(command,args)=>new Promise((resolve,reject)=>{const socket=net.createConnection(pipe),timer=setTimeout(()=>{socket.destroy();reject(Error('Native timeout '+stderr));},10000);let text='';socket.on('connect',()=>socket.write(JSON.stringify({token,command,args})+'\n'));socket.on('data',b=>text+=b);socket.on('error',reject);socket.on('end',()=>{clearTimeout(timer);resolve(JSON.parse(text));});});
 let deadline;
 try{
  await Promise.race([ready,new Promise((_,reject)=>deadline=setTimeout(()=>reject(Error('Host startup timeout '+stderr)),15000))]);clearTimeout(deadline);
  for(const phase of ['capabilities','prepare','execute']){const r=await rpc('action_v2',{phase});assert.equal(r.ok,true);assert.equal(r.value.phase,phase);}
  const r=await rpc('not_a_brodex_command',{});assert.equal(r.error,'UNKNOWN_COMMAND');assert.equal(r.dispatch_state,'not_dispatched');assert.equal(forwarded,3);
  console.log(JSON.stringify({passed:true,checks:['real_native_process','action_v2_allowlist','length_prefixed_Chrome_forwarding','native_reply_routing','unknown_command_still_rejected']}));
 }finally{clearTimeout(deadline);child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
