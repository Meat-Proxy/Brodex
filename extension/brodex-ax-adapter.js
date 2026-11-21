// Read-only AX adapter. Transport and exact DOM-object resolver are injected.
// No selectors/text matching to join AX to DOM, no actions, no persistent cache.
async function enrichAX(observation,{send,resolveObject,checkObservation,maxObjects=20,timeoutMs=250}){
 const result=structuredClone(observation),start=performance.now();let queried=0,available=0;
 let enabled=false;
 const group='brodex-catalog-'+observation.observation_id;
 try{
  await send('Accessibility.enable',{});enabled=true;
  for(const obj of result.objects){
   if(queried>=maxObjects||performance.now()-start>timeoutMs){obj.ax={status:'budget_exhausted'};continue;}
   queried++;
   try{
    const objectId=await resolveObject(obj.ref,observation.observation_id,group);
    if(!objectId)throw Error('NO_DOM_OBJECT');
    const {node}=await send('DOM.describeNode',{objectId});
    const {nodes}=await send('Accessibility.getPartialAXTree',{backendNodeId:node.backendNodeId,fetchRelatives:false});
    const ax=nodes.find(n=>n.backendDOMNodeId===node.backendNodeId);
    if(!ax){obj.ax={status:'no_mapping'};continue;}
    // Deliberately whitelist public fields: never copy value, description or raw sources.
    obj.ax={status:'available',role:String(ax.role?.value||'').slice(0,80),name:String(ax.name?.value||'').slice(0,200),ignored:ax.ignored===true,source:'browser_accessibility',mapping:'exact_backend_node',state:{}};
    for(const p of ax.properties||[])if(['disabled','readonly','expanded','selected','checked','required','multiselectable'].includes(p.name)){
     const v=p.value?.value;if(typeof v==='boolean'||['true','false','mixed'].includes(v))obj.ax.state[p.name]=v;
    }
    available++;
   }catch{obj.ax={status:'unavailable'};}
  }
 }catch{for(const obj of result.objects)obj.ax={status:'unavailable'};}
 finally{
  try{await send('Runtime.releaseObjectGroup',{objectGroup:group});}catch{}
  if(enabled)try{await send('Accessibility.disable',{});}catch{}
 }
 let current=false;try{current=await checkObservation(observation.observation_id);}catch{}
 result.consistency={atomic:false,current,requires_fresh_observation:!current};
 if(!current)for(const obj of result.objects)obj.ax={status:'observation_changed'};
 for(const obj of result.objects)if(obj.coverage?.sections)obj.coverage.sections.ax={status:obj.ax.status};
 result.ax_coverage={queried,available:current?available:0,returned:result.objects.length,complete:current&&available===result.objects.length,elapsed_ms:Math.round(performance.now()-start),scope:'returned_DOM_candidates',ax_only_nodes_included:false};
 return result;
}
if(typeof module!=='undefined')module.exports={enrichAX};
