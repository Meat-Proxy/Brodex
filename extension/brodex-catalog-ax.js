// Optional browser AX enrichment. Only the extension's observed isolated world
// is eligible; no main-world fallback and no DOM/AX joining by label or selector.
async function brodexEnrichCatalogAX(args,page,documentId,lease){
 const send=(method,params={})=>chrome.debugger.sendCommand({tabId:args.tab_id},method,params);
 const worlds=new Map();let runtimeEnabled=false;
 const origin=chrome.runtime.getURL('').replace(/\/$/,'');
 const listener=(source,method,params)=>{
  if(source.tabId!==args.tab_id||source.sessionId)return;
  if(method==='Runtime.executionContextCreated'){
   const c=params.context;
   if(c?.auxData?.type==='isolated'&&(c.name===chrome.runtime.id||c.origin?.replace(/\/$/,'')===origin)&&worlds.size<32)worlds.set(c.id,c);
  }else if(method==='Runtime.executionContextDestroyed')worlds.delete(params.executionContextId);
  else if(method==='Runtime.executionContextsCleared')worlds.clear();
 };
 chrome.debugger.onEvent.addListener(listener);
 try{
  await send('Runtime.enable');runtimeEnabled=true;
  const {frameTree}=await send('Page.getFrameTree');
  const matches=[...worlds.values()].filter(c=>c.auxData.frameId===frameTree.frame.id);
  if(matches.length!==1)throw Error('AX_ISOLATED_WORLD_UNAVAILABLE');
  const context=matches[0];
  return await enrichAX(page,{send,timeoutMs:500,maxObjects:20,
   resolveObject:async(ref,id,objectGroup)=>{
    if(brodexDebugLeases.get(args.tab_id)!==lease||lease.lost)throw Error('WORK_SESSION_DETACHED');
    const r=await send('Runtime.callFunctionOn',{executionContextId:context.id,
     functionDeclaration:'function(ref,id,leaseId){const s=globalThis.__brodexCatalogSession;if(!s||s.leaseId!==leaseId)throw Error("CATALOG_SESSION_REQUIRED");return s.catalog.resolve(ref,id);}',
     arguments:[{value:ref},{value:id},{value:lease.catalogId}],objectGroup,returnByValue:false,silent:true});
    if(r.exceptionDetails||!r.result?.objectId)throw Error('AX_TARGET_UNAVAILABLE');return r.result.objectId;
   },
   checkObservation:async id=>{
    if(brodexDebugLeases.get(args.tab_id)!==lease||lease.lost)return false;
    try{return (await brodexFrameInject(args.tab_id,documentId,function(id,leaseId){const s=globalThis.__brodexCatalogSession;return {current:!!s&&s.leaseId===leaseId&&s.catalog.check(id)};},[id,lease.catalogId])).current;}catch{return false;}
   }
  });
 }catch{
  let current=false;try{current=(await brodexFrameInject(args.tab_id,documentId,function(id,leaseId){const s=globalThis.__brodexCatalogSession;return {current:!!s&&s.leaseId===leaseId&&s.catalog.check(id)};},[page.observation_id,lease.catalogId])).current&&brodexDebugLeases.get(args.tab_id)===lease&&!lease.lost;}catch{}
  page.consistency={atomic:false,current,requires_fresh_observation:!current};
  const status=current?'unavailable':'observation_changed';
  for(const object of page.objects){object.ax={status};object.coverage.sections.ax={status};}
  page.ax_coverage={queried:0,available:0,returned:page.objects.length,complete:false,scope:'returned_DOM_candidates',ax_only_nodes_included:false};return page;
 }finally{
  chrome.debugger.onEvent.removeListener(listener);
  if(runtimeEnabled)try{await send('Runtime.disable');}catch{}
 }
}
