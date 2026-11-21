'use strict';
// One bounded allocation per Chrome frame; do not concatenate an 8 MiB PNG on every chunk.
function createReceiver(onMessage,maxBytes=12*1024*1024){
 const header=Buffer.alloc(4);let headerBytes=0,payload=null,written=0;
 return chunk=>{
  let offset=0;
  while(offset<chunk.length){
   if(!payload){
    const n=Math.min(4-headerBytes,chunk.length-offset);chunk.copy(header,headerBytes,offset,offset+n);headerBytes+=n;offset+=n;
    if(headerBytes<4)continue;
    const size=header.readUInt32LE(0);if(!size||size>maxBytes)throw Error('NATIVE_FRAME_LIMIT');
    payload=Buffer.allocUnsafe(size);written=0;
   }
   const n=Math.min(payload.length-written,chunk.length-offset);chunk.copy(payload,written,offset,offset+n);written+=n;offset+=n;
   if(written===payload.length){
    const complete=payload;payload=null;headerBytes=0;written=0;
    onMessage(JSON.parse(complete.toString('utf8')));
   }
  }
 };
}
module.exports={createReceiver};
