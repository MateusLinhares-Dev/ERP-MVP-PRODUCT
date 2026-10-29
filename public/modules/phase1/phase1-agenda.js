(function(global){
'use strict';
const original={open:global.agendaAbrirNovo,save:global.agendaNovo,whats:global.agendaWhats,render:global.agendaRender};
const defaultServices=[{id:'base_entrega',name:'ENTREGA DE MATERIAL'},{id:'base_retirada',name:'RETIRADA DE MATERIAL'},{id:'base_coleta',name:'COLETA DE MATERIAL'},{id:'base_atendimento',name:'ATENDIMENTO'}];
let serviceCatalog=defaultServices,serviceBusy=false;
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function enhanceModal(){
  const card=document.querySelector('#agd-novo-ov>div');if(!card||card.dataset.phase1==='1')return;
  const who=document.getElementById('agd-novo-nome');if(!who)return;
  const type=document.getElementById('agd-novo-tipo');
  if(type){
    type.value='Cliente';
    type.parentElement?.classList.add('phase1-agenda-party-type');
    type.onchange=()=>{try{if(typeof _agdNovoAtualizaNomes==='function')_agdNovoAtualizaNomes();}catch(e){}global.ERPRefreshSearchableSelect?.('agd-novo-nome');};
    try{if(typeof _agdNovoAtualizaNomes==='function')_agdNovoAtualizaNomes();}catch(e){}
    const typeLabel=type.parentElement?.querySelector('label');if(typeLabel)typeLabel.textContent='TIPO DE CADASTRO';
  }
  const whoWrap=who.parentElement;
  if(typeof global.ERPEnhanceSearchableSelect==='function'){
    global.ERPEnhanceSearchableSelect(who,{placeholder:'Buscar pelo nome, digite para filtrar…',label:'Cliente ou fornecedor da entrega'});
  }
  if(whoWrap){const label=whoWrap.querySelector('label');if(label)label.textContent='CLIENTE / FORNECEDOR';const quick=document.createElement('button');quick.type='button';quick.className='phase1-agenda-quick';quick.textContent='＋ Cadastro rápido de cliente';quick.onclick=global.phase1AgendaQuickClient;whoWrap.appendChild(quick);}
  const material=document.getElementById('agd-novo-material');const obs=document.getElementById('agd-novo-obs');const obsWrap=obs?.parentElement;
  if(obsWrap){
    const before=document.createElement('div');before.className='phase1-agenda-fields phase1-agenda-fields-before';before.innerHTML=`<label><span>SERVIÇO</span><select id="agd-novo-servico"><option value="ENTREGA DE MATERIAL">ENTREGA DE MATERIAL</option><option value="RETIRADA DE MATERIAL">RETIRADA DE MATERIAL</option><option value="COLETA DE MATERIAL">COLETA DE MATERIAL</option><option value="ATENDIMENTO">ATENDIMENTO</option></select></label><label><span>FORMA DE PAGAMENTO</span><select id="agd-novo-pagamento"><option value="">— Não informado —</option><option>PIX</option><option>Dinheiro</option><option>Cheque</option><option>Transferência</option><option>A prazo</option><option>Outro</option></select></label>`;obsWrap.insertAdjacentElement('beforebegin',before);
    const after=document.createElement('div');after.className='phase1-agenda-fields phase1-agenda-fields-after';after.innerHTML=`<label><span>STATUS</span><select id="agd-novo-status"><option>Agendado</option><option>Confirmado</option><option>Chegou</option><option>Concluído</option><option>Cancelado</option></select></label>`;obsWrap.insertAdjacentElement('afterend',after);
  }
  if(material){const materialWrap=material.parentElement;const details=document.createElement('details');details.className='phase1-agenda-optional';details.innerHTML='<summary>Mais detalhes do agendamento</summary>';materialWrap.insertAdjacentElement('beforebegin',details);details.appendChild(materialWrap);const label=materialWrap.querySelector('label');if(label)label.textContent='MATERIAL / DETALHE (OPCIONAL)';}
  const obsLabel=obsWrap?.querySelector('label');if(obsLabel)obsLabel.textContent='OBSERVAÇÃO';
  const serviceSelect=document.getElementById('agd-novo-servico');
  if(serviceSelect){
    serviceSelect.parentElement.classList.add('phase1-agenda-service-label');
    const manage=document.createElement('button');manage.type='button';manage.className='phase1-agenda-manage';manage.textContent='Gerenciar';
    manage.title='Adicionar ou excluir serviços disponíveis na Agenda';
    manage.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openServiceManager();});
    serviceSelect.insertAdjacentElement('afterend',manage);
    setServiceOptions(serviceSelect.value);
    refreshServices().catch(e=>showServiceError('Serviços não sincronizados: '+e.message));
  }
  card.dataset.phase1='1';
  setTimeout(()=>document.querySelector('#agd-novo-ov .erp-search-select-input')?.focus(),35);
}
if(typeof original.open==='function')global.agendaAbrirNovo=function(){const result=original.open.apply(this,arguments);enhanceModal();return result;};
// Open always uses the latest in-memory registry, not a frozen list from page load.
document.addEventListener('erp:catalog-updated',()=>{
  const select=document.getElementById('agd-novo-nome');if(!select)return;
  const old=select.value;
  try{if(typeof _agdNovoAtualizaNomes==='function')_agdNovoAtualizaNomes();}catch(e){}
  if(old&&[...select.options].some(x=>x.value===old))select.value=old;
  global.ERPRefreshSearchableSelect?.('agd-novo-nome');
});
if(typeof original.save==='function')global.agendaNovo=function(){
  let before=[];try{before=(AGENDA_DB||[]).map(x=>x&&x.id).filter(Boolean);}catch(e){}
  const service=String(document.getElementById('agd-novo-servico')?.value||'').trim();
  const payment=String(document.getElementById('agd-novo-pagamento')?.value||'').trim();
  const status=String(document.getElementById('agd-novo-status')?.value||'Agendado').trim();
  if(!service){showServiceError('Selecione ou cadastre um serviço antes de agendar.');return;}
  const result=original.save.apply(this,arguments);
  try{const beforeSet=new Set(before);(AGENDA_DB||[]).forEach(item=>{if(!item||beforeSet.has(item.id))return;item.servico=service||item.material||'';item.formaPagamento=payment;item.status=status||item.status||'Agendado';item._upd=Date.now();});if(typeof agendaPersist==='function')agendaPersist();if(typeof fbSalvar==='function')fbSalvar();if(typeof agendaRender==='function')agendaRender();}catch(e){console.warn('[phase1-agenda] salvar campos',e);}
  return result;
};
function showServiceError(message){
  try{if(typeof showToast==='function')showToast(message,'error');else console.warn('[Agenda Serviços]',message);}catch(_){console.warn('[Agenda Serviços]',message);}
}
async function agendaServiceRequest(action,body){
  const user=global.__fbRaw?.auth?.currentUser;
  if(!user)throw new Error('Faça login novamente para gerenciar os serviços.');
  const token=await user.getIdToken();
  const response=await fetch('/api/agenda/services',{
    method:action==='load'?'GET':'POST',credentials:'same-origin',cache:'no-store',
    headers:{Authorization:'Bearer '+token,...(action==='load'?{}:{'Content-Type':'application/json'})},
    ...(action==='load'?{}:{body:JSON.stringify(body)})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.message||('Falha na sincronização dos serviços (HTTP '+response.status+').'));
  return data;
}
function setServiceOptions(preferred){
  const select=document.getElementById('agd-novo-servico');if(!select)return;
  const previous=preferred??select.value;
  select.replaceChildren();
  for(const service of serviceCatalog){
    const option=document.createElement('option');option.value=service.name;option.textContent=service.name;select.appendChild(option);
  }
  if(serviceCatalog.some(item=>item.name===previous))select.value=previous;
}
function servicesFromResponse(data){
  // Never overwrite the valid catalog with an undefined or malformed payload.
  const services=Array.isArray(data?.services)?data.services:Array.isArray(data?.items)?data.items:null;
  if(!services||!services.every(item=>item&&typeof item.id==='string'&&typeof item.name==='string')){
    throw new Error('A API retornou uma lista de serviços inválida. Atualize a tela e tente novamente.');
  }
  return services;
}
async function refreshServices(){
  const result=await agendaServiceRequest('load');
  serviceCatalog=servicesFromResponse(result);setServiceOptions();renderServiceManager();
}
function renderServiceManager(){
  const list=document.getElementById('phase1-agenda-service-list');if(!list)return;
  const services=Array.isArray(serviceCatalog)?serviceCatalog:[];
  list.innerHTML=services.length?services.map(item=>`<div class="phase1-agenda-service-item"><span>${esc(item.name)}</span><button type="button" data-service-delete="${esc(item.id)}" ${serviceBusy?'disabled':''} aria-label="Excluir ${esc(item.name)}">Excluir</button></div>`).join(''):'<p class="phase1-agenda-service-empty">Sem serviços. Cadastre um para poder agendar.</p>';
  list.querySelectorAll('[data-service-delete]').forEach(button=>button.onclick=()=>deleteService(button.dataset.serviceDelete));
}
function serviceManagerStatus(message,error=false){
  const field=document.getElementById('phase1-agenda-service-message');if(field){field.textContent=message;field.classList.toggle('error',error);}
}
function openServiceManager(){
  document.getElementById('phase1-agenda-service-ov')?.remove();
  const ov=document.createElement('div');ov.id='phase1-agenda-service-ov';ov.className='phase1-agenda-service-ov';
  ov.innerHTML=`<section class="phase1-agenda-service-card" role="dialog" aria-modal="true" aria-labelledby="phase1-agenda-service-title"><div class="phase1-agenda-service-heading"><div><h3 id="phase1-agenda-service-title">Serviços da agenda</h3><p>Serviços disponíveis para todos os usuários com acesso à Agenda de Entregas.</p></div><button type="button" id="phase1-agenda-service-close" aria-label="Fechar">×</button></div><form id="phase1-agenda-service-form"><label for="phase1-agenda-service-name">Novo serviço</label><div class="phase1-agenda-service-new"><input id="phase1-agenda-service-name" minlength="3" maxlength="80" placeholder="Ex.: ENTREGA DE MATERIAL" required><button type="submit" id="phase1-agenda-service-add">Adicionar</button></div></form><p class="phase1-agenda-service-note">Excluir um serviço remove apenas esta opção da lista. Entregas antigas permanecem registradas.</p><div id="phase1-agenda-service-list" class="phase1-agenda-service-list"></div><p id="phase1-agenda-service-message" role="status"></p></section>`;
  document.body.appendChild(ov);
  ov.querySelector('#phase1-agenda-service-close').onclick=()=>{if(!serviceBusy)ov.remove();};
  ov.onclick=e=>{if(e.target===ov&&!serviceBusy)ov.remove();};
  ov.querySelector('#phase1-agenda-service-form').onsubmit=addService;
  renderServiceManager();refreshServices().catch(e=>serviceManagerStatus(e.message,true));
  ov.querySelector('#phase1-agenda-service-name').focus();
}
async function addService(event){
  event.preventDefault();if(serviceBusy)return;
  const input=document.getElementById('phase1-agenda-service-name');const name=input?.value?.trim();if(!name)return;
  if(name.length<3||name.length>80){serviceManagerStatus('Informe um serviço com 3 a 80 caracteres.',true);return;}
  serviceBusy=true;const button=document.getElementById('phase1-agenda-service-add');if(button){button.disabled=true;button.textContent='Salvando...';}
  try{
    const data=await agendaServiceRequest('update',{action:'add',name});
    serviceCatalog=servicesFromResponse(data);setServiceOptions(name.toLocaleUpperCase('pt-BR').replace(/\s+/g,' '));
    if(input)input.value='';renderServiceManager();serviceManagerStatus(data.changed?'Serviço cadastrado para os usuários da agenda.':'Este serviço já está cadastrado.');
  }catch(e){serviceManagerStatus(e.message,true);}
  finally{serviceBusy=false;if(button){button.disabled=false;button.textContent='Adicionar';}renderServiceManager();}
}
async function deleteService(id){
  if(serviceBusy)return;const item=serviceCatalog.find(s=>s.id===id);if(!item)return;
  if(!confirm(`Excluir "${item.name}" da lista de serviços? Agendamentos existentes não serão alterados.`))return;
  serviceBusy=true;renderServiceManager();serviceManagerStatus('Excluindo...');
  try{
    const data=await agendaServiceRequest('update',{action:'delete',id});
    serviceCatalog=servicesFromResponse(data);setServiceOptions();serviceManagerStatus('Serviço removido da lista.');
  }catch(e){serviceManagerStatus(e.message,true);}
  finally{serviceBusy=false;renderServiceManager();}
}
function phoneFor(name){const key=String(name||'').trim().toUpperCase();let phone='';try{[...(CLIENTES||[]),...(FORNECEDORES||[])].forEach(p=>{if(String(p?.nome||'').trim().toUpperCase()===key)phone=p.tel||p.telefone||p.celular||phone;});}catch(e){}return String(phone||'').replace(/\D/g,'');}
global.agendaWhats=function(id){
  let a=null;try{a=(AGENDA_DB||[]).find(x=>x&&x.id===id);}catch(e){}if(!a)return;
  let phone=phoneFor(a.nome);if(!phone){phone=String(prompt(`Informe o WhatsApp de ${a.nome}:`,'47')||'').replace(/\D/g,'');if(!phone)return;}if(phone.length===10||phone.length===11)phone='55'+phone;
  const date=String(a.data||'').split('-').reverse().join('/');const service=a.servico||a.material||'—';
  const message=`Oi ${a.nome}, tudo bem?\nEste é um lembrete para o seu atendimento, dia ${date} às ${a.hora||'—'}.\nServiço: ${service}\nPODENDO HAVER ATRASOS DEVIDO A DEMANDA.\nObrigada    🤝`;
  global.open('https://wa.me/'+phone+'?text='+encodeURIComponent(message),'_blank');
};
global.phase1AgendaQuickClient=function(){
  document.getElementById('phase1-agenda-client-ov')?.remove();const ov=document.createElement('div');ov.id='phase1-agenda-client-ov';ov.className='phase1-agenda-client-ov';ov.innerHTML=`<div class="phase1-agenda-client-card"><h3>👤 Cadastro rápido de cliente</h3><label>Nome / Razão Social *<input id="phase1-agenda-cli-name"></label><label>WhatsApp / Telefone<input id="phase1-agenda-cli-phone" inputmode="tel"></label><details><summary>Mais campos</summary><div class="phase1-agenda-more"><label>CPF<input id="phase1-agenda-cli-cpf"></label><label>CNPJ<input id="phase1-agenda-cli-cnpj"></label><label>E-mail<input id="phase1-agenda-cli-email"></label><label>Cidade / UF<input id="phase1-agenda-cli-city"></label></div></details><div class="phase1-agenda-client-actions"><button onclick="document.getElementById('phase1-agenda-client-ov').remove()">Cancelar</button><button class="save" onclick="phase1AgendaSaveQuickClient()">Salvar e selecionar</button></div></div>`;document.body.appendChild(ov);ov.onclick=e=>{if(e.target===ov)ov.remove();};setTimeout(()=>document.getElementById('phase1-agenda-cli-name')?.focus(),20);
};
global.phase1AgendaSaveQuickClient=function(){
  const name=String(document.getElementById('phase1-agenda-cli-name')?.value||'').trim();if(!name){try{showToast('Informe o nome do cliente.','error');}catch(e){}return;}
  try{const exists=(CLIENTES||[]).some(c=>String(c?.nome||'').trim().toUpperCase()===name.toUpperCase());if(!exists){const code='CL'+String(Date.now()).slice(-8);CLIENTES.push({cod:code,nome:name,tel:String(document.getElementById('phase1-agenda-cli-phone')?.value||'').trim(),cpf:String(document.getElementById('phase1-agenda-cli-cpf')?.value||'').trim(),cnpj:String(document.getElementById('phase1-agenda-cli-cnpj')?.value||'').trim(),email:String(document.getElementById('phase1-agenda-cli-email')?.value||'').trim(),cidade:String(document.getElementById('phase1-agenda-cli-city')?.value||'').trim(),status:'Ativo'});if(typeof saveClientes==='function')saveClientes();}}
  catch(e){console.error(e);return;}
  const type=document.getElementById('agd-novo-tipo');if(type)type.value='Cliente';try{if(typeof _agdNovoAtualizaNomes==='function')_agdNovoAtualizaNomes();}catch(e){}document.dispatchEvent(new CustomEvent('erp:catalog-updated',{detail:{type:'clientes'}}));const select=document.getElementById('agd-novo-nome');if(select)select.value=name;global.ERPRefreshSearchableSelect?.('agd-novo-nome');document.getElementById('phase1-agenda-client-ov')?.remove();
};
})(window);
