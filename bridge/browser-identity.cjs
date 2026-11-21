'use strict';
// Read only the native host's ancestor chain, never unrelated Chrome profiles.
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
module.exports=function browserIdentity(){
 if(process.platform!=='win32')return null;
 const script=`$currentId=${process.pid}; for($i=0;$i -lt 12;$i++){ $p=Get-CimInstance Win32_Process -Filter "ProcessId=$currentId"; if(!$p){exit}; if($p.Name -eq 'chrome.exe'){ Write-Output ($p.ProcessId.ToString()+'|'+$p.CreationDate.ToUniversalTime().Ticks.ToString()); exit }; $currentId=$p.ParentProcessId }`;
 try{const value=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:10000}).trim();return /^\d+\|\d+$/.test(value)?createHash('sha256').update(value).digest('hex'):null;}catch{return null;}
};
