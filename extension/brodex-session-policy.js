// Metadata receipts are not page-content caches. Full download matching URLs live
// only in worker memory, expire with their observation window, and are never logged.
const brodexSessionPolicy=(()=>{
 const watches=new Map();
 const receipt=k=>/^(brodexActionReceipt:|brodexFileReceipt:|brodexMcpRequest:)/.test(k);
 async function hash(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');}
 async function sanitize(key,v){if(key.startsWith('brodexVisual:')&&v?.expected_url){const out={...v,expected_url_hash:await hash(v.expected_url)};delete out.expected_url;return out;}if(!receipt(key)||!v||typeof v!=='object')return v;
  const out={...v};if(typeof out.fingerprint==='string'&&!/^[a-f0-9]{64}$/.test(out.fingerprint))out.fingerprint=await hash(out.fingerprint);
  if(out.error)out.error='OUTCOME_REQUIRES_INSPECTION';
  if(out.result){const safe={};for(const k of ['action','dispatch_state','outcome'])if(typeof out.result[k]==='string'&&/^[a-z_]{1,40}$/.test(out.result[k]))safe[k]=out.result[k];for(const k of ['dispatched','value_matches','matches_requested','checked','released'])if(typeof out.result[k]==='boolean')safe[k]=out.result[k];out.result=safe;}
  out.updated_at=Date.now();return out;
 }
 async function initialize(chrome){const all=await chrome.storage.session.get(null);for(const [key,value] of Object.entries(all)){
  if(receipt(key)||key.startsWith('brodexVisual:'))await chrome.storage.session.set({[key]:await sanitize(key,value)});
  if(key.startsWith('brodexDownloadWatch:'))await chrome.storage.session.remove(key);
 }}
 function putWatch(key,value){const now=Date.now();for(const [k,w] of watches)if(w.until<=now)watches.delete(k);if(!watches.has(key)&&watches.size>=100)throw Error('DOWNLOAD_WATCH_LIMIT');watches.set(key,{value,until:now+600000});}
 function getWatch(key){const entry=watches.get(key);if(!entry)return undefined;if(entry.until<=Date.now()){watches.delete(key);return undefined;}return entry.value;}
 return {hash,sanitize,initialize,putWatch,getWatch};
})();
