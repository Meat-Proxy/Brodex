'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
function idFromKey(key){
 if(typeof key!=='string'||!key||!/^[A-Za-z0-9+/]+={0,2}$/.test(key))throw Error('Missing or invalid manifest public key');
 const bytes=Buffer.from(key,'base64');
 const parsed=crypto.createPublicKey({key:bytes,format:'der',type:'spki'});
 if(parsed.asymmetricKeyType!=='rsa'||parsed.export({format:'der',type:'spki'}).toString('base64')!==key)throw Error('Expected canonical RSA public key');
 return crypto.createHash('sha256').update(bytes).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
}
function fromManifest(file){return idFromKey(JSON.parse(fs.readFileSync(file,'utf8')).key);}
module.exports={idFromKey,fromManifest};
if(require.main===module){try{console.log(fromManifest(process.argv[2]));}catch(e){console.error(e.message);process.exitCode=1;}}
