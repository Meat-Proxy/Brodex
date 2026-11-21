const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/brodex-diagnostics.js'),'utf8')+';globalThis.create=brodexDiagnostics',c);
(async()=>{let state;const d=c.create({read:async()=>state,save:async(k,v)=>{state=v;}});
await d.record('action_v2','succeeded',null,'not_attempted',{total_ms:12.4,readiness_ms:2,operation_ms:10,verification_ms:0,queue_ms:0,text:'PRIVATE',bad:99});
let e=(await d.list({})).entries[0];assert.equal(e.command,'action_v2');assert.equal(e.metrics.total_ms,12);assert.equal(e.metrics.readiness_ms,2);assert.ok(!JSON.stringify(e).includes('PRIVATE'));
await d.record('https://private.example','failed','PRIVATE');e=(await d.list({})).entries[1];assert.equal(e.command,'unknown');assert.equal(e.reason,'UNCLASSIFIED_ERROR');
for(let i=0;i<205;i++)await d.record('read_page','succeeded');assert.equal(state.entries.length,200);assert.equal((await d.list({limit:200})).entries.length,200);
console.log('PASS versioned command names, timing allowlist, privacy and bounded retention');})().catch(e=>{console.error(e);process.exitCode=1;});
