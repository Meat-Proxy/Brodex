// Optional read-only route. Catalog refs never enter the action snapshot registry.
function brodexCatalogRead(expectedUrl, options, leaseId) {
 if(location.href!==expectedUrl||!['http:','https:'].includes(location.protocol))return {error:'PAGE_CHANGED'};
 try {
  let session=globalThis.__brodexCatalogSession;
  if(session?.leaseId!==leaseId){session?.catalog.dispose();clearTimeout(session?.timer);globalThis.__brodexCatalogSession=undefined;session=null;}
  if(!session){
   if(options.ref||options.cursor)return {error:'STALE_OBSERVATION'};
   session={leaseId,catalog:createBrodexCatalog()};globalThis.__brodexCatalogSession=session;
  }
  clearTimeout(session.timer);
  session.timer=setTimeout(()=>{session.catalog.dispose();if(globalThis.__brodexCatalogSession===session)delete globalThis.__brodexCatalogSession;},60000);
  const result=session.catalog.read(options);
  for(const object of result.objects)object.capabilities.preparation={command:'prepare_action',target:'catalog_target',required:true};
  return {...result,frame_id:0};
 }catch(error){
  const code=String(error?.message||'');
  return {error:/^[A-Z_]{1,80}$/.test(code)?code:'CATALOG_READ_FAILED'};
 }
}
function brodexValidateCatalog(args){
 const c=args.catalog;
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['mode','text','exact','ref','observation_id','cursor','limit','max_nodes','timeout_ms','ax'].includes(k)))throw Error('INVALID_CATALOG_OPTIONS');
 if(c.ax!==undefined&&typeof c.ax!=='boolean')throw Error('INVALID_CATALOG_OPTIONS');
 if(args.frame_id!==undefined&&args.frame_id!==0)throw Error('CATALOG_MAIN_FRAME_ONLY');
 for(const k of ['group','max_chars','max_elements','text_offset','element_offset'])if(args[k]!==undefined)throw Error('CATALOG_LEGACY_OPTIONS_CONFLICT');
 if(c.mode!==undefined&&!['overview','search','details','children'].includes(c.mode))throw Error('INVALID_MODE');
 for(const [key,min,max] of [['limit',1,50],['max_nodes',10,10000],['timeout_ms',10,250]])if(c[key]!==undefined&&(!Number.isInteger(c[key])||c[key]<min||c[key]>max))throw Error('INVALID_CATALOG_LIMIT');
 for(const [key,max] of [['text',200],['ref',100],['observation_id',200],['cursor',200]])if(c[key]!==undefined&&(typeof c[key]!=='string'||!c[key].length||c[key].length>max))throw Error('INVALID_CATALOG_REFERENCE');
 if(c.exact!==undefined&&typeof c.exact!=='boolean')throw Error('INVALID_CATALOG_OPTIONS');
 if(c.mode==='search'&&!c.text)throw Error('QUERY_REQUIRED');
 if(c.mode==='details'&&!c.ref)throw Error('TARGET_REQUIRED');
 if((c.ref||c.cursor)&&!c.observation_id)throw Error('OBSERVATION_REQUIRED');
 if(c.ref&&c.cursor)throw Error('CURSOR_SCOPE_CONFLICT');
}
async function brodexReadCatalog(args){
 brodexValidateCatalog(args);
 const lease=brodexDebugLeases.get(args.tab_id);
 if(!lease||lease.lost)throw Error('WORK_SESSION_DETACHED');
 lease.catalogId??=crypto.randomUUID();
 const injected=await chrome.scripting.executeScript({target:{tabId:args.tab_id,frameIds:[0]},world:'ISOLATED',files:['brodex-dom-catalog.js']});
 const documentId=injected.find(r=>r.frameId===0)?.documentId;
 if(!documentId)throw Error('CATALOG_DOCUMENT_UNAVAILABLE');
 const result=await brodexFrameInject(args.tab_id,documentId,brodexCatalogRead,[args.expected_url,args.catalog,lease.catalogId]);
 if(brodexDebugLeases.get(args.tab_id)!==lease||lease.lost)throw Error('WORK_SESSION_DETACHED');
 return args.catalog.ax===true?await brodexEnrichCatalogAX(args,result,documentId,lease):result;
}

// Resolve once by exact observation/ref, then enter the existing preparation.
// No text matching, selector generation, parent guessing or input here.
async function brodexCatalogActionObservation(args,api){
 const target=args.catalog_target,p=args.parameters;
 if(!target||typeof target!=='object'||Array.isArray(target)||Object.keys(target).some(k=>!['ref','observation_id'].includes(k))||['ref','observation_id'].some(k=>typeof target[k]!=='string'||!target[k].length||target[k].length>200))throw Error('INVALID_CATALOG_TARGET');
 if(args.snapshot_id!==undefined||args.context_regions!==undefined||args.command!=='act'||!p||!['click','fill','select','set_checked','hover','scroll'].includes(p.action)||['element_id','x','y'].some(k=>k in p))throw Error('CATALOG_ACTION_CONFLICT');
 const lease=brodexDebugLeases.get(args.tab_id);
 if(!lease?.catalogId||lease.lost)throw Error('CATALOG_SESSION_REQUIRED');
 const observation=await api.handle('read_page',{tab_id:args.tab_id,expected_url:args.expected_url,max_chars:1000,max_elements:20,_catalog_target:{...target,lease_id:lease.catalogId,...(args.protocol===2?{protocol:2}:{})}});
 if(brodexDebugLeases.get(args.tab_id)!==lease||lease.lost)throw Error('WORK_SESSION_DETACHED');
 const page=observation.page;
 if(!page?.catalog_target?.element_id||!page.snapshot_id)throw Error('CATALOG_TARGET_NOT_ACTIONABLE');
 return {snapshot_id:page.snapshot_id,element_id:page.catalog_target.element_id};
}
