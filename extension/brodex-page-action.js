// Fixed main-frame actions and opt-in visual iframe dragging, executed in Chrome's ISOLATED world.
async function brodexPageAction(args){
 function linkKind(raw){
  if(/^javascript:\s*void\s*\(\s*0\s*\)\s*;?\s*$/i.test(raw.trim()))return 'inert_javascript';
  try{const u=new URL(raw,location.href);if(u.username||u.password)return 'credentials';return ['http:','https:'].includes(u.protocol)?'http':u.protocol==='javascript:'?'javascript_blocked':'scheme_blocked';}catch{return 'invalid';}
 }
 let unsupportedDiagnostic;const fail=error=>{try{const p=globalThis.__brodexSnapshot?.preparedClick;if(p?.failure&&args._show_pointer!==false)showScope(p,p.failure);}catch{}return {error,...(globalThis.__brodexSnapshot?.domDiagnostic?{retry_diagnostic:globalThis.__brodexSnapshot.domDiagnostic}:{}),...(globalThis.__brodexSnapshot?.preparedClick?.diagnostic?{retry_diagnostic:globalThis.__brodexSnapshot.preparedClick.diagnostic}:{}),...(unsupportedDiagnostic?{unsupported_diagnostic:unsupportedDiagnostic}:{})};};
 if(!['http:','https:'].includes(location.protocol)||location.href!==args.expected_url)return fail('PAGE_CHANGED');
 function feedback(method,...values){try{globalThis.__brodexPointer?.[method](...values);}catch{/* Feedback never changes the command outcome. */}}
 if(args.action==='hide_pointer'){feedback('hide');return {hidden:true};}
 if(args.action==='pointer_result'){feedback('finish',args.failed?'Не выполнено':'Нажатие отправлено',Boolean(args.failed));return {shown:true};}
 const show=args._show_pointer!==false;
 if(!show)feedback('hide');
 function ensurePointer(){
   let ui=globalThis.__brodexPointer;
   if(!ui||!dom.connected(ui.host)){
    const host=document.createElement('div');
    host.setAttribute('aria-hidden','true');
    host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;';
    const shadow=host.attachShadow({mode:'closed'});
    shadow.innerHTML=`<style>:host{pointer-events:none!important}*{box-sizing:border-box;pointer-events:none!important}.target{position:fixed;border:2px solid #22d3ee;border-radius:6px;background:#22d3ee18;display:none}.cursor{position:fixed;left:0;top:0;transition:transform 220ms ease-out;filter:drop-shadow(0 2px 3px #0008)}.label{position:absolute;left:22px;top:24px;background:#12303e;color:#fff;border:1px solid #22d3ee;border-radius:7px;padding:5px 8px;font:12px/1.4 system-ui;white-space:nowrap}.ring{position:absolute;left:-13px;top:-13px;width:28px;height:28px;border:3px solid #22d3ee;border-radius:50%;opacity:0}@media(prefers-reduced-motion:reduce){.cursor{transition:none}}</style><div class="target"></div><div class="cursor"><svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2L3 23L8 17L13 26L17 24L12 15L20 14Z" fill="#22d3ee" stroke="#052330" stroke-width="2"/></svg><div class="ring"></div><div class="label"></div></div>`;
    const cursor=shadow.querySelector('.cursor'),target=shadow.querySelector('.target'),labelNode=shadow.querySelector('.label'),ring=shadow.querySelector('.ring');
    const trail=document.createElementNS('http://www.w3.org/2000/svg','svg');
    trail.style.cssText='position:fixed;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none';
    trail.innerHTML='<line stroke="#22d3ee" stroke-width="2" stroke-dasharray="5 5" opacity=".65"/><circle r="5" fill="#12303e" stroke="#22d3ee" stroke-width="2"/>';
    shadow.prepend(trail);
    cursor.style.transition='none';cursor.style.display='none';trail.style.display='none';
    const regionsLayer=document.createElement('div');shadow.append(regionsLayer);
    ui={host,cursor,target,labelNode,ring,trail,position:null,from:null,motion:null,timer:null,regionTimer:null,
     hideRegions(){clearTimeout(this.regionTimer);this.regionEpoch=(this.regionEpoch||0)+1;regionsLayer.replaceChildren();},
     showRegions(regions,x,y,extra=[],failureOnly=false){
      this.hideRegions();clearTimeout(this.timer);cursor.style.display='none';target.style.display='none';trail.style.display='none';
      const layers=[{color:'#22d3ee',rects:regions},{color:'#fb923c',rects:extra.filter(r=>r.kinds?.includes('auto'))},{color:'#ef4444',rects:extra.filter(r=>r.kinds?.includes('failure'))}].filter(s=>s.rects.length);
      const duration=failureOnly?1000:500,epoch=this.regionEpoch;
      for(const stage of layers){
       const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;';
       const fill=document.createElementNS('http://www.w3.org/2000/svg','g'),border=document.createElementNS('http://www.w3.org/2000/svg','g');
       fill.setAttribute('opacity','0.16');fill.setAttribute('fill',stage.color);border.setAttribute('fill','none');border.setAttribute('stroke',stage.color);border.setAttribute('stroke-width','2');
       const seen=new Set();for(const r of stage.rects){const key=[r.x,r.y,r.width,r.height].map(Math.round).join(',');if(seen.has(key))continue;seen.add(key);for(const group of [fill,border]){const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');for(const k of ['x','y','width','height'])rect.setAttribute(k,String(r[k]));group.append(rect);}}
       svg.append(fill,border);regionsLayer.append(svg);
      }
      if(!layers.length)return 0;
      this.regionTimer=setTimeout(()=>{if(this.regionEpoch===epoch)regionsLayer.replaceChildren();},duration);return duration;
     },
     hide(){this.hideRegions();clearTimeout(this.timer);this.motion?.cancel();cursor.style.display='none';target.style.display='none';trail.style.display='none';},
     finish(text,error=false){
      labelNode.textContent='Brodex · '+text;labelNode.style.borderColor=error?'#fb7185':'#22d3ee';
      clearTimeout(this.timer);this.timer=setTimeout(()=>{try{this.hide();}catch{}},1600);
      if(!error&&!matchMedia('(prefers-reduced-motion: reduce)').matches)ring.animate([{opacity:0.9,transform:'scale(.5)'},{opacity:0,transform:'scale(2)'}],{duration:450});
     }};
    // Register before insertion so our snapshot observer can ignore only this exact host.
    globalThis.__brodexPointer=ui;document.documentElement.append(host);
    cursor.style.transform='translate('+Math.max(10,innerWidth-100)+'px,40px)';
   }
   return ui;
 }
 async function point(x,y,rect,label){
  if(!show)return;
  try{
   const ui=ensurePointer();
   clearTimeout(ui.timer);ui.cursor.style.display='block';ui.labelNode.textContent='Brodex · '+label;ui.labelNode.style.borderColor='#22d3ee';
   ui.labelNode.style.left=x>innerWidth-220?'-190px':'22px';ui.labelNode.style.top=y>innerHeight-70?'-40px':'24px';
   if(rect){ui.target.style.cssText='display:block;left:'+rect.left+'px;top:'+rect.top+'px;width:'+rect.width+'px;height:'+rect.height+'px';}else ui.target.style.display='none';
   const clamp=(v,max)=>Math.max(0,Math.min(max-1,v));
   const from=ui.position?{x:clamp(ui.position.x,innerWidth),y:clamp(ui.position.y,innerHeight)}:{x,y};
   ui.from=from;ui.position={x,y};
   const line=ui.trail.querySelector('line'),dot=ui.trail.querySelector('circle');
   for(const [key,value] of Object.entries({x1:from.x,y1:from.y,x2:x,y2:y}))line.setAttribute(key,String(value));
   dot.setAttribute('cx',String(from.x));dot.setAttribute('cy',String(from.y));
   const distance=Math.hypot(x-from.x,y-from.y),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
   ui.trail.style.display=distance>8?'block':'none';
   ui.motion?.cancel();
   const transform=p=>'translate('+p.x+'px,'+p.y+'px)';
   ui.cursor.style.transform=transform(ui.position);
   const duration=reduced?0:Math.min(600,Math.max(240,distance*.45));
   if(duration)ui.motion=ui.cursor.animate([{transform:transform(from)},{transform:transform(ui.position)}],{duration,easing:'ease-in-out'});
   await new Promise(resolve=>setTimeout(resolve,duration+30));
   ui.timer=setTimeout(()=>{try{ui.hide();}catch{}},2200);
  }catch{/* Visual feedback must not prevent the actual action. */}
 }
 function finish(label,failed=false){if(show)feedback('finish',label,failed);}
 const s=globalThis.__brodexSnapshot;
 if(!s||s.id!==args.snapshot_id||s.url!==location.href||Date.now()-s.created>60000)return fail('STALE_SNAPSHOT: read_page again');
 const dom=s.tree;
 if(args.action==='frame_action_point'){
  const el=s.refs.get(args.element_id)?.el;if(!dom.connected(el))return fail('STALE_ELEMENT');
  const r=dom.rect(el);return {x:Math.max(0,r.left)+(Math.min(innerWidth,r.right)-Math.max(0,r.left))/2,y:Math.max(0,r.top)+(Math.min(innerHeight,r.bottom)-Math.max(0,r.top))/2};
 }
 if(!['inspect_dom_ignored','prepare_dom_retry'].includes(args.action))s.domDiagnostic=null;
 if(args.action==='retire_snapshot'){
  clearTimeout(s.expiryTimer);s.observer?.disconnect();s.disposeFrames?.();globalThis.__brodexSnapshot=null;
  return {invalidated:true};
 }

 if(args.action==='show_context_regions'){
  const regions=args.context_regions;
  if(s.width!==innerWidth||s.height!==innerHeight||s.scrollX!==scrollX||s.scrollY!==scrollY)return fail('STALE_SCREENSHOT: viewport changed');
  if(!Array.isArray(regions)||regions.length<1||regions.length>8||regions.some(r=>![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>innerWidth||r.y+r.height>innerHeight)||!Number.isFinite(args.x)||!Number.isFinite(args.y)||args.x<0||args.y<0||args.x>=innerWidth||args.y>=innerHeight)return fail('PREPARED_CONTEXT_REQUIRED');
  if(!show)return {shown:false};
  try{ensurePointer().showRegions(regions,args.x,args.y);return {shown:true};}catch{return {shown:false};}
 }
 function frameToken(el){
  const entry=s.frames?.get(el),r=dom.rect(el);
  if(!entry||entry.loaded||entry.document!==dom.frameDocument(el)||entry.src!==el.getAttribute('src')||entry.srcdoc!==el.hasAttribute('srcdoc')||entry.rect!==[r.x,r.y,r.width,r.height].join(','))throw Error('FRAME_CHANGED');
  if(entry.srcdoc||!entry.src)throw Error('FRAME_URL_UNSUPPORTED');
  const u=new URL(entry.src,location.href);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('FRAME_URL_UNSUPPORTED');
  for(let p=el;p;p=dom.parent(p)){const c=dom.style(p);if(p.hidden||p.inert||c.display==='none'||c.visibility!=='visible'||Number(c.opacity)===0||c.pointerEvents==='none')throw Error('ELEMENT_NOT_VISIBLE');}
  return entry.token;
 }
 function targetFrameToken(n){const frame=n.ownerDocument!==document?dom.docs.get(n.ownerDocument):n.matches('iframe,frame')?n:null;return frame?frameToken(frame):null;}
 // A bounded, in-memory baseline is captured BEFORE the screenshot, never returned as text.
 function contentsRects(node){
  if(dom.style(node).display!=='contents')return null;
  const range=document.createRange();range.selectNodeContents(node);
  const rects=Array.from(range.getClientRects()).filter(r=>r.width>0&&r.height>0).map(r=>dom.mapRect(node,r));
  if(rects.length>4096)throw Error('PREPARED_CONTEXT_NODE_LIMIT');
  return rects;
 }
 function renderedRect(node){
  const rects=contentsRects(node);if(!rects||!rects.length)return dom.rect(node);
  const left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top)),right=Math.max(...rects.map(r=>r.right)),bottom=Math.max(...rects.map(r=>r.bottom));
  return {x:left,y:top,left,top,right,bottom,width:right-left,height:bottom-top};
 }
 function visualRect(node){const r=renderedRect(node);return [r.x,r.y,r.width,r.height];}
 function visualStyle(node){const c=dom.style(node);return [c.display,c.visibility,c.opacity,c.pointerEvents,c.position,c.zIndex,c.transform,c.zoom,c.clipPath,c.overflow,c.fontSize,c.color,c.backgroundColor].join('|');}
 function visualState(node){return JSON.stringify([node.disabled===true,node.matches(':disabled'),node.checked??null,node.indeterminate??null,node.selectedIndex??null,node.inert===true,node.scrollLeft,node.scrollTop,dom.scopeState(node)]);}
 function visualSignature(node){return JSON.stringify([Array.from(node.attributes,a=>[a.name,a.name==='value'?'[omitted]':a.value]),Array.from(node.childNodes).filter(n=>n.nodeType===3).map(n=>n.nodeValue)]);}
 function changedRect(a,b){return a.some((v,i)=>Math.abs(v-b[i])>0.5);}
 function drainVisualChanges(){const records=s.observer.takeRecords();if(s.recordChanges)s.recordChanges(records);else if(records.some(s.isPageMutation))s.revision++;}
 // Prepared clicks keep only task context. Overview screenshots are not click permits.
 function scopedStyle(n){return JSON.stringify(contentsRects(n)?.map(r=>[r.x,r.y,r.width,r.height])||null)+'|'+visualStyle(n)+'|'+['::before','::after'].map(p=>{const c=dom.style(n,p);return [c.content,c.display,c.visibility,c.opacity,c.position,c.transform,c.width,c.height,c.top,c.left,c.zIndex,c.pointerEvents].join('|');}).join('|');}
 function scopedSignature(n){const fold=dom.foldKind(n);let selected=null;if(fold==='select'){const state=dom.selectedState(n);if(!state)throw Error('PREPARED_CONTEXT_NODE_LIMIT');selected=state.map(([o,...v])=>[nodeRef(o),...v]);}return JSON.stringify([Array.from(n.attributes,a=>[a.name,a.value]),Array.from(n.childNodes).filter(c=>c.nodeType===3).map(c=>c.nodeValue),n.value??null,fold,selected]);}
 function selectionStyle(n){const c=dom.style(n);return JSON.stringify([contentsRects(n)?.map(r=>[r.x,r.y,r.width,r.height])||null,...['display','visibility','opacity','pointerEvents','position','zIndex','transform','zoom','clipPath','overflow','fontSize'].map(k=>c[k]),...['::before','::after'].map(p=>{const s=dom.style(n,p);return ['content','display','visibility','opacity','position','transform','width','height','top','left','zIndex','pointerEvents'].map(k=>s[k]);})]);}
 function scopedEntry(n){const c=dom.style(n);return {parent:dom.parent(n),rect:visualRect(n),style:scopedStyle(n),selectionStyle:selectionStyle(n),paint:[c.color,c.backgroundColor],state:visualState(n),signature:scopedSignature(n),children:dom.foldKind(n)?null:dom.children(n).filter(c=>c!==globalThis.__brodexPointer?.host)};}
 // Only the executor's completed pointer movement can enable this policy.
 // No baseline is refreshed: later checks still compare to the reviewed target.
 function domHoverPaintAllowed(pin,n,old,now){
  if(args._dom_pointer_hover!==true||args._prepared_execution!==pin.id||pin.command!=='act'||pin.action!=='click'||pin.points.length||old.selectionStyle!==now.selectionStyle)return false;
  const named=pin.refs.some(root=>dom.contains(root,n)&&[...s.refs.values()].some(ref=>ref.el===root&&ref.auditIdentity?.name?.trim()));
  if(!named)return false;
  const opaque=v=>/^rgb\(\s*[\d.]+[, ]+[\d.]+[, ]+[\d.]+\s*\)$/.test(v);
  return old.paint&&now.paint&&old.paint.every((v,i)=>v===now.paint[i]||opaque(v)&&opaque(now.paint[i]));
 }
 function preparationTargetFailure(n,property){
  return {...fail('PREPARATION_TARGET_CHANGED'),retry_diagnostic:{content_is_untrusted:true,kind:'dom',failure_id:Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''),complete:false,phase:'target_guard',dispatch_state:'not_dispatched',changes:[{change_id:'change-1',element_ref:nodeRef(n),tag:n?.localName||null,property,code:'PREPARATION_TARGET_CHANGED',exception_allowed:false,status:'Останавливает'}],reason:'first_target_difference; fresh observation required'}};
 }
 function scopedVisible(n){if(['script','style','head','title','meta','link','template'].includes(n.localName)||n===globalThis.__brodexPointer?.host)return false;const r=renderedRect(n),c=dom.style(n);return r.width>0&&r.height>0&&c.display!=='none'&&c.visibility==='visible'&&Number(c.opacity)>0;}
 function scopedCover(x,y){const map=new Map(),walk=dom.walker(document.documentElement,NodeFilter.SHOW_ELEMENT);let n,count=0;while(n=walk.nextNode()){
  if(++count>50000)throw Error('PREPARED_SCAN_LIMIT');if(!scopedVisible(n))continue;const r=dom.rect(n);
  if(x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom){if(map.size>=512)throw Error('PREPARED_COVER_LIMIT');map.set(n,{rect:visualRect(n),style:scopedStyle(n)});}
 }return map;}
 // Metadata/DOM references stay in the current snapshot memory; labels never use page text.
 function scopeFrames(p,failure){
  const groups=new Map();let outside=0;
  const add=(rect,kind,label)=>{
   if(!rect||!rect.every(Number.isFinite))return;
   const [rx,ry,rw,rh]=rect,x=Math.max(0,rx),y=Math.max(0,ry),right=Math.min(innerWidth,rx+rw),bottom=Math.min(innerHeight,ry+rh);
   if(rw<=0||rh<=0||right<=x||bottom<=y){outside++;return;}
   const key=[x,y,right-x,bottom-y].map(Math.round).join(',');
   let g=groups.get(key);if(!g){g={x,y,width:right-x,height:bottom-y,kinds:new Set(),labels:new Set()};groups.set(key,g);}g.kinds.add(kind);g.labels.add(label);
  };
  for(const [n,reasons] of p.roots||[])add(p.baseline?.get(n)?.rect||visualRect(n),'auto',[...reasons].join(', '));
  if(failure){const n=failure.node,old=p.baseline?.get(n)?.rect;add(dom.connected(n)?visualRect(n):old,'failure',failure.label+(dom.connected(n)?'':' (прежнее место)'));}
  const all=[...groups.values()].sort((a,b)=>Number(b.kinds.has('failure'))-Number(a.kinds.has('failure'))||Number(b.kinds.has('auto'))-Number(a.kinds.has('auto'))||a.width*a.height-b.width*b.height);
  const frames=all.slice(0,48).map(g=>({x:g.x,y:g.y,width:g.width,height:g.height,kinds:[...g.kinds],color:g.kinds.has('failure')?'#ef4444':g.kinds.has('auto')?'#fb923c':'#c084fc',dashed:!g.kinds.has('failure'),label:[...g.labels].join(' / ')}));
  return {frames,omitted:Math.max(0,all.length-frames.length),outside};
 }
 function showScope(p,failure){
  if(!show)return 0;
  try{const v=scopeFrames(p,failure);return ensurePointer().showRegions(p.regions||[],p.x,p.y,v.frames,Boolean(failure));}catch{return 0;}
 }
 // Parent attributes are signals, not vetoes. Only interaction/visibility dependencies are compared.
 function preparedTargetRoots(target,owner){
  const row=dom.closest(target,'tr,[role="row"]');
  if(!row)return [[owner,'цель'],...[dom.closest(owner,'li,[role="listitem"]')].filter(Boolean).map(n=>[n,'элемент списка'])];
  const cells=Array.from(dom.query(row,'td,th,[role="cell"],[role="gridcell"],[role="rowheader"],[role="columnheader"]')).filter(n=>dom.closest(n,'tr,[role="row"]')===row);
  const cell=cells.find(n=>n===target||dom.contains(n,target));
  if(!cell||!cells.length)throw Error('PREPARED_ROW_IDENTITY_UNAVAILABLE');
  // A focusable/clickable row must not pull unrelated changing cells into the baseline.
  // The first cell is only a structural anchor; meaningful identity is agent-selected context.
  return [[owner===row||dom.contains(owner,row)?cell:owner,'цель'],[cells[0],'опорная ячейка строки']];
 }
 function ancestorEffect(n){const c=dom.style(n);return JSON.stringify([n.hidden,n.inert,n.matches(':disabled'),n.getAttribute('aria-disabled'),n.getAttribute('aria-hidden'),c.display,c.visibility,c.opacity,c.pointerEvents,c.clip,c.clipPath,c.overflowX,c.overflowY,c.filter,c.backdropFilter,c.contentVisibility]);}
 function scrollRoute(target){const route=[];for(let n=target;n;n=dom.parent(n)){const c=dom.style(n);if(/auto|scroll|hidden|clip/.test(c.overflowX+' '+c.overflowY))route.push({node:n,key:JSON.stringify([c.overflowX,c.overflowY,c.overscrollBehaviorX,c.overscrollBehaviorY,c.touchAction,n.clientWidth,n.clientHeight,n.scrollWidth,n.scrollHeight,n.scrollLeft,n.scrollTop]),rect:visualRect(n)});}return route;}
 function visibleRegionNodes(regions){
  const found=new Set(),walk=dom.walker(document.documentElement,NodeFilter.SHOW_ELEMENT);let n,count=0;
  for(n=walk.nextNode();n;n=dom.foldKind(n)?dom.skipBranch(walk):walk.nextNode()){
   if(++count>50000)throw Error('PREPARED_SCAN_LIMIT');if(!scopedVisible(n))continue;
   const r=renderedRect(n);
   for(const a of regions){
    if(!(r.left>=a.x&&r.top>=a.y&&r.right<=a.x+a.width&&r.bottom<=a.y+a.height||!n.children.length&&r.left<a.x+a.width&&r.right>a.x&&r.top<a.y+a.height&&r.bottom>a.y))continue;
    const left=Math.max(0,r.left,a.x),top=Math.max(0,r.top,a.y),right=Math.min(innerWidth,r.right,a.x+a.width),bottom=Math.min(innerHeight,r.bottom,a.y+a.height);
    if(right<=left||bottom<=top)continue;
    const points=[[.5,.5],[.15,.15],[.85,.15],[.15,.85],[.85,.85]];
    if(points.some(([fx,fy])=>{const hit=dom.hit(left+(right-left)*fx,top+(bottom-top)*fy);return hit&&(hit===n||dom.contains(n,hit));})){found.add(n);if(found.size>4096)throw Error('PREPARED_CONTEXT_NODE_LIMIT');break;}
   }
  }return found;
 }
 function legacyPreparedGuard(x,y){
  const p=s.preparedClick;if(!p)return 'PREPARED_CLICK_REQUIRED';p.failure=null;
  if(Date.now()-p.created>30000)return 'PREPARED_CLICK_EXPIRED';
  if(x!==p.x||y!==p.y)return 'PREPARED_POINT_MISMATCH';
  if(s.width!==innerWidth||s.height!==innerHeight||s.scrollX!==scrollX||s.scrollY!==scrollY)return 'STALE_SCREENSHOT: viewport changed';
  drainVisualChanges();
  const stop=(code,node,label)=>{p.failure={node,label};return code;};
  // Mutation notifications prompt live comparison; a reverted/no-impact change is not a refusal.
  if(p.structuralLoss){p.failure=p.structuralLoss;return 'STALE_SCREENSHOT: PREPARED_STRUCTURE_CHANGED';}
  for(const [frame,entry] of s.frames||[])if(entry.loaded&&p.baseline.has(frame))return stop('STALE_SCREENSHOT: FRAME_LOADED',frame,'загрузка frame');
  if(!dom.connected(p.target)||dom.hit(x,y)!==p.target)return stop('STALE_SCREENSHOT: PREPARED_TARGET_REPLACED_OR_COVERED',p.target,'цель заменена/перекрыта');
  for(const [node,old] of p.baseline){
   if(!dom.connected(node)||old.parent!==dom.parent(node))return stop('STALE_SCREENSHOT: PREPARED_STRUCTURE_CHANGED',node,'объект удалён/перенесён');
   if(!p.critical.has(node)){
    if(old.effect!==ancestorEffect(node))return stop('STALE_SCREENSHOT: PREPARED_ANCESTOR_EFFECT',node,'влияние предка на доступность/видимость');
    continue;
   }
   const allowance=s.seriesAllowance?.node===node?s.seriesAllowance:null;
   let expectedState=old.state,expectedSignature=old.signature;
   if(allowance){
    if(allowance.kind==='set_checked'){const state=JSON.parse(old.state);state[2]=allowance.desired;expectedState=JSON.stringify(state);}
    else{const signature=JSON.parse(old.signature);const attr=signature[0].find(a=>a[0]==='aria-selected');if(!attr)return stop('SERIES_STATE_UNSUPPORTED',node,'нет aria-selected');attr[1]=String(allowance.desired);expectedSignature=JSON.stringify(signature);}
   }
   if(changedRect(old.rect,visualRect(node))||(allowance?old.selectionStyle!==selectionStyle(node):old.style!==scopedStyle(node))||expectedState!==visualState(node))return stop('STALE_SCREENSHOT: PREPARED_GEOMETRY_STYLE_OR_STATE',node,'геометрия/стиль/состояние');
   if(expectedSignature!==scopedSignature(node))return stop('STALE_SCREENSHOT: PREPARED_IDENTITY_CHANGED',node,'содержимое/атрибуты');
   if(old.children){const children=dom.children(node).filter(c=>c!==globalThis.__brodexPointer?.host);if(children.length!==old.children.length||children.some((c,i)=>c!==old.children[i]))return stop('STALE_SCREENSHOT: PREPARED_STRUCTURE_CHANGED',node,'структура');}
  }
  try{
   const now=visibleRegionNodes(p.regions);
   if(now.size!==p.regionNodes.size||[...now].some(n=>!p.regionNodes.has(n)))return stop('STALE_SCREENSHOT: PREPARED_REGION_CHANGED',[...now].find(n=>!p.regionNodes.has(n))||[...p.regionNodes].find(n=>!now.has(n))||p.target,'изменение видимых объектов области');
   if(args.wheel_guard===true){const route=scrollRoute(p.target);if(route.length!==p.scrollRoute.length||route.some((r,i)=>r.node!==p.scrollRoute[i].node||r.key!==p.scrollRoute[i].key||changedRect(r.rect,p.scrollRoute[i].rect)))return stop('STALE_SCREENSHOT: PREPARED_SCROLL_ROUTE_CHANGED',p.target,'изменение цепочки прокрутки');}
  }catch(e){return e.message;}
  return null;
 }
 // Full diagnostics use stable, document-local node references, never selectors.
 const retryState=globalThis.__brodexRetryState??={nodes:new WeakMap(),next:0,last:null};
 const nodeRef=n=>{if(!n)return null;if(!retryState.nodes.has(n))retryState.nodes.set(n,'node-'+(++retryState.next));return retryState.nodes.get(n);};
 function preparedGuard(x,y){

  const p=s.preparedClick;if(!p)return 'PREPARED_CLICK_REQUIRED';
  p.failure=null;p.diagnostic=null;
  if(Date.now()-p.created>30000)return 'PREPARED_CLICK_EXPIRED';
  if(x!==p.x||y!==p.y)return 'PREPARED_POINT_MISMATCH';
  const changes=[],internal=[],seen=new Set();let complete=true;
  const add=(code,node,property,before,after,eligible=false)=>{
   const ref=nodeRef(node),key=ref+'|'+property;if(seen.has(key))return;seen.add(key);
   if(changes.length>=256){complete=false;return;}
   const old=p.baseline.get(node),r=dom.connected(node)?visualRect(node):old?.rect;
   const sensitive=dom.closest(node,'input,textarea,select,[contenteditable]');
   const safe=v=>sensitive?'[redacted]':typeof v==='string'?v.slice(0,500):v;
   eligible=eligible&&!sensitive&&![before,after].some(v=>typeof v==='string'&&v.length>500);
   const change_id='change-'+(changes.length+1);
   const ignored=eligible&&(p.retryRules||[]).some(v=>v.node===node&&v.property===property);
   changes.push({change_id,element_ref:ref,tag:node?.localName||null,role:node===p.target?'target':p.critical.has(node)?'context':'ancestor',property,before:safe(before),after:safe(after),bounds:r?{x:r[0],y:r[1],width:r[2],height:r[3]}:null,code,exception_allowed:eligible,status:ignored?'Игнорирована':'Останавливает'});
   internal.push({change_id,node,property,eligible});
   if(!ignored&&!p.failure)p.failure={node:node||p.target,label:property};
  };
  if(s.width!==innerWidth||s.height!==innerHeight||s.scrollX!==scrollX||s.scrollY!==scrollY){add('STALE_SCREENSHOT: viewport changed',p.target,'viewport',null,null);complete=false;}
  drainVisualChanges();
  if(p.structuralLoss)add('STALE_SCREENSHOT: PREPARED_STRUCTURE_CHANGED',p.structuralLoss.node,'removed',true,false);
  for(const [frame,entry] of s.frames||[])if(entry.loaded&&p.baseline.has(frame))add('STALE_SCREENSHOT: FRAME_LOADED',frame,'frame_loaded',false,true);
  if(!dom.connected(p.target)||dom.hit(x,y)!==p.target)add('STALE_SCREENSHOT: PREPARED_TARGET_REPLACED_OR_COVERED',p.target,'target_hit',true,false);
  for(const [node,old] of p.baseline){
   if(!dom.connected(node)||old.parent!==dom.parent(node)){add('STALE_SCREENSHOT: PREPARED_STRUCTURE_CHANGED',node,'parent_or_connection','present','changed');continue;}
   if(!p.critical.has(node)){const now=ancestorEffect(node);if(old.effect!==now)add('STALE_SCREENSHOT: PREPARED_ANCESTOR_EFFECT',node,'ancestor_effect',old.effect,now);continue;}
   const rect=visualRect(node),style=scopedStyle(node),state=visualState(node);const contextOnly=!dom.contains(node,p.target)&&!dom.contains(p.target,node);
   if(changedRect(old.rect,rect))add('STALE_SCREENSHOT: PREPARED_GEOMETRY_STYLE_OR_STATE',node,'geometry',old.rect,rect,contextOnly);
   const allowance=s.seriesAllowance?.node===node?s.seriesAllowance:null;let expectedState=old.state,expectedSignature=old.signature;
   if(allowance){if(allowance.kind==='set_checked'){const state=JSON.parse(old.state);state[2]=allowance.desired;expectedState=JSON.stringify(state);}else{const signature=JSON.parse(old.signature);const attr=signature[0].find(a=>a[0]==='aria-selected');if(attr)attr[1]=String(allowance.desired);expectedSignature=JSON.stringify(signature);}}
   if(allowance?old.selectionStyle!==selectionStyle(node):old.style!==style)add('STALE_SCREENSHOT: PREPARED_GEOMETRY_STYLE_OR_STATE',node,'style',old.style,style,contextOnly);
   if(expectedState!==state)add('STALE_SCREENSHOT: PREPARED_GEOMETRY_STYLE_OR_STATE',node,'state',old.state,state);
   const before=JSON.parse(expectedSignature),after=JSON.parse(scopedSignature(node));
   if(JSON.stringify(before[1])!==JSON.stringify(after[1]))add('STALE_SCREENSHOT: PREPARED_IDENTITY_CHANGED',node,'text',before[1].join(''),after[1].join(''),!dom.contains(node,p.target)&&!dom.contains(p.target,node));
   const a=new Map(before[0]),b=new Map(after[0]);
   for(const key of new Set([...a.keys(),...b.keys()]))if(a.get(key)!==b.get(key))add('STALE_SCREENSHOT: PREPARED_IDENTITY_CHANGED',node,'attribute:'+key,['id','class','title','role','aria-label','aria-description'].includes(key)?a.get(key)??null:'[redacted]',['id','class','title','role','aria-label','aria-description'].includes(key)?b.get(key)??null:'[redacted]',contextOnly&&['class','title','aria-label','aria-description'].includes(key));
   if(before[2]!==after[2])add('STALE_SCREENSHOT: PREPARED_IDENTITY_CHANGED',node,'value','[redacted]','[redacted]');
   if(JSON.stringify(before.slice(3))!==JSON.stringify(after.slice(3)))add('STALE_SCREENSHOT: PREPARED_IDENTITY_CHANGED',node,'collection_state','unchanged','changed');
   if(old.children){const children=dom.children(node).filter(c=>c!==globalThis.__brodexPointer?.host);
   if(!(children.every(c=>c.nodeType===3)&&old.children.every(c=>c.nodeType===3))&&(children.length!==old.children.length||children.some((c,i)=>c!==old.children[i])))add('STALE_SCREENSHOT: PREPARED_STRUCTURE_CHANGED',node,'children',old.children.length,children.length);}
  }
  try{const now=visibleRegionNodes(p.regions);for(const n of new Set([...now,...p.regionNodes]))if(now.has(n)!==p.regionNodes.has(n))add('STALE_SCREENSHOT: PREPARED_REGION_CHANGED',n,'region_membership',p.regionNodes.has(n),now.has(n));
   if(args.wheel_guard===true){const route=scrollRoute(p.target);if(route.length!==p.scrollRoute.length||route.some((r,i)=>r.node!==p.scrollRoute[i].node||r.key!==p.scrollRoute[i].key||changedRect(r.rect,p.scrollRoute[i].rect)))add('STALE_SCREENSHOT: PREPARED_SCROLL_ROUTE_CHANGED',p.target,'scroll_route',null,null);}
  }catch(e){complete=false;add(e.message,p.target,'inspection_incomplete',null,null);}
  p.ignoredChanges=changes.filter(c=>c.status==='Игнорирована');
  if(changes.some(c=>c.status==='Останавливает')||!complete){
   const failure_id=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
   p.diagnostic={content_is_untrusted:true,failure_id,complete,changes,viewport:{width:innerWidth,height:innerHeight,scroll_x:scrollX,scroll_y:scrollY},dispatch_state:'not_dispatched'};
   retryState.last={id:failure_id,created:Date.now(),target:p.target,internal,complete,regions:p.regions,targetEntries:[...p.baseline].filter(([n])=>p.critical.has(n)&&(dom.contains(n,p.target)||dom.contains(p.target,n)))};
   return changes.find(c=>c.status==='Останавливает')?.code||'PREPARED_DIAGNOSTIC_INCOMPLETE';
  }
  return null;
 }

 // A common preparation pin survives fresh observations, but never a new document.
 if(args.action==='show_action_preparation'){
  const pin=globalThis.__brodexActionPreparation;if(!pin||pin.id!==args.preparation_id)return fail('PREPARATION_EXPIRED');
  const frames=pin.items.flatMap(p=>scopeFrames(p).frames);if(!frames.length)return {shown:false};
  const ms=ensurePointer().showRegions(pin.regions,pin.points[0]?.x||0,pin.points[0]?.y||0,frames);if(ms)await new Promise(resolve=>setTimeout(resolve,ms));feedback('hide');return {shown:true};
 }
 if(args.action==='preparation_observation')return {valid:true};
 if(args.action==='bind_action_preparation'){
  const a=args.parameters,c=args.command;
  const refs=[];let points=[],focus=null;
  if(a.element_id){const ref=s.refs.get(a.element_id);if(!dom.connected(ref?.el))return fail('STALE_ELEMENT');refs.push(ref.el);}
  if(c==='press_key'){focus=dom.activeElement();if(!focus||dom.unsupported(focus))return fail('KEYBOARD_TARGET_UNSUPPORTED');if([...s.refs.values()].some(r=>r.el===focus))refs.push(focus);}
  if(c==='drag')points=[{x:a.from_x,y:a.from_y},{x:a.to_x,y:a.to_y}];
  else if(c==='operation')points=a.steps.map(v=>({x:v.x,y:v.y}));
  else if(Number.isFinite(a.x)&&Number.isFinite(a.y))points=[{x:a.x,y:a.y}];
  if(points.some(p=>![p.x,p.y].every(Number.isFinite)||p.x<0||p.y<0||p.x>=innerWidth||p.y>=innerHeight))return fail('INVALID_COORDINATES');
  const targets=points.map(p=>dom.hit(p.x,p.y));
  if(targets.some(n=>!n||dom.unsupported(n)))return fail('PREPARED_TARGET_UNSUPPORTED');
  const pin={id:args.preparation_id,created:Date.now(),command:c,action:a.action,refs,points,targets,focus,viewport:[innerWidth,innerHeight,scrollX,scrollY],targetEntries:[...new Set([...refs,...targets,...(focus?[focus]:[])])].map(n=>[n,scopedEntry(n)]),regions:args.context_regions||[]};
  const identityNodes=new Set();for(const n of [...refs,...targets]){const owner=refs.includes(n)?n:dom.closest(n,'button,a,input,select,textarea,label,[role="button"],[role="checkbox"],[role="switch"]')||n;identityNodes.add(owner);for(const child of dom.query(owner,'*')){if(identityNodes.size>=4096)return fail('PREPARED_CONTEXT_NODE_LIMIT');identityNodes.add(child);}}if(focus)identityNodes.add(focus);pin.targetEntries=[...identityNodes].map(n=>[n,scopedEntry(n)]);if(pin.targetEntries.reduce((v,[n,e])=>v+e.signature.length,0)>500000)return fail('PREPARED_CONTEXT_SIGNATURE_LIMIT');
  globalThis.__brodexActionPreparation=pin;
  const selected=[...s.refs].find(([id,r])=>refs.includes(r.el));return {bound:true,visual:points.length>0,element_offset:selected?Math.max(0,Number(selected[0].slice(1))-50):0};
 }
 if(['prepare_action_bundle','guard_action_bundle'].includes(args.action)){
  const pin=globalThis.__brodexActionPreparation;
  if(!pin||pin.id!==args.preparation_id||Date.now()-pin.created>300000)return fail('PREPARATION_EXPIRED');
  if(JSON.stringify(pin.viewport)!==JSON.stringify([innerWidth,innerHeight,scrollX,scrollY]))return fail('PREPARATION_VIEWPORT_CHANGED');
  if(pin.focus&&dom.activeElement()!==pin.focus)return fail('PREPARATION_FOCUS_CHANGED');
  for(let i=0;i<pin.targets.length;i++)if(!dom.connected(pin.targets[i])||dom.hit(pin.points[i].x,pin.points[i].y)!==pin.targets[i])return preparationTargetFailure(pin.targets[i],'hit_target');
  for(const [n,old] of pin.targetEntries){
   if(!dom.connected(n))return preparationTargetFailure(n,'attachment');
   const now=scopedEntry(n);
   const property=old.parent!==dom.parent(n)?'parent':old.signature!==now.signature?'identity':old.state!==now.state?'state':changedRect(old.rect,now.rect)?'geometry':old.style!==now.style&&!domHoverPaintAllowed(pin,n,old,now)?'style':null;
   if(property)return preparationTargetFailure(n,property);
  }
  if(args.action==='prepare_action_bundle'){
   const last=pin.failure;
   const ids=args.change_ids||[];
   if(args.failure_id&&(!last||last.id!==args.failure_id||!last.complete||ids.some(id=>!last.internal.some(c=>c.change_id===id&&c.eligible))))return fail('RETRY_UNRESOLVED_CHANGES');
   pin.rules=last?last.internal.filter(c=>ids.includes(c.change_id)):[];
   pin.items=[];pin.refIds=[];pin.review=[];
   for(const n of pin.refs){const pair=[...s.refs].find(([id,r])=>r.el===n);if(!pair)return fail('PREPARATION_TARGET_NOT_IN_OBSERVATION');pin.refIds.push(pair[0]);}
   s.domRetryRules=pin.rules;
   const handlers=[];
   for(const p of pin.points){
    const result=await brodexPageAction({...args,action:'prepare_scoped',...p,context_regions:pin.regions,_show_pointer:false,_series_member:true});
    if(result.error)return result;
    s.preparedClick.retryRules=pin.rules;
    pin.items.push(s.preparedClick);pin.review.push(...result.review_regions);handlers.push(s.onPreparedMutation);
   }
   if(handlers.length)s.onPreparedMutation=r=>{for(const h of handlers)h(r);};
   pin.snapshot=s.id;
  }
  if(pin.snapshot!==s.id)return fail('PREPARATION_CONTROL_STALE');
  const changes=[],internal=[],seen=new Set();let complete=true;
  const controlsReports=[];let controlsReportsOmitted=0;
  const collect=d=>{if(!d)return;if(d.controls_coverage){if(controlsReports.length<4)controlsReports.push({target_ref:d.target_ref,...d.controls_coverage});else controlsReportsOmitted++;}complete=complete&&d.complete;const source=retryState.last?.internal||[];for(const c of d.changes){const key=c.element_ref+'|'+c.property;if(seen.has(key))continue;seen.add(key);if(changes.length>=256){complete=false;continue;}const change_id='change-'+(changes.length+1);changes.push({...c,change_id});const raw=source.find(r=>r.change_id===c.change_id);if(raw)internal.push({...raw,change_id});else complete=false;}};
  const oldPlan=s.preparedOperation;s.preparedOperation=null;
  try{for(const p of pin.items){s.preparedClick=p;const error=preparedGuard(p.x,p.y);if(error)collect(p.diagnostic);else for(const c of p.ignoredChanges||[]){const key=c.element_ref+'|'+c.property;if(!seen.has(key)){seen.add(key);const change_id='change-'+(changes.length+1);changes.push({...c,change_id});const raw=p.retryRules.find(r=>nodeRef(r.node)===c.element_ref&&r.property===c.property);if(raw)internal.push({...raw,change_id});}}}
   for(const id of pin.refIds){if(pin.action==='scroll')continue;const ref=s.refs.get(id);const error=s.checkDomContext(ref,'preparation');if(error)collect(s.domDiagnostic);else for(const c of s.domIgnored||[]){const key=c.element_ref+'|'+c.property;if(!seen.has(key)){seen.add(key);const change_id='change-'+(changes.length+1);changes.push({...c,change_id});const raw=pin.rules.find(r=>nodeRef(r.node)===c.element_ref&&r.property===c.property);if(raw)internal.push({...raw,change_id});}}}
  }finally{s.preparedOperation=oldPlan;s.preparedClick=pin.items[0]||null;}
  if(changes.some(c=>c.status==='Останавливает')||!complete){
   const failure_id=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');pin.failure={id:failure_id,internal,complete};
   const diagnostic={content_is_untrusted:true,...(controlsReports.length?{controls_coverage:controlsReports,controls_coverage_omitted:controlsReportsOmitted}:{}),failure_id,complete,changes,phase:'preparation',dispatch_state:'not_dispatched',viewport:{width:innerWidth,height:innerHeight,scroll_x:scrollX,scroll_y:scrollY}};
   return {error:'PREPARATION_CHANGED',retry_diagnostic:diagnostic};
  }
  return {prepared:true,snapshot_id:s.id,element_id:pin.refIds[0],review_regions:pin.review,ignored_changes:changes,control:{command:pin.command,action:pin.action,target_count:pin.targets.length+pin.refs.length,focus_bound:Boolean(pin.focus),targets:pin.refIds.map(id=>s.refs.get(id)?.auditIdentity),context_complete:true}};
 }

 if(args.action==='probe_stability'){
  // Observation only: never refresh an action baseline or grant permission to click.
  const el=s.refs.get(args.element_id)?.el;
  if(!el||!dom.connected(el))return fail('STABILITY_TARGET_LOST');
  if(s.width!==innerWidth||s.height!==innerHeight||s.scrollX!==scrollX||s.scrollY!==scrollY)return fail('STALE_SNAPSHOT: viewport changed');
  if(dom.unsupported(el))return fail('STABILITY_TARGET_UNSUPPORTED');
  const r=dom.rect(el),x=r.x+r.width/2,y=r.y+r.height/2,hit=dom.hit(x,y);
  const visible=r.width>0&&r.height>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&(hit===el||dom.contains(el,hit));
  const ancestors=[];let animated=el.getAnimations?.({subtree:true}).some(a=>a.playState==='running'||a.pending)===true,accessible=visible;
  for(let n=el;n;n=dom.parent(n)){const c=dom.style(n);ancestors.push([visualRect(n),ancestorEffect(n)]);if(n.getAnimations?.().some(a=>a.playState==='running'||a.pending))animated=true;if(n.hidden||n.inert||c.display==='none'||c.visibility!=='visible'||Number(c.opacity)===0)accessible=false;}
  const signature=JSON.stringify([visualRect(el),scopedStyle(el),scopedSignature(el),visualState(el),ancestors,accessible,animated]);
  s.stabilityProbes??=new Map();let old=s.stabilityProbes.get(el);
  if(!old){old={signature,key:1};s.stabilityProbes.set(el,old);}else if(old.signature!==signature){old.signature=signature;old.key++;}
  return {key:old.key,matched:accessible&&!animated,fresh_observation_required:true};
 }
 function seriesState(item){
  const n=item.node;
  if(!dom.connected(n)||n.matches(':disabled')||n.getAttribute('aria-disabled')==='true')throw Error('SERIES_TARGET_UNAVAILABLE');
  if(item.kind==='set_checked'){if(n.localName!=='input'||n.type!=='checkbox'||n.indeterminate)throw Error('SERIES_STATE_UNSUPPORTED');return n.checked;}
  const value=n.getAttribute('aria-selected');if(value!=='true'&&value!=='false')throw Error('SERIES_STATE_UNSUPPORTED');return value==='true';
 }
 if(args.action==='prepare_series'){
  const steps=args.steps;
  if(!Array.isArray(steps)||steps.length<2||steps.length>20)return fail('INVALID_SERIES');
  const items=[],handlers=[],regions=[],ids=new Set(),nodes=new Set(),allCritical=new Set();
  s.preparedOperation=null;
  try{
   for(const step of steps){
    if(!step||ids.has(step.id)||!['set_checked','ctrl_select'].includes(step.kind)||typeof step.desired!=='boolean')throw Error('INVALID_SERIES_STEP');
    ids.add(step.id);
    const bound=args.prepared_bundle===true?globalThis.__brodexActionPreparation?.items[items.length]:null;
    const result=bound?{review_regions:[...bound.regions]}:await brodexPageAction({...args,action:'prepare_scoped',x:step.x,y:step.y,_show_pointer:false,_series_member:true});
    if(bound)s.preparedClick=bound;
    if(result.error)throw Error(result.error);
    const p=s.preparedClick;
    const node=step.kind==='set_checked'?(dom.closest(p.target,'input[type="checkbox"]')||dom.closest(p.target,'label')?.control):dom.closest(p.target,'[aria-selected]');
    if(!node||nodes.has(node)||[...nodes].some(n=>dom.contains(n,node)||dom.contains(node,n)))throw Error('SERIES_TARGET_UNSUPPORTED_OR_DUPLICATE');
    nodes.add(node);
    const item={...step,node,p,before:null};item.before=seriesState(item);
    // Include the state owner even for an external native label or a selectable row.
    if(!p.critical.has(node)){p.critical.add(node);p.baseline.set(node,scopedEntry(node));}
    const stateRect=dom.rect(node);if(stateRect.width>0&&stateRect.height>0)regions.push({x:stateRect.x,y:stateRect.y,width:stateRect.width,height:stateRect.height});
    for(let n=dom.parent(node);n;n=dom.parent(n))if(!p.baseline.has(n)){p.ancestors.add(n);p.baseline.set(n,{parent:dom.parent(n),rect:visualRect(n),effect:ancestorEffect(n)});}
    for(const n of p.critical)allCritical.add(n);
    if(allCritical.size>4096)throw Error('SERIES_CONTEXT_LIMIT');
    items.push(item);handlers.push(s.onPreparedMutation);regions.push(...result.review_regions);
   }
   s.preparedOperation={id:args.plan_id,items,completed:0,created:Date.now()};
   s.onPreparedMutation=record=>{for(const handler of handlers)handler(record);};
   s.preparedClick=null;
   if(show){
    const frames=[...new Map(items.flatMap(i=>scopeFrames(i.p).frames).map(f=>[[f.x,f.y,f.width,f.height].join(','),f])).values()].slice(0,96);
    const ms=ensurePointer().showRegions(args.context_regions,items[0].x,items[0].y,frames);
    if(ms)try{await new Promise(resolve=>setTimeout(resolve,ms));}finally{feedback('hideRegions');}
   }
   const uniqueRegions=[...new Map(regions.map(r=>[[r.x,r.y,r.width,r.height].join(','),r])).values()];
   return {prepared:true,review_regions:uniqueRegions,steps:items.map(i=>({id:i.id,kind:i.kind,before:i.before,desired:i.desired,x:i.x,y:i.y})),context_nodes:allCritical.size};
  }catch(e){s.preparedOperation=null;s.preparedClick=null;s.onPreparedMutation=null;return fail(e.message);}
 }
 if(args.action==='series_point'){
  const checked=await brodexPageAction({...args,action:'series_guard',_show_pointer:false});if(checked.error)return checked;
  const item=s.preparedOperation?.items[s.preparedOperation.completed];if(!item)return fail('SERIES_STEP_ORDER');
  await point(item.x,item.y,dom.rect(item.p.target),'Серия — выбор объекта…');
  return brodexPageAction({...args,action:'series_guard',_show_pointer:false});
 }
 if(['series_guard','series_verify','series_commit'].includes(args.action)){
  const plan=s.preparedOperation;
  if(!plan||plan.id!==args.plan_id)return fail('SERIES_PLAN_REQUIRED');
  const item=args.step_id===undefined?null:plan.items[plan.completed];
  if(args.step_id!==undefined&&item?.id!==args.step_id)return fail('SERIES_STEP_ORDER');
  try{
   const verifying=args.action!=='series_guard',matched=!!item&&seriesState(item)===item.desired;
   s.seriesAllowance=verifying&&matched?{node:item.node,kind:item.kind,desired:item.desired}:null;
   for(let index=0;index<plan.items.length;index++){
    const target=plan.items[index],expected=index<plan.completed?target.desired:s.seriesAllowance?.node===target.node?target.desired:target.before;
    if(seriesState(target)!==expected)throw Error('SERIES_SELECTION_CHANGED');
    s.preparedClick=target.p;
    const error=preparedGuard(target.x,target.y);if(error)throw Error(error);
   }
   if(args.action==='series_commit'){
    if(!matched)throw Error('SERIES_POSTCONDITION_UNVERIFIED');
    // Rebase ONLY the verified selected/checked state (and its paint colours).
    // Identity, layout, structure, other attributes and every other node were checked above.
    for(const target of plan.items)if(target.p.critical.has(item.node))target.p.baseline.set(item.node,scopedEntry(item.node));
    plan.completed++;
   }
   return {valid:true,matched:verifying?matched:true,key:matched?1:0,completed:plan.completed,...(item?{before:seriesState(item),desired:item.desired}:{} )};
  }catch(e){return fail(e.message);}
  finally{s.seriesAllowance=null;s.preparedClick=null;}
 }
 if(args.action==='prepare_scoped'){
  if(args._series_member!==true)s.preparedOperation=null;
  if(s.width!==innerWidth||s.height!==innerHeight||s.scrollX!==scrollX||s.scrollY!==scrollY)return fail('STALE_SCREENSHOT: viewport changed');
  const {x,y}=args,regions=args.context_regions;
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=innerWidth||y>=innerHeight)return fail('INVALID_COORDINATES');
  if(!Array.isArray(regions)||!regions.length||regions.length>8||regions.some(r=>![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>innerWidth||r.y+r.height>innerHeight))return fail('PREPARED_CONTEXT_REQUIRED');
  const target=dom.hit(x,y);if(!target)return fail('NO_ELEMENT_AT_POINT');
  if(args.overview_guard===true){const pin=globalThis.__brodexOverviewTarget;if(!pin||Date.now()-pin.created>30000||pin.target!==target)return fail('STALE_SCREENSHOT: overview target replaced');for(const [n,old] of pin.entries){if(!dom.connected(n))return fail('PREPARATION_TARGET_CHANGED');const now=scopedEntry(n);if(!dom.connected(n)||dom.parent(n)!==old.parent||changedRect(old.rect,now.rect)||old.signature!==now.signature||old.style!==now.style||old.state!==now.state)return fail('STALE_SCREENSHOT: overview target changed');}}

  if(dom.unsupported(target)){const n=dom.closest(target,'iframe,frame,canvas,video')||target;unsupportedDiagnostic={stage:'prepare_hit_test',region:'target',node_kind:n.shadowRoot?'shadow_host':n.localName,relation:n===target?'target':'ancestor'};return fail('PREPARED_TARGET_UNSUPPORTED');}
  // Anchors used as JS controls need not have href; do not promote them to a distant dialog.
  const owner=dom.closest(target,'button,a,input,select,textarea,label,[role="button"],[role="checkbox"],[role="switch"],[tabindex]')||target;
  // pointer-events is inherited but a descendant may override it. The hit-tested target
  // must accept pointers; none on an ancestor does not disable its auto descendants.
  if(dom.style(target).pointerEvents==='none')return fail('ELEMENT_NOT_VISIBLE');
  for(let n=target;n;n=dom.parent(n)){const c=dom.style(n);if(n.hidden||n.inert||c.display==='none'||c.visibility!=='visible'||Number(c.opacity)===0)return fail('ELEMENT_NOT_VISIBLE');}
  if(owner.matches(':disabled')||owner.getAttribute('aria-disabled')==='true')return fail('ELEMENT_DISABLED');
  const critical=new Set(),ancestors=new Set(),baseline=new Map(),roots=new Map();let chars=0;
  function root(n,reason){if(!roots.has(n))roots.set(n,new Set());roots.get(n).add(reason);} 
  function add(n){if(['script','style','template'].includes(n.localName)||n===globalThis.__brodexPointer?.host)return;if(critical.size>=4096&&!critical.has(n))throw Error('PREPARED_CONTEXT_NODE_LIMIT');critical.add(n);}
  function tree(node,reason='контекст'){root(node,reason);add(node);if(dom.foldKind(node))return;const walk=dom.walker(node,NodeFilter.SHOW_ELEMENT);for(let n=walk.nextNode();n;n=dom.foldKind(n)?dom.skipBranch(walk):walk.nextNode())add(n);}
  try{
   for(const [node,reason] of preparedTargetRoots(target,owner))tree(node,reason);
   for(const n of [target,owner]){for(const label of n.labels||[])tree(label,'подпись цели');for(const id of (n.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean)){const label=dom.rootLookup(n,id);if(!label)throw Error('PREPARED_LABEL_MISSING');tree(label,'подпись цели');}}
   const regionNodes=visibleRegionNodes(regions);for(const n of regionNodes)add(n);
   for(const node of critical)for(let n=dom.parent(node);n;n=dom.parent(n))ancestors.add(n);
   const preview={target,x,y,regions,roots,ancestors,baseline};

   for(const n of new Set([...critical,...ancestors])){if(critical.has(n)&&(dom.unsupported(n))){unsupportedDiagnostic={stage:'prepare_context',region:'critical_context',node_kind:n.shadowRoot?'shadow_host':n.localName,relation:n===target?'target':dom.contains(n,target)?'ancestor':dom.contains(target,n)?'descendant':'other_context_node'};if(show)showScope(preview,{node:n,label:'неподдерживаемый объект'});throw Error('PREPARED_TARGET_UNSUPPORTED');}const entry=critical.has(n)?scopedEntry(n):{parent:dom.parent(n),rect:visualRect(n),effect:ancestorEffect(n)};chars+=entry.signature?.length||0;if(chars>500000)throw Error('PREPARED_CONTEXT_SIGNATURE_LIMIT');baseline.set(n,entry);}
   drainVisualChanges();
   const prepared={target,x,y,regions,roots,created:Date.now(),critical,ancestors,baseline,regionNodes,scrollRoute:scrollRoute(target),dirty:false,changedObjects:new Set(),parentChangedObjects:new Set()};
   if(args.retry_prepare){
    const last=retryState.last;
    if(!last||last.id!==args.retry_prepare.failure_id||!last.complete||Date.now()-last.created>300000||target!==last.target)throw Error('RETRY_TARGET_OR_FAILURE_CHANGED');
    if(args.retry_prepare.quick===true){for(const [n,old] of last.targetEntries||[]){if(!dom.connected(n))return fail('PREPARATION_TARGET_CHANGED');const now=scopedEntry(n);if(!dom.connected(n)||old.parent!==dom.parent(n)||changedRect(old.rect,now.rect)||old.signature!==now.signature||old.style!==now.style||old.state!==now.state)throw Error('RETRY_TARGET_CHANGED');}}
    const ids=args.retry_prepare.change_ids;
    if(!Array.isArray(ids)||ids.some(id=>!last.internal.some(c=>c.change_id===id&&c.eligible)))throw Error('RETRY_EXCEPTION_INVALID');
    prepared.retryRules=last.internal.filter(c=>ids.includes(c.change_id));
    if(prepared.retryRules.some(c=>!dom.connected(c.node)||!critical.has(c.node)))throw Error('RETRY_ELEMENT_CHANGED');
   }
   s.preparedClick=prepared;
   // Feed this before the bounded global journal: unrelated overflow cannot hide critical changes.
   s.onPreparedMutation=record=>{
    const n=record.target.nodeType===3?dom.parent(record.target):record.target;
    const relevant=critical.has(n);
    if(relevant){prepared.firstMutation??={node:n,label:'мутация: '+record.type};prepared.dirty=true;if(prepared.changedObjects.size<4096)prepared.changedObjects.add(n);}
    if(ancestors.has(n)&&prepared.parentChangedObjects.size<4096)prepared.parentChangedObjects.add(n);
    if(record.type==='childList')for(const removed of record.removedNodes){if(removed===globalThis.__brodexPointer?.host)continue;for(const c of critical)if(removed===c||dom.contains(removed,c)){prepared.structuralLoss??={node:c,label:'удаление/замена критичного объекта'};break;}}

   };
   const previewMs=showScope(prepared);if(previewMs){try{await new Promise(resolve=>setTimeout(resolve,previewMs));}finally{feedback('hideRegions');}}
   return {prepared:true,review_regions:[...regions,...[...critical].map(n=>{const [x,y,width,height]=visualRect(n);return {x,y,width,height};})].filter(r=>r.width>0&&r.height>0),context_nodes:critical.size,ancestor_nodes:ancestors.size,signature_chars:chars,context_node_limit:4096,signature_limit:500000};
  }catch(e){s.preparedClick=null;s.onPreparedMutation=null;return fail(e.message);}
 }
 if(args.action==='validate_prepared'){const error=preparedGuard(args.x,args.y);return error?fail(error):{valid:true,ignored_changes:s.preparedClick.ignoredChanges||[],mutation_events:s.mutationCount,tracked_changed_objects:s.changedObjectCount,object_journal_overflow:s.changesOverflow,context_changed_objects:s.preparedClick.changedObjects.size};}

 if(args.action==='begin_overview'){
  drainVisualChanges();
  s.changes=[];s.changeMap=new Map();s.changesOverflow=false;s.mutationCount=0;s.changedObjectCount=0;s.unindexedEvents=0;
  // Overview is an observation, not an action baseline. Detailed state is scoped at preparation.
  s.captureStarted=Date.now();s.captureGeometryChanged=false;
  const changed=()=>{s.captureGeometryChanged=true;};window.addEventListener('resize',changed);document.addEventListener('scroll',changed,true);
  s.captureCleanup=()=>{window.removeEventListener('resize',changed);document.removeEventListener('scroll',changed,true);};
  const dispose=s.disposeFrames;s.disposeFrames=()=>{dispose?.();s.captureCleanup?.();};
  return {started:true};
 }
 if(args.action==='finish_overview'){
  s.captureCleanup?.();drainVisualChanges();
  if(!s.captureStarted||s.captureGeometryChanged||s.width!==innerWidth||s.height!==innerHeight||s.scrollX!==scrollX||s.scrollY!==scrollY)return fail('STALE_SCREENSHOT: viewport changed during capture');
  s.captureChanges=s.changes.map(e=>{const n=e.target,r=n.nodeType===1&&dom.connected(n)?dom.rect(n):null;return {element_ref:nodeRef(n),tag:n.localName||null,connected:dom.connected(n),events:e.events,first_event:e.firstEvent,last_event:e.lastEvent,structural_events:e.structuralEvents||0,added_nodes:e.addedNodes||0,removed_nodes:e.removedNodes||0,attributes_truncated:!!e.attributeNamesCapped,properties:[...(e.text?['text']:[]),...(e.attributes?Array.from(e.attributeNames||[],n=>'attribute:'+n):[]),...(e.structure?['structure']:[])],bounds:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null};}).sort((a,b)=>Number(b.structural_events>0)-Number(a.structural_events>0)||a.first_event-b.first_event);
  s.captureReport={content_is_untrusted:true,interval_start:s.captureStarted,interval_end:Date.now(),capture_is_atomic:false,complete:!s.changesOverflow,journal_coverage:{complete:!s.changesOverflow,reason:s.changesOverflow?'changed_node_limit':null,stored_nodes:s.changes.length,node_limit:128,events:s.mutationCount,unindexed_events:s.unindexedEvents||0,order:'structural_first_then_first_event'},baseline_complete:null,baseline_scope:'not_collected_for_overview',target_coverage:{status:'not_selected'},changed_elements:s.captureChanges.length,events:s.mutationCount,frame_loads:s.frameLoadCount,status:s.mutationCount||s.frameLoadCount?'dom_changed':'no_observed_dom_changes'};
  s.captureReport.embedded_coverage={...s.embeddedCoverage,frame_documents_changed:s.frameLoadCount};s.captureReport.journal_coverage.scope='observed_DOM_roots';
  return {...s.captureReport,response_coverage:{returned:Math.min(10,s.captureChanges.length),total:s.captureChanges.length,complete:s.captureChanges.length<=10},changes:s.captureChanges.slice(0,10),next_offset:s.captureChanges.length>10?10:null};
 }
 if(args.action==='inspect_snapshot_changes'){
  if(!s.captureReport)return fail('OVERVIEW_REQUIRED');
  const offset=args.offset??0,limit=args.limit??20;
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>128)return fail('INVALID_READ_LIMITS');
  const entries=args.element_ref?s.captureChanges.filter(c=>c.element_ref===args.element_ref):s.captureChanges;
  return {...s.captureReport,filter:args.element_ref||null,response_coverage:{offset,returned:entries.slice(offset,offset+limit).length,total:entries.length,complete:offset===0&&limit>=entries.length},changes:entries.slice(offset,offset+limit),next_offset:offset+limit<entries.length?offset+limit:null};
 }
 if(args.action==='check_overview_target'){
  if(!s.captureReport)return fail('OVERVIEW_REQUIRED');
  if(s.width!==innerWidth||s.height!==innerHeight||s.scrollX!==scrollX||s.scrollY!==scrollY)return fail('STALE_SCREENSHOT: viewport changed');
  const n=dom.hit(args.x,args.y),owner=dom.closest(n,'button,a,input,select,textarea,label,[role="button"],[tabindex]')||n;
  if(!n)return fail('NO_ELEMENT_AT_POINT');
  // Bind the current candidate, not an invented correspondence with old pixels.
  // The next fresh control must be reviewed even if this node differs from the overview.
  const critical=new Set([n,owner]);
  const walk=dom.walker(owner,NodeFilter.SHOW_ELEMENT);let child;
  while(child=walk.nextNode()){if(critical.size>=4096)return fail('TARGET_CONTEXT_LIMIT: target subtree exceeds 4096');if(!['script','style','template'].includes(child.localName))critical.add(child);}
  const selection={target:n,owner,entries:Array.from(critical,n=>[n,scopedEntry(n)]),created:Date.now()};globalThis.__brodexOverviewTarget=selection;setTimeout(()=>{if(globalThis.__brodexOverviewTarget===selection)globalThis.__brodexOverviewTarget=null;},30000);
  return {valid:true,target_coverage:{complete:true,nodes:critical.size,scope:'current_candidate'},fresh_control_required:true};
 }

 if(args.action==='inspect_dom_ignored')return {ignored_changes:s.domIgnored||[]};
 if(args.action==='prepare_dom_retry'){
  const last=retryState.last;
  if(!last||last.kind!=='dom'||last.id!==args.failure_id||!last.complete||Date.now()-last.created>300000||s.id===last.snapshot_id)return fail('RETRY_FRESH_DOM_REQUIRED');
  const pair=Array.from(s.refs).find(([id,ref])=>ref.el===last.target);
  if(!pair||!dom.connected(last.target)||last.target.outerHTML!==last.targetSignature||JSON.stringify([last.target.value??null,last.target.checked??null,last.target.indeterminate??null,last.target.selectedIndex??null,last.target.disabled===true,last.target.inert===true,last.target.getAttribute('aria-selected'),last.target.getAttribute('aria-checked'),dom.scopeState(last.target)])!==last.targetState)return fail('RETRY_TARGET_OR_FAILURE_CHANGED');
  if(!Array.isArray(args.change_ids)||last.internal.some(c=>!c.eligible||!args.change_ids.includes(c.change_id))||args.change_ids.some(id=>!last.internal.some(c=>c.change_id===id)))return fail('RETRY_UNRESOLVED_CHANGES');
  const [element_id,ref]=pair;
  if(last.internal.some(c=>!dom.connected(c.node)||!ref.context?.nodes.has(c.node)))return fail('RETRY_ELEMENT_CHANGED');
  s.domRetryRules=last.internal.filter(c=>args.change_ids.includes(c.change_id));
  const error=s.checkDomContext(ref,'prepare_retry');if(error)return fail(error);
  return {kind:'dom',snapshot_id:s.id,element_id,prepared:true,requires_review:true,control:{content_is_untrusted:true,target:ref.auditIdentity,element_ref:nodeRef(ref.el),context_kind:ref.context.kind,context_nodes:ref.context.nodes.size},ignored_changes:s.domIgnored||[]};
 }

 if(args.action==='prepare_visual'){
  drainVisualChanges();
  if(s.revision)return fail('STALE_SCREENSHOT: document mutated during baseline');
  const nodes=dom.query(document,'*'),map=new Map();let bytes=0;
  const diagnostic=(ready,reason)=>({target_baseline:ready,reason,node_count:nodes.length,signature_chars:bytes,node_limit:5000,signature_limit:2000000});
  const unavailable=reason=>{s.visualBaseline=null;s.visualBaselineDiagnostic=diagnostic(false,reason);return s.visualBaselineDiagnostic;};
  if(nodes.length>5000)return unavailable('BASELINE_ELEMENT_LIMIT');
  for(const node of nodes){
   if(node===globalThis.__brodexPointer?.host)continue;
   const signature=visualSignature(node);bytes+=signature.length;
   if(bytes>2000000)return unavailable('BASELINE_SIGNATURE_LIMIT');
   map.set(node,{parent:dom.parent(node),rect:visualRect(node),style:visualStyle(node),state:visualState(node),signature});
  }
  s.visualBaseline=map;
  s.visualBaselineDiagnostic=diagnostic(true,'BASELINE_READY');
  return s.visualBaselineDiagnostic;
 }
 function targetGuard(target,x,y){
  if(args.prepared_required===true)return preparedGuard(x,y);
  if(s.width!==innerWidth||s.height!==innerHeight||s.scrollX!==scrollX||s.scrollY!==scrollY)return 'STALE_SCREENSHOT: viewport changed';
  drainVisualChanges();
  const baseline=s.visualBaseline;
  if(!baseline){const d=s.visualBaselineDiagnostic;return 'STALE_SCREENSHOT: '+(d?.reason||'BASELINE_NOT_PREPARED')+' nodes='+(d?.node_count??0)+' signature_chars='+(d?.signature_chars??0);}
  if(!baseline.has(target))return 'STALE_SCREENSHOT: BASELINE_TARGET_MISSING revision='+s.revision+' mutations='+s.mutationCount;
  if(!dom.connected(target)||dom.hit(x,y)!==target)return 'STALE_SCREENSHOT: target replaced or covered';
  if(dom.unsupported(target))return 'STALE_SCREENSHOT: target requires strict visual verification';
  const prior=baseline.get(target);
  if(x<prior.rect[0]||y<prior.rect[1]||x>=prior.rect[0]+prior.rect[2]||y>=prior.rect[1]+prior.rect[3])return 'STALE_SCREENSHOT: target was not at this point';
  const critical=new Set(),ancestors=[];
  const owner=dom.closest(target,'button,a[href],input,select,textarea,label,[role="button"],[role="switch"],[role="checkbox"],[role="radio"],[tabindex]')||target;
  function subtree(root){if(!root)return true;critical.add(root);for(const child of dom.query(root,'*')){critical.add(child);if(critical.size>512)return false;}return true;}
  if(!subtree(owner))return 'STALE_SCREENSHOT: target context too large';
  // Keep the row identity while allowing counters in other cells to refresh.
  const row=dom.closest(target,'tr,[role="row"]');
  if(row){const first=Array.from(row.children).find(n=>['td','th'].includes(n.localName)||['cell','gridcell','rowheader'].includes(n.getAttribute('role')));if(!first||!subtree(first))return 'STALE_SCREENSHOT: row identity unavailable';}
  for(const node of [target,owner]){
   for(const label of Array.from(node.labels||[]))if(!subtree(label))return 'STALE_SCREENSHOT: label context too large';
   for(const id of (node.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean)){const label=dom.rootLookup(node,id);if(!label||!subtree(label))return 'STALE_SCREENSHOT: accessible label changed';}
  }
  for(let node=target;node;node=dom.parent(node))ancestors.push(node);
  // Geometry, live control state and hit testing are ALWAYS checked, including CSS-only motion.
  for(const node of ancestors){const old=baseline.get(node);if(!old||old.parent!==dom.parent(node)||changedRect(old.rect,visualRect(node))||old.style!==visualStyle(node)||old.state!==visualState(node))return 'STALE_SCREENSHOT: target geometry, ancestry or state changed';}
  for(const node of critical){const old=baseline.get(node);if(!old||old.state!==visualState(node)||old.style!==visualStyle(node)||changedRect(old.rect,visualRect(node)))return 'STALE_SCREENSHOT: target context changed';}
  // A previously covering element may disappear through CSS animation without a DOM mutation.
  for(const [node,old] of baseline){const r=old.rect;if(r[2]<=0||r[3]<=0||x<r[0]||y<r[1]||x>=r[0]+r[2]||y>=r[1]+r[3])continue;
   if(!dom.connected(node)||changedRect(r,visualRect(node))||old.style!==visualStyle(node))return 'STALE_SCREENSHOT: covering geometry changed';
  }
  if(!s.revision)return null;
  // Expensive semantic comparison only after a recorded change; unknown changes stop the action.
  if(s.frameLoadCount)return 'STALE_SCREENSHOT: FRAME_LOADED count='+s.frameLoadCount;
  if(s.changesOverflow)return 'STALE_SCREENSHOT: MUTATION_LOG_OVERFLOW recorded='+s.changes.length+' observed='+s.mutationCount+' limit=128';
  if(!s.changes?.length)return 'STALE_SCREENSHOT: MUTATION_LOG_MISSING revision='+s.revision;
  if(s.changes.some(change=>!change.textOnly))return 'STALE_SCREENSHOT: structural or attribute change requires reread';
  const regions=args.noncritical_regions||[];
  if(!Array.isArray(regions)||regions.length>8||regions.some(r=>![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>innerWidth||r.y+r.height>innerHeight))return 'STALE_SCREENSHOT: invalid noncritical regions';
  function inside(rect,region){return rect[0]>=region.x&&rect[1]>=region.y&&rect[0]+rect[2]<=region.x+region.width&&rect[1]+rect[3]<=region.y+region.height;}
  for(const region of regions)for(const node of critical){const rect=baseline.get(node)?.rect;if(rect&&rect[2]>0&&rect[3]>0&&rect[0]<region.x+region.width&&rect[0]+rect[2]>region.x&&rect[1]<region.y+region.height&&rect[1]+rect[3]>region.y)return 'STALE_SCREENSHOT: noncritical region overlaps target context';}
  for(const change of s.changes){const node=change.target.nodeType===1?change.target:dom.parent(change.target);const old=baseline.get(node);if(!old||!regions.some(region=>inside(old.rect,region)&&inside(visualRect(node),region)))return 'STALE_SCREENSHOT: change outside declared noncritical regions';}

  for(const node of new Set([...critical,...ancestors])){const old=baseline.get(node);if(!old||old.signature!==visualSignature(node))return 'STALE_SCREENSHOT: target identity or text changed';}
  for(const change of s.changes){const node=change.target.nodeType===1?change.target:dom.parent(change.target);if(!node||!dom.connected(node)||critical.has(node)||['style','script','head','title'].includes(node.localName)||dom.closest(node,'style,script,head'))return 'STALE_SCREENSHOT: critical text changed';}
  return null;
 }

 const viewportChanged=s.width!==innerWidth||s.height!==innerHeight||s.scrollX!==scrollX||s.scrollY!==scrollY;
 const scopedExecution=args._prepared_execution===globalThis.__brodexActionPreparation?.id&&Boolean(args._prepared_execution);
 if(args.action==='keyboard_guard'){
  if(viewportChanged||!scopedExecution&&(s.revision||s.observer.takeRecords().some(s.isPageMutation||(()=>true))))return fail('STALE_SNAPSHOT');
  const el=dom.activeElement();
  if(!el||dom.unsupported(el))return fail('KEYBOARD_TARGET_UNSUPPORTED');
  if(el.disabled||dom.closest(el,'[inert]'))return fail('KEYBOARD_TARGET_DISABLED');
  return {valid:true};
 }
 if(args.action==='drag_guard'){
  if(viewportChanged)return fail('DRAG_VIEWPORT_CHANGED');
  const hit=dom.hit(args.x,args.y);
  if(!hit)return fail('DRAG_TARGET_UNSUPPORTED');
  if(args.frame_token){
   try{if(targetFrameToken(hit)!==args.frame_token)return fail('FRAME_CHANGED');}catch(e){return fail(e.message);}
  }else if(hit.ownerDocument!==document||['iframe','frame'].includes(hit.localName))return fail('DRAG_TARGET_UNSUPPORTED');
  if(show){try{const ui=globalThis.__brodexPointer;if(ui){clearTimeout(ui.timer);ui.motion?.cancel();ui.target.style.display='none';ui.cursor.style.display='block';ui.cursor.style.transform='translate('+args.x+'px,'+args.y+'px)';ui.position={x:args.x,y:args.y};ui.labelNode.textContent='Brodex · Перетаскивание — ЛКМ зажата';const line=ui.trail.querySelector('line');line.setAttribute('x2',String(args.x));line.setAttribute('y2',String(args.y));ui.trail.style.display='block';}}catch{}}
  return {valid:true};
 }
 if(args.action==='validate_visual'){
  if(viewportChanged)return fail('STALE_SCREENSHOT: viewport changed; capture again');
  if(s.revision||s.observer.takeRecords().some(s.isPageMutation||(()=>true)))return fail('STALE_SCREENSHOT: document mutated; capture again');
  return {valid:true};
 }
 if(args.action==='scroll'&&!args.element_id){
  await point(innerWidth-65,Math.round(innerHeight/2),null,(args.delta_y||0)<0?'Прокрутка ↑':'Прокрутка ↓');
  if(location.href!==args.expected_url)return fail('PAGE_CHANGED');
  const before={x:scrollX,y:scrollY};window.scrollBy({left:args.delta_x||0,top:args.delta_y||0,behavior:'instant'});
  finish('Прокрутка отправлена');
  return {dispatched:true,before,after:{x:scrollX,y:scrollY}};
 }
 let el;
 if(args.action==='coordinate_target'){
  if(viewportChanged)return fail('STALE_SCREENSHOT: viewport changed; capture again');
  if(args.target_aware!==true&&!scopedExecution){if(s.revision||s.observer.takeRecords().some(s.isPageMutation||(()=>true)))return fail('STALE_SCREENSHOT: document mutated; capture again');}
  if(!Number.isFinite(args.x)||!Number.isFinite(args.y)||args.x<0||args.y<0||args.x>=innerWidth||args.y>=innerHeight)return fail('COORDINATES_OUTSIDE_VIEWPORT');
  el=dom.hit(args.x,args.y);
  if(!el)return fail('NO_ELEMENT_AT_POINT');
  if(args.target_aware===true){const error=targetGuard(el,args.x,args.y);if(error)return fail(error);}
  if(['iframe','frame'].includes(el.localName)){
   if(args.allow_iframe!==true||args.file_chooser)return fail('FRAME_ACTION_UNSUPPORTED');
   try{frameToken(el);}catch(e){return fail(e.message);}
  }
 }else{
  const ref=s.refs.get(args.element_id);el=ref?.el;
  if(ref&&['click','fill','select','set_checked','hover'].includes(args.action)){const error=s.checkDomContext(ref,'initial');if(error)return fail(error);}
  if(!el||!dom.connected(el)||!(s.matchesRef?s.matchesRef(ref):ref.signature===el.outerHTML))return fail('STALE_ELEMENT: read_page again');
 }
 if(args.action_context!==undefined){
  const c=args.action_context,identity=s.refs.get(args.element_id)?.auditIdentity;
  if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['kind','name','expected_effect'].includes(k))||!['click','fill','select','set_checked','hover'].includes(args.action)||!['navigate','open_dialog','change_selection','edit_field','submit','delete','other'].includes(c.expected_effect)||typeof c.kind!=='string'||c.kind.length>40||(c.name!==undefined&&(typeof c.name!=='string'||c.name.length>250)))return fail('INVALID_ACTION_CONTEXT');
  if(!identity||c.kind!==identity.kind||(c.name!==undefined&&c.name!==identity.name))return fail('ACTION_CONTEXT_MISMATCH');
 }
 const labelRef=args.action==='coordinate_target'?null:s.refs.get(args.element_id);
 const domMutation=['click','fill','select','set_checked','hover'].includes(args.action);
 const labelControl=labelRef?.labelControl;
 function labelGuard(){
  if(!labelControl)return null;
  if(!dom.connected(labelRef.labelElement)||labelRef.labelElement.control!==labelControl||!(el===labelRef.labelElement||dom.contains(labelRef.labelElement,el)&&dom.contains(el,labelControl))||!dom.connected(labelControl)||labelControl.outerHTML!==labelRef.controlSignature||labelControl.checked!==labelRef.controlChecked||labelControl.indeterminate!==labelRef.controlIndeterminate)return 'STALE_ELEMENT: read_page again';
  if(labelControl.matches(':disabled')||labelControl.disabled||labelControl.getAttribute('aria-disabled')==='true'||dom.closest(labelControl,'[inert]'))return 'ELEMENT_DISABLED';
  return null;
 }
 const labelError=labelGuard();if(labelError)return fail(labelError);
 // Only the dedicated file-chooser operation may target a transparent native
 // input inside a visible, labelled container. Ordinary clicks stay unchanged.
 const transparentFile=args.action==='coordinate_target'&&args.file_chooser===true&&el.localName==='input'&&el.type==='file'&&Number(dom.style(el).opacity)===0;
 if(transparentFile){
  const parent=dom.parent(el),box=parent?.getBoundingClientRect();
  if(!parent||['body','html'].includes(parent.localName)||!parent.innerText.trim()||!box?.width||!box.height||args.x<box.left||args.x>=box.right||args.y<box.top||args.y>=box.bottom||el.multiple||el.webkitdirectory)return fail('FILE_CONTROL_CONTAINER_UNSUPPORTED');
 }
 for(let p=el;p;p=dom.parent(p)){const style=dom.style(p);if(p.hidden||p.inert||style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||(Number(style.opacity)===0&&!(transparentFile&&p===el)))return fail('ELEMENT_NOT_VISIBLE');}
 if(el.disabled||el.matches(':disabled')||el.getAttribute('aria-disabled')==='true')return fail('ELEMENT_DISABLED');
 if(args.action==='scroll'){
  await point(innerWidth-65,Math.round(innerHeight/2),null,'Прокрутка к элементу');
  if(location.href!==args.expected_url||!dom.connected(el))return fail('PAGE_CHANGED');
  el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});finish('Прокрутка отправлена');return {dispatched:true};
 }
 if(args.action==='fill'){
  if((!['input','textarea'].includes(el.localName)&&!(el.isContentEditable&&!dom.parent(el)?.isContentEditable))||el.readOnly||el.getAttribute('aria-readonly')==='true')return fail('ELEMENT_NOT_EDITABLE');
  if(el.localName==='input'&&!['text','search','email','url','tel','number','password'].includes(el.type))return fail('INPUT_TYPE_UNSUPPORTED');
 }
 const fragments=args.action==='coordinate_target'?contentsRects(el):null;
 const r=fragments?fragments.find(r=>args.x>=r.left&&args.x<r.right&&args.y>=r.top&&args.y<r.bottom):dom.rect(el);
 if(!r)return fail('STALE_SCREENSHOT: PREPARED_POINT_OUTSIDE_RENDERED_CONTENT');
 if(!r.width||!r.height||r.bottom<=0||r.right<=0||r.top>=innerHeight||r.left>=innerWidth)return fail('ELEMENT_OUTSIDE_VIEWPORT: scroll to element, then read_page');
 const x=Math.max(0,r.left)+(Math.min(innerWidth,r.right)-Math.max(0,r.left))/2,y=Math.max(0,r.top)+(Math.min(innerHeight,r.bottom)-Math.max(0,r.top))/2;
 const hit=dom.hit(x,y);
 if(args.action!=='coordinate_target'&&hit!==el&&!dom.contains(el,hit))return fail('ELEMENT_OCCLUDED: handle the covering dialog first');
 const link=dom.closest(el,'a[href]');
 if(link){const kind=linkKind(link.getAttribute('href')?.trim().toLowerCase().startsWith('javascript:')?link.getAttribute('href'):link.href);if(!['http','inert_javascript'].includes(kind))return fail('LINK_URL_NOT_SUPPORTED: '+kind);}
 await point(args.action==='coordinate_target'?args.x:x,args.action==='coordinate_target'?args.y:y,r,{hover:'Наведение…',click:'Нажатие…',fill:'Ввод текста…',select:'Выбор значения…',set_checked:'Переключатель…',coordinate_target:'Нажатие…'}[args.action]||'Действие…');
 // The target may move or a dialog may appear during the short pointer animation.
 if(domMutation){const error=s.checkDomContext(labelRef,'recheck');if(error)return fail(error);}
 const again=dom.hit(args.action==='coordinate_target'?args.x:x,args.action==='coordinate_target'?args.y:y);
 const ref=args.action==='coordinate_target'?null:s.refs.get(args.element_id);
 if(location.href!==args.expected_url||!dom.connected(el)||ref&&!(s.matchesRef?s.matchesRef(ref):ref.signature===el.outerHTML)||again!==el&&!dom.contains(el,again)){
  finish('Цель изменилась',true);return fail('STALE_ELEMENT: read_page again');
 }
 if(el.matches(':disabled')||el.getAttribute('aria-disabled')==='true'){finish('Недоступно',true);return fail('ELEMENT_DISABLED');}
 if(labelControl){const now=dom.rect(el);if([now.x,now.y,now.width,now.height].some((v,i)=>Math.abs(v-[r.x,r.y,r.width,r.height][i])>0.5)){finish('Цель переместилась',true);return fail('STALE_ELEMENT: target moved');}}
 const finalLabelError=labelGuard();if(finalLabelError){finish('Цель изменилась',true);return fail(finalLabelError);}
 if(args.action==='validate_file'){
  if(el.localName!=='input'||el.type!=='file')return fail('NOT_FILE_INPUT');
  if(!scopedExecution&&(s.revision||s.observer.takeRecords().some(s.isPageMutation)))return fail('STALE_ELEMENT: read_page again');
  if(el.webkitdirectory)return fail('DIRECTORY_UPLOAD_UNSUPPORTED');
  return {index:[...dom.query(document,'input[type="file"]')].indexOf(el),point:{x,y},embedded:el.ownerDocument!==document||el.getRootNode()!==document};
 }
 if(args.action==='coordinate_target'){if(args.target_aware===true){const error=targetGuard(el,args.x,args.y);if(error){finish('Цель изменилась',true);return fail(error);}}else if(!scopedExecution&&(s.revision||s.observer.takeRecords().some(s.isPageMutation))||s.width!==innerWidth||s.height!==innerHeight||s.scrollX!==scrollX||s.scrollY!==scrollY){finish('Снимок устарел',true);return fail('STALE_SCREENSHOT: capture again');}return {valid:true,frame_token:targetFrameToken(el)};}
 if(args.action==='hover'){
  const now=dom.rect(el);
  if([now.x,now.y,now.width,now.height].some((v,i)=>Math.abs(v-[r.x,r.y,r.width,r.height][i])>0.5))return fail('STALE_ELEMENT: target moved');
  return {valid:true,x,y,ignored_changes:s.domIgnored||[]};
 }
 if(args.action==='click'){
  // Custom widgets can activate on pointerdown/up or require trusted input.
  // Return a guarded DOM-derived target; never synthesize and then retry a click.
  return {ignored_changes:s.domIgnored||[],pointer_click_required:true,x,y};}
 if(args.action==='set_checked'){
  const checkTarget=labelControl||el;
  const native=checkTarget.localName==='input'&&['checkbox','radio'].includes(checkTarget.type);
  if(!native&&!['checkbox','switch','radio'].includes(el.getAttribute('role')))return fail('ELEMENT_NOT_CHECKABLE');
  if(native&&checkTarget.indeterminate||!native&&!['true','false'].includes(el.getAttribute('aria-checked')))return fail('CHECK_STATE_UNKNOWN');
  const before=native?checkTarget.checked:el.getAttribute('aria-checked')==='true';
  if(before!==args.checked)el.click();
  finish(before!==args.checked?'Переключение отправлено':'Уже установлено');
  return {ignored_changes:s.domIgnored||[],dispatched:before!==args.checked,checked:native?checkTarget.checked:el.getAttribute('aria-checked')==='true',matches_requested:(native?checkTarget.checked:el.getAttribute('aria-checked')==='true')===args.checked};
 }
 if(args.action==='fill'){
  if((!['input','textarea'].includes(el.localName)&&!(el.isContentEditable&&!dom.parent(el)?.isContentEditable))||el.readOnly||el.getAttribute('aria-readonly')==='true')return fail('ELEMENT_NOT_EDITABLE');
  if(el.localName==='input'&&!['text','search','email','url','tel','number','password'].includes(el.type))return fail('INPUT_TYPE_UNSUPPORTED');
  if(el.isContentEditable){
   // Editing hosts only; nested noneditable widgets must never be overwritten.
   if(el.querySelector('[contenteditable="false"],input,textarea,select,button,iframe,canvas,video'))return fail('EDITOR_COMPLEX_CONTENT_UNSUPPORTED');
   if(dom.activeElement()!==el)return fail('EDITOR_FOCUS_REQUIRED: focus editor, then read_page');
   const selection=el.ownerDocument.defaultView.getSelection();if(!selection)return fail('EDITOR_SELECTION_UNAVAILABLE');
   const range=el.ownerDocument.createRange();range.selectNodeContents(el);
   if(args._verify_editor){
    if(selection.rangeCount!==1)return fail('EDITOR_SELECTION_CHANGED');
    const selected=selection.getRangeAt(0);
    if(selected.startContainer!==range.startContainer||selected.endContainer!==range.endContainer||selected.startOffset!==range.startOffset||selected.endOffset!==range.endOffset)return fail('EDITOR_SELECTION_CHANGED');
   }else{selection.removeAllRanges();selection.addRange(range);}
   return {ignored_changes:s.domIgnored||[],editor_input_required:true,dispatched:false};
  }
  el.focus();
  const proto=el.localName==='textarea'?el.ownerDocument.defaultView.HTMLTextAreaElement.prototype:el.ownerDocument.defaultView.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el,args.text);
  el.dispatchEvent(new el.ownerDocument.defaultView.InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:args.text}));el.dispatchEvent(new el.ownerDocument.defaultView.Event('change',{bubbles:true}));
  finish(el.value===args.text?'Текст введён':'Ввод не подтверждён',el.value!==args.text);
  return {ignored_changes:s.domIgnored||[],dispatched:true,value_matches:el.value===args.text};
 }
 if(args.action==='select'){
  if(el.localName!=='select'||el.multiple)return fail('SINGLE_SELECT_REQUIRED');
  const option=Array.from(el.options).find(o=>o.value===args.value);
  if(!option||option.disabled||dom.parent(option)?.disabled)return fail('OPTION_NOT_AVAILABLE');
  el.value=args.value;el.dispatchEvent(new el.ownerDocument.defaultView.Event('input',{bubbles:true}));el.dispatchEvent(new el.ownerDocument.defaultView.Event('change',{bubbles:true}));
  finish(el.value===args.value?'Значение выбрано':'Выбор не подтверждён',el.value!==args.value);
  return {ignored_changes:s.domIgnored||[],dispatched:true,value_matches:el.value===args.value};
 }
 return fail('ACTION_UNSUPPORTED');
}









