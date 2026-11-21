// Configure a staged copy only. Does not register Windows native messaging or edit Codex.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function configure({directory,extensionId,node=process.execPath}){
 if(!/^[a-p]{32}$/.test(extensionId))throw Error('Expected the 32-letter Chrome extension ID');
 if(!path.isAbsolute(directory)||!path.isAbsolute(node)||!fs.existsSync(node))throw Error('Absolute bridge and existing Node paths required');
 for(const file of ['native.cjs','server.cjs','Launcher.cs'])if(!fs.existsSync(path.join(directory,file)))throw Error('Incomplete bridge: '+file);
 const names=['bridge-config.json','allowed-origin.txt','node-path.txt','com.brodex.bridge.json'];
 if(names.some(n=>fs.existsSync(path.join(directory,n))))throw Error('Existing configuration: refuse to replace credentials or binding');
 const origin='chrome-extension://'+extensionId+'/';
 const config={token:crypto.randomBytes(32).toString('hex'),pipe:'\\\\.\\pipe\\brodex-'+crypto.randomUUID()};
 const data={'bridge-config.json':JSON.stringify(config,null,2)+'\n','allowed-origin.txt':origin+'\n','node-path.txt':node+'\n','com.brodex.bridge.json':JSON.stringify({name:'com.brodex.bridge',description:'Brodex local native messaging bridge',path:path.join(directory,'BrodexNative.exe'),type:'stdio',allowed_origins:[origin]},null,2)+'\n'};
 const written=[];
 try{for(const n of names){fs.writeFileSync(path.join(directory,n),data[n],{flag:'wx',mode:0o600});written.push(n);}}
 catch(error){for(const n of written)fs.unlinkSync(path.join(directory,n));throw error;}
 return {configured:true,registered:false,launcher_build_required:true};
}
module.exports={configure};
if(require.main===module){try{console.log(JSON.stringify(configure({directory:path.resolve(__dirname,'../bridge'),extensionId:process.argv[2]})));}catch(e){console.error(e.message);process.exitCode=1;}}
