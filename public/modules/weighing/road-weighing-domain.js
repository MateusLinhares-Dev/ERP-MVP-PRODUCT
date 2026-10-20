(function(global){
'use strict';

const FINAL_STATUSES=new Set(['Aguard. Preço','Pendente','Pago','Consolidado','Quitado']);
const STAGES={
  aguardando_rota:{label:'Escolher fluxo',color:'#ef6c00',background:'#fff3e0',next:'Escolha onde esta carga será pesada.'},
  rodoviaria_materiais:{label:'Pesando materiais',color:'#1565c0',background:'#e3f2fd',next:'Descarregue um material por vez, registre o peso e depois conclua a pesagem.'},
  balanceiro:{label:'No Balanceiro',color:'#6a1b9a',background:'#f3e5f5',next:'Registre os bags/itens no Balanceiro e conclua essa etapa.'},
  balanceiro_concluido:{label:'Retorno à Rodoviária',color:'#2e7d32',background:'#e8f5e9',next:'Informe o peso final do caminhão para concluir o atendimento.'},
  aguardando_preco:{label:'Pronto para Compra',color:'#00838f',background:'#e0f7fa',next:'Pesagem concluída. Informe os preços na Compra de Sucata.'}
};

function number(value){
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:0;
}

function text(value){
  return String(value==null?'':value).trim();
}

function now(){
  return new Date().toISOString();
}

function id(prefix){
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
}

function isManaged(ticket){
  return Boolean(ticket&&Number(ticket._weighingFlowVersion||0)>=1);
}

function isPurchase(ticket){
  return Boolean(ticket&&String(ticket.tipo||'compra')!=='venda');
}

function isFinal(ticket){
  if(!ticket)return true;
  return FINAL_STATUSES.has(String(ticket.status||''));
}

function stage(ticket){
  const explicit=text(ticket?._weighingStage);
  if(explicit)return explicit;
  if(!ticket)return '';
  if(ticket._balBagsFinalizado&&!(number(ticket.pesoTara)>0))return 'balanceiro_concluido';
  if(ticket._balSessao&&!ticket._balBagsFinalizado)return 'balanceiro';
  if(Array.isArray(ticket.pesagensCompra)&&ticket.pesagensCompra.length&&!ticket._balFinalizado)return 'rodoviaria_materiais';
  if(ticket._rodEntrada&&!(number(ticket.pesoTara)>0))return 'aguardando_rota';
  return isFinal(ticket)?'aguardando_preco':'';
}

function stageInfo(ticket){
  return STAGES[stage(ticket)]||{
    label:text(ticket?.status)||'Em atendimento',
    color:'#546e7a',
    background:'#eceff1',
    next:'Continue o atendimento.'
  };
}

function registerFlow(ticket,nextStage,description,extra){
  if(!ticket)return;
  if(!Array.isArray(ticket.historicoFluxoPesagem))ticket.historicoFluxoPesagem=[];
  const last=ticket.historicoFluxoPesagem[ticket.historicoFluxoPesagem.length-1];
  if(last&&last.etapa===nextStage&&last.descricao===description)return;
  ticket.historicoFluxoPesagem.push(Object.assign({
    id:id('FLX'),
    etapa:nextStage,
    descricao:description,
    dataHora:now()
  },extra||{}));
}

function registerWeight(ticket,type,data,dedupeKey){
  if(!ticket)return;
  if(!Array.isArray(ticket.pesagensOperacionais))ticket.pesagensOperacionais=[];
  if(dedupeKey&&ticket.pesagensOperacionais.some(item=>item&&item.dedupeKey===dedupeKey))return;
  ticket.pesagensOperacionais.push(Object.assign({
    id:id('PSG'),
    tipo:type,
    dataHora:now(),
    dedupeKey:dedupeKey||''
  },data||{}));
}

function materials(ticket){
  const grouped=new Map();
  const add=(name,weight)=>{
    const normalized=text(name);
    if(!normalized)return;
    grouped.set(normalized,(grouped.get(normalized)||0)+number(weight));
  };
  (ticket?.pesagensCompra||[]).forEach(item=>add(item.material,item.pesoLiquido));
  (ticket?.bags||[]).forEach(item=>add(item.mat||item.material,item.lq||item.pesoLiquido||item.br));
  if(!grouped.size)(ticket?.itens||[]).forEach(item=>add(item.mat||item.material,item.pesoLiq||item.lq||item.peso||item.qt));
  return [...grouped.entries()].map(([material,weight])=>({material,weight}));
}

function materialSummary(ticket){
  return materials(ticket).map(item=>item.material).filter(Boolean).join(', ');
}

function syncItemsFromBalance(ticket){
  if(!ticket)return;
  const grouped=new Map();
  (ticket.bags||[]).forEach(item=>{
    const material=text(item.mat||item.material);
    if(!material)return;
    const current=grouped.get(material)||{material,pesoBruto:0,pesoLiquido:0};
    current.pesoBruto+=number(item.br||item.pesoBruto);
    current.pesoLiquido+=number(item.lq||item.pesoLiquido||item.br);
    grouped.set(material,current);
  });
  if(!grouped.size)return;
  const previous=new Map((ticket.itens||[]).map(item=>[text(item.mat||item.material),item]));
  ticket.itens=[...grouped.values()].map(group=>{
    const old=previous.get(group.material)||{};
    const price=number(old.preco);
    return Object.assign({},old,{
      mat:group.material,
      material:group.material,
      br:group.pesoBruto,
      lq:group.pesoLiquido,
      pesoBruto:group.pesoBruto,
      pesoLiq:group.pesoLiquido,
      pesoLiquido:group.pesoLiquido,
      preco:price,
      total:price*group.pesoLiquido,
      origemPesagem:'balanceiro'
    });
  });
  ticket.totalKg=ticket.itens.reduce((sum,item)=>sum+number(item.pesoLiq||item.lq),0);
  ticket.material=materialSummary(ticket);
}

function syncItemsFromRoad(ticket){
  if(!ticket||!Array.isArray(ticket.pesagensCompra)||!ticket.pesagensCompra.length)return;
  const grouped=new Map();
  ticket.pesagensCompra.forEach(item=>{
    const material=text(item.material);
    if(!material)return;
    const current=grouped.get(material)||{material,weight:0};
    current.weight+=number(item.pesoLiquido);
    grouped.set(material,current);
  });
  const previous=new Map((ticket.itens||[]).map(item=>[text(item.mat||item.material),item]));
  ticket.itens=[...grouped.values()].map(group=>{
    const old=previous.get(group.material)||{};
    const price=number(old.preco);
    return Object.assign({},old,{
      mat:group.material,
      material:group.material,
      br:group.weight,
      lq:group.weight,
      pesoBruto:group.weight,
      pesoLiq:group.weight,
      pesoLiquido:group.weight,
      preco:price,
      total:price*group.weight,
      origemPesagem:'rodoviaria'
    });
  });
  ticket.totalKg=ticket.itens.reduce((sum,item)=>sum+number(item.pesoLiq||item.lq),0);
  ticket.material=materialSummary(ticket);
}

function markReadyForPurchase(ticket,origin){
  if(!ticket)return;
  ticket._rodSessao=false;
  ticket._rodEntrada=false;
  ticket._balSessao=false;
  ticket._balFinalizado=true;
  ticket._weighingStage='aguardando_preco';
  ticket.status='Aguard. Preço';
  ticket.origemFechamentoPesagem=origin||ticket.origemFechamentoPesagem||'';
  ticket.material=materialSummary(ticket)||text(ticket.material);
}

function isReadyForPurchase(ticket){
  return Boolean(ticket&&ticket._balFinalizado&&ticket.status==='Aguard. Preço'&&!ticket._balSessao&&!ticket._rodEntrada);
}

global.RoadWeighingDomain=Object.freeze({
  number,
  text,
  now,
  isManaged,
  isPurchase,
  isFinal,
  stage,
  stageInfo,
  registerFlow,
  registerWeight,
  materials,
  materialSummary,
  syncItemsFromBalance,
  syncItemsFromRoad,
  markReadyForPurchase,
  isReadyForPurchase
});
})(window);
