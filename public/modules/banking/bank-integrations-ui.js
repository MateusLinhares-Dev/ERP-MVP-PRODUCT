/* Configuração bancária de uma conta do ERP; credenciais sempre processadas no backend. */
(function(root){
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current=null;
async function call(action,fields={}){
  const user=root.firebase?.auth()?.currentUser;
  if(!user)throw Error('Sessão encerrada. Faça login novamente.');
  const token=await user.getIdToken();
  const response=await fetch('/api/banking/integrations',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action,bankCode:current.code,...fields})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.message||`Falha na integração (${response.status}).`);
  return data;
}
function notice(text,bad=false){const el=current?.element.querySelector('[data-integration-notice]');if(el){el.textContent=text||'';el.dataset.error=bad?'true':'false';}}
function busy(state){const el=current?.element;if(!el)return;el.querySelectorAll('button[data-operation]').forEach(button=>button.disabled=state);}
function close(){if(!current)return;const c=current;current=null;c.element.remove();document.removeEventListener('keydown',c.onEscape);}
function render(){
  if(!current)return;
  const c=current,box=c.element.querySelector('[data-integrations-main]'),config=c.config||{};
  const saved=config.configured,connected=config.connected,linked=!!config.accountId;
  box.innerHTML='<div class="erp-bank-integration-summary">'+
    '<div><small>Provedor</small><strong>Pluggy / Open Finance</strong></div>'+ 
    '<div><small>Credenciais</small><strong>'+ (saved?'Configuradas':'Não configuradas')+'</strong></div>'+ 
    '<div><small>Conexão bancária</small><strong>'+(connected?'Conectada':'Não conectada')+'</strong></div>'+ 
    '<div><small>Última importação</small><strong>'+(config.lastSyncAt?esc(new Date(config.lastSyncAt).toLocaleString('pt-BR')):'—')+'</strong></div></div>'+ 
    (c.canConfigure?'<div class="erp-bank-integration-grid"><section class="erp-bank-integration-section"><h3>1. Credenciais do provedor</h3><div class="erp-bank-integration-form"><label>Client ID<input name="clientId" autocomplete="off" maxlength="200" placeholder="Client ID Pluggy"></label><label>Client Secret<input name="clientSecret" type="password" autocomplete="new-password" maxlength="300" placeholder="Client Secret"></label></div><div class="erp-bank-integration-actions"><button type="button" data-operation="save">Salvar credenciais</button><button type="button" data-operation="test" '+(!saved?'disabled':'')+'>Testar conexão</button></div></section>'+ 
    '<section class="erp-bank-integration-section"><h3>2. Vincular conta bancária</h3><p>Conecte a instituição pelo ambiente seguro do provedor. Depois selecione a conta correspondente ao cadastro do ERP.</p><div class="erp-bank-integration-actions"><button type="button" data-operation="connect" '+(!saved?'disabled':'')+'>Conectar instituição</button><button type="button" data-operation="accounts" '+(!connected?'disabled':'')+'>Atualizar contas</button></div><div data-external-accounts></div>'+(connected?'<div class="erp-bank-integration-actions"><button type="button" data-operation="disconnect">Desvincular</button></div>':'')+'</section></div>'+ 
    '<section class="erp-bank-integration-section"><h3>3. Sincronização</h3><p>Importa movimentações bancárias como pendentes de conciliação. Não cria baixas nem modifica o saldo automaticamente.</p><div class="erp-bank-integration-actions"><button type="button" data-operation="sync" '+(!linked?'disabled':'')+'>Buscar movimentações</button><button type="button" data-operation="reconcile">Abrir conciliação</button></div></section>':
    '<div class="erp-bank-integration-section"><p>O perfil atual pode consultar a situação desta integração. A configuração e a sincronização exigem acesso de administrador.</p></div>');
  box.querySelectorAll('[data-operation]').forEach(btn=>btn.addEventListener('click',()=>operation(btn.dataset.operation)));
  if(c.accounts?.length)renderAccounts();
}
function renderAccounts(){
  const box=current?.element.querySelector('[data-external-accounts]');if(!box)return;
  const c=current;
  box.innerHTML='<label>Conta conectada<select data-external-select><option value="">Selecione</option>'+c.accounts.map(a=>'<option value="'+esc(a.id)+'" '+(a.id===c.config.accountId?'selected':'')+'>'+esc(a.name)+' · '+esc(a.type)+' · '+esc(a.numberEnd)+'</option>').join('')+'</select></label><button type="button" data-operation="select-account">Salvar vínculo</button>';
  box.querySelector('[data-operation]').addEventListener('click',()=>operation('select-account'));
}
function loadPluggySdk(){
  if(typeof root.PluggyConnect==='function')return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const source='https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js';
    const existing=document.querySelector('script[data-pluggy-sdk]');
    if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',()=>reject(Error('Não foi possível carregar a conexão bancária.')),{once:true});return;}
    const script=document.createElement('script');script.src=source;script.async=true;script.dataset.pluggySdk='true';
    script.onload=resolve;script.onerror=()=>reject(Error('Não foi possível carregar a conexão bancária.'));document.head.appendChild(script);
  });
}
async function operation(action){
  if(!current||current.busy)return;
  const c=current,box=c.element;
  c.busy=true;busy(true);notice('');
  try{
    if(action==='save'){
      const clientId=box.querySelector('[name=clientId]').value.trim(),clientSecret=box.querySelector('[name=clientSecret]').value.trim();
      if(!clientId||!clientSecret)throw Error('Informe Client ID e Client Secret.');
      if(c.config.configured&&!root.confirm('Substituir as credenciais atuais e desconectar a instituição existente?'))return;
      const result=await call('save',{clientId,clientSecret});
      c.accounts=[];c.config=result.config;render();notice(result.message);
    }else if(action==='test'){
      const result=await call('test');notice(result.message);
    }else if(action==='connect'){
      const result=await call('connect-token');await loadPluggySdk();
      new root.PluggyConnect({connectToken:result.accessToken,includeSandbox:root.location.hostname.includes('hml')||root.location.hostname==='localhost',
        onSuccess:async event=>{
          try{
            const itemId=event?.item?.id||event?.id;
            const linked=await call('link',{itemId});c.config=linked.config;c.accounts=linked.accounts;render();notice('Instituição conectada. Selecione a conta bancária.');
          }catch(error){notice(error.message,true);}
        },onError:()=>notice('A conexão com a instituição não foi concluída.',true)}).init();
      notice('Conclua a conexão na janela segura do provedor.');
    }else if(action==='accounts'){
      const result=await call('accounts');c.accounts=result.accounts;render();notice('Contas atualizadas.');
    }else if(action==='select-account'){
      const accountId=box.querySelector('[data-external-select]')?.value;
      if(!accountId)throw Error('Selecione uma conta externa.');
      const result=await call('select-account',{accountId});c.config=result.config;render();notice(result.message);
    }else if(action==='disconnect'){
      if(!root.confirm('Desvincular esta conta do provedor? Os extratos já importados continuarão disponíveis.'))return;
      const result=await call('disconnect');c.config=result.config;c.accounts=[];render();notice(result.message);
    }else if(action==='sync'){
      const result=await call('sync');const status=await call('status');c.config=status.config;render();notice(result.message);
    }else if(action==='reconcile'){
      const code=c.code;close();root.erpReconciliationOpen?.(code);
    }
  }catch(error){if(current===c)notice(error.message,true);}finally{c.busy=false;if(current===c)busy(false);}
}
root.erpBankIntegrationsOpen=async function(bankCode){
  const code=String(bankCode||'');if(!/^[A-Za-z0-9_-]{1,40}$/.test(code))return;
  close();const el=document.createElement('div');el.className='erp-bank-integration-overlay';
  el.innerHTML='<section class="erp-bank-integration-dialog" role="dialog" aria-modal="true" aria-label="Integrações bancárias"><header><div><h2>Integrações bancárias</h2><p>Conta '+esc(code)+'</p></div><button type="button" data-integration-close>Fechar</button></header><div class="erp-bank-integration-content"><div role="status" aria-live="polite" data-integration-notice></div><div data-integrations-main><p>Carregando configurações...</p></div></div></section>';
  document.body.appendChild(el);
  const context={code,element:el,config:{},accounts:[],canConfigure:false,busy:false,onEscape:event=>{if(event.key==='Escape')close();}};
  current=context;document.addEventListener('keydown',context.onEscape);
  el.querySelector('[data-integration-close]').addEventListener('click',close);
  el.addEventListener('click',e=>{if(e.target===el)close();});
  try{const result=await call('status');if(current!==context)return;context.config=result.config;context.canConfigure=result.canConfigure;render();}
  catch(error){notice(error.message,true);}
};
})(window);
