(function(global){
'use strict';

const domain=global.RoadWeighingDomain;
const view=global.RoadWeighingView;
if(!domain||!view){
  console.error('[road-weighing] Dependências do módulo não foram carregadas.');
  return;
}

const original={
  registerEntry:global.rodRegistrarEntrada,
  renderRoad:global.renderRodBalanca,
  renderBalance:global.renderBalanceiro,
  selectBalanceTicket:global.balSelecionarTicket,
  finishBalance:global.balFinalizarPesagem,
  addRoadMaterial:global.rodAdicionarMaterialCompra,
  finishRoadMaterials:global.rodFinalizarCompraMateriais,
  finishRoadExit:global.rodFinalizarSaidaSelecionada,
  updateRoadWeight:global._rodAtualizarPeso
};

function tickets(){
  try{return TICKETS_DB||{};}catch(error){return {};}
}

function ticket(ticketId){
  return tickets()[ticketId]||null;
}

function currentRoadWeight(){
  try{return domain.number(_rodPesoAtual);}catch(error){return 0;}
}

function managedTickets(){
  return Object.entries(tickets())
    .filter(([,item])=>domain.isManaged(item)&&domain.isPurchase(item)&&!domain.isFinal(item))
    .sort((left,right)=>{
      const a=Date.parse(left[1]?.criadoEm||left[1]?.data||0)||0;
      const b=Date.parse(right[1]?.criadoEm||right[1]?.data||0)||0;
      return b-a;
    });
}

function legacyAwaitingTickets(){
  let activePurchaseTicket='';
  try{activePurchaseTicket=_rodTicketCompraAtivo||'';}catch(error){}
  return Object.entries(tickets()).filter(([ticketId,item])=>{
    if(domain.isManaged(item))return false;
    const purchaseBeingEdited=activePurchaseTicket===ticketId;
    return item&&item._rodEntrada&&!(domain.number(item.pesoTara)>0)&&
      item.status!=='Aguard. Preço'&&item.status!=='Pendente'&&item.status!=='Pago'&&item.status!=='Consolidado'&&
      item.tipo!=='venda'&&!purchaseBeingEdited;
  });
}

function focusTicket(){
  const candidates=[];
  try{if(_rodTicketSaida)candidates.push(_rodTicketSaida);}catch(error){}
  try{if(_rodTicketCompraAtivo)candidates.push(_rodTicketCompraAtivo);}catch(error){}
  for(const ticketId of candidates){
    const item=ticket(ticketId);
    if(item&&domain.isManaged(item)&&!domain.isFinal(item))return [ticketId,item];
  }
  return managedTickets()[0]||null;
}

function persist(ticketId){
  try{if(typeof saveDB==='function')saveDB();}catch(error){console.warn('[road-weighing] saveDB:',error);}
  try{
    if(ticketId&&typeof _rodPersistirTicketCritico==='function'){
      Promise.resolve(_rodPersistirTicketCritico(ticketId)).catch(()=>{});
    }
  }catch(error){console.warn('[road-weighing] persistência crítica:',error);}
}

function renderRoadEnhancements(){
  const managed=managedTickets();
  view.renderRoadSummary({
    focus:focusTicket(),
    activeCount:managed.length,
    currentWeight:currentRoadWeight()
  });
  view.renderRoadQueue({
    managed,
    legacy:legacyAwaitingTickets()
  });
}

function activeBalanceTicket(){
  let ticketId='';
  try{ticketId=_balTicketAtivo||'';}catch(error){}
  return ticketId?ticket(ticketId):null;
}

function renderBalanceEnhancements(){
  view.renderBalanceState(activeBalanceTicket());
}

function showMessage(message,type='success',duration=5000){
  try{if(typeof showToast==='function')showToast(message,type,duration);}catch(error){}
}

function confirmAction(message,onConfirm,confirmLabel){
  if(typeof confirmarAcao==='function'){
    confirmarAcao(message,onConfirm,confirmLabel||'Confirmar','btn-save');
    return;
  }
  if(global.confirm(message))onConfirm();
}

function initializeTicketAfterFirstWeight(ticketId,item){
  if(!item)return;
  item._weighingFlowVersion=1;
  item._weighingRoute='';
  item._weighingStage='aguardando_rota';
  item._rodSessao=true;
  item._balSessao=false;
  item._balBagsFinalizado=false;
  item.pesoRodoviaria=domain.number(item.pesoEntrada);
  item.status='Aguardando rota';
  item.criadoEm=item.criadoEm||domain.now();
  domain.registerWeight(item,'rodoviaria_entrada',{
    origem:'rodoviaria',
    peso:domain.number(item.pesoEntrada),
    placa:item.placa||'',
    motorista:item.motorista||''
  },`entrada:${domain.number(item.pesoEntrada)}`);
  domain.registerFlow(item,'aguardando_rota','Primeira pesagem registrada; aguardando escolha da rota operacional');
  persist(ticketId);
}

global.roadWeighingContinueOnRoad=function(ticketId){
  const item=ticket(ticketId);
  if(!item)return;
  item._weighingFlowVersion=1;
  item._weighingRoute='rodoviaria';
  item._weighingStage='rodoviaria_materiais';
  item._rodSessao=true;
  item._balSessao=false;
  item._balBagsFinalizado=false;
  item.status='Pesagem na Rodoviária';
  domain.registerFlow(item,'rodoviaria_materiais','Operador escolheu concluir o atendimento somente no Balanção');
  persist(ticketId);
  try{if(typeof rodEntrarModoMateriaisCompra==='function')rodEntrarModoMateriaisCompra(ticketId);}catch(error){}
  try{if(typeof renderBalanceiro==='function')renderBalanceiro();}catch(error){}
  showMessage(`✅ ${ticketId} seguirá somente pela Balança Rodoviária. Registre os materiais/pesagens.`,'success',5500);
};

global.roadWeighingSendToBalance=function(ticketId){
  const item=ticket(ticketId);
  if(!item)return;
  item._weighingFlowVersion=1;
  item._weighingRoute='balanceiro';
  item._weighingStage='balanceiro';
  item._rodSessao=true;
  item._balSessao=true;
  item._balBagsFinalizado=false;
  item.pesoRodoviaria=domain.number(item.pesoEntrada);
  item.status='No Balanceiro';
  domain.registerFlow(item,'balanceiro','Ticket encaminhado ao Balanceiro mantendo o mesmo atendimento');
  try{
    if(typeof _rodTicketCompraAtivo!=='undefined'&&_rodTicketCompraAtivo===ticketId&&typeof rodCancelarModoMateriaisCompra==='function'){
      rodCancelarModoMateriaisCompra();
    }
  }catch(error){}
  persist(ticketId);
  try{if(typeof renderRodBalanca==='function')renderRodBalanca();}catch(error){}
  try{if(typeof renderBalanceiro==='function')renderBalanceiro();}catch(error){}
  showMessage(`📦 ${ticketId} encaminhado ao Balanceiro. O mesmo ticket será preservado até o fechamento.`,'success',6000);
};

if(typeof original.registerEntry==='function'){
  global.rodRegistrarEntrada=function(){
    let type='compra';
    try{type=_rodTipoAtual||'compra';}catch(error){}
    const before=new Set(Object.keys(tickets()));
    const result=original.registerEntry.apply(this,arguments);
    if(type!=='compra')return result;
    const created=Object.keys(tickets()).find(ticketId=>!before.has(ticketId));
    const item=created?ticket(created):null;
    if(!created||!item)return result;
    initializeTicketAfterFirstWeight(created,item);
    try{
      if(typeof _rodTicketCompraAtivo!=='undefined'&&_rodTicketCompraAtivo===created&&typeof rodCancelarModoMateriaisCompra==='function'){
        rodCancelarModoMateriaisCompra();
      }
    }catch(error){}
    try{if(typeof renderRodBalanca==='function')renderRodBalanca();}catch(error){}
    try{if(typeof renderBalanceiro==='function')renderBalanceiro();}catch(error){}
    showMessage(`🚛 ${created} aberto. Escolha: Somente Balanção ou Encaminhar ao Balanceiro.`,'info',7000);
    return result;
  };
}

if(typeof original.renderRoad==='function'){
  global.renderRodBalanca=function(){
    const result=original.renderRoad.apply(this,arguments);
    try{renderRoadEnhancements();}catch(error){console.warn('[road-weighing] render Rodoviária:',error);}
    return result;
  };
}

if(typeof original.renderBalance==='function'){
  global.renderBalanceiro=function(){
    const result=original.renderBalance.apply(this,arguments);
    try{renderBalanceEnhancements();}catch(error){console.warn('[road-weighing] render Balanceiro:',error);}
    return result;
  };
}

if(typeof original.selectBalanceTicket==='function'){
  global.balSelecionarTicket=function(ticketId){
    const item=ticket(ticketId);
    try{
      if(item&&Array.isArray(item.bags)&&typeof _balBags!=='undefined'&&(!_balBags[ticketId]||!_balBags[ticketId].length)){
        _balBags[ticketId]=item.bags.slice();
      }
    }catch(error){}
    const result=original.selectBalanceTicket.apply(this,arguments);
    try{renderBalanceEnhancements();}catch(error){}
    return result;
  };
}

global.balSincronizarComCompra=function(ticketId,bag){
  const item=ticket(ticketId);
  if(!item)return;
  domain.syncItemsFromBalance(item);
  const scale=document.getElementById('bal-balanca-sel')?.value||'';
  domain.registerWeight(item,'balanceiro_item',{
    origem:'balanceiro',
    material:bag?.mat||bag?.material||'',
    bagNum:bag?.bagNum||0,
    pesoBruto:domain.number(bag?.br),
    desconto:domain.number(bag?.desc),
    pesoLiquido:domain.number(bag?.lq||bag?.br),
    balanca:scale
  },`bag:${bag?.bagNum||0}:${domain.text(bag?.mat)}:${domain.number(bag?.br)}:${domain.number(bag?.lq||bag?.br)}`);
  persist(ticketId);
};

if(typeof original.finishBalance==='function'){
  global.balFinalizarPesagem=function(){
    let ticketId='';
    try{ticketId=_balTicketAtivo||'';}catch(error){}
    const item=ticketId?ticket(ticketId):null;
    if(!item||!domain.isManaged(item)||item._weighingRoute!=='balanceiro'){
      return original.finishBalance.apply(this,arguments);
    }
    let bags=[];
    try{bags=(_balBags[ticketId]||item.bags||[]).slice();}catch(error){bags=(item.bags||[]).slice();}
    if(!bags.length){
      showMessage('Adicione pelo menos uma bag/item antes de finalizar!','error');
      return;
    }
    const total=bags.reduce((sum,bag)=>sum+domain.number(bag.lq||bag.br),0);
    confirmAction(
      `Concluir Balanceiro do ticket ${ticketId}?\n\n${bags.length} registro(s) · ${total.toFixed(1)} kg\n\nO caminhão voltará ao Balanção para o peso final.`,
      function(){
        item.bags=bags.slice();
        item._balBagsFinalizado=true;
        item._balSessao=true;
        item._rodSessao=true;
        item._weighingStage='balanceiro_concluido';
        item.status='Balanceiro concluído';
        item.totalKg=total;
        domain.syncItemsFromBalance(item);
        domain.registerFlow(item,'balanceiro_concluido','Balanceiro finalizado; caminhão liberado para retornar ao Balanção');
        persist(ticketId);
        try{renderBalanceiro();}catch(error){}
        try{renderRodBalanca();}catch(error){}
        showMessage(`✅ Balanceiro concluído. O ticket ${ticketId} está liberado na Rodoviária para o peso final.`,'success',7500);
      },
      'Concluir Balanceiro'
    );
  };
}

if(typeof original.addRoadMaterial==='function'){
  global.rodAdicionarMaterialCompra=function(){
    let ticketId='';
    let previousCount=0;
    try{
      ticketId=_rodTicketCompraAtivo||'';
      const item=ticketId?ticket(ticketId):null;
      previousCount=Array.isArray(item?.pesagensCompra)?item.pesagensCompra.length:0;
    }catch(error){}
    const result=original.addRoadMaterial.apply(this,arguments);
    const item=ticketId?ticket(ticketId):null;
    if(item&&domain.isManaged(item)&&item._weighingRoute==='rodoviaria'&&Array.isArray(item.pesagensCompra)&&item.pesagensCompra.length>previousCount){
      for(let index=previousCount;index<item.pesagensCompra.length;index+=1){
        const weight=item.pesagensCompra[index];
        domain.registerWeight(item,'rodoviaria_material',{
          origem:'rodoviaria',
          material:weight.material||'',
          pesoAnterior:domain.number(weight.pesoAnt),
          pesoAtual:domain.number(weight.pesoBrutoAcum),
          pesoLiquido:domain.number(weight.pesoLiquido)
        },`rodmat:${index}:${domain.text(weight.tsRegistro)}:${domain.text(weight.material)}`);
      }
      domain.syncItemsFromRoad(item);
      persist(ticketId);
      try{renderRoadEnhancements();}catch(error){}
    }
    return result;
  };
}

if(typeof original.finishRoadMaterials==='function'){
  global.rodFinalizarCompraMateriais=function(){
    let ticketId='';
    try{ticketId=_rodTicketCompraAtivo||'';}catch(error){}
    const result=original.finishRoadMaterials.apply(this,arguments);
    const item=ticketId?ticket(ticketId):null;
    if(item&&domain.isManaged(item)&&item._weighingRoute==='rodoviaria'&&String(item.status)==='Aguard. Preço'){
      domain.syncItemsFromRoad(item);
      item._weighingStage='aguardando_preco';
      domain.registerWeight(item,'rodoviaria_saida',{
        origem:'rodoviaria',
        peso:domain.number(item.pesoTara),
        pesoLiquido:domain.number(item.pesoLiquido)
      },`saida:rod:${domain.number(item.pesoTara)}:${domain.number(item.pesoLiquido)}`);
      domain.registerFlow(item,'aguardando_preco','Pesagem rodoviária concluída; ticket enviado para fechamento da Compra de Sucata');
      persist(ticketId);
      try{if(typeof renderTickets==='function')renderTickets();}catch(error){}
    }
    return result;
  };
}

if(typeof original.finishRoadExit==='function'){
  global.rodFinalizarSaidaSelecionada=function(){
    let ticketId='';
    try{ticketId=_rodTicketSaida||'';}catch(error){}
    const item=ticketId?ticket(ticketId):null;
    if(!item||!domain.isManaged(item)||item._weighingRoute!=='balanceiro'||!item._balBagsFinalizado){
      return original.finishRoadExit.apply(this,arguments);
    }
    const manual=domain.number(document.getElementById('rod-saida-manual')?.value);
    const scaleWeight=currentRoadWeight();
    const tare=manual>0?manual:scaleWeight;
    const gross=domain.number(item.pesoEntrada);
    const bagsDiscount=domain.number(document.getElementById('rod-desc-bag')?.value);
    const palletDiscount=domain.number(document.getElementById('rod-desc-palet')?.value);
    const net=Math.max(0,gross-tare-bagsDiscount-palletDiscount);
    if(!(tare>0)){
      showMessage('Informe o peso final do caminhão antes de concluir.','error');
      return;
    }
    confirmAction(
      `Concluir pesagem rodoviária do ticket ${ticketId}?\n\nEntrada: ${gross.toFixed(1)} kg\nPeso final: ${tare.toFixed(1)} kg\nLíquido rodoviário: ${net.toFixed(1)} kg\n\nO ticket seguirá para Compra de Sucata para fechamento do preço.`,
      function(){
        item.pesoTara=tare;
        item.descontoBags=bagsDiscount;
        item.descontoPalets=palletDiscount;
        item.pesoLiquido=net;
        item.dataSaida=typeof _hojeISO==='function'?_hojeISO():new Date().toISOString().slice(0,10);
        item.tsSaida=new Date().toLocaleString('pt-BR');
        item._rodSessao=false;
        item._rodEntrada=false;
        item._balSessao=false;
        item._balFinalizado=true;
        item._weighingStage='aguardando_preco';
        item.status='Aguard. Preço';
        try{
          if(typeof rodCapturarAmbas==='function'){
            const photos=rodCapturarAmbas();
            if(photos?.cam1)item.fotoSaida1=photos.cam1;
            if(photos?.cam2)item.fotoSaida2=photos.cam2;
          }
        }catch(error){}
        domain.syncItemsFromBalance(item);
        domain.registerWeight(item,'rodoviaria_saida',{
          origem:'rodoviaria',
          peso:tare,
          pesoEntrada:gross,
          descontoBags:bagsDiscount,
          descontoPaletes:palletDiscount,
          pesoLiquido:net
        },`saida:bal:${tare}:${net}`);
        domain.registerFlow(item,'aguardando_preco','Retorno ao Balanção concluído; ticket enviado para fechamento da Compra de Sucata');
        try{_rodTicketSaida=null;}catch(error){}
        try{_rodPesoAtual=0;}catch(error){}
        ['rod-saida-manual','rod-peso-manual'].forEach(id=>{
          const element=document.getElementById(id);
          if(element)element.value='';
        });
        const display=document.getElementById('rod-peso-big-saida');
        if(display)display.textContent='0.0 kg';
        persist(ticketId);
        try{renderRodBalanca();}catch(error){}
        try{renderBalanceiro();}catch(error){}
        try{if(typeof renderTickets==='function')renderTickets();}catch(error){}
        showMessage(`✅ Ticket ${ticketId} concluído na Rodoviária e enviado para Compra de Sucata.`,'success',7000);
      },
      'Concluir e enviar para Compra'
    );
  };
}

if(typeof original.updateRoadWeight==='function'){
  global._rodAtualizarPeso=function(){
    const result=original.updateRoadWeight.apply(this,arguments);
    try{view.renderRoadSummary({focus:focusTicket(),activeCount:managedTickets().length,currentWeight:currentRoadWeight()});}catch(error){}
    return result;
  };
}

global.RoadWeighingFlow=Object.freeze({
  renderRoad:renderRoadEnhancements,
  renderBalance:renderBalanceEnhancements,
  managedTickets,
  legacyAwaitingTickets
});

setTimeout(function(){
  try{renderRoadEnhancements();}catch(error){}
  try{renderBalanceEnhancements();}catch(error){}
},100);
})(window);
