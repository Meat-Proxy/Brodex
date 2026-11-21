// Serialized by chrome.scripting.executeScript into the isolated main-frame world.
// No arbitrary code, page globals, cookies, storage or form values are exposed.
function brodexReadPage(expectedUrl, maxChars, maxElements, textOffset, elementOffset=0, readOptions={}) {
 try {
 if (!['http:', 'https:'].includes(location.protocol) || location.href !== expectedUrl)
  return {error:'PAGE_CHANGED: inspect list_tabs and choose the current URL'};
 const started=performance.now(), deadline=started+250;
 const groupRequest=readOptions.group;
 const previous=globalThis.__brodexSnapshot;
 // Retain only the exact stopped node when a fresh bounded read encounters it.
 // Never reuse its old context or rematch a replacement by name/HTML/DOM id.
 const stopped=globalThis.__brodexRetryState?.last;
 const retryTarget=stopped?.kind==='dom'&&stopped.complete&&Date.now()-stopped.created<=300000?stopped.target:null;
 let catalogTarget=null,catalogBaseline=null;
 if(readOptions.catalog_target){
  const request=readOptions.catalog_target,session=globalThis.__brodexCatalogSession;
  if(!session||session.leaseId!==request.lease_id)return {error:'CATALOG_SESSION_REQUIRED'};
  try{if(request.protocol===2){const binding=session.catalog.resolveForAction(request.ref,request.observation_id);catalogTarget=binding.node;catalogBaseline=binding.baseline;}else catalogTarget=session.catalog.resolve(request.ref,request.observation_id);}catch(error){return {error:/^[A-Z_]+$/.test(error.message)?error.message:'CATALOG_TARGET_STALE'};}
  if(catalogTarget.ownerDocument!==document)return {error:'CATALOG_MAIN_FRAME_ONLY'};
 }
 const preparationPin=readOptions.preparation_id?globalThis.__brodexActionPreparation:null;
 if(readOptions.preparation_id&&(!preparationPin||preparationPin.id!==readOptions.preparation_id||Date.now()-preparationPin.created>300000))return {error:'PREPARATION_EXPIRED'};
 if(preparationPin?.refs?.length){elementOffset=0;textOffset=0;}
 let requestedGroup=null;
 if(groupRequest){
  if(!previous||previous.id!==groupRequest.snapshot_id||Date.now()-previous.created>60000)return {error:'GROUP_SNAPSHOT_STALE: read_page again'};
  previous.recordChanges(previous.observer.takeRecords());
  requestedGroup=previous.groups?.get(groupRequest.group_id);
  if(!requestedGroup||!previous.tree.connected(requestedGroup.root))return {error:'GROUP_NOT_FOUND: read_page again'};
  if(requestedGroup.dirty||previous.frameLoadCount||requestedGroup.frameState!==previous.tree.scopeState(requestedGroup.root))return {error:'GROUP_CHANGED: read_page again'};
  if(groupRequest.cursor&&groupRequest.cursor!==requestedGroup.cursor)return {error:'GROUP_CURSOR_INVALID'};
  if(groupRequest.cursor&&!requestedGroup.next)return {error:'GROUP_CURSOR_INVALID'};
 }
 // Presentation folding is independent of action safety and collection size.
 function collection(n){return !!n?.matches?.('select,ul,ol,tbody,[role="list"],[role="listbox"],[role="rowgroup"],[role="menu"]');}
 // Embedded-document discovery keeps its own bounded policy: folding a small
 // collection's output must not hide its iframe/Shadow DOM route from guards.
 function largeCollection(n){if(!collection(n))return false;if(n.localName==='select')return n.options.length>50;let count=0;for(let c=n.firstElementChild;c;c=c.nextElementSibling)if(++count>50)return true;return false;}
 // getRandomValues is available on HTTP too; randomUUID requires a secure context.
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 const snapshotId=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
 clearTimeout(globalThis.__brodexSnapshot?.expiryTimer);
 globalThis.__brodexSnapshot?.observer?.disconnect();
 globalThis.__brodexSnapshot?.disposeFrames?.();
 function linkKind(raw){
  if(/^javascript:\s*void\s*\(\s*0\s*\)\s*;?\s*$/i.test(raw.trim()))return 'inert_javascript';
  try{const u=new URL(raw,location.href);if(u.username||u.password)return 'credentials';return ['http:','https:'].includes(u.protocol)?'http':u.protocol==='javascript:'?'javascript_blocked':'scheme_blocked';}catch{return 'invalid';}
 }
// Included inside the serialized reader; no page code or global prototypes are modified.
function createEmbeddedTree() {
 const docs=new Map([[document,null]]), roots=new Set([document]), frameRecords=new Map(),seenFrames=new Set();
 let nodesScanned=0, truncated=false;
 const style=(n,pseudo)=>n.ownerDocument.defaultView.getComputedStyle(n,pseudo);
 const nativeChildren=n=>Array.from(n.childNodes||[]);
 function frameDocument(n){
  if(!n?.matches?.('iframe,frame'))return null;
  try {
   const d=n.contentDocument;
   if(!d?.documentElement||!d.defaultView||!['http:','https:'].includes(d.location.protocol))return null;
   // Arbitrary transformed frame chains need a separate coordinate adapter.
   for(let p=n;p;p=parent(p)) {const c=style(p);if(c.transform!=='none'||(c.zoom&&Number(c.zoom)!==1))return null;}
   return d;
  }catch{return null;}
 }
 function parent(n){
  if(!n)return null;
  if(n.assignedSlot)return n.assignedSlot;
  if(n.parentElement)return n.parentElement;
  const root=n.getRootNode?.();
  if(root?.host)return root.host;
  return docs.get(n.ownerDocument)||null;
 }
 function contains(a,b){for(let n=b;n;n=parent(n))if(n===a)return true;return false;}
 function closest(n,selector){for(let p=n;p;p=parent(p))if(p.matches?.(selector))return p;return null;}
 function connected(n){
  if(!n?.isConnected)return false;
  let d=n.ownerDocument,depth=0;
  while(d!==document){const f=docs.get(d);if(!f?.isConnected||frameDocument(f)!==d||++depth>8)return false;d=f.ownerDocument;}
  return true;
 }
 function children(n){
  const list=n.localName==='slot'?(n.assignedNodes().length?n.assignedNodes():nativeChildren(n)):n.shadowRoot?nativeChildren(n.shadowRoot):nativeChildren(n);
  const d=frameDocument(n);if(d){if(!docs.has(d))docs.set(d,n);return [d.documentElement];}
  return list;
 }
 function collect(root,mask=1,limit=50000){
  const result=[],seen=new Set(),stack=[root];let count=0;
  while(stack.length){const n=stack.pop();if(seen.has(n))continue;seen.add(n);if(++count>limit){truncated=true;throw Error('EMBEDDED_TREE_LIMIT');}
   if(n!==root&&(mask&(n.nodeType===1?1:n.nodeType===3?4:0)))result.push(n);
   if(n===globalThis.__brodexPointer?.host||globalThis.__brodexV2UiNodes?.has(n)||n.nodeType===1&&['script','style','template','noscript'].includes(n.localName))continue;
   const next=children(n);for(let i=next.length-1;i>=0;i--)stack.push(next[i]);
  }return result;
 }
 function walker(root,mask){
  let current=root;
  const accepted=n=>!!(mask&(n.nodeType===1?1:n.nodeType===3?4:0));
  const slots=new WeakMap();
  const nextSibling=n=>{const slot=n.assignedSlot;if(!slot)return n.nextSibling;let item=slots.get(slot);if(!item){const list=slot.assignedNodes();item={list,index:new Map(list.map((v,i)=>[v,i]))};slots.set(slot,item);}const i=item.index.get(n);return i===undefined?null:item.list[i+1]||null;};
  const advance=n=>{const c=n.shadowRoot||n.localName==='slot'||n.matches?.('iframe,frame')?children(n)[0]:n.firstChild;if(c)return c;while(n&&n!==root){const next=nextSibling(n);if(next)return next;n=parent(n);}return null;};
  return {seek(n){current=n;},nextNode(){let n=current;while(n=advance(n))if(accepted(n)){current=n;return n;}return null;},
   nextSibling(){let n=current;while(n=nextSibling(n))if(accepted(n)){current=n;return n;}return null;},
   parentNode(){if(current===root)return null;let p=parent(current);while(p&&p!==root&&!accepted(p))p=parent(p);if(!p)return null;current=p;return p;}};
 }
 function query(root,selector){return collect(root,1).filter(n=>n.matches(selector));}
 // Only these subtrees are proven not to render independent descendants.
 // visibility:hidden is insufficient: a child may override it.
 function foldKind(n){
  if(!collection(n)||!n.ownerDocument.defaultView)return null;
  if(n.localName==='select'&&!n.querySelector('button,selectedcontent')){
   for(let p=n;p;p=parent(p))if(style(p).display==='none')return 'select';
   if(!n.multiple&&n.size<=1){try{if(!n.matches(':open'))return 'select';}catch{}}
  }
  if(n.localName!=='select')for(let p=n;p;p=parent(p))if(style(p).display==='none')return 'hidden';
  return null;
 }
 function selectedState(n){
  const selected=n.selectedOptions;if(selected.length>256)return null;
  return Array.from(selected,o=>[o,o.value,o.label,o.disabled,parent(o)?.disabled===true]);
 }
 function skipBranch(walk){let next=walk.nextSibling();while(!next&&walk.parentNode())next=walk.nextSibling();return next;}
 function controls(selector){
  // Query each discovered, permitted tree natively. A static NodeList is local
  // to this check; never reuse it as evidence of current membership/state.
  const result=[],started=performance.now(),deadline=started+100;
  let examined=0,nativeMatches=0,rootsVisited=0,folded=0;const types=new Map(),seen=new Set();
  const finish=(reason=null)=>{
   if(reason&&reason!=='control_limit')result.incomplete=true;
   result.coverage={strategy:'native_selector_per_root',complete:!reason,reason,matched_controls:result.length,count_is_lower_bound:!!reason,candidates_examined:examined,native_matches_in_queried_roots:nativeMatches,visited_nodes:null,elapsed_ms:Math.round((performance.now()-started)*10)/10,control_limit:256,candidate_limit:30000,time_limit_ms:100,roots_visited:rootsVisited,roots_total:roots.size,folded_candidates:folded,scope:'discovered_document_and_open_shadow_roots',native_query_interruptible:false,
    ...(reason?{matched_types:Object.fromEntries(types)}:{})};
   return result;
  };
  for(const root of roots){
   if(performance.now()>deadline)return finish('time_limit');
   // querySelectorAll does not pierce iframe or Shadow DOM. Those roots are
   // explicitly registered by the existing embedded-document adapter.
   const candidates=root.querySelectorAll(selector);rootsVisited++;nativeMatches+=candidates.length;
   if(performance.now()>deadline)return finish('time_limit');
   for(const n of candidates){
    if(examined>=30000)return finish('candidate_limit');
    if(performance.now()>deadline)return finish('time_limit');
    examined++;
    if(seen.has(n))continue;seen.add(n);
    const select=n.closest('select');
    if(select&&select!==n&&foldKind(select)==='select'){folded++;continue;}
    result.push(n);const type=n.localName==='input'?'input:'+n.type:n.localName;
    const key=types.has(type)||types.size<16?type:'[other]';types.set(key,(types.get(key)||0)+1);
    if(result.length>256)return finish('control_limit');
   }
  }return finish();
 }

 function mapRect(n,r){
  let x=r.x,y=r.y,d=n.ownerDocument,depth=0;
  while(d!==document){const f=docs.get(d);if(!f||frameDocument(f)!==d||++depth>8)throw Error('FRAME_DOCUMENT_CHANGED');const b=f.getBoundingClientRect();x+=b.x+f.clientLeft;y+=b.y+f.clientTop;d=f.ownerDocument;}
  return {x,y,left:x,top:y,right:x+r.width,bottom:y+r.height,width:r.width,height:r.height};
 }
 const rect=n=>mapRect(n,n.getBoundingClientRect());
 function hit(x,y){
  let root=document,px=x,py=y,last=null;
  for(let depth=0;depth<32;depth++){
   const n=root.elementFromPoint(px,py);if(!n||n===last)return n||last;last=n;
   if(n.shadowRoot){root=n.shadowRoot;continue;}
   const d=frameDocument(n);if(d){if(!docs.has(d))docs.set(d,n);const r=n.getBoundingClientRect();px-=r.x+n.clientLeft;py-=r.y+n.clientTop;if(px<0||py<0||px>=n.clientWidth||py>=n.clientHeight)return n;root=d;continue;}
   return n;
  }throw Error('EMBEDDED_TREE_DEPTH');
 }
 function activeElement(){let n=document.activeElement;for(let i=0;i<32;i++){const next=n?.shadowRoot?.activeElement||frameDocument(n)?.activeElement;if(!next||next===n)return n;n=next;}throw Error('EMBEDDED_TREE_DEPTH');}
 function scopeState(n){
  const chain=[];let d=n.ownerDocument,depth=0;
  while(d!==document){const f=docs.get(d);if(!f||frameDocument(f)!==d||++depth>8)return 'FRAME_DOCUMENT_CHANGED';chain.push([d.location.href,d.defaultView.innerWidth,d.defaultView.innerHeight,d.defaultView.scrollX,d.defaultView.scrollY]);d=f.ownerDocument;}
  if(n.matches?.('iframe,frame')){const child=frameDocument(n);chain.push(child?[child.location.href,child.defaultView.innerWidth,child.defaultView.innerHeight,child.defaultView.scrollX,child.defaultView.scrollY]:['unavailable']);}
  return JSON.stringify(chain);
 }
 function unsupported(n){return !!n?.matches?.('canvas,video')||!!n?.matches?.('iframe,frame')&&!frameDocument(n);}
 function rootLookup(n,id){return n.getRootNode().getElementById?.(id)||null;}
 function text(n){return collect(n,4).filter(t=>!closest(t.parentElement,'script,style,textarea,input,[contenteditable]')).map(t=>t.nodeValue).join(' ');}
 function scope(n){let frames=0,shadows=0;for(let p=n;p;p=parent(p)){if(p.getRootNode()?.host)shadows++;if(p.matches?.('iframe,frame'))frames++;}return {iframe_depth:frames,shadow_dom:shadows>0};}
 function discover(observer){
  let open=0,available=0,unavailable=0,deferred=0;
  const walk=walker(document.documentElement,1);let n;
  while(n=walk.nextNode()){
   if(nodesScanned>=30000||performance.now()>deadline){truncated=true;break;}
   nodesScanned++;
   while(largeCollection(n)){deferred++;let next=walk.nextSibling();while(!next&&walk.parentNode())next=walk.nextSibling();n=next;if(!n)break;}if(!n)break;
   if(n.shadowRoot){open++;if(!roots.has(n.shadowRoot)){roots.add(n.shadowRoot);observer?.observe(n.shadowRoot,{subtree:true,childList:true,attributes:true,characterData:true});}}
   if(n.matches('iframe,frame')){seenFrames.add(n);const d=frameDocument(n);if(d){available++;if(!roots.has(d)){roots.add(d);docs.set(d,n);observer?.observe(d.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});}if(!frameRecords.has(n))frameRecords.set(n,d);}else unavailable++;}
  }
  return {open_shadow_roots_read:open,iframes_read:available,iframes_not_read:unavailable,tree_complete:!truncated&&deferred===0,deferred_collection_subtrees:deferred};
 }
 return {collection,foldKind,selectedState,skipBranch,parent,contains,closest,connected,children,walker,query,controls,mapRect,rect,hit,activeElement,scopeState,unsupported,rootLookup,text,discover,scope,style,frameDocument,docs,roots,frameRecords,seenFrames};
}

 const dom=createEmbeddedTree();
 // Retain only verified document routes needed by the selected collection or pinned target.
 const selectedDocument=(catalogTarget||requestedGroup?.root||preparationPin?.refs?.[0])?.ownerDocument;
 for(let n=catalogTarget||requestedGroup?.root||preparationPin?.refs?.[0];n;){const r=n.getRootNode();if(!r.host)break;dom.roots.add(r);n=r.host;}
 if(selectedDocument&&selectedDocument!==document){
  const route=[];let d=selectedDocument;
  while(d!==document){const f=previous?.tree.docs.get(d);if(!f||route.length>=8)return {error:'FRAME_DOCUMENT_CHANGED'};route.push([f,d]);d=f.ownerDocument;}
  for(const [f,d] of route.reverse()){if(dom.frameDocument(f)!==d)return {error:'FRAME_DOCUMENT_CHANGED'};dom.docs.set(d,f);dom.roots.add(d);dom.frameRecords.set(f,d);}
 }
 const refs=new Map();
 const groups=new Map();
 const snapshot={id:snapshotId,url:location.href,created:Date.now(),refs,groups,tree:dom,catalogBaseline,catalogTarget,revision:0,scrollX,scrollY,width:innerWidth,height:innerHeight};
 snapshot.isPageMutation=record=>{
  // Text-only updates to the non-rendered document title do not stale viewport pixels.
  const title=record.target.nodeType===3?dom.parent(record.target):record.target;
  if(title?.localName==='title'&&dom.parent(title)===document.head&&dom.style(title).display==='none'){
   if(record.type==='characterData')return false;
   if(record.type==='childList'&&[...record.addedNodes,...record.removedNodes].every(node=>node.nodeType===3))return false;
  }
  const host=globalThis.__brodexPointer?.host,own=node=>node===host||globalThis.__brodexV2UiNodes?.has(node);if(own(record.target))return false;return record.type!=='childList'||[...record.addedNodes,...record.removedNodes].some(node=>!own(node));};
 snapshot.changes=[];snapshot.changeMap=new Map();snapshot.changesOverflow=false;snapshot.changedObjectCount=0;snapshot.mutationCount=0;snapshot.frameLoadCount=0;
 snapshot.recordChanges=records=>{let changed=false;for(const record of records){if(!snapshot.isPageMutation(record))continue;changed=true;snapshot.mutationCount++;
  for(const g of groups.values()){
   const n=record.target.nodeType===3?dom.parent(record.target):record.target;
   if(dom.contains(g.root,n)||dom.contains(n,g.root))g.dirty=true;
  }
  snapshot.onPreparedMutation?.(record);
  snapshot.onDomMutation?.(record);
  const target=record.target.nodeType===3?(dom.parent(record.target)||record.target):record.target;
  const textOnly=record.type==='characterData'||record.type==='childList'&&[...record.addedNodes,...record.removedNodes].every(node=>node.nodeType===3);
  let entry=snapshot.changeMap.get(target);
  if(!entry){if(snapshot.changeMap.size>=128){snapshot.changesOverflow=true;snapshot.unindexedEvents=(snapshot.unindexedEvents||0)+1;continue;}
   entry={firstEvent:snapshot.mutationCount,lastEvent:snapshot.mutationCount,structuralEvents:0,addedNodes:0,removedNodes:0,target,type:record.type,textOnly:true,events:0,text:false,structure:false,attributes:false};snapshot.changeMap.set(target,entry);snapshot.changes.push(entry);snapshot.changedObjectCount=snapshot.changeMap.size;
  }
  if(record.type==='attributes'){entry.attributeNames??=new Set();if(entry.attributeNames.size<16)entry.attributeNames.add(record.attributeName);else entry.attributeNamesCapped=true;}
  entry.lastEvent=snapshot.mutationCount;if(record.type==='childList'&&!textOnly){entry.structuralEvents++;entry.addedNodes+=record.addedNodes.length;entry.removedNodes+=record.removedNodes.length;}
  entry.events++;entry.textOnly=entry.textOnly&&textOnly;entry.text=entry.text||textOnly;entry.structure=entry.structure||record.type==='childList'&&!textOnly;entry.attributes=entry.attributes||record.type==='attributes';
 }if(changed)snapshot.revision++;};
 snapshot.observer=new MutationObserver(snapshot.recordChanges);
 snapshot.observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
 for(const r of dom.roots)if(r!==document)snapshot.observer.observe(r.documentElement||r,{subtree:true,childList:true,attributes:true,characterData:true});
 snapshot.embeddedCoverage=dom.discover(snapshot.observer);
 // Frame documents and hosts retain their identities for the lifetime of this snapshot.
 snapshot.frames=new Map();
 const rectKey=el=>{const r=dom.rect(el);return [r.x,r.y,r.width,r.height].join(',');};
 let frameIndex=0;
 for(const el of dom.frameRecords.keys())snapshot.frames.set(el,{token:String(++frameIndex),src:el.getAttribute('src'),srcdoc:el.hasAttribute('srcdoc'),rect:rectKey(el),document:dom.frameDocument(el),loaded:false});
 const frameLoad=e=>{const entry=snapshot.frames.get(e.target);if(entry){entry.loaded=true;snapshot.frameLoadCount++;snapshot.revision++;}};
 for(const frame of snapshot.frames.keys())frame.addEventListener('load',frameLoad);
 snapshot.disposeFrames=()=>{for(const frame of snapshot.frames.keys())frame.removeEventListener('load',frameLoad);};
 globalThis.__brodexSnapshot=snapshot;
 snapshot.expiryTimer=setTimeout(()=>{if(globalThis.__brodexSnapshot===snapshot){snapshot.observer?.disconnect();snapshot.disposeFrames?.();globalThis.__brodexSnapshot=null;}},60000);
 const clean=(s,n)=>String(s||'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
 const visibleCache=new WeakMap();
 function visible(el){
  if(!el)return false;
  if(visibleCache.has(el))return visibleCache.get(el);
  let ok=true;
  for(let p=el;p;p=dom.parent(p)){
   const style=dom.style(p);
   if(p.hidden||style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0||style.contentVisibility==='hidden'){ok=false;break;}
  }
  // display:contents containers have no own rectangle, but their children can be visible.
  visibleCache.set(el,ok);return ok;
 }
 function textHasLayout(node){
  if(dom.parent(node).getClientRects().length)return true;
  if(dom.style(dom.parent(node)).display!=='contents')return false;
  const range=node.ownerDocument.createRange();range.selectNodeContents(node);
  return Array.from(range.getClientRects()).some(r=>r.width>0&&r.height>0);
 }
 const elements=[],parts=[];let chars=0,visited=0,seenElements=0,textTruncated=false,elementsTruncated=false,scanLimit=false,frames=0,shadowRoots=0;
 const root=document.body||document.documentElement;
 // Context is retained only in the isolated world, never returned as HTML/values.
 // A button's unchanged outerHTML alone cannot identify the object it acts on.
 const contexts=new Map(),contextOwners=new Map(),nodeEntries=new Map();let contextNodes=0;
 const own=node=>node!==globalThis.__brodexPointer?.host&&!globalThis.__brodexV2UiNodes?.has(node);
 const rectOf=n=>{const r=dom.rect(n);return [r.x,r.y,r.width,r.height];};
 const styleOf=n=>{const c=dom.style(n);return [c.display,c.visibility,c.opacity,c.pointerEvents,c.transform,c.position,c.zIndex,c.overflow,c.contentVisibility].join('|');};
 const identityOf=n=>JSON.stringify([Array.from(n.attributes,a=>[a.name,a.value]),Array.from(n.childNodes).filter(c=>c.nodeType===3).map(c=>c.nodeValue)]);
 const stateOf=n=>JSON.stringify([n.value??null,n.checked??null,n.indeterminate??null,n.selectedIndex??null,n.disabled===true,n.inert===true,n.getAttribute('aria-selected'),n.getAttribute('aria-checked'),dom.scopeState(n)]);
 const controls=dom.controls('input:not([type="hidden"]),select,textarea,[aria-selected],[aria-checked]');
 const controlsOverflow=controls.length>256;const controlsState=new Map(controls.slice(0,256).map(n=>[n,stateOf(n)]));let controlsDirty=false;
 function skipBranch(walk){let next=walk.nextSibling();while(!next&&walk.parentNode())next=walk.nextSibling();return next;}
  const compactSelect=n=>dom.foldKind(n)==='select';
  const selectedState=n=>dom.selectedState(n);
 function captureContext(el){
  // Preserve explicit row/form boundaries. A compound link can itself be a
  // record containing identity and controls, even without list/row semantics.
  // Never shrink a plain action link away from its surrounding record.
  const semantic=dom.closest(el,'tr,[role="row"],li,[role="listitem"],form,[role="option"],[role="tab"],[role="treeitem"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]');
  const link=dom.closest(el,'a[href]');
  const compoundLink=link&&link.querySelector('button,input,select,textarea,[role="button"],[role="checkbox"],[role="switch"]');
  let scope=semantic||(compoundLink?link:null)||dom.parent(el)||el;
  if(['html','body'].includes(scope.localName))scope=el;
  if(contexts.has(scope))return contexts.get(scope);
  const context={selects:new Map(),deferred:new Map(),nodes:new Map(),ancestors:new Map(),dirty:false,error:null,kind:!semantic&&compoundLink?'compound_link':scope===el?'target':scope.matches('tr,[role="row"],li,[role="listitem"]')?'row':'container'};contexts.set(scope,context);
  const walk=dom.walker(scope,NodeFilter.SHOW_ELEMENT);let n=scope,chars=0;
  do{
   while(n&&n!==el&&!dom.contains(n,el)&&dom.foldKind(n)==='hidden'){
    context.deferred.set(n,{parent:dom.parent(n),identity:identityOf(n),style:styleOf(n),state:stateOf(n),dirty:false});
    n=skipBranch(walk);
   }
   if(!n)break;
   if(compactSelect(n)){
    const selected=selectedState(n);
    if(!selected){context.error='DOM_CONTEXT_LIMIT';context.limitReason='selected_options';break;}
    context.selects.set(n,{dirty:false,selected,visible:visible(n)});
   }
   if(!own(n)||['script','style','template'].includes(n.localName))continue;
   if(context.nodes.size>=512||(!nodeEntries.has(n)&&contextNodes>=8192)){context.error='DOM_CONTEXT_LIMIT';context.limitReason=context.nodes.size>=512?'context_nodes':'total_nodes';break;}
   if(dom.unsupported(n)){context.error='DOM_CONTEXT_UNSUPPORTED';context.unsupportedNode=n;break;}
   if(!context.selects.has(n)&&!n.shadowRoot&&n.localName!=='slot'&&n.childNodes.length>512){context.error='DOM_CONTEXT_LIMIT';context.limitReason='context_children';break;}
   const identity=identityOf(n);chars+=identity.length;if(chars>100000){context.error='DOM_CONTEXT_LIMIT';context.limitReason='signature_chars';break;}
   let entry=nodeEntries.get(n);if(!entry){entry={parent:dom.parent(n),identity,state:stateOf(n),rect:rectOf(n),style:styleOf(n),children:context.selects.has(n)?null:dom.children(n).filter(own)};nodeEntries.set(n,entry);contextNodes++;}context.nodes.set(n,entry);
   let owners=contextOwners.get(n);if(!owners)contextOwners.set(n,owners=new Set());owners.add(context);
  }while(n=context.selects.has(n)?skipBranch(walk):walk.nextNode());
  for(let p=dom.parent(scope);p;p=dom.parent(p))context.ancestors.set(p,{parent:dom.parent(p),style:styleOf(p),rect:rectOf(p),attrs:identityOf(p)});
  context.signatureChars=chars;context.coverage={complete:!context.error,reason:context.limitReason||context.error||null,nodes:context.nodes.size,node_limit:512,unique_stored_nodes:contextNodes,unique_node_limit:8192,signature_chars:chars,signature_limit:100000,scope:context.kind,deferred_hidden_collections:context.deferred.size,compact_selects:context.selects.size};
  return context;
 }
 const markContext=(context,node,type)=>{context.dirty=true;context.changedObjects??=new Set();if(context.changedObjects.size<128)context.changedObjects.add(node);else if(!context.changedObjects.has(node))context.changedObjectsCapped=true;context.mutationKinds??=new Set();context.mutationKinds.add(type==='attributes'?'attributes':type==='childList'?'structure':'text');};
 const selectedContexts=Array.from(new Set(controls.slice(0,256).filter(n=>n.checked===true||n.getAttribute('aria-selected')==='true'||n.getAttribute('aria-checked')==='true').map(captureContext)));
 snapshot.onDomMutation=record=>{
  const n=record.target.nodeType===3?dom.parent(record.target):record.target;
  if(controlsState.has(n)||record.type==='attributes'&&['aria-selected','aria-checked','checked','selected'].includes(record.attributeName))controlsDirty=true;
  for(const context of contextOwners.get(n)||[])markContext(context,n,record.type);
  for(const context of contexts.values()){
   for(const [root,entry] of context.selects)if(dom.contains(root,n))entry.dirty=true;
   for(const [root,entry] of context.deferred)if(dom.contains(root,n)||record.type==='childList'&&[...record.removedNodes].some(v=>v===root||dom.contains(v,root)))entry.dirty=true;
   if(record.type==='attributes'&&context.ancestors.has(n))markContext(context,n,record.type);
   if(record.type==='childList')for(const changed of [...record.addedNodes,...record.removedNodes]){
    if(!own(changed))continue;
    for(const c of context.nodes.keys())if(changed===c||dom.contains(changed,c)){markContext(context,n,record.type);break;}
   }
  }
 };
 const retryState=globalThis.__brodexRetryState??={nodes:new WeakMap(),next:0,last:null};
 snapshot.matchesRef=ref=>{
  snapshot.recordChanges(snapshot.observer.takeRecords());
  if(ref.signature!==null)return ref.signature===ref.el.outerHTML;
  // A context refusal must not force a huge outerHTML allocation merely to inspect/scroll.
  // Any observed mutation invalidates this conservative fallback, with no exceptions.
  return snapshot.revision===ref.signatureRevision&&identityOf(ref.el)===ref.rootIdentity;
 };
 const nodeRef=n=>{if(!retryState.nodes.has(n))retryState.nodes.set(n,'node-'+(++retryState.next));return retryState.nodes.get(n);};
 snapshot.checkDomContext=(ref,stage='initial')=>{
  snapshot.domDiagnostic=null;snapshot.domIgnored=[];snapshot.lastContextDiagnostic=null;
  snapshot.recordChanges(snapshot.observer.takeRecords());
  const changes=[],internal=[],seen=new Set();let complete=true;
  const target=ref?.el;
  const add=(node,property,before,after,eligible=false,code='DOM_CONTEXT_CHANGED',region='target_context')=>{
   const key=nodeRef(node||document.documentElement)+'|'+property;if(seen.has(key))return;seen.add(key);
   if(changes.length>=256){complete=false;return;}
   const sensitive=dom.closest(node,'input,textarea,select,[contenteditable]');
   eligible=eligible&&!sensitive&&![before,after].some(v=>typeof v==='string'&&v.length>500);
   const id='change-'+(changes.length+1),r=node?.nodeType===1&&dom.connected(node)?dom.rect(node):null;
   const ignored=eligible&&(snapshot.domRetryRules||[]).some(v=>v.node===node&&v.property===property);
   changes.push({change_id:id,element_ref:nodeRef(node||document.documentElement),tag:node?.localName||null,role:node===target?'target':region,property,before:sensitive?'[redacted]':before,after:sensitive?'[redacted]':after,bounds:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,code,exception_allowed:eligible,status:ignored?'Игнорирована':'Останавливает'});
   internal.push({change_id:id,node,property,eligible});
  };
  if(!target||!ref.context){complete=false;add(target,'context',null,null,false,'DOM_CONTEXT_REQUIRED');}
  if(snapshot.width!==innerWidth||snapshot.height!==innerHeight||snapshot.scrollX!==scrollX||snapshot.scrollY!==scrollY)add(target,'viewport',null,null,false,'STALE_SNAPSHOT');
  const controlsNow=dom.controls('input:not([type="hidden"]),select,textarea,[aria-selected],[aria-checked]');
  if(controlsOverflow||controlsNow.length>256){complete=false;add(target,'controls_limit',null,null,false,'DOM_CONTEXT_LIMIT');}
  if(controls.incomplete||controlsNow.incomplete){complete=false;add(target,'controls_scan_limit',null,null,false,'DOM_CONTEXT_LIMIT');}
  for(const n of new Set([...controlsState.keys(),...controlsNow]))if(!controlsState.has(n)||!controlsNow.includes(n)||stateOf(n)!==controlsState.get(n))add(n,'control_state','[redacted]','[redacted]',false,'DOM_CONTROLS_CHANGED','selected_context');
  for(const c of new Set([ref?.context,...selectedContexts].filter(Boolean))){
   const region=c===ref.context?'target_context':'selected_context';
   for(const [n,old] of c.selects){
    const now=selectedState(n);
    if(!compactSelect(n)||visible(n)!==old.visible||!now||now.length!==old.selected.length||now.some((v,i)=>v.some((x,j)=>x!==old.selected[i][j])))
     add(n,'select_collection','unchanged','changed',false,'DOM_CONTEXT_CHANGED',region);
   }
   for(const [n,old] of c.deferred){
    if(!dom.connected(n)||dom.parent(n)!==old.parent||dom.foldKind(n)!=='hidden'||identityOf(n)!==old.identity||styleOf(n)!==old.style||stateOf(n)!==old.state)
     add(n,'deferred_collection','unchanged','changed',false,'DOM_CONTEXT_CHANGED',region);
   }
   if(c.error){complete=false;add(c.unsupportedNode||target,'context_coverage',null,null,false,c.error,region);if(c.unsupportedNode)snapshot.lastUnsupportedDiagnostic={stage,region,node_kind:c.unsupportedNode.shadowRoot?'shadow_host':c.unsupportedNode.localName,relation:c.unsupportedNode===target?'target':'other_context_node'};}
   for(const [n,old] of c.nodes){
    if(!dom.connected(n)||dom.parent(n)!==old.parent){add(n,'attachment','present','changed',false,'DOM_CONTEXT_CHANGED',region);continue;}
    const eligible=region==='target_context'&&!dom.contains(n,target)&&!dom.contains(target,n);
    const a=JSON.parse(old.identity),b=JSON.parse(identityOf(n));
    if(JSON.stringify(a[1])!==JSON.stringify(b[1]))add(n,'text',a[1].join('').slice(0,501),b[1].join('').slice(0,501),eligible,'DOM_CONTEXT_CHANGED',region);
    const am=new Map(a[0]),bm=new Map(b[0]);for(const k of new Set([...am.keys(),...bm.keys()]))if(am.get(k)!==bm.get(k)){const safe=['class','title','aria-label','aria-description'].includes(k);add(n,'attribute:'+k,safe?(am.get(k)||null):'[redacted]',safe?(bm.get(k)||null):'[redacted]',eligible&&safe,'DOM_CONTEXT_CHANGED',region);}
    if(stateOf(n)!==old.state)add(n,'state','[redacted]','[redacted]',false,'DOM_CONTEXT_CHANGED',region);
    if(styleOf(n)!==old.style)add(n,'style',old.style,styleOf(n),eligible,'DOM_CONTEXT_CHANGED',region);
    const rect=rectOf(n);if(rect.some((v,i)=>Math.abs(v-old.rect[i])>0.5))add(n,'geometry',old.rect,rect,eligible,'DOM_CONTEXT_CHANGED',region);
    if(old.children){const children=dom.children(n).filter(own);if(!(children.every(v=>v.nodeType===3)&&old.children.every(v=>v.nodeType===3))&&(children.length!==old.children.length||children.some((v,i)=>v!==old.children[i])))add(n,'structure',old.children.length,children.length,false,'DOM_CONTEXT_CHANGED',region);}
   }
   for(const [n,old] of c.ancestors){
    if(!dom.connected(n)||dom.parent(n)!==old.parent){add(n,'attachment','present','changed',false,'DOM_CONTEXT_CHANGED','ancestor');continue;}
    if(styleOf(n)!==old.style)add(n,'style',old.style,styleOf(n),false,'DOM_CONTEXT_CHANGED','ancestor');
    if(identityOf(n)!==old.attrs)add(n,'identity','[redacted]','[redacted]',false,'DOM_CONTEXT_CHANGED','ancestor');
    const rect=rectOf(n);if(rect.some((v,i)=>Math.abs(v-old.rect[i])>0.5))add(n,'geometry',old.rect,rect,false,'DOM_CONTEXT_CHANGED','ancestor');
   }
  }
  if(dom.connected(target)){const r=dom.rect(target),x=r.x+r.width/2,y=r.y+r.height/2,hit=dom.hit(x,y);
   if(!hit||!(hit===target||dom.contains(target,hit)))add(target,'hit_test',true,false,false,'ELEMENT_OCCLUDED');
  }
  snapshot.domIgnored=changes.filter(c=>c.status==='Игнорирована');
  if(changes.some(c=>c.status==='Останавливает')||!complete){
   const failure_id=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
   snapshot.domDiagnostic={content_is_untrusted:true,kind:'dom',controls_coverage:{baseline:controls.coverage,current:controlsNow.coverage},context_coverage:ref?.context?.coverage||{complete:false,reason:'context_missing'},target_ref:target?nodeRef(target):null,failure_id,complete,changes,viewport:{width:innerWidth,height:innerHeight,scroll_x:scrollX,scroll_y:scrollY},dispatch_state:'not_dispatched'};
   snapshot.lastContextDiagnostic={version:2,stage,reason:changes[0]?.property,region:changes[0]?.role,changed_objects_observed:new Set(changes.map(c=>c.element_ref)).size,count_is_lower_bound:!complete,count_capped:!complete,mutation_kinds:[]};
   retryState.last={id:failure_id,snapshot_id:snapshot.id,created:Date.now(),target,targetSignature:target?.outerHTML,targetState:target?stateOf(target):null,internal,complete,kind:'dom'};
   return changes.find(c=>c.status==='Останавливает')?.code||'DOM_DIAGNOSTIC_INCOMPLETE';
  }
  return null;
 };

 const traversalRoot=catalogTarget||preparationPin?.refs?.[0]||requestedGroup?.root||root;
 if(!dom.connected(traversalRoot))return {error:'PREPARATION_TARGET_CHANGED'};
 const walker=dom.walker(traversalRoot,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
 let node=groupRequest?.cursor?requestedGroup.next:traversalRoot;
 walker.seek(node);
 let groupItems=0,groupStopped=false,directoryStopped=false,resumeText=groupRequest?.cursor?(requestedGroup.textOffset||0):0,nextTextOffset=0;
 const groupLimit=groupRequest?.limit??50;
 const groupOutput=[],groupOptions=[];
 function registerGroup(el){
  if(groups.size>=50){scanLimit=true;return null;}
  const id='g'+(groups.size+1),kind=el.localName==='select'?'options':el.matches('tbody,[role="rowgroup"]')?'rows':'items';
  groups.set(id,{root:el,frameState:dom.scopeState(el),dirty:false,cursor:null,next:null});
  const record={group_id:id,kind,name:clean(el.getAttribute('aria-label')||el.getAttribute('title')||'',250),visible:visible(el),content:'deferred',count_lower_bound:el.localName==='select'?Math.min(51,el.options.length):Math.min(51,el.children.length),total:null,embedded_scope:dom.scope(el)};
  if(el.localName==='select'){record.selected=[];for(let i=0;i<Math.min(10,el.selectedOptions.length);i++){const o=el.selectedOptions[i];record.selected.push({label:clean(o.label,100),value:clean(o.value,100)});}record.selected_truncated=el.selectedOptions.length>10;}
  groupOutput.push(record);return record;
 }
 function publicText(el,limit=250){
  let out='',count=0;const w=dom.walker(el,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);let n;
  while((n=w.nextNode())&&++count<=128&&out.length<limit){if(n.nodeType===3&&!dom.closest(dom.parent(n),'input,textarea,[contenteditable],script,style'))out+=n.nodeValue.slice(0,limit-out.length)+' ';}
  return clean(out,limit);
 }
 while(node){
  if(++visited>30000||performance.now()>deadline){scanLimit=true;groupStopped=!!groupRequest;break;}
  if(groupRequest&&node!==traversalRoot){
   if(chars>=maxChars||seenElements>=maxElements){groupStopped=true;break;}
   if(node.nodeType===1&&(traversalRoot.localName==='select'?node.localName==='option':dom.parent(node)===traversalRoot)){if(groupItems>=groupLimit){groupStopped=true;break;}groupItems++;}
  }
  if(node.nodeType===Node.ELEMENT_NODE){
   const el=node,tag=el.localName;
   if(el.shadowRoot&&!dom.roots.has(el.shadowRoot)){dom.roots.add(el.shadowRoot);snapshot.embeddedCoverage.open_shadow_roots_read++;snapshot.observer.observe(el.shadowRoot,{subtree:true,childList:true,attributes:true,characterData:true});}
   if(tag==='iframe'){
    const d=dom.frameDocument(el);if(!dom.seenFrames.has(el)){dom.seenFrames.add(el);snapshot.embeddedCoverage[d?'iframes_read':'iframes_not_read']++;}if(d&&!dom.roots.has(d)){dom.docs.set(d,el);dom.roots.add(d);snapshot.observer.observe(d.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});}
    if(d&&!snapshot.frames.has(el)){snapshot.frames.set(el,{token:String(++frameIndex),src:el.getAttribute('src'),srcdoc:el.hasAttribute('srcdoc'),rect:rectKey(el),document:d,loaded:false});el.addEventListener('load',frameLoad);}
   }
   if(groupRequest&&traversalRoot.localName==='select'&&tag==='option'){
    const o={label:clean(el.label,100),value:clean(el.value,100),selected:el.selected,disabled:Boolean(el.disabled||dom.parent(el)?.disabled)};
    groupOptions.push(o);chars+=o.label.length+o.value.length;node=skipBranch(walker);continue;
   }
   if(collection(el)&&el!==traversalRoot){
    const g=registerGroup(el);if(!g){directoryStopped=true;break;}
    if(tag!=='select'){node=skipBranch(walker);continue;}
   }
   if(el.shadowRoot)shadowRoots++;
   if(tag==='iframe')frames++;
   if(['script','style','noscript','template','input'].includes(tag)||!visible(el)){
    // Process input metadata below, but never traverse form values or hidden subtrees.
    if(tag!=='input'){
     let next=walker.nextSibling();
     while(!next&&walker.parentNode())next=walker.nextSibling();
     node=next;continue;
    }
   }
   const role=el.getAttribute('role');
   const editor=el.isContentEditable&&!dom.parent(el)?.isContentEditable;
   // A visible HTML label is the public interaction surface of a styled native toggle.
   const control=tag==='label'?el.control:null;
   const labelControl=control?.localName==='input'&&['checkbox','radio'].includes(control.type)&&(!visible(control)||!control.getClientRects().length)?control:null;
   let surface=el;
   if(labelControl&&dom.contains(el,labelControl)){
    for(let p=dom.parent(labelControl);p&&p!==el;p=dom.parent(p)){
     if(p.tabIndex>=0&&visible(p)&&p.getClientRects().length&&dom.query(p,'input,select,textarea,button').length===1&&!p.innerText.trim()){surface=p;break;}
    }
   }
   // Structural targets remain structural: addressability does not assert a click handler.
   // Keep collection folding and the existing per-read/context budgets unchanged.
   const structuralKind=tag==='li'?'listitem':tag==='tr'?'row':tag==='summary'?'summary':null;
   const focusTarget=el.hasAttribute('tabindex')&&el.tabIndex>=0;
   const exactTarget=el===catalogTarget||el===retryTarget||preparationPin?.refs?.includes(el);
   if(el===catalogTarget&&surface!==el)return {error:'CATALOG_SURFACE_REMAP_REQUIRED'};
   const kind=labelControl?(labelControl.getAttribute('role')==='switch'?'switch':labelControl.type):tag==='a'&&el.hasAttribute('href')?'link':tag==='button'?'button':tag==='input'?'input':tag==='select'?'select':tag==='textarea'?'textarea':tag==='img'?'image':/^h[1-6]$/.test(tag)?'heading':editor?(role||'textbox'):role||structuralKind||(focusTarget?'element':exactTarget?'generic':null);
   if(kind&&visible(el)&&el.getClientRects().length&&!(tag==='input'&&el.type==='hidden')){
    const index=seenElements++;
    if(index>=elementOffset+maxElements)elementsTruncated=true;
    else if(index>=elementOffset){
     const labelled=(el.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>dom.rootLookup(el,id)?.textContent||'').join(' ');
     const label=el.getAttribute('aria-label')||labelled||Array.from(el.labels||[]).map(x=>x.innerText).join(' ')||((tag==='input'||tag==='textarea'||el.isContentEditable)?'':publicText(el))||el.getAttribute('alt')||el.getAttribute('title')||el.getAttribute('placeholder')||'';
     const rect=dom.rect(surface);
     const item={embedded_scope:dom.scope(el),element_id:'e'+(index+1),kind:clean(kind,40),name:clean(label,250),in_viewport:rect.bottom>0&&rect.right>0&&rect.top<innerHeight&&rect.left<innerWidth};
     if(dom.activeElement()===surface||dom.activeElement()===el||labelControl&&dom.activeElement()===labelControl)item.focused=true;
     const selected=el.getAttribute('aria-selected');
     if(selected==='true'||selected==='false')item.selected=selected==='true';
     if(tag==='input')item.input_type=el.type;
     if('disabled' in el)item.disabled=Boolean(el.disabled||el.matches(':disabled'));
     if(el.getAttribute('aria-disabled')==='true')item.disabled=true;
     if(tag==='input'&&['checkbox','radio'].includes(el.type)){item.checked=el.checked;item.indeterminate=el.indeterminate;}
     else if(el.hasAttribute('aria-checked'))item.checked=el.getAttribute('aria-checked');
     if(el.hasAttribute('aria-expanded'))item.expanded=el.getAttribute('aria-expanded');
     if((tag==='input'||tag==='textarea')&&el.readOnly)item.readonly=true;
     const popup=el.getAttribute('aria-haspopup');
     if(['true','menu','listbox','tree','grid','dialog'].includes(popup))item.haspopup=popup==='true'?'menu':popup;
     if((tag==='textarea'||tag==='input'&&['text','search','email','url','tel','number','password'].includes(el.type))&&!el.readOnly&&!item.disabled&&!dom.closest(el,'[inert]'))item.editable=true;
     if(tag==='select'){
      const group=groupOutput.find(g=>groups.get(g.group_id).root===el);
      if(groupRequest&&el===traversalRoot)item.options_in_group_page=true;
      else if(group)item.options_group=group.group_id;
      else {item.options=[];for(let i=0;i<Math.min(40,el.options.length);i++){const o=el.options[i];item.options.push({label:clean(o.label,100),value:clean(o.value,100),selected:o.selected,disabled:Boolean(o.disabled||dom.parent(o)?.disabled)});}item.options_truncated=el.options.length>40;}
     }
     const cx=Math.max(0,rect.left)+(Math.min(innerWidth,rect.right)-Math.max(0,rect.left))/2;
     const cy=Math.max(0,rect.top)+(Math.min(innerHeight,rect.bottom)-Math.max(0,rect.top))/2;
     const hit=item.in_viewport?dom.hit(cx,cy):null;
     item.occluded=item.in_viewport&&!(hit===surface||dom.contains(surface,hit));
     if(labelControl){
      item.checked=labelControl.checked;item.indeterminate=labelControl.indeterminate;
      item.disabled=Boolean(labelControl.disabled||labelControl.matches(':disabled')||labelControl.getAttribute('aria-disabled')==='true');
      item.interaction_surface=surface===el?'native_label':'native_toggle_surface';
     }
     if(editor){item.input_type='contenteditable';item.readonly=el.getAttribute('aria-readonly')==='true';item.editable=!item.readonly&&!item.disabled&&!dom.closest(el,'[inert]');}
     const actionable=exactTarget||editor||labelControl||focusTarget||['button','input','select','textarea','link','checkbox','radio','switch','option','tab','treeitem','menuitemcheckbox','menuitemradio','menuitem','listitem','row','summary'].includes(kind);
     const context=actionable?captureContext(surface):null;
     if(actionable){item.context_status=context.error||'guarded';item.context_kind=context.kind;if(context.error||context.deferred.size||context.selects.size)item.context_coverage=context.coverage;
      if(context.limitReason)item.context_limit={reason:context.limitReason,nodes:context.nodes.size,signature_chars:context.signatureChars};
     }
     refs.set(item.element_id,{el:surface,auditIdentity:{kind:item.kind,name:item.name},signature:context?.error?null:surface.outerHTML,signatureRevision:snapshot.revision,rootIdentity:context?.error?identityOf(surface):null,context,...(labelControl?{labelElement:el,labelControl,controlSignature:labelControl.outerHTML,controlChecked:labelControl.checked,controlIndeterminate:labelControl.indeterminate}:{})});
     if(kind==='link'){
      item.link_kind=linkKind(el.getAttribute('href')||'');
      try{const url=new URL(el.getAttribute('href'),el.baseURI);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)item.href=url.href.slice(0,1000);}catch{}
     }
     elements.push(item);
    }
   }
  }else if(node.nodeType===Node.TEXT_NODE&&dom.parent(node).localName!=='textarea'&&!dom.parent(node).isContentEditable&&visible(dom.parent(node))&&textHasLayout(node)){
   const value=clean(node.nodeValue,groupRequest?resumeText+maxChars+1:textOffset+maxChars+1);
   if(groupRequest&&value){
    const available=Math.max(0,maxChars-chars),remaining=value.slice(resumeText);
    if(remaining.length>available){parts.push(remaining.slice(0,available));chars+=available;nextTextOffset=resumeText+available;groupStopped=true;break;}
    if(remaining){parts.push(remaining);chars+=remaining.length+1;}resumeText=0;node=walker.nextNode();continue;
   }
   if(value){if(chars<textOffset+maxChars+1){parts.push(value);chars+=value.length+1;}else textTruncated=true;}
  }
  if(node.nodeType===1&&node.localName==='select'&&collection(node)&&node!==traversalRoot){node=skipBranch(walker);continue;}
  node=walker.nextNode();
 }
 if(groupRequest||directoryStopped){
  const id='requested',cursor=node?Array.from(crypto.getRandomValues(new Uint8Array(12)),v=>v.toString(16).padStart(2,'0')).join(''):null;
  groups.set(id,{root:traversalRoot,frameState:dom.scopeState(traversalRoot),dirty:false,cursor,next:node,textOffset:nextTextOffset});
  snapshot.groupPage={group_id:id,next_cursor:cursor,has_more:!!node,items_started:groupItems,limit:groupLimit,complete:!node};
 }
 const fullText=parts.join('\n');textTruncated ||= fullText.length>textOffset+maxChars;
 const result={snapshot_id:snapshotId,url:location.href,title:document.title.slice(0,1000),ready_state:document.readyState,
  text:fullText.slice(textOffset,textOffset+maxChars),text_offset:textOffset,next_text_offset:textTruncated?textOffset+maxChars:null,
  groups:groupOutput,...(groupRequest&&traversalRoot.localName==='select'?{options:groupOptions}:{}),...(snapshot.groupPage?{group_page:snapshot.groupPage}:{}),read_budget:{visited_nodes:visited,elapsed_ms:Math.round(performance.now()-started),time_limit_ms:250,node_limit:30000},elements,viewport:{width:innerWidth,height:innerHeight,scroll_x:scrollX,scroll_y:scrollY},element_offset:elementOffset,next_element_offset:elementsTruncated?elementOffset+elements.length:null,truncated:{text:textTruncated,elements:elementsTruncated,scan:scanLimit},
  controls_coverage:controls.coverage,
  context_storage:{contexts:contexts.size,unique_nodes:nodeEntries.size,unique_node_limit:8192,lifetime_ms:60000},
  coverage:{main_frame_only:false,...snapshot.embeddedCoverage,open_shadow_roots_not_read:0,closed_shadow_roots_not_detectable:true,form_values_omitted:true},
  content_is_untrusted:true};
 if(groupRequest&&groupStopped||directoryStopped){result.truncated.group=true;result.next_element_offset=null;result.next_text_offset=null;}
 // Keep native-messaging frames comfortably below Chrome's one-megabyte limit.
 while(new TextEncoder().encode(JSON.stringify(result)).length>750000&&result.elements.length){result.elements.pop();result.truncated.elements=true;}
 if(result.truncated.elements)result.next_element_offset=elementOffset+result.elements.length;
 if(catalogTarget){const pair=[...refs].find(([id,r])=>r.el===catalogTarget);if(!pair)return {error:'CATALOG_TARGET_NOT_ACTIONABLE'};result.catalog_target={element_id:pair[0],mapping:'exact_node',observation_id:readOptions.catalog_target.observation_id,ref:readOptions.catalog_target.ref};}
 return result;
 }catch(error){
  // Report only a bounded error category, never DOM text, values or stacks.
  const kind=['TypeError','ReferenceError','RangeError','SecurityError'].includes(error?.name)?error.name:'Error';
  return {error:'PAGE_READ_SCRIPT_FAILED: '+kind};
 }
}









