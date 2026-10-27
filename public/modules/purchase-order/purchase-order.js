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
  return new Date().toISOString().slice(0,10);
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
function financialData(body,supplierCode){
  // The legacy purchase form caches financial arrays in dataset. Those arrays may
  // be stale/empty after a new advance is created. The authoritative source is
  // ADT_POR_FORN, keyed by supplier code, not the visible supplier name.
  const code=String(supplierCode||'').trim();
  const bodyCode=String(body?.dataset?.fornCod||'').trim();
  const sameSupplier=code&&bodyCode===code;
  let adts=sameSupplier?jsonDataset(body,'adtsData',null):null;
  let cheques=sameSupplier?jsonDataset(body,'cheqsData',null):null;
  let balance=sameSupplier?Number(body?.dataset?.saldoAnterior||0)||0:0;
  try{
    const live=(ADT_POR_FORN[code]||[]).filter(function(a){
      return a&&String(a.status||'Pendente').trim().toLowerCase()!=='quitado';
    });
    const advances=live.filter(function(a){return !String(a.forma||'').toLowerCase().includes('cheque');});
    const advanceCheques=live.filter(function(a){return String(a.forma||'').toLowerCase().includes('cheque');});
    const supplierCheques=(CHEQUES_POR_FORN[code]||[]).filter(function(c){return c&&!c._aplicadoTicket&&c.status!=='Quitado';});
    adts=advances;
    cheques=supplierCheques.concat(advanceCheques);
  }catch(e){/* Data may still be loading; preserve matching cached values only. */}
  if(!(balance>0)){
    try{
      const raw=SALDO_DEVEDOR_FORN&&SALDO_DEVEDOR_FORN[code];
      balance=raw?(typeof raw==='object'?Number(raw.valor||0):Number(raw||0)):0;
    }catch(e){balance=0;}
  }
  return {adts:Array.isArray(adts)?adts:[],cheques:Array.isArray(cheques)?cheques:[],balance:Math.max(0,balance||0)};
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
  const adts=(state.adts||[]).map(function(a,index){
    return '<label class="phase4-po-pay-row"><input type="checkbox" id="csadt-'+index+'" value="'+Number(a.valor||0)+'" checked onchange="phase4PurchaseRecalc()"><span><b>'+esc(a.cod||'Adiantamento')+'</b><small>'+esc(a.data||'')+' · '+esc(a.forma||a.bancoNome||'')+'</small></span><strong>R$ '+money(a.valor)+'</strong></label>';
  }).join('');
  const cheques=(state.cheques||[]).map(function(c,index){
    return '<label class="phase4-po-pay-row"><input type="checkbox" id="cscheq-'+index+'" value="'+Number(c.valor||0)+'" checked onchange="phase4PurchaseRecalc()"><span><b>Cheque '+esc(c.num||c.cod||'')+'</b><small>'+esc(c.bomPara||c.data||'')+' · '+esc(c.banco||c.bancoNome||c.forma||'')+'</small></span><strong>R$ '+money(c.valor)+'</strong></label>';
  }).join('');
  const credit=state.previousCredit>0
    ? '<label class="phase4-po-pay-row credit"><input type="checkbox" id="cssdv" value="'+Number(state.previousCredit||0)+'" checked onchange="phase4PurchaseRecalc()"><span><b>Crédito anterior do fornecedor</b><small>Abatimento financeiro já existente</small></span><strong>R$ '+money(state.previousCredit)+'</strong></label>'
    : '';
  if(!adts&&!cheques&&!credit)return '<div class="phase4-po-empty-pay">Nenhum adiantamento, cheque ou crédito pendente para este fornecedor.</div>';
  return adts+cheques+credit;
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
    '<section class="phase4-po-card"><h3>Fornecedor</h3><label class="phase4-po-field full"><span>Fornecedor *</span><input id="phase4-po-supplier" list="phase4-po-suppliers" autocomplete="off" value="'+esc(selected)+'" placeholder="Digite ou selecione o fornecedor" onchange="phase4PurchaseSupplierChanged()"><datalist id="phase4-po-suppliers">'+supplierOptions()+'</datalist></label>'+sourceTicketsHtml(state)+'</section>'+
    '<section class="phase4-po-card"><h3>Itens do pedido de compra</h3><div class="phase4-po-table-wrap"><table class="phase4-po-table"><thead><tr><th>#</th><th>Item / Material</th><th>Observação</th><th>Un.</th><th>Quantidade</th><th>Preço unitário</th><th>Preço total</th><th></th></tr></thead><tbody id="phase4-po-items"></tbody></table></div><datalist id="phase4-po-materials">'+materialOptions()+'</datalist><button type="button" class="phase4-po-add-item" onclick="phase4PurchaseAddItem()" title="Adicionar material (Alt+Z)" aria-keyshortcuts="Alt+Z">＋ Adicionar outro item</button></section>'+
    '<section class="phase4-po-card phase4-po-notes-card" aria-labelledby="phase4-po-notes-title"><h3 id="phase4-po-notes-title">Observações</h3><label class="phase4-po-field phase4-po-order-notes" for="phase4-po-notes"><span>Observações do pedido</span><textarea id="phase4-po-notes" name="observacoesPedido" rows="4" placeholder="Digite as observações" oninput="phase4PurchaseSyncMeta()">'+esc(state.notes||'')+'</textarea></label></section>'+
    '<div class="phase4-po-columns">'+
      '<section class="phase4-po-card"><h3>Totais da compra</h3><div class="phase4-po-summary"><div><span>Nº de itens</span><b id="phase4-po-item-count">0</b></div><div><span>Soma das quantidades</span><b id="phase4-po-qty-total">0 kg</b></div><div><span>Total dos produtos</span><b id="phase4-po-products-total">R$ 0,00</b></div><div class="grand"><span>Total do pedido</span><b id="phase4-po-grand-total">R$ 0,00</b></div></div><div class="phase4-po-form-grid two"><label class="phase4-po-field"><span>Desconto R$</span><input id="phase4-po-discount" inputmode="decimal" value="'+esc(state.discount?money(state.discount):'0,00')+'" oninput="phase4PurchaseRecalc()"></label><label class="phase4-po-field"><span>Frete R$</span><input id="phase4-po-freight" inputmode="decimal" value="'+esc(state.freight?money(state.freight):'0,00')+'" oninput="phase4PurchaseRecalc()"></label></div></section>'+
      '<section class="phase4-po-card"><h3>Detalhes da compra</h3><div class="phase4-po-form-grid"><label class="phase4-po-field"><span>Número do pedido</span><input id="phase4-po-number" value="'+esc(state.orderNumber||'')+'" oninput="phase4PurchaseSyncMeta()"></label><label class="phase4-po-field"><span>Ordem de compra</span><input id="phase4-po-order" value="'+esc(state.purchaseOrder||'')+'" oninput="phase4PurchaseSyncMeta()"></label><label class="phase4-po-field"><span>Data da compra</span><input id="phase4-po-date" type="date" value="'+esc(state.purchaseDate||today())+'" onchange="phase4PurchaseSyncMeta()"></label></div></section>'+
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
  // Uma observação removida no formulário precisa continuar vazia, sem restaurar o valor anterior.
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
    // All historic prepayments and paid installments have already been applied.
    // Editing only changes the outstanding amount by the difference in gross total.
    advances=Math.max(0,Number(state.appliedAdvance||0));
  }
  const balance=state.editKey
    ? Math.round((Number(state.originalBalance||0)+(total-Number(state.originalTotal||0)))*100)/100
    : Math.round((total-advances)*100)/100;

  const set=function(id,text){const el=document.getElementById(id);if(el)el.textContent=text;};
  set('phase4-po-item-count',String((state.items||[]).filter(function(i){return i.mat||Number(i.quantidade)>0;}).length));
  set('phase4-po-qty-total',qty((state.items||[]).reduce(function(sum,item){return sum+Number(item.quantidade||0);},0))+' kg');
  set('phase4-po-products-total','R$ '+money(productTotal));
  set('phase4-po-grand-total','R$ '+money(total));
  set('phase4-po-advance-total','R$ '+money(advances));
  set('phase4-po-balance',(balance<0?'Crédito R$ ':'R$ ')+money(Math.abs(balance)));
  const balanceEl=document.getElementById('phase4-po-balance');
  if(balanceEl)balanceEl.classList.toggle('credit',balance<0);
  storeState(body,state);
  return {productTotal,total,advances,balance};
};
global.phase4PurchaseSupplierChanged=function(){
  // A troca de fornecedor nunca deve desmontar o input dentro do evento change/blur.
  // O Chrome pode disparar NotFoundError ao tentar atualizar o foco de um nó removido.
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
      // Não reutilizar os datasets financeiros do fornecedor anterior.
      const fin=financialData(null,supplier.cod);
      next.supplierName=supplier.nome;
      next.supplierCode=supplier.cod||'';
      next.adts=fin.adts;
      next.cheques=fin.cheques;
      next.previousCredit=fin.balance;
      next.sourceTicketKeys=[];
      if(!next.items?.length)next.items=[newItem()];
      storeState(target,next);
      render(target);
      return;
    }
    global.csCarregarForn(supplier.nome);
  },0);
};
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
    if(typeof saveContasPagar==='function')saveContasPagar();
    if(typeof renderContasPagar==='function')renderContasPagar();
  }catch(e){console.warn('[purchase-order] contas a pagar',e);}
}
function syncSupplierCredit(ticket,state,totals){
  if(!state.supplierCode)return;
  try{
    if(totals.balance < -0.005){
      SALDO_DEVEDOR_FORN[state.supplierCode]={
        valor:Math.abs(totals.balance),
        ticket:ticket.ticket||'',
        data:state.purchaseDate||today()
      };
    }else{
      const current=SALDO_DEVEDOR_FORN&&SALDO_DEVEDOR_FORN[state.supplierCode];
      if(current){
        const currentTicket=typeof current==='object'?String(current.ticket||''):'';
        if(!currentTicket||currentTicket===String(ticket.ticket||''))delete SALDO_DEVEDOR_FORN[state.supplierCode];
      }
    }
    localStorage.setItem('mm_saldo_devedor',JSON.stringify(SALDO_DEVEDOR_FORN));
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
  ticket.numeroPedido=state.orderNumber||ticket.ticket||key;
  ticket.ordemCompra=state.purchaseOrder||'';
  ticket.dataCompra=state.purchaseDate||today();
  ticket.data=ticket.dataCompra;
  ticket.vencimentoSaldo=state.dueDate||today();
  ticket.observacoesPedido=String(state.notes||'').trim();
  ticket.descontoCompra=Number(state.discount||0);
  ticket.freteCompra=Number(state.freight||0);
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
  try{saveDB();}catch(e){}
  try{if(typeof fbSalvarImediato==='function')fbSalvarImediato();}catch(e){}
  try{if(typeof renderTickets==='function')renderTickets();}catch(e){}
  try{if(typeof renderDashboard==='function')renderDashboard();}catch(e){}
  return ticket;
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
  ['phase4Order','itensData','ticketKeys','adtsData','cheqsData','saldoAnterior','fornCod','itensCount','adtCount','cheqsCount','phase1Extras','phase1Enhanced'].forEach(function(key){delete body.dataset[key];});
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
global.phase4PurchaseSave=function(){
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
    try{
      const totals=global.phase4PurchaseRecalc();
      const ticket=saveEditedTicket(state,totals);
      resetOrderState(body);
      manualMode=false;
      if(typeof global.csTab==='function')global.csTab('historico');
      try{showToast('Pedido '+String(ticket.ticket||state.editKey)+' atualizado.','success');}catch(e){}
    }catch(error){try{showToast(error.message||'Erro ao atualizar pedido.','error',7000);}catch(e){}}
    finally{setSaving(false);}
    return;
  }
  let prepared;
  try{
    validateSourceTickets(state);
    prepared=prepareLegacy(body,state);
  }catch(error){
    try{showToast(error.message,'error',6000);}catch(e){alert(error.message);}
    return;
  }
  const totals=global.phase4PurchaseRecalc();
  const before=new Set(Object.keys(tickets()));
  setSaving(true);
  try{
    const result=legacy.confirmPurchase.call(global,prepared.supplier.nome);
    const created=Object.keys(tickets()).filter(function(key){return !before.has(key);});
    const key=created[created.length-1];
    if(!key)throw new Error('O pedido não foi criado. Nenhuma alteração foi aplicada à fila.');
    const ticket=patchCreatedTicket(key,state,prepared.legacyItems,totals);
    finishPurchaseSave(body,key,ticket,totals);
    return result;
  }catch(error){
    console.error('[purchase-order] salvar',error);
    try{showToast(error.message||'Não foi possível salvar o pedido.','error',7000);}catch(e){}
  }finally{
    setSaving(false);
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
function stateForExistingTicket(key){
  const ticket=tickets()[key];if(!ticket)return null;
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
    editKey:key,supplierName:supplier.nome,supplierCode:supplier.cod||'',
    items:items.length?items:[newItem()],
    discount:Number(ticket.descontoCompra??po.desconto??0)||0,
    freight:Number(ticket.freteCompra??po.frete??0)||0,
    orderNumber:String(ticket.numeroPedido||po.numero||ticket.ticket||key),
    purchaseOrder:String(ticket.ordemCompra||po.ordemCompra||''),
    purchaseDate:isoDate(ticket.dataCompra||po.dataCompra||ticket.data),
    dueDate:isoDate(ticket.vencimentoSaldo||po.vencimentoSaldo||ticket.data),
    sourceTicketKeys:[],adts:[],cheques:[],previousCredit:0,
    appliedAdvance:Number(ticket.adiantamento||0)||0,
    originalBalance:Math.max(0,Number(ticket.saldoPagar||0)),
    originalTotal:Number(ticket.totalGeral||0)||0,
    // Preserve legacy extras/taxes outside the product grid (e.g. extra services).
    legacyExtra:Math.round(((Number(ticket.totalGeral||0)||0)-
      ((ticket.itens||[]).reduce(function(sum,i){return sum+itemNet(i)*Number(i.preco||0);},0)-
      (Number(ticket.descontoCompra??po.desconto??0)||0)+(Number(ticket.freteCompra??po.frete??0)||0)))*100)/100,
    notes:String(ticket.observacoesPedido||po.observacoes||'')
  };
}
global.phase4PurchaseEditTicket=function(ticketRef){
  const ref=String(ticketRef||'').trim();
  const entry=tickets()[ref]?[ref,tickets()[ref]]:Object.entries(tickets()).find(function(e){return String(e[1]?.ticket||'')===ref;});
  if(!entry){try{showToast('Pedido não encontrado.','error');}catch(e){}return;}
  if(entry[1].status==='Aguard. Preço'||entry[1]._balSessao||entry[1]._rodEntrada){
    try{showToast('Finalize primeiro a pesagem antes de editar o pedido.','error');}catch(e){}return;
  }
  let state;try{state=stateForExistingTicket(entry[0]);}catch(e){try{showToast(e.message,'error');}catch(_){}return;}
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
  const ticket=tickets()[state.editKey];
  if(!ticket)throw new Error('O pedido não existe mais. Atualize o histórico.');
  const oldTotal=Number(ticket.totalGeral||0);
  if(Math.abs(oldTotal-Number(state.originalTotal||0))>0.01 || Math.abs(Number(ticket.saldoPagar||0)-Number(state.originalBalance||0))>0.01)
    throw new Error('O pedido foi alterado por outra operação. Reabra-o para editar os valores atuais.');
  if(totals.balance< -0.005)throw new Error('O total editado ficou abaixo do que já foi pago/abatido. Ajuste o pedido e os pagamentos antes de salvar.');
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
  ticket.numeroPedido=state.orderNumber;
  ticket.ordemCompra=state.purchaseOrder;
  ticket.dataCompra=state.purchaseDate;
  ticket.vencimentoSaldo=state.dueDate;
  ticket.observacoesPedido=String(state.notes||'').trim();
  ticket.saldoPagar=Math.max(0,totals.balance);
  if(totals.balance>0.005)ticket.status='Pendente';
  else ticket.status='Pago';
  ticket.pedidoCompra=Object.assign({},ticket.pedidoCompra||{}, {
    numero:state.orderNumber,ordemCompra:state.purchaseOrder,dataCompra:state.purchaseDate,
    vencimentoSaldo:state.dueDate,observacoes:ticket.observacoesPedido,
    desconto:state.discount,frete:state.freight,totalProdutos:totals.productTotal,totalPedido:totals.total
  });
  // Do not touch ADT_POR_FORN, CHEQUES_POR_FORN or reciboFinanceiro: they were
  // settled during creation. Only update the residual payable for this ticket.
  try{
    let cp=(CONTAS_PAGAR||[]).find(function(c){return String(c.ticket||'')===String(ticket.ticket||state.editKey)&&c.status!=='Pago';});
    if(totals.balance>0.005){
      if(cp){cp.valor=totals.balance;cp.venc=state.dueDate.split('-').reverse().join('/');}
      else if(typeof _novoIdCP==='function'){
        CONTAS_PAGAR.push({id:_novoIdCP(),lancto:state.purchaseDate.split('-').reverse().join('/'),
          desc:'Compra de Sucata — '+state.supplierName+' — '+String(ticket.ticket||state.editKey),
          cred:state.supplierName,cat:'Compra de Sucata',tipoForn:'compra',
          bancoCod:'',bancoNome:'',venc:state.dueDate.split('-').reverse().join('/'),
          valor:totals.balance,status:'Pendente',dataPgto:'',obs:'Ajuste do pedido existente',
          ticket:ticket.ticket||state.editKey,fornCod:state.supplierCode});
      }
    }else if(cp && !cp.valorPago && !(cp.pagamentos||[]).length){
      const index=CONTAS_PAGAR.indexOf(cp);if(index>=0)CONTAS_PAGAR.splice(index,1);
    }
    if(typeof saveContasPagar==='function')saveContasPagar();
  }catch(e){console.warn('[purchase-order] conta vinculada',e);throw new Error('Não foi possível atualizar a conta a pagar do pedido.');}
  try{saveDB();}catch(e){throw new Error('Não foi possível persistir a edição.');}
  try{if(typeof fbSalvarImediato==='function')fbSalvarImediato();}catch(e){}
  try{if(typeof registrarHistorico==='function')registrarHistorico('Compra de Sucata','Pedido editado',String(ticket.ticket||state.editKey),ticket,{ticket:ticket.ticket||state.editKey});}catch(e){}
  ['renderTickets','renderContasPagar','renderEstoque','renderDashboard','renderFluxo'].forEach(function(name){try{if(typeof global[name]==='function')global[name]();}catch(e){}});
  return ticket;
}
function stateForSourceTicket(ticketKey){
  const t=tickets()[ticketKey];if(!t)return null;
  const supplierName=String(t.fornecedor||t.fornecedorNome||t.forn||'').trim();
  const supplier=supplierByName(supplierName);
  if(!supplier)return null;
  const fin=financialData(null,supplier.cod||'');
  let items=ticketItemsForOrder(t);
  items.forEach(function(item){
    if(Number(item.preco||0)>0||!item.mat)return;
    try{
      item.preco=Number(PRECOS_FORN_DATA?.[supplier.cod]?.[String(item.mat).trim().toUpperCase()]||PRECOS_FORN_DATA?.[supplier.cod]?.[String(item.mat).trim()]||0)||0;
    }catch(e){}
  });
  if(!items.length)items=[newItem()];
  let number='';try{number=typeof getNextTicketId==='function'?getNextTicketId():'';}catch(e){}
  return {supplierName:supplier.nome,supplierCode:supplier.cod||'',items,discount:0,freight:0,orderNumber:number,purchaseOrder:'',purchaseDate:today(),dueDate:today(),sourceTicketKeys:[ticketKey],adts:fin.adts,cheques:fin.cheques,previousCredit:fin.balance,notes:''};
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
          // Reopening the tab must reflect advances registered in another module
          // without discarding the material/items already typed on this form.
          const state=currentState(body);
          if(!state.editKey&&state.supplierCode){
            const fresh=financialData(body,state.supplierCode);
            const signature=function(items){return JSON.stringify((items||[]).map(function(i){return [i.cod||i.id||i.num,i.valor,i.status];}));};
            if(signature(fresh.adts)!==signature(state.adts)||signature(fresh.cheques)!==signature(state.cheques)){
              global.phase4PurchaseRecalc();
              global.phase4PurchaseSyncMeta();
              state.adts=fresh.adts;
              state.cheques=fresh.cheques;
              state.previousCredit=fresh.balance;
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
function printHtml(key,ticket){
  const info=companyInfo();
  const supplier=supplierInfo(ticket);
  const po=ticket.pedidoCompra||{};
  const orderNo=ticket.numeroPedido||po.numero||ticket.ticket||key;
  const purchaseDate=ticket.dataCompra||po.dataCompra||ticket.data||'';
  // Vencimento financeiro não é a data prevista da entrega do material.
  const expectedDate=ticket.dataPrevista||po.dataPrevista||'';
  const dueDate=ticket.vencimentoSaldo||po.vencimentoSaldo||purchaseDate;
  const items=Array.isArray(ticket.itens)?ticket.itens:[];
  const productTotal=Number(ticket.totalProdutos!=null?ticket.totalProdutos:items.reduce(function(sum,item){
    return sum+Number(item.total!=null?item.total:Number(item.pesoLiq||item.quantidade||0)*Number(item.preco||0));
  },0));
  const discount=Number(ticket.descontoCompra||po.desconto||0);
  const freight=Number(ticket.freteCompra||po.frete||0);
  const total=Number(ticket.totalGeral!=null?ticket.totalGeral:(po.totalPedido!=null?po.totalPedido:Math.max(0,productTotal-discount+freight)));
  const advance=Number(ticket.adiantamento||0);
  const balance=Math.max(0,Number(ticket.saldoPagar!=null?ticket.saldoPagar:total-advance));
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
      '<td class="center">'+esc(item.unidade||'kg')+'</td>'+
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
      '<table class="items"><colgroup><col class="col-description"><col class="col-unit"><col class="col-quantity"><col class="col-unit-price"><col class="col-total"></colgroup>'+
      '<thead><tr><th>Descrição do material</th><th>Un</th><th>Qtde</th><th>Valor unitário</th><th>Valor total</th></tr></thead><tbody>'+itemRows+'</tbody></table>'+
      '<table class="print-totals" aria-label="Totais da compra"><tbody>'+totals+'</tbody></table></section>'+
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
    .phase4-print{width:210mm;min-height:297mm;margin:16px auto;padding:14mm;background:#fff;box-shadow:0 3px 18px #0002;font-size:10px;line-height:1.3}
    .doc-topline{display:flex;justify-content:space-between;align-items:center;font-size:8px;margin-bottom:13px}
    .doc-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;min-height:88px}
    .brand{width:150px;flex-shrink:0;display:flex;align-items:flex-start}
    .logo{width:118px;min-height:76px;border:1px solid #29453a;background:#fff;padding:7px;display:flex;align-items:center;justify-content:center;position:relative}
    .logo-image{display:block;max-width:100%;max-height:60px;object-fit:contain}
    .logo-fallback{display:none;width:100%;min-height:60px;align-items:center;justify-content:center;text-align:center;color:#1a3a2a;font-size:13px;line-height:1.1;font-weight:900;overflow-wrap:anywhere}
    .company{display:flex;flex-direction:column;text-align:right;gap:2px;max-width:64%;font-size:8px;line-height:1.25;overflow-wrap:anywhere}
    .company strong{font-size:8.5px}
    .phase4-print h1{text-align:center;font-size:15px;font-weight:700;margin:10px 0 22px}
    .phase4-print-top{display:grid;grid-template-columns:minmax(0,1fr) 38%;gap:7px;align-items:start}
    .supplier{min-height:49px;border:1px solid #555;padding:5px 7px;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}
    .supplier h2{font-size:9px;margin:0 0 3px;font-weight:700}
    .supplier strong{font-size:9px}
    .supplier span{font-size:8.5px}
    .meta{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9px}
    .meta th,.meta td{border:1px solid #555;text-align:left;padding:4px 5px;overflow-wrap:anywhere}
    .meta th{width:53%;font-weight:700}
    .print-section{margin-top:24px;break-inside:avoid-page}
    .print-section h2{font-size:10px;margin:0 0 5px;font-weight:700}
    .items,.installments{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9px}
    .items .col-description{width:48%}
    .items .col-unit{width:8%}
    .items .col-quantity{width:14%}
    .items .col-unit-price{width:15%}
    .items .col-total{width:15%}
    .items th,.items td,.installments th,.installments td{border:1px solid #555;padding:4px 5px;vertical-align:top;overflow-wrap:anywhere}
    .items th,.installments th{font-weight:700;text-align:left}
    .items td.numeric,.installments td.numeric{text-align:right;white-space:nowrap}
    .items td.center,.installments td.center{text-align:center}
    .item-description strong,.item-description span{display:block}
    .item-description span{white-space:pre-wrap;font-size:8px;margin-top:2px}
    .items thead{display:table-header-group}
    .items tr,.installments tr{break-inside:avoid-page}
    .print-totals{width:42%;margin:1px 0 0 auto;border-collapse:collapse;font-size:9px}
    .print-totals th,.print-totals td{padding:1px 5px;text-align:right;vertical-align:top;white-space:nowrap}
    .print-totals th{font-weight:700}
    .print-totals td{min-width:75px}
    .print-totals .grand th,.print-totals .grand td{border-top:1px solid #555;font-weight:800}
    .installments th:nth-child(1){width:12%}.installments th:nth-child(2){width:28%}.installments th:nth-child(3){width:22%}
    .notes{min-height:42px;border:1px solid #555;padding:7px;white-space:pre-wrap;overflow-wrap:anywhere}
    .print-actions{text-align:center;margin:18px 0 25px}
    .print-actions button{padding:11px 25px;border:0;border-radius:7px;background:#1a3a2a;color:#fff;font-size:13px;font-weight:700;cursor:pointer}
    @media print{
      html,body{background:#fff!important;margin:0!important;padding:0!important}
      .phase4-print{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}
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
  win.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido '+esc(ticket.numeroPedido||ticket.ticket||key)+'</title><style>'+printCss()+'</style></head><body>'+printHtml(key,ticket)+'<div class="print-actions"><button onclick="window.print()">Imprimir / Salvar PDF</button></div></body></html>');
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
