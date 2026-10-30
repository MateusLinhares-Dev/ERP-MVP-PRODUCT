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

function progressStep(stage){
  if(stage==='aguardando_rota')return 2;
  if(stage==='rodoviaria_materiais'||stage==='balanceiro')return 3;
  if(stage==='balanceiro_concluido')return 4;
  if(stage==='aguardando_preco')return 5;
  return 1;
}

function progressHtml(stage){
  const current=progressStep(stage);
  const steps=['Entrada','Fluxo','Materiais','Peso final','Compra'];
  return `<div class="road-weighing-stepper">${steps.map((label,index)=>{
    const step=index+1;
    const state=step<current?'done':step===current?'active':'pending';
    return `<div class="road-weighing-step ${state}"><span>${step<current?'✓':step}</span><b>${label}</b></div>`;
  }).join('')}</div>`;
}

function routeActions(ticketId,ticket){
  const stage=global.RoadWeighingDomain.stage(ticket);
  if(stage==='aguardando_rota'){
    return `<div class="road-weighing-primary-actions">
      <button class="road-weighing-choice road" onclick="roadWeighingContinueOnRoad('${escapeHtml(ticketId)}')">
        <span>⚖️</span><b>Continuar aqui na Balança</b><small>Descarregar e pesar os materiais neste mesmo atendimento</small>
      </button>
      <button class="road-weighing-choice balance" onclick="roadWeighingSendToBalance('${escapeHtml(ticketId)}')">
        <span>📦</span><b>Enviar para o Balanceiro</b><small>Pesar bags/itens individualmente e depois voltar para a Rodoviária</small>
      </button>
    </div>`;
  }
  if(stage==='rodoviaria_materiais'){
    return `<div class="road-weighing-next-action">
      <button class="road-weighing-main-button" onclick="roadWeighingFocusMaterials('${escapeHtml(ticketId)}')">📦 Continuar registrando materiais</button>
      <small>Quando terminar todos os materiais, clique em <b>Concluir pesagem e ir para Compra de Sucata</b> no painel ao lado.</small>
    </div>`;
  }
  if(stage==='balanceiro'){
    return `<div class="road-weighing-next-action">
      <button class="road-weighing-main-button purple" onclick="roadWeighingOpenBalance('${escapeHtml(ticketId)}')">⚖️ Abrir Balanceiro</button>
      <small>O ticket continua sendo o mesmo até o fechamento.</small>
    </div>`;
  }
  if(stage==='balanceiro_concluido'){
    return `<div class="road-weighing-final-box">
      <div><b>Último passo: peso final do caminhão</b><small>Informe o peso que a balança está mostrando agora.</small></div>
      <input id="road-weighing-final-weight-${escapeHtml(ticketId)}" type="number" min="0" step="0.1" placeholder="Peso final em kg">
      <button class="road-weighing-main-button green" onclick="roadWeighingCompleteFinalWeight('${escapeHtml(ticketId)}')">✅ Concluir e ir para Compra de Sucata</button>
    </div>`;
  }
  return '';
}


