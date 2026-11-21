'use strict';
// Retry only read-only probes. Page readiness is distinct from transport recovery.
function makeGate({probe, now=()=>performance.now(), sleep=ms=>new Promise(r=>setTimeout(r,ms)), budget=30000}) {
 return async function ready(args={}, limit=budget) {
  const total=Math.min(budget,Math.max(0,limit)), start=now();
  const delays=[2000,4000,8000,16000];let transportAttempt=0,last='NO_RESPONSE',finalProbe=false;
  while(now()-start<total){
   const remaining=total-(now()-start);let transport=false;
   try {
    const result=await probe(args,Math.min(1000,remaining));
    if(!result.ok)throw Error(result.error||'READINESS_REFUSED');
    if(result.value?.ready && now()-start<total)return result;
    last=result.value?.reason||'NOT_READY';transportAttempt=0;
   }catch(error){
    if(!/^BRODEX_(DISCONNECTED|TIMEOUT)/.test(error.message))throw error;
    transport=true;last=error.message.startsWith('BRODEX_TIMEOUT')?'NO_RESPONSE':'DISCONNECTED';
   }
   if(finalProbe)break;
   const left=total-(now()-start);if(left<=0)break;
   let wait=transport?delays[Math.min(transportAttempt++,delays.length-1)]:250;
   // Reserve time for a last observation instead of sleeping through the deadline.
   if(wait>=left){wait=left-Math.min(100,left/2);finalProbe=true;}
   await sleep(wait);
  }
  throw Error('READINESS_TIMEOUT: '+last+'; operation not dispatched; inspect state');
 };
}
module.exports={makeGate};
