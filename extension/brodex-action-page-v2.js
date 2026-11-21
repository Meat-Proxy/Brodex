// Fixed isolated-world adapter. References and exact baselines never leave page memory.
async function brodexActionPageV2(a) {
 const root=globalThis;
 function hidePointer(){clearTimeout(root.__brodexV2PointerTimer);root.__brodexV2PointerTimer=null;root.__brodexV2PointerHost?.remove();root.__brodexV2PointerHost=null;}
 if(['prepare','finish','dispose','hide'].includes(a.phase)||a.show===false)hidePointer();
 const uuid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
 if(a.phase==='finish'){const old=root.__brodexActionV2;if(old){clearTimeout(old.timer);old.observers?.forEach(o=>o.disconnect());root.__brodexActionV2=null;}return {released:true};}
 if(a.phase==='dispose'){root.__brodexActionV2?.observers?.forEach(o=>o.disconnect());clearTimeout(root.__brodexActionV2?.timer);root.__brodexActionV2?.ui?.remove();root.__brodexActionV2=null;return {disposed:true};}
 const s=root.__brodexSnapshot;
 const error=code=>({error:code});
 if(location.href!==a.expected_url)return error('V2_DOCUMENT_CHANGED');
 if(a.phase==='prepare'&&(!s||s.id!==a.snapshot_id||Date.now()-s.created>60000))return error('V2_OBSERVATION_EXPIRED');
 let p=root.__brodexActionV2;
 const dom=a.phase==='prepare'?s.tree:p?.dom;
 if(!dom)return error('V2_CONTROL_UNAVAILABLE');
 const connected=n=>n&&dom.connected(n),parent=n=>dom.parent(n);
 root.__brodexV2UiNodes??=new WeakSet();
 const own=n=>n!==root.__brodexPointer?.host&&!root.__brodexV2UiNodes.has(n);
 const viewport=()=>({width:innerWidth,height:innerHeight,scroll_x:scrollX,scroll_y:scrollY,scale:visualViewport?.scale||1});
 const equal=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
 const rect=n=>{const r=dom.rect(n);return {x:r.x,y:r.y,width:r.width,height:r.height};};
 const styles=['display','visibility','opacity','pointerEvents','transform','position','zIndex','overflow','contentVisibility','overflowX','overflowY','clip','clipPath','filter','backdropFilter','zoom','color','backgroundColor','fontSize','fontFamily','fontWeight','lineHeight','whiteSpace','direction','writingMode','cursor','userSelect','width','height','minWidth','maxWidth','minHeight','maxHeight','padding','margin','borderWidth','borderRadius','outline','boxShadow','textDecoration','transition','animation'];
 const oldStyles=styles.slice(0,9);
 const prop=k=>k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase());
 const editable=n=>['input','textarea','select'].includes(n.localName)||n.isContentEditable;
 const valueField=k=>k==='state.value'||k==='attributes.value'||k==='state.selection'||k==='text'&&p?.sensitive;
 function ref(n){if(!p.ids.has(n))p.ids.set(n,'object-'+(++p.seq));return p.ids.get(n);}
 function attributes(f,pairs){for(const [k,v] of pairs){if(k==='style'){const style=document.createElement('div').style;style.cssText=v;for(const key of style)f['inline-style.'+key]=style.getPropertyValue(key)+' '+style.getPropertyPriority(key);}else f['attributes.'+k]=v;}}
 function fields(n){
  const f={},r=rect(n),c=dom.style(n);
  for(const k of styles)f['style.'+prop(k)]=k==='transform'&&/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(c[k])?'none':c[k];
  for(const k of ['x','y','width','height'])f['geometry.'+k]=r[k];
  attributes(f,Array.from(n.attributes,a=>[a.name,a.value]));
  f.text=editable(n)?null:Array.from(n.childNodes).filter(n=>n.nodeType===3).map(n=>n.nodeValue).join('');
  f['state.value']=n.value??null;f['state.checked']=n.checked??null;f['state.indeterminate']=n.indeterminate??null;
  f['state.selectedIndex']=n.selectedIndex??null;f['state.disabled']=n.matches(':disabled');f['state.inert']=!!n.inert;
  f['state.scrollLeft']=n.scrollLeft;f['state.scrollTop']=n.scrollTop;
  f['structure.parent']=parent(n)?ref(parent(n)):null;
  f['structure.children']=dom.children(n).filter(own).map(ref);
  for(const pseudo of ['::before','::after']){const cs=dom.style(n,pseudo);for(const k of ['content','display','visibility','opacity','transform','width','height','position','pointerEvents'])f['pseudo.'+pseudo+'.'+prop(k)]=cs[k];}
  return {node:n,fields:f,bounds:r};
 }
 function fromLegacy(n,e){
  const f={},attrs=JSON.parse(e.identity||e.attrs||'[[],[]]');
  attributes(f,attrs[0]);
  if(!editable(n))f.text=attrs[1].join('');
  (e.style||'').split('|').forEach((v,i)=>{if(oldStyles[i])f['style.'+prop(oldStyles[i])]=oldStyles[i]==='transform'&&v==='matrix(1, 0, 0, 1, 0, 0)'?'none':v;});
  if(e.rect)['x','y','width','height'].forEach((k,i)=>f['geometry.'+k]=e.rect[i]);
  if(e.state){const st=JSON.parse(e.state);['value','checked','indeterminate','selectedIndex','disabled','inert'].forEach((k,i)=>f['state.'+k]=st[i]);}
  f['structure.parent']=e.parent?ref(e.parent):null;
  if(e.children)f['structure.children']=e.children.filter(own).map(ref);
  return {node:n,fields:f,bounds:e.rect?Object.fromEntries(['x','y','width','height'].map((k,i)=>[k,e.rect[i]])):null};
 }
 function collect(){
  const map=new Map(),queue=[...p.roots],start=performance.now();let chars=0;
  while(queue.length){const n=queue.shift();if(n.nodeType!==1||!connected(n)||!own(n)||map.has(n)||['script','style','template'].includes(n.localName))continue;
   if(map.size>=512||performance.now()-start>250)throw Error('V2_CONTEXT_LIMIT');
   if(dom.unsupported(n))throw Error('V2_CONTEXT_UNSUPPORTED');
   const e=fields(n);chars+=JSON.stringify(e.fields).length;if(chars>2000000)throw Error('V2_CONTEXT_LIMIT');map.set(n,e);
   queue.push(...dom.children(n).filter(own));
  }
  for(const ancestor of p.ancestors){if(!connected(ancestor))throw Error('V2_ANCESTOR_LOST');if(!map.has(ancestor))map.set(ancestor,fields(ancestor));}
  return map;
 }
 function remember(records){
  for(const r of records){
   const n=r.target.nodeType===3?parent(r.target):r.target;
   if(!p.baseline.has(n)||!own(n))continue;
   if(r.type==='childList'&&![...r.addedNodes,...r.removedNodes].some(own))continue;
   if(p.history.length>=512||(p.historyBytes+=(r.oldValue?.length||0))>2000000){p.historyOverflow=true;continue;}
   p.history.push(r);
   if(r.type==='childList'&&[...r.removedNodes].some(x=>x===p.target||x.nodeType===1&&dom.contains(x,p.target)))p.targetDetached=true;
  }
 }
 function historyDiff(d){
  for(const observer of p.observers||[])remember(observer.takeRecords());
  const groups=new Map();
  for(const r of p.history||[]){
   const n=r.target.nodeType===3?parent(r.target):r.target;
   const property=r.type==='attributes'?'attributes.'+r.attributeName:r.type==='characterData'?'text.mutation':'structure.mutation';
   const key=ref(n)+'|'+property;
   if(!groups.has(key))groups.set(key,{n,property,records:[]});groups.get(key).records.push(r);
  }
  for(const {n,property,records} of groups.values()){
   // oldValue of the next mutation preserves an intermediate value even when
   // the final value equals the baseline. Never imply sampled computed CSS.
   const values=records.map(r=>r.oldValue);
   const last=records[records.length-1];values.push(last.type==='attributes'?n.getAttribute(last.attributeName):last.type==='characterData'?last.target.nodeValue:null);
   if(property==='attributes.style'){
    const states=values.map(v=>{const f={};attributes(f,[['style',v||'']]);return f;});
    for(const k of new Set(states.flatMap(Object.keys)))for(let i=1;i<states.length;i++)if(!equal(states[i-1][k]??null,states[i][k]??null))add(k,states[i-1][k]??null,states[i][k]??null);
   }else if(property==='structure.mutation')add(property,null,null);
   else for(let i=1;i<values.length;i++)if(!equal(values[i-1],values[i]))add(property,values[i-1],values[i]);
   function add(k,b,v){d.total++;if(d.changes.length<256)d.changes.push({change_id:'change-'+d.total,object_ref:ref(n),property:k,before:valueField(k)||k==='text.mutation'?'[omitted]':b,after:valueField(k)||k==='text.mutation'?'[omitted]':v,exception_allowed:k!=='structure.mutation',bounds:p.baseline.get(n)?.bounds,internal_value:v,transient:true});}
  }
  d.complete=d.total<=256&&!p.historyOverflow;
 }
 function observe(){
  p.history=[];p.historyBytes=0;p.historyOverflow=false;p.observers=[];
  const roots=new Set([...p.baseline.keys()].map(n=>n.getRootNode()));
  for(const node of roots){const observer=new MutationObserver(remember);observer.observe(node,{subtree:true,childList:true,attributes:true,attributeOldValue:true,characterData:true,characterDataOldValue:true});p.observers.push(observer);}
 }
 function diff(before,after,partial=false){
  const changes=[];let total=0;
  const add=(n,k,b,v,bounds)=>{total++;if(changes.length<256)changes.push({change_id:'change-'+total,object_ref:ref(n),property:k,before:valueField(k)?'[omitted]':b,after:valueField(k)?'[omitted]':v,exception_allowed:!['structure.attached','structure.parent','structure.children'].includes(k),bounds,internal_value:v});};
  for(const [n,old] of before){const now=after.get(n);if(!now){add(n,'structure.attached',true,false,old.bounds);continue;}
   const keys=partial?new Set([...Object.keys(old.fields),...Object.keys(now.fields).filter(k=>k.startsWith('attributes.')||k.startsWith('inline-style.'))]):new Set([...Object.keys(old.fields),...Object.keys(now.fields)]);
   for(const k of keys){const b=old.fields[k]??null,v=now.fields[k]??null;if(!equal(b,v))add(n,k,b,v,now.bounds);}
  }
  if(!partial)for(const [n,now] of after)if(!before.has(n))add(n,'structure.attached',false,true,now.bounds);
  return {changes,total,complete:total<=256};
 }
 function hitPoint(n){
  const r=rect(n),left=Math.max(0,r.x),top=Math.max(0,r.y),right=Math.min(innerWidth,r.x+r.width),bottom=Math.min(innerHeight,r.y+r.height);
  if(right<=left||bottom<=top)return null;
  for(const [fx,fy] of [[.5,.5],[.2,.2],[.8,.2],[.2,.8],[.8,.8]]){const point={x:left+(right-left)*fx,y:top+(bottom-top)*fy},h=dom.hit(point.x,point.y);if(h===n||dom.contains(n,h))return point;}
  return null;
 }
 function blockers(){
  const out=[],add=code=>out.push({code,object_ref:ref(p.target)}),op=p.action.operation;
  if(p.targetDetached)add('TARGET_DETACHED_DURING_CONTROL');
  if(!connected(p.target)){add('TARGET_LOST');return out;}
  if(p.document!==p.target.ownerDocument){add('DOCUMENT_CHANGED');return out;}
  if(p.action.method==='coordinate'&&!equal(p.viewport,viewport()))add('COORDINATE_BASIS_CHANGED');
  if(p.action.method==='coordinate'){const h=dom.hit(p.point.x,p.point.y);if(h!==p.target&&!dom.contains(p.target,h))add('HIT_TARGET_CHANGED');}
  if(op!=='scroll_into_view'){
   for(let n=p.target;n;n=parent(n)){const c=dom.style(n);if(n.inert||n.hidden||c.display==='none'||c.visibility!=='visible'||Number(c.opacity)===0){add('TARGET_NOT_VISIBLE_OR_INERT');break;}}
   if(!['hover','wheel'].includes(op)&&(p.target.matches(':disabled')||p.target.getAttribute('aria-disabled')==='true'))add('TARGET_DISABLED');
   const point=hitPoint(p.target);if(!point)add('TARGET_OUTSIDE_OR_OCCLUDED');
   // Semantic activation still cannot click through a blocking surface. No viewport requirement for explicit focus.
   if(point&&p.action.method!=='coordinate')p.point=point;
  }
  if(['insert_text','press_key'].includes(op)&&dom.activeElement()!==p.target)add('FOCUS_CHANGED');
  if(['fill','insert_text'].includes(op)&&(p.target.readOnly||p.target.getAttribute('aria-readonly')==='true'||!(['input','textarea'].includes(p.target.localName)||p.target.isContentEditable)))add('NOT_EDITABLE');
  if(op==='fill'&&!['input','textarea'].includes(p.target.localName))add('PROGRAMMATIC_EDITOR_UNSUPPORTED');
  if(['fill','insert_text'].includes(op)&&p.target.type==='password')add('SENSITIVE_INPUT_UNSUPPORTED');
  if(op==='set_checked'&&(!p.target.matches('input[type="checkbox"],input[type="radio"]')||p.target.indeterminate))add('CHECK_STATE_UNSUPPORTED');
  if(op==='set_checked'&&p.target.type==='radio'&&p.action.parameters.checked===false)add('RADIO_UNCHECK_UNSUPPORTED');
  if(op==='select'&&(p.target.localName!=='select'||p.target.multiple||!Array.from(p.target.options).some(o=>o.value===p.action.parameters.value&&!o.disabled&&!o.parentElement?.disabled)))add('OPTION_UNAVAILABLE');
  return out;
 }
 function publicReport(d,phase,b){
  const report={report_id:uuid(),phase,changes:d.changes.map(({internal_value,...c})=>c),blockers:b,coverage:{complete:d.complete,changes_total:d.total,returned_changes:d.changes.length,node_count:p.baseline?.size||0,node_limit:512,scope:'selected_context_and_ancestors',style_properties:styles.map(prop),closed_shadow_roots:'not_detectable',transient_changes:'DOM_mutation_history; computed_style_endpoints_only'}};
  if(!d.complete)report.blockers.push({code:'CHANGE_REPORT_INCOMPLETE'});
  p.report=report;return report;
 }
 function ui(kind,regions){
  if(!a.show)return;
  p.ui?.remove();clearTimeout(p.uiTimer);
  const host=document.createElement('div');host.setAttribute('aria-hidden','true');host.style.cssText='position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important';
  p.ui=host;root.__brodexV2UiNodes.add(host);const shadow=host.attachShadow({mode:'closed'});
  for(const r of regions){const el=document.createElement('div');el.style.cssText=`position:fixed;pointer-events:none;box-sizing:border-box;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;border:2px solid ${kind==='error'?'#ef4444':'#22d3ee'};`;shadow.append(el);}
  document.documentElement.append(host);p.uiTimer=setTimeout(()=>host.remove(),kind==='error'?1000:500);
 }
 function result(report){return {report,point:p.point,regions:p.regions,viewport:viewport(),target:{object_ref:ref(p.target),tag:p.target.localName,checked:p.target.checked??null},baseline_id:p.baselineId};}
 if(a.phase==='prepare'){
  if(a.overviewViewport&&['width','height','scroll_x','scroll_y'].some(k=>a.overviewViewport[k]!==viewport()[k]))return error('V2_COORDINATE_BASIS_CHANGED');
  clearTimeout(p?.timer);p?.observers?.forEach(o=>o.disconnect());p?.ui?.remove();
  p={id:a.preparation_id,dom,action:a.action,ids:new Map(),seq:0,roots:[],ancestors:[],viewport:viewport(),created:Date.now(),document:document,baselineId:uuid()};root.__brodexActionV2=p;
  p.action.parameters??={};p.sensitive=['fill','insert_text'].includes(p.action.operation);
  p.timer=setTimeout(()=>{if(root.__brodexActionV2===p){p.observers?.forEach(o=>o.disconnect());p.ui?.remove();root.__brodexActionV2=null;}},300000);
  const chosen=a.action.method==='coordinate'?dom.hit(a.action.target.x,a.action.target.y):s.refs.get(a.action.target.element_id)?.el;
  if(!connected(chosen))return error('V2_TARGET_UNAVAILABLE');p.target=chosen;p.document=chosen.ownerDocument;p.point=a.action.method==='coordinate'?a.action.target:hitPoint(chosen);
  const baseline=new Map();
  const refs=[...new Set([...(a.action.method==='coordinate'?[]:[a.action.target.element_id]),...(a.action.context?.element_ids||[])])];
  for(const id of refs){const r=s.refs.get(id);if(!r||!connected(r.el))return error('V2_CONTEXT_TARGET_UNAVAILABLE');if(r.context?.error)return error(r.context.error);
   const nodes=r.context?.nodes;if(nodes?.size){p.roots.push(nodes.keys().next().value);for(const [n,e] of nodes)baseline.set(n,fromLegacy(n,e));for(const [n,e] of r.context.ancestors){p.ancestors.push(n);baseline.set(n,fromLegacy(n,e));}}
   else p.roots.push(r.el);
  }
  if(s.catalogTarget===chosen&&s.catalogBaseline)baseline.set(chosen,fromLegacy(chosen,s.catalogBaseline));
  p.roots.push(chosen);
  if(a.action.method==='coordinate'){
   const owner=dom.closest(chosen,'button,a,input,select,textarea,label,[role="button"]')||chosen;p.target=owner;p.roots.push(owner);
   // Region traversal has a separate scan budget; never silently reduce selected context.
   const walk=dom.walker(document.documentElement,NodeFilter.SHOW_ELEMENT);let n,count=0;
   while(n=walk.nextNode()){if(++count>30000)return error('V2_REGION_SCAN_LIMIT');if(!own(n))continue;const r=rect(n);if(r.width&&r.height&&(a.action.context.regions||[]).some(z=>r.x>=z.x&&r.y>=z.y&&r.x+r.width<=z.x+z.width&&r.y+r.height<=z.y+z.height))p.roots.push(n);if(p.roots.length>512)return error('V2_CONTEXT_LIMIT');}
  }
  for(let n=parent(p.target);n;n=parent(n))p.ancestors.push(n);
  p.roots=[...new Set(p.roots)];p.ancestors=[...new Set(p.ancestors)];
  try{p.baseline=collect();}catch(e){return error(e.message);}
  observe();
  p.regions=a.action.context?.regions?.length?a.action.context.regions:p.roots.map(rect).filter(r=>r.width>0&&r.height>0).slice(0,32);
  const d=diff(baseline,p.baseline,true),report=publicReport(d,'preparation',blockers());
  report.coverage.overview_comparison=baseline.size?'legacy_available_fields':'fresh_control_only';
  if(a.show)ui(report.blockers.length?'error':'prepared',report.blockers.length?[rect(p.target)]:p.regions);
  return result(report);
 }
 if(!p||p.id!==a.preparation_id||Date.now()-p.created>300000)return error('V2_CONTROL_EXPIRED');
 if(a.phase==='hide'){p.ui?.remove();return {hidden:true};}
 if(a.phase==='pointer'){
  if(a.show){
   hidePointer();
   const host=document.createElement('div');host.setAttribute('aria-hidden','true');
   host.style.cssText='all:initial!important;position:fixed!important;pointer-events:none!important;z-index:2147483647!important;width:22px!important;height:28px!important;';
   const shadow=host.attachShadow({mode:'closed'});
   shadow.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 22 28" style="pointer-events:none"><path d="M0 0L1 21L6 15L11 24L15 22L10 13L18 12Z" fill="#22d3ee" stroke="#052330" stroke-width="1"/></svg>';
   root.__brodexV2UiNodes.add(host);root.__brodexV2PointerHost=host;
   host.style.setProperty('left',p.point.x+'px','important');host.style.setProperty('top',p.point.y+'px','important');document.documentElement.append(host);
   // Independent of the preparation record: no stale pointer after a lost response.
   root.__brodexV2PointerTimer=setTimeout(()=>{if(root.__brodexV2PointerHost===host)hidePointer();},2200);
  }
  return {shown:!!a.show};
 }
 if(a.phase==='feedback'){ui(a.failed?'error':'prepared',a.regions?.length?a.regions:[rect(p.target)]);return {shown:!!a.show};}
 if(['inspect','rebase','guard'].includes(a.phase)){
  let current;try{current=collect();}catch(e){return error(e.message);}
  const d=diff(p.baseline,current);historyDiff(d);const b=blockers();
  if(a.phase==='guard'){
   for(const c of d.changes){const rule=(a.allowances||[]).find(r=>r.object_ref===c.object_ref&&r.property===c.property);let accepted=false;
    if(rule&&c.exception_allowed){const x=rule.constraint,v=c.internal_value;if(x.kind==='any')accepted=true;else if(x.kind==='one_of')accepted=x.values.some(z=>equal(z,v));else{const m=String(v).match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))(px|%)?$/);accepted=!!m&&(m[2]||'')===(x.unit||'')&&+m[1]>=x.min&&+m[1]<=x.max;}}
    c.allowed=accepted;
   }
  }
  const report=publicReport(d,a.phase,b);
  if(a.phase==='rebase'&&!b.length&&d.complete){p.baseline=current;p.baselineId=uuid();p.created=Date.now();p.history=[];p.historyOverflow=false;}
  const blocked=report.blockers.length>0||a.phase==='guard'&&report.changes.some(c=>!c.allowed);
  return {...result(report),blocked};
 }
 if(a.phase==='perform'){
  const control=await brodexActionPageV2({...a,phase:'guard'});
  if(control.error||control.blocked)return control;
  const b=blockers();if(b.length)return {blocked:true,report:publicReport({changes:[],total:0,complete:true},'dispatch',b)};
  const n=p.target,op=p.action.operation,v=p.action.parameters;
  // Main-world script evaluation is never used. All operations are fixed adapters.
  if(op==='set_checked'&&n.checked===v.checked)return {dispatch_state:'no_op',verification:{status:'confirmed',checked:n.checked}};
  let method='programmatic';
  if(op==='activate'||op==='set_checked')n.click();
  else if(op==='focus')n.focus({preventScroll:true});
  else if(op==='scroll_into_view')n.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  else if(op==='select'){n.value=v.value;n.dispatchEvent(new n.ownerDocument.defaultView.Event('input',{bubbles:true}));n.dispatchEvent(new n.ownerDocument.defaultView.Event('change',{bubbles:true}));}
  else if(op==='fill'){const w=n.ownerDocument.defaultView,proto=n.localName==='textarea'?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(n,v.text);n.dispatchEvent(new w.InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:v.text}));n.dispatchEvent(new w.Event('change',{bubbles:true}));}
  else return error('V2_PERFORM_UNSUPPORTED');
  return {dispatch_state:'sent',input_method:method,verification:{status:'unverified'}};
 }
 if(a.phase==='verify'){
  if(!connected(p.target))return {verification:{status:'unverified',reason:'target_replaced_after_dispatch'}};
  const n=p.target,op=p.action.operation,v=p.action.parameters;
  const match=op==='set_checked'?n.checked===v.checked:op==='fill'?n.value===v.text:op==='select'?n.value===v.value:op==='focus'?dom.activeElement()===n:null;
  return {verification:{status:match===null?'unverified':match?'confirmed':'not_confirmed',...(op==='set_checked'?{checked:n.checked}:{})}};
 }
 return error('V2_PHASE_UNSUPPORTED');
}
