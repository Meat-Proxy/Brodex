// Pure protocol policy. No page objects, input, persistence or site-specific rules.
const brodexActionPolicy = (() => {
 const methods = ['dom', 'dom_pointer', 'coordinate'];
 const operations = {
  dom: ['activate', 'set_checked', 'select', 'fill', 'focus', 'scroll_into_view'],
  dom_pointer: ['click', 'hover', 'set_checked', 'insert_text', 'press_key', 'scroll_into_view'],
  coordinate: ['click', 'hover', 'wheel', 'insert_text', 'press_key']
 };
 const id = v => typeof v === 'string' && /^[a-zA-Z0-9:_-]{1,200}$/.test(v);
 const object = v => v && typeof v === 'object' && !Array.isArray(v);
 function keys(v, allowed) { if (!object(v) || Object.keys(v).some(k => !allowed.includes(k))) throw Error('V2_INVALID_ARGUMENTS'); }
 function validateAction(a) {
  keys(a, ['method', 'operation', 'target', 'parameters', 'context']);
  if (!methods.includes(a.method) || !operations[a.method].includes(a.operation)) throw Error('V2_OPERATION_UNSUPPORTED');
  keys(a.target, a.method === 'coordinate' ? ['x', 'y'] : ['element_id','catalog_target']);
  if (a.method === 'coordinate') { if (![a.target.x,a.target.y].every(Number.isFinite)) throw Error('V2_INVALID_POINT'); }
  else if(a.target.catalog_target!==undefined){keys(a.target.catalog_target,['observation_id','ref']);if(a.target.element_id!==undefined||!id(a.target.catalog_target.observation_id)||!id(a.target.catalog_target.ref))throw Error('V2_INVALID_TARGET');}
  else if (!id(a.target.element_id)) throw Error('V2_INVALID_TARGET');
  const params = a.parameters || {};
  const fields = {activate:[],click:['button'],hover:[],set_checked:['checked'],select:['value'],fill:['text'],focus:[],scroll_into_view:[],insert_text:['text'],press_key:['key'],wheel:['delta_x','delta_y']}[a.operation];
  keys(params,fields);
  if (a.operation === 'set_checked' && typeof params.checked !== 'boolean') throw Error('V2_INVALID_CHECKED');
  if (['fill','insert_text'].includes(a.operation) && (typeof params.text !== 'string' || params.text.length > 100000)) throw Error('V2_INVALID_TEXT');
  if (a.operation === 'select' && (typeof params.value !== 'string' || params.value.length > 10000)) throw Error('V2_INVALID_VALUE');
  if (a.operation === 'press_key' && !['Enter','Tab','Escape','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Backspace','Delete','Home','End'].includes(params.key)) throw Error('V2_KEY_UNSUPPORTED');
  if (params.button !== undefined && !['left','right','middle'].includes(params.button)) throw Error('V2_INVALID_BUTTON');
  if (a.operation === 'wheel' && (![params.delta_x || 0,params.delta_y || 0].every(v=>Number.isInteger(v)&&Math.abs(v)<=10000) || !(params.delta_x||params.delta_y))) throw Error('V2_INVALID_WHEEL');
  if (a.context !== undefined) {
   keys(a.context,['element_ids','regions']);
   if (a.context.element_ids !== undefined && (!Array.isArray(a.context.element_ids)||a.context.element_ids.length>32||!a.context.element_ids.every(id))) throw Error('V2_INVALID_CONTEXT');
   if (a.context.regions !== undefined && (!Array.isArray(a.context.regions)||a.context.regions.length>8||a.context.regions.some(r=>!object(r)||Object.keys(r).some(k=>!['x','y','width','height'].includes(k))||![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0))) throw Error('V2_INVALID_REGIONS');
  }
  if (a.method==='coordinate'&&!a.context?.regions?.length) throw Error('V2_REGIONS_REQUIRED');
  return a;
 }
 function allowances(list, report) {
  if (!Array.isArray(list)||list.length>256) throw Error('V2_INVALID_EXCEPTIONS');
  const seen=new Set();
  return list.map(rule=>{
   keys(rule,['object_ref','property','constraint']);
   const key=rule.object_ref+'|'+rule.property;
   if(seen.has(key)) throw Error('V2_DUPLICATE_EXCEPTION'); seen.add(key);
   const change=report.changes.find(c=>c.object_ref===rule.object_ref&&c.property===rule.property);
   if(!change||!change.exception_allowed) throw Error('V2_EXCEPTION_NOT_IN_REPORT');
   const c=rule.constraint||{kind:'any'};
   if(!object(c)) throw Error('V2_INVALID_CONSTRAINT');
   if(c.kind==='any') keys(c,['kind']);
   else if(c.kind==='one_of') {keys(c,['kind','values']);if(!Array.isArray(c.values)||!c.values.length||c.values.length>32||c.values.some(v=>!['string','number','boolean'].includes(typeof v)&&v!==null))throw Error('V2_INVALID_CONSTRAINT');}
   else if(c.kind==='range') {keys(c,['kind','min','max','unit']);if(!Number.isFinite(c.min)||!Number.isFinite(c.max)||c.min>c.max||!['','px','%'].includes(c.unit??''))throw Error('V2_INVALID_CONSTRAINT');}
   else throw Error('V2_INVALID_CONSTRAINT');
   return {object_ref:rule.object_ref,property:rule.property,constraint:structuredClone(c)};
  });
 }
 function accepts(rule,value) {
  const c=rule.constraint;
  if(c.kind==='any')return true;
  if(c.kind==='one_of')return c.values.some(v=>Object.is(v,value));
  const unit=c.unit||'',s=String(value),m=s.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))(px|%)?$/);
  return !!m&&(m[2]||'')===unit&&Number(m[1])>=c.min&&Number(m[1])<=c.max;
 }
 return {methods,operations,validateAction,allowances,accepts,keys,id};
})();
if(typeof module!=='undefined')module.exports=brodexActionPolicy;
