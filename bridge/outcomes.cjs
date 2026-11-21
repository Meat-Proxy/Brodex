'use strict';
// MCP-side observation only. No selectors, script evaluation or action replay.
const {failure}=require('./result-envelope.cjs');
const leafConditions=['ready','text_present','text_absent','element_present','element_state'];
const conditions=[...leafConditions,'all','any'];
const leafProperties={condition:{type:'string',enum:leafConditions},text:{type:'string',minLength:1,maxLength:1000},ignore_case:{type:'boolean'},kind:{type:'string',minLength:1,maxLength:40},name:{type:'string',minLength:1,maxLength:250},state:{type:'string',enum:['checked','selected','disabled','expanded']},equals:{type:'boolean'}};
const waitProperties={...leafProperties,condition:{type:'string',enum:conditions},conditions:{type:'array',minItems:1,maxItems:4,items:{type:'object',properties:leafProperties,required:['condition'],additionalProperties:false}},timeout_ms:{type:'integer',minimum:0,maximum:10000},stable_ms:{type:'integer',minimum:0,maximum:3000}};
const responseTools=new Set(['act','navigate','press_key','mouse_click','drag','mouse_drag','type_text','wait_for','execute_operation','execute_retry','execute_prepared_action']);
const responseDefaults={max_chars:3000,max_elements:20};
function validateResponseBudget(value){
 if(value===undefined)return {...responseDefaults};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(responseDefaults,k)))throw Error('INVALID_RESPONSE_BUDGET');
 const b={...responseDefaults,...value};
 for(const [k,min,max] of [['max_chars',100,30000],['max_elements',1,100]])if(!Number.isInteger(b[k])||b[k]<min||b[k]>max)throw Error('INVALID_RESPONSE_BUDGET');
 return b;
}
function install(tools){
 for(const tool of tools){
  if(responseTools.has(tool.name))tool.inputSchema.properties.response_mode={type:'string',enum:['compact','full'],description:'Default compact: bounded observation, explicit truncation. Use read_page for fresh details; no full-observation cache is retained.'};
  if(responseTools.has(tool.name))tool.inputSchema.properties.response_budget={type:'object',properties:{max_chars:{type:'integer',minimum:100,maximum:30000},max_elements:{type:'integer',minimum:1,maximum:100}},additionalProperties:false,description:'Optional compact response budget. Defaults: 3000 text characters and 20 extracted elements of ALL kinds in document order, preserving visibility/state flags. Increase only when useful. Full mode bypasses summary and cannot combine with this option. Does not increase the underlying read coverage or fetch more pages; inspect truncation and use read_page pagination.'};
  if(tool.name==='act'){
   tool.inputSchema.properties.wait_after={type:'object',properties:waitProperties,required:['condition'],additionalProperties:false,description:'Optional read-only state/result wait (same predicates as wait_for, including all/any and element_state) after a sent action, on the same exact URL. Never retries the action. Timeout includes readiness and reads; a mismatch/timeout does not prove failure. A page URL change stops verification; inspect the destination.'};
   tool.description+=' Prefer wait_after for an observable asynchronous effect. Do not repeat a sent action based on its immediate old snapshot. A matched condition is not aggregate task success. Default response is compact. Snapshot actions have at most 1 second of readiness wait, bounded by known snapshot lifetime with a 3-second reserve; refresh_snapshot_and_reassess requires fresh evidence, never automatic replay. A dispatch_receipt from a sent result can support the matching journal action; it is not permission or proof of task completion.';
  }
  if(tool.name==='wait_for')Object.assign(tool.inputSchema.properties,waitProperties);
  if(tool.name==='wait_for')tool.description='Read-only condition wait with one total timeout (default 5000ms, maximum 10000ms), including queue, readiness and reads; zero budget performs no read. Never retries actions. all/any combine up to four conditions; any must keep the SAME alternative matched throughout stable_ms. element_state checks one uniquely named visible, unoccluded element with exact kind/name and boolean equals for checked/selected/disabled/expanded; requires complete element coverage. This checks current state, not proof of a transition. Explicit ignore_case applies only to text predicates; default is case-sensitive. Prefer observed state or precise observed result labels over guessed notifications. No page-specific rules. all combines up to four conditions; stable_ms requires repeated matches. ready only checks document readiness, not SPA/application completion. Missing text is evidence only with complete text coverage. Timeout means unverified, never failed. May return before an in-flight read settles; do not assume its snapshot remains current. Default response compact; read_page obtains fresh detail.';
 }
}
function validateWait(a,nested=false){
 if(!a||typeof a!=='object'||Array.isArray(a)||!conditions.includes(a.condition))throw Error('INVALID_WAIT_CONDITION');
 if(nested&&Object.keys(a).some(k=>!Object.hasOwn(waitProperties,k)))throw Error('INVALID_WAIT_CONDITION');
 for(const [k,max] of [['timeout_ms',10000],['stable_ms',3000]])if(a[k]!==undefined&&(!Number.isInteger(a[k])||a[k]<0||a[k]>max))throw Error('INVALID_TIMEOUT');
 const group=['all','any'].includes(a.condition),cs=group?a.conditions:[Object.fromEntries(Object.entries(a).filter(([k])=>Object.hasOwn(leafProperties,k)))];
 if(!group&&a.conditions!==undefined||group&&Object.keys(leafProperties).some(k=>k!=='condition'&&a[k]!==undefined))throw Error('INVALID_WAIT_CONDITION');
 if(!Array.isArray(cs)||!cs.length||cs.length>4)throw Error('INVALID_WAIT_CONDITION');
 for(const c of cs){
  if(!c||typeof c!=='object'||Array.isArray(c)||!leafConditions.includes(c.condition))throw Error('INVALID_WAIT_CONDITION');
  const keys=c.condition==='element_state'?['condition','kind','name','state','equals']:c.condition==='ready'?['condition']:['condition','text','ignore_case'];
  if(Object.keys(c).some(k=>!keys.includes(k)))throw Error('INVALID_WAIT_CONDITION');
  if(c.condition==='element_state'){
   if(typeof c.kind!=='string'||!c.kind.trim()||c.kind.length>40||typeof c.name!=='string'||!c.name.trim()||c.name.length>250||!leafProperties.state.enum.includes(c.state)||typeof c.equals!=='boolean')throw Error('INVALID_WAIT_CONDITION');
  }else if(c.condition!=='ready'){
   if(typeof c.text!=='string'||!c.text.trim()||c.text.length>1000||c.ignore_case!==undefined&&typeof c.ignore_case!=='boolean')throw Error('INVALID_WAIT_CONDITION');
  }
 }
 return cs;
}
function matches(c,o){
 const p=o?.page;if(!p)return false;
 if(c.condition==='ready')return o.status==='complete'&&p.ready_state==='complete';
 const includes=s=>typeof s==='string'&&(c.ignore_case?s.toLowerCase().includes(c.text.toLowerCase()):s.includes(c.text));
 if(c.condition==='text_present')return includes(p.text);
 if(c.condition==='text_absent')return typeof p.text==='string'&&p.text_offset===0&&p.truncated?.text===false&&p.truncated?.scan===false&&!includes(p.text);
 if(c.condition==='element_state'){
  if(p.summary||p.element_offset!==0||p.truncated?.elements!==false||p.truncated?.scan!==false)return false;
  const es=(p.elements||[]).filter(e=>e.kind===c.kind&&e.name===c.name);
  if(es.length!==1||es[0].in_viewport!==true||es[0].occluded!==false)return false;
  const v=es[0][c.state];return (typeof v==='boolean'?v:v==='true'?true:v==='false'?false:null)===c.equals;
 }
 return (p.elements||[]).some(e=>e.in_viewport&&!e.occluded&&includes(e.name));
}

