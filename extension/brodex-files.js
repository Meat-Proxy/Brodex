// Explicit file operations only. No page content or download log persisted to disk by default.
function brodexFiles({read,save,view}){
 // Passive notifications only; never rename, cancel or resume a download.
 let eventQueue=Promise.resolve();
 function event(kind,d){eventQueue=eventQueue.then(async()=>{
  const key='brodexDownloadEvents',now=Date.now();
  const events=(await read(key)||[]).filter(e=>now-e.time<600000);
  events.push({download_id:d.id,kind,time:now});await save(key,events.slice(-500));
 }).catch(()=>{});}
 chrome.downloads?.onCreated?.addListener(d=>event('created',d));
 chrome.downloads?.onChanged?.addListener(d=>event('changed',d));
 const valid=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
 const safeName=(name,extension='')=>{
  let n=String(name||'page').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/g,'').slice(0,120);
  if(!n)n='page';if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(n))n='_'+n;
  return 'Brodex/'+n+extension;
 };
 function url(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('URL_NOT_SUPPORTED');return u.href;}
 async function target(args){const tab=await chrome.tabs.get(args.tab_id);if(tab.url!==url(args.expected_url)||tab.pendingUrl&&tab.pendingUrl!==tab.url)throw Error('PAGE_CHANGED');return tab;}
 const samples=new Map();
 function item(d){
  const now=Date.now(),old=samples.get(d.id),total=Number.isFinite(d.totalBytes)&&d.totalBytes>=0?d.totalBytes:null;
  const active=d.state==='in_progress'&&!d.paused;
  const speed=active&&old&&now>old.time&&d.bytesReceived>=old.bytes?(d.bytesReceived-old.bytes)*1000/(now-old.time):null;
  if(samples.size>=500&&!samples.has(d.id))samples.delete(samples.keys().next().value);
  samples.set(d.id,{time:now,bytes:d.bytesReceived});
  const end=Date.parse(d.estimatedEndTime);
  return {download_id:d.id,filename:d.filename,url:d.url?.startsWith('data:')?'[saved page]':d.url,final_url:d.finalUrl?.startsWith('data:')?'[saved page]':d.finalUrl,state:d.state,error:d.error,danger:d.danger,exists:d.exists,mime:d.mime,bytes_received:d.bytesReceived,total_bytes:total,file_size:d.fileSize,incognito:d.incognito,paused:Boolean(d.paused),can_resume:Boolean(d.canResume),start_time:d.startTime,end_time:d.endTime,remaining_bytes:total===null?null:Math.max(0,total-d.bytesReceived),percent:total>0?Math.min(100,d.bytesReceived/total*100):null,bytes_per_second:speed,remaining_seconds:active&&Number.isFinite(end)?Math.max(0,Math.ceil((end-now)/1000)):null,activity:d.state==='complete'?'complete':d.state==='interrupted'?'interrupted':d.paused?'paused':speed===null?'observing':speed>0?'receiving':'no_progress_observed'};
 }
 function matches(d,w){
  const time=Date.parse(d.startTime);
  if(!Number.isFinite(time)||time<Date.parse(w.start)||time>Date.parse(w.start)+120000||Boolean(d.incognito)!==Boolean(w.incognito)||d.byExtensionId)return false;
  if(w.download_url)return d.url===w.download_url||d.finalUrl===w.download_url;
  try{const ref=new URL(d.referrer),page=new URL(w.url);ref.hash='';page.hash='';return ref.href===page.href||Boolean(w.expected_filename&&ref.origin===page.origin&&String(d.filename||'').split(/[\\/]/).pop()===w.expected_filename);}catch{return false;}
 }
 async function handle(command,args){
 const chrome=brodexOperationChrome();
  if(command==='download_history'){
   const start=Date.parse(args.started_after),end=Date.parse(args.started_before);
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>600000||!['normal','incognito'].includes(args.mode))throw Error('INVALID_HISTORY_WINDOW: maximum 10 minutes and explicit mode required');
   const recent=await chrome.downloads.search({startedAfter:new Date(start-1).toISOString(),startedBefore:new Date(end+1).toISOString(),limit:200,orderBy:['startTime']});
   const clean=s=>{try{const u=new URL(s);if(['http:','https:'].includes(u.protocol))return u.origin+u.pathname;if(u.protocol==='blob:'){const inner=new URL(u.pathname);return ['http:','https:'].includes(inner.protocol)?'blob:'+inner.origin+inner.pathname:'[other]';}return '[other]';}catch{return null;}};
   const downloads=recent.filter(d=>Boolean(d.incognito)===(args.mode==='incognito')&&Date.parse(d.startTime)>=start&&Date.parse(d.startTime)<=end).map(d=>({...item(d),url:clean(d.url),final_url:clean(d.finalUrl),referrer:clean(d.referrer),by_extension_id:d.byExtensionId||null,attribution:'unassigned'}));
   await eventQueue;
   const ids=new Set(downloads.map(d=>d.download_id));
   return {downloads,events:(await read('brodexDownloadEvents')||[]).filter(e=>ids.has(e.download_id)),possibly_truncated:recent.length===200,read_only:true,warning:'History does not establish task ownership. Do not move unrelated files. Query parameters are redacted.'};
  }
  if(!valid(args.task_id))throw Error('INVALID_TASK_ID');
  if(command==='watch_downloads'){
   const tab=await target(args);if(!valid(args.request_id))throw Error('INVALID_REQUEST_ID');
   if(args.expected_filename!==undefined&&(typeof args.expected_filename!=='string'||!args.expected_filename.trim()||args.expected_filename.length>255||/[\\/\x00-\x1f]/.test(args.expected_filename)))throw Error('INVALID_EXPECTED_FILENAME');
   const key='brodexDownloadWatch:'+args.task_id+':'+args.request_id;
   const old=await read(key);if(old){if(old.tab_id!==args.tab_id||old.url!==args.expected_url||old.download_url!==(args.download_url?url(args.download_url):null)||(old.expected_filename||null)!==(args.expected_filename||null))throw Error('REQUEST_ID_CONFLICT');return {watch_id:args.request_id,reused_request:true};}
   await save(key,{start:new Date().toISOString(),incognito:Boolean(tab.incognito),tab_id:args.tab_id,url:args.expected_url,expected_filename:args.expected_filename||null,download_url:args.download_url?url(args.download_url):null});return {watch_id:args.request_id,observation_window_seconds:120};
  }
  if(command==='list_downloads'){
   if(!valid(args.watch_id))throw Error('INVALID_WATCH_ID');
   const watch=await read('brodexDownloadWatch:'+args.task_id+':'+args.watch_id);if(!watch)throw Error('WATCH_NOT_FOUND');
   const recent=await chrome.downloads.search({startedAfter:watch.start,startedBefore:new Date(Date.parse(watch.start)+120000).toISOString(),limit:100,orderBy:['-startTime']});
   const all=recent.filter(d=>matches(d,watch));
   return {downloads:all.map(d=>({...item(d),match_basis:watch.download_url?'exact_download_url':d.referrer?.split('#')[0]===watch.url.split('#')[0]?'exact_page_referrer':'same_origin_and_exact_filename'})),attribution:'candidates_only',observation:all.length?'download_observed':Date.now()>Date.parse(watch.start)+120000?'window_expired_without_match':'waiting_for_matching_download',possibly_truncated:recent.length===100,warning:'Candidates are not proof of tab ownership. Missing referrer can prevent detection. Do not retry the download or move files based only on time/name. Inspect the site when no match is found.',limit:100};
  }
  if(command==='download_status'){
   if(!Number.isInteger(args.download_id)||args.download_id<0)throw Error('INVALID_DOWNLOAD_ID');
   const own=await read('brodexDownload:'+args.task_id+':'+args.download_id);
   if(!own){if(!valid(args.watch_id))throw Error('DOWNLOAD_NOT_TRACKED');const watch=await read('brodexDownloadWatch:'+args.task_id+':'+args.watch_id);const found=await chrome.downloads.search({id:args.download_id});if(!watch||!found[0]||!matches(found[0],watch))throw Error('DOWNLOAD_NOT_TRACKED');return {download:item(found[0]),attribution:'candidate_only'};}
   const found=await chrome.downloads.search({id:args.download_id});if(!found[0])throw Error('DOWNLOAD_NOT_FOUND');return {download:item(found[0]),attribution:'requested_by_task'};
  }
  const tab=await target(args);
  if(!valid(args.request_id))throw Error('INVALID_REQUEST_ID');
  const key='brodexFileReceipt:'+args.task_id+':'+args.request_id;
  const fingerprint=await brodexSessionPolicy.hash(JSON.stringify([command,args.tab_id,args.expected_url,args.url??null,args.filename??null]));
  const previous=await read(key);if(previous){if(previous.fingerprint!==fingerprint)throw Error('REQUEST_ID_CONFLICT');if(previous.status!=='done')throw Error('OUTCOME_UNKNOWN: inspect downloads before retrying');return {download_id:previous.id,reused_request:true};}
  let downloadUrl,filename;
  if(command==='download_file'){
   if(tab.incognito)throw Error('USE_SITE_DOWNLOAD_IN_INCOGNITO: extension download does not guarantee the same private session');
   downloadUrl=url(args.url);if(typeof args.filename!=='string'||!args.filename.trim()||args.filename.length>120)throw Error('INVALID_FILENAME');filename=safeName(args.filename);
  }else if(command==='save_page'){
   const results=await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',func:brodexPageExport,args:[args.expected_url]});
   const data=results?.find(r=>r.frameId===0)?.result;if(!data||data.error)throw Error(data?.error||'EXPORT_FAILED');
   await target(args);filename=safeName(data.title,'.htm');downloadUrl='data:text/html;charset=utf-8,'+encodeURIComponent(data.html);
  }else throw Error('UNKNOWN_COMMAND');
  await save(key,{status:'pending',fingerprint});
  const id=await chrome.downloads.download({url:downloadUrl,filename,saveAs:false,conflictAction:'uniquify'});
  await save('brodexDownload:'+args.task_id+':'+id,{tab_id:tab.id});await save(key,{status:'done',fingerprint,id});
  return {download_id:id,state:'requested',relative_filename:filename,verification_required:true,format:command==='save_page'?'rendered_text_html':undefined};
 }
 return {handle};
}
function brodexPageExport(expected){
 if(location.href!==expected||!['http:','https:'].includes(location.protocol))return {error:'PAGE_CHANGED'};
 // Text-only HTML: no active scripts, embedded resources, form field values or page storage.
 if(!document.body)return {error:'DOCUMENT_UNAVAILABLE'};
 // A detached clone has no rendered innerText. Extract only original visible text nodes.
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const parts=[];let n,total=0,count=0;
 while(n=walker.nextNode()){
  if(++count>50000)return {error:'PAGE_EXPORT_TOO_LARGE'};
  const p=n.parentElement;if(!p||p.closest('script,style,noscript,template,input,textarea,select,iframe,[contenteditable]'))continue;
  let visible=true;for(let e=p;e;e=e.parentElement){const c=getComputedStyle(e);if(e.hidden||c.display==='none'||c.visibility==='hidden'||c.opacity==='0'){visible=false;break;}}
  if(!visible)continue;const t=n.textContent.trim();if(t){total+=t.length;if(total>300000)return {error:'PAGE_EXPORT_TOO_LARGE'};parts.push(t);}
 }
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return {title:document.title||location.hostname,html:'<!doctype html><meta charset="utf-8"><title>'+escape(document.title)+'</title><h1>'+escape(document.title)+'</h1><pre style="white-space:pre-wrap">'+escape(parts.join('\n'))+'</pre>'};
}
