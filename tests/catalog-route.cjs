const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require(process.env.BRODEX_PLAYWRIGHT_MODULE || 'playwright');
const base=path.resolve(__dirname,'../extension'),source=n=>fs.readFileSync(path.join(base,n),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BRODEX_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage();await page.route('http://fixture.test/**',r=>r.fulfill({contentType:'text/html',body:'<button>Save</button><ul aria-label="Items"><li>A</li><li>B</li></ul><input value="SECRET">'}));await page.goto('http://fixture.test/');
  const cdp=await page.context().newCDPSession(page);const {frameTree}=await cdp.send('Page.getFrameTree');
  const {executionContextId}=await cdp.send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'brodex-test'});
  const evaluate=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,contextId:executionContextId,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
  let changed=false,calls=0;const leases=new Map([[1,{lost:false}]]);
  const sandbox={crypto:require('node:crypto').webcrypto,brodexDebugLeases:leases,chrome:{scripting:{executeScript:async a=>{
   calls++;assert.equal(a.world,'ISOLATED');assert.equal(a.target.tabId,1);
   if(a.files){assert.deepEqual(Array.from(a.target.frameIds),[0]);for(const file of a.files)await evaluate(source(file));return [{frameId:0,documentId:'doc-1'}];}
   assert.deepEqual(Array.from(a.target.documentIds),['doc-1']);if(changed)throw Error('DOCUMENT_REMOVED');
   return [{frameId:0,documentId:'doc-1',result:await evaluate('('+a.func.toString()+')(...'+JSON.stringify(a.args)+')')}];
  }}}};
  vm.createContext(sandbox);vm.runInContext(source('brodex-embedded.js')+'\n'+source('brodex-catalog-reader.js')+'\nglobalThis.read=brodexReadCatalog;',sandbox);
  const read=catalog=>sandbox.read({tab_id:1,expected_url:page.url(),catalog});
  await evaluate('globalThis.__brodexSnapshot={id:"legacy"}');
  let p=await read({});assert.equal(p.objects[0].name.text,'Save');assert.equal(p.actions_authorized,false);assert.ok(!JSON.stringify(p).includes('SECRET'));assert.equal(await evaluate('__brodexSnapshot.id'),'legacy');
  const group=p.objects.find(o=>o.name.text==='Items');p=await read({mode:'children',ref:group.ref,observation_id:p.observation_id});assert.equal(p.objects.length,2);
  let old=p;leases.set(1,{lost:false});await assert.rejects(read({mode:'details',ref:old.objects[0].ref,observation_id:old.observation_id}),/STALE_OBSERVATION/);
  p=await read({});await page.evaluate(()=>document.querySelector('button').textContent='Changed');await assert.rejects(read({mode:'details',ref:p.objects[0].ref,observation_id:p.observation_id}),/DOCUMENT_CHANGED/);
  const before=calls;for(const args of [{catalog:{limit:0}},{catalog:{},frame_id:2},{catalog:{},group:{}},{catalog:{bogus:1}},{catalog:{ref:'o1'}}])await assert.rejects(sandbox.read({tab_id:1,expected_url:page.url(),...args}));assert.equal(calls,before);
  await assert.rejects(sandbox.read({tab_id:1,expected_url:'http://fixture.test/wrong',catalog:{}}),/PAGE_CHANGED/);
  changed=true;await assert.rejects(read({}),/DOCUMENT_REMOVED/);changed=false;
  leases.get(1).lost=true;const count=calls;await assert.rejects(read({}),/WORK_SESSION_DETACHED/);assert.equal(calls,count);
  console.log(JSON.stringify({passed:true,checks:['isolated_world','document_id_binding','read_only_cards','legacy_snapshot_preserved','continuation','lease_change_refusal','mutation_refusal','validation_before_injection','url_change_refusal','document_change_refusal','detached_work_refusal']}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
