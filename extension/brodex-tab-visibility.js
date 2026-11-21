// Fresh Chrome UI metadata only. No activation, debugger or page access.
async function brodexListVisibleTabs(view){
 const chrome=brodexOperationChrome();
 const windows=await chrome.windows.getAll({populate:true});
 const observedAt=new Date().toISOString();
 return {observed_at:observedAt,state_scope:'point_in_time; user may change focus immediately after observation',tabs:windows.flatMap(win=>(win.tabs||[]).map(tab=>({...view(tab),active:tab.active===true,window_focused:win.focused===true,window_state:win.state||'unknown',foreground:tab.active===true&&win.focused===true&&win.state!=='minimized'})))};
}
