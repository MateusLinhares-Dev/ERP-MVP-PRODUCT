(function(global){
'use strict';
const fmt=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const parseBR=value=>{const text=String(value||'').replace(/[^0-9,.-]/g,'');return Number(text.includes(',')?text.replace(/\./g,'').replace(',','.'):text);};
let supplier='',name='',busy=false,records=[],banks=[],summary=null;
let pendingReceipt=null;
const pendingPayments=new Map();
const supplierPreviewCache=new Map();
const supplierPreviewInFlight=new Map();
function previewSupplier(code){
  const cached=supplierPreviewCache.get(code);
  if(cached&&Date.now()-cached.at<20000)return Promise.resolve(cached.balance);
  if(supplierPreviewInFlight.has(code))return supplierPreviewInFlight.get(code);
  const task=request('GET',code).then(data=>{
    const balance=Number(data.totalEmAberto||0);supplierPreviewCache.set(code,{at:Date.now(),balance});return balance;
  }).finally(()=>supplierPreviewInFlight.delete(code));
  supplierPreviewInFlight.set(code,task);return task;
}
function notify(message,error=false){if(typeof global.showToast==='function')global.showToast(message,error?'error':'success',6000);else alert(message);}
async function request(method,query,payload){
  const user=global.firebase?.auth?.().currentUser;
  if(!user)throw new Error('Sua sessão expirou. Entre novamente.');
  const token=await user.getIdToken();
  const search=query===':summary'?'?scope=summary':(query?'?fornCod='+encodeURIComponent(query):'');
  const response=await fetch('/api/finance/supplier-cash-repasses'+search,{
    method,credentials:'same-origin',headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},
    ...(method==='POST'?{body:JSON.stringify(payload)}:{})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.message||`Servidor indisponível (${response.status}).`);error.code=data.code;throw error;}
  return data;
}
function modal(){return document.getElementById('supplier-cash-repass-modal');}
function ensureModal(){
  if(modal())return;
  const container=document.createElement('div');container.id='supplier-cash-repass-modal';container.className='supplier-repass-overlay';container.hidden=true;
  container.innerHTML=`<section class="supplier-repass-dialog" role="dialog" aria-modal="true" aria-labelledby="supplier-repass-title">
    <header><h2 id="supplier-repass-title">Recebimento em espécie / Valor a repassar</h2><button type="button" id="supplier-repass-close">Fechar</button></header>
    <p id="supplier-repass-supplier"></p>
    <p class="supplier-repass-help">Registre o dinheiro que o fornecedor entregou e a obrigação de devolvê-lo via PIX. Este valor não é adiantamento de compra. A entrada fica registrada no controle de dinheiro em espécie e o PIX gera uma saída no controle bancário. <strong>O sistema registra o PIX já realizado; não executa a transferência.</strong></p>
    <div id="supplier-repass-total" class="supplier-repass-total"></div>
    <form id="supplier-repass-form"><h3>Registrar dinheiro recebido</h3><div class="supplier-repass-fields">
      <label>Data do recebimento <input type="date" id="supplier-repass-date" required></label>
      <label>Valor recebido (R$) <input id="supplier-repass-value" inputmode="decimal" placeholder="Ex.: 11.000,00" required></label>
      <label class="wide">Observação <input id="supplier-repass-obs" placeholder="Motivo, recibo ou referência (opcional)" maxlength="500"></label>
    </div><button type="submit" id="supplier-repass-save">Confirmar recebimento em dinheiro</button></form>
    <div id="supplier-repass-list"></div><p id="supplier-repass-error" role="alert"></p>
  </section>`;
  document.body.appendChild(container);
  container.querySelector('#supplier-repass-close').onclick=()=>{if(!busy)container.hidden=true;};
  container.addEventListener('click',e=>{if(e.target===container&&!busy)container.hidden=true;});
  container.querySelector('#supplier-repass-form').onsubmit=save;
  container.querySelector('#supplier-repass-list').addEventListener('click',e=>{
    const btn=e.target.closest('[data-repass-show-pay]');if(!btn)return;
    const form=container.querySelector('[data-repass-form="'+CSS.escape(btn.dataset.repassShowPay)+'"]');
    if(form)form.hidden=!form.hidden;
  });
  container.querySelector('#supplier-repass-list').addEventListener('submit',e=>{
    const form=e.target.closest('[data-repass-form]');if(!form)return;
    e.preventDefault();pay(form);
  });
}
function render(){
  const root=modal();if(!root||root.hidden)return;
  root.querySelector('#supplier-repass-supplier').textContent=name+' · '+supplier;
  const balance=records.reduce((sum,r)=>sum+Math.round(Number(r.saldo||0)*100),0)/100;
  root.querySelector('#supplier-repass-total').textContent='Valor total a repassar (em aberto): '+fmt(balance);
  const options=banks.map(b=>`<option value="${esc(b.cod)}">${esc(b.banco)} — ${esc(b.cod)}</option>`).join('');
  const html=records.length?records.map(r=>`<article class="supplier-repass-record">
    <div><strong>${esc(r.data)}</strong> · Recebido ${fmt(r.valor)} · <b>${esc(r.status)}</b></div>
    <div>Repassado: ${fmt(r.valorPago)} · <strong>Restante: ${fmt(r.saldo)}</strong></div>
    ${r.obs?`<div>${esc(r.obs)}</div>`:''}
    ${(r.pagamentos||[]).map(p=>`<small>PIX ${esc(p.data)}: ${fmt(p.valor)} · ${esc(p.bancoNome)}${p.comprovante?' · Comprovante: '+esc(p.comprovante):''}</small>`).join('')}
    ${r.saldo>0?`<button type="button" data-repass-show-pay="${esc(r.id)}">Registrar PIX já realizado</button>
    <form hidden class="supplier-repass-payment" data-repass-form="${esc(r.id)}"><div class="supplier-repass-fields">
      <label>Data do PIX <input name="date" type="date" value="${today()}" required></label>
      <label>Valor do PIX (R$) <input name="amount" inputmode="decimal" value="${fmt(r.saldo).replace('R$','').trim()}" required></label>
      <label>Conta bancária de saída <select name="bank" required><option value="">Selecione</option>${options}</select></label>
      <label>Referência/comprovante <input name="proof" placeholder="Comprovante ou TXID (opcional)" maxlength="180"></label>
    </div><p class="supplier-repass-help">Registre aqui somente um PIX que já foi executado fora do ERP. A confirmação diminuirá a dívida e criará uma saída bancária.</p>
    <button type="submit">Confirmar baixa por PIX</button></form>`:''}
  </article>`).join(''):'<p>Nenhum recebimento registrado para repasse.</p>';
  root.querySelector('#supplier-repass-list').innerHTML='<h3>Movimentações e quitações</h3>'+html;
}
async function refresh(){
  const code=supplier;
  const result=await request('GET',code);
  if(code!==supplier)return;
  records=result.records||[];banks=result.banks||[];
  supplierPreviewCache.set(code,{at:Date.now(),balance:Number(result.totalEmAberto||0)});
  render();
}
async function refreshSummary(){
  const result=await request('GET',':summary');summary=result;
  renderPayablesSummary();
  try{if(typeof global.renderFluxo==='function')global.renderFluxo();}catch(e){console.warn('supplier.repasse.flow',e);}
}
function renderPayablesSummary(){
  const tab=document.getElementById('tab-contas_pagar');if(!tab||!summary)return;
  let host=document.getElementById('supplier-repass-payables');
  if(!host){host=document.createElement('section');host.id='supplier-repass-payables';host.className='supplier-repass-payables';tab.insertBefore(host,tab.firstChild);}
  host.innerHTML='<h3>Dinheiro recebido para repasse via PIX</h3>'+ 
    '<strong>Total a repassar: '+fmt(summary.totalEmAberto)+'</strong>'+ 
    '<p>Obrigações separadas dos títulos de compra. Não abatem adiantamentos nem aparecem duas vezes no total de contas a pagar.</p>'+ 
    (summary.rows?.length?'<div class="supplier-repass-payables-list">'+summary.rows.map(r=>
      `<div><span>${esc(r.nome)} · ${esc(r.data)} · ${fmt(r.saldo)} pendente</span><button type="button" data-repass-open-forn="${esc(r.fornCod)}">Ver / baixar</button></div>`).join('')+'</div>':'<small>Não há valores pendentes de repasse.</small>');
  host.querySelectorAll('[data-repass-open-forn]').forEach(b=>b.onclick=()=>{
    const item=(summary.rows||[]).find(r=>r.fornCod===b.dataset.repassOpenForn);
    if(item)openForSupplier(item.fornCod,item.nome);
  });
}
async function openForSupplier(code,supplierName){
  if(!code)return;
  supplier=String(code);name=String(supplierName||code);
  ensureModal();const root=modal();root.hidden=false;
  root.querySelector('#supplier-repass-date').value=today();
  root.querySelector('#supplier-repass-error').textContent='';
  root.querySelector('#supplier-repass-list').textContent='Carregando...';
  try{await refresh();}catch(e){root.querySelector('#supplier-repass-error').textContent=e.message;}
}
function working(value){busy=value;modal()?.querySelectorAll('button,input,select').forEach(el=>{el.disabled=value;});}
async function save(event){
  event.preventDefault();if(busy||!supplier)return;
  const root=modal();const value=parseBR(root.querySelector('#supplier-repass-value').value);
  if(!Number.isFinite(value)||value<=0||Math.round(value*100)/100!==value){notify('Informe um valor monetário válido.',true);return;}
  const data=root.querySelector('#supplier-repass-date').value;
  const obs=root.querySelector('#supplier-repass-obs').value;
  const fingerprint=JSON.stringify([supplier,data,value,obs]);
  if(pendingReceipt&&pendingReceipt.fingerprint!==fingerprint){notify('Há uma tentativa anterior sem confirmação. Repita os mesmos dados para verificar antes de lançar outro valor.',true);return;}
  if(!confirm('Confirmar entrada de '+fmt(value)+' em ESPÉCIE recebida de '+name+'? Será criado valor a repassar por PIX.'))return;
  if(!pendingReceipt)pendingReceipt={fingerprint,id:crypto.randomUUID()};
  const opId=pendingReceipt.id,code=supplier;
  working(true);
  try{
    await request('POST','',{action:'receive',operationId:opId,fornCod:code,data,valor:Math.round(value*100)/100,obs});
    pendingReceipt=null;
    root.querySelector('#supplier-repass-value').value='';root.querySelector('#supplier-repass-obs').value='';
    notify('Dinheiro recebido confirmado no Firebase.');
    await refresh();await refreshSummary();
  }catch(e){
    try{await refresh();if(records.some(r=>r.operationId===opId)){pendingReceipt=null;notify('Recebimento já confirmado no Firebase.');await refreshSummary();return;}}catch(_){}
    notify(e.message,true);
  }finally{working(false);}
}
async function pay(form){
  if(busy)return;
  const receiptId=form.dataset.repassForm;
  const record=records.find(r=>r.id===receiptId);if(!record||record.saldo<=0)return;
  const valor=parseBR(form.elements.amount.value),bankCode=form.elements.bank.value,data=form.elements.date.value;
  const proof=form.elements.proof.value.trim();
  if(!Number.isFinite(valor)||valor<=0||Math.abs(Math.round(valor*100)-valor*100)>0.001||valor>record.saldo){notify('Valor do repasse inválido, máximo '+fmt(record.saldo)+'.',true);return;}
  const bank=banks.find(b=>b.cod===bankCode);if(!bank){notify('Selecione a conta bancária de saída.',true);return;}
  const fingerprint=JSON.stringify([supplier,receiptId,record.versao,data,valor,bankCode,proof]);
  const previous=pendingPayments.get(receiptId);
  if(previous&&previous.fingerprint!==fingerprint){notify('Existe uma baixa anterior sem confirmação. Não altere os dados; atualize e confira antes de registrar outra.',true);return;}
  if(!confirm('O PIX de '+fmt(valor)+' para '+name+' JÁ FOI REALIZADO pela conta '+bank.banco+'?\n\nConfirmar apenas se a transferência foi feita. O ERP não envia dinheiro.'))return;
  if(!previous)pendingPayments.set(receiptId,{id:crypto.randomUUID(),fingerprint});
  const operationId=pendingPayments.get(receiptId).id,code=supplier;
  working(true);
  try{
    await request('POST','',{action:'pay',operationId,fornCod:code,receiptId,expectedVersion:record.versao,
      data,valor:Math.round(valor*100)/100,bancoCod:bankCode,comprovante:proof});
    pendingPayments.delete(receiptId);
    notify('Baixa do repasse confirmada; saída bancária registrada.');
    await refresh();await refreshSummary();
  }catch(e){
    try{await refresh();if(records.find(r=>r.id===receiptId)?.pagamentos?.some(p=>p.id===operationId)){
      pendingPayments.delete(receiptId);notify('PIX já registrado no Firebase.');await refreshSummary();return;
    }}catch(_){}
    if(e.code==='RECEIPT_CHANGED')pendingPayments.delete(receiptId);
    notify(e.message,true);
  }finally{working(false);}
}
function onFicha(event){
  const code=String(event.detail?.fornCod||'').trim();if(!code)return;
  supplier=code;name=String(event.detail?.nome||'').trim();
  const actions=document.getElementById('ff-actions');if(!actions)return;
  let btn=document.getElementById('supplier-cash-repass-open');
  if(!btn){btn=document.createElement('button');btn.type='button';btn.id='supplier-cash-repass-open';btn.className='supplier-repass-open';btn.textContent='Dinheiro recebido / Valor a repassar';btn.onclick=()=>openForSupplier(supplier,name);actions.insertBefore(btn,actions.firstChild);}
  // Do not add this liability to the supplier's historical purchase/advance KPIs:
  // it represents cash received for a future PIX, not a purchase settlement.
  let indicator=document.getElementById('supplier-cash-repass-indicator');
  if(!indicator){indicator=document.createElement('small');indicator.id='supplier-cash-repass-indicator';indicator.className='supplier-repass-indicator';actions.insertBefore(indicator,btn.nextSibling);}
  indicator.dataset.fornCod=code;
  indicator.textContent='Consultando repasses...';
  previewSupplier(code).then(balance=>{
    if(indicator.dataset.fornCod===code)indicator.textContent='Saldo recebido a repassar via PIX: '+fmt(balance);
  }).catch(()=>{if(indicator.dataset.fornCod===code)indicator.textContent='Consulte os repasses no cadastro.';});
}
function flowTotal(month,year,kind){return Number(summary?.months?.[`${year}-${String(month).padStart(2,'0')}`]?.[kind]||0);}
global.SupplierCashRepasse={flowTotal,refreshSummary,openForSupplier};
document.addEventListener('erp:supplier-ficha-rendered',onFicha);
// Subscribe to login completion: erp:ready can fire before Firebase Auth restores a session.
document.addEventListener('erp:ready',()=>{
  try{
    const auth=global.firebase?.auth?.();
    if(!auth)return;
    auth.onAuthStateChanged(async user=>{
      if(!user){summary=null;document.getElementById('supplier-repass-payables')?.remove();return;}
      try{
        const token=await user.getIdTokenResult();
        if(!token.claims?.erpAccess||(!token.claims?.canPayables&&!token.claims?.canFinance))return;
        await refreshSummary();
      }catch(e){console.warn('supplier.repasse.summary',e);}
    });
  }catch(e){console.warn('supplier.repasse.auth',e);}
});
})(window);
