// Read-only, bounded inspection. Never evaluates page-supplied code.
function brodexPageCode(args){
 if(location.href!==args.expected_url||!['http:','https:'].includes(location.protocol))return {error:'PAGE_CHANGED'};
 const limit=args.max_chars??20000,offset=args.offset??0;
 const snapshot=globalThis.__brodexSnapshot,dom=snapshot?.tree;
 let target=document.documentElement;
 if(args.scope==='element'){
  const s=globalThis.__brodexSnapshot;
  if(!s||s.id!==args.snapshot_id||s.url!==location.href||Date.now()-s.created>60000)return {error:'STALE_SNAPSHOT'};
  if(args.element_id){const ref=s.refs.get(args.element_id);target=ref?.el;if(!(dom?dom.connected(target):target?.isConnected)||!(s.matchesRef?s.matchesRef(ref):ref.signature===target.outerHTML))return {error:'STALE_ELEMENT'};}
  else{
   if(s.width!==innerWidth||s.height!==innerHeight||s.scrollX!==scrollX||s.scrollY!==scrollY||s.revision||s.observer.takeRecords().some(s.isPageMutation))return {error:'STALE_SCREENSHOT'};
   target=dom?dom.hit(args.x,args.y):document.elementFromPoint(args.x,args.y);
   if(!target)return {error:'NO_ELEMENT_AT_POINT'};
  }
 }
 const props=['display','visibility','opacity','pointer-events','position','z-index','width','height','overflow','content-visibility','transform','color','background-color','font-size'];
 const css=el=>{const s=el.ownerDocument.defaultView.getComputedStyle(el);return Object.fromEntries(props.map(p=>[p,s.getPropertyValue(p)]));};
 const info=el=>{const r=dom?dom.rect(el):el.getBoundingClientRect();return {tag:el.localName,id:el.id,class:el.getAttribute('class'),type:el.localName==='input'?el.type:undefined,hidden:el.hidden,inert:el.inert,rect:{x:r.x,y:r.y,width:r.width,height:r.height},computed:css(el)};};
 const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const url=v=>{try{const u=new URL(v,location.href);if(!['http:','https:'].includes(u.protocol))return '[omitted URL]';return u.origin+u.pathname;}catch{return '[omitted URL]';}};
 const allowed=new Set(['id','class','type','role','hidden','inert','disabled','multiple','accept','for','width','height','tabindex','aria-hidden','aria-disabled']);
 let chunks=[],length=0,visited=0,cut=false,shadowRoots=0;
 const emit=s=>{if(length>=offset+limit){cut=true;return;}chunks.push(s.slice(0,offset+limit-length));length+=s.length;};
 function walk(n){
  if(cut||++visited>12000){cut=true;return;}
  if(n.nodeType===3){emit(esc(n.textContent));return;}
  if(n.nodeType!==1)return;
  if(n===globalThis.__brodexPointer?.host)return;
  const tag=n.localName;
  let attrs='';for(const a of n.attributes){if(allowed.has(a.name))attrs+=' '+a.name+'="'+esc(a.value.slice(0,500))+'"';else if(['href','src','action'].includes(a.name))attrs+=' '+a.name+'="'+esc(url(a.value))+'"';}
  emit('<'+tag+attrs+'>');
  if(['script','style','textarea','iframe','template','noscript','object','embed'].includes(tag)||n.hasAttribute('contenteditable'))emit('[content omitted]');
  else if(tag!=='input'){for(const child of n.childNodes){walk(child);if(cut)break;}if(n.shadowRoot&&!cut){shadowRoots++;emit('<shadow-root mode="open">');for(const child of n.shadowRoot.childNodes){walk(child);if(cut)break;}emit('</shadow-root>');}}
  emit('</'+tag+'>');
 }
 walk(target);
 const html=chunks.join('').slice(offset,offset+limit);
 const rules=[];let inaccessible=0,scanned=0,cssCut=false;
 const safeStyle=style=>{const result={};for(const p of props){const v=style.getPropertyValue(p);if(v)result[p]=v;}return result;};
 function scan(list,conditions=[]){for(const r of list){if(++scanned>4000||rules.length>=80){cssCut=true;return;}
  if(r.selectorText&&r.style){let matches=args.scope==='page';if(!matches)try{matches=target.matches(r.selectorText);}catch{}
   if(matches)rules.push({selector:r.selectorText.slice(0,1000),conditions,css:safeStyle(r.style)});
  }else if(r.cssRules)scan(r.cssRules,conditions.concat(String(r.conditionText||r.name||'group').slice(0,200)));
  if(cssCut)return;
 }}
 const styleRoot=target.getRootNode();for(const sheet of [...(styleRoot.styleSheets||target.ownerDocument.styleSheets),...(styleRoot.adoptedStyleSheets||[])]){try{scan(sheet.cssRules);}catch{inaccessible++;}if(cssCut)break;}
 const parent=n=>dom?dom.parent(n):n.parentElement;
 const ancestors=[];if(args.scope==='element')for(let p=parent(target);p&&ancestors.length<8;p=parent(p))ancestors.push(info(p));
 return {content_is_untrusted:true,kind:'sanitized_live_DOM',scope:args.scope,html,offset,next_offset:cut&&html.length===limit?offset+html.length:null,truncated:cut,scan_limit:visited>12000,target:args.scope==='element'?info(target):undefined,ancestors,inline_css:args.scope==='element'?safeStyle(target.style):undefined,css_rules:rules,css_truncated:cssCut,inaccessible_stylesheets:inaccessible,coverage:{selected_document_only:true,embedded_scope:dom?.scope(target),open_shadow_roots_read:shadowRoots,iframe_contents_omitted:true,original_server_source:false,form_values:false,scripts:false,all_css_properties:false,url_queries:false},note:'CSS rules are matching candidates, not a resolved cascade; computed styles show actual values. No scripts, cookies or form values are read. This sanitized DOM is not a complete source archive.'};
}

