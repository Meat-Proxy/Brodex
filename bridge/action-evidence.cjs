'use strict';
const crypto=require('node:crypto');
// Process-local, bounded metadata only; no page text, URLs, form values or images.
function createEvidence({now=()=>performance.now(),capacity=512}={}){
 const snapshots=new Map(),receipts=new Map(),modes=new Map();
 function put(map,key,value){map.delete(key);map.set(key,value);while(map.size>capacity)map.delete(map.keys().next().value);}
 function capture(command,args,r,started){
  if(!r?.ok)return r;
  let v=r.value||{};if(command==='execute_retry'&&typeof v.retry_request_id==='string')args={...args,request_id:v.retry_request_id};if(command==='execute_prepared_action'&&typeof v.prepared_request_id==='string')args={...args,request_id:v.prepared_request_id};if(command==='action_v2'&&v.execution?.dispatch_state==='sent'&&typeof v.action_id==='string'){args={...args,request_id:v.action_id};v={...v,dispatch_state:'sent',action_request_id:v.action_id};r={...r,value:v};}const o=v.observation||v;
  if(['normal','incognito'].includes(o.mode))put(modes,args.tab_id,o.mode);
  const p=o.page;
  if(p?.snapshot_id&&!v.reused_request)put(snapshots,args.tab_id,{id:p.snapshot_id,until:started+60000,prepared:false});
  if(v.snapshot_id&&['screenshot','prepare_click','prepare_retry','retry_preparation','prepare_action','prepare_operation'].includes(command))put(snapshots,args.tab_id,{id:v.snapshot_id,until:started+30000,prepared:command!=='screenshot'});
  if(['execute_operation','execute_prepared_action'].includes(command)&&!v.reused_request&&Array.isArray(v.steps)&&['normal','incognito'].includes(modes.get(args.tab_id))){
   v={...v,steps:v.steps.map(step=>{if(!step.dispatched||!['sent','verified'].includes(step.status))return step;const token=crypto.randomUUID();put(receipts,token,{request_id:step.request_id,mode:modes.get(args.tab_id),created:now()});return {...step,dispatch_receipt:token};})};r={...r,value:v};
  }
  if(v.dispatch_state==='sent'&&typeof args.request_id==='string'&&['normal','incognito'].includes(modes.get(args.tab_id))){
   const token=crypto.randomUUID();put(receipts,token,{request_id:args.request_id,mode:modes.get(args.tab_id),created:now()});
   return {...r,value:{...v,dispatch_receipt:token}};
  }
  return r;
 }
 function budget(args){
  if(!args.snapshot_id)return 30000;
  const s=snapshots.get(args.tab_id);
  // Unknown snapshots (e.g. MCP restart) still undergo Chrome's authoritative
  // checks, but never wait through a long backoff cycle first.
  if(!s)return 1000;
  if(s.id!==args.snapshot_id)throw Error('SNAPSHOT_SUPERSEDED: obtain a fresh snapshot');
  if(['click_at','hover_at'].includes(args.action)&&!s.prepared)throw Error('PREPARED_SNAPSHOT_REQUIRED');
  const remaining=s.until-now()-3000; // Reserve time for transport/target checks/pointer.
  if(remaining<=0)throw Error('SNAPSHOT_BUDGET_EXHAUSTED: obtain a fresh snapshot');
  return Math.min(1000,remaining);
 }
 function verify(token,request_id,mode){
  const r=receipts.get(token);
  if(!r||r.request_id!==request_id||r.mode!==mode||now()-r.created>3600000)throw Error('DISPATCH_RECEIPT_REQUIRED: no matching sent result; inspect outcome instead');
 }
 return {capture,budget,verify};
}
const live=createEvidence();module.exports={...live,createEvidence};