function bounded(work,ms){
 if(ms<=0)return Promise.reject(Error('WAIT_DEADLINE'));
 let timer;return Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('WAIT_DEADLINE')),ms)})]).finally(()=>clearTimeout(timer));
}
async function wait(a,{raw,gate,now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),deadline=now()+(a.timeout_ms??5000),onProgress=()=>{}}){
 const cs=validateWait(a),needsText=cs.some(c=>['text_present','text_absent'].includes(c.condition)),needsElements=cs.some(c=>['element_present','element_state'].includes(c.condition)),start=now(),left=()=>Math.max(0,deadline-now());
 let latest,since=cs.map(()=>null),reads=0,reason='WAIT_TIMEOUT',error;
 try{
  while(left()>0){
   await bounded(()=>gate({tab_id:a.tab_id,expected_url:a.expected_url},left()),left());
   const r=await bounded(()=>raw('read_page',{tab_id:a.tab_id,expected_url:a.expected_url,...(a.frame_id!==undefined?{frame_id:a.frame_id}:{}),max_chars:needsText?30000:100,max_elements:needsElements?100:1},left()),left());
   if(!r.ok)throw Error(r.error||'OBSERVATION_FAILED');
   latest=r.value;reads++;
   onProgress({observation:latest,reads,elapsed_ms:Math.round(now()-start)});
   const matched=cs.map((c,i)=>{if(!matches(c,latest)){since[i]=null;return false;}if(since[i]===null)since[i]=now();return now()-since[i]>=(a.stable_ms??0);});
   if(a.condition==='any'?matched.some(Boolean):matched.every(Boolean))return {ok:true,value:{matched:true,outcome:'condition_matched',condition:a.condition,matched_conditions:matched.flatMap((v,i)=>v?[i]:[]),stable_ms:a.stable_ms??0,elapsed_ms:Math.round(now()-start),reads,observation:latest,retry_action:false}};
   await sleep(Math.min(250,left()));
  }
 }catch(e){error=String(e.message);reason=/WAIT_DEADLINE|READINESS_TIMEOUT|BRODEX_TIMEOUT/.test(error)?'WAIT_TIMEOUT':'OBSERVATION_FAILED';}
 return {ok:true,value:{matched:false,outcome:'unverified',reason,...(error?{error}:{}),elapsed_ms:Math.round(now()-start),reads,...(latest?{observation:latest}:{}),retry_action:false,next_step:'inspect_outcome',snapshot_may_be_stale:true}};
}
function compactObservation(o,budget){
 if(!o?.page)return o;
 const p=o.page,text=typeof p.text==='string'?p.text:'',elements=p.elements||[];
 // Summary is not a negative-evidence source. Keep selected element IDs untouched.
 const {max_chars,max_elements}=validateResponseBudget(budget),kept=elements.slice(0,max_elements);
 const textCut=text.length>max_chars,elementCut=kept.length<elements.length;
 return {...o,page:{...p,text:text.slice(0,max_chars),elements:kept,truncated:{...p.truncated,text:p.truncated?.text||textCut,elements:p.truncated?.elements||elementCut},summary:true,response_budget:{max_chars,max_elements},summary_omitted:{text_chars:Math.max(0,text.length-max_chars),elements:elements.length-kept.length},detail_hint:'read_page for fresh full detail; summary truncation is additional to source coverage. Element IDs stay in this snapshot; do not use source next offsets to skip summary-omitted items. This summary cannot prove absence'}};
}
function present(r,mode='compact',budget){
 if(mode==='full'||!r?.value)return r;
 const v={...r.value};if(v.observation)v.observation=compactObservation(v.observation,budget);
 if(v.postcondition){v.postcondition={...v.postcondition};if(v.postcondition.observation)v.postcondition.observation=compactObservation(v.postcondition.observation,budget);}
 return {...r,value:v};
}
function readFailure(r){
 if(r?.ok!==false||r.error_info?.phase==='workflow')return r;
 const v={...r,...failure(r.error,r.error_info?.phase||'observation','not_dispatched')};
 v.browser_action_executed=false;v.error_info.next_step='inspect_or_repeat_read';return v;
}
module.exports={install,validateWait,wait,bounded,present,readFailure,matches,responseTools,validateResponseBudget,responseDefaults};

