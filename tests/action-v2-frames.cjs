const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require(process.env.BRODEX_PLAYWRIGHT_MODULE || 'playwright');
const source=n=>fs.readFileSync(path.resolve(__dirname,'../extension',n),'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BRODEX_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:900,height:700}});
  await page.route('http://fixture.test/**',r=>r.fulfill({contentType:'text/html',body:'<iframe style="margin:90px;width:400px;height:250px" src="http://fixture.test:81/child"></iframe>'}));
  await page.route('http://fixture.test:81/**',r=>r.fulfill({contentType:'text/html',body:'<button id="target" onclick="window.clicks=(window.clicks||0)+1">Child action</button><input id="text">'}));
  await page.goto('http://fixture.test/');await page.frames()[1].waitForSelector('#target');
  const cdp=await page.context().newCDPSession(page),{frameTree}=await cdp.send('Page.getFrameTree');
  const contexts={};
  for(const [id,frame] of [['top',frameTree.frame],['child',frameTree.childFrames[0].frame]])contexts[id]=(await cdp.send('Page.createIsolatedWorld',{frameId:frame.id,worldName:'brodex-test'})).executionContextId;
  const evaluate=async(id,expression)=>{const r=await cdp.send('Runtime.evaluate',{expression,contextId:contexts[id],returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const inputs=[],lease={},leases=new Map([[1,lease]]);
  const chrome={tabs:{get:async()=>({url:page.url(),groupId:2,windowId:3,incognito:false}),getZoom:async()=>1},storage:{local:{get:async()=>({brodexShowActions:false})}},scripting:{executeScript:async a=>{const id=a.target.documentIds?.[0]||'top';return [{documentId:id,frameId:id==='top'?0:1,result:await evaluate(id,'('+a.func.toString()+')(...'+JSON.stringify(a.args||[])+')')}];}},debugger:{sendCommand:async(t,m,p)=>{if(m.startsWith('Input.'))inputs.push(p);return cdp.send(m,p);}}};
  const sandbox={chrome,crypto:require('node:crypto').webcrypto,structuredClone,Uint8Array,DataView,atob,setTimeout:(f,t)=>setTimeout(f,t).unref(),clearTimeout,brodexOperationChrome:()=>chrome,brodexDebugLeases:leases,brodexRequireWork:async()=>{},brodexMaskControlImage:async data=>({data,bytes:Uint8Array.from(Buffer.from(data,'base64'))})};
  vm.createContext(sandbox);vm.runInContext(['brodex-embedded.js','brodex-action-policy.js','brodex-action-page-v2.js','brodex-action-v2.js'].map(source).join('\n')+'\nglobalThis.run=brodexActionV2;globalThis.pin=brodexFrameBoundary;brodexFrameScope=()=>globalThis.scope;',sandbox);
  await evaluate('child',source('brodex-page-reader.js'));
  const api={guard:async()=>{},save:async()=>{},read:async()=>null};
  async function prepare(method='dom',operation='activate'){
   const box=await evaluate('top','('+sandbox.pin.toString()+')({action:"pin",id:"boundary",child_index:0})');assert.ok(!box.error);
   sandbox.scope={tab_id:1,frame_id:1,document_id:'child',url:'http://fixture.test:81/child',created:Date.now(),lease,boundaries:[{id:'boundary',document_id:'top',...box}]};
   await evaluate('child','brodexReadPage(location.href,10000,100,0,0)');
   const b=await evaluate('child',`({id:__brodexSnapshot.id,element:[...__brodexSnapshot.refs].find(([id,r])=>r.el.id==='target')[0]})`);
   return sandbox.run({phase:'prepare',tab_id:1,expected_url:page.url(),snapshot_id:b.id,action:{method,operation,target:{element_id:b.element}},image:true},api);
  }
  const execute=p=>sandbox.run({phase:'execute',tab_id:1,expected_url:page.url(),preparation_id:p.preparation_id,control_token:p.control_token,report_id:p.report.report_id},api);
  let p=await prepare();assert.equal(p.status,'ready',JSON.stringify(p));assert.ok(p.image,JSON.stringify(p.evidence));let r=await execute(p);assert.equal(r.execution.dispatch_state,'sent',JSON.stringify(r));assert.equal(inputs.length,0);assert.equal(await page.frames()[1].evaluate(()=>window.clicks),1);
  p=await prepare('dom_pointer','click');r=await execute(p);assert.equal(r.execution.dispatch_state,'sent',JSON.stringify(r));assert.ok(inputs.find(p=>p.type==='mousePressed').x>90);assert.equal(await page.frames()[1].evaluate(()=>window.clicks),2);
  p=await prepare('dom_pointer','click');const before=inputs.length;await page.evaluate(()=>{const cover=document.createElement('div');cover.style.cssText='position:fixed;inset:0;z-index:999';document.body.append(cover);});r=await execute(p);assert.equal(r.execution.dispatch_state,'not_dispatched');assert.equal(inputs.length,before);assert.ok(r.report.blockers.some(b=>b.code.startsWith('FRAME_')));
  await page.evaluate(()=>document.body.lastElementChild.remove());
  p=await prepare();await page.frames()[1].goto('http://fixture.test:81/replaced');r=await execute(p);assert.equal(r.execution.dispatch_state,'not_dispatched');assert.equal(r.retry_available,false);
  console.log(JSON.stringify({passed:true,checks:['cross_origin_document_binding','frame_DOM_without_pointer','frame_control_image','pointer_coordinate_translation','parent_occlusion_before_input','frame_navigation_refusal']}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
