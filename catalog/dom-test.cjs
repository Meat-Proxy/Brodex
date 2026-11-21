const assert=require('node:assert/strict');
const {chromium}=require(process.env.BRODEX_PLAYWRIGHT_MODULE || 'playwright');
const {createBrodexCatalog}=require('./catalog.js');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.BRODEX_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const passed=[];
 try{
  const page=await browser.newPage();
  await page.goto('about:blank');
  await page.setContent(`<form><span id="a">First</span><span id="b">Second</span><p id="desc">Help</p><label for="field">Native label</label><input id="field" aria-labelledby="a b" aria-describedby="desc missing" aria-controls="panel" value="PRIVATE_VALUE"><div id="panel" aria-label="Panel"><div></div><section><button>Nested</button></section></div><input type="checkbox" checked aria-checked="false" aria-label="Conflict"><fieldset disabled><input aria-label="Inherited"></fieldset><textarea>PRIVATE_EDITOR</textarea><div contenteditable>PRIVATE_CONTENT</div><select aria-label="Choice"><option>Alpha</option><option selected>Beta</option></select><img alt="Picture"><div id="host" inert></div><ul aria-label="Rows">${Array.from({length:1000},(_,i)=>`<li>Row ${i}</li>`).join('')}</ul></form>`);
  await page.evaluate(()=>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<button>Shadow</button>');
  await page.evaluate(source=>{globalThis.catalog=eval('('+source+')')();},createBrodexCatalog.toString());
  const read=options=>page.evaluate(o=>catalog.read(o),options);
  let p=await read({limit:50,timeout_ms:250});
  const named=(p,name)=>{const obj=p.objects.find(o=>o.name.text===name);assert.ok(obj,name);return obj;};
  const field=named(p,'First Second');
  assert.equal(field.relations.labelled_by.length,2);assert.equal(field.relations.labels.length,3);assert.equal(field.relations.described_by.length,1);assert.equal(field.relations.controls.length,1);assert.ok(field.relations.form);assert.equal(field.relations.complete,false);passed.push('relations_and_combined_labels');
  assert.equal(named(p,'Conflict').state.checked,true);assert.deepEqual(named(p,'Conflict').coverage.state_conflicts,[{field:'checked',native:true,aria:false}]);assert.equal(named(p,'Inherited').state.disabled,true);assert.equal(named(p,'Shadow').state.inert,true);passed.push('native_conflicts_and_ancestor_states');
  for(const secret of ['PRIVATE_VALUE','PRIVATE_EDITOR','PRIVATE_CONTENT'])assert.ok(!JSON.stringify(p).includes(secret));passed.push('editor_and_form_value_omission');
  assert.equal(named(p,'Picture').type,'image');assert.equal(named(p,'Rows').group.total,null);assert.ok(!p.objects.some(o=>o.name.text==='Row 999'));passed.push('image_and_folded_collection');
  p=await read({mode:'children',ref:field.relations.controls[0],observation_id:p.observation_id,timeout_ms:250});assert.equal(p.objects.length,2);assert.equal(p.objects[0].type,'generic');assert.equal(p.objects[0].name.text,null);assert.ok(!p.objects.some(o=>o.type==='button'));passed.push('immediate_generic_children');
  p=await read({mode:'search',text:'Choice',exact:true,timeout_ms:250,max_nodes:10000});let choice=named(p,'Choice');p=await read({mode:'children',ref:choice.ref,observation_id:p.observation_id,timeout_ms:250});assert.equal(p.objects.length,2);assert.equal(named(p,'Beta').state.selected,true);passed.push('native_select_children');
  p=await read({mode:'search',text:'Beta',exact:true,timeout_ms:250,max_nodes:10000});assert.equal(named(p,'Beta').type,'option');passed.push('native_option_search');
  p=await read({limit:50,timeout_ms:250});let rows=named(p,'Rows');p=await read({mode:'search',text:'Row 999',exact:true,ref:rows.ref,observation_id:p.observation_id,max_nodes:10000,timeout_ms:250});assert.equal(named(p,'Row 999').type,'listitem');passed.push('scoped_last_row_search');
  p=await read({limit:50,timeout_ms:250});rows=named(p,'Rows');p=await read({mode:'children',ref:rows.ref,observation_id:p.observation_id,limit:3,timeout_ms:250});assert.equal(p.objects.length,3);assert.ok(p.cursor);p=await read({mode:'children',cursor:p.cursor,observation_id:p.observation_id,limit:3,timeout_ms:250});assert.equal(p.objects[0].name.text,'Row 3');passed.push('bounded_pagination');
  await page.evaluate(()=>document.body.setAttribute('data-test','changed'));await assert.rejects(read({mode:'children',cursor:p.cursor,observation_id:p.observation_id}),/STALE_CURSOR/);passed.push('mutation_invalidates_cursor');
  p=await read({limit:50,timeout_ms:250});const old=p;await read({limit:1});await assert.rejects(read({mode:'details',ref:old.objects[0].ref,observation_id:old.observation_id}),/STALE_OBSERVATION/);passed.push('new_read_invalidates_refs');
  for(const options of [{limit:0},{max_nodes:NaN},{timeout_ms:251}])await assert.rejects(read(options),/INVALID_/);passed.push('invalid_budgets_rejected');
  p=await read({limit:50,timeout_ms:250});assert.ok(p.objects.every(o=>o.ax.status==='not_requested'&&o.capabilities.execution==='not_implemented'));assert.equal(p.actions_authorized,false);await page.evaluate(()=>catalog.dispose());await assert.rejects(read({}),/CATALOG_CLOSED/);passed.push('read_only_contract_and_disposal');
  console.log(JSON.stringify({passed:passed.length,checks:passed}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
