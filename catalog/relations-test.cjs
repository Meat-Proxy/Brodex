const assert=require('node:assert/strict');
const {chromium}=require(process.env.BRODEX_PLAYWRIGHT_MODULE || 'playwright');
const {createBrodexCatalog}=require('./catalog.js');
(async()=>{const browser=await chromium.launch({executablePath:process.env.BRODEX_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{
 const page=await browser.newPage();await page.goto('about:blank');
 await page.setContent('<form><fieldset><label for="first">Same</label><input id="first" name="left" list="choices"><label for="second">Same</label><input id="second" name="right"><input aria-label="   " title="Fallback"><input aria-label="Missing" list="absent"></fieldset><datalist id="choices"><option value="SECRET_VALUE" label="Visible label"></option><option value="SECRET_ONLY"></option><option>Plain label</option></datalist></form>');
 await page.evaluate(()=>{document.querySelector('#second').setAttribute('name','x'.repeat(250));});
 await page.evaluate(s=>{globalThis.catalog=eval('('+s+')')();},createBrodexCatalog.toString());
 const read=o=>page.evaluate(o=>catalog.read(o),o);
 let p=await read({limit:50,timeout_ms:250});const first=p.objects.find(o=>o.dom.id==='first'),second=p.objects.find(o=>o.dom.id==='second');
 assert.equal(first.name.text,second.name.text);assert.notEqual(first.ref,second.ref);assert.equal(first.dom.name,'left');assert.equal(second.dom.name.length,200);assert.deepEqual(second.dom.identity_truncated,['name']);assert.equal(first.relations.fieldset,second.relations.fieldset);assert.ok(first.relations.datalist);assert.equal(p.objects.find(o=>o.dom.explicit_role===null&&o.name.text==='Fallback').name.source,'title');assert.deepEqual(p.objects.find(o=>o.name.text==='Missing').relations.issues,[{attribute:'list',reason:'unresolved_id'}]);
 assert.ok(!JSON.stringify(p).includes('SECRET_'));assert.ok(p.objects.every(o=>o.name.text!==''));
 p=await read({mode:'details',ref:first.relations.labels[0],observation_id:p.observation_id});const label=p.objects[0];assert.equal(label.dom.tag,'label');assert.ok(label.relations.label_control);
 p=await read({mode:'details',ref:label.relations.label_control,observation_id:p.observation_id});assert.equal(p.objects[0].dom.id,'first');
 p=await read({mode:'children',ref:p.objects[0].relations.datalist,observation_id:p.observation_id});assert.equal(p.objects.length,3);assert.deepEqual(p.objects.map(o=>o.name.text),['Visible label',null,'Plain label']);assert.ok(p.objects.every(o=>o.visibility.rendered===false));assert.ok(!JSON.stringify(p).includes('SECRET_'));assert.equal(p.actions_authorized,false);
 console.log(JSON.stringify({passed:true,checks:['duplicate_names_distinguished','bounded_identity','fieldset_relation','empty_name_fallback','unresolved_list','bidirectional_label','explicit_hidden_datalist','no_option_values']}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
