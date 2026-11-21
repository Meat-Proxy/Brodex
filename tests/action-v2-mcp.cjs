// Real stdio MCP server and a test-only native pipe. No connection to user Chrome.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
(async()=>{
 const installed=path.resolve(__dirname,'../bridge'),fixture=path.resolve(__dirname,'../.test-output/transport-fixture');fs.mkdirSync(fixture,{recursive:true});
 for(const n of fs.readdirSync(installed).filter(n=>n.endsWith('.cjs')))fs.copyFileSync(path.join(installed,n),path.join(fixture,n));
 for(const n of ['server.cjs','action-evidence.cjs'])fs.copyFileSync(path.resolve(__dirname,'../bridge',n),path.join(fixture,n));
 fs.writeFileSync(path.join(fixture,'allowed-origin.txt'),'chrome-extension://'+'a'.repeat(32)+'/');
 const pipe='\\\\.\\pipe\\brodex-test-'+crypto.randomUUID(),token='a'.repeat(64);fs.writeFileSync(path.join(fixture,'bridge-config.json'),JSON.stringify({pipe,token}));
 const seen=[];
 const server=net.createServer(socket=>{let buffer='';socket.on('data',chunk=>{buffer+=chunk;const end=buffer.indexOf('\n');if(end<0)return;const q=JSON.parse(buffer.slice(0,end));assert.equal(q.token,token);seen.push(q.command);let value;
  if(q.command==='list_tasks')value={tasks:[{task_id:'v2-test',tabs:[{tab_id:1,mode:'incognito'}]}]};
  else if(q.command==='check_ready')value={ready:true};
  else if(q.command==='action_v2')value=q.args.phase==='capabilities'?{protocol:'brodex-action/2'}:{protocol:'brodex-action/2',mode:'incognito',action_id:'action-test',status:q.args.phase==='execute'?'completed':'ready',execution:{dispatch_state:q.args.phase==='execute'?'sent':'not_dispatched'},report:{report_id:'report-test',changes:[{object_ref:'object-1',property:'style.opacity',before:'1',after:'.7'}]},image:{mimeType:'image/png',data:'TEST_IMAGE_BASE64'}};
  else throw Error('Unexpected native command '+q.command);
  socket.end(JSON.stringify({ok:true,value})+'\n');
 });});
 await new Promise(resolve=>server.listen(pipe,resolve));
 const child=spawn(process.execPath,[path.join(fixture,'server.cjs')],{stdio:['pipe','pipe','pipe']}),pending=new Map();let serial=0,buffer='',stderr='';child.stderr.on('data',b=>stderr+=b);
 child.stdout.on('data',b=>{buffer+=b;let end;while((end=buffer.indexOf('\n'))>=0){const msg=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);pending.get(msg.id)?.(msg);pending.delete(msg.id);}});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>reject(Error('MCP timeout '+stderr)),10000);pending.set(id,r=>{clearTimeout(timer);resolve(r);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 const call=(name,args)=>rpc('tools/call',{name,arguments:args});
 try{
  const list=await rpc('tools/list',{});assert.ok(list.result.tools.find(t=>t.name==='action_v2'));
  let r=await call('action_v2',{phase:'capabilities'});assert.equal(r.result.isError,false,JSON.stringify(r));
  r=await call('start_task',{task_id:'v2-test',mode:'incognito',title:'Synthetic test',goal:'Verify protocol',scope:'Fixture only',authorization_ref:'Synthetic test',request_id:'start-test'});assert.equal(r.result.isError,false,JSON.stringify(r));
  r=await call('action_v2',{phase:'prepare',tab_id:1,expected_url:'http://fixture.test/',snapshot_id:'snapshot-test',action:{method:'dom',operation:'activate',target:{element_id:'element-test'}}});assert.equal(r.result.isError,false,JSON.stringify(r));
  assert.equal(r.result.content[1].type,'image');assert.ok(!r.result.content[0].text.includes('TEST_IMAGE_BASE64'));assert.ok(r.result.content[0].text.includes('style.opacity'));
  r=await call('action_v2',{phase:'execute',tab_id:1,expected_url:'http://fixture.test/',preparation_id:'prep-test',control_token:'control-test',report_id:'report-test'});
  const result=JSON.parse(r.result.content[0].text);assert.equal(result.value.dispatch_state,'sent');assert.equal(result.value.action_request_id,'action-test');assert.ok(result.value.dispatch_receipt);
  const count=seen.length;r=await call('action_v2',{phase:'execute',unexpected:true});assert.equal(r.result.isError,true);assert.equal(seen.length,count);
  console.log(JSON.stringify({passed:true,checks:['MCP_tools_schema','capabilities_without_task','task_membership_gate','native_pipe_dispatch','structured_report_preserved','PNG_separate_content','workflow_dispatch_receipt','validation_before_transport']}));
 }finally{child.kill();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
