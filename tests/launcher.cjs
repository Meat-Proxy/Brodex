'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),os=require('node:os'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const {configure}=require('../scripts/configure-bridge.cjs');
(async()=>{
 if(process.platform!=='win32')throw Error('Windows launcher test requires Windows');
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'brodex-launcher-')),bridge=path.join(fixture,'bridge');
 fs.mkdirSync(bridge);for(const name of fs.readdirSync(path.resolve(__dirname,'../bridge')).filter(n=>/\.(cjs|cs)$/.test(n)))fs.copyFileSync(path.resolve(__dirname,'../bridge',name),path.join(bridge,name));
 configure({directory:bridge,extensionId:'c'.repeat(32)});
 const compiler=['Framework64','Framework'].map(n=>path.join(process.env.WINDIR,'Microsoft.NET',n,'v4.0.30319/csc.exe')).find(fs.existsSync);
 const exe=path.join(bridge,'BrodexNative.exe');execFileSync(compiler,['/nologo','/target:exe','/out:'+exe,path.join(bridge,'Launcher.cs')],{windowsHide:true});
 const origin='chrome-extension://'+'c'.repeat(32)+'/',cfg=JSON.parse(fs.readFileSync(path.join(bridge,'bridge-config.json')));
 const rejected=execFileSync(exe,['chrome-extension://'+'d'.repeat(32)+'/'],{windowsHide:true});assert.equal(rejected.length,0);
 const local=path.join(fixture,'local');fs.mkdirSync(local);
 const child=spawn(exe,[origin],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,LOCALAPPDATA:local}});
 let bytes=Buffer.alloc(0),stderr='',readyResolve;const ready=new Promise(r=>readyResolve=r);child.stderr.on('data',b=>stderr+=b);
 child.stdout.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);while(bytes.length>=4&&bytes.length>=4+bytes.readUInt32LE(0)){const len=bytes.readUInt32LE(0),m=JSON.parse(bytes.subarray(4,4+len));bytes=bytes.subarray(4+len);if(m.event){readyResolve();continue;}const body=Buffer.from(JSON.stringify({id:m.id,ok:true,value:{command:m.command}})),head=Buffer.alloc(4);head.writeUInt32LE(body.length);child.stdin.write(Buffer.concat([head,body]));}});
 const rpc=(command,args)=>new Promise((resolve,reject)=>{const socket=net.createConnection(cfg.pipe);let text='';socket.setTimeout(10000,()=>socket.destroy(Error('RPC timeout')));socket.on('connect',()=>socket.write(JSON.stringify({token:cfg.token,command,args})+'\n'));socket.on('data',b=>text+=b);socket.on('error',reject);socket.on('end',()=>{try{resolve(JSON.parse(text));}catch(e){reject(e);}});});
 let timer;
 try{
  await Promise.race([ready,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Launcher timeout: '+stderr)),20000))]);clearTimeout(timer);
  assert.equal((await rpc('status',{})).value.command,'status');
  const metadata=await rpc('native_metadata',{action:'task_ids'});assert.equal(metadata.ok,true,JSON.stringify(metadata));
  assert.equal(JSON.parse(fs.readFileSync(path.join(local,'Brodex/native-storage-active.json'))).owner,'native');
  console.log('PASS: compiled launcher, wrong origin rejected, framed native transport, fresh native storage');
 }finally{clearTimeout(timer);const closed=new Promise(r=>child.once('exit',r));child.stdin.end();await Promise.race([closed,new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill();}
 // All test files remain in an isolated OS temp directory, never the release or user data.
})().catch(e=>{console.error(e);process.exitCode=1;});
