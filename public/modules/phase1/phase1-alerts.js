(function(global){
'use strict';
const originalRender=global.renderAvisos;
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function configuredAlerts(){
  let list=[];
  try{if(typeof global._coletarAlertas==='function')list=global._coletarAlertas()||[];}catch(e){list=[];}
  return list.filter(a=>a&&a.dias!=null&&a.aviso!=null&&a.dias<=a.aviso&&a.dias>=-7).sort((a,b)=>Number(a.dias)-Number(b.dias));
}
function stoppedKeys(){try{const key='mm_alertas_parados_'+String(global.cuKey||'anon');return JSON.parse(localStorage.getItem(key)||'{}');}catch(e){return {};}}
function renderConfigured(){
  const tab=document.getElementById('tab-avisos');if(!tab)return;
  tab.querySelectorAll('[data-phase1-alert-card]').forEach(x=>x.remove());
  const stopped=stoppedKeys();const list=configuredAlerts().filter(a=>!stopped[a.key]);
  const card=document.createElement('div');card.dataset.phase1AlertCard='1';card.className='phase1-alert-card';
  card.innerHTML=`<div class="phase1-alert-head"><h3>⏰ Alertas pela antecedência configurada</h3><span>${list.length} pendente(s)</span></div>${list.length?list.map(a=>`<div class="phase1-alert-row ${a.dias<0?'late':''}"><div><b>${esc(a.nome||a.tipo||'Aviso')}</b><small>${esc(a.tipo||'')} · antecedência ${Number(a.aviso)} dia(s)</small></div><strong>${a.dias<0?`venceu há ${Math.abs(a.dias)} dia(s)`:a.dias===0?'vence hoje':`em ${a.dias} dia(s)`}</strong></div>`).join(''):'<div class="phase1-empty">Nenhum alerta dentro da antecedência configurada.</div>'}`;
  const h=tab.querySelector('h2');if(h)h.insertAdjacentElement('afterend',card);else tab.prepend(card);
  [...tab.querySelectorAll('h3')].forEach(h3=>{if(/Fim de experiência/i.test(h3.textContent||'')){const box=h3.closest('div[style*="box-shadow"]');if(box)box.style.display='none';}});
}
if(typeof originalRender==='function')global.renderAvisos=function(){const result=originalRender.apply(this,arguments);setTimeout(renderConfigured,0);return result;};
document.addEventListener('erp:alert-source-changed',()=>setTimeout(()=>{try{if(document.getElementById('tab-avisos')?.classList.contains('active'))global.renderAvisos();}catch(e){}},50));
setTimeout(renderConfigured,400);
})(window);
