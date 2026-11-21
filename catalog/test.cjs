const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.BRODEX_PLAYWRIGHT_MODULE || 'playwright');
const {createBrodexCatalog}=require('./catalog.js'),{enrichAX}=require('./ax-adapter.cjs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BRODEX_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const checks=[],metrics={};
 try{
 const page=await browser.newPage();await page.route('http://fixture.test/**',r=>r.fulfill({contentType:'text/html',body:'<body></body>'}));await page.goto('http://fixture.test/');
 const cdp=await page.context().newCDPSession(page),sent=[];
 const send=async(method,args)=>{sent.push(method);return cdp.send(method,args);};
 const {frameTree}=await send('Page.getFrameTree',{});
 const {executionContextId}=await send('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'brodex-catalog-test'});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,contextId:executionContextId,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const bootstrap=()=>evaluate(`globalThis.catalog?.dispose();globalThis.catalog=(${createBrodexCatalog.toString()})();true`);
 const setup=async html=>{await page.evaluate(html=>document.body.innerHTML=html,html);await bootstrap();};
 const read=options=>evaluate('catalog.read('+JSON.stringify(options||{})+')');
 const ax=async(p,extra={})=>enrichAX(p,{send,resolveObject:async(ref,id,objectGroup)=>{
  const r=await send('Runtime.evaluate',{expression:'catalog.resolve('+JSON.stringify(ref)+','+JSON.stringify(id)+')',contextId:executionContextId,objectGroup});
  if(r.exceptionDetails)throw Error('STALE_TARGET');return r.result.objectId;
 },checkObservation:id=>evaluate('catalog.check('+JSON.stringify(id)+')'),timeoutMs:1000,...extra});
 const pass=name=>{checks.push(name);console.log('PASS',name);};
 await setup('<h2>Requirements</h2><div>Requirement</div><button>Open</button><div role="button" aria-label="Choose requirement">Requirement</div><label>Tier<input value="PRIVATE_VALUE_123"></label>');
 let p=await ax(await read());assert.equal(p.objects.find(o=>o.dom.tag==='button').ax.role,'button');assert.equal(p.objects.find(o=>o.dom.explicit_role==='button').ax.name,'Choose requirement');assert.ok(!JSON.stringify(p).includes('PRIVATE_VALUE_123'));assert.equal(p.consistency.current,true);pass('isolated-world DOM objects join AX exactly; form value omitted');
 fs.writeFileSync(path.resolve(__dirname,'../.test-output/dom-catalog-example.json'),JSON.stringify({synthetic_fixture:true,observation:p},null,2));
 p=await ax(await read({mode:'search',text:'Requirement',exact:true}));assert.ok(p.objects.some(o=>o.dom.tag==='div'&&!o.dom.explicit_role&&o.ax.role==='generic'));assert.ok(p.objects.length>1);pass('plain text surface discoverable; duplicate candidates preserved');
 const selected=p.objects.find(o=>o.dom.tag==='div'&&!o.dom.explicit_role),old=p;
 p=await read({mode:'details',ref:selected.ref,observation_id:p.observation_id});assert.equal(p.objects[0].text,'Requirement');await assert.rejects(()=>read({mode:'details',ref:selected.ref,observation_id:old.observation_id}),/STALE_OBSERVATION/);pass('details bind exact node; superseded observation refused');
 await page.evaluate(()=>document.querySelector('div').replaceWith(document.querySelector('div').cloneNode(true)));await assert.rejects(()=>read({mode:'details',ref:p.objects[0].ref,observation_id:p.observation_id}),/DOCUMENT_CHANGED/);pass('same-text replacement cannot reuse reference');
 await setup('<h2>Options</h2><ul aria-label="Choices">'+Array.from({length:1000},(_,i)=>'<li>Choice '+i+'</li>').join('')+'</ul><button>Tail</button>');
 p=await read();const group=p.objects.find(o=>o.group);assert.ok(group);assert.equal(group.group.total,null);assert.ok(p.coverage.visited_nodes<15);assert.equal(p.objects.length,3);assert.ok(JSON.stringify(p).length<10000);metrics.overview={bytes:Buffer.byteLength(JSON.stringify(p)),...p.metrics,visited:p.coverage.visited_nodes};pass('1000 rows folded without materializing children');
 p=await read({mode:'search',ref:group.ref,observation_id:p.observation_id,text:'Choice 999',exact:true,max_nodes:10000,timeout_ms:250});assert.equal(p.objects.length,1);assert.equal(p.objects[0].text,'Choice 999');metrics.search={bytes:Buffer.byteLength(JSON.stringify(p)),...p.metrics,visited:p.coverage.visited_nodes,text_nodes:p.coverage.text_nodes_examined};pass('scoped search finds last row without returning entire list');
 p=await read();const g=p.objects.find(o=>o.group);p=await read({mode:'children',ref:g.ref,observation_id:p.observation_id,limit:3});const first=p.objects.map(o=>o.text);assert.deepEqual(first,['Choice 0','Choice 1','Choice 2']);assert.ok(p.cursor);p=await read({mode:'children',cursor:p.cursor,observation_id:p.observation_id,limit:3});assert.deepEqual(p.objects.map(o=>o.text),['Choice 3','Choice 4','Choice 5']);pass('bounded group continuation has no duplicated rows');
 await page.evaluate(()=>document.querySelector('ul').prepend(document.createElement('li')));await assert.rejects(()=>read({mode:'children',cursor:p.cursor,observation_id:p.observation_id}),/STALE_CURSOR/);pass('mutation invalidates continuation');
 p=await read({mode:'search',text:'missing',max_nodes:10});assert.equal(p.coverage.complete,false);assert.equal(p.objects.length,0);pass('bounded empty search is not reported as absence');
 await setup('<div id="shadow"></div><iframe src="http://fixture.test/child"></iframe><div hidden>Hidden secret</div>');await page.evaluate(()=>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<button>Shadow choice</button>');
 p=await ax(await read());assert.equal(p.objects.find(o=>o.text==='Shadow choice').ax.role,'button');assert.equal(p.coverage.iframes_unread,1);assert.ok(!JSON.stringify(p).includes('Hidden secret'));pass('open shadow read; iframe explicitly unread; hidden text omitted');
 p=await enrichAX(await read(),{send:async()=>{throw Error('AX unavailable');},resolveObject:async()=>null,checkObservation:async()=>true});assert.equal(p.objects[0].ax.status,'unavailable');assert.ok(p.objects[0].text);pass('AX failure retains DOM observation');
 p=await ax(await read(),{checkObservation:async()=>false});assert.equal(p.consistency.current,false);assert.equal(p.objects[0].ax.status,'observation_changed');pass('changed observation never reported as consistent merge');
 assert.equal(sent.some(m=>m.startsWith('Input.')),false);await evaluate('catalog.dispose();true');await assert.rejects(()=>read(),/CATALOG_CLOSED/);pass('read-only lifecycle sends no input and releases catalogue');
 fs.writeFileSync(path.resolve(__dirname,'../.test-output/dom-catalog-prototype.json'),JSON.stringify({scope:'isolated synthetic Chrome with CDP; not installed extension/MCP',checks,metrics,limitations:['AX-only nodes not included','iframe routing not implemented','search currently DOM names/text only, not AX role/name predicates','no action authorization; no live-site test']},null,2));
 console.log(JSON.stringify(metrics));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
