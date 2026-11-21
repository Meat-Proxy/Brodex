// No DOM/storage writes, snapshot creation, reload, debugger attach or network requests.
function brodexReadiness({busy}) {
 let flight=null;
 async function inspect(args){
  if(busy())return {ready:false,reason:'PREVIOUS_OPERATION_RUNNING'};
  if(args.tab_id===undefined)return {ready:true,scope:'transport_queue_only'};
  const expected=new URL(args.expected_url);
  if(!['http:','https:'].includes(expected.protocol)||expected.username||expected.password)throw Error('URL_NOT_SUPPORTED');
  let tab;try{tab=await chrome.tabs.get(args.tab_id);}catch{throw Error('TAB_NOT_FOUND');}
  if(tab.url!==expected.href||tab.pendingUrl&&tab.pendingUrl!==expected.href)throw Error('PAGE_CHANGED');
  if(tab.discarded)return {ready:false,reason:'TAB_DISCARDED'};
  // Tab loading includes subresources; probe the committed main document instead.
  if(tab.pendingUrl)return {ready:false,reason:'NAVIGATION_PENDING'};
  const result=await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',func:async function(expected){
   if(location.href!==expected)return {ready:false,reason:'PAGE_CHANGED'};
   const sample=()=>[innerWidth,innerHeight,scrollX,scrollY,visualViewport?.scale??1];
   const before=sample(),origin=performance.timeOrigin;
   if(document.readyState==='loading'||!document.documentElement)return {ready:false,reason:'DOCUMENT_LOADING'};
   await new Promise(resolve=>setTimeout(resolve,80));
   if(location.href!==expected||performance.timeOrigin!==origin)return {ready:false,reason:'PAGE_CHANGED'};
   return {ready:JSON.stringify(before)===JSON.stringify(sample()),reason:JSON.stringify(before)===JSON.stringify(sample())?null:'VIEWPORT_MOVING',document_epoch:origin,scope:'main_frame_liveness_and_viewport; target and iframe checks remain mandatory'};
  },args:[expected.href]});
  const value=result?.find(r=>r.frameId===0)?.result;
  if(!value)throw Error('PAGE_READ_NO_RESULT');
  const current=await chrome.tabs.get(tab.id);
  if(current.url!==expected.href||current.pendingUrl&&current.pendingUrl!==expected.href||value.reason==='PAGE_CHANGED')throw Error('PAGE_CHANGED');
  if(current.pendingUrl)return {ready:false,reason:'NAVIGATION_PENDING'};
  if(current.discarded)return {ready:false,reason:'TAB_DISCARDED'};
  if(busy())return {ready:false,reason:'PREVIOUS_OPERATION_RUNNING'};
  return value;
 }
 return function(args){
  const key=JSON.stringify([args.tab_id,args.expected_url]);
  if(flight)return flight.key===key?flight.promise:Promise.resolve({ready:false,reason:'PROBE_PENDING'});
  const entry={key};flight=entry;
  entry.promise=inspect(args).finally(()=>{if(flight===entry)flight=null;});
  return entry.promise;
 };
}
