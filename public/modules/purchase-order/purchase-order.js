(function(global){
'use strict';

const legacy={
  loadSupplier:global.csCarregarForn,
  confirmPurchase:global.csConfirmarEntrada,
  tab:global.csTab,
  openModal:global.om,
  print:global.phase1PurchasePrint,
  canhoto:global.imprimirCanhoto
};

let manualMode=false;
let rowSeed=0;
let saving=false;
let activeSourceTicketKey='';
let supplierChangeTimer=null;

function esc(value){
  return String(value==null?'':value).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function money(value){
  return Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function qty(value){
  return Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:3});
}
function parseBR(value){
  let raw=String(value==null?'':value).trim().replace(/\s/g,'').replace(/R\$/gi,'').replace(/[^0-9,.-]/g,'');
  if(!raw)return 0;
  if(raw.includes(',')) raw=raw.replace(/\./g,'').replace(',','.');
  const parsed=Number(raw);
  return Number.isFinite(parsed)?parsed:0;
}
function today(){
  return new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
}
function tickets(){
  try{return TICKETS_DB||{};}catch(e){return {};}
}
function suppliers(){
  try{
    if(typeof getFornAtivos==='function')return getFornAtivos().slice();
    return (FORNECEDORES||[]).filter(function(f){return !f.inativo&&!f._deleted;});
  }catch(e){return [];}
}
function materials(){
  try{return (METAIS||[]).slice();}catch(e){return [];}
}
function supplierByName(name){
  const target=String(name||'').trim().toLocaleUpperCase('pt-BR');
  if(!target)return null;
  return suppliers().find(function(f){
    return String(f.nome||'').trim().toLocaleUpperCase('pt-BR')===target;
  })||null;
}
function jsonDataset(body,key,fallback){
  try{
    const value=JSON.parse(body?.dataset?.[key]||'');
    return value==null?fallback:value;
  }catch(e){return fallback;}
}
function itemNet(item){
  return Number(item?.pesoLiq!=null?item.pesoLiq:(item?.lq!=null?item.lq:(item?.quantidade||0)))||0;
}
function itemGross(item){
  return Number(item?.pesoBruto!=null?item.pesoBruto:(item?.br!=null?item.br:itemNet(item)))||0;
}
function sourceItems(body){
  const items=jsonDataset(body,'itensData',[]);
  return items.map(function(item,index){
    const amount=itemNet(item);
    return {
      id:'PO-'+(++rowSeed),
      source:true,
      sourceIndex:index,
      mat:String(item.mat||item.matBase||'').trim(),
      descricao:String(item.descricaoDetalhada||item.descricao||item.obs||'').trim(),
      unidade:String(item.unidade||'kg'),
      quantidade:amount,
      pesoBruto:itemGross(item),
      preco:Number(item.preco||0)||0
    };
  });
}
function historicalAppliedAdvances(supplierCode){
  const used=new Map();
  const rows=Object.values(tickets()).filter(function(ticket){
    return String(ticket?.fornecedorCod||ticket?.fornCod||'')===String(supplierCode);
  });
  for(const ticket of rows){
    for(const item of ticket?.reciboFinanceiro?.adiantamentos||[]){
      const code=String(item?.cod||'').trim();
      const applied=Number(item?.valorAplicado||0);
      if(code&&applied>0)used.set(code,Math.round(((used.get(code)||0)+applied)*100)/100);
    }
  }
  return used;
}
function linkedPurchase(reference,supplierCode){
  const target=String(reference||'').trim();
  if(!target)return null;
  return Object.entries(tickets()).find(function(pair){
    const ticket=pair[1];
    return String(ticket?.fornecedorCod||ticket?.fornCod||'')===String(supplierCode)&&
      (String(pair[0])===target||String(ticket?.ticket||'')===target||String(ticket?.numeroPedido||'')===target);
  })?.[1]||null;
}
function financialData(body,supplierCode,sourceTicketKeys=[]){
  const code=String(supplierCode||'').trim();
  const bodyCode=String(body?.dataset?.fornCod||'').trim();
  const sameSupplier=code&&bodyCode===code;
  const sourceKeys=new Set([...(Array.isArray(sourceTicketKeys)?sourceTicketKeys:[]),...(sameSupplier?jsonDataset(body,'ticketKeys',[]):[])].map(String));
  const historical=Object.values(tickets()).filter(function(ticket){
    return String(ticket?.fornecedorCod||ticket?.fornCod||'')===code&&!ticket?._deleted;
  });
  const receiptById=new Map();
  historical.forEach(function(ticket){
    (ticket?.reciboFinanceiro?.adiantamentos||[]).forEach(function(row){
      const id=String(row?.cod||'').trim();
      if(!id)return;
      const entry=receiptById.get(id)||{applied:0,original:0};
      entry.applied+=Math.max(0,Number(row?.valorAplicado||0));
      entry.original=Math.max(entry.original,Number(row?.valorOriginal||0));
      receiptById.set(id,entry);
    });
  });
  const issues=[];
  const blockedIssues=[];
  let reservedNumber='';
  try{reservedNumber=String(body?.dataset?.purchaseReservedNumber||(typeof getNextTicketId==='function'?getNextTicketId():'')||'').trim();}catch(e){reservedNumber='';}
  const all=(ADT_POR_FORN[code]||[]).filter(function(a){return a&&String(a.status||'Pendente').trim().toLowerCase()==='pendente'&&Number(a.valor||0)>0;});
  const eligible=[];
  let trackedSource=false;
  all.forEach(function(a){
    const id=String(a.cod||'').trim();
    const amount=Math.max(0,Number(a.valor||0));
    const linked=String(a.ticketOrigem||a.ticket||'').trim();
    const origin=linked?linkedPurchase(linked,code):null;
    const receipt=receiptById.get(id);
    const original=Math.max(amount,Number(a.valorOriginal||0),Number(receipt?.original||0));
    const legacyApplied=origin&&['pago','quitado'].includes(String(origin.status||'').toLowerCase())
      ?Math.min(original,Math.max(0,Number(origin.adiantamento||0)),Math.max(0,Number(origin.totalGeral||0)))
      :0;
    const prior=Math.max(0,Number(a.valorCompensado||0),Number(receipt?.applied||0),legacyApplied);
    const later=historical.reduce(function(sum,ticket){
      return sum+(String(ticket?.creditoFornecedorOrigem||'')===id?Math.max(0,Number(ticket.creditoFornecedorAplicado||0)):0);
    },0);
    const remaining=Math.round(Math.max(0,original-prior-later)*100)/100;
    if(prior>0){
      trackedSource=true;
      if(remaining>0.005)eligible.push(Object.assign({},a,{valor:Math.min(amount,remaining),valorOriginal:original,valorCompensado:Math.round((prior+later)*100)/100}));
      return;
    }
    if(linked&&!origin&&!sourceKeys.has(linked)){
      if(reservedNumber&&linked===reservedNumber&&!a.ticketOrigem){eligible.push(a);return;}
      issues.push('O adiantamento '+(id||'sem código')+' está vinculado ao ticket '+linked+', que não está no histórico, e não será oferecido nesta compra. Se ele ainda não foi usado, edite o adiantamento e limpe o campo "Vinculado ao Ticket".');
      return;
    }
    if(linked&&!a.ticketOrigem&&!sourceKeys.has(linked))return;
    if(linked&&!a.ticketOrigem&&sourceKeys.has(linked)&&(!origin||origin.status!=='Aguard. Preço'||origin._balFinalizado!==true))return;
    eligible.push(a);
  });
  let adts=eligible.filter(function(a){return !String(a.forma||'').toLowerCase().includes('cheque');});
  const advanceCheques=eligible.filter(function(a){return String(a.forma||'').toLowerCase().includes('cheque');});
  const supplierCheques=(CHEQUES_POR_FORN[code]||[]).filter(function(c){return c&&!c._aplicadoTicket&&c.status!=='Quitado';});
  let cheques=supplierCheques.concat(advanceCheques);
  const raw=SALDO_DEVEDOR_FORN&&SALDO_DEVEDOR_FORN[code];
  const persisted=Math.max(0,Number(typeof raw==='object'?raw?.valor:raw)||0);
  let balance=0;
  let creditSource='';
  if(persisted>0){
    const persistedTicket=String(typeof raw==='object'?raw?.ticket||'':'');
    const recordedTicket=persistedTicket?linkedPurchase(persistedTicket,code):null;
    const linkedAdvance=recordedTicket&&(ADT_POR_FORN[code]||[]).some(function(a){
      const id=String(a?.cod||'');
      return id&&(String(recordedTicket?.creditoFornecedorOrigem||'')===id||
        (recordedTicket?.reciboFinanceiro?.adiantamentos||[]).some(function(row){return String(row?.cod||'')===id;}));
    });
    const legacyExcess=recordedTicket?Math.max(0,Number(recordedTicket.adiantamento||0)-Number(recordedTicket.totalGeral||0)):0;
    const legacyDuplicate=legacyExcess>0&&Math.abs(legacyExcess-persisted)<0.01;
    const sourceAdvances=(ADT_POR_FORN[code]||[]).filter(function(a){
      return a&&a.status==='Quitado'&&String(a.ticket||'')===persistedTicket&&
        !String(a.forma||'').toLowerCase().includes('cheque');
    });
    const laterUsed=historical.reduce(function(sum,ticket){
      return sum+(String(ticket?.creditoFornecedorOrigem||'')===persistedTicket?
        Math.max(0,Number(ticket.creditoFornecedorAplicado||0)):0);
    },0);
    const legacyVerified=!!(recordedTicket&&
      ['Pago','Quitado'].includes(String(recordedTicket.status||''))&&
      sourceAdvances.length===1&&
      Math.abs(Number(sourceAdvances[0].valor||0)-Number(recordedTicket.adiantamento||0))<0.01&&
      legacyExcess>0&&Math.abs(legacyExcess-laterUsed-persisted)<0.01);
    const sourceReceipts=recordedTicket?.reciboFinanceiro?.adiantamentos||[];
    const residualAlreadyInAdvance=eligible.some(function(a){
      return sourceReceipts.some(function(row){return String(row.cod||'')===String(a.cod||'')})&&
        Math.abs(Number(a.valor||0)-persisted)<0.01;
    });
    if(residualAlreadyInAdvance){
      balance=0;
    }else if(legacyVerified){
      balance=persisted;
      creditSource=persistedTicket;
    }else if(!all.length&&(linkedAdvance||legacyDuplicate)){
      issues.push('O saldo anterior pode ser duplicação de um adiantamento já utilizado. É necessário conferir o histórico financeiro.');
    }else if(all.length&&!trackedSource){
      issues.push('O saldo anterior deste fornecedor não tem conciliação comprovada e não será usado automaticamente.');
    }else if(persistedTicket&&!recordedTicket){
      issues.push('O saldo anterior aponta para um ticket excluído ou indisponível. Confira o histórico financeiro antes de aplicá-lo.');
    }else if(!all.length&&!persistedTicket){
      balance=persisted;
    }else{
      issues.push('Saldo residual sem origem financeira validada. Solicite conciliação.');
    }
  }
  return {adts,cheques,balance,creditSource,issues,blockedIssues};
}
function validatePurchaseCredits(state){
  if(state.editKey)return;
  const latest=financialData(null,state.supplierCode,state.sourceTicketKeys);
  const creditSelected=Boolean(document.getElementById('cssdv')?.checked&&Number(state.previousCredit||0)>0);
  if(latest.blockedIssues.length)throw new Error(latest.blockedIssues.join(' '));
  if(creditSelected&&latest.issues.length)throw new Error(latest.issues.join(' '));
  const available=new Map(latest.adts.concat(latest.cheques).map(function(a){return [String(a.cod||a.id||a.num||a.numero||''),Number(a.valor)];}));
  const otherSelected=state.adts.some(function(_,i){return document.getElementById('csadt-'+i)?.checked;})||
    state.cheques.some(function(_,i){return document.getElementById('cscheq-'+i)?.checked;});
  if(creditSelected&&otherSelected)
    throw new Error('Selecione somente o crédito residual OU outros adiantamentos/cheques. Não é seguro misturar as fontes na mesma compra.');
  const selected=state.adts.concat(state.cheques).filter(function(item,index){
    const prefix=index<state.adts.length?'csadt-':'cscheq-';
    const pos=index<state.adts.length?index:index-state.adts.length;
    return document.getElementById(prefix+pos)?.checked;
  });
  for(const item of selected){
    const code=String(item.cod||item.id||item.num||item.numero||'');
    if(!available.has(code)||Math.abs(available.get(code)-Number(item.valor))>0.005)
      throw new Error('O adiantamento ou cheque selecionado já foi utilizado ou alterado. Reabra a compra para atualizar os créditos.');
  }
  if(document.getElementById('cssdv')?.checked&&Math.abs(latest.balance-Number(state.previousCredit||0))>0.005)
    throw new Error('O crédito anterior do fornecedor foi alterado. Reabra a compra antes de salvar.');
}

function currentState(body){
  const stored=jsonDataset(body,'phase4Order',null);
  if(stored&&Array.isArray(stored.items))return stored;
  const selected=String(document.getElementById('cs-lanc-forn')?.value||'').trim();
  const supplier=supplierByName(selected);
  const fin=financialData(body,supplier?.cod||body?.dataset?.fornCod||'');
  let items=sourceItems(body);
  if(!items.length)items=[newItem()];
  let number='';
  try{number=typeof getNextTicketId==='function'?getNextTicketId():'';}catch(e){}
  return {
    supplierName:selected,
    supplierCode:supplier?.cod||body?.dataset?.fornCod||'',
    items,
    discount:0,
    freight:0,
    orderNumber:number,
    purchaseOrder:'',
    purchaseDate:today(),
    dueDate:today(),
    sourceTicketKeys:jsonDataset(body,'ticketKeys',[]),
    adts:fin.adts,
    cheques:fin.cheques,
    previousCredit:fin.balance,
    creditSource:fin.creditSource||'',
    creditIssues:fin.issues||[],
    notes:''
  };
}
function newItem(){
  return {
    id:'PO-'+(++rowSeed),
    source:false,
    mat:'',
    descricao:'',
    unidade:'kg',
    quantidade:0,
    pesoBruto:0,
    preco:0
  };
}
function storeState(body,state){
  if(body)body.dataset.phase4Order=JSON.stringify(state);
}
function selectedSupplierName(){
  return String(document.getElementById('phase4-po-supplier')?.value||document.getElementById('cs-lanc-forn')?.value||'').trim();
}
function setHiddenSupplier(name){
  const select=document.getElementById('cs-lanc-forn');
  if(!select)return false;
  const supplier=supplierByName(name);
  if(!supplier)return false;
  const option=Array.from(select.options).find(function(opt){
    return String(opt.textContent||opt.value||'').trim().toLocaleUpperCase('pt-BR')===String(supplier.nome||'').trim().toLocaleUpperCase('pt-BR');
  });
  if(option)select.value=option.value;
  else{
    const opt=document.createElement('option');
    opt.value=supplier.nome;
    opt.textContent=supplier.nome;
    select.appendChild(opt);
    select.value=supplier.nome;
  }
  return true;
}
function hideLegacySupplier(){
  const select=document.getElementById('cs-lanc-forn');
  if(!select)return;
  const host=select.closest('div[style*="flex:1"]')?.parentElement||select.parentElement;
  if(host)host.classList.add('phase4-po-legacy-supplier');
}
function supplierOptions(){
  return suppliers()
    .sort(function(a,b){return String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR');})
    .map(function(f){return '<option value="'+esc(f.nome||'')+'"></option>';})
    .join('');
}
function refreshSupplierOptions(){
 const list=document.getElementById('phase4-po-suppliers');
 if(list)list.innerHTML=supplierOptions();
}
document.addEventListener('erp:catalog-updated',event=>{
 if(event.detail?.type==='fornecedores')refreshSupplierOptions();
});
function normalizedMaterial(value){
 return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleUpperCase('pt-BR');
}
function duplicateMaterials(items){
 const groups=new Map();
 (items||[]).forEach((item,index)=>{
   const key=normalizedMaterial(item?.mat);if(!key)return;
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push(index+1);
 });
 return [...groups.entries()].filter(([,rows])=>rows.length>1);
}
function updateDuplicateWarnings(state){
 const warnings=document.getElementById('phase4-po-duplicate-warnings');
 const groups=duplicateMaterials(state?.items);
 if(warnings){
   warnings.hidden=!groups.length;
   warnings.textContent=groups.length?'Material repetido: '+groups.map(([name,rows])=>name+' (itens '+rows.join(' e ')+')').join('; ')+'. Confira se a repetição é intencional.':'';
 }
 const repeated=new Set(groups.flatMap(([,rows])=>rows));
 document.querySelectorAll('#phase4-po-items tr').forEach((row,index)=>{
   row.classList.toggle('phase4-po-duplicate-item',repeated.has(index+1));
   const input=row.querySelector('input[list="phase4-po-materials"]');
   if(input)input.setAttribute('aria-invalid',String(repeated.has(index+1)));
 });
}
function materialOptions(){
  return materials()
    .slice()
    .sort(function(a,b){return String(a||'').localeCompare(String(b||''),'pt-BR');})
    .map(function(m){return '<option value="'+esc(m)+'"></option>';})
    .join('');
}
function sourceTicketsHtml(state){
  if(!state.sourceTicketKeys?.length)return '';
  return '<div class="phase4-po-source"><span>Pesagens vinculadas</span>'+
    state.sourceTicketKeys.map(function(key){
      const t=tickets()[key]||{};
      const total=(t.itens||[]).reduce(function(sum,it){return sum+itemNet(it);},0)||
        (t.bags||[]).reduce(function(sum,it){return sum+Number(it.lq||it.br||0);},0)||
        Number(t.totalKg||0);
      return '<b>'+esc(t.ticket||key)+' · '+qty(total)+' kg</b>';
    }).join('')+
  '</div>';
}
function paymentHtml(state){
  if(state.editKey){
    const advances=Math.max(0,Number(state.appliedAdvance||0));
    const total=Number(state.originalTotal||0);
    const balance=Number(state.originalBalance||0);
    const previouslySettled=Math.max(0,Math.round((total-balance-advances)*100)/100);
    return '<div class="phase4-po-empty-pay" role="status">'+
      '<b>Histórico financeiro do pedido já registrado.</b> '+
      'Adiantamentos/abatimentos: R$ '+money(advances)+'. '+
      (previouslySettled>0.005?'Outras baixas ou ajustes já considerados: R$ '+money(previouslySettled)+'. ':'')+
      'Saldo original: '+(balance<0?'crédito R$ ':'R$ ')+money(Math.abs(balance))+'. '+
      'A edição dos itens não cria uma nova baixa nem reutiliza pagamentos. Alterações financeiras protegidas exigem conciliação.</div>';
  }
  const adts=(state.adts||[]).map(function(a,index){
    return '<label class="phase4-po-pay-row"><input type="checkbox" id="csadt-'+index+'" value="'+Number(a.valor||0)+'" onchange="phase4PurchaseRecalc()"><span><b>'+esc(a.cod||'Adiantamento')+'</b><small>'+esc(a.data||'')+' · '+esc(a.forma||a.bancoNome||'')+'</small></span><strong>R$ '+money(a.valor)+'</strong></label>';
  }).join('');
  const cheques=(state.cheques||[]).map(function(c,index){
    return '<label class="phase4-po-pay-row"><input type="checkbox" id="cscheq-'+index+'" value="'+Number(c.valor||0)+'" onchange="phase4PurchaseRecalc()"><span><b>Cheque '+esc(c.num||c.cod||'')+'</b><small>'+esc(c.bomPara||c.data||'')+' · '+esc(c.banco||c.bancoNome||c.forma||'')+'</small></span><strong>R$ '+money(c.valor)+'</strong></label>';
  }).join('');
  const credit=state.previousCredit>0
    ? '<label class="phase4-po-pay-row credit"><input type="checkbox" id="cssdv" value="'+Number(state.previousCredit||0)+'" onchange="phase4PurchaseRecalc()"><span><b>Crédito restante do fornecedor</b><small>Saldo disponível após compensações anteriores</small></span><strong>R$ '+money(state.previousCredit)+'</strong></label>'
    : '';
  const issues=(state.creditIssues||[]).length?'<div class="phase4-po-empty-pay" role="alert">Conciliação financeira necessária: '+(state.creditIssues||[]).map(esc).join(' ')+'</div>':'';
  if(!adts&&!cheques&&!credit&&!issues)return '<div class="phase4-po-empty-pay">Nenhum adiantamento, cheque ou crédito pendente para este fornecedor.</div>';
  return issues+adts+cheques+credit;
}
function render(body){
  if(!body)return;
  hideLegacySupplier();
  const state=currentState(body);
  const selected=state.supplierName||String(document.getElementById('cs-lanc-forn')?.value||'');
  state.supplierName=selected;
  body.dataset.itensCount=String(state.items.length);
  body.dataset.adtCount=String((state.adts||[]).length);
  body.dataset.cheqsCount=String((state.cheques||[]).length);
  body.dataset.saldoAnterior=String(Number(state.previousCredit||0));
  body.dataset.adtsData=JSON.stringify(state.adts||[]);
  body.dataset.cheqsData=JSON.stringify(state.cheques||[]);
  body.dataset.ticketKeys=JSON.stringify(state.sourceTicketKeys||[]);
  body.dataset.fornCod=state.supplierCode||body.dataset.fornCod||'';
  storeState(body,state);

  body.innerHTML='<div class="phase4-po">'+
    '<div class="phase4-po-title"><div><h2>'+(state.editKey?'Editar pedido de compra':'Pedido de compra')+'</h2><p>Compra de sucata</p></div><div class="phase4-po-title-actions"><button type="button" class="phase4-po-outline" onclick="phase4PurchaseCancel()">Cancelar</button><button type="button" class="phase4-po-save" onclick="phase4PurchaseSave()">Salvar</button></div></div>'+
    '<section class="phase4-po-card"><h3>Fornecedor</h3><label class="phase4-po-field full"><span>Fornecedor *</span><input id="phase4-po-supplier" list="phase4-po-suppliers" autocomplete="off" value="'+esc(selected)+'" placeholder="Digite ou selecione o fornecedor" onchange="phase4PurchaseSupplierChanged()" onfocus="phase4PurchaseRefreshSuppliers()" oninput="phase4PurchaseRefreshSuppliers()"><datalist id="phase4-po-suppliers">'+supplierOptions()+'</datalist></label>'+sourceTicketsHtml(state)+'</section>'+
    '<section class="phase4-po-card"><h3>Itens do pedido de compra</h3><div class="phase4-po-table-wrap"><table class="phase4-po-table"><thead><tr><th>#</th><th>Item / Material</th><th>Observação</th><th>Un.</th><th>Quantidade</th><th>Preço unitário</th><th>Preço total</th><th></th></tr></thead><tbody id="phase4-po-items"></tbody></table></div><datalist id="phase4-po-materials">'+materialOptions()+'</datalist><div id="phase4-po-duplicate-warnings" class="phase4-po-duplicate-warnings" role="status" aria-live="polite" hidden></div><button type="button" class="phase4-po-add-item" onclick="phase4PurchaseAddItem()" title="Adicionar material (Alt+Z)" aria-keyshortcuts="Alt+Z">＋ Adicionar outro item</button></section>'+
    '<section class="phase4-po-card phase4-po-notes-card" aria-labelledby="phase4-po-notes-title"><h3 id="phase4-po-notes-title">Observações</h3><label class="phase4-po-field phase4-po-order-notes" for="phase4-po-notes"><span>Observações do pedido</span><textarea id="phase4-po-notes" name="observacoesPedido" rows="4" placeholder="Digite as observações" oninput="phase4PurchaseSyncMeta()">'+esc(state.notes||'')+'</textarea></label></section>'+
    '<div class="phase4-po-columns">'+
      '<section class="phase4-po-card"><h3>Totais da compra</h3><div class="phase4-po-summary"><div><span>Nº de itens</span><b id="phase4-po-item-count">0</b></div><div><span>Soma das quantidades</span><b id="phase4-po-qty-total">0 kg</b></div><div><span>Total dos produtos</span><b id="phase4-po-products-total">R$ 0,00</b></div><div class="grand"><span>Total do pedido</span><b id="phase4-po-grand-total">R$ 0,00</b></div></div><div class="phase4-po-form-grid two"><label class="phase4-po-field"><span>Desconto R$</span><input id="phase4-po-discount" inputmode="decimal" value="'+esc(state.discount?money(state.discount):'0,00')+'" oninput="phase4PurchaseRecalc()"></label><label class="phase4-po-field"><span>Frete R$</span><input id="phase4-po-freight" inputmode="decimal" value="'+esc(state.freight?money(state.freight):'0,00')+'" oninput="phase4PurchaseRecalc()"></label></div></section>'+
      '<section class="phase4-po-card"><h3>Detalhes da compra</h3><div class="phase4-po-form-grid"><label class="phase4-po-field"><span>Número do pedido</span><input id="phase4-po-number" value="'+esc(state.orderNumber||'')+'" readonly title="Número atribuído automaticamente pelo cadastro de compras"></label><label class="phase4-po-field"><span>Ordem de compra</span><input id="phase4-po-order" value="'+esc(state.purchaseOrder||'')+'" oninput="phase4PurchaseSyncMeta()"></label><label class="phase4-po-field"><span>Data da compra</span><input id="phase4-po-date" type="date" value="'+esc(state.purchaseDate||today())+'" onchange="phase4PurchaseSyncMeta()"></label></div></section>'+
    '</div>'+
    '<section class="phase4-po-card"><h3>Pagamento</h3><div class="phase4-po-payment-head"><label class="phase4-po-field"><span>Vencimento do saldo</span><input id="cs-lanc-venc" type="date" value="'+esc(state.dueDate||today())+'" onchange="phase4PurchaseSyncMeta()"></label><div class="phase4-po-payment-total"><span>Adiantamentos / abatimentos</span><b id="phase4-po-advance-total">R$ 0,00</b></div><div class="phase4-po-payment-total main"><span>Saldo a pagar</span><b id="phase4-po-balance">R$ 0,00</b></div></div><div class="phase4-po-pay-list">'+paymentHtml(state)+'</div></section>'+
    '<div class="phase4-po-footer"><button type="button" class="phase4-po-outline" onclick="phase4PurchaseCancel()">Cancelar</button><button type="button" class="phase4-po-save" onclick="phase4PurchaseSave()">Salvar pedido de compra</button></div>'+
  '</div>';
  renderItems(body,state);
  global.phase4PurchaseRecalc();
}
function renderItems(body,state){
  const tbody=document.getElementById('phase4-po-items');
  if(!tbody)return;
  tbody.innerHTML=(state.items||[]).map(function(item,index){
    const total=Number(item.quantidade||0)*Number(item.preco||0);
    return '<tr data-row="'+esc(item.id)+'">'+
      '<td class="idx">'+(index+1)+'</td>'+
      '<td><input list="phase4-po-materials" value="'+esc(item.mat)+'" placeholder="Material" oninput="phase4PurchaseItem('+index+',\'mat\',this.value)"></td>'+
      '<td class="description"><button type="button" class="phase4-po-detail-button '+(String(item.descricao||'').trim()?'active':'')+'" onclick="phase4PurchaseOpenDescription('+index+')" title="'+(String(item.descricao||'').trim()?'Descrição detalhada preenchida':'Adicionar descrição detalhada')+'"><span class="phase4-po-detail-icon">📄</span><span class="phase4-po-detail-label">'+(String(item.descricao||'').trim()?'Preenchida':'Adicionar')+'</span></button></td>'+
      '<td><span class="phase4-po-unit">'+esc(item.unidade||'kg')+'</span></td>'+
      '<td><input inputmode="decimal" value="'+esc(item.quantidade?String(item.quantidade).replace('.',','):'')+'" placeholder="0" '+(item.source&&!state.editKey?'readonly title="Quantidade originada da pesagem"':'')+' oninput="phase4PurchaseItem('+index+',\'quantidade\',this.value)"></td>'+
      '<td><input inputmode="decimal" value="'+esc(item.preco?money(item.preco):'')+'" placeholder="0,00" oninput="phase4PurchaseItem('+index+',\'preco\',this.value)"></td>'+
      '<td class="total"><input class="phase4-po-row-total" id="phase4-po-row-total-'+index+'" type="text" readonly tabindex="-1" aria-label="Preço total do item '+(index+1)+'" value="R$ '+money(total)+'"></td>'+
      '<td class="action">'+(item.source&&!state.editKey?'<span class="phase4-po-locked" title="Item vindo da pesagem">🔒</span>':'<button type="button" title="Remover item" onclick="phase4PurchaseRemoveItem('+index+')">✕</button>')+'</td>'+
    '</tr>';
  }).join('');
  updateDuplicateWarnings(state);
}
function getState(){
  const body=document.getElementById('cs-lanc-body');
  return [body,currentState(body)];
}
global.phase4PurchaseItem=function(index,field,value){
  const tuple=getState(),body=tuple[0],state=tuple[1];
  const item=state.items?.[index];if(!item)return;
  if(field==='quantidade'||field==='preco')item[field]=Math.max(0,parseBR(value));
  else item[field]=String(value||'');
  storeState(body,state);
  const total=document.getElementById('phase4-po-row-total-'+index);
  if(total)total.value='R$ '+money(Number(item.quantidade||0)*Number(item.preco||0));
  global.phase4PurchaseRecalc();
  updateDuplicateWarnings(state);
};
global.phase4PurchaseAddItem=function(){
  const tuple=getState(),body=tuple[0],state=tuple[1];
  state.items.push(newItem());
  storeState(body,state);
  renderItems(body,state);
  global.phase4PurchaseRecalc();
  setTimeout(function(){
    const row=document.querySelector('#phase4-po-items tr:last-child input');
    if(row)row.focus();
  },0);
};

document.addEventListener('keydown',function(ev){
  if(!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || String(ev.key||'').toLowerCase()!=='z')return;
  const panel=document.getElementById('cst-lancamento');
  if(!panel || panel.style.display==='none' || !panel.querySelector('.phase4-po'))return;
  ev.preventDefault();
  global.phase4PurchaseAddItem();
});

global.phase4PurchaseRemoveItem=function(index){
  const tuple=getState(),body=tuple[0],state=tuple[1];
  if(state.items?.[index]?.source&&!state.editKey)return;
  state.items.splice(index,1);
  if(!state.items.length)state.items.push(newItem());
  storeState(body,state);
  renderItems(body,state);
  global.phase4PurchaseRecalc();
};

global.phase4PurchaseOpenDescription=function(index){
  const tuple=getState(),body=tuple[0],state=tuple[1];
  const item=state.items?.[index];
  if(!body||!item)return;
  document.getElementById('phase4-po-description-overlay')?.remove();
  const ov=document.createElement('div');
  ov.id='phase4-po-description-overlay';
  ov.className='phase4-po-description-overlay';
  ov.innerHTML='<div class="phase4-po-description-modal"><header><div><h3>Descrição detalhada</h3><small>'+esc(item.mat||'Item '+(index+1))+'</small></div><button type="button" onclick="phase4PurchaseCloseDescription()" aria-label="Fechar">✕</button></header><textarea id="phase4-po-description-text" rows="8" placeholder="Detalhes do material, observações de qualidade, classificação ou instruções para o pedido...">'+esc(item.descricao||'')+'</textarea><footer><button type="button" class="phase4-po-outline" onclick="phase4PurchaseCloseDescription()">Cancelar</button><button type="button" class="phase4-po-save" onclick="phase4PurchaseSaveDescription('+index+')">Salvar descrição</button></footer></div>';
  document.body.appendChild(ov);
  setTimeout(function(){document.getElementById('phase4-po-description-text')?.focus();},0);
};
global.phase4PurchaseCloseDescription=function(){document.getElementById('phase4-po-description-overlay')?.remove();};
global.phase4PurchaseSaveDescription=function(index){
  const tuple=getState(),body=tuple[0],state=tuple[1];
  const item=state.items?.[index];if(!body||!item)return;
  item.descricao=String(document.getElementById('phase4-po-description-text')?.value||'').trim();
  storeState(body,state);
  renderItems(body,state);
  global.phase4PurchaseCloseDescription();
};
function readOrderNotes(state){
  const field=document.getElementById('phase4-po-notes');
  return String(field?field.value:(state?.notes||'')).trim();
}
global.phase4PurchaseSyncMeta=function(){
  const tuple=getState(),body=tuple[0],state=tuple[1];
  state.orderNumber=String(document.getElementById('phase4-po-number')?.value||state.orderNumber||'').trim();
  state.purchaseOrder=String(document.getElementById('phase4-po-order')?.value||state.purchaseOrder||'').trim();
  state.purchaseDate=document.getElementById('phase4-po-date')?.value||state.purchaseDate||today();
  state.dueDate=document.getElementById('cs-lanc-venc')?.value||state.dueDate||today();
  state.notes=readOrderNotes(state);
  storeState(body,state);
};
global.phase4PurchaseRecalc=function(){
  const tuple=getState(),body=tuple[0],state=tuple[1];
  if(!body)return;
  state.discount=Math.max(0,parseBR(document.getElementById('phase4-po-discount')?.value||state.discount));
  state.freight=Math.max(0,parseBR(document.getElementById('phase4-po-freight')?.value||state.freight));
  state.supplierName=selectedSupplierName()||state.supplierName;
  state.orderNumber=String(document.getElementById('phase4-po-number')?.value||state.orderNumber||'').trim();
  state.purchaseOrder=String(document.getElementById('phase4-po-order')?.value||state.purchaseOrder||'').trim();
  state.purchaseDate=document.getElementById('phase4-po-date')?.value||state.purchaseDate||today();
  state.dueDate=document.getElementById('cs-lanc-venc')?.value||state.dueDate||today();

  const productTotal=(state.items||[]).reduce(function(sum,item){
    return sum+Number(item.quantidade||0)*Number(item.preco||0);
  },0);
  const total=Math.max(0,Math.round((productTotal-state.discount+state.freight+Number(state.legacyExtra||0))*100)/100);
  let advances=0;
  (state.adts||[]).forEach(function(_,index){
    const checkbox=document.getElementById('csadt-'+index);
    if(checkbox?.checked)advances+=Number(checkbox.value||0);
  });
  (state.cheques||[]).forEach(function(_,index){
    const checkbox=document.getElementById('cscheq-'+index);
    if(checkbox?.checked)advances+=Number(checkbox.value||0);
  });
  const credit=document.getElementById('cssdv');
  if(credit?.checked)advances+=Number(credit.value||0);
  if(state.editKey){
    advances=Math.max(0,Number(state.appliedAdvance||0));
  }
  if(!state.editKey)advances=Math.min(total,advances);
  const balance=state.editKey
    ? Math.round((Number(state.originalBalance||0)+(total-Number(state.originalTotal||0)))*100)/100
    : Math.round((total-advances)*100)/100;

  const set=function(id,text){const el=document.getElementById(id);if(el)el.textContent=text;};
  set('phase4-po-item-count',String((state.items||[]).filter(function(i){return i.mat||Number(i.quantidade)>0;}).length));
  set('phase4-po-qty-total',qty((state.items||[]).reduce(function(sum,item){return sum+Number(item.quantidade||0);},0))+' kg');
  set('phase4-po-products-total','R$ '+money(productTotal));
  set('phase4-po-grand-total','R$ '+money(total));
  set('phase4-po-advance-total','R$ '+money(advances));
  const reducesSettled=Boolean(state.editKey&&balance<0&&Number(state.originalBalance||0)>=0);
  const refundsAdvance=reducesSettled&&state.advanceRefundable===true&&Math.abs(balance)<=Number(state.appliedAdvance||0)+0.005;
  const requiresReconciliation=reducesSettled&&!refundsAdvance;
  set('phase4-po-balance',refundsAdvance
    ? 'R$ 0,00 · volta ao adiantamento: R$ '+money(Math.abs(balance))
    : requiresReconciliation
      ? 'Requer conciliação: R$ '+money(Math.abs(balance))
      : (balance<0?'Crédito R$ ':'R$ ')+money(Math.abs(balance)));
  const balanceEl=document.getElementById('phase4-po-balance');
  if(balanceEl){
    balanceEl.classList.toggle('credit',balance<0&&!requiresReconciliation);
    balanceEl.title=refundsAdvance?'Ao salvar, a diferença volta como saldo disponível do adiantamento usado nesta compra.'
      :requiresReconciliation?'Compra já liquidada: revisão financeira necessária antes de alterar o total.':'';
  }
  storeState(body,state);
  return {productTotal,total,advances,balance};
};
global.phase4PurchaseSupplierChanged=function(){
  const input=document.getElementById('phase4-po-supplier');
  const typed=String(input?.value||'').trim();
  const supplier=supplierByName(typed);
  if(supplierChangeTimer!==null)clearTimeout(supplierChangeTimer);
  if(!supplier){
    if(typed){try{showToast('Selecione um fornecedor cadastrado na lista.','error');}catch(e){}}
    return;
  }
  const body=document.getElementById('cs-lanc-body');
  const state=body?currentState(body):null;
  if(state?.editKey){try{showToast('O fornecedor não pode ser alterado na edição deste pedido.','info');}catch(e){}if(input)input.value=state.supplierName;return;}
  if(state&&String(state.supplierCode||'')===String(supplier.cod||'')&&state.supplierName===supplier.nome)return;
  supplierChangeTimer=setTimeout(function(){
    supplierChangeTimer=null;
    if(!document.getElementById('cs-lanc-body')||document.getElementById('phase4-po-supplier')!==input)return;
    if(document.activeElement===input)input.blur();
    if(!setHiddenSupplier(supplier.nome))return;
    if(manualMode){
      const target=document.getElementById('cs-lanc-body');if(!target)return;
      const next=currentState(target);
      const fin=financialData(null,supplier.cod);
      next.supplierName=supplier.nome;
      next.supplierCode=supplier.cod||'';
      next.adts=fin.adts;
      next.cheques=fin.cheques;
      next.previousCredit=fin.balance;
      next.creditSource=fin.creditSource||'';
      next.creditIssues=fin.issues||[];
      next.sourceTicketKeys=[];
      if(!next.items?.length)next.items=[newItem()];
      storeState(target,next);
      render(target);
      return;
    }
    global.csCarregarForn(supplier.nome);
  },0);
};
global.phase4PurchaseRefreshSuppliers=refreshSupplierOptions;
function prepareLegacy(body,state){
  const supplier=supplierByName(state.supplierName||selectedSupplierName());
  if(!supplier)throw new Error('Selecione um fornecedor cadastrado.');
  if(!setHiddenSupplier(supplier.nome))throw new Error('Fornecedor não encontrado no cadastro.');
  const valid=(state.items||[]).filter(function(item){
    return String(item.mat||'').trim()&&Number(item.quantidade||0)>0;
  });
  if(!valid.length)throw new Error('Adicione pelo menos um item com material e quantidade.');
  const legacyItems=valid.map(function(item){
    return {
      mat:String(item.mat||'').trim().toUpperCase(),
      matBase:String(item.mat||'').trim().toUpperCase(),
      ident:'',
      descricaoDetalhada:String(item.descricao||'').trim(),
      obs:String(item.descricao||'').trim(),
      pesoBruto:Number(item.pesoBruto||item.quantidade||0),
      pesoLiq:Number(item.quantidade||0),
      preco:Number(item.preco||0)
    };
  });
  body.dataset.itensData=JSON.stringify(legacyItems);
  body.dataset.itensCount=String(legacyItems.length);
  body.dataset.fornCod=supplier.cod||'';
  body.dataset.adtCount=String((state.adts||[]).length);
  body.dataset.cheqsCount=String((state.cheques||[]).length);
  body.dataset.adtsData=JSON.stringify(state.adts||[]);
  body.dataset.cheqsData=JSON.stringify(state.cheques||[]);
  body.dataset.ticketKeys=JSON.stringify(state.sourceTicketKeys||[]);
  body.querySelectorAll('.phase4-po-legacy-price').forEach(function(el){el.remove();});
  legacyItems.forEach(function(item,index){
    const input=document.createElement('input');
    input.type='hidden';
    input.id='cspr-'+index;
    input.className='phase4-po-legacy-price';
    input.value=String(Number(item.preco||0));
    body.appendChild(input);
  });
  state.items=valid;
  state.supplierName=supplier.nome;
  state.supplierCode=supplier.cod||'';
  storeState(body,state);
  return {supplier,legacyItems};
}
function syncPrices(state){
  if(!state.supplierCode)return;
  try{
    if(!PRECOS_FORN_DATA[state.supplierCode])PRECOS_FORN_DATA[state.supplierCode]={};
    if(!PRECOS_FORN_DATA[state.supplierCode]._datas)PRECOS_FORN_DATA[state.supplierCode]._datas={};
    const date=state.purchaseDate?state.purchaseDate.split('-').reverse().join('/'):'';
    state.items.forEach(function(item){
      if(item.mat&&Number(item.preco)>0){
        PRECOS_FORN_DATA[state.supplierCode][String(item.mat).trim().toUpperCase()]=Number(item.preco);
        PRECOS_FORN_DATA[state.supplierCode]._datas[String(item.mat).trim().toUpperCase()]=date;
      }
    });
    localStorage.setItem('mm_precos_forn',JSON.stringify(PRECOS_FORN_DATA));
  }catch(e){console.warn('[purchase-order] preços',e);}
}
function syncPayable(ticket,state,totals){
  try{
    const ticketNo=String(ticket.ticket||'');
    let cp=(CONTAS_PAGAR||[]).find(function(row){return String(row.ticket||'')===ticketNo&&row.status!=='Pago';});
    const due=state.dueDate?state.dueDate.split('-').reverse().join('/'):(ticket.data||'');
    if(totals.balance>0.005){
      if(!cp){
        cp={
          id:typeof _novoIdCP==='function'?_novoIdCP():'CP'+Date.now(),
          lancto:state.purchaseDate?state.purchaseDate.split('-').reverse().join('/'):(ticket.data||''),
          desc:'Compra de Sucata — '+state.supplierName+' — '+ticketNo,
          cred:state.supplierName,
          cat:'Compra de Sucata',
          bancoCod:'',
          bancoNome:'',
          tipoForn:'compra',
          venc:due,
          valor:totals.balance,
          status:'Pendente',
          dataPgto:'',
          obs:'Gerado automaticamente — Pedido '+(state.orderNumber||ticketNo),
          ticket:ticketNo,
          fornCod:state.supplierCode
        };
        CONTAS_PAGAR.push(cp);
      }else{
        cp.valor=totals.balance;
        cp.venc=due;
        cp.lancto=state.purchaseDate?state.purchaseDate.split('-').reverse().join('/'):(ticket.data||cp.lancto||'');
        cp.desc='Compra de Sucata — '+state.supplierName+' — '+ticketNo;
        cp.obs='Pedido '+(state.orderNumber||ticketNo)+(state.purchaseOrder?' · OC '+state.purchaseOrder:'')+(state.discount?' · Desconto R$ '+money(state.discount):'')+(state.freight?' · Frete R$ '+money(state.freight):'');
      }
    }else if(cp){
      const index=CONTAS_PAGAR.indexOf(cp);
      if(index>=0)CONTAS_PAGAR.splice(index,1);
    }
    if(!global.__ERP_PURCHASE_IN_PROGRESS__ && typeof saveContasPagar==='function')saveContasPagar();
    if(typeof renderContasPagar==='function')renderContasPagar();
  }catch(e){console.warn('[purchase-order] contas a pagar',e);}
}
function syncSupplierCredit(ticket,state,totals){
  if(!state.supplierCode)return;
  try{
    const selected=document.getElementById('cssdv');
    const used=!!selected?.checked&&Number(state.previousCredit||0)>0;
    const applied=Math.min(Math.max(0,Number(state.previousCredit||0)),Math.max(0,Number(totals.total||0)));
    ticket.creditoFornecedorAplicado=used?Math.round(applied*100)/100:0;
    ticket.creditoFornecedorOrigem=used?String(state.creditSource||''):'';
    const raw=SALDO_DEVEDOR_FORN[state.supplierCode];
    const sourceTicket=typeof linkedPurchase==='function'&&typeof raw==='object'&&raw?.ticket?linkedPurchase(raw.ticket,state.supplierCode):null;
    const duplicate=sourceTicket&&(state.adts||[]).some(function(a,index){
      if(!document.getElementById('csadt-'+index)?.checked)return false;
      return (sourceTicket?.reciboFinanceiro?.adiantamentos||[]).some(function(row){return String(row?.cod||'')===String(a.cod||'');})||
        String(sourceTicket?.creditoFornecedorOrigem||'')===String(a.cod||'');
    });
    if(duplicate){
      delete SALDO_DEVEDOR_FORN[state.supplierCode];
      localStorage.setItem('mm_saldo_devedor',JSON.stringify(SALDO_DEVEDOR_FORN));
    }
    if(used){
      const remaining=Math.round(Math.max(0,Number(state.previousCredit||0)-applied)*100)/100;
      if(remaining>0){
        SALDO_DEVEDOR_FORN[state.supplierCode]={valor:remaining,ticket:String(ticket.ticket||''),data:state.purchaseDate||today()};
      }else{
        delete SALDO_DEVEDOR_FORN[state.supplierCode];
      }
      localStorage.setItem('mm_saldo_devedor',JSON.stringify(SALDO_DEVEDOR_FORN));
    }
  }catch(e){console.warn('[purchase-order] saldo fornecedor',e);}
}
function patchCreatedTicket(key,state,legacyItems,totals){
  const ticket=tickets()[key];
  if(!ticket)return null;
  ticket.itens=(ticket.itens||[]).map(function(item,index){
    const source=legacyItems[index]||{};
    const amount=Number(source.pesoLiq||item.pesoLiq||0);
    const price=Number(source.preco||item.preco||0);
    return Object.assign({},item,{
      mat:String(source.mat||item.mat||'').trim().toUpperCase(),
      matBase:String(source.mat||item.matBase||item.mat||'').trim().toUpperCase(),
      ident:'',
      descricaoDetalhada:String(source.descricaoDetalhada||'').trim(),
      descricao:String(source.descricaoDetalhada||'').trim(),
      obs:String(source.descricaoDetalhada||'').trim(),
      unidade:'kg',
      quantidade:amount,
      pesoBruto:Number(source.pesoBruto||amount),
      pesoLiq:amount,
      preco:price,
      subtotal:amount*price,
      total:amount*price
    });
  });
  ticket.numeroPedido=String(ticket.ticket||key);
  ticket.ordemCompra=state.purchaseOrder||'';
  ticket.dataCompra=state.purchaseDate||today();
  ticket.data=ticket.dataCompra;
  ticket.vencimentoSaldo=state.dueDate||today();
  ticket.observacoesPedido=String(state.notes||'').trim();
  ticket.descontoCompra=Number(state.discount||0);
  ticket.freteCompra=Number(state.freight||0);
  ticket.acrescimo=0;
  ticket.acrescimos=[];
  ticket.totalProdutos=totals.productTotal;
  ticket.totalGeral=totals.total;
  ticket.totalKg=(ticket.itens||[]).reduce(function(sum,item){return sum+Number(item.quantidade||item.pesoLiq||0);},0);
  ticket.saldoPagar=Math.max(0,totals.balance);
  ticket.status=totals.balance<=0.005?'Pago':'Pendente';
  ticket.pedidoCompra={
    versao:1,
    numero:ticket.numeroPedido,
    ordemCompra:ticket.ordemCompra,
    dataCompra:ticket.dataCompra,
    vencimentoSaldo:ticket.vencimentoSaldo,
    observacoes:ticket.observacoesPedido,
    desconto:ticket.descontoCompra,
    frete:ticket.freteCompra,
    totalProdutos:ticket.totalProdutos,
    totalPedido:ticket.totalGeral
  };
  syncPayable(ticket,state,totals);
  syncSupplierCredit(ticket,state,totals);
  syncPrices(state);
  if(!global.__ERP_PURCHASE_IN_PROGRESS__){
    try{saveDB();}catch(e){}
    try{if(typeof fbSalvarImediato==='function')fbSalvarImediato();}catch(e){}
  }
  try{if(typeof renderTickets==='function')renderTickets();}catch(e){}
  try{if(typeof renderDashboard==='function')renderDashboard();}catch(e){}
  return ticket;
}
const legacyFbSalvar=typeof global.fbSalvar==='function'?global.fbSalvar.bind(global):null;
const legacyFbSalvarImediato=typeof global.fbSalvarImediato==='function'?global.fbSalvarImediato.bind(global):null;
if(legacyFbSalvar)global.fbSalvar=function(){
  if(global.__ERP_PURCHASE_IN_PROGRESS__){global.__ERP_PURCHASE_DEFERRED_SAVE__=true;return;}
  return legacyFbSalvar(...arguments);
};
if(legacyFbSalvarImediato)global.fbSalvarImediato=function(){
  if(global.__ERP_PURCHASE_IN_PROGRESS__){global.__ERP_PURCHASE_DEFERRED_SAVE__=true;return;}
  return legacyFbSalvarImediato(...arguments);
};
function schedulePostPurchaseSave(){
  try{if(typeof global.fbSalvar==='function')setTimeout(function(){try{global.fbSalvar();}catch(_e){}},0);}catch(_e){}
}
function finishPurchaseDeferredSave(success){
  global.__ERP_PURCHASE_IN_PROGRESS__=false;
  const deferred=global.__ERP_PURCHASE_DEFERRED_SAVE__===true;
  global.__ERP_PURCHASE_DEFERRED_SAVE__=false;
  if(success&&deferred&&legacyFbSalvar)legacyFbSalvar();
}

const purchasePendingKeys=global.__ERP_PURCHASE_PENDING_KEYS__ instanceof Set
  ?global.__ERP_PURCHASE_PENDING_KEYS__:new Set();
global.__ERP_PURCHASE_PENDING_KEYS__=purchasePendingKeys;
function purchaseStableSnapshot(value){
  if(Array.isArray(value))return '['+value.map(purchaseStableSnapshot).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(function(key){return JSON.stringify(key)+':'+purchaseStableSnapshot(value[key]);}).join(',')+'}';
  return JSON.stringify(value);
}
function purchaseRememberServerAck(key, ticket){
  if(!ticket || !ticket._purchaseOperationId)return;
  const recent=global.__ERP_PURCHASE_RECENT_CONFIRMED__ instanceof Map
    ?global.__ERP_PURCHASE_RECENT_CONFIRMED__:new Map();
  global.__ERP_PURCHASE_RECENT_CONFIRMED__=recent;
  recent.set(String(key),{ticket:JSON.parse(JSON.stringify(ticket)),ts:Date.now()});
}
function purchaseCloudRef(key){
  if(!/^[A-Za-z0-9_-]{1,72}$/.test(String(key||'')))throw new Error('Identificador inválido do pedido.');
  if(!global._fbDB || typeof global._fbDB.ref!=='function')throw new Error('Firebase indisponível. Nenhum pedido foi confirmado.');
  if(!global.firebase?.auth?.()?.currentUser)throw new Error('Sessão Firebase expirada. Entre novamente antes de salvar.');
  return global._fbDB.ref('erp/tickets/'+key);
}
async function purchaseConfirmCloud(key,ticket,options={}){
  const id=String(key||'').trim();
  const ref=purchaseCloudRef(id);
  const create=options.create===true;
  if(!ticket || (create && String(ticket.ticket||id)!==id) || !Array.isArray(ticket.itens) || !ticket.itens.length)
    throw new Error('Pedido incompleto; não foi enviado ao Firebase.');
  const payload=JSON.parse(JSON.stringify(ticket));
  if(create){
    if(typeof TICKETS_DELETED!=='undefined' && TICKETS_DELETED.has(id))
      throw new Error('Este número está marcado como excluído. Não é seguro reutilizá-lo.');
    const removed=await global._fbDB.ref('erp/ticketsDeletedV2/'+id).once('value');
    if(removed?.val?.())throw new Error('Este número está excluído na nuvem. Use outro identificador.');
  }
  const expected=options.expected||null;
  const runTx=typeof global.__erpRunTransaction==='function'
    ?function(fn){return global.__erpRunTransaction(ref,fn);}
    :function(fn){return ref.transaction(fn,undefined,false);};
  const tx=await runTx(function(current){
    if(create){
      if(current!==null&&current!==undefined){
        if(payload._purchaseOperationId && current._purchaseOperationId===payload._purchaseOperationId
            && purchaseStableSnapshot(current)===purchaseStableSnapshot(payload))return current;
        return;
      }
      return payload;
    }
    if(!current || typeof current!=='object')return;
    if(options.expectedSnapshot && purchaseStableSnapshot(current)!==options.expectedSnapshot)return;
    if(expected && (Math.abs(Number(current.totalGeral||0)-Number(expected.totalGeral||0))>0.01
      || Math.abs(Number(current.saldoPagar||0)-Number(expected.saldoPagar||0))>0.01))return;
    return payload;
  });
  if(!tx || tx.committed!==true)throw new Error(create
    ?'Número de pedido já existe no Firebase. Nenhum pedido existente foi substituído.'
    :'O pedido foi alterado em outra sessão. Reabra o histórico antes de editar.');
  const verified=await ref.once('value');
  const saved=verified?.val?.();
  if(!saved || String(saved.ticket||'')!==String(payload.ticket||id)
     || Math.abs(Number(saved.totalGeral||0)-Number(payload.totalGeral||0))>0.01
     || String(saved.fornecedorCod||'')!==String(payload.fornecedorCod||''))
     throw new Error('O Firebase ainda não confirmou o conteúdo do pedido. Verifique o número na nuvem antes de tentar novamente.');
  try{
    if(typeof TICKETS_DB!=='undefined')TICKETS_DB[id]=Object.assign({},saved);
    if(typeof _ticketsSnapJSON!=='undefined')_ticketsSnapJSON[id]=JSON.stringify(saved);
  }catch(e){}
  if(create)purchaseRememberServerAck(id,saved);
  return saved;
}
global.__ERP_PURCHASE_COMMIT_TICKET__=purchaseConfirmCloud;
async function purchaseCreateAtomic(key,ticket,state,body){
  const user=global.firebase?.auth?.()?.currentUser;
  if(!user?.getIdToken)throw new Error('Sessão Firebase inválida. Nenhuma compra foi registrada.');
  const advanceCodes=(state.adts||[]).filter(function(_,i){return document.getElementById('csadt-'+i)?.checked;}).map(function(a){return String(a.cod||'');});
  const chequeIds=(state.cheques||[]).filter(function(c,i){return document.getElementById('cscheq-'+i)?.checked&&!c.cod;}).map(function(c){return String(c.id||c.num||c.numero||'');});
  (state.cheques||[]).filter(function(c,i){return document.getElementById('cscheq-'+i)?.checked&&c.cod;}).forEach(function(c){advanceCodes.push(String(c.cod));});
  const useLegacyCredit=Boolean(document.getElementById('cssdv')?.checked&&state.previousCredit>0);
  if(useLegacyCredit&&(advanceCodes.length||chequeIds.length))throw new Error('Selecione somente o crédito residual OU outros adiantamentos/cheques nesta compra.');
  const operationId=body.dataset.purchaseOperationId;
  const payload=JSON.stringify({operationId,ticketNo:key,fornecedorCod:state.supplierCode,ticket,
    advanceCodes,chequeIds,useLegacyCredit,sourceTicketKeys:state.sourceTicketKeys||[]});
  let response=null,result={},networkError=null;
  for(let attempt=1;attempt<=3;attempt++){
    networkError=null;
    try{
      response=await fetch('/api/finance/purchase-order-create',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{Authorization:'Bearer '+await user.getIdToken(),'Content-Type':'application/json'},
        body:payload
      });
      result=await response.json().catch(()=>({}));
    }catch(error){networkError=error;response=null;result={};}
    const transient=networkError||(response&&(response.status===503||response.status===502||response.status===504||
      (response.status===409&&result.code==='PURCHASE_IN_PROGRESS')));
    if(!transient||attempt===3)break;
    const wait=Math.min(6,Math.max(1,Number(result.retryAfterSeconds)||attempt*1.5));
    try{showToast('Conexão instável: confirmando o pedido novamente com segurança ('+(attempt+1)+'/3)...','info',Math.round(wait*1000)+1500);}catch(_e){}
    await new Promise(function(resolve){setTimeout(resolve,wait*1000);});
  }
  if(networkError){
    const error=new Error('Sem resposta do servidor. O pedido pode ter sido gravado: confira o Histórico antes de repetir.');
    error.code='NETWORK_ERROR';throw error;
  }
  if(!response.ok||!result.ticket){
    const error=new Error(result.message||'Não foi possível confirmar a compra e seus créditos no servidor. Verifique o histórico antes de repetir.');
    error.code=String(result.code||'');error.status=response.status;throw error;
  }
  if(result.ticket.ticket!==key)throw new Error('A confirmação do pedido retornou identificador divergente.');
  const clone=function(v){return v==null?v:JSON.parse(JSON.stringify(v));};
  const arrayRows=function(v){return Array.isArray(v)?clone(v):Object.values(clone(v)||{});};
  TICKETS_DB[key]=clone(result.ticket);
  for(const source of state.sourceTicketKeys||[]){
    if(TICKETS_DB[source]){TICKETS_DB[source]._consolidadoEm=key;TICKETS_DB[source].status='Consolidado';TICKETS_DB[source]._balFinalizado=false;}
  }
  ADT_POR_FORN[state.supplierCode]=arrayRows(result.advances);
  CHEQUES_POR_FORN[state.supplierCode]=arrayRows(result.cheques);
  if(result.saldo==null)delete SALDO_DEVEDOR_FORN[state.supplierCode];
  else{
    SALDO_DEVEDOR_FORN[state.supplierCode]=clone(result.saldo);
    try{
      if(typeof _DEL_SETS!=='undefined'&&_DEL_SETS.saldoDevedor?.delete(state.supplierCode)&&typeof _DEL_LS_KEY!=='undefined')
        localStorage.setItem(_DEL_LS_KEY.saldoDevedor,JSON.stringify([..._DEL_SETS.saldoDevedor]));
    }catch(_e){}
  }
  try{localStorage.setItem('mm_saldo_devedor',JSON.stringify(SALDO_DEVEDOR_FORN));}catch(_e){}
  if(Array.isArray(CONTAS_PAGAR)){
    for(let i=CONTAS_PAGAR.length-1;i>=0;i--)if(String(CONTAS_PAGAR[i]?.ticket||'')===key)CONTAS_PAGAR.splice(i,1);
    if(result.payable)CONTAS_PAGAR.push(clone(result.payable));
  }
  try{if(typeof _ticketsSnapJSON!=='undefined')_ticketsSnapJSON[key]=JSON.stringify(result.ticket);}catch(_e){}
  purchaseRememberServerAck(key,result.ticket);
  return result.ticket;
}

function sourceSignature(keys){
  return (keys||[]).map(String).filter(Boolean).sort().join('|');
}
function existingPurchaseForSources(keys){
  const signature=sourceSignature(keys);if(!signature)return null;
  return Object.entries(tickets()).find(function(entry){
    const t=entry[1]||{};
    return t._consolidado===true&&sourceSignature(t._ticketsOrigemIds||[])===signature;
  })||null;
}
function validateSourceTickets(state){
  const keys=(state.sourceTicketKeys||[]).filter(Boolean);
  if(!keys.length)return;
  const duplicate=existingPurchaseForSources(keys);
  if(duplicate)throw new Error('Esta pesagem já foi fechada no pedido '+String(duplicate[1]?.ticket||duplicate[0])+'.');
  const invalid=keys.find(function(key){
    const t=tickets()[key];
    return !t||t.status!=='Aguard. Preço'||!t._balFinalizado||t._balSessao||t._rodEntrada;
  });
  if(invalid)throw new Error('A pesagem '+String(tickets()[invalid]?.ticket||invalid)+' não está mais aguardando fechamento. Atualize a fila.');
}
async function validateCloudSourceTickets(state){
  const ids=[...new Set((state.sourceTicketKeys||[]).map(String).filter(Boolean))];
  if(!ids.length)return;
  const entries=await Promise.all(ids.map(async id=>({id,value:(await purchaseCloudRef(id).once('value')).val()})));
  const invalid=entries.find(({value})=>!value||value.status!=='Aguard. Preço'
    ||!value._balFinalizado||value._consolidadoEm||value._balSessao||value._rodEntrada);
  if(invalid)throw new Error('A pesagem '+invalid.id+' já foi fechada ou mudou em outra sessão. Atualize a lista para não gerar um pedido duplicado.');
}
function setSaving(value){
  saving=!!value;
  document.querySelectorAll('.phase4-po-save').forEach(function(button){
    button.disabled=saving;
    button.classList.toggle('saving',saving);
    if(saving)button.dataset.originalText=button.textContent;
    button.textContent=saving?'Salvando...':(button.dataset.originalText||button.textContent);
  });
}
function resetOrderState(body){
  if(!body)return;
  ['phase4Order','itensData','ticketKeys','adtsData','cheqsData','saldoAnterior','fornCod','itensCount','adtCount','cheqsCount','phase1Extras','phase1Enhanced','purchaseOperationId','purchaseReservedNumber'].forEach(function(key){delete body.dataset[key];});
  body.querySelectorAll('.phase4-po-legacy-price').forEach(function(el){el.remove();});
  body.innerHTML='<div class="phase4-po-saved-empty">Pedido concluído. Selecione uma nova pesagem em <b>Pesagens a fechar</b> ou use <b>+ Nova Entrada</b>.</div>';
  const select=document.getElementById('cs-lanc-forn');if(select)select.value='';
  activeSourceTicketKey='';
}
function finishPurchaseSave(body,key,ticket,totals){
  manualMode=false;
  resetOrderState(body);
  try{if(typeof csRenderPesagens==='function')csRenderPesagens();}catch(e){}
  try{if(typeof renderTickets==='function')renderTickets();}catch(e){}
  if(typeof global.csTab==='function')global.csTab('historico');
  try{showToast('Pedido '+String(ticket?.numeroPedido||ticket?.ticket||key)+' salvo e fechado. Total R$ '+money(totals.total)+'.','success',6000);}catch(e){}
}
function purchaseTakeLocalSnapshot(state){
  const code=String(state.supplierCode||'');
  const editKey=String(state.editKey||'');
  const keys=[...(state.sourceTicketKeys||[]).map(String),editKey].filter(Boolean);
  const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
  return {
    beforeKeys:new Set(Object.keys(tickets())),
    sources:Object.fromEntries(keys.filter(k=>tickets()[k]).map(k=>[k,clone(tickets()[k])])),
    code,advances:clone(ADT_POR_FORN[code]),cheques:clone(CHEQUES_POR_FORN[code]),
    balance:clone(SALDO_DEVEDOR_FORN[code]),
    balanceDeleted:typeof _DEL_SETS!=='undefined'&&_DEL_SETS.saldoDevedor?.has(code)===true,
    payableIds:new Set((CONTAS_PAGAR||[]).map(row=>String(row?.id||''))),
    editKey,editPayables:editKey?(CONTAS_PAGAR||[]).filter(row=>String(row?.ticket||'')===editKey).map(clone):[],
    selectedNumber:String(global.__ERP_PURCHASE_SELECTED_NUMBER__||editKey),
    prices:clone(PRECOS_FORN_DATA[code])
  };
}
function purchaseRollbackLocal(snapshot){
  if(!snapshot)return;
  const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
  Object.keys(tickets()).forEach(k=>{if(!snapshot.beforeKeys.has(k))delete tickets()[k];});
  Object.entries(snapshot.sources).forEach(([k,v])=>{tickets()[k]=clone(v);});
  const restore=(obj,key,val)=>{if(val===undefined)delete obj[key];else obj[key]=clone(val);};
  restore(ADT_POR_FORN,snapshot.code,snapshot.advances);
  restore(CHEQUES_POR_FORN,snapshot.code,snapshot.cheques);
  restore(SALDO_DEVEDOR_FORN,snapshot.code,snapshot.balance);
  restore(PRECOS_FORN_DATA,snapshot.code,snapshot.prices);
  try{
    if(typeof _DEL_SETS!=='undefined'&&_DEL_SETS.saldoDevedor){
      if(snapshot.balanceDeleted)_DEL_SETS.saldoDevedor.add(snapshot.code);
      else _DEL_SETS.saldoDevedor.delete(snapshot.code);
      if(typeof _DEL_LS_KEY!=='undefined')
        localStorage.setItem(_DEL_LS_KEY.saldoDevedor,JSON.stringify([..._DEL_SETS.saldoDevedor]));
    }
  }catch(e){}
  if(Array.isArray(CONTAS_PAGAR)){
    for(let i=CONTAS_PAGAR.length-1;i>=0;i--){
      const row=CONTAS_PAGAR[i];
      if(String(row?.ticket||'')!==snapshot.selectedNumber)continue;
      if(snapshot.editKey||!snapshot.payableIds.has(String(row?.id||'')))CONTAS_PAGAR.splice(i,1);
    }
    if(snapshot.editKey)CONTAS_PAGAR.push(...snapshot.editPayables.map(clone));
  }
  try{localStorage.setItem('mm_saldo_devedor',JSON.stringify(SALDO_DEVEDOR_FORN));}catch(e){}
  try{localStorage.setItem('mm_precos_forn',JSON.stringify(PRECOS_FORN_DATA));}catch(e){}
  try{if(typeof saveDB==='function')saveDB();}catch(e){}
  try{if(typeof renderTickets==='function')renderTickets();}catch(e){}
}
function purchaseEditError(result,status){
  const code=String(result?.code||'');
  const messages={
    TICKET_CHANGED:'Este pedido foi atualizado em outra sessão. Abra novamente pelo Histórico para conferir os valores.',
    ADVANCE_RECONCILIATION_REQUIRED:'O vínculo do adiantamento antigo está incompleto. A compra não foi alterada; solicite a conferência do lançamento financeiro.',
    ADVANCE_CHANGED:'O adiantamento foi utilizado ou atualizado. Reabra o pedido para consultar o saldo disponível.',
    CREDIT_CHANGED:'O crédito deste fornecedor foi movimentado. Atualize o histórico antes de editar.',
    PAID_AND_ADVANCE_RECONCILIATION_REQUIRED:'Este pedido possui PIX e adiantamento já utilizados. A correção precisa ser conciliada pelo financeiro.',
    PAYABLE_CHANGED:'O pagamento ou saldo desta compra mudou. Reabra o histórico antes de tentar novamente.',
    FINANCE_RECONCILIATION_REQUIRED:'Esta correção exigiria reclassificar um saldo já liquidado. Solicite a conciliação financeira.',
    CHEQUE_RECONCILIATION_REQUIRED:'Este pedido possui cheques já utilizados. Solicite a conciliação financeira antes de alterar o total.',
    EDIT_IN_PROGRESS:'Há outra alteração financeira em andamento para este pedido. Aguarde alguns segundos e tente novamente.',
    DATABASE_UNAVAILABLE:'A conexão com o banco de dados oscilou e a edição não foi confirmada. Tente novamente em alguns segundos.',
    SESSION_EXPIRED:'Sua sessão expirou. Entre novamente no sistema.',
    TOTAL_MISMATCH:'O total do pedido não confere com os itens. Revise quantidades, preços, desconto e frete.',
    PAID_REFUND_REQUIRED:result?.message||'A redução passa do valor pago com adiantamento. A diferença foi paga pelo banco: faça o estorno no financeiro.',
    CREDIT_RECONCILIATION_REQUIRED:'Esta compra usou crédito residual do fornecedor. A redução precisa de conciliação no financeiro.',
    ADVANCE_RECEIPT_MISMATCH:result?.message||'O recibo de adiantamento desta compra não confere. A compra não foi alterada.'
  };
  const error=new Error(messages[code]||(status===409?'Não foi possível conciliar este pedido. Reabra o histórico para consultar o registro atualizado.':result?.message||'Não foi possível confirmar a edição.'));
  error.code=code;
  return error;
}
async function checkAvailablePurchaseNumber(){
  if(!global._fbDB||!global.firebase?.auth?.()?.currentUser)throw new Error('Conexão com o cadastro de pedidos indisponível. Entre novamente.');
  let candidate=typeof getNextTicketId==='function'?String(getNextTicketId()):'';
  let match=/^T(\d+)$/i.exec(candidate);
  if(!match)throw new Error('Não foi possível gerar o número do pedido.');
  let number=Number(match[1]);
  for(let attempts=0;attempts<50;attempts++,number++){
    const key='T'+String(number).padStart(3,'0');
    const [ticket,deleted]=await Promise.all([
      global._fbDB.ref('erp/tickets/'+key).once('value'),
      global._fbDB.ref('erp/ticketsDeletedV2/'+key).once('value')
    ]);
    if(ticket.val()!=null||deleted.val()!=null)continue;
    if(typeof localStorage!=='undefined')localStorage.setItem('mm_ticket_hw',String(number-1));
    return key;
  }
  throw new Error('Não há numeração disponível para esta compra. Atualize o histórico e tente novamente.');
}
async function purchaseEditWithReconciliation(key,ticket,state){
  const current=global.firebase?.auth?.()?.currentUser;
  if(!current||typeof current.getIdToken!=='function')throw new Error('Sessão Firebase expirada. Entre novamente.');
  const operationId=state.editOperationId||(global.crypto?.randomUUID?.()||('00000000-0000-4000-8000-'+String(Date.now()).padStart(12,'0').slice(-12)));
  state.editOperationId=operationId;
  const payload=JSON.stringify({operationId,ticketNo:key,expectedTicket:JSON.parse(state.ticketSnapshot),ticket});
  let response=null,result={},networkError=null;
  for(let attempt=1;attempt<=3;attempt++){
    networkError=null;
    try{
      const token=await current.getIdToken();
      response=await fetch('/api/finance/purchase-order-edit',{
        method:'POST',credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:payload
      });
      result=await response.json().catch(()=>({}));
    }catch(error){networkError=error;response=null;result={};}
    const transient=networkError||(response&&([502,503,504].includes(response.status)||(response.status===409&&result.code==='EDIT_IN_PROGRESS')));
    if(!transient||attempt===3)break;
    await new Promise(function(resolve){setTimeout(resolve,Math.min(6,Math.max(1,Number(result.retryAfterSeconds)||attempt*1.5))*1000);});
  }
  if(networkError)throw new Error('Sem resposta do servidor. A edição pode ter sido gravada: reabra o Histórico para conferir.');
  if(!response.ok)throw purchaseEditError(result,response.status);
  if(!result.ticket||String(result.ticket.ticket||'')!==String(key))throw new Error('A resposta de conciliação do servidor não confirmou o pedido.');
  TICKETS_DB[key]=result.ticket;
  try{if(typeof _ticketsSnapJSON!=='undefined')_ticketsSnapJSON[key]=JSON.stringify(result.ticket);}catch(e){}
  if(result.advances&&typeof ADT_POR_FORN!=='undefined')ADT_POR_FORN[state.supplierCode]=result.advances;
  if(result.saldo&&typeof SALDO_DEVEDOR_FORN!=='undefined')SALDO_DEVEDOR_FORN[state.supplierCode]=result.saldo;
  if(result.creditLegacy&&!result.saldo&&typeof SALDO_DEVEDOR_FORN!=='undefined')SALDO_DEVEDOR_FORN[state.supplierCode]=result.creditLegacy;
  if(result.payable&&typeof CONTAS_PAGAR!=='undefined'){const index=CONTAS_PAGAR.findIndex(c=>String(c?.id||'')===String(result.payable.id||''));if(index>=0)CONTAS_PAGAR[index]=result.payable;else CONTAS_PAGAR.push(result.payable);}
  if(result.advanceRefund&&Number(result.advanceRefund.valor)>0){
    const codes=(result.advanceRefund.adiantamentos||[]).map(function(row){return row.cod;}).join(', ');
    try{showToast('R$ '+money(result.advanceRefund.valor)+' voltou como saldo do adiantamento '+codes+'.','success',8000);}catch(e){}
  }
  return result.ticket;
}
global.phase4PurchaseSave=async function(){
  if(saving)return;
  const body=document.getElementById('cs-lanc-body');if(!body)return;
  const state=currentState(body);
  state.supplierName=selectedSupplierName()||state.supplierName;
  state.discount=Math.max(0,parseBR(document.getElementById('phase4-po-discount')?.value||state.discount));
  state.freight=Math.max(0,parseBR(document.getElementById('phase4-po-freight')?.value||state.freight));
  state.orderNumber=String(document.getElementById('phase4-po-number')?.value||state.orderNumber||'').trim();
  state.purchaseOrder=String(document.getElementById('phase4-po-order')?.value||state.purchaseOrder||'').trim();
  state.purchaseDate=document.getElementById('phase4-po-date')?.value||state.purchaseDate||today();
  state.dueDate=document.getElementById('cs-lanc-venc')?.value||state.dueDate||today();
  state.notes=readOrderNotes(state);
  if(state.editKey){
    setSaving(true);
    global.__ERP_PURCHASE_IN_PROGRESS__=true;
    let editCommitted=false;
    const editSnapshot=purchaseTakeLocalSnapshot(state);
    try{
      const totals=global.phase4PurchaseRecalc();
      const ticket=saveEditedTicket(state,totals);
      purchasePendingKeys.add(String(state.editKey));
      let confirmed;
      try{
        const financeChanged=Math.abs(Number(totals.total||0)-Number(state.originalTotal||0))>0.005;
        confirmed=financeChanged
          ?await purchaseEditWithReconciliation(String(state.editKey),ticket,state)
          :await purchaseConfirmCloud(String(state.editKey),ticket,{
            expected:{totalGeral:state.originalTotal,saldoPagar:state.originalBalance},
            expectedSnapshot:state.cloudSnapshot
          });
      }finally{purchasePendingKeys.delete(String(state.editKey));}
      afterConfirmedPurchaseEdit(confirmed,state,totals);
      editCommitted=true;
      resetOrderState(body);
      manualMode=false;
      if(typeof global.csTab==='function')global.csTab('historico');
      try{showToast('Pedido '+String(ticket.ticket||state.editKey)+' atualizado e confirmado.','success');}catch(e){}
    }catch(error){
      purchaseRollbackLocal(editSnapshot);
      try{showToast(error.message||'Não foi possível atualizar o pedido. Nenhuma alteração financeira foi confirmada.','error',7000);}catch(e){}
    }
    finally{
      finishPurchaseDeferredSave(false);setSaving(false);
      if(editCommitted)schedulePostPurchaseSave();
    }
    return;
  }
  let prepared;
  try{
    validateSourceTickets(state);
    validatePurchaseCredits(state);
    prepared=prepareLegacy(body,state);
  }catch(error){
    try{showToast(error.message,'error',6000);}catch(e){alert(error.message);}
    return;
  }
  const totals=global.phase4PurchaseRecalc();
  setSaving(true);
  global.__ERP_PURCHASE_IN_PROGRESS__=true;
  let purchaseCommitted=false;
  let snapshot=null;
  try{
    const availableNumber=body.dataset.purchaseReservedNumber||await checkAvailablePurchaseNumber();
    body.dataset.purchaseReservedNumber=availableNumber;
    state.orderNumber=availableNumber;
    global.__ERP_PURCHASE_SELECTED_NUMBER__=availableNumber;
    const numberInput=document.getElementById('phase4-po-number');
    if(numberInput)numberInput.value=availableNumber;
    if(!body.dataset.purchaseOperationId)
      body.dataset.purchaseOperationId=global.crypto?.randomUUID?.()||('po-'+Date.now()+'-'+Math.random().toString(36).slice(2));
    const advanceLimit={};
    state.adts.forEach(function(a,index){if(document.getElementById('csadt-'+index)?.checked)advanceLimit[String(a.cod||'')]=Number(a.valor||0);});
    state.cheques.forEach(function(a,index){if(document.getElementById('cscheq-'+index)?.checked&&a.cod)advanceLimit[String(a.cod)]=Number(a.valor||0);});
    const chequeLimit={};
    state.cheques.forEach(function(c,index){if(document.getElementById('cscheq-'+index)?.checked&&!c.cod)chequeLimit[String(c.id||c.num||c.numero||'')]=Number(c.valor||0);});
    global.__ERP_PURCHASE_APPROVED_ADVANCES__={supplierCode:state.supplierCode,amounts:advanceLimit,cheques:chequeLimit,originals:Object.fromEntries(state.adts.map(function(a){return [String(a.cod||''),Number(a.valorOriginal||a.valor||0)];})),spent:Object.fromEntries(state.adts.map(function(a){return [String(a.cod||''),Number(a.valorCompensado||0)];}))};
    await validateCloudSourceTickets(state);
    snapshot=purchaseTakeLocalSnapshot(state);
    const result=await legacy.confirmPurchase.call(global,prepared.supplier.nome);
    const key=availableNumber;
    if(!tickets()[key] || snapshot.beforeKeys.has(key))
      throw new Error('Falha na identificação da compra. Nenhuma gravação foi confirmada.');
    const ticket=patchCreatedTicket(key,state,prepared.legacyItems,totals);
    if(!ticket)throw new Error('A compra não pôde ser preparada para confirmação.');
    ticket._purchaseOperationId=body.dataset.purchaseOperationId;
    purchasePendingKeys.add(key);
    try{
      await purchaseCreateAtomic(key,ticket,state,body);
    }finally{purchasePendingKeys.delete(key);}
    purchaseCommitted=true;
    delete body.dataset.purchaseOperationId;
    finishPurchaseSave(body,key,TICKETS_DB[key],totals);
    return result;
  }catch(error){
    purchaseRollbackLocal(snapshot);
    console.error('[purchase-order] salvar',error);
    if(['TICKET_EXISTS','OPERATION_REUSED'].includes(String(error?.code||''))){
      delete body.dataset.purchaseReservedNumber;
      delete body.dataset.purchaseOperationId;
    }
    const serverMessage=String(error?.message||'').trim();
    const knownCode=/^[A-Z_]+$/.test(String(error?.code||''))&&Number(error?.status||0)>0;
    const presentation=/número de pedido já existe/i.test(serverMessage)||error?.code==='TICKET_EXISTS'
      ?'Outro pedido já utiliza este número. Seus dados permanecem na tela. Atualize o histórico antes de tentar novamente.'
      :(knownCode&&serverMessage
        ?serverMessage+' Os dados continuam na tela.'
        :'Não foi possível confirmar este pedido. Os dados continuam na tela. Confira o histórico antes de repetir a operação.');
    try{showToast(presentation,'error',9000);}catch(e){}
  }finally{
    delete global.__ERP_PURCHASE_SELECTED_NUMBER__;
    delete global.__ERP_PURCHASE_APPROVED_ADVANCES__;
    finishPurchaseDeferredSave(false);
    setSaving(false);
    if(purchaseCommitted)schedulePostPurchaseSave();
  }
};
global.phase4PurchaseCancel=function(){
  manualMode=false;
  const body=document.getElementById('cs-lanc-body');
  if(body)resetOrderState(body);
  if(typeof global.csTab==='function')global.csTab('pesagens');
  else if(typeof legacy.tab==='function')legacy.tab.call(global,'pesagens');
};
function ticketItemsForOrder(ticket){
  const raw=(ticket?.itens||[]).length?(ticket.itens||[]):((ticket?.bags||[]).map(function(b){return {mat:b.mat,pesoLiq:Number(b.lq||b.br||0),pesoBruto:Number(b.br||b.lq||0),obs:b.obs||''};}));
  return raw.map(function(item,index){
    const amount=itemNet(item);
    return {
      id:'PO-'+(++rowSeed),
      source:true,
      sourceIndex:index,
      mat:String(item.mat||item.matBase||item.material||'').trim(),
      descricao:String(item.descricaoDetalhada||item.descricao||item.obs||'').trim(),
      unidade:String(item.unidade||'kg'),
      quantidade:amount,
      pesoBruto:itemGross(item),
      preco:Number(item.preco||0)||0
    };
  }).filter(function(item){return item.mat||item.quantidade>0;});
}

function isoDate(value){
  const date=String(value||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(date))return date;
  const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  return match?match[3]+'-'+match[2]+'-'+match[1]:today();
}
function stateForExistingTicket(key,cloudTicket){
  const ticket=cloudTicket||tickets()[key];if(!ticket)return null;
  const supplierName=String(ticket.fornecedor||ticket.fornecedorNome||ticket.forn||'').trim();
  const supplier=supplierByName(supplierName);
  if(!supplier)throw new Error('Fornecedor do pedido não está mais ativo no cadastro.');
  const po=ticket.pedidoCompra||{};
  const items=ticketItemsForOrder(ticket);
  items.forEach(function(item,index){
    item.source=false;item.originalIndex=index;
    item.ident=String(ticket.itens?.[index]?.ident||'');
    item.codigo=String(ticket.itens?.[index]?.codigo||'');
  });
  return {
    editKey:key,cloudSnapshot:cloudTicket?purchaseStableSnapshot(cloudTicket):'',
    ticketSnapshot:cloudTicket?JSON.stringify(cloudTicket):'',
    supplierName:supplier.nome,supplierCode:supplier.cod||'',
    items:items.length?items:[newItem()],
    discount:Number(ticket.descontoCompra??po.desconto??0)||0,
    freight:Number(ticket.freteCompra??po.frete??0)||0,
    orderNumber:String(ticket.ticket||key||ticket.numeroPedido||po.numero),
    purchaseOrder:String(ticket.ordemCompra||po.ordemCompra||''),
    purchaseDate:isoDate(ticket.dataCompra||po.dataCompra||ticket.data),
    dueDate:isoDate(ticket.vencimentoSaldo||po.vencimentoSaldo||ticket.data),
    sourceTicketKeys:[],adts:[],cheques:[],previousCredit:0,
    appliedAdvance:Number(ticket.adiantamento||0)||0,
    advanceRefundable:Number(ticket.reciboFinanceiro?.versao)===2&&
      (ticket.reciboFinanceiro?.adiantamentos||[]).some(function(row){return Number(row?.valorAplicado||0)>0;})&&
      !(ticket.reciboFinanceiro?.cheques||[]).some(function(row){return Number(row?.valorAplicado||0)>0;})&&
      !(Number(ticket.creditoFornecedorAplicado||0)>0),
    originalBalance:Number(ticket.saldoPagar||0),
    originalTotal:Number(ticket.totalGeral||0)||0,
    legacyExtra:Math.round(((Number(ticket.totalGeral||0)||0)-
      ((ticket.itens||[]).reduce(function(sum,i){return sum+itemNet(i)*Number(i.preco||0);},0)-
      (Number(ticket.descontoCompra??po.desconto??0)||0)+(Number(ticket.freteCompra??po.frete??0)||0)))*100)/100,
    notes:String(ticket.observacoesPedido||po.observacoes||'')
  };
}
global.phase4PurchaseEditTicket=async function(ticketRef){
  const ref=String(ticketRef||'').trim();
  const entry=tickets()[ref]?[ref,tickets()[ref]]:Object.entries(tickets()).find(function(e){return String(e[1]?.ticket||'')===ref;});
  if(!entry){try{showToast('Pedido não encontrado.','error');}catch(e){}return;}
  if(entry[1].status==='Aguard. Preço'||entry[1]._balSessao||entry[1]._rodEntrada){
    try{showToast('Finalize primeiro a pesagem antes de editar o pedido.','error');}catch(e){}return;
  }
  let state;
  try{
    const remote=await purchaseCloudRef(entry[0]).once('value');
    const confirmed=remote?.val?.();
    if(!confirmed||typeof confirmed!=='object')throw new Error('Pedido não encontrado na nuvem. Nenhuma edição foi iniciada.');
    if(confirmed.status==='Aguard. Preço'||confirmed._balSessao||confirmed._rodEntrada)throw new Error('Finalize a pesagem antes de editar este pedido.');
    state=stateForExistingTicket(entry[0],confirmed);
  }catch(e){try{showToast(e.message||'Não foi possível consultar o pedido no Firebase.','error',7500);}catch(_){}return;}
  manualMode=false;
  if(typeof global.csTab==='function')global.csTab('lancamento');
  setTimeout(function(){
    const body=document.getElementById('cs-lanc-body');if(!body)return;
    const select=document.getElementById('cs-lanc-forn');if(select)select.value=state.supplierName;
    body.dataset.fornCod=state.supplierCode;
    body.dataset.itensData=JSON.stringify([]);
    body.dataset.ticketKeys='[]';body.dataset.adtsData='[]';body.dataset.cheqsData='[]';
    body.dataset.saldoAnterior='0';
    storeState(body,state);
    render(body);
    const sup=document.getElementById('phase4-po-supplier');if(sup){sup.readOnly=true;sup.title='Fornecedor do pedido existente';}
    try{document.getElementById('cst-lancamento')?.scrollIntoView({block:'start',behavior:'smooth'});}catch(e){}
  },0);
};
function saveEditedTicket(state,totals){
  const ticket=state.ticketSnapshot?JSON.parse(state.ticketSnapshot):null;
  if(!ticket)throw new Error('O pedido não existe mais. Atualize o histórico.');
  const oldTotal=Number(ticket.totalGeral||0);
  if(Math.abs(oldTotal-Number(state.originalTotal||0))>0.01 || Math.abs(Number(ticket.saldoPagar||0)-Number(state.originalBalance||0))>0.01)
    throw new Error('O pedido foi alterado por outra operação. Reabra-o para editar os valores atuais.');
  if(totals.balance< -0.005 && Number(state.originalBalance||0)>=-0.005 && Number(state.appliedAdvance||0)<=0)throw new Error('O total editado ficou abaixo de pagamento já registrado. Faça a conciliação financeira antes de salvar.');
  const supplier=supplierByName(state.supplierName);
  if(!supplier||String(supplier.cod||'')!==String(state.supplierCode||''))throw new Error('Fornecedor do pedido divergente.');
  const items=(state.items||[]).filter(function(item){return String(item.mat||'').trim()&&Number(item.quantidade||0)>0;});
  if(!items.length)throw new Error('Inclua pelo menos um material com quantidade.');
  const oldItems=(ticket.itens||[]).slice();
  ticket.itens=items.map(function(item){
    const original=Number.isInteger(item.originalIndex)?(oldItems[item.originalIndex]||{}):{};
    const quantity=Number(item.quantidade),price=Number(item.preco);
    return Object.assign({},original,{
      mat:String(item.mat).trim().toUpperCase(),matBase:String(item.mat).trim().toUpperCase(),
      ident:String(item.ident||original.ident||''),
      descricaoDetalhada:String(item.descricao||'').trim(),obs:String(item.descricao||'').trim(),
      unidade:'kg',quantidade:quantity,pesoBruto:Number(item.pesoBruto||quantity),pesoLiq:quantity,
      preco:price,subtotal:quantity*price,total:quantity*price
    });
  });
  ticket.totalProdutos=totals.productTotal;
  ticket.totalGeral=totals.total;
  ticket.totalKg=items.reduce(function(sum,item){return sum+Number(item.quantidade||0);},0);
  ticket.descontoCompra=state.discount;
  ticket.freteCompra=state.freight;
  ticket.numeroPedido=String(ticket.ticket||state.editKey);
  ticket.ordemCompra=state.purchaseOrder;
  ticket.dataCompra=state.purchaseDate;
  ticket.vencimentoSaldo=state.dueDate;
  ticket.observacoesPedido=String(state.notes||'').trim();
  ticket.saldoPagar=totals.balance;
  ticket.status=totals.balance>0.005?'Pendente':'Pago';
  ticket.pedidoCompra=Object.assign({},ticket.pedidoCompra||{}, {
    numero:ticket.numeroPedido,ordemCompra:state.purchaseOrder,dataCompra:state.purchaseDate,
    vencimentoSaldo:state.dueDate,observacoes:ticket.observacoesPedido,
    desconto:state.discount,frete:state.freight,totalProdutos:totals.productTotal,totalPedido:totals.total
  });
  return ticket;
}
function afterConfirmedPurchaseEdit(ticket,state,totals){
  try{if(typeof registrarHistorico==='function')registrarHistorico('Compra de Sucata','Pedido editado',String(ticket.ticket||state.editKey),ticket,{ticket:ticket.ticket||state.editKey});}catch(e){}
  ['renderTickets','renderContasPagar','renderEstoque','renderDashboard','renderFluxo'].forEach(function(name){try{if(typeof global[name]==='function')global[name]();}catch(e){}});
}
function stateForSourceTicket(ticketKey){
  const t=tickets()[ticketKey];if(!t)return null;
  const supplierName=String(t.fornecedor||t.fornecedorNome||t.forn||'').trim();
  const supplier=supplierByName(supplierName);
  if(!supplier)return null;
  const fin=financialData(null,supplier.cod||'',[ticketKey]);
  let items=ticketItemsForOrder(t);
  items.forEach(function(item){
    if(Number(item.preco||0)>0||!item.mat)return;
    try{
      item.preco=Number(PRECOS_FORN_DATA?.[supplier.cod]?.[String(item.mat).trim().toUpperCase()]||PRECOS_FORN_DATA?.[supplier.cod]?.[String(item.mat).trim()]||0)||0;
    }catch(e){}
  });
  if(!items.length)items=[newItem()];
  let number='';try{number=typeof getNextTicketId==='function'?getNextTicketId():'';}catch(e){}
  return {supplierName:supplier.nome,supplierCode:supplier.cod||'',items,discount:0,freight:0,orderNumber:number,purchaseOrder:'',purchaseDate:today(),dueDate:today(),sourceTicketKeys:[ticketKey],adts:fin.adts,cheques:fin.cheques,previousCredit:fin.balance,creditSource:fin.creditSource||'',creditIssues:fin.issues||[],notes:''};
}
global.phase4OpenTicketForPurchase=function(ticketKey){
  const key=String(ticketKey||'').trim();
  const t=tickets()[key];
  if(!t){try{showToast('Pesagem não encontrada.','error');}catch(e){}return;}
  const duplicate=existingPurchaseForSources([key]);
  if(duplicate){try{showToast('Esta pesagem já virou o pedido '+String(duplicate[1]?.ticket||duplicate[0])+'.','info',6000);}catch(e){}if(typeof global.csTab==='function')global.csTab('historico');return;}
  if(t.status!=='Aguard. Preço'||!t._balFinalizado||t._balSessao||t._rodEntrada){try{showToast('Esta pesagem não está aguardando fechamento.','error',6000);}catch(e){}return;}
  const state=stateForSourceTicket(key);
  if(!state){try{showToast('Fornecedor da pesagem não foi encontrado no cadastro.','error',6000);}catch(e){}return;}
  manualMode=false;activeSourceTicketKey=key;
  if(typeof global.csTab==='function')global.csTab('lancamento');
  setTimeout(function(){
    const body=document.getElementById('cs-lanc-body');if(!body)return;
    const select=document.getElementById('cs-lanc-forn');if(select)select.value=state.supplierName;
    body.dataset.itensData=JSON.stringify(state.items.map(function(i){return {mat:i.mat,matBase:i.mat,ident:'',descricaoDetalhada:i.descricao,obs:i.descricao,pesoBruto:i.pesoBruto,pesoLiq:i.quantidade,preco:i.preco};}));
    body.dataset.ticketKeys=JSON.stringify([key]);
    body.dataset.fornCod=state.supplierCode;
    body.dataset.adtsData=JSON.stringify(state.adts||[]);
    body.dataset.cheqsData=JSON.stringify(state.cheques||[]);
    body.dataset.saldoAnterior=String(Number(state.previousCredit||0));
    storeState(body,state);
    render(body);
  },0);
};
function pendingPurchaseTickets(){
  return Object.entries(tickets()).filter(function(entry){const t=entry[1]||{};return t._balFinalizado&&t.status==='Aguard. Preço'&&!t._balSessao&&!t._rodEntrada;}).sort(function(a,b){return String(b[1]?.data||'').localeCompare(String(a[1]?.data||''))||String(b[1]?.ticket||b[0]).localeCompare(String(a[1]?.ticket||a[0]));});
}
function renderPendingQueue(){
  const host=document.getElementById('cs-pesagens-list');if(!host)return;
  const rows=pendingPurchaseTickets();
  if(!rows.length){host.innerHTML='<div class="phase4-pending-empty"><b>✅ Nenhuma pesagem aguardando fechamento.</b><span>Quando uma pesagem for concluída na Balança Rodoviária/Balanceiro, ela aparecerá aqui até virar um pedido de compra.</span></div>';return;}
  host.innerHTML='<div class="phase4-pending-intro"><b>Pesagens a fechar</b><span>Cada linha é uma pesagem concluída que ainda precisa de preço e fechamento financeiro.</span></div><div class="phase4-pending-grid">'+rows.map(function(entry){
    const key=entry[0],t=entry[1];
    const its=ticketItemsForOrder(t);
    const kgTotal=its.reduce(function(sum,item){return sum+Number(item.quantidade||0);},0)||Number(t.totalKg||0);
    const date=String(t.data||'').includes('-')?String(t.data).split('-').reverse().join('/'):String(t.data||'—');
    return '<article class="phase4-pending-card"><div class="phase4-pending-ticket"><b>'+esc(t.ticket||key)+'</b><span>'+esc(date)+'</span></div><div class="phase4-pending-main"><strong>'+esc(t.fornecedor||t.fornecedorNome||t.forn||'Fornecedor')+'</strong><span>'+esc(its.map(function(i){return i.mat;}).filter(Boolean).join(', ')||'Material não informado')+'</span></div><div class="phase4-pending-weight"><b>'+qty(kgTotal)+' kg</b><span>líquido</span></div><div class="phase4-pending-actions"><button type="button" class="phase4-po-outline" onclick="csAbrirImpureza(\''+esc(key)+'\')">✏️ Impureza</button><button type="button" class="phase4-po-save" onclick="phase4OpenTicketForPurchase(\''+esc(key)+'\')">Abrir pedido →</button></div></article>';
  }).join('')+'</div>';
}
const legacyRenderPending=global.csRenderPesagens;
global.csRenderPesagens=function(){
  try{return renderPendingQueue();}catch(error){console.warn('[purchase-order] fila de pesagens',error);if(typeof legacyRenderPending==='function')return legacyRenderPending.apply(this,arguments);}
};
function renderFromLegacy(forceName){
  const body=document.getElementById('cs-lanc-body');if(!body)return;
  let state=currentState(body);
  const name=String(forceName||document.getElementById('cs-lanc-forn')?.value||state.supplierName||'').trim();
  const supplier=supplierByName(name);
  if(supplier){
    const fin=financialData(body,supplier.cod);
    state.supplierName=supplier.nome;
    state.supplierCode=supplier.cod||'';
    state.adts=fin.adts;
    state.cheques=fin.cheques;
    state.previousCredit=fin.balance;
    const loaded=sourceItems(body);
    if(loaded.length)state.items=loaded;
    else if(!state.items?.length)state.items=[newItem()];
    state.items.forEach(function(item){
      if(Number(item.preco||0)>0||!item.mat)return;
      try{
        const price=Number(PRECOS_FORN_DATA?.[supplier.cod]?.[String(item.mat).trim().toUpperCase()]||PRECOS_FORN_DATA?.[supplier.cod]?.[String(item.mat).trim()]||0);
        if(price>0)item.preco=price;
      }catch(e){}
    });
    state.sourceTicketKeys=jsonDataset(body,'ticketKeys',state.sourceTicketKeys||[]);
    state.notes=String(state.notes||'');
  }
  if(!state.items?.length)state.items=[newItem()];
  storeState(body,state);
  render(body);
}
if(typeof legacy.loadSupplier==='function'){
  global.csCarregarForn=function(forceName){
    const bodyBefore=document.getElementById('cs-lanc-body');
    if(bodyBefore){
      delete bodyBefore.dataset.phase4Order;
      delete bodyBefore.dataset.itensData;
      delete bodyBefore.dataset.ticketKeys;
      delete bodyBefore.dataset.adtsData;
      delete bodyBefore.dataset.cheqsData;
      delete bodyBefore.dataset.saldoAnterior;
      delete bodyBefore.dataset.fornCod;
      delete bodyBefore.dataset.itensCount;
      delete bodyBefore.dataset.adtCount;
      delete bodyBefore.dataset.cheqsCount;
    }
    const result=legacy.loadSupplier.apply(this,arguments);
    setTimeout(function(){
      const body=document.getElementById('cs-lanc-body');
      if(!body)return;
      delete body.dataset.phase4Order;
      renderFromLegacy(forceName);
    },1);
    return result;
  };
}
if(typeof legacy.tab==='function'){
  global.csTab=function(tab){
    const result=legacy.tab.apply(this,arguments);
    if(tab==='lancamento'){
      setTimeout(function(){
        const body=document.getElementById('cs-lanc-body');
        if(!body)return;
        if(!body.querySelector('.phase4-po')){
          if(!body.dataset.phase4Order){
            const state=currentState(body);
            state.items=sourceItems(body);
            if(!state.items.length)state.items=[newItem()];
            storeState(body,state);
          }
          render(body);
        }else{
          const state=currentState(body);
          if(!state.editKey&&state.supplierCode){
            const fresh=financialData(body,state.supplierCode);
            const signature=function(items){return JSON.stringify((items||[]).map(function(i){return [i.cod||i.id||i.num,i.valor,i.status];}));};
            if(signature(fresh.adts)!==signature(state.adts)||signature(fresh.cheques)!==signature(state.cheques)||Math.abs(fresh.balance-Number(state.previousCredit||0))>0.005||JSON.stringify(fresh.issues||[])!==JSON.stringify(state.creditIssues||[])){
              global.phase4PurchaseRecalc();
              global.phase4PurchaseSyncMeta();
              state.adts=fresh.adts;
              state.cheques=fresh.cheques;
              state.previousCredit=fresh.balance;
              state.creditSource=fresh.creditSource||'';
              state.creditIssues=fresh.issues||[];
              storeState(body,state);
              render(body);
            }
          }
        }
      },0);
    }
    return result;
  };
}
if(typeof legacy.openModal==='function'){
  global.om=function(type){
    if(type==='compra'){
      manualMode=true;
      if(typeof global.csTab==='function')global.csTab('lancamento');
      setTimeout(function(){
        const select=document.getElementById('cs-lanc-forn');
        if(select)select.value='';
        const body=document.getElementById('cs-lanc-body');
        if(!body)return;
        const state={
          supplierName:'',
          supplierCode:'',
          items:[newItem()],
          discount:0,
          freight:0,
          orderNumber:(function(){try{return typeof getNextTicketId==='function'?getNextTicketId():'';}catch(e){return '';}})(),
          purchaseOrder:'',
          purchaseDate:today(),
          dueDate:today(),
          sourceTicketKeys:[],
          adts:[],
          cheques:[],
          previousCredit:0,
          notes:''
        };
        storeState(body,state);
        render(body);
      },0);
      return;
    }
    return legacy.openModal.apply(this,arguments);
  };
}

function companyName(){
  try{return typeof _empresaPrincipalLabel==='function'?_empresaPrincipalLabel():'Manuela Metais';}catch(e){return 'Manuela Metais';}
}
function companyLegal(){
  try{return typeof _empresaPrincipalRazao==='function'?_empresaPrincipalRazao():companyName();}catch(e){return companyName();}
}
function companyInfo(){
  try{return typeof _empresaPrincipalInfo==='function'?(_empresaPrincipalInfo()||{}):{};}catch(e){return {};}
}
function supplierInfo(ticket){
  try{
    return (FORNECEDORES||[]).find(function(f){
      return String(f.cod||'')===String(ticket.fornecedorCod||'')||String(f.nome||'').trim()===String(ticket.fornecedor||ticket.fornecedorNome||'').trim();
    })||{};
  }catch(e){return {};}
}
function dateBR(value){
  const raw=String(value||'').trim();if(!raw)return '—';
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw.split('-').reverse().join('/');
  try{return typeof fmtDate==='function'?(fmtDate(raw)||raw):raw;}catch(e){return raw;}
}
function daysBetween(a,b){
  try{const da=new Date(String(a||'')+'T12:00:00'),db=new Date(String(b||'')+'T12:00:00');if(Number.isNaN(+da)||Number.isNaN(+db))return 0;return Math.max(0,Math.round((db-da)/86400000));}catch(e){return 0;}
}
function companyLogoSrc(){
  try{
    const base=typeof window!=='undefined'&&window.location&&window.location.href?window.location.href:'http://localhost/';
    return new URL('assets/branding/manuela-metais-logo.webp',base).href;
  }catch(e){
    return 'assets/branding/manuela-metais-logo.webp';
  }
}
function printAppliedAdvances(key,ticket,advance){
  const ticketNo=String(ticket.ticket||key||'').trim();
  const supplierCode=String(ticket.fornecedorCod||ticket.fornCod||'').trim();
  const appliedLimit=Math.max(0,Math.round(Number(advance||0)*100));
  const candidates=[];
  const unique=new Set();
  function take(kind,ref,date,method,amount,identity){
    const cents=Math.round(Number(amount||0)*100);
    if(!Number.isSafeInteger(cents)||cents<=0)return;
    const id=identity||kind+':'+String(ref||'')+':'+String(date||'');
    if(unique.has(id))return;
    unique.add(id);
    candidates.push({kind,ref:String(ref||''),date:String(date||''),method:String(method||''),cents});
  }
  const snap=ticket.reciboFinanceiro;
  if(snap&&typeof snap==='object'){
    for(const a of (Array.isArray(snap.adiantamentos)?snap.adiantamentos:[])){
      if(!a)continue;
      take('Adiantamento',a.cod,a.data,String(a.forma||''),a.valorAplicado,
        a.cod?'ADT:'+String(a.cod):'SNAP-ADT:'+candidates.length);
    }
    for(const c of (Array.isArray(snap.cheques)?snap.cheques:[])){
      if(!c)continue;
      take('Cheque',c.num||c.id,c.bomPara,'',c.valorAplicado,
        c.id?'CHQ:'+String(c.id):'SNAP-CHQ:'+candidates.length);
    }
  }
  try{
    const rows=typeof ADT_POR_FORN!=='undefined'&&supplierCode?(ADT_POR_FORN[supplierCode]||[]):[];
    for(const a of rows){
      if(!a||String(a.ticket||'').trim()!==ticketNo||String(a.status||'').trim().toLowerCase()!=='quitado')continue;
      take('Adiantamento',a.cod,a.data,String(a.forma||''),a.valor,
        a.cod?'ADT:'+String(a.cod):'LIVE-ADT:'+candidates.length);
    }
  }catch(e){}
  try{
    const rows=typeof CHEQUES_POR_FORN!=='undefined'&&supplierCode?(CHEQUES_POR_FORN[supplierCode]||[]):[];
    for(const c of rows){
      if(!c||![c._aplicadoTicket,c.vinculo,c.ticket].some(function(value){return String(value||'').trim()===ticketNo;}))continue;
      take('Cheque',c.num||c.numero||c.id,c.bomPara||c.data,'',c.valor,
        c.id?'CHQ:'+String(c.id):'LIVE-CHQ:'+candidates.length);
    }
  }catch(e){}
  let remaining=appliedLimit;
  const rows=[];
  for(const c of candidates){
    if(remaining<=0)break;
    const used=Math.min(remaining,c.cents);
    if(used>0)rows.push({...c,amount:used/100});
    remaining-=used;
  }
  if(remaining>0){
    rows.push({kind:'Outros abatimentos aplicados',ref:'',date:'',method:'',amount:remaining/100});
  }
  return rows;
}
function printPaymentSnapshot(key,ticket,total){
  const safe=function(value){const n=Number(value);return Number.isFinite(n)?Math.max(0,n):0;};
  const ticketNo=String(ticket.ticket||key||'').trim();
  const priorDebt=safe(ticket.saldoAnterior);
  const amountDue=safe(total)+priorDebt;
  const advance=Math.min(amountDue,safe(ticket.adiantamento));
  const recordedBalance=ticket.saldoPagar!=null?safe(ticket.saldoPagar):Math.max(0,amountDue-advance);
  let linked=[];
  try{
    if(Array.isArray(CONTAS_PAGAR))linked=CONTAS_PAGAR.filter(function(cp){
      return cp&&String(cp.ticket||'').trim()===ticketNo;
    });
  }catch(e){}
  const payments=[];
  for(const account of linked){
    if(!Array.isArray(account.pagamentos))continue;
    for(const payment of account.pagamentos){
      if(!payment)continue;
      const cash=safe(payment.valor),applied=safe(payment.adt);
      if(cash+applied<=0)continue;
      payments.push({date:String(payment.data||''),amount:cash+applied,
        description:applied>0&&cash>0?'Pagamento e adiantamento':(applied>0?'Compensação de adiantamento':'Pagamento'),
        details:String(payment.formaPagamento||payment.forma||payment.metodoPagamento||'').trim()});
    }
  }
  const hasPayableChanges=linked.some(function(cp){
    return String(cp.status||'').toLowerCase()==='pago'||
      (Array.isArray(cp.pagamentos)&&cp.pagamentos.length>0)||safe(cp.valorPago)>0||safe(cp.adtCompensado)>0;
  });
  const outstanding=hasPayableChanges
    ?linked.filter(function(cp){return String(cp.status||'').toLowerCase()!=='pago';})
      .reduce(function(sum,cp){return sum+safe(cp.valor);},0)
    :recordedBalance;
  const balance=Math.max(0,Math.min(amountDue,outstanding));
  const settled=Math.max(0,Math.min(amountDue,amountDue-balance));
  return {priorDebt,amountDue,advance,balance,settled,
    sincePurchase:Math.max(0,settled-advance),payments};
}
function supplierUnappliedAdvance(ticket){
  const code=String(ticket.fornecedorCod||ticket.fornCod||'').trim();
  let ledger=[];
  try{ledger=(ADT_POR_FORN[code]||[]).filter(a=>a&&String(a.status||'Pendente').toLowerCase()==='pendente');}catch(e){}
  const amount=ledger.reduce((sum,a)=>{
    const current=Math.max(0,Number(a.valor||0));
    const original=Math.max(current,Number(a.valorOriginal||0));
    const applied=Math.max(0,Number(a.valorCompensado||0));
    return sum+Math.min(current,Math.max(0,original-applied));
  },0);
  if(ledger.length)return Math.round(amount*100)/100;
  const rows=ticket?.reciboFinanceiro?.adiantamentos||[];
  return Math.round(rows.reduce((sum,row)=>sum+Math.max(0,Number(row.valorPendente||0)),0)*100)/100;
}
function printHtml(key,ticket){
  const info=companyInfo();
  const supplier=supplierInfo(ticket);
  const po=ticket.pedidoCompra||{};
  const orderNo=String(ticket.ticket||key||ticket.numeroPedido||po.numero||'');
  const purchaseDate=ticket.dataCompra||po.dataCompra||ticket.data||'';
  const expectedDate=ticket.dataPrevista||po.dataPrevista||'';
  const dueDate=ticket.vencimentoSaldo||po.vencimentoSaldo||purchaseDate;
  const items=Array.isArray(ticket.itens)?ticket.itens:[];
  const productTotal=Number(ticket.totalProdutos!=null?ticket.totalProdutos:items.reduce(function(sum,item){
    return sum+Number(item.total!=null?item.total:Number(item.pesoLiq||item.quantidade||0)*Number(item.preco||0));
  },0));
  const discount=Number(ticket.descontoCompra||po.desconto||0);
  const freight=Number(ticket.freteCompra||po.frete||0);
  const total=Number(ticket.totalGeral!=null?ticket.totalGeral:(po.totalPedido!=null?po.totalPedido:Math.max(0,productTotal-discount+freight)));
  const finance=printPaymentSnapshot(key,ticket,total);
  const advance=finance.advance;
  const balance=finance.balance;
  const supplierCredit=supplierUnappliedAdvance(ticket);
  const sumQty=items.reduce(function(sum,item){return sum+Number(item.quantidade||item.pesoLiq||0);},0);
  const orderNotes=String(ticket.observacoesPedido||po.observacoes||'').trim();
  const supplierAddress=[supplier.rua||supplier.logradouro||'',supplier.num||supplier.numero||'',supplier.bairro||'',supplier.cidade||'',supplier.uf||''].filter(Boolean).join(', ');
  const supplierDocuments=supplier.cnpj?'CNPJ: '+supplier.cnpj:(supplier.cpf?'CPF: '+supplier.cpf:'');
  const supplierContacts=[supplier.tel||supplier.telefone||supplier.wpp||'',supplier.email||''].filter(Boolean);
  const companyContacts=[info.financeiro,info.escritorio,info.compras].filter(Boolean).join(' · ');
  const purchaseOrder=String(ticket.ordemCompra||po.ordemCompra||'').trim();
  const issued=new Date().toLocaleString('pt-BR');
  const itemRows=items.map(function(item){
    const quantity=Number(item.quantidade||item.pesoLiq||0);
    const price=Number(item.preco||0);
    const description=String(item.descricaoDetalhada||item.descricao||item.obs||'').trim();
    return '<tr><td class="item-description"><strong>'+esc(item.mat||item.matBase||'—')+'</strong>'+
      (description?'<span>'+esc(description)+'</span>':'')+'</td>'+
      '<td class="numeric">'+qty(quantity)+'</td>'+
      '<td class="numeric">'+money(price)+'</td>'+
      '<td class="numeric">'+money(quantity*price)+'</td></tr>';
  }).join('');
  const totalRow=function(label,value,cssClass){
    return '<tr class="'+(cssClass||'')+'"><th>'+esc(label)+'</th><td>'+esc(value)+'</td></tr>';
  };
  const totals=totalRow('Nº de itens',String(items.length))+
    totalRow('Soma das Qtdes',qty(sumQty))+
    totalRow('Total de produtos','R$ '+money(productTotal))+
    (discount>0?totalRow('Desconto','- R$ '+money(discount)):'')+
    (freight>0?totalRow('Frete','R$ '+money(freight)):'')+
    totalRow('Total do pedido','R$ '+money(total),'grand');
  const paymentSummary='<section class="print-section payment-summary"><h2>Situação financeira do pedido</h2>'+
    '<table class="payment-totals"><tbody>'+
    '<tr><th>Total do pedido</th><td>R$ '+money(total)+'</td></tr>'+
    (finance.priorDebt>0?'<tr><th>Saldo anterior incorporado</th><td>R$ '+money(finance.priorDebt)+'</td></tr>':'')+
    '<tr><th>Adiantamentos / abatimentos no fechamento</th><td>R$ '+money(advance)+'</td></tr>'+
    '<tr><th>Pagamentos e abatimentos posteriores</th><td>R$ '+money(finance.sincePurchase)+'</td></tr>'+
    '<tr class="paid"><th>Total pago / abatido</th><td>R$ '+money(finance.settled)+'</td></tr>'+
    '<tr class="due"><th>Saldo a pagar</th><td>R$ '+money(balance)+'</td></tr>'+ 
    (supplierCredit>0?'<tr class="supplier-credit"><th>Saldo devedor do fornecedor (adiantamento não utilizado, disponível para próximas compras)</th><td>R$ '+money(supplierCredit)+'</td></tr>':'')+
    '</tbody></table></section>';
  const advanceRows=printAppliedAdvances(key,ticket,advance);
  const advanceDetails=advance>0
    ?'<section class="print-section applied-advances"><h2>Adiantamentos e abatimentos desta compra</h2>'+
      '<table class="installments"><thead><tr><th>Data</th><th>Origem</th><th>Referência / forma</th><th>Valor aplicado</th></tr></thead><tbody>'+
      advanceRows.map(function(row){return '<tr><td>'+esc(row.date?dateBR(row.date):'—')+'</td>'+
        '<td>'+esc(row.kind)+'</td><td>'+esc([row.ref,row.method].filter(Boolean).join(' · ')||'—')+'</td>'+
        '<td class="numeric">R$ '+money(row.amount)+'</td></tr>';}).join('')+
      '<tr class="advance-total"><th colspan="3">Total abatido no fechamento</th><td class="numeric">R$ '+money(advance)+'</td></tr>'+
      '</tbody></table></section>':'';
  const laterPayments=finance.payments.length
    ?'<section class="print-section payment-history"><h2>Pagamentos registrados após o pedido</h2><table class="installments">'+
      '<thead><tr><th>Data</th><th>Operação</th><th>Valor</th></tr></thead><tbody>'+
      finance.payments.map(function(p){return '<tr><td>'+esc(dateBR(p.date))+'</td><td>'+esc(p.description)+
        (p.details?' · '+esc(p.details):'')+'</td><td class="numeric">R$ '+money(p.amount)+'</td></tr>';}).join('')+
      '</tbody></table></section>':'';
  const installments=balance>0
    ?'<tr><td class="center">'+daysBetween(purchaseDate,dueDate)+'</td><td>'+esc(dateBR(dueDate))+'</td><td class="numeric">R$ '+money(balance)+'</td><td>'+esc(advance>0?'Abatimentos/adiantamentos aplicados: R$ '+money(advance):'Saldo do pedido')+'</td></tr>'
    :'<tr><td class="center">0</td><td>'+esc(dateBR(purchaseDate))+'</td><td class="numeric">R$ 0,00</td><td>Pedido quitado por abatimentos/adiantamentos</td></tr>';

  const logoSrc=esc(companyLogoSrc());

  return '<main class="phase4-print">'+
    '<div class="doc-topline"><span>'+esc(issued)+'</span><span>Pedido de Compra</span></div>'+
    '<header class="doc-header"><div class="brand"><div class="logo">'+
      '<img class="logo-image" src="'+logoSrc+'" alt="Logo Manuela Metais" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'+
      '<div class="logo-fallback">'+esc(companyName())+'</div></div></div>'+
      '<div class="company"><strong>'+esc(companyLegal())+'</strong>'+
      (info.cnpj?'<span>CNPJ: '+esc(info.cnpj)+'</span>':'')+
      (info.endereco||info.enderecoCurto?'<span>'+esc(info.endereco||info.enderecoCurto)+'</span>':'')+
      (companyContacts?'<span>'+esc(companyContacts)+'</span>':'')+
      (info.email?'<span>'+esc(info.email)+'</span>':'')+'</div></header>'+
    '<h1>Pedido de compra Nº '+esc(orderNo)+'</h1>'+
    '<div class="phase4-print-top"><section class="supplier"><h2>Fornecedor</h2><strong>'+esc(ticket.fornecedor||ticket.fornecedorNome||'—')+'</strong>'+
      (supplierDocuments?'<span>'+esc(supplierDocuments)+'</span>':'')+
      (supplierAddress?'<span>'+esc(supplierAddress)+'</span>':'')+
      supplierContacts.map(function(contact){return '<span>'+esc(contact)+'</span>';}).join('')+'</section>'+
      '<table class="meta"><tbody><tr><th>Número do pedido</th><td>'+esc(orderNo)+'</td></tr>'+
      (purchaseOrder?'<tr><th>Ordem de compra</th><td>'+esc(purchaseOrder)+'</td></tr>':'')+
      '<tr><th>Data</th><td>'+esc(dateBR(purchaseDate))+'</td></tr>'+
      '<tr><th>Data prevista</th><td>'+esc(expectedDate?dateBR(expectedDate):'')+'</td></tr></tbody></table></div>'+
    '<section class="print-section"><h2>Itens do pedido de compra</h2>'+
      '<table class="items"><colgroup><col class="col-description"><col class="col-quantity"><col class="col-unit-price"><col class="col-total"></colgroup>'+
      '<thead><tr><th>Descrição do material</th><th>Quantidade (kg)</th><th>Valor unitário</th><th>Valor total</th></tr></thead><tbody>'+itemRows+'</tbody></table>'+
      '<table class="print-totals" aria-label="Totais da compra"><tbody>'+totals+'</tbody></table></section>'+paymentSummary+advanceDetails+laterPayments+
    '<section class="print-section"><h2>Parcelas</h2><table class="installments"><thead><tr><th>Dias</th><th>Data Vencimento</th><th>Valor</th><th>Observações</th></tr></thead><tbody>'+installments+'</tbody></table></section>'+
    '<section class="print-section order-notes"><h2>Observações</h2><div class="notes">'+esc(orderNotes)+'</div></section>'+
  '</main>';
}
function printCss(){
  return `
    @page{size:A4;margin:14mm}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0}
    body{background:#e7e9ec;color:#151515;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .phase4-print{width:210mm;min-height:297mm;margin:16px auto;padding:12mm;background:#fff;box-shadow:0 3px 18px #0002;font-size:14px;line-height:1.5}
    .doc-topline{display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:13px}
    .doc-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;min-height:88px}
    .brand{width:150px;flex-shrink:0;display:flex;align-items:flex-start}
    .logo{width:118px;min-height:76px;border:1px solid #29453a;background:#fff;padding:7px;display:flex;align-items:center;justify-content:center;position:relative}
    .logo-image{display:block;max-width:100%;max-height:60px;object-fit:contain}
    .logo-fallback{display:none;width:100%;min-height:60px;align-items:center;justify-content:center;text-align:center;color:#1a3a2a;font-size:13px;line-height:1.1;font-weight:900;overflow-wrap:anywhere}
    .company{display:flex;flex-direction:column;text-align:right;gap:2px;max-width:64%;font-size:12px;line-height:1.3;overflow-wrap:anywhere}
    .company strong{font-size:14px}
    .phase4-print h1{text-align:center;font-size:22px;font-weight:700;margin:10px 0 22px}
    .phase4-print-top{display:grid;grid-template-columns:minmax(0,1fr) 38%;gap:7px;align-items:start}
    .supplier{min-height:49px;border:1px solid #555;padding:5px 7px;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}
    .supplier h2{font-size:14px;margin:0 0 3px;font-weight:700}
    .supplier strong{font-size:15px}
    .supplier span{font-size:13px}
    .meta{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}
    .meta th,.meta td{border:1px solid #555;text-align:left;padding:4px 5px;overflow-wrap:anywhere}
    .meta th{width:53%;font-weight:700}
    .print-section{margin-top:24px;break-inside:avoid-page}
    .print-section h2{font-size:16px;margin:0 0 5px;font-weight:700}
    .items,.installments{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}
    .items .col-description{width:52%}
    .items .col-quantity{width:16%}
    .items .col-unit-price{width:16%}
    .items .col-total{width:16%}
    .items th,.items td,.installments th,.installments td{border:1px solid #555;padding:4px 5px;vertical-align:top;overflow-wrap:anywhere}
    .items th,.installments th{font-weight:700;text-align:left}
    .items td.numeric,.installments td.numeric{text-align:right;white-space:nowrap}
    .items td.center,.installments td.center{text-align:center}
    .item-description strong,.item-description span{display:block}
    .item-description span{white-space:pre-wrap;font-size:12px;margin-top:2px}
    .items thead{display:table-header-group}
    .items tr,.installments tr{break-inside:avoid-page}
    .print-totals{width:49%;margin:1px 0 0 auto;border-collapse:collapse;font-size:13px}
    .print-totals th,.print-totals td{padding:1px 5px;text-align:right;vertical-align:top;white-space:nowrap}
    .print-totals th{font-weight:700}
    .print-totals td{min-width:75px}
    .print-totals .grand th,.print-totals .grand td{border-top:1px solid #555;font-weight:800}
    .installments th:nth-child(1){width:12%}.installments th:nth-child(2){width:28%}.installments th:nth-child(3){width:22%}
    .payment-totals{width:62%;margin-left:auto;border-collapse:collapse;font-size:13px}
    .payment-totals th,.payment-totals td{border-bottom:1px solid #dedede;padding:4px 6px}
    .payment-totals th{text-align:left;font-weight:500}
    .payment-totals td{text-align:right;white-space:nowrap}
    .payment-totals .paid{font-weight:700;background:#f4f8f5}
    .payment-totals .paid th{font-weight:700}
    .payment-totals .due{border-top:1px solid #555;font-weight:800}
    .payment-totals .due th{font-weight:800}
    .applied-advances{margin-top:14px}
    .applied-advances .installments th:first-child{width:19%}
    .applied-advances .installments th:nth-child(2){width:21%}
    .applied-advances .installments th:nth-child(3){width:40%}
    .applied-advances .installments th:last-child{width:20%}
    .applied-advances .advance-total{background:#f4f8f5;font-weight:700}
    .applied-advances .advance-total th{text-align:right}
    .payment-history{margin-top:14px}
    .payment-history .installments th:first-child{width:24%}
    .payment-history .installments th:last-child{width:24%}
    .payment-history .installments td:nth-child(2){overflow-wrap:anywhere}
    .notes{min-height:42px;border:1px solid #555;padding:7px;white-space:pre-wrap;overflow-wrap:anywhere}
    .print-actions{text-align:center;margin:18px 0 25px}
    .print-actions button{padding:11px 25px;border:0;border-radius:7px;background:#1a3a2a;color:#fff;font-size:13px;font-weight:700;cursor:pointer}
    @media screen and (max-width:850px){.phase4-print{width:100%;min-width:0;margin:0 auto;padding:16px;box-shadow:none}.phase4-print-top{grid-template-columns:1fr}.company{text-align:left;max-width:100%}.items th,.items td{padding:6px 4px}.items{font-size:14px}}
    @media print{
      html,body{background:#fff!important;margin:0!important;padding:0!important}
      .phase4-print{width:auto;min-height:0;margin:0;padding:0;box-shadow:none;font-size:14px}
      .print-actions{display:none!important}
      .print-section{break-inside:auto}
      .print-section h2{break-after:avoid-page}
    }
  `;
}
global.phase4PurchasePrint=function(ticketRef){
  let key=String(ticketRef||'').trim();
  let ticket=tickets()[key];
  if(!ticket){
    const pair=Object.entries(tickets()).find(function(entry){return String(entry[1]?.ticket||'')===key;});
    if(pair){key=pair[0];ticket=pair[1];}
  }
  if(!ticket){try{showToast('Compra não encontrada.','error');}catch(e){}return;}
  const win=window.open('','_blank','width=900,height=950');
  if(!win)return;
  win.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido '+esc(ticket.ticket||key)+'</title><style>'+printCss()+'</style></head><body>'+printHtml(key,ticket)+'<div class="print-actions"><button onclick="window.print()">Imprimir / Salvar PDF</button></div></body></html>');
  win.document.close();
};
global.phase1PurchasePrint=global.phase4PurchasePrint;
global.imprimirCanhoto=function(){
  const input=document.getElementById('ticket-input');
  const ref=String(input?.value||'').trim().toUpperCase();
  if(ref)return global.phase4PurchasePrint(ref);
  if(typeof legacy.canhoto==='function')return legacy.canhoto.apply(this,arguments);
};

document.addEventListener('erp:ready',function(){
  hideLegacySupplier();
  try{renderPendingQueue();}catch(e){}
});
setTimeout(hideLegacySupplier,1000);

global.__PURCHASE_ORDER_LAYOUT_READY__=true;
})(window);
