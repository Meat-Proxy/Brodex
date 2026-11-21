'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ORIGIN=fs.readFileSync(path.join(__dirname,'allowed-origin.txt'),'utf8').trim();
if(!/^chrome-extension:\/\/[a-p]{32}\/$/.test(ORIGIN))throw Error('Invalid Brodex extension origin');
function config(){const c=JSON.parse(fs.readFileSync(path.join(__dirname,'bridge-config.json'),'utf8'));if(!/^[a-f0-9]{64}$/.test(c.token)||!c.pipe.startsWith('\\\\.\\pipe\\brodex-'))throw Error('Invalid Brodex configuration');return c;}
function lines(stream,onLine,onError,max=1024*1024){let buffer='';stream.setEncoding('utf8');stream.on('data',chunk=>{buffer+=chunk;if(buffer.length>max){onError(Error('Message exceeds limit'));return;}let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(line.trim())try{onLine(JSON.parse(line));}catch(e){onError(e);}}});}
function equalToken(a,b){return typeof a==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));}
module.exports={ORIGIN,config,lines,equalToken};
