'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {configure}=require('../scripts/configure-bridge.cjs');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'brodex-config-'));
try{
 for(const n of ['native.cjs','server.cjs','Launcher.cs','common.cjs'])fs.copyFileSync(path.resolve(__dirname,'../bridge',n),path.join(directory,n));
 assert.throws(()=>configure({directory,extensionId:'invalid'}));
 const r=configure({directory,extensionId:'b'.repeat(32)});assert.equal(r.registered,false);
 const first=fs.readFileSync(path.join(directory,'bridge-config.json'),'utf8');
 const common=require(path.join(directory,'common.cjs'));assert.equal(common.ORIGIN,'chrome-extension://'+'b'.repeat(32)+'/');
 assert.equal(common.config().token.length,64);assert.equal(common.equalToken(common.config().token,common.config().token),true);
 assert.throws(()=>configure({directory,extensionId:'c'.repeat(32)}),/Existing configuration/);
 assert.equal(fs.readFileSync(path.join(directory,'bridge-config.json'),'utf8'),first);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'com.brodex.bridge.json'))).allowed_origins,[common.ORIGIN]);
 console.log('PASS: fresh credentials, consistent origin, existing configuration protected');
}finally{
 // Only this test-created directory and its known files; no recursive removal.
 for(const n of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,n));fs.rmdirSync(directory);
}
