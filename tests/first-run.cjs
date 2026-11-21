'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {initialize}=require('../bridge/native-storage-init.cjs');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'brodex-first-run-')),root=path.join(temp,'Data');
 await initialize(root);const marker=path.join(temp,'native-storage-active.json'),first=await fs.readFile(marker,'utf8');
 await initialize(root);assert.equal(await fs.readFile(marker,'utf8'),first);
 await fs.unlink(marker);await fs.writeFile(path.join(root,'existing.json'),'{}');
 await assert.rejects(initialize(root),/MIGRATION_REQUIRED/);assert.equal(await fs.readFile(path.join(root,'existing.json'),'utf8'),'{}');
 await fs.unlink(path.join(root,'existing.json'));await fs.rmdir(root);await fs.rmdir(temp);
 console.log('PASS: fresh native storage, idempotence, existing data refused without changes');
})().catch(e=>{console.error(e);process.exitCode=1;});