function queueActions(ticketId,ticket){
  const stage=global.RoadWeighingDomain.stage(ticket);
  if(stage==='aguardando_rota'){
    return `<div class="road-weighing-actions">
      <button class="road-weighing-button road-weighing-button-road" onclick="roadWeighingContinueOnRoad('${escapeHtml(ticketId)}')">⚖️ Balança</button>
      <button class="road-weighing-button road-weighing-button-balance" onclick="roadWeighingSendToBalance('${escapeHtml(ticketId)}')">📦 Balanceiro</button>
    </div>`;
  }
  if(stage==='rodoviaria_materiais'){
    return `<div class="road-weighing-actions"><button class="road-weighing-button road-weighing-button-road" onclick="roadWeighingFocusMaterials('${escapeHtml(ticketId)}')">📦 Continuar materiais</button></div>`;
  }
  if(stage==='balanceiro'){
    return `<div class="road-weighing-actions"><button class="road-weighing-button road-weighing-button-balance" onclick="roadWeighingOpenBalance('${escapeHtml(ticketId)}')">⚖️ Abrir Balanceiro</button></div>`;
  }
  if(stage==='balanceiro_concluido'){
    return `<div class="road-weighing-actions"><button class="road-weighing-button road-weighing-button-success" onclick="roadWeighingFocusFinalWeight('${escapeHtml(ticketId)}')">🚛 Informar peso final</button></div>`;
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
    <div class="road-weighing-next"><b>Próximo passo:</b> ${escapeHtml(info.next)}</div>
    ${queueActions(ticketId,ticket)}
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

function createBoard(connectionBar){
  let board=document.getElementById('road-weighing-flow-board');
  if(board)return board;
  board=document.createElement('div');
  board.id='road-weighing-flow-board';
  board.className='road-weighing-flow-board';
  const config=document.getElementById('rod-ip-cfg');
  (config||connectionBar).insertAdjacentElement('afterend',board);
  return board;
}

function renderRoadSummary({focus,activeCount,currentWeight}){
  const root=document.getElementById('rod-subtab-pesagem');
  const connectionBar=document.getElementById('rod-connect-bar');
  if(!root||!connectionBar)return;
  const board=createBoard(connectionBar);
  if(!focus){
    board.innerHTML=`${progressHtml('')}
      <div class="road-weighing-welcome">
        <div><b>1. Comece uma nova pesagem</b><span>Preencha placa, motorista e fornecedor. Informe o peso do caminhão e clique em <strong>Registrar entrada</strong>.</span></div>
        <div class="road-weighing-live-weight"><small>Peso atual</small><b>${formatKg(currentWeight)}</b></div>
      </div>`;
    updateLegacyControls(null);
    return;
  }
  const [ticketId,ticket]=focus;
  const domain=global.RoadWeighingDomain;
  const info=domain.stageInfo(ticket);
  const materials=domain.materials(ticket);
  board.innerHTML=`${progressHtml(domain.stage(ticket))}
    <div class="road-weighing-flow-title"><span>Atendimento ${escapeHtml(ticket.ticket||ticketId)}</span><span class="road-weighing-status-pill" style="--status-color:${info.color};--status-bg:${info.background}">${escapeHtml(info.label)}</span></div>
    <div class="road-weighing-flow-grid">
      <div class="road-weighing-kpi road-weighing-kpi-ticket"><small>Caminhão</small><b>${escapeHtml(ticket.placa||'sem placa')} · ${escapeHtml(ticket.fornecedor||ticket.fornecedorNome||'—')}</b></div>
      <div class="road-weighing-kpi"><small>Peso atual</small><b>${formatKg(currentWeight)}</b></div>
      <div class="road-weighing-kpi"><small>Entrada</small><b>${formatKg(ticket.pesoEntrada)}</b></div>
      <div class="road-weighing-kpi"><small>Saída</small><b>${domain.number(ticket.pesoTara)>0?formatKg(ticket.pesoTara):'—'}</b></div>
      <div class="road-weighing-kpi"><small>Líquido</small><b>${domain.number(ticket.pesoLiquido)>0?formatKg(ticket.pesoLiquido):'—'}</b></div>
    </div>
    <div class="road-weighing-summary-materials"><b>Materiais registrados:</b> ${materials.length?materials.map(item=>`${escapeHtml(item.material)} (${formatKg(item.weight)})`).join(' · '):'nenhum ainda'}</div>
    <div class="road-weighing-summary-next" style="color:${info.color}"><b>O que fazer agora:</b> ${escapeHtml(info.next)}</div>
    ${routeActions(ticketId,ticket)}
    ${activeCount>1?`<div class="road-weighing-muted">Existem ${activeCount} atendimentos abertos.</div>`:''}`;
  updateLegacyControls(ticket);
  updateMaterialsPanel(ticket);
}

function updateLegacyControls(ticket){
  const stage=ticket?global.RoadWeighingDomain.stage(ticket):'';
  const entryButton=document.getElementById('rod-btn-f2');
  const exitButton=document.getElementById('rod-btn-f3');
  if(entryButton)entryButton.style.display=stage?'none':'';
  if(exitButton)exitButton.style.display=stage?'none':'';
}

function updateMaterialsPanel(ticket){
  const panel=document.getElementById('rod-modo-materiais-compra');
  if(!panel)return;
  const stage=global.RoadWeighingDomain.stage(ticket);
  panel.classList.toggle('road-weighing-material-panel-friendly',stage==='rodoviaria_materiais');
  if(stage!=='rodoviaria_materiais')return;

  let helper=document.getElementById('road-weighing-material-helper');
  if(!helper){
    helper=document.createElement('div');
    helper.id='road-weighing-material-helper';
    helper.className='road-weighing-material-helper';
    helper.innerHTML='<b>Como registrar cada material</b><span>1. Descarregue um material.</span><span>2. Informe o peso que ficou na balança.</span><span>3. Informe o nome do material e clique em <strong>Adicionar material</strong>.</span><span>4. Repita até terminar a carga.</span>';
    panel.prepend(helper);
  }

  const materialInput=document.getElementById('rod-matc-nome');
  if(materialInput)materialInput.placeholder='Nome do material (ex.: Cobre Misto)';
  const addButton=materialInput?.nextElementSibling;
  if(addButton&&addButton.tagName==='BUTTON')addButton.textContent='＋ Adicionar material';

  const buttons=Array.from(panel.querySelectorAll('button'));
  const finish=buttons.find(button=>String(button.getAttribute('onclick')||'').includes('rodFinalizarCompraMateriais'));
  if(finish){
    finish.textContent='✅ Concluir pesagem e ir para Compra de Sucata';
    finish.classList.add('road-weighing-finish-purchase');
  }
  const back=buttons.find(button=>String(button.getAttribute('onclick')||'').includes('rodCancelarModoMateriaisCompra'));
  if(back)back.style.display='none';
}

function renderRoadQueue({managed,legacy}){
  const list=document.getElementById('rod-aguard-saida-list');
  if(!list)return;
  const mode=document.getElementById('rod-modo-fila');
  if(mode){
    const title=mode.querySelector(':scope > div:first-child');
    if(title)title.textContent='🚛 ATENDIMENTOS EM ANDAMENTO';
  }
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
    select.style.display=ready.length?'':'none';
  }
}

function renderBalanceState(activeTicket){
  const newSupplier=document.getElementById('bal-novo-forn');
  if(newSupplier&&newSupplier.parentElement)newSupplier.parentElement.style.display='none';
  const broughtBags=document.getElementById('bal-bags-trouxe');
  if(broughtBags&&broughtBags.parentElement)broughtBags.parentElement.style.display='none';
  const panelHeader=document.querySelector('#tab-balanceiro .bal-panel-hdr');
  if(panelHeader)panelHeader.textContent='Tickets recebidos da Balança Rodoviária';

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
      banner.innerHTML=`${progressHtml(global.RoadWeighingDomain.stage(activeTicket))}<div class="road-weighing-balance-instruction"><b>Ticket ${escapeHtml(activeTicket.ticket||'')}</b><span>${escapeHtml(info.next)}</span></div>`;
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
    finishButton.textContent=finished?'✅ Concluído — voltar para a Balança Rodoviária':'✅ Concluir Balanceiro e voltar para a Rodoviária';
  }
}

global.RoadWeighingView=Object.freeze({
  renderRoadSummary,
  renderRoadQueue,
  renderBalanceState
});
})(window);
