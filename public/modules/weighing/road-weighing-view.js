(function(global){
'use strict';

function escapeHtml(value){
  if(typeof global.esc==='function')return global.esc(String(value==null?'':value));
  return String(value==null?'':value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function formatKg(value){
  const number=global.RoadWeighingDomain.number(value);
  return `${number.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})} kg`;
}

function routeActions(ticketId,ticket){
  const stage=global.RoadWeighingDomain.stage(ticket);
  if(stage==='aguardando_rota'){
    return `<div class="road-weighing-actions">
      <button class="road-weighing-button road-weighing-button-road" onclick="roadWeighingContinueOnRoad('${escapeHtml(ticketId)}')">⚖️ Somente Balanção</button>
      <button class="road-weighing-button road-weighing-button-balance" onclick="roadWeighingSendToBalance('${escapeHtml(ticketId)}')">📦 Encaminhar ao Balanceiro</button>
    </div>`;
  }
  if(stage==='rodoviaria_materiais'){
    return `<div class="road-weighing-actions"><button class="road-weighing-button road-weighing-button-road" onclick="rodEntrarModoMateriaisCompra('${escapeHtml(ticketId)}')">▶ Continuar materiais</button></div>`;
  }
  if(stage==='balanceiro'){
    return '<div class="road-weighing-actions"><button class="road-weighing-button road-weighing-button-balance" onclick="switchTab(\'balanceiro\')">⚖️ Abrir Balanceiro</button></div>';
  }
  if(stage==='balanceiro_concluido'){
    return `<div class="road-weighing-actions"><button class="road-weighing-button road-weighing-button-success" onclick="rodSelecionarParaSaida('${escapeHtml(ticketId)}')">🚛 Registrar peso final</button></div>`;
  }
  return '';
}

function managedTicketCard(ticketId,ticket){
  const domain=global.RoadWeighingDomain;
  const info=domain.stageInfo(ticket);
  const materialText=domain.materials(ticket)
    .map(item=>`${escapeHtml(item.material)} <b>${formatKg(item.weight)}</b>`)
    .join(' · ')||'Nenhum material registrado ainda';
  return `<div class="road-weighing-ticket" style="--weighing-stage-color:${info.color};--weighing-stage-bg:${info.background}">
    <div class="road-weighing-ticket-header">
      <div><b>${escapeHtml(ticket.ticket||ticketId)}</b> · ${escapeHtml(ticket.fornecedor||ticket.fornecedorNome||'—')}</div>
      <span class="road-weighing-stage">${escapeHtml(info.label)}</span>
    </div>
    <div class="road-weighing-truck">${escapeHtml(ticket.placa||'Sem placa')}${ticket.motorista?` · ${escapeHtml(ticket.motorista)}`:''}</div>
    <div class="road-weighing-weights">
      <span>Entrada <b>${formatKg(ticket.pesoEntrada)}</b></span>
      <span>Saída <b>${domain.number(ticket.pesoTara)>0?formatKg(ticket.pesoTara):'—'}</b></span>
      <span>Líquido <b>${domain.number(ticket.pesoLiquido)>0?formatKg(ticket.pesoLiquido):'—'}</b></span>
    </div>
    <div class="road-weighing-materials">${materialText}</div>
    <div class="road-weighing-next"><b>Próxima ação:</b> ${escapeHtml(info.next)}</div>
    ${routeActions(ticketId,ticket)}
  </div>`;
}

function legacyTicketCard(ticketId,ticket){
  return `<div class="road-weighing-ticket road-weighing-ticket-legacy">
    <div class="road-weighing-ticket-header"><div><b>${escapeHtml(ticket.ticket||ticketId)}</b> · ${escapeHtml(ticket.fornecedor||'—')}</div><span class="road-weighing-stage">Fluxo anterior</span></div>
    <div class="road-weighing-truck">${escapeHtml(ticket.placa||'Sem placa')}</div>
    <div class="road-weighing-weights"><span>Entrada <b>${formatKg(ticket.pesoEntrada)}</b></span></div>
    <div class="road-weighing-actions"><button class="road-weighing-button road-weighing-button-success" onclick="rodSelecionarParaSaida('${escapeHtml(ticketId)}')">🚛 Continuar saída</button></div>
  </div>`;
}

function renderRoadSummary({focus,activeCount,currentWeight}){
  const root=document.getElementById('rod-subtab-pesagem');
  const connectionBar=document.getElementById('rod-connect-bar');
  if(!root||!connectionBar)return;
  let board=document.getElementById('road-weighing-flow-board');
  if(!board){
    board=document.createElement('div');
    board.id='road-weighing-flow-board';
    board.className='road-weighing-flow-board';
    const config=document.getElementById('rod-ip-cfg');
    (config||connectionBar).insertAdjacentElement('afterend',board);
  }
  if(!focus){
    board.innerHTML='<div class="road-weighing-flow-title"><span>🚛 Atendimento de pesagem</span><span class="road-weighing-muted">Nenhum ticket em andamento</span></div>';
    return;
  }
  const [ticketId,ticket]=focus;
  const domain=global.RoadWeighingDomain;
  const info=domain.stageInfo(ticket);
  const materials=domain.materials(ticket);
  board.innerHTML=`<div class="road-weighing-flow-title"><span>🚛 Atendimento atual</span><span style="color:${info.color}">${escapeHtml(info.label)}</span></div>
    <div class="road-weighing-flow-grid">
      <div class="road-weighing-kpi road-weighing-kpi-ticket"><small>Ticket / caminhão</small><b>${escapeHtml(ticket.ticket||ticketId)} · ${escapeHtml(ticket.placa||'sem placa')}</b></div>
      <div class="road-weighing-kpi"><small>Peso atual</small><b>${formatKg(currentWeight)}</b></div>
      <div class="road-weighing-kpi"><small>Entrada</small><b>${formatKg(ticket.pesoEntrada)}</b></div>
      <div class="road-weighing-kpi"><small>Saída</small><b>${domain.number(ticket.pesoTara)>0?formatKg(ticket.pesoTara):'—'}</b></div>
      <div class="road-weighing-kpi"><small>Líquido</small><b>${domain.number(ticket.pesoLiquido)>0?formatKg(ticket.pesoLiquido):'—'}</b></div>
    </div>
    <div class="road-weighing-summary-materials"><b>Materiais:</b> ${materials.length?materials.map(item=>`${escapeHtml(item.material)} (${formatKg(item.weight)})`).join(' · '):'nenhum registrado'}</div>
    <div class="road-weighing-summary-next" style="color:${info.color}"><b>Próxima ação:</b> ${escapeHtml(info.next)}</div>
    ${activeCount>1?`<div class="road-weighing-muted">${activeCount} atendimentos abertos no fluxo.</div>`:''}`;
}

function renderRoadQueue({managed,legacy}){
  const list=document.getElementById('rod-aguard-saida-list');
  if(!list)return;
  const cards=[];
  managed.forEach(([ticketId,ticket])=>cards.push(managedTicketCard(ticketId,ticket)));
  legacy.forEach(([ticketId,ticket])=>cards.push(legacyTicketCard(ticketId,ticket)));
  if(!cards.length){
    list.innerHTML='<p class="road-weighing-empty">Nenhum caminhão aguardando ação.</p>';
    return;
  }
  list.innerHTML=cards.join('');
  const select=document.getElementById('rod-sel-saida');
  if(select){
    const current=select.value;
    const ready=managed.filter(([,ticket])=>global.RoadWeighingDomain.stage(ticket)==='balanceiro_concluido');
    select.innerHTML='<option value="">— Peso final / retorno —</option>'+ready.map(([ticketId,ticket])=>`<option value="${escapeHtml(ticketId)}">${escapeHtml(ticket.ticket||ticketId)} — ${escapeHtml(ticket.fornecedor||'—')}</option>`).join('');
    if(ready.some(([ticketId])=>ticketId===current))select.value=current;
  }
}

function renderBalanceState(activeTicket){
  const newSupplier=document.getElementById('bal-novo-forn');
  if(newSupplier&&newSupplier.parentElement)newSupplier.parentElement.style.display='none';
  const broughtBags=document.getElementById('bal-bags-trouxe');
  if(broughtBags&&broughtBags.parentElement)broughtBags.parentElement.style.display='none';
  const panelHeader=document.querySelector('#tab-balanceiro .bal-panel-hdr');
  if(panelHeader)panelHeader.textContent='📋 Tickets encaminhados pela Rodoviária';

  const progressCard=document.getElementById('bal-progress-card');
  if(progressCard){
    let banner=document.getElementById('road-weighing-balance-stage');
    if(!banner){
      banner=document.createElement('div');
      banner.id='road-weighing-balance-stage';
      banner.className='road-weighing-balance-stage';
      progressCard.insertAdjacentElement('beforebegin',banner);
    }
    if(activeTicket&&global.RoadWeighingDomain.isManaged(activeTicket)){
      const info=global.RoadWeighingDomain.stageInfo(activeTicket);
      banner.style.display='';
      banner.style.background=info.background;
      banner.style.color=info.color;
      banner.style.borderColor=info.color;
      banner.textContent=`Ticket ${activeTicket.ticket||''} · ${info.label} · ${info.next}`;
    }else{
      banner.style.display='none';
    }
  }

  document.querySelectorAll('#bal-ticket-list .bal-ticket-item').forEach(element=>{
    element.querySelectorAll('.road-weighing-ticket-stage-badge').forEach(item=>item.remove());
    const onclick=element.getAttribute('onclick')||'';
    const match=onclick.match(/balSelecionarTicket\('([^']+)'\)/);
    if(!match)return;
    let ticket=null;
    try{ticket=TICKETS_DB[match[1]];}catch(error){}
    if(!ticket||!global.RoadWeighingDomain.isManaged(ticket))return;
    const info=global.RoadWeighingDomain.stageInfo(ticket);
    const badge=document.createElement('div');
    badge.className='road-weighing-ticket-stage-badge';
    badge.style.background=info.color;
    badge.textContent=info.label;
    element.prepend(badge);
  });

  const finished=Boolean(activeTicket&&global.RoadWeighingDomain.isManaged(activeTicket)&&activeTicket._balBagsFinalizado);
  ['bal-material','bal-peso-br','bal-desconto','bal-peso-lq','bal-btn-conf'].forEach(id=>{
    const element=document.getElementById(id);
    if(!element)return;
    element.disabled=finished;
    element.classList.toggle('road-weighing-disabled',finished);
  });
  const finishButton=document.getElementById('bal-btn-finalizar');
  if(finishButton){
    finishButton.disabled=finished;
    finishButton.classList.toggle('road-weighing-disabled',finished);
    finishButton.textContent=finished?'✅ BALANCEIRO CONCLUÍDO — AGUARDANDO RETORNO AO BALANÇÃO':'🏁 FINALIZAR PESAGEM';
  }
}

global.RoadWeighingView=Object.freeze({
  renderRoadSummary,
  renderRoadQueue,
  renderBalanceState
});
})(window);
