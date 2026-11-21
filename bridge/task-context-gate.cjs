'use strict';
const exempt=new Set(['status','list_tabs','list_tasks','restore_task','list_tab_groups','watch_tab_group','get_diagnostics','check_ready','native_storage_probe','native_storage_migration']);
const inspections=new Set(['read_page','read_page_code','screenshot','prepare_click','wait_stable','prepare_operation','inspect_operation','wait_for','download_status','download_history','list_downloads']);
function createGate({progress,raw}){
 async function call(name,args){const r=await raw(name,args);if(!r.ok)throw Error(r.error||'TASK_CONTEXT_LOOKUP_FAILED');return r.value;}
 return async(command,a,context={})=>{
  if(exempt.has(command)||command==='browser_work'&&a.action!=='begin'||command==='browser_task_control'&&a.action!=='resume'||command==='task_group'&&a.action==='forget')return a;
  try{
   let task=a.task_id||context.task_id,mode=a.mode||context.mode;
   if(Number.isInteger(a.tab_id)){
    if(command==='attach_tab'){
     const tab=(await call('list_tabs',{})).tabs.find(t=>t.tab_id===a.tab_id);if(!tab)throw Error('TASK_TAB_NOT_FOUND');mode=tab.mode;
    }else{
     const matches=(await call('list_tasks',{})).tasks.flatMap(t=>(t.tabs||[]).filter(x=>x.tab_id===a.tab_id&&(!task||t.task_id===task)).map(x=>({task:t.task_id,mode:x.mode})));
     if(matches.length!==1)throw Error('TASK_CONTEXT_MEMBERSHIP_REQUIRED');
     if(mode&&mode!==matches[0].mode)throw Error('TASK_CONTEXT_MODE_MISMATCH');
     task=matches[0].task;mode=matches[0].mode;
    }
   }
   if(task&&!mode){const t=(await call('list_tasks',{})).tasks.find(t=>t.task_id===task);const modes=new Set([...(t?.tabs||[]).map(x=>x.mode),...(t?.groups||[]).map(x=>x.mode)]);if(modes.size===1)mode=[...modes][0];}
   if(!task||!['normal','incognito'].includes(mode))throw Error('TASK_CONTEXT_REQUIRED: start_task and task membership required');
   const s=await progress({task_id:task,mode});
   if(!s.exists||!s.title||!s.goal||!s.scope||!s.authorization_ref)throw Error('TASK_CONTEXT_REQUIRED: use start_task; update legacy context explicitly');
   if((s.status==='completed'||s.retired)&&!['delete_task_group','ungroup_task_group','inspect_operation'].includes(command))throw Error('TASK_CONTEXT_COMPLETED');
   if(s.status==='paused'&&!['delete_task_group','ungroup_task_group','inspect_operation'].includes(command)&&!inspections.has(command)&&command!=='browser_work')throw Error('TASK_CONTEXT_PAUSED');
   if(command==='open_tab'){
    if(a.group_name!==undefined&&a.group_name!==s.title)throw Error('TASK_GROUP_TITLE_CONFLICT: use task title');
    return {...a,group_name:s.title};
   }
   return a;
  }catch(e){e.dispatch_state='not_dispatched';throw e;}
 };
}
module.exports={createGate};
