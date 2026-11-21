'use strict';
const timing=require('./timing.cjs');
const id={type:'string',minLength:1,maxLength:40,pattern:'^[a-zA-Z0-9_-]+$'};
const timingSchema={type:'object',properties:{timeout_ms:{type:'integer',minimum:50,maximum:10000},stable_ms:{type:'integer',minimum:0,maximum:3000},poll_interval_ms:{type:'integer',minimum:50,maximum:500},delay_ms:{type:'integer',minimum:0,maximum:3000}},additionalProperties:false,description:'Optional geometry/guard timing. Defaults: timeout 3000, stability 200, sampling 100, initial dwell 0 ms. Returns early when stable. delay+stable <= timeout. Never extends snapshot lifetime or tolerates a changed reviewed target.'};
const target={tab_id:{type:'integer',minimum:0},expected_url:{type:'string',minLength:1,maxLength:8192}};
const snapshot={snapshot_id:{type:'string',minLength:1,maxLength:100}};
function install(tools){
 const regions=structuredClone(tools.find(t=>t.name==='prepare_click').inputSchema.properties.context_regions);
 tools.push(
 {name:'wait_stable',description:'Read-only bounded wait for one observed supported DOM target and its ancestors to stop changing geometry/style/state; running target/ancestor animations keep it pending. Uses a fresh read_page element_id. Does not click or renew an action baseline. After waiting obtain fresh DOM or a new reviewed control before input. Timeout means unverified. Defaults need no timing argument.',inputSchema:{type:'object',properties:{...target,...snapshot,element_id:{type:'string',minLength:1,maxLength:40},timing:structuredClone(timingSchema)},required:['tab_id','expected_url','snapshot_id','element_id'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'prepare_operation',description:'Prepare 2-20 serial state changes from one inspected overview PNG: native checkbox set_checked or Ctrl selection on an explicit aria-selected target. No click. Each step has an id, image-pixel x/y and desired boolean. Provide 1-8 context regions covering identities and decision-relevant fields for ALL targets. Returns one masked PNG control, plan_id, snapshot_id, image hash and step states. Inspect ALL targets before execute_operation. No drag, arbitrary click, rerender or coordinate reflow in this series version; use ordinary guarded steps for those. Reviewed context remains strict; only a verified planned checked/selected change and target paint colours may update its baseline. Changing class, labels, geometry, structure or unrelated state stops the series.',inputSchema:{type:'object',properties:{...target,...snapshot,plan_id:id,steps:{type:'array',minItems:2,maxItems:20,items:{type:'object',properties:{id,kind:{type:'string',enum:['set_checked','ctrl_select']},x:{type:'number',minimum:0},y:{type:'number',minimum:0},desired:{type:'boolean'}},required:['id','kind','x','y','desired'],additionalProperties:false}},context_regions:regions,timing:structuredClone(timingSchema)},required:['tab_id','expected_url','snapshot_id','plan_id','steps','context_regions'],additionalProperties:false},annotations:{readOnlyHint:true}},
 {name:'execute_operation',description:'Execute the reviewed prepare_operation once, sequentially, within its original 30-second control lifetime. Copy control_image_sha256 from the control you actually inspected. Check all planned targets before and after hover and after each effect; release Ctrl/buttons per step. Defaults: hover timing 3000/200/100/0 ms; result timing 5000/200/100/0; total 25000 ms. Optional overrides never weaken guards or renew expiry. Stops on critical change, timeout, uncertain dispatch or release failure; returns per-step verified/sent/unknown/not_sent/planned outcomes and stable request IDs. Existing plan_id returns its saved result without input, even with another request_id. Metadata survives worker restart within the Chrome session; after browser restart missing metadata is NOT proof no action occurred. Never replay an unknown result; inspect page and inspect_operation. Ordinary read_page between preparation and execution invalidates the plan.',inputSchema:{type:'object',properties:{...target,...snapshot,plan_id:id,request_id:{type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9_-]+$'},control_image_sha256:{type:'string',minLength:64,maxLength:64,pattern:'^[a-f0-9]+$'},timing:structuredClone(timingSchema),result_timing:structuredClone(timingSchema),total_timeout_ms:{type:'integer',minimum:1000,maximum:25000}},required:['tab_id','expected_url','snapshot_id','plan_id','request_id','control_image_sha256'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
 {name:'inspect_operation',description:'Inspect metadata for an executed state-change series; never dispatches or resumes it. Use the task tab and its currently observed URL, including after navigation. Does not require an active debugger. Missing result after Chrome restart is not evidence of no action; inspect the actual page before a new plan.',inputSchema:{type:'object',properties:{...target,plan_id:id},required:['tab_id','expected_url','plan_id'],additionalProperties:false},annotations:{readOnlyHint:true}}
 );
 for(const tool of tools){
  if(tool.name==='execute_operation'){
   tool.inputSchema.properties.result_timing.description='Optional per-step result timing. Defaults: timeout 5000, stability 200, sampling 100, dwell 0 ms. Same bounds as timing; does not extend the total operation deadline or original control lifetime.';
   tool.description+=' At most 256 recorded plans per tab in the Chrome session; receipts are not evicted to permit replay. The ordinary action tools remain available.';
  }
  if(['act','mouse_click','prepare_click'].includes(tool.name))tool.inputSchema.properties.timing=structuredClone(timingSchema);
  if(tool.name==='screenshot')tool.description='Capture the authorized HTTP(S) viewport as ORIGINAL lossless PNG, without JPEG conversion or resizing. Requires browser_work begin. Maximum 8 MiB encoded image / 24 million pixels; oversized images fail explicitly, no lossy fallback. Returns actual dimensions and snapshot_id; inspect before prepare_click or prepare_operation. Only a newly inspected control permits coordinate input. New page reads replace previous action snapshots. DOM mutations during capture do not cancel the PNG: capture_diagnostic reports a bounded interval index and completeness; inspect_snapshot_changes reads remaining entries. No detailed global DOM baseline is built. Journal and response completeness are separate. Structural events sort first; repeated updates are coalesced per node without hiding observed insertions/removals. Document, viewport or scroll changes still refuse. No DOM changes does not prove unchanged pixels.';
  if(tool.name==='prepare_click')tool.description=tool.description.replace('which may be downscaled','captured as lossless PNG without downscaling')+' Source is native PNG; masking is a lossless PNG render, with no JPEG intermediate. Optional timing observes the fixed prepared target before capture; it cannot accept movement. Use wait_stable then fresh evidence for post-animations.';
  if(tool.name==='act')tool.description+=' hover_at moves without pressing to a reviewed prepare_click point. Requires prepared snapshot_id/x/y, no element_id/modifiers/noncritical_regions. Guards run BEFORE movement; expected tooltip changes afterward are observed, not treated as click failures. timing applies before movement; wait_after waits for the resulting content. Fresh evidence is required for any following input.';
  if(tool.name==='prepare_click')tool.description+=' Also prepares standalone act hover_at; inspect the control before moving. Hover does not click.';
  if(['act','mouse_click'].includes(tool.name))tool.description+=' For mouse_click and act hover/click_at/wheel_at, timing controls stability after hover; omit for defaults. For coordinate click/wheel the target is checked again after real hover. A changed reviewed target refuses immediately; waiting never approves new coordinates. For menu loading use wait_after, for post-animation geometry use wait_stable with fresh DOM.';
 }
}
function validate(name,args){
 if(name==='act'&&args.action==='hover_at'){
  if(!Number.isFinite(args.x)||!Number.isFinite(args.y))throw Error('INVALID_COORDINATES');
  if(['element_id','modifiers','noncritical_regions','button','delta_x','delta_y'].some(k=>args[k]!==undefined))throw Error('AMBIGUOUS_HOVER_TARGET');
 }
 if(args.timing!==undefined){
  timing.normalize(args.timing);
  if(name==='act'&&!['hover','hover_at','click_at','wheel_at'].includes(args.action))throw Error('TIMING_ACTION_UNSUPPORTED');
 }
 if(args.result_timing!==undefined)timing.normalize(args.result_timing,{timeout_ms:5000});
 if(name==='prepare_operation'){
  if(!Array.isArray(args.steps)||args.steps.length<2||args.steps.length>20)throw Error('INVALID_SERIES');
  const ids=new Set();
  for(const s of args.steps){
   if(!s||Object.keys(s).some(k=>!['id','kind','x','y','desired'].includes(k))||!/^[a-zA-Z0-9_-]{1,40}$/.test(s.id||'')||ids.has(s.id)||!['set_checked','ctrl_select'].includes(s.kind)||typeof s.desired!=='boolean'||![s.x,s.y].every(n=>Number.isFinite(n)&&n>=0))throw Error('INVALID_SERIES_STEP');
   ids.add(s.id);
  }
 }
}
module.exports={install,validate,timingSchema};

