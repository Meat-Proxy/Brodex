// Activate only an explicitly selected existing HTTP(S) tab; no debugger or navigation.
async function brodexActivateTab(args){
 const chrome=brodexOperationChrome();
 if(!Number.isInteger(args.tab_id)||args.tab_id<0)throw Error('INVALID_TAB_ID');
 if(!['normal','incognito'].includes(args.mode))throw Error('EXPLICIT_MODE_REQUIRED');
 const expected=new URL(args.expected_url);
 if(!['http:','https:'].includes(expected.protocol)||expected.username||expected.password)throw Error('URL_NOT_SUPPORTED');
 async function checked(){
 const chrome=brodexOperationChrome();
  let tab;try{tab=await chrome.tabs.get(args.tab_id);}catch{throw Error('TAB_NOT_FOUND');}
  if((tab.incognito?'incognito':'normal')!==args.mode)throw Error('PRIVACY_MODE_MISMATCH');
  if(tab.url!==expected.href||tab.pendingUrl&&tab.pendingUrl!==expected.href)throw Error('PAGE_CHANGED: inspect list_tabs');
  return tab;
 }
 let tab=await checked();
 await chrome.tabs.update(tab.id,{active:true});
 tab=await checked();
 const win=await chrome.windows.get(tab.windowId);
 await chrome.windows.update(tab.windowId,win.state==='minimized'?{state:'normal',focused:true}:{focused:true});
 tab=await checked();
 const currentWindow=await chrome.windows.get(tab.windowId);
 return {tab_id:tab.id,window_id:tab.windowId,mode:args.mode,url:tab.url,active:tab.active===true,focused:currentWindow.focused===true};
}
