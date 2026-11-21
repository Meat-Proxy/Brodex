// Bounded condition timing; caller-owned probes retain all context/permission guards.
const brodexTiming=(()=>{
 const defaults={timeout_ms:3000,stable_ms:200,poll_interval_ms:100,delay_ms:0};
 function normalize(value,phaseDefaults={}){
  if(value!==undefined&&(!value||typeof value!=='object'||Array.isArray(value)))throw Error('INVALID_TIMING');
  const p={...defaults,...phaseDefaults,...value};
  if(Object.keys(p).some(k=>!Object.hasOwn(defaults,k)))throw Error('INVALID_TIMING');
  for(const [k,min,max] of [['timeout_ms',50,10000],['stable_ms',0,3000],['poll_interval_ms',50,500],['delay_ms',0,3000]])if(!Number.isInteger(p[k])||p[k]<min||p[k]>max)throw Error('INVALID_TIMING');
  if(p.stable_ms+p.delay_ms>p.timeout_ms)throw Error('INVALID_TIMING: delay plus stability exceeds timeout');
  return p;
 }
 async function wait(sample,value,{now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),deadline=Infinity}={}){
  const p=normalize(value),started=now(),until=Math.min(deadline,started+p.timeout_ms);let previous,since=null,probes=0;
  const result=matched=>({matched,elapsed_ms:Math.round(now()-started),probes,effective:p});
  while(now()<until){
   const observed=await sample();probes++;const at=now();
   if(at>until)return result(false);
   if(observed.matched!==false&&at-started>=p.delay_ms){
    if(since===null||previous!==observed.key)since=at;
    previous=observed.key;
    if(at-since>=p.stable_ms)return result(true);
   }else{since=null;previous=undefined;}
   if(at>=until)break;
   await sleep(Math.min(p.poll_interval_ms,until-at));
  }
  return result(false);
 }
 return {normalize,wait,defaults};
})();
if(typeof module!=='undefined')module.exports=brodexTiming;
