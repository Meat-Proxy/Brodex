// Public Chrome API only. Closed saved groups are not exposed by this API.
const brodexGroups=(()=>{
 const watches=new Map();let revision=0;
 const now=()=>Date.now();
 const terminalGraceMs=5000;
 function prune(){for(const [id,w] of watches){if(now()-w.started>=600000){watches.delete(id);continue;}for(const s of w.groups?w.groups.values():[w])for(const [tab,expiry] of s.departed)if(now()>=expiry)s.departed.delete(tab);}}
 function record(w,type,data){w.events.push({sequence:++w.sequence,time:now(),type,...data});if(w.events.length>100){w.events.shift();w.dropped++;}}
 function observe(w,s,type,data){
  // Departed tabs are retained briefly for terminal events ONLY, never navigation.
  const terminal=type==='tab_removed'&&s.departed.has(data.tab_id);
  const windowTerminal=type==='window_removed'&&data.window_id===s.windowId&&(s.removedAt===null||now()-s.removedAt<terminalGraceMs);
  if(data.group_id===s.id||s.tabs.has(data.tab_id)||terminal||windowTerminal){
   if(type==='tab_group_changed'){if(data.group_id===s.id){s.tabs.add(data.tab_id);s.departed.delete(data.tab_id);}else{s.tabs.delete(data.tab_id);s.departed.set(data.tab_id,now()+terminalGraceMs);if(s.departed.size>100){s.departed.delete(s.departed.keys().next().value);w.correlationDropped++;}}}
   if(type==='tab_removed'){s.tabs.delete(data.tab_id);s.departed.delete(data.tab_id);}
   if(type==='group_removed')s.removedAt=now();
   if(data.group_id===s.id&&type!=='group_removed')s.windowId=data.window_id;
   record(w,type,w.groups?{observed_group_id:s.id,...data}:data);
  }
 }
 function state(id,windowId){return {id,windowId,removedAt:null,tabs:new Set(),departed:new Map()};}
 function event(type,data){revision++;prune();for(const w of watches.values()){
  if(!w.groups){observe(w,w,type,data);continue;}
  if((type==='group_created'||type==='tab_group_changed')&&data.group_id>=0&&!w.baseline.has(data.group_id)&&!w.groups.has(data.group_id)){
   const privacy=w.windows.get(data.window_id);
   if(privacy===undefined){w.unresolved++;continue;}
   if(privacy===(w.mode==='incognito')){
    if(w.groups.size>=8){w.candidatesDropped++;continue;}
    w.groups.set(data.group_id,state(data.group_id,data.window_id));
   }
  }
  for(const s of w.groups.values())observe(w,s,type,data);
 }}
 chrome.windows.onCreated?.addListener(window=>{prune();for(const w of watches.values())if(w.groups)w.windows.set(window.id,window.incognito);});
 for(const [name,type] of [['onCreated','group_created'],['onUpdated','group_updated'],['onMoved','group_moved'],['onRemoved','group_removed']])chrome.tabGroups[name]?.addListener(g=>event(type,{group_id:g.id,window_id:g.windowId}));
 chrome.tabs.onCreated?.addListener(t=>event('tab_group_changed',{tab_id:t.id,group_id:t.groupId,window_id:t.windowId}));
 chrome.tabs.onUpdated?.addListener((id,c,t)=>{if(c.groupId!==undefined)event('tab_group_changed',{tab_id:id,group_id:c.groupId,window_id:t.windowId});else if(c.url!==undefined)event('tab_url_changed',{tab_id:id,group_id:t.groupId,window_id:t.windowId});});
 chrome.tabs.onRemoved?.addListener((id,i)=>event('tab_removed',{tab_id:id,window_id:i.windowId,is_window_closing:i.isWindowClosing}));
 chrome.tabs.onDetached?.addListener((id,i)=>event('tab_detached',{tab_id:id,window_id:i.oldWindowId}));
 chrome.tabs.onAttached?.addListener((id,i)=>event('tab_attached',{tab_id:id,window_id:i.newWindowId}));
 chrome.windows.onRemoved?.addListener(id=>{event('window_removed',{window_id:id});for(const w of watches.values())if(w.groups)w.windows.delete(id);});
 function urlHint(raw){try{const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;return u.origin+u.pathname;}catch{return null;}}
 async function list(a){
  if(!['normal','incognito'].includes(a.mode))throw Error('EXPLICIT_MODE_REQUIRED');
  const start=revision,windows=await chrome.windows.getAll({populate:false}),allowed=new Set(windows.filter(w=>w.incognito===(a.mode==='incognito')&&(a.window_id===undefined||a.window_id===w.id)).map(w=>w.id));
  const groups=(await chrome.tabGroups.query({})).filter(g=>allowed.has(g.windowId)&&(a.group_id===undefined||g.id===a.group_id));
  const result=[];
  for(const g of groups){const tabs=await chrome.tabs.query({groupId:g.id});result.push({group_id:g.id,window_id:g.windowId,title:g.title||'',color:g.color,collapsed:g.collapsed,tabs:tabs.filter(t=>t.incognito===(a.mode==='incognito')).map(t=>({tab_id:t.id,index:t.index,active:t.active,...(a.include_urls?{url_hint:urlHint(t.url)}:{})}))});}
  return {scope:'open_groups_only',saved_closed_groups:'not_exposed_by_public_api',identity_scope:'browser_session',observed_at:now(),changed_during_read:start!==revision,groups:result};
 }
 async function watch(a){
  prune();const discovery=a.scope==='new_groups',key=a.mode+':'+(discovery?'new_groups':a.group_id);
  if(!['normal','incognito'].includes(a.mode)||(a.scope!==undefined&&!['group','new_groups'].includes(a.scope))||(discovery?a.group_id!==undefined:!Number.isInteger(a.group_id)||a.group_id<0))throw Error('INVALID_GROUP_TARGET');
  if(a.action==='stop'){const existed=watches.delete(key);return {stopped:true,existed};}
  if(a.action==='start'){
   if(watches.has(key))return {watching:true,already_started:true,group_id:a.group_id};
   if(watches.size>=8)throw Error('WATCH_LIMIT');
   if(discovery){
    const windows=await chrome.windows.getAll({populate:false}),groups=await chrome.tabGroups.query({});
    const entry={mode:a.mode,groups:new Map(),baseline:new Set(groups.map(g=>g.id)),windows:new Map(windows.map(w=>[w.id,w.incognito])),events:[],sequence:0,dropped:0,correlationDropped:0,candidatesDropped:0,unresolved:0,started:now()};
    watches.set(key,entry);setTimeout(()=>{if(watches.get(key)===entry)watches.delete(key);},600000);
    return {watching:true,scope:'new_groups',diagnostic_version:3,expires_in_ms:600000,max_events:100,max_groups:8};
   }
   const g=await chrome.tabGroups.get(a.group_id),w=await chrome.windows.get(g.windowId);if(w.incognito!==(a.mode==='incognito'))throw Error('MODE_MISMATCH');
   const entry={id:g.id,windowId:g.windowId,removedAt:null,tabs:new Set(),departed:new Map(),correlationDropped:0,events:[],sequence:0,dropped:0,started:now()};watches.set(key,entry);
   setTimeout(()=>{if(watches.get(key)===entry)watches.delete(key);},600000);
   try{for(const t of await chrome.tabs.query({groupId:g.id}))entry.tabs.add(t.id);}catch(e){watches.delete(key);throw e;}
   return {watching:true,group_id:g.id,expires_in_ms:600000,max_events:100};
  }
  if(a.action!=='read')throw Error('INVALID_WATCH_ACTION');
  const w=watches.get(key);if(!w)throw Error('WATCH_NOT_ACTIVE: start while group is open; watches expire or reset with worker restart');
  return {diagnostic_version:3,scope:discovery?'new_groups':'group',...(discovery?{candidate_group_ids:[...w.groups.keys()],candidates_dropped:w.candidatesDropped,unresolved_events:w.unresolved}:{group_id:w.id}),events:w.events.filter(e=>e.sequence>(a.after_sequence||0)),dropped:w.dropped,terminal_correlation_ms:terminalGraceMs,correlation_dropped:w.correlationDropped,last_sequence:w.sequence,expires_in_ms:Math.max(0,600000-(now()-w.started)),notice:'Candidates are not task ownership or proof of restoration. window_removed confirms window closure, not its cause or saved-group persistence; group_removed does not establish saved-group deletion; late terminal events beyond the correlation interval may be missing; no URLs or titles recorded'};
 }
 return {list,watch};
})();
