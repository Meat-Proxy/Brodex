const assert=require('node:assert/strict');
const {chromium}=require(process.env.BRODEX_PLAYWRIGHT_MODULE || 'playwright');
const {createBrodexCatalog}=require('./catalog.js');
(async()=>{const browser=await chromium.launch({executablePath:process.env.BRODEX_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
 const page=await browser.newPage();await page.goto('about:blank');
 await page.setContent(`<form><p>${'Long text '.repeat(50)}</p><button>Target</button><select aria-label="Choices">\n<option>One</option>\n<option>Two</option>\n<!-- trailing comment -->\n<option>Three</option>\n<option>Four</option>\n<!-- end -->\n</select></form>`);
 await page.evaluate(s=>{globalThis.catalog=eval('('+s+')')();},createBrodexCatalog.toString());
 const read=o=>page.evaluate(o=>catalog.read(o),o);
 let p=await read({limit:50,timeout_ms:250});assert.equal(p.coverage.scan_complete,true);assert.equal(p.coverage.scan_reason,null);assert.equal(p.coverage.text_complete,false);assert.equal(p.coverage.complete,false);assert.equal(p.cursor,null);assert.ok(p.objects.some(o=>o.name.text==='Target'));
 let select=p.objects.find(o=>o.type==='select');p=await read({mode:'children',ref:select.ref,observation_id:p.observation_id,limit:2});assert.deepEqual(p.objects.map(o=>o.name.text),['One','Two']);assert.ok(p.cursor);assert.equal(p.coverage.scan_complete,false);assert.equal(p.coverage.text_complete,true);
 p=await read({mode:'children',cursor:p.cursor,observation_id:p.observation_id,limit:2});assert.deepEqual(p.objects.map(o=>o.name.text),['Three','Four']);assert.equal(p.cursor,null);assert.equal(p.coverage.complete,true);assert.equal(p.coverage.scan_complete,true);
 p=await read({mode:'search',text:'absent',exact:true,timeout_ms:250});assert.equal(p.objects.length,0);assert.equal(p.coverage.scan_complete,true);assert.equal(p.coverage.text_complete,false);assert.equal(p.coverage.complete,false);
 p=await read({max_nodes:10,timeout_ms:250});assert.equal(p.coverage.scan_complete,false);assert.equal(p.coverage.scan_reason,'scan_budget');
 console.log(JSON.stringify({passed:true,checks:['scan_vs_text','nonfinal_page_preserved','terminal_whitespace_and_comments','search_remains_conservative','scan_budget_preserved']}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
