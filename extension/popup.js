'use strict';
const toggle=document.getElementById('show-actions');
const result=document.getElementById('result');
document.getElementById('version').textContent=chrome.runtime.getManifest().version_name;
async function refresh(){
 try{
  const [settings,state]=await Promise.all([chrome.storage.local.get('brodexShowActions'),chrome.storage.session.get('brodexMcpConnection')]);
  toggle.checked=settings.brodexShowActions!==false;toggle.disabled=false;
  document.getElementById('connection').textContent=state.brodexMcpConnection?.connected?'Канал моста открыт. Доступность MCP проверяется из Codex.':'Мост не подключён. Проверь установку native host.';
 }catch{document.getElementById('connection').textContent='Не удалось прочитать состояние расширения.';}
}
toggle.addEventListener('change',async()=>{
 const requested=toggle.checked;toggle.disabled=true;
 try{await chrome.storage.local.set({brodexShowActions:requested});result.textContent='Настройка сохранена. Применится при следующих действиях.';}
 catch{toggle.checked=!requested;result.textContent='Не удалось сохранить настройку.';}
 finally{toggle.disabled=false;}
});
document.getElementById('refresh').addEventListener('click',refresh);
refresh();
