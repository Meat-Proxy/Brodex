'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const extension=path.resolve(__dirname,'../extension');
const event=()=>({addListener(){},removeListener(){}});
const area=()=>{const values={};return {get:async key=>key===null?{...values}:Object.fromEntries((Array.isArray(key)?key:[key]).filter(k=>k in values).map(k=>[k,values[k]])),set:async data=>Object.assign(values,data),remove:async key=>{for(const k of Array.isArray(key)?key:[key])delete values[k];}};};
let nativeConnections=0;const loaded=[];
const chrome={runtime:{id:'a'.repeat(32),getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p,getManifest:()=>JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))),connectNative:name=>{assert.equal(name,'com.brodex.bridge');nativeConnections++;return {onMessage:event(),onDisconnect:event(),postMessage(){}};}},extension:{isAllowedIncognitoAccess:cb=>cb(false)},storage:{local:area(),session:area()},alarms:{create(){},onAlarm:event()},tabs:{onRemoved:event(),onUpdated:event(),onCreated:event(),onReplaced:event()},tabGroups:{onCreated:event(),onUpdated:event(),onMoved:event(),onRemoved:event()},windows:{onRemoved:event()},debugger:{onDetach:event()},downloads:{onCreated:event(),onChanged:event(),onErased:event()}};
const sandbox={chrome,crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,URL,structuredClone,performance,console,setTimeout:(f,n)=>setTimeout(f,n).unref(),clearTimeout,setInterval:(f,n)=>setInterval(f,n).unref(),clearInterval};
sandbox.self=sandbox;sandbox.addEventListener=()=>{};vm.createContext(sandbox);
sandbox.importScripts=(...names)=>{for(const name of names){assert.ok(!name.includes('..'));loaded.push(name);vm.runInContext(fs.readFileSync(path.join(extension,name),'utf8'),sandbox,{filename:name});}};
(async()=>{
 vm.runInContext(fs.readFileSync(path.join(extension,'background.js'),'utf8'),sandbox);
 const response=await vm.runInContext("brodexMcp.dispatch({id:'bootstrap',command:'status',args:{}})",sandbox);
 assert.equal(response.ok,true,JSON.stringify(response));assert.ok(response.value.capabilities.includes('action_v2'));assert.equal(nativeConnections,1);
 for(const name of loaded){const text=fs.readFileSync(path.join(extension,name),'utf8');for(const m of text.matchAll(/files:\s*\[\s*'([^']+)'\s*\]/g))assert.ok(fs.existsSync(path.join(extension,m[1])),m[1]);}
 assert.ok(!loaded.includes('brodex-legacy-lifecycle.js'));
 const capabilities=JSON.parse(fs.readFileSync(path.join(__dirname,'expected-capabilities.json'),'utf8'));
 assert.deepEqual(Array.from(response.value.capabilities),capabilities);
 console.log(JSON.stringify({passed:true,loaded_modules:loaded.length,capabilities:response.value.capabilities.length,scope:'VM bootstrap with mocked Chrome; not a live extension installation'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
