(function(global){
'use strict';

const store=global.Phase1Store;
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const money=v=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const kg=v=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:3});
const today=()=>new Date().toISOString().slice(0,10);
const notify=(msg,type='success',time=4500)=>{try{if(typeof showToast==='function')showToast(msg,type,time);else alert(msg);}catch(e){}};
const activeEmployee=f=>{if(!f)return false;const st=norm(f.status||'Ativo');return !['inativo','demitido','desligado','rescindido'].includes(st)&&f.ativo!==false;};
function parseMoney(v){let s=String(v||'').trim().replace(/[^0-9,.-]/g,'');if(!s)return 0;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');return Number(s)||0;}
function addStyleClass(el,cls){if(el)el.classList.add(cls);return el;}
function byText(root,selector,re){return $$(selector,root).find(el=>re.test(String(el.textContent||'')));}
function removeByText(root,selector,re){$$(selector,root).forEach(el=>{const all=(el.textContent||'')+' '+(el.getAttribute('onclick')||'');if(re.test(all))el.remove();});}
function filterRows(body,q){q=norm(q);if(!body)return;Array.from(body.rows||[]).forEach(row=>{row.hidden=!!q&&!norm(row.textContent).includes(q);});}

/* ---------- Compra de sucata: observação também no histórico ---------- */
let purchaseDetailKey='';
const originalPurchaseDetail=global.abrirDetalheCompra;
if(typeof originalPurchaseDetail==='function'){
  global.abrirDetalheCompra=function(dbKey){
    purchaseDetailKey=dbKey;
    const result=originalPurchaseDetail.apply(this,arguments);
    setTimeout(()=>enhancePurchaseHistory(dbKey),0);
    return result;
  };
}
function enhancePurchaseHistory(dbKey){
  const body=$('#dc-itens-body');if(!body)return;
  let resolved=dbKey;
  try{resolved=global.phase3ResolveTicketKey?.(dbKey)||dbKey;}catch(e){}
  purchaseDetailKey=resolved;
  let ticket=null;try{ticket=TICKETS_DB?.[resolved];}catch(e){}
  if(!ticket||!Array.isArray(ticket.itens))return;
  const table=body.closest('table'),head=table?.querySelector('thead tr');
  if(head&&!head.querySelector('[data-phase2-obs]')){
    const th=document.createElement('th');th.dataset.phase2Obs='1';th.className='phase2-purchase-history-obs';th.textContent='Observação';
    const cells=Array.from(head.children);head.insertBefore(th,cells[cells.length-1]||null);
  }
  Array.from(body.rows).forEach((row,i)=>{
    if(i>=ticket.itens.length)return;
    let td=row.querySelector('[data-phase2-obs]');
    if(!td){
      td=document.createElement('td');td.dataset.phase2Obs='1';td.className='phase2-purchase-history-obs';
      row.insertBefore(td,row.cells[row.cells.length-1]||null);
    }
    td.innerHTML=`<input data-purchase-obs-index="${i}" value="${esc(ticket.itens[i]?.obs||'')}" placeholder="Observação deste material" oninput="phase2PurchaseObsSave(${i},this.value)">`;
  });
  const foot=$('#dc-itens-foot');if(foot)$$('td[colspan="4"]',foot).forEach(td=>td.colSpan=5);
}
let purchaseObsSaveTimer=null;
global.phase2PurchaseObsSave=function(index,value){
  let key=purchaseDetailKey;
  try{key=global.phase3ResolveTicketKey?.(key)||key;}catch(e){}
  let t=null;try{t=TICKETS_DB?.[key];}catch(e){}
  if(!t||!Array.isArray(t.itens)||!t.itens[index])return;
  t.itens[index].obs=String(value||'').trim();
  clearTimeout(purchaseObsSaveTimer);
  purchaseObsSaveTimer=setTimeout(()=>{
    try{
      if(typeof saveDB==='function')saveDB();
      if(typeof _rodPersistirTicketCritico==='function')_rodPersistirTicketCritico(key);
    }catch(e){}
  },180);
};

/* ---------- UI transversal ---------- */
function removeNumberSpinners(){
  $$('input[type="number"]').forEach(input=>input.classList.add('phase2-no-spinner'));
}
function fixPartyBanks(){
  $$('#tb-fornecedores-list .phase1-party-bank-btn').forEach(b=>b.remove());
  const supplierTab=$('#tab-fornecedores');
  if(supplierTab)removeByText(supplierTab,'button',/restaurarfornecedores|restaurar/i);
}

/* ---------- Calendário compacto ---------- */
function rebuildCalendarTools(){
  const tab=$('#tab-afazeres');if(!tab)return;
  $('#phase1-calendar-tools')?.remove();
  if($('#phase2-calendar-tools'))return;
  const title=tab.querySelector('.sec-title');if(title)title.textContent='📅 Calendário';
  const tools=document.createElement('div');tools.id='phase2-calendar-tools';tools.className='phase2-calendar-tools';
  tools.innerHTML=`<div class="phase2-cal-toolbar">
    <button onclick="phase2CalendarToday()">Hoje</button>
    <input type="month" id="phase2-cal-month" value="${today().slice(0,7)}" onchange="phase2CalendarMonth(this.value)">
    <input id="phase2-cal-search" placeholder="🔍 Buscar compromisso..." oninput="phase2CalendarFilter(this.value)">
    <button class="ghost" onclick="phase2CalendarToggleHistory()">Histórico</button>
  </div><div id="phase2-calendar-history" class="phase2-calendar-history" hidden></div>`;
  title?.insertAdjacentElement('afterend',tools);
  const originalMonthCard=$('#af-cal')?.closest('.tcard');if(originalMonthCard){originalMonthCard.classList.add('phase2-calendar-main');const legend=Array.from(originalMonthCard.children).find(x=>/Tem serviço a fazer/i.test(x.textContent||''));if(legend)legend.classList.add('phase2-calendar-legend');}
  const dayCard=$('#af-data')?.closest('.tcard');if(dayCard)dayCard.classList.add('phase2-calendar-day-card');
  if(originalMonthCard&&dayCard&&!$('#phase2-calendar-workspace')){const work=document.createElement('div');work.id='phase2-calendar-workspace';work.className='phase2-calendar-workspace';originalMonthCard.parentElement.insertBefore(work,originalMonthCard);work.appendChild(originalMonthCard);work.appendChild(dayCard);}
  const kpis=$('#tab-afazeres .kpi-grid');if(kpis)kpis.classList.add('phase2-calendar-kpis');
  renderCalendarUpcoming();
}
global.phase2CalendarToday=function(){const d=$('#af-data');if(d){d.value=today();try{afDataChange();}catch(e){}}const m=$('#phase2-cal-month');if(m)m.value=today().slice(0,7);};
global.phase2CalendarMonth=function(v){if(!v)return;const d=$('#af-data');if(d){d.value=v+'-01';try{afDataChange();}catch(e){}}};
global.phase2CalendarFilter=function(q){q=norm(q);$$('#af-lista > *').forEach(el=>el.hidden=!!q&&!norm(el.textContent).includes(q));};
global.phase2CalendarToggleHistory=function(){const h=$('#phase2-calendar-history');if(!h)return;h.hidden=!h.hidden;if(!h.hidden)renderCompactCalendarHistory();};
function renderCalendarUpcoming(){const tools=$('#phase2-calendar-tools');if(!tools)return;let host=$('#phase2-calendar-upcoming');if(!host){host=document.createElement('div');host.id='phase2-calendar-upcoming';host.className='phase2-calendar-upcoming';tools.appendChild(host);}let arr=[];try{arr=(AFAZERES_DB||[]).filter(a=>a&&!a.feito&&a.data&&String(a.data)>=today()).slice().sort((a,b)=>String(a.data).localeCompare(String(b.data))).slice(0,5);}catch(e){}host.innerHTML=arr.length?'<b>Próximos</b>'+arr.map(a=>`<button onclick="afSelDia('${esc(a.data)}')"><span>${esc(String(a.data).split('-').reverse().join('/'))}</span>${esc(a.texto||'')}</button>`).join(''):'<span>Sem compromissos pendentes futuros.</span>';}
const originalRenderAfazeresPhase2=global.renderAfazeres;if(typeof originalRenderAfazeresPhase2==='function')global.renderAfazeres=function(){const r=originalRenderAfazeresPhase2.apply(this,arguments);setTimeout(()=>{rebuildCalendarTools();renderCalendarUpcoming();},0);return r;};
function renderCompactCalendarHistory(){
  const h=$('#phase2-calendar-history');if(!h)return;let arr=[];try{arr=(AFAZERES_DB||[]).filter(Boolean).slice();}catch(e){}
  arr.sort((a,b)=>String(b.data||b.criadoEm||'').localeCompare(String(a.data||a.criadoEm||'')));
  h.innerHTML='<div class="phase2-section-head"><b>Histórico recente</b><small>Últimos 30 registros</small></div>'+arr.slice(0,30).map(a=>`<div class="phase2-cal-hrow"><span>${esc(a.data||String(a.criadoEm||'').slice(0,10)||'—')}</span><b>${esc(a.texto||'')}</b><em class="${a.feito?'ok':'pending'}">${a.feito?'Concluído':'Pendente'}</em></div>`).join('');
}

/* ---------- Preços: busca de pessoa e material ---------- */
function ensurePriceSearch(tabId,selectId,renderFn){
  const tab=$('#'+tabId);if(!tab)return;
  if(tab.querySelector('.phase3-price-combo'))return;
  let bar=tab.querySelector('.phase2-price-searches');
  if(!bar){
    bar=document.createElement('div');bar.className='phase2-price-searches';
    bar.innerHTML='<input class="phase2-price-party-search" placeholder="🔍 Procurar cliente/fornecedor..."><input class="phase2-price-material-search" placeholder="🔍 Procurar material...">';
    const select=$('#'+selectId);(select?.closest('div')||tab.querySelector('.sec-title'))?.insertAdjacentElement('afterend',bar);
    const party=bar.querySelector('.phase2-price-party-search'),mat=bar.querySelector('.phase2-price-material-search');
    party.addEventListener('input',()=>filterSelectOptions(select,party.value));
    mat.addEventListener('input',()=>filterPriceMaterialRows(tab,mat.value));
  }
}
function filterSelectOptions(select,q){
  if(!select)return;q=norm(q);Array.from(select.options).forEach(o=>{o.hidden=!!q&&!norm(o.textContent).includes(q);});
}
function filterPriceMaterialRows(tab,q){q=norm(q);$$('tbody tr',tab).forEach(row=>{row.hidden=!!q&&!norm(row.textContent).includes(q);});const addSel=tab.querySelector('select[id*="add-mat"],select[id*="mat"]');if(addSel)filterSelectOptions(addSel,q);}
function priceSearches(){ensurePriceSearch('tab-precos_fornecedores','pf-forn-sel');ensurePriceSearch('tab-precos_clientes','pc-cli-sel');}

/* ---------- Cheques ---------- */
const originalRenderChequeControl=global.renderChequesCompensar;
const originalChqSetBusca=global.chqSetBusca;
const originalChqModal=global._chqModal;
const originalChqSave=global.chqSalvarModal;
function chequeData(){let obj={};try{obj=CHQ_CTRL||{};}catch(e){}return Object.values(obj||{}).filter(Boolean);}
function chequeNumber(c){const n=parseInt(String(c?.n||c?.num||c?.numero||'').replace(/\D/g,''),10);return Number.isFinite(n)?n:null;}
function chequeBank(c){return String(c?.b||c?.banco||c?.bank||'').trim();}
function chequeSequenceByBank(){
  const groups={};chequeData().forEach(c=>{const n=chequeNumber(c),b=chequeBank(c)||'Sem banco';if(n==null)return;(groups[b]||(groups[b]=[])).push(n);});
  return Object.entries(groups).map(([bank,nums])=>{nums=[...new Set(nums)].sort((a,b)=>a-b);const missing=[];if(nums.length>1)for(let n=nums[0];n<nums[nums.length-1];n++)if(!nums.includes(n))missing.push(n);return {bank,nums,min:nums[0],max:nums[nums.length-1],missing};});
}
function renderChequeSequenceStatus(){
  const tab=$('#tab-cheques_compensar');if(!tab)return;
  let box=$('#phase2-cheque-sequence');if(!box){box=document.createElement('div');box.id='phase2-cheque-sequence';box.className='phase2-cheque-sequence';const anchor=tab.querySelector('.kpi-grid');anchor?.insertAdjacentElement('afterend',box);}
  const groups=chequeSequenceByBank();
  if(!groups.length){box.innerHTML='<b>Numeração dos cheques</b><span>Nenhum cheque cadastrado.</span>';return;}
  box.innerHTML=groups.map(g=>`<div><b>${esc(g.bank)}</b><span>${g.min===g.max?g.min:`${g.min} → ${g.max}`}</span>${g.missing.length?`<strong>⚠️ Faltando: ${g.missing.join(', ')}</strong>`:'<em>✓ sequência sem lacunas</em>'}</div>`).join('');
}
function cleanChequeControl(){
  const tab=$('#tab-cheques_compensar');if(!tab)return;
  removeByText(tab,'button',/sincronizar aba antiga/i);
  const root=$('#chq-ctrl-root');
  if(root){
    Array.from(root.children).forEach(el=>{
      const text=String(el.textContent||'');
      const hasTable=!!el.querySelector?.('table');
      const isLegacyHelp=!hasTable&&/Controle de cheques por banco/i.test(text)&&/Desc\. Compra\?/i.test(text);
      if(isLegacyHelp)el.remove();
      else if(!hasTable&&/Ver por banco \(em ordem\)/i.test(text))el.classList.add('phase2-hidden');
    });
  }
  if(root&&!$('#phase2-cheque-head')){
    const head=document.createElement('div');head.id='phase2-cheque-head';head.className='phase2-cheque-head';
    head.innerHTML='<div><b>Controle de cheques</b><small>Cadastre por banco. O sistema avisa duplicidades e números faltantes na sequência.</small></div><span>⚠ Lacunas ficam destacadas abaixo</span>';
    root.prepend(head);
  }
  const search=tab.querySelector('input[placeholder*="Nº ou cliente"],input[placeholder*="cliente"]');
  if(search&&!search.dataset.phase2Bound){
    search.dataset.phase2Bound='1';search.removeAttribute('oninput');
    search.addEventListener('input',function(){try{_chqFbusca=norm(this.value);}catch(e){}phase2FilterChequeRows(this.value);});
  }
  renderChequeSequenceStatus();
}
function phase2FilterChequeRows(q){q=norm(q);$$('#tab-cheques_compensar tbody tr').forEach(row=>row.hidden=!!q&&!norm(row.textContent).includes(q));}
if(typeof originalRenderChequeControl==='function')global.renderChequesCompensar=function(){const result=originalRenderChequeControl.apply(this,arguments);setTimeout(cleanChequeControl,0);return result;};
if(typeof originalChqSetBusca==='function')global.chqSetBusca=function(v){try{_chqFbusca=norm(v);}catch(e){}phase2FilterChequeRows(v);};
if(typeof originalChqModal==='function')global._chqModal=function(){const r=originalChqModal.apply(this,arguments);setTimeout(enhanceChequeModal,0);return r;};
function chequeDateToIso(value){
  const s=String(value||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  const m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m?`${m[3]}-${m[2]}-${m[1]}`:'';
}
function chequeDateToBR(value){
  const s=String(value||'').trim();
  if(/^\d{2}\/\d{2}\/\d{4}$/.test(s))return s;
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${m[3]}/${m[2]}/${m[1]}`:'';
}
function enhanceChequeModal(){
  const num=$('#chqm-n');if(!num)return;
  let hint=$('#phase2-cheque-num-hint');
  if(!hint){
    hint=document.createElement('div');hint.id='phase2-cheque-num-hint';hint.className='phase2-field-hint';
    num.insertAdjacentElement('afterend',hint);
  }
  ['#chqm-d','#chqm-venc','#chqm-cd'].forEach(selector=>{
    const input=$(selector);if(!input)return;
    const iso=chequeDateToIso(input.value);
    input.type='date';input.removeAttribute('placeholder');
    if(iso)input.value=iso;
  });
  const update=()=>{
    const bank=$('#chqm-b')?.value||'',
      n=parseInt(String(num.value||'').replace(/\D/g,''),10),
      editingId=String($('#chqm-id')?.value||''),
      existing=Object.entries((()=>{try{return CHQ_CTRL||{};}catch(e){return {};}})())
        .filter(([id,c])=>id!==editingId&&chequeBank(c)===bank)
        .map(([,c])=>chequeNumber(c)).filter(Number.isFinite),
      max=existing.length?Math.max(...existing):null;
    let msg='',cls='';
    if(Number.isFinite(n)&&existing.includes(n)){msg='⛔ Este número já existe neste banco.';cls='bad';}
    else if(Number.isFinite(n)&&max!=null&&n>max+1){
      const missed=[];for(let x=max+1;x<n;x++)missed.push(x);
      msg='⚠️ Você está pulando: '+missed.join(', ');cls='warn';
    }else if(Number.isFinite(n)&&max!=null&&n===max+1){msg='✓ Próximo número da sequência.';cls='ok';}
    else if(max!=null){msg='Último número cadastrado neste banco: '+max;}
    hint.className='phase2-field-hint '+cls;hint.textContent=msg;
  };
  if(!num.dataset.phase2SeqBound){
    num.dataset.phase2SeqBound='1';num.addEventListener('input',update);
    $('#chqm-b')?.addEventListener('change',update);
  }
  update();
}
if(typeof originalChqSave==='function')global.chqSalvarModal=function(){
  const bank=$('#chqm-b')?.value||'',
    n=parseInt(String($('#chqm-n')?.value||'').replace(/\D/g,''),10),
    editingId=String($('#chqm-id')?.value||'');
  const sameBank=Object.entries((()=>{try{return CHQ_CTRL||{};}catch(e){return {};}})())
    .filter(([id,c])=>id!==editingId&&chequeBank(c)===bank).map(([,c])=>c);
  const existing=sameBank.map(chequeNumber).filter(Number.isFinite);
  if(Number.isFinite(n)&&existing.includes(n)){
    notify('Esse número de cheque já existe neste banco.','error',6500);return;
  }
  const max=existing.length?Math.max(...existing):null;
  if(!editingId&&Number.isFinite(n)&&max!=null&&n>max+1){
    const missing=[];for(let x=max+1;x<n;x++)missing.push(x);
    if(!confirm('Atenção: ficará uma lacuna na sequência. Números faltantes: '+missing.join(', ')+'.\n\nDeseja salvar mesmo assim?'))return;
  }
  ['#chqm-d','#chqm-venc','#chqm-cd'].forEach(selector=>{
    const input=$(selector);if(!input)return;
    const br=chequeDateToBR(input.value);
    input.type='text';input.value=br;
  });
  const r=originalChqSave.apply(this,arguments);
  setTimeout(()=>{renderChequeSequenceStatus();cleanChequeControl();},80);
  return r;
};

/* ---------- Contas a pagar empresarial mais limpa + módulo pessoal da dona ---------- */
let ownerBills={};
function simplifyPayables(){
  const tab=$('#tab-contas_pagar');if(!tab)return;
  $('#phase1-payable-tabs')?.remove();const oldFixed=$('#phase1-fixed-panel');if(oldFixed)oldFixed.remove();
  const current=$('#phase1-payable-current');if(current){while(current.firstChild)tab.appendChild(current.firstChild);current.remove();}
  const todayPanel=$('#cp-hoje-panel');if(todayPanel&&!todayPanel.closest('details.phase2-cp-today')){
    const details=document.createElement('details');details.className='phase2-cp-today';details.innerHTML='<summary>🔔 Vencimentos de hoje <span>clique para ver</span></summary>';todayPanel.parentElement.insertBefore(details,todayPanel);details.appendChild(todayPanel);
  }
  const sideFilters=$('#cp-filtro-sidebar');if(sideFilters){sideFilters.classList.remove('phase2-hidden');sideFilters.classList.add('phase2-cp-sidefilters');}
  const buttons=$$('button',tab);buttons.forEach(b=>{if(/Despesas \(contas fixas\)/i.test(b.textContent||''))b.textContent='Despesas';if(/Ver todos os meses/i.test(b.textContent||''))b.classList.add('phase2-secondary-action');});
  const cal=byText(tab,'.tcard-title,summary',/Calendário de Vencimentos/i)?.closest('.tcard');if(cal)cal.classList.add('phase2-cp-calendar');
  const days=$('#cp-dias-row');if(days)days.classList.add('phase2-cp-days');
  const monthAll=$('#cp-mes-todos-btn');if(monthAll){monthAll.textContent='Todos os meses';monthAll.classList.add('phase2-secondary-action');}
  const filters=[sideFilters,$('#cp-emp-todas')?.parentElement,$('#cp-filtro-resumo'),days].filter(Boolean);
  if(filters.length&&!$('#phase2-cp-advanced')){const det=document.createElement('details');det.id='phase2-cp-advanced';det.className='phase2-cp-advanced';det.innerHTML='<summary>Filtros avançados</summary><div class="phase2-cp-advanced-body"></div>';const tableCard=$('#tb-contas-pagar')?.closest('.tcard');const toolbar=tableCard?.firstElementChild;toolbar?.insertAdjacentElement('afterend',det);const body=det.querySelector('.phase2-cp-advanced-body');filters.forEach(el=>{if(el&&el.parentElement!==body)body.appendChild(el);});}
}
function ownerAllowed(){try{return (typeof _usuarioAtualEhElaine==='function'&&_usuarioAtualEhElaine())||/dona|admin/i.test(String(cu?.role||''));}catch(e){return false;}}
async function ensureOwnerModule(){
  if(!ownerAllowed())return;
  let panel=$('#tab-contas_dona');if(!panel){panel=document.createElement('div');panel.id='tab-contas_dona';panel.className='tab-panel';panel.innerHTML='<div class="sec-title">🏠 Contas Pessoais da Dona</div><div id="phase2-owner-bills"></div>';$('#main-content,.main-content')?.appendChild(panel);if(!panel.parentElement){const any=$('.tab-panel');any?.parentElement?.appendChild(panel);}}
  if(!$('.nav-tab[data-tab="contas_dona"]')){const ref=$('.nav-tab[data-tab="contas_pagar"]');if(ref){const n=document.createElement('div');n.className='nav-tab';n.dataset.tab='contas_dona';n.innerHTML='<span class="nt-icon">🏠</span><span class="nt-label">Contas da Dona</span>';n.onclick=()=>phase2OpenOwnerBills();ref.insertAdjacentElement('afterend',n);}}
  if(store){ownerBills=await store.load('ownerBills',{});if(!Object.keys(ownerBills).length){const legacy=await store.load('fixedPayables',{});if(legacy&&Object.keys(legacy).length){for(const [id,item] of Object.entries(legacy)){ownerBills[id]={...item,migratedFrom:'fixedPayables'};await store.save('ownerBills',id,ownerBills[id]);}}}}
  renderOwnerBills();
}
global.phase2OpenOwnerBills=function(){if(!ownerAllowed())return;$$('.nav-tab').forEach(e=>e.classList.remove('active'));$$('.tab-panel').forEach(e=>e.classList.remove('active'));const nav=$('.nav-tab[data-tab="contas_dona"]'),panel=$('#tab-contas_dona');nav?.classList.add('active');panel?.classList.add('active');renderOwnerBills();};
function renderOwnerBills(){
  const host=$('#phase2-owner-bills');if(!host)return;const items=Object.values(ownerBills||{}).sort((a,b)=>String(a.desc||'').localeCompare(String(b.desc||''),'pt-BR'));
  const active=items.filter(x=>x.active!==false),monthly=active.reduce((s,x)=>s+Number(x.value||0),0);
  host.innerHTML=`<div class="phase2-owner-summary"><div><small>Contas ativas</small><b>${active.length}</b></div><div><small>Previsão mensal</small><b>R$ ${money(monthly)}</b></div></div>
  <div class="phase2-owner-grid"><section><h3>Nova conta pessoal recorrente</h3><div class="phase2-form-grid"><input id="p2ob-desc" placeholder="Descrição"><input id="p2ob-cat" placeholder="Categoria"><input id="p2ob-value" inputmode="decimal" placeholder="Valor R$"><input id="p2ob-day" type="number" min="1" max="31" placeholder="Dia do vencimento"><input id="p2ob-obs" placeholder="Observação"></div><button class="phase2-primary" onclick="phase2OwnerBillSave()">＋ Salvar conta</button></section>
  <section><h3>Contas cadastradas</h3><div class="phase2-owner-list">${items.length?items.map(x=>`<div class="phase2-owner-row ${x.active===false?'inactive':''}"><div><b>${esc(x.desc)}</b><small>${esc(x.category||'Sem categoria')} · vence dia ${Number(x.day||1)}</small></div><strong>R$ ${money(x.value)}</strong><button onclick="phase2OwnerBillToggle('${x.id}')">${x.active===false?'Ativar':'Pausar'}</button><button class="danger" onclick="phase2OwnerBillRemove('${x.id}')">Excluir</button></div>`).join(''):'<div class="phase2-empty">Nenhuma conta pessoal recorrente.</div>'}</div></section></div>`;
}
global.phase2OwnerBillSave=async function(){if(!store)return;const desc=String($('#p2ob-desc')?.value||'').trim(),category=String($('#p2ob-cat')?.value||'').trim(),value=parseMoney($('#p2ob-value')?.value),day=Math.min(31,Math.max(1,Number($('#p2ob-day')?.value)||1)),obs=String($('#p2ob-obs')?.value||'').trim();if(!desc||!(value>0)){notify('Informe descrição e valor.','error');return;}const id=store.id('PESS');const item={id,desc,category,value,day,obs,active:true,createdAt:new Date().toISOString()};ownerBills[id]=item;await store.save('ownerBills',id,item);renderOwnerBills();};
global.phase2OwnerBillToggle=async id=>{if(!ownerBills[id]||!store)return;ownerBills[id].active=ownerBills[id].active===false;await store.save('ownerBills',id,ownerBills[id]);renderOwnerBills();};
global.phase2OwnerBillRemove=async id=>{if(!ownerBills[id]||!store||!confirm('Excluir esta conta pessoal recorrente?'))return;delete ownerBills[id];await store.remove('ownerBills',id);renderOwnerBills();};

/* ---------- Adiantamentos ---------- */
const originalOm=global.om;
if(typeof originalOm==='function')global.om=function(type){const r=originalOm.apply(this,arguments);setTimeout(()=>{if(type==='adiantamento')enhanceAdvanceModal();},0);return r;};
function enhanceAdvanceModal(){
  const ticket=$('#adt-ticket');if(!ticket)return;
  const label=ticket.closest('.fg')?.querySelector('label');if(label)label.textContent='Compra relacionada (opcional)';
  let dl=$('#phase2-adt-ticket-list');if(!dl){dl=document.createElement('datalist');dl.id='phase2-adt-ticket-list';document.body.appendChild(dl);}let tickets=[];try{tickets=Object.entries(TICKETS_DB||{});}catch(e){}
  dl.innerHTML=tickets.map(([id,t])=>`<option value="${esc(t.ticket||id)}">${esc(t.fornecedor||t.forn||'')} · ${esc(t.status||'')}</option>`).join('');ticket.setAttribute('list','phase2-adt-ticket-list');ticket.placeholder='Ex.: T827733 (somente se já pertence a uma compra)';
  if(!$('#phase2-adt-help')){const s=document.createElement('small');s.id='phase2-adt-help';s.className='phase2-help';s.textContent='Se for um crédito geral do fornecedor, deixe em branco. Preencha só quando o adiantamento já estiver ligado a uma compra específica.';ticket.insertAdjacentElement('afterend',s);}
}
const originalRenderAdt=global.renderAdiantamentos;
if(typeof originalRenderAdt==='function')global.renderAdiantamentos=function(){const r=originalRenderAdt.apply(this,arguments);setTimeout(cleanAdvances,0);return r;};
function cleanAdvances(){
  const tab=$('#tab-adiantamentos');if(!tab)return;
  $$('button',tab).forEach(b=>{if(/^Controle$/i.test((b.textContent||'').trim()))b.textContent='Em aberto';if(/^Histórico$/i.test((b.textContent||'').trim())){b.classList.add('phase2-history-tab');b.textContent='📚 Histórico / quitados';}});
  $$('th',tab).forEach(th=>{if(/Vinculado Ticket/i.test(th.textContent||''))th.textContent='Compra relacionada';});
  if(!$('#phase2-adt-intro')){const intro=document.createElement('div');intro.id='phase2-adt-intro';intro.className='phase2-adt-intro';intro.innerHTML='<b>Adiantamentos</b><span>Valor pago antes da compra. <strong>Compra relacionada</strong> é opcional: use somente quando o valor já pertence a um ticket específico.</span><span>Quando for abatido de uma compra, ele passa para <strong>Histórico / quitados</strong>.</span>';const kpi=tab.querySelector('.kpi-grid');kpi?.insertAdjacentElement('afterend',intro);}
  const search=$('#adt-busca-forn');if(search&&!search.dataset.phase2Bound){search.dataset.phase2Bound='1';search.removeAttribute('oninput');search.addEventListener('input',()=>{filterRows($('#tb-adiantamentos-list'),search.value);});}
}

/* ---------- Almoxarifado + EPI unificados ---------- */
function isDiscreteItem(item){const u=norm(item?.un||'un');return !['kg','g','grama','gramas','l','lt','litro','litros','m','metro','metros','m2','m²','m3','m³'].includes(u);}
function isEpiItem(item){const n=norm((item?.nome||'')+' '+(item?.cat||''));return /epi|luva|capacete|botina|bota|oculos|óculos|mascara|máscara|protetor|auricular|abafador|avental|mangote|cinto|colete|respirador|viseira|perneira/.test(n);}
const originalAlxSaveItem=global.alxSalvarItem;
if(typeof originalAlxSaveItem==='function')global.alxSalvarItem=function(){const unit=String($('#alx-edit-un')?.value||'un'),qty=Number($('#alx-edit-qtd')?.value)||0,min=Number($('#alx-edit-min')?.value)||0,item={un:unit};if(isDiscreteItem(item)&&(!Number.isInteger(qty)||!Number.isInteger(min))){notify('Itens controlados por unidade não aceitam 0,01. Use quantidade inteira: 1, 2, 3...','error',7000);return;}return originalAlxSaveItem.apply(this,arguments);};
const originalAlxSaveMov=global.alxSalvarMov;
if(typeof originalAlxSaveMov==='function')global.alxSalvarMov=function(){const idx=Number($('#alx-mov-item')?.value),item=(()=>{try{return ALX_ITENS?.[idx];}catch(e){return null;}})(),qty=Number($('#alx-mov-qtd')?.value)||0,type=$('#alx-mov-tipo')?.value||'',mat=$('#alx-mov-resp')?.value||'';if(item&&isDiscreteItem(item)&&!Number.isInteger(qty)){notify('Este item é controlado por unidade. Informe uma quantidade inteira (1, 2, 3...).','error',6500);return;}if(type!=='entrada'&&item&&qty>Number(item.qtd||0)){notify('Estoque insuficiente. Disponível: '+kg(item.qtd)+' '+(item.un||'un')+'.','error');return;}if(type!=='entrada'&&item&&mat&&isEpiItem(item)){notify('Entrega de EPI usa um único fluxo para não duplicar a baixa. Abrindo a entrega integrada.','info',4500);setTimeout(()=>phase2AlxEpiOpen(mat),60);return;}return originalAlxSaveMov.apply(this,arguments);};
function repairDiscreteStocks(){let changed=false;try{(ALX_ITENS||[]).forEach(item=>{if(!item||!isDiscreteItem(item)||item._phase2IntegerRepair)return;const q=Number(item.qtd||0),nearest=Math.round(q);if(!Number.isInteger(q)&&Math.abs(q-nearest)<=0.051){item.qtd=nearest;item._phase2IntegerRepair=true;changed=true;}});if(changed&&typeof saveAlmoxa==='function')saveAlmoxa();}catch(e){}}
function ensureUnifiedEpi(){
  const tab=$('#tab-almoxarifado');if(!tab)return;
  const buttons=$$('button',tab).filter(b=>/Itens|Movimenta|Faltas|Observa|Por Funcionário/.test(b.textContent||''));if(buttons.length&&!$('#alx-stab-btn-epi-integrado')){const b=document.createElement('button');b.id='alx-stab-btn-epi-integrado';b.textContent='🦺 Entrega de EPI';b.className='phase2-alx-epi-tab';b.onclick=()=>phase2AlxEpiOpen();buttons[buttons.length-1].insertAdjacentElement('afterend',b);}
  let panel=$('#phase2-alx-epi-panel');if(!panel){panel=document.createElement('div');panel.id='phase2-alx-epi-panel';panel.style.display='none';tab.appendChild(panel);}
  fixAlxEmployeeSelectors();fixEpiNavigation();
}
function fixEpiNavigation(){const epiNav=$('.nav-tab[data-tab="epi"]'),alxNav=$('.nav-tab[data-tab="almoxarifado"]');if(!epiNav||!alxNav||epiNav.dataset.phase2Unified==='1')return;epiNav.dataset.phase2Unified='1';const label=epiNav.querySelector('.nt-label')||epiNav;label.textContent='EPI / Almox.';epiNav.onclick=function(){try{switchTab('almoxarifado');}catch(e){}setTimeout(()=>phase2AlxEpiOpen(),80);};}
function fixAlxEmployeeSelectors(){let fun=[];try{fun=(FUNCIONARIOS||[]).filter(activeEmployee);}catch(e){}const sig=fun.map(f=>String(f.mat||'')).join('|');['#alx-mov-resp','#alx-func-sel'].forEach(sel=>{const s=$(sel);if(!s)return;const expected=fun.map(f=>String(f.mat||'')).join('|'),actual=Array.from(s.options).filter(o=>o.value).map(o=>o.value).join('|');if(actual===expected&&s.dataset.phase2EmpSig===sig)return;const cur=s.value;s.innerHTML=(sel.includes('func-sel')?'<option value="">— Todos —</option>':'<option value="">— Sem responsável —</option>')+fun.map(f=>`<option value="${esc(f.mat||'')}">${esc(f.nome||'')} ${f.mat?'('+esc(f.mat)+')':''}</option>`).join('');s.dataset.phase2EmpSig=sig;if(cur&&Array.from(s.options).some(o=>o.value===cur))s.value=cur;});}
global.phase2AlxEpiOpen=function(prefMat){
  ensureUnifiedEpi();const tab=$('#tab-almoxarifado');if(!tab)return;
  ['#alx-subtab-itens','#alx-subtab-mov','#alx-subtab-faltas','#alx-subtab-obs','#alx-subtab-func'].forEach(s=>{const el=$(s);if(el)el.style.display='none';});
  const panel=$('#phase2-alx-epi-panel');panel.style.display='block';
  renderUnifiedEpi(prefMat);
};
function epiInventory(){let list=[];try{list=(ALX_ITENS||[]).map((x,i)=>({...x,_idx:i})).filter(x=>isEpiItem(x)&&Number(x.qtd||0)>0);}catch(e){}return list.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));}
function renderUnifiedEpi(prefMat){
  const panel=$('#phase2-alx-epi-panel');if(!panel)return;let fun=[];try{fun=(FUNCIONARIOS||[]).filter(activeEmployee);}catch(e){}const inv=epiInventory();
  panel.innerHTML=`<div class="phase2-epi-flow"><section class="phase2-epi-form"><div class="phase2-section-head"><div><b>Entrega de EPI</b><small>Uma única operação: o EPI sai do estoque e entra no histórico do funcionário. Não existe segunda baixa.</small></div></div><label>Funcionário<select id="p2epi-func">${fun.map(f=>`<option value="${esc(f.mat||'')}">${esc(f.nome||'')} ${f.mat?'— '+esc(f.mat):''}</option>`).join('')}</select></label><label>EPI disponível<select id="p2epi-item" onchange="phase2EpiStockHint()"><option value="">— Selecione —</option>${inv.map(x=>`<option value="${x._idx}">${esc(x.nome)} — estoque ${kg(x.qtd)} ${esc(x.un||'un')}</option>`).join('')}</select></label><div id="p2epi-stock" class="phase2-field-hint"></div><div class="phase2-form-two"><label>Quantidade<input id="p2epi-qtd" type="number" min="1" step="1" value="1"></label><label>Data<input id="p2epi-date" type="date" value="${today()}"></label></div><div class="phase2-form-two"><label>CA<input id="p2epi-ca" placeholder="Nº CA"></label><label>Motivo<select id="p2epi-reason"><option>Primeira entrega</option><option>Troca periódica</option><option>Desgaste / uso</option><option>Quebrou</option><option>Perdeu</option><option>Venceu o CA</option><option>Outros</option></select></label></div><label>Observação<input id="p2epi-obs" placeholder="Opcional"></label><button class="phase2-primary" onclick="phase2EpiDeliver()">✅ Confirmar entrega</button></section><section><div class="phase2-section-head"><div><b>Entregas do funcionário</b><small>Mostra apenas o funcionário selecionado.</small></div></div><div id="p2epi-history"></div></section></div>`;
  const fs=$('#p2epi-func');if(prefMat&&fs&&Array.from(fs.options).some(o=>o.value===prefMat))fs.value=prefMat;fs?.addEventListener('change',renderEmployeeEpiHistory);renderEmployeeEpiHistory();
}
global.phase2EpiStockHint=function(){const idx=Number($('#p2epi-item')?.value),item=(()=>{try{return ALX_ITENS?.[idx];}catch(e){return null;}})(),h=$('#p2epi-stock');if(h)h.textContent=item?'Disponível: '+kg(item.qtd)+' '+(item.un||'un'):'';};
global.phase2EpiEditRecord=function(id){let e=null;try{e=(EPI_DB||[]).find(x=>x&&x.id===id);}catch(_e){}if(!e)return;const body=$('#modal-body');if(!body)return;const iso=String(e.data||'').includes('/')?String(e.data).split('/').reverse().join('-'):String(e.data||today());body.className='modal';body.innerHTML=`<h3>✏️ Editar entrega de EPI</h3><div class="fg"><label>EPI</label><input id="p2ee-name" value="${esc(e.epi||'')}" readonly></div><div class="phase2-form-two"><div class="fg"><label>Data</label><input id="p2ee-date" type="date" value="${esc(iso)}"></div><div class="fg"><label>Quantidade</label><input id="p2ee-qty" type="number" min="1" step="1" value="${Number(e.qtd||1)}"></div></div><div class="fg"><label>CA</label><input id="p2ee-ca" value="${esc(e.ca||'')}"></div><div class="fg"><label>Motivo / observação</label><input id="p2ee-reason" value="${esc(e.motivo||'')}"></div><div class="modal-ft"><button class="btn-cancel" onclick="cm()">Cancelar</button><button class="btn-save" onclick="phase2EpiSaveRecord('${esc(id)}')">Salvar</button></div>`;$('#modal-ov')?.classList.add('open');};
global.phase2EpiSaveRecord=function(id){let e=null,m=null,item=null;try{e=(EPI_DB||[]).find(x=>x&&x.id===id);m=(ALX_MOV||[]).find(x=>x&&(x.epiId===id||x.id===e?._almoxMovId));item=m?(ALX_ITENS||[]).find(x=>x&&(x.id&&m.itemId?x.id===m.itemId:String(x.nome||'')===String(m.item||''))):null;}catch(_e){}if(!e)return;const qty=Number($('#p2ee-qty')?.value)||0;if(!(qty>0)||!Number.isInteger(qty)){notify('Quantidade de EPI deve ser inteira.','error');return;}if(m&&item){const old=Number(m.qtd||e.qtd||1),delta=qty-old;if(delta>Number(item.qtd||0)){notify('Estoque insuficiente para aumentar esta entrega.','error');return;}item.qtd=Number(item.qtd||0)-delta;m.qtd=qty;m.after=Number(item.qtd||0);m.data=$('#p2ee-date')?.value||m.data;m.obs=$('#p2ee-reason')?.value||m.obs;}e.qtd=qty;e.data=($('#p2ee-date')?.value||today()).split('-').reverse().join('/');e.ca=String($('#p2ee-ca')?.value||'').trim();e.motivo=String($('#p2ee-reason')?.value||'').trim();try{if(typeof saveAlmoxa==='function')saveAlmoxa();if(typeof saveEpi==='function')saveEpi();cm();renderEmployeeEpiHistory();if(typeof alxRenderItens==='function')alxRenderItens();notify('Entrega de EPI atualizada.','success');}catch(_e){}};
const originalAlxTabPhase2=global.alxTab;if(typeof originalAlxTabPhase2==='function')global.alxTab=function(name){const panel=$('#phase2-alx-epi-panel');if(panel)panel.style.display='none';const epiBtn=$('#alx-stab-btn-epi-integrado');if(epiBtn){epiBtn.style.background='#eaf4ed';epiBtn.style.color='#174d34';}return originalAlxTabPhase2.apply(this,arguments);};
function renderEmployeeEpiHistory(){const host=$('#p2epi-history');if(!host)return;const mat=$('#p2epi-func')?.value||'';let list=[];try{list=(EPI_DB||[]).filter(e=>e&&e.mat===mat).slice().reverse();}catch(e){}host.innerHTML=list.length?list.map(e=>`<div class="phase2-epi-history-row"><div><b>${esc(e.epi||'EPI')}</b><small>${esc(e.data||'')} · ${esc(e.motivo||'')}</small></div><span>${e.qtd?esc(e.qtd)+' un':''}</span><button onclick="phase2EpiEditRecord('${esc(e.id)}')">Editar</button></div>`).join(''):'<div class="phase2-empty">Nenhuma entrega registrada para este funcionário.</div>';}
global.phase2EpiDeliver=function(){
  const mat=$('#p2epi-func')?.value||'',idx=Number($('#p2epi-item')?.value),qty=Number($('#p2epi-qtd')?.value)||0,deliveryDate=$('#p2epi-date')?.value||today(),ca=String($('#p2epi-ca')?.value||'').trim(),reason=$('#p2epi-reason')?.value||'Primeira entrega',obs=String($('#p2epi-obs')?.value||'').trim();let item=null,emp=null;try{item=ALX_ITENS?.[idx];emp=(FUNCIONARIOS||[]).find(f=>f.mat===mat);}catch(e){}
  if(!mat||!item){notify('Selecione funcionário e EPI.','error');return;}if(!(qty>0)||!Number.isInteger(qty)){notify('A quantidade de EPI deve ser inteira.','error');return;}const before=Number(item.qtd||0);if(qty>before){notify('Estoque insuficiente. Disponível: '+kg(before)+' '+(item.un||'un')+'.','error');return;}
  const movId='EPI-MOV-'+Date.now(),epiId='epi_'+Date.now();item.qtd=before-qty;
  try{ALX_MOV.unshift({id:movId,item:item.nome,itemId:item.id||'',tipo:'saida',qtd:qty,data,mat,resp:emp?.nome||mat,obs:'Entrega de EPI'+(obs?' — '+obs:''),origem:'EPI',epiId,before,after:item.qtd,ts:new Date().toISOString()});EPI_DB.push({id:epiId,mat:mat,data:deliveryDate.split('-').reverse().join('/'),epi:item.nome,qtd:qty,atividade:'',risco:'',ca:ca,motivo:reason+(obs?' — '+obs:''),_almoxMovId:movId});if(typeof saveAlmoxa==='function')saveAlmoxa();if(typeof saveEpi==='function')saveEpi();if(typeof alxRenderItens==='function')alxRenderItens();if(typeof renderEpi==='function')renderEpi();notify('Entrega registrada e estoque baixado uma única vez.','success');renderUnifiedEpi(mat);}catch(e){console.error(e);notify('Não foi possível registrar a entrega.','error');}
};
const legacyNewEpi=global.novoEpiModal;
if(typeof legacyNewEpi==='function')global.novoEpiModal=function(mat){try{switchTab('almoxarifado');}catch(e){}setTimeout(()=>phase2AlxEpiOpen(mat),60);};
const legacySaveEpi=global.salvarEpiEntrega;
if(typeof legacySaveEpi==='function')global.salvarEpiEntrega=function(){notify('A entrega de EPI agora é feita pelo Almoxarifado para evitar baixa duplicada.','info');try{cm();switchTab('almoxarifado');setTimeout(()=>phase2AlxEpiOpen($('#ei-func')?.value||''),50);}catch(e){}};
const originalAlxRenderFunc=global.alxRenderPorFunc;
if(typeof originalAlxRenderFunc==='function')global.alxRenderPorFunc=function(){const r=originalAlxRenderFunc.apply(this,arguments);setTimeout(addAlxMovementEdit,0);return r;};
function addAlxMovementEdit(){const div=$('#alx-func-tabela');if(!div)return;$$('table',div).forEach(table=>{const head=table.querySelector('thead tr');if(head&&!head.querySelector('[data-p2-action]')){const th=document.createElement('th');th.dataset.p2Action='1';th.textContent='Ações';head.appendChild(th);}Array.from(table.tBodies[0]?.rows||[]).forEach(row=>{if(row.querySelector('[data-p2-action]'))return;const date=String(row.cells[0]?.textContent||'').trim(),item=String(row.cells[1]?.textContent||'').trim(),qty=parseMoney(row.cells[2]?.textContent||'0');let idx=-1;try{idx=(ALX_MOV||[]).findIndex(m=>m.tipo==='saida'&&String((String(m.data||'').includes('-')?String(m.data).split('-').reverse().join('/'):String(m.data||''))).includes(date)&&String(m.item||'')===item&&Number(m.qtd||0)===qty);}catch(e){}const td=document.createElement('td');td.dataset.p2Action='1';td.innerHTML=idx>=0?`<button onclick="phase2AlxEditMovement(${idx})">✏️ Editar</button>`:'—';row.appendChild(td);});});}
global.phase2AlxEditMovement=function(idx){let m=null;try{m=ALX_MOV?.[idx];}catch(e){}if(!m)return;const body=$('#modal-body');if(!body)return;body.className='modal';body.innerHTML=`<h3>✏️ Editar retirada do Almoxarifado</h3><div class="fg"><label>Data</label><input id="p2am-date" type="date" value="${esc(m.data||today())}"></div><div class="fg"><label>Quantidade</label><input id="p2am-qty" type="number" min="1" step="1" value="${Number(m.qtd||1)}"></div><div class="fg"><label>Observação</label><input id="p2am-obs" value="${esc(m.obs||'')}"></div><div class="modal-ft"><button class="btn-cancel" onclick="cm()">Cancelar</button><button class="btn-save" onclick="phase2AlxSaveMovement(${idx})">Salvar</button></div>`;$('#modal-ov')?.classList.add('open');};
global.phase2AlxSaveMovement=function(idx){let m=null,item=null;try{m=ALX_MOV?.[idx];item=(ALX_ITENS||[]).find(x=>x.nome===m.item);}catch(e){}if(!m)return;const newQty=Number($('#p2am-qty')?.value)||0;if(!(newQty>0)||(item&&isDiscreteItem(item)&&!Number.isInteger(newQty))){notify('Quantidade inválida.','error');return;}if(item){const delta=newQty-Number(m.qtd||0);if(delta>Number(item.qtd||0)){notify('Estoque insuficiente para aumentar esta retirada.','error');return;}item.qtd=Number(item.qtd||0)-delta;}m.qtd=newQty;m.data=$('#p2am-date')?.value||m.data;m.obs=String($('#p2am-obs')?.value||'').trim();try{if(m.epiId){const e=(EPI_DB||[]).find(x=>x.id===m.epiId);if(e){e.qtd=newQty;e.data=m.data.split('-').reverse().join('/');e.motivo=m.obs;saveEpi();}}saveAlmoxa();cm();alxRenderPorFunc();alxRenderItens();notify('Retirada atualizada.','success');}catch(e){}};

/* ---------- Frota: manutenção em linha do tempo ---------- */
const originalFrotaFicha=global.frotaFicha;
if(typeof originalFrotaFicha==='function')global.frotaFicha=function(veiId){const r=originalFrotaFicha.apply(this,arguments);setTimeout(()=>redesignFrotaFicha(veiId),0);return r;};
function phase2DateKey(value){const s=String(value||'');if(/^\d{2}\/\d{2}\/\d{4}$/.test(s)){const [d,m,y]=s.split('/');return y+m+d;}return s.replace(/\D/g,'');}
function redesignFrotaFicha(veiId){
  const ov=$('#ff-ov');if(!ov)return;let v=null,list=[];try{v=(FROTA_DB||[]).find(x=>x.id===veiId);list=(MANUTENCAO_DB||[]).filter(m=>m.veiId===veiId).slice().sort((a,b)=>phase2DateKey(b.data).localeCompare(phase2DateKey(a.data)));}catch(e){}if(!v)return;const vIdx=(FROTA_DB||[]).indexOf(v);
  const content=ov.querySelector('.ff-card,.frota-ficha-card,div[style*="max-width"]')||ov.firstElementChild;if(!content)return;const year=String(new Date().getFullYear()),yearSpend=list.filter(m=>String(m.data||'').endsWith(year)).reduce((s,m)=>s+Number(m.custo||0),0),total=list.reduce((s,m)=>s+Number(m.custo||0),0),last=list[0];
  content.classList.add('phase2-frota-card');content.innerHTML=`<div class="phase2-frota-head"><button onclick="_ffFechar()">← Voltar pra Frota</button><div><b>🚚 ${esc(v.id||'')} <span>${esc(v.desc||'')}</span></b><small>${esc(v.placa||'')} · ${esc(v.status||'Ativo')}</small></div><div><button onclick="_ffFechar();editVeiculo(${vIdx})">✏️ Editar</button><button onclick="_ffFechar();frotaDocsModal(${vIdx})">📎 Docs/Fotos</button></div></div><div class="phase2-frota-kpis"><div><small>Gasto total</small><b>R$ ${money(total)}</b></div><div><small>Gasto em ${year}</small><b>R$ ${money(yearSpend)}</b></div><div><small>Manutenções</small><b>${list.length}</b></div><div><small>Última</small><b>${esc(last?.data||'—')}</b></div></div><div class="phase2-frota-toolbar"><h3>Histórico de manutenção</h3><input id="p2-frota-search" placeholder="🔍 Serviço, oficina, tipo..." oninput="phase2FrotaFilter()"><select id="p2-frota-status" onchange="phase2FrotaFilter()"><option value="">Todos os status</option><option>Concluída</option><option>Em Andamento</option><option>Agendada</option></select><button class="phase2-primary" onclick="abrirNovaManutencao('${esc(veiId)}')">＋ Nova manutenção</button></div><div id="p2-frota-timeline">${list.length?list.map((m,i)=>maintenanceCard(m,MANUTENCAO_DB.indexOf(m))).join(''):'<div class="phase2-empty">Nenhuma manutenção registrada.</div>'}</div>`;
}
function maintenanceCard(m,idx){const desc=String(m.desc||'').split('\n').filter(Boolean),status=String(m.status||'');return `<article class="phase2-maint-card" data-search="${esc(norm([m.tipo,m.desc,m.oficina,m.status].join(' ')))}" data-status="${esc(status)}"><div class="date">${esc(m.data||'—')}</div><div class="main"><div><span class="type">${esc(m.tipo||'Manutenção')}</span><span class="status ${status==='Concluída'?'ok':''}">${esc(status||'—')}</span></div><b>${esc(desc[0]||m.obsNota||'Sem descrição')}</b><small>${[m.oficina&&'Oficina: '+m.oficina,m.km&&'Km: '+Number(m.km).toLocaleString('pt-BR'),m.revisao&&'Próxima revisão: '+m.revisao].filter(Boolean).map(esc).join(' · ')}</small>${desc.slice(1,4).map(x=>`<em>• ${esc(x)}</em>`).join('')}</div><strong>R$ ${money(m.custo)}</strong><button onclick="editManutencao(${idx})">✏️</button></article>`;}
global.phase2FrotaFilter=function(){const q=norm($('#p2-frota-search')?.value),st=$('#p2-frota-status')?.value||'';$$('.phase2-maint-card').forEach(c=>c.hidden=(q&&!String(c.dataset.search||'').includes(q))||(st&&c.dataset.status!==st));};

/* ---------- Viagem: organizar em etapas ---------- */
function redesignTrip(){
  const tab=$('#tab-viagem_motorista');if(!tab||tab.dataset.phase2==='1')return;tab.dataset.phase2='1';
  const cards=Array.from(tab.children).filter(x=>x.classList?.contains('tcard'));
  const register=cards.find(c=>/Registrar Viagem/i.test(c.textContent||''));if(register){register.classList.add('phase2-trip-card');const grids=Array.from(register.children).filter(x=>x.tagName==='DIV');const first=register.querySelector('.tcard-hdr')?.nextElementSibling;if(first)first.insertAdjacentHTML('beforebegin','<div class="phase2-step"><b>1</b><span>Dados da viagem</span></div>');const daily=$('#vg-diaria')?.closest('div[style*="grid"]');if(daily)daily.insertAdjacentHTML('beforebegin','<div class="phase2-step"><b>2</b><span>Diária e pernoite</span></div>');const meals=$('#vg-refeicoes-wrap');if(meals&&!meals.closest('details')){const det=document.createElement('details');det.className='phase2-trip-meals';det.innerHTML='<summary><b>3</b><span>Refeições por dia</span><small>Abra somente quando precisar controlar alimentação</small></summary>';meals.parentElement.insertBefore(det,meals);det.appendChild(meals);}const obs=$('#vg-obs');if(obs){const step=document.createElement('div');step.className='phase2-step';step.innerHTML='<b>4</b><span>Prestação de contas</span>';obs.closest('.fg')?.insertAdjacentElement('beforebegin',step);}const grand=$('#vg-grand-total')?.parentElement;if(grand)grand.classList.add('phase2-hidden');}
  const cost=cards.find(c=>/Custo por Motorista/i.test(c.textContent||''));if(cost)cost.classList.add('phase2-trip-secondary');
  const hist=cards.find(c=>/Histórico de Viagens/i.test(c.textContent||''));if(hist)hist.classList.add('phase2-trip-history-card');
  const moneyInput=$('#vg-dinheiro-alim');const lbl=moneyInput?.previousElementSibling;if(lbl)lbl.textContent='💵 Adiantamento entregue ao motorista R$';
  const troco=$('#vg-troco-show');if(troco)troco.firstChild && (troco.firstChild.textContent='Saldo do adiantamento: ');
  refreshTripSummary();
  tab.addEventListener('input',refreshTripSummary,true);tab.addEventListener('change',refreshTripSummary,true);
}
function refreshTripSummary(){const tab=$('#tab-viagem_motorista');if(!tab)return;let box=$('#phase2-trip-summary');if(!box){box=document.createElement('div');box.id='phase2-trip-summary';box.className='phase2-trip-summary';const obs=$('#vg-obs')?.closest('.fg');obs?.insertAdjacentElement('beforebegin',box);}const meals=parseMoney($('#vg-alim-dia-show')?.textContent),advance=Number($('#vg-dinheiro-alim')?.value)||0,extra=Number($('#vg-gastos-extras')?.value)||0,fuel=Number($('#vg-comb')?.value)||0,daily=parseMoney($('#vg-total-show')?.textContent),settlement=advance-(meals+extra);if(box)box.innerHTML=`<div><small>Diárias</small><b>R$ ${money(daily)}</b></div><div><small>Refeições controladas</small><b>R$ ${money(meals)}</b></div><div><small>Combustível registrado</small><b>R$ ${money(fuel)}</b></div><div><small>Outras despesas</small><b>R$ ${money(extra)}</b></div><div class="${settlement<0?'warn':'ok'}"><small>${settlement>=0?'Motorista devolve':'Empresa reembolsa'}</small><b>R$ ${money(Math.abs(settlement))}</b></div>`;}
const originalRenderTripsPhase2=global.renderViagens;if(typeof originalRenderTripsPhase2==='function')global.renderViagens=function(){const r=originalRenderTripsPhase2.apply(this,arguments);setTimeout(()=>{renderTripHistoryCards();renderTripDriverCosts();},0);return r;};
/* Histórico de viagens em formato lista/detalhe; o modal de edição legado permanece independente. */
let phase2TripSelectedRef='';
let phase2TripSearch='';
function phase2TripRef(trip,index){return trip?.id?'id:'+String(trip.id):'index:'+index;}
function phase2TripResolve(ref){
  const records=phase2TripData();
  if(ref.startsWith('id:'))return records.find(x=>String(x?.id||'')===ref.slice(3))||null;
  if(ref.startsWith('index:')){const index=Number(ref.slice(6));return Number.isInteger(index)&&index>=0?records[index]||null:null;}
  return null;
}
// Mantém os selects legados, mas concentra os filtros apenas na listagem.
function phase2TripPrepareHistory(host,tb,card){
  const controls=host.querySelector('.phase2-trip-archive-controls');
  const legacy=card.querySelector('#phase2-trip-legacy-table')||document.createElement('div');
  if(!legacy.id){legacy.id='phase2-trip-legacy-table';legacy.hidden=true;legacy.setAttribute('aria-hidden','true');card.appendChild(legacy);}
  const wrap=tb.closest('div[style*="overflow"]')||tb.closest('table');
  const prior=wrap?.closest('details.phase2-trip-details');
  if(wrap&&!legacy.contains(wrap))legacy.appendChild(wrap);
  if(prior)prior.remove();
  legacy.hidden=true;
  const mot=$('#vg-fil-mot'),mes=$('#vg-fil-mes');
  if(controls){
    if(mot&&!host.querySelector('#phase2-trip-filter-driver')){
      const label=document.createElement('label');label.id='phase2-trip-filter-driver';label.className='phase2-trip-filter-field';
      const title=document.createElement('span');title.textContent='Motorista';label.appendChild(title);label.appendChild(mot);
      controls.insertBefore(label,controls.firstChild);
    }
    if(mes&&!host.querySelector('#phase2-trip-filter-month')){
      const label=document.createElement('label');label.id='phase2-trip-filter-month';label.className='phase2-trip-filter-field';
      const title=document.createElement('span');title.textContent='Mês';label.appendChild(title);label.appendChild(mes);
      const driver=host.querySelector('#phase2-trip-filter-driver');
      if(driver)driver.insertAdjacentElement('afterend',label);else controls.insertBefore(label,controls.firstChild);
    }
  }
  const legacyHeader=card.querySelector('.tcard-hdr');
  if(legacyHeader)legacyHeader.classList.add('phase2-trip-legacy-header');
}
function renderTripHistoryCards(){
  const tb=$('#tb-viagens');if(!tb)return;
  const card=tb.closest('.tcard');if(!card)return;
  let host=$('#phase2-trip-history-cards');
  if(!host){
    host=document.createElement('section');host.id='phase2-trip-history-cards';host.className='phase2-trip-archive';
    host.innerHTML='<div class="phase2-trip-archive-list"><div class="phase2-trip-archive-toolbar"><div><h3>Viagens registradas</h3><small id="phase2-trip-archive-count"></small></div><div class="phase2-trip-archive-controls"><label class="phase2-trip-search-label"><span class="phase2-sr-only">Buscar viagens</span><input type="search" id="phase2-trip-archive-search" placeholder="Buscar motorista ou destino" autocomplete="off"></label><button type="button" class="phase2-trip-archive-new" data-trip-new>Nova viagem</button></div></div><div id="phase2-trip-archive-results" class="phase2-trip-archive-results"></div></div><section id="phase2-trip-record" class="phase2-trip-record" hidden aria-label="Consulta da viagem"></section>';
    const wrap=tb.closest('div[style*="overflow"]')||tb.closest('table');
    wrap?.insertAdjacentElement('beforebegin',host);
    const search=host.querySelector('#phase2-trip-archive-search');
    search?.addEventListener('input',e=>{phase2TripSearch=e.target.value;renderTripHistoryCards();});
  }
  phase2TripPrepareHistory(host,tb,card);
  const mot=$('#vg-fil-mot')?.value||'',mes=$('#vg-fil-mes')?.value||'';
  const records=phase2TripData();
  const query=norm(phase2TripSearch);
  const filtered=records.map((trip,index)=>({trip,index})).filter(({trip})=>trip&&(!mot||trip.motorista===mot)&&(!mes||String(trip.data||'').startsWith(mes))&&(!query||norm([trip.id,trip.motorista,trip.destino,phase2TripDate(trip.data),phase2TripDate(trip.volta)].join(' ')).includes(query)))
    .sort((a,b)=>String(b.trip.data||'').localeCompare(String(a.trip.data||''))||b.index-a.index);
  const signature=JSON.stringify(filtered.map(({trip,index})=>[index,trip.id,trip.motorista,trip.data,trip.volta,trip.destino,trip.numDiarias,trip.totalDiarias,trip.total,trip.totalRefeicoes,trip.combustivel,trip.gastosExtras,trip.dinheiroAlim,trip.acertoDevolucao,trip.obs]));
  const results=host.querySelector('#phase2-trip-archive-results');
  if(results&&results.__phase2TripArchiveSignature!==signature){
    results.__phase2TripArchiveSignature=signature;
    results.innerHTML=filtered.length?'<div class="phase2-trip-list-head" aria-hidden="true"><span>Motorista</span><span>Período</span><span>Destino</span><span>Despesas</span><span>Acerto</span><span>Ações</span></div>'+filtered.map(({trip,index})=>{
      const cost=phase2TripCostParts(trip), advance=phase2TripAdvance(trip),settlement=phase2TripSettlement(trip,cost,advance);
      const deleteButton=trip.id?`<button type="button" class="phase2-trip-delete" data-trip-delete="${esc(trip.id)}" data-trip-index="${index}" aria-label="Excluir viagem de ${esc(trip.motorista||'motorista')}" title="Excluir viagem">Excluir</button>`:'';
      return `<article class="phase2-trip-list-row" data-trip-id="${esc(trip.id||'')}" data-trip-index="${index}">
        <div class="phase2-trip-list-person"><strong>${esc(trip.motorista||'Motorista não informado')}</strong><small>${esc(trip.id||'Registro '+(index+1))}</small></div>
        <div class="phase2-trip-list-dates"><span>${esc(phase2TripDate(trip.data))}</span><small>até ${esc(phase2TripDate(trip.volta))} · ${Number(trip.numDiarias)||1} dia(s)</small></div>
        <div class="phase2-trip-list-destination">${esc(trip.destino||'Não informado')}</div>
        <div class="phase2-trip-list-money"><strong>R$ ${money(cost.total)}</strong></div>
        <div class="phase2-trip-list-settlement ${settlement<0?'is-negative':'is-positive'}"><small>${settlement<0?'Reembolsar': 'Devolver'}</small><strong>R$ ${money(Math.abs(settlement))}</strong></div>
        <div class="phase2-trip-list-action"><button type="button" data-trip-open="${esc(trip.id||'')}" data-trip-index="${index}" aria-label="Ver detalhes da viagem de ${esc(trip.motorista||'motorista')}">Visualizar</button>${deleteButton}</div>
      </article>`;
    }).join(''):'<div class="phase2-trip-empty"><strong>Nenhuma viagem encontrada.</strong><span>Altere os filtros ou registre uma nova viagem.</span></div>';
  }
  const count=host.querySelector('#phase2-trip-archive-count');
  const countText=`${filtered.length} ${filtered.length===1?'viagem encontrada':'viagens encontradas'}`;
  if(count&&count.textContent!==countText)count.textContent=countText;
  phase2TripShowSelected(host);
  phase2TripHistoryActions();
}
function phase2TripAdvance(v){return phase2TripCostValue(v.dinheiroAlim);}
function phase2TripSettlement(v,cost,advance){
  if(v.acertoDevolucao!=null&&v.acertoDevolucao!==''&&Number.isFinite(Number(v.acertoDevolucao)))return Number(v.acertoDevolucao);
  return advance-(cost.alimentacao+cost.extras);
}
// Campos do relatório legado apresentados somente na ficha da viagem selecionada.
function phase2TripFullFinancialDetail(v,parts,advance,settlement){
  const days=Math.max(1,Number(v.numDiarias)||1);
  const limit=phase2TripCostValue($('#vg-limite-alim')?.value);
  const dailyMeal=parts.alimentacao/days;
  const dailyLimitStatus=limit?dailyMeal<=limit?'Dentro do limite':`Excedeu R$ ${money((dailyMeal-limit)*days)}`:'Não configurado';
  // Usar pares descrição/valor em vez de <table>: estilos globais da tabela de viagens
  // alteravam a largura das células e espalhavam os números fora da ficha.
  const field=(label,value)=>`<div class="phase2-trip-financial-row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  const curr=value=>'R$ '+money(value);
  const rate=Number(v.vlrDia)||(Number(v.diaria||0)+Number(v.pernoite||0));
  const rateRows=[
    ['Diária (valor/dia)',curr(v.diaria||0)],['Pernoite (valor/dia)',curr(v.pernoite||0)],
    ['Valor total por dia',curr(rate)],['Total de diárias pagas',curr(parts.diarias)]
  ];
  const mealRows=[
    ['Café da manhã',curr(v.cafeManha||0)],['Almoço',curr(v.almoco||0)],
    ['Café da tarde',curr(v.cafeTarde||0)],['Janta',curr(v.janta||0)],
    ['Total alimentação',curr(parts.alimentacao)],['Alimentação por dia',curr(dailyMeal)],
    ['Status do limite de alimentação',dailyLimitStatus]
  ];
  const reconciliationRows=[
    ['Combustível',curr(parts.combustivel)],['Gastos extras',curr(parts.extras)],
    ['Adiantamento entregue',curr(advance)],
    ['Troco de alimentação registrado',v.trocoAlim==null?'—':curr(v.trocoAlim)],
    ['Acerto financeiro',`${settlement<0?'Reembolsar':'Devolver'} ${curr(Math.abs(settlement))}`]
  ];
  const section=(title,rows)=>`<section class="phase2-trip-financial-group"><h5>${esc(title)}</h5><dl>${rows.map(([name,val])=>field(name,val)).join('')}</dl></section>`;
  const daily=Array.isArray(v.refeicoesPorDia)?v.refeicoesPorDia.filter(Boolean):[];
  const daysHtml=daily.length?`<div class="phase2-trip-financial-daily"><h5>Refeições registradas por dia</h5><div class="phase2-trip-financial-scroll"><table><thead><tr><th>Data</th><th>Café manhã</th><th>Almoço</th><th>Café tarde</th><th>Janta</th><th>Total</th></tr></thead><tbody>${daily.map(r=>{
    const vals=[r.cafeManha,r.almoco,r.cafeTarde,r.janta].map(phase2TripCostValue);
    return `<tr><td>${esc(phase2TripDate(r.data))}</td>${vals.map(n=>`<td>${curr(n)}</td>`).join('')}<td><strong>${curr(vals.reduce((a,b)=>a+b,0))}</strong></td></tr>`;
  }).join('')}</tbody></table></div></div>`:'';
  return `<section class="phase2-trip-record-section phase2-trip-full-financial"><h4>Informações detalhadas da viagem</h4><div class="phase2-trip-financial-grid">${section('Diárias e pernoite registrados',rateRows)}${section('Alimentação',mealRows)}${section('Despesas e acerto',reconciliationRows)}</div>${daysHtml}</section>`;
}
function phase2TripShowSelected(host){
  const list=host.querySelector('.phase2-trip-archive-list');
  const record=host.querySelector('#phase2-trip-record');
  const detail=phase2TripSelectedRef?phase2TripResolve(phase2TripSelectedRef):null;
  if(phase2TripSelectedRef&&!detail)phase2TripSelectedRef='';
  const selected=!!detail;
  if(list)list.hidden=selected;
  if(record)record.hidden=!selected;
  if(!selected||!record)return;
  const totals=phase2TripCostParts(detail);
  const advance=phase2TripAdvance(detail);
  const settlement=phase2TripSettlement(detail,totals,advance);
  const signature=JSON.stringify([phase2TripSelectedRef,detail.motorista,detail.data,detail.volta,detail.destino,detail.numDiarias,detail.diaria,detail.pernoite,detail.vlrDia,detail.cafeManha,detail.almoco,detail.cafeTarde,detail.janta,detail.refeicoesPorDia,totals,advance,settlement,detail.obs,$('#vg-limite-alim')?.value]);
  if(record.__phase2TripDetailSignature===signature)return;
  record.__phase2TripDetailSignature=signature;
  record.tabIndex=-1;
  const costRow=(name,value)=>`<div class="phase2-trip-cost-row"><span>${name}</span><strong>R$ ${money(value)}</strong></div>`;
  record.innerHTML=`<div class="phase2-trip-record-header"><div class="phase2-trip-record-title"><button type="button" class="phase2-trip-back" data-trip-back>← Voltar às viagens</button><small>Detalhes da viagem</small><h3>${esc(detail.motorista||'Motorista não informado')}</h3><p>${esc(phase2TripDate(detail.data))} até ${esc(phase2TripDate(detail.volta))}${detail.destino?' · '+esc(detail.destino):''}</p></div><button type="button" class="phase2-trip-record-edit" data-trip-edit="${esc(detail.id||'')}" data-trip-index="${phase2TripData().indexOf(detail)}">Editar viagem</button></div>
    <div class="phase2-trip-record-summary"><div><small>Despesas registradas</small><strong>R$ ${money(totals.total)}</strong></div><div><small>Adiantamento ao motorista</small><strong>R$ ${money(advance)}</strong></div><div class="${settlement<0?'is-negative':'is-positive'}"><small>${settlement<0?'A reembolsar':'A devolver'}</small><strong>R$ ${money(Math.abs(settlement))}</strong></div></div>
    <div class="phase2-trip-record-columns"><section class="phase2-trip-record-section"><h4>Dados da viagem</h4><dl><div><dt>Motorista</dt><dd>${esc(detail.motorista||'—')}</dd></div><div><dt>Saída</dt><dd>${esc(phase2TripDate(detail.data))}</dd></div><div><dt>Volta</dt><dd>${esc(phase2TripDate(detail.volta))}</dd></div><div><dt>Destino</dt><dd>${esc(detail.destino||'Não informado')}</dd></div><div><dt>Duração</dt><dd>${Number(detail.numDiarias)||1} dia(s)</dd></div></dl></section><section class="phase2-trip-record-section"><h4>Despesas da viagem</h4>${costRow('Alimentação',totals.alimentacao)}${costRow('Combustível',totals.combustivel)}${costRow('Despesas extras',totals.extras)}${totals.diarias?costRow('Diárias registradas',totals.diarias):''}<div class="phase2-trip-cost-total"><span>Total de despesas</span><strong>R$ ${money(totals.total)}</strong></div></section></div>
    <section class="phase2-trip-record-section phase2-trip-settlement"><h4>Acerto do motorista</h4><div class="phase2-trip-cost-row"><span>Adiantamento entregue</span><strong>R$ ${money(advance)}</strong></div><div class="phase2-trip-cost-row"><span>Alimentação e extras considerados no acerto</span><strong>R$ ${money(totals.alimentacao+totals.extras)}</strong></div><div class="phase2-trip-cost-total ${settlement<0?'is-negative':'is-positive'}"><span>${settlement<0?'Empresa reembolsa':'Motorista devolve'}</span><strong>R$ ${money(Math.abs(settlement))}</strong></div></section>
    ${phase2TripFullFinancialDetail(detail,totals,advance,settlement)}
    ${detail.obs?`<section class="phase2-trip-record-section phase2-trip-record-obs"><h4>Observações</h4><p>${esc(detail.obs)}</p></section>`:''}`;
}
function phase2TripShowList(){phase2TripSelectedRef='';renderTripHistoryCards();}
/* ---------- Viagens: acesso ao registro e análise mensal por motorista ---------- */
const phase2TripCostValue=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:0;};
function phase2TripCostParts(v){
  const diarias=phase2TripCostValue(v.totalDiarias!==undefined?v.totalDiarias:(v.total!==undefined?v.total:(Number(v.diaria||0)+Number(v.pernoite||0))*Number(v.numDiarias||1)));
  const alimentacao=phase2TripCostValue(v.totalRefeicoes!==undefined?v.totalRefeicoes:Number(v.cafeManha||0)+Number(v.almoco||0)+Number(v.cafeTarde||0)+Number(v.janta||0));
  const combustivel=phase2TripCostValue(v.combustivel);
  const extras=phase2TripCostValue(v.gastosExtras);
  return {diarias,alimentacao,combustivel,extras,total:diarias+alimentacao+combustivel+extras};
}
function phase2TripMonthlyReport(trips,motorista,ano){
  const monthly=Array.from({length:12},(_,i)=>({mes:String(i+1).padStart(2,'0'),quantidade:0,diarias:0,alimentacao:0,combustivel:0,extras:0,total:0}));
  for(const trip of trips||[]){
    if(!trip||String(trip.motorista||'')!==String(motorista||''))continue;
    const match=/^(\d{4})-(\d{2})-\d{2}$/.exec(String(trip.data||''));
    if(!match||match[1]!==String(ano))continue;
    const index=Number(match[2])-1;if(index<0||index>11)continue;
    const parts=phase2TripCostParts(trip),cell=monthly[index];
    cell.quantidade++;
    for(const k of ['diarias','alimentacao','combustivel','extras','total'])cell[k]+=parts[k];
  }
  return monthly;
}
function phase2TripData(){try{return Array.isArray(VIAGEM_DB)?VIAGEM_DB:[];}catch(e){return [];}}
const phase2TripDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''))?String(d).split('-').reverse().join('/'):'—';
let phase2TripDriver='',phase2TripYear='',phase2TripMonth='';
function phase2SelectDriver(name){phase2TripDriver=String(name||'');phase2TripMonth='';renderTripDriverCosts();}
function phase2SelectTripYear(value){phase2TripYear=String(value||'');phase2TripMonth='';renderTripDriverCosts();}
function phase2SelectTripMonth(value){phase2TripMonth=String(value||'');renderTripDriverCosts();}
function renderTripDriverCosts(){
  const host=$('#phase2-trip-driver-report');if(!host)return;
  const trips=phase2TripData(),drivers=[...new Set(trips.map(t=>String(t?.motorista||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  if(!drivers.length){host.innerHTML='<div class="phase2-empty">Nenhuma viagem registrada.</div>';return;}
  if(!drivers.includes(phase2TripDriver))phase2TripDriver=drivers[0];
  const years=[...new Set(trips.map(t=>/^\d{4}/.test(String(t?.data||''))?String(t.data).slice(0,4):'').filter(Boolean))].sort().reverse();
  if(!years.includes(phase2TripYear))phase2TripYear=years[0]||String(new Date().getFullYear());
  const months=phase2TripMonthlyReport(trips,phase2TripDriver,phase2TripYear);
  if(!/^\d{2}$/.test(phase2TripMonth))phase2TripMonth=months.map(x=>x.quantidade?x.mes:'').filter(Boolean).at(-1)||String(new Date().getMonth()+1).padStart(2,'0');
  const selected=months.find(m=>m.mes===phase2TripMonth)||months[0],names=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const costRows=[['Diárias',selected.diarias],['Alimentação',selected.alimentacao],['Combustível',selected.combustivel],['Despesas extras',selected.extras]];
  host.innerHTML=`<div class="phase2-trip-report-header"><div><h3>Gastos por motorista</h3></div><div class="phase2-trip-report-filters"><label>Ano<select id="phase2-trip-year">${years.map(y=>`<option value="${esc(y)}" ${phase2TripYear===y?'selected':''}>${esc(y)}</option>`).join('')}</select></label><label>Mês<select id="phase2-trip-month">${months.map((m,i)=>`<option value="${m.mes}" ${m.mes===phase2TripMonth?'selected':''}>${names[i]}</option>`).join('')}</select></label></div></div><div class="phase2-trip-driver-tabs" role="tablist" aria-label="Motoristas">${drivers.map((driver,i)=>`<button type="button" role="tab" data-driver-index="${i}" aria-selected="${driver===phase2TripDriver}" class="${driver===phase2TripDriver?'active':''}">${esc(driver)}</button>`).join('')}</div><div class="phase2-trip-driver-kpis"><div><small>Viagens no mês</small><strong>${selected.quantidade}</strong></div><div><small>Gasto total no mês</small><strong>R$ ${money(selected.total)}</strong></div><div><small>Gasto total no ano</small><strong>R$ ${money(months.reduce((s,m)=>s+m.total,0))}</strong></div></div><div class="phase2-trip-cost-breakdown">${costRows.map(([label,value])=>`<div><span>${label}</span><strong>R$ ${money(value)}</strong></div>`).join('')}</div><div class="phase2-trip-report-scroll"><table><thead><tr><th>Mês</th><th>Viagens</th><th>Diárias</th><th>Alimentação</th><th>Combustível</th><th>Extras</th><th>Total</th></tr></thead><tbody>${months.map((m,i)=>`<tr class="${m.mes===phase2TripMonth?'is-current':''}"><td>${names[i]}</td><td>${m.quantidade}</td><td>R$ ${money(m.diarias)}</td><td>R$ ${money(m.alimentacao)}</td><td>R$ ${money(m.combustivel)}</td><td>R$ ${money(m.extras)}</td><td><b>R$ ${money(m.total)}</b></td></tr>`).join('')}</tbody></table></div><p class="phase2-trip-report-note">Gasto = diárias + refeições + combustível + extras. Adiantamentos são valores entregues, não uma nova despesa.</p>`;
  host.querySelector('#phase2-trip-year')?.addEventListener('change',e=>phase2SelectTripYear(e.target.value));
  host.querySelector('#phase2-trip-month')?.addEventListener('change',e=>phase2SelectTripMonth(e.target.value));
  host.querySelectorAll('[data-driver-index]').forEach(btn=>btn.addEventListener('click',()=>phase2SelectDriver(drivers[Number(btn.dataset.driverIndex)])));
}
function phase2TripOpenDetails(id,source){
  const index=Number(source?.dataset?.tripIndex);
  const records=phase2TripData();
  const found=(id?records.find(x=>String(x?.id||'')===String(id)):null)||
    (Number.isInteger(index)&&index>=0?records[index]:null);
  if(!found)return false;
  phase2TripSelectedRef=phase2TripRef(found,records.indexOf(found));
  renderTripHistoryCards();
  $('#phase2-trip-record')?.focus({preventScroll:true});
  return true;
}
function phase2TripCompactRates(register){
  if(!register)return;
  const diaria=$('#vg-diaria'),pernoite=$('#vg-pernoite');
  if(!diaria||!pernoite)return;
  const row=diaria.closest('div[style*="grid"]');
  if(row&&row.contains(pernoite)){
    const previousDetails=row.closest('details.phase2-trip-rates');
    if(previousDetails){previousDetails.parentElement.insertBefore(row,previousDetails);previousDetails.remove();}
    row.classList.add('phase2-trip-hidden-rates');
    row.hidden=true;row.setAttribute('aria-hidden','true');
    [diaria,pernoite].forEach(el=>{if(!el.value)el.value='0';el.tabIndex=-1;});
  }
  Array.from(register.querySelectorAll('.phase2-step'))
    .filter(el=>/Diária e pernoite/i.test(el.textContent||''))
    .forEach(el=>el.remove());
}
function phase2TripHistoryActions(){
  if(global.__phase2TripHistoryClickReady)return;
  global.__phase2TripHistoryClickReady=true;
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('[data-trip-open],[data-trip-edit],[data-trip-delete],[data-trip-back],[data-trip-new]');
    if(!button||!button.closest('#phase2-trip-history-cards'))return;
    event.preventDefault();event.stopPropagation();
    if(button.hasAttribute('data-trip-back'))return phase2TripShowList();
    if(button.hasAttribute('data-trip-new')){
      $('#erp-tab-viagem_motorista-register-button')?.click();return;
    }
    if(button.hasAttribute('data-trip-open'))return phase2TripOpenDetails(button.dataset.tripOpen,button);
    if(button.hasAttribute('data-trip-delete')){
      const id=button.dataset.tripDelete;
      if(!id||typeof global.excluirViagem!=='function')return notify('Não foi possível identificar esta viagem para exclusão.','error');
      // A confirmação e a persistência são responsabilidade da função legada.
      global.excluirViagem(id);
      if(!phase2TripData().some(v=>String(v?.id||'')===id)){
        if(phase2TripSelectedRef==='id:'+id)phase2TripSelectedRef='';
        renderTripHistoryCards();renderTripDriverCosts();
      }
      return;
    }
    if(button.hasAttribute('data-trip-edit')){
      const trips=phase2TripData(),index=Number(button.dataset.tripIndex);
      const trip=(button.dataset.tripEdit&&trips.find(v=>String(v?.id||'')===button.dataset.tripEdit))||
        (Number.isInteger(index)&&index>=0?trips[index]:null);
      if(trip?.id&&typeof global.editViagem==='function')global.editViagem(trip.id);
    }
  },true);
}
const originalSaveTripPhase2=global.salvarViagem;
if(typeof originalSaveTripPhase2==='function')global.salvarViagem=function(){
  const previous=new Set(phase2TripData().map(v=>String(v.id)));
  const result=originalSaveTripPhase2.apply(this,arguments);
  if(phase2TripData().some(v=>!previous.has(String(v.id))))setTimeout(()=>{
    const history=$('#erp-tab-viagem_motorista-history-button');
    phase2TripSelectedRef='';history?.click();renderTripHistoryCards();renderTripDriverCosts();
  },0);
  return result;
};

/* ---------- Fiscal independente completo ---------- */
let fiscalParties={};
async function loadFiscalParties(){if(!store)return;fiscalParties=await store.load('fiscalParties',{});renderFiscalRegistry();}
function fiscalPartyList(type){return Object.values(fiscalParties||{}).filter(x=>x&&x.active!==false&&(!type||norm(x.type).includes(type)));}
function replaceFiscalRegistry(){
  const old=$('#phase1-fiscal-parties');if(!old)return;if(old.dataset.phase2==='1')return;old.dataset.phase2='1';old.open=true;old.innerHTML=`<summary>🧾 Cadastros Fiscais</summary><div class="phase2-fiscal-registry"><div class="phase2-fiscal-toolbar"><select id="p2fis-type" onchange="phase2FiscalFilter()"><option value="">Todos</option><option value="Fornecedor Fiscal">Fornecedor Fiscal</option><option value="Cliente Fiscal">Cliente Fiscal</option></select><input id="p2fis-search" placeholder="🔍 Buscar cadastro fiscal..." oninput="phase2FiscalFilter()"><button class="phase2-primary" onclick="phase2FiscalOpen()">＋ Novo cadastro</button></div><div id="p2fis-list"></div></div>`;loadFiscalParties();
}
function renderFiscalRegistry(){const host=$('#p2fis-list');if(!host)return;const q=norm($('#p2fis-search')?.value),type=$('#p2fis-type')?.value||'';const arr=Object.values(fiscalParties||{}).filter(x=>x&&(!type||x.type===type)&&(!q||norm([x.name,x.legalName,x.tradeName,x.cnpj,x.cpf,x.city,x.uf].join(' ')).includes(q))).sort((a,b)=>String(a.name||a.legalName||'').localeCompare(String(b.name||b.legalName||''),'pt-BR'));host.innerHTML=arr.length?arr.map(x=>`<div class="phase2-fiscal-party ${x.active===false?'inactive':''}"><div><span>${esc(x.type||'')}</span><b>${esc(x.legalName||x.name||'')}</b><small>${esc(x.cnpj||x.cpf||'Sem CPF/CNPJ')} ${x.city?'· '+esc(x.city+'/'+(x.uf||'')):''}</small></div><button onclick="phase2FiscalOpen('${x.id}')">Editar</button><button onclick="phase2FiscalToggle('${x.id}')">${x.active===false?'Ativar':'Inativar'}</button></div>`).join(''):'<div class="phase2-empty">Nenhum cadastro fiscal.</div>';}
global.phase2FiscalFilter=renderFiscalRegistry;
global.phase2FiscalOpen=function(id){const x=id?fiscalParties[id]:null,body=$('#modal-body');if(!body)return;body.className='modal wide';body.innerHTML=`<h3>${x?'✏️ Editar':'＋ Novo'} Cadastro Fiscal</h3><input type="hidden" id="p2fis-id" value="${esc(id||'')}"><div class="phase2-fiscal-form"><section><h4>Identificação</h4><div class="phase2-form-two"><label>Tipo<select id="p2fis-f-type"><option ${x?.type==='Fornecedor Fiscal'?'selected':''}>Fornecedor Fiscal</option><option ${x?.type==='Cliente Fiscal'?'selected':''}>Cliente Fiscal</option></select></label><label>Pessoa<select id="p2fis-person"><option value="PJ" ${x?.personType!=='PF'?'selected':''}>Pessoa Jurídica</option><option value="PF" ${x?.personType==='PF'?'selected':''}>Pessoa Física</option></select></label></div><label>Razão social / Nome<input id="p2fis-legal" value="${esc(x?.legalName||x?.name||'')}"></label><label>Nome fantasia<input id="p2fis-trade" value="${esc(x?.tradeName||'')}"></label><div class="phase2-form-two"><label>CNPJ<input id="p2fis-cnpj" value="${esc(x?.cnpj||'')}" placeholder="00.000.000/0000-00"></label><label>CPF<input id="p2fis-cpf" value="${esc(x?.cpf||'')}" placeholder="000.000.000-00"></label></div><div class="phase2-form-two"><label>Inscrição Estadual<input id="p2fis-ie" value="${esc(x?.ie||'')}"></label><label>Inscrição Municipal<input id="p2fis-im" value="${esc(x?.im||'')}"></label></div><div class="phase2-form-two"><label>Indicador IE<select id="p2fis-ie-ind"><option ${x?.ieIndicator==='Contribuinte ICMS'?'selected':''}>Contribuinte ICMS</option><option ${x?.ieIndicator==='Contribuinte isento'?'selected':''}>Contribuinte isento</option><option ${x?.ieIndicator==='Não contribuinte'?'selected':''}>Não contribuinte</option></select></label><label>SUFRAMA<input id="p2fis-suframa" value="${esc(x?.suframa||'')}"></label></div><label>Regime tributário<select id="p2fis-regime"><option></option>${['MEI','Simples Nacional','Lucro Presumido','Lucro Real','Isento / Não contribuinte'].map(r=>`<option ${x?.taxRegime===r?'selected':''}>${r}</option>`).join('')}</select></label></section><section><h4>Contato e endereço</h4><div class="phase2-form-two"><label>E-mail<input id="p2fis-email" value="${esc(x?.email||'')}"></label><label>Telefone<input id="p2fis-phone" value="${esc(x?.phone||'')}"></label></div><label>E-mail para NF-e / XML<input id="p2fis-nfe-email" value="${esc(x?.nfeEmail||x?.email||'')}"></label><div class="phase2-form-two"><label>CEP<input id="p2fis-cep" value="${esc(x?.cep||'')}"></label><label>UF<input id="p2fis-uf" maxlength="2" value="${esc(x?.uf||'')}"></label></div><div class="phase2-form-two"><label>País<input id="p2fis-country" value="${esc(x?.country||'Brasil')}"></label><label>Código IBGE Município<input id="p2fis-ibge" value="${esc(x?.ibge||'')}"></label></div><label>Logradouro<input id="p2fis-address" value="${esc(x?.address||'')}"></label><div class="phase2-form-two"><label>Número<input id="p2fis-number" value="${esc(x?.number||'')}"></label><label>Complemento<input id="p2fis-complement" value="${esc(x?.complement||'')}"></label></div><div class="phase2-form-two"><label>Bairro<input id="p2fis-district" value="${esc(x?.district||'')}"></label><label>Cidade<input id="p2fis-city" value="${esc(x?.city||'')}"></label></div><label>Observações<input id="p2fis-notes" value="${esc(x?.notes||'')}"></label></section></div><div class="modal-ft"><button class="btn-cancel" onclick="cm()">Cancelar</button><button class="btn-save" onclick="phase2FiscalSave()">💾 Salvar</button></div>`;$('#modal-ov')?.classList.add('open');};
global.phase2FiscalSave=async function(){if(!store)return;const id=$('#p2fis-id')?.value||store.id('FIS'),legal=String($('#p2fis-legal')?.value||'').trim();if(!legal){notify('Informe a razão social ou nome.','error');return;}const item={...(fiscalParties[id]||{}),id,type:$('#p2fis-f-type')?.value||'Fornecedor Fiscal',personType:$('#p2fis-person')?.value||'PJ',name:legal,legalName:legal,tradeName:$('#p2fis-trade')?.value||'',cnpj:$('#p2fis-cnpj')?.value||'',cpf:$('#p2fis-cpf')?.value||'',ie:$('#p2fis-ie')?.value||'',im:$('#p2fis-im')?.value||'',ieIndicator:$('#p2fis-ie-ind')?.value||'',suframa:$('#p2fis-suframa')?.value||'',taxRegime:$('#p2fis-regime')?.value||'',email:$('#p2fis-email')?.value||'',nfeEmail:$('#p2fis-nfe-email')?.value||'',phone:$('#p2fis-phone')?.value||'',cep:$('#p2fis-cep')?.value||'',uf:String($('#p2fis-uf')?.value||'').toUpperCase(),country:$('#p2fis-country')?.value||'Brasil',ibge:$('#p2fis-ibge')?.value||'',address:$('#p2fis-address')?.value||'',number:$('#p2fis-number')?.value||'',complement:$('#p2fis-complement')?.value||'',district:$('#p2fis-district')?.value||'',city:$('#p2fis-city')?.value||'',notes:$('#p2fis-notes')?.value||'',active:fiscalParties[id]?.active!==false,updatedAt:new Date().toISOString()};fiscalParties[id]=item;await store.save('fiscalParties',id,item);cm();renderFiscalRegistry();notify('Cadastro fiscal salvo.','success');};
global.phase2FiscalToggle=async id=>{if(!store||!fiscalParties[id])return;fiscalParties[id].active=fiscalParties[id].active===false;await store.save('fiscalParties',id,fiscalParties[id]);renderFiscalRegistry();};
function fiscalPickerKey(x) { return String(x?.legalName||x?.name||'').trim(); }
function fiscalPickerType(type) { return type==='cliente'?'cliente':'fornecedor'; }
function fiscalPickerNormalize(s) { return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
function bindFiscalModal(prefix,inputId,typeSelectId){
  const input=$('#'+inputId),typeSel=$('#'+typeSelectId);
  if(!input)return;
  if(typeSel)Array.from(typeSel.options).forEach(o=>{
    if(o.value==='fornecedor')o.textContent='Fornecedores Fiscais';
    if(o.value==='cliente')o.textContent='Clientes Fiscais';
  });
  const label=input.closest('.fg')?.querySelector('label');
  if(label)label.textContent=prefix==='ne'?'Fornecedor fiscal':'Cliente / fornecedor fiscal';
  const container=input.closest('.fg');if(!container)return;
  container.classList.add('phase2-fiscal-picker-field');
  input.removeAttribute('list'); // o datalist nativo não abre consistentemente no Chrome
  input.setAttribute('autocomplete','off');
  input.setAttribute('role','combobox');
  input.setAttribute('aria-autocomplete','list');
  let menu=container.querySelector('.phase2-fiscal-picker-menu');
  if(!menu){menu=document.createElement('div');menu.className='phase2-fiscal-picker-menu';menu.hidden=true;menu.setAttribute('role','listbox');input.insertAdjacentElement('afterend',menu);}
  if(input.dataset.fiscalPickerReady==='1')return;
  input.dataset.fiscalPickerReady='1';
  input.dataset.phase2FiscalOnly='1';
  let error='';
  const list=()=>fiscalPartyList(fiscalPickerType(typeSel?.value || (prefix==='ne'?'fornecedor':'cliente')))
    .slice().sort((a,b)=>fiscalPickerKey(a).localeCompare(fiscalPickerKey(b),'pt-BR'));
  const render=(query,open=true)=>{
    const matches=list().filter(x=>!query||fiscalPickerNormalize([x.name,x.legalName,x.tradeName,x.cnpj,x.cpf].join(' ')).includes(fiscalPickerNormalize(query)));
    menu.replaceChildren();
    if(error){const n=document.createElement('p');n.className='phase2-fiscal-picker-note';n.textContent=error;menu.append(n);}
    else if(!matches.length){const n=document.createElement('p');n.className='phase2-fiscal-picker-note';n.textContent=list().length?'Nenhum cadastro correspondente.':'Nenhum cadastro fiscal ativo desse tipo. Cadastre na aba Cadastros fiscais.';menu.append(n);}
    matches.slice(0,30).forEach(x=>{
      const option=document.createElement('button');option.type='button';option.className='phase2-fiscal-picker-option';option.setAttribute('role','option');
      const label=document.createElement('strong');label.textContent=fiscalPickerKey(x);
      const detail=document.createElement('small');detail.textContent=x.cnpj||x.cpf||x.tradeName||x.id||'';
      option.append(label,detail);
      // pointerdown precede o blur do campo; a opção continua selecionável por mouse e teclado.
      option.addEventListener('click',()=>{
        input.value=fiscalPickerKey(x);input.dataset.fiscalPartyId=String(x.id||'');
        menu.hidden=true;input.setAttribute('aria-expanded','false');input.dispatchEvent(new Event('change',{bubbles:true}));
      });
      menu.append(option);
    });
    menu.hidden=!open;input.setAttribute('aria-expanded',String(open));
  };
  input.addEventListener('focus',()=>render('',true));
  input.addEventListener('input',()=>{input.removeAttribute('data-fiscal-party-id');render(input.value,true);});
  input.addEventListener('keydown',e=>{if(e.key==='Escape'){menu.hidden=true;input.setAttribute('aria-expanded','false');}});
  input.addEventListener('blur',()=>setTimeout(()=>{menu.hidden=true;input.setAttribute('aria-expanded','false');},160));
  typeSel?.addEventListener('change',()=>{
    if(input.dataset.fiscalPartyId){input.value='';input.removeAttribute('data-fiscal-party-id');}
    render('',document.activeElement===input);
  });
  typeSel?.removeAttribute('onchange');
  input.placeholder='Pesquisar cadastro fiscal pelo nome ou documento';
  // O cache local pode estar vazio até a primeira resposta do Firebase.
  Promise.resolve(loadFiscalParties()).then(()=>{error='';if(document.activeElement===input)render('',true);})
    .catch(()=>{error='Não foi possível carregar cadastros fiscais. Verifique sua permissão ou conexão.';if(document.activeElement===input)render('',true);});
}
const fiscalNewEntry=global.fiscalNovaEntrada,fiscalNewExit=global.fiscalNovaSaida,fiscalEdit=global.fiscalAbrirEditar;
if(typeof fiscalNewEntry==='function')global.fiscalNovaEntrada=function(){const r=fiscalNewEntry.apply(this,arguments);setTimeout(()=>bindFiscalModal('ne','ne-forn','ne-pessoa-tipo'),0);return r;};
if(typeof fiscalNewExit==='function')global.fiscalNovaSaida=function(){const r=fiscalNewExit.apply(this,arguments);setTimeout(()=>bindFiscalModal('ns','ns-cli','ns-pessoa-tipo'),0);return r;};
if(typeof fiscalEdit==='function')global.fiscalAbrirEditar=function(){const r=fiscalEdit.apply(this,arguments);setTimeout(()=>bindFiscalModal('fe','fe-pessoa','fe-pessoa-tipo'),0);return r;};

const legacyFiscalConfigPessoa=global.fiscalConfigurarPessoa;
global.fiscalConfigurarPessoa=function(id,tipo){const input=$('#'+id);if(input?.dataset?.phase2FiscalOnly==='1'){const prefix=id==='ne-forn'?'ne':id==='ns-cli'?'ns':'fe';bindFiscalModal(prefix,id,prefix+'-pessoa-tipo');return;}if(typeof legacyFiscalConfigPessoa==='function')return legacyFiscalConfigPessoa.apply(this,arguments);};
const legacyFiscalPopularPessoas=global.fiscalPopularPessoas;
global.fiscalPopularPessoas=function(){const result=typeof legacyFiscalPopularPessoas==='function'?legacyFiscalPopularPessoas.apply(this,arguments):undefined;setTimeout(()=>{[['ne','ne-forn','ne-pessoa-tipo'],['ns','ns-cli','ns-pessoa-tipo'],['fe','fe-pessoa','fe-pessoa-tipo']].forEach(args=>{if($('#'+args[1]))bindFiscalModal(...args);});},0);return result;};

/* ---------- Administração ---------- */
function simplifyExpensesGroup(){const tab=$('#tab-despesas_grupo');if(!tab)return;tab.classList.add('phase2-expenses-group');const title=tab.querySelector('.sec-title');if(title)title.textContent='🏢 Despesas do Grupo';const tabs=$$('.desp-tab-btn',tab);tabs.forEach(b=>{const t=String(b.textContent||'');if(/Lançar/.test(t))b.textContent='＋ Nova despesa';if(/Extrato/.test(t))b.textContent='Despesas do mês';if(/Histórico/.test(t))b.textContent='Histórico';if(/Resumo/.test(t))b.textContent='Por fornecedor';});const search=$('#phase1-desp-search');if(search){search.placeholder='🔍 Buscar despesa...';title?.insertAdjacentElement('afterend',search);}if(tab.dataset.phase2Default!=='1'){tab.dataset.phase2Default='1';try{if(typeof switchDespTab==='function')switchDespTab('extrato');}catch(e){}}}
const originalRenderContracts=global.renderContratos;
if(typeof originalRenderContracts==='function')global.renderContratos=function(){const r=originalRenderContracts.apply(this,arguments);setTimeout(addContractRenameButtons,0);return r;};
function phase2ContractAt(index){
  if(typeof CONTRATOS_DB==='undefined'||!Array.isArray(CONTRATOS_DB))return null;
  return Number.isInteger(index)?CONTRATOS_DB[index]||null:null;
}
function phase2ContractName(c){
  const original=String(c?.arquivoNome||'').trim();
  if(original)return original;
  const ext=String(c?.arquivoMime||'').includes('pdf')?'.pdf':String(c?.arquivoMime||'').startsWith('image/jpeg')?'.jpg':String(c?.arquivoMime||'').startsWith('image/png')?'.png':'';
  return 'documento'+ext;
}
function phase2ContractCleanName(input, original){
  let name=String(input||'').trim();
  if(!name||name==='.'||name==='..'||/[\\/:*?"<>|\x00-\x1f]/.test(name)||/[. ]$/.test(name))return null;
  const extMatch=String(original||'').match(/(\.[a-z\d]{1,12})$/i);
  const ext=extMatch?extMatch[1]:'';
  if(ext){
    if(name.toLowerCase().endsWith(ext.toLowerCase()))name=name.slice(0,-ext.length);
    else if(/\.[a-z\d]{1,12}$/i.test(name))return null; // Não disfarçar a extensão real.
  }
  name=name.trim();
  if(!name||name.length>120||name==='.'||name==='..')return null;
  return name+ext;
}
function addContractRenameButtons(){
  const body=$('#tb-contratos');if(!body)return;
  Array.from(body.rows).forEach((row,i)=>{
    const c=phase2ContractAt(i);
    if(!c?.arquivoBase64)return;
    const cell=row.cells[row.cells.length-1];if(!cell)return;
    if(!row.querySelector('.phase2-contract-rename')){
      const b=document.createElement('button');
      b.type='button';b.className='phase2-contract-rename';b.textContent='Nome arquivo';
      b.onclick=()=>global.phase2ContractRename(i,b);
      cell.prepend(b);
    }
    if(!row.querySelector('.phase2-contract-download')){
      const b=document.createElement('button');
      b.type='button';b.className='phase2-contract-download';b.textContent='Baixar';
      b.onclick=()=>global.phase2ContractDownload(i);
      cell.prepend(b);
    }
    const description=row.cells[1];
    if(description){
      let label=description.querySelector('.phase2-contract-filename');
      if(!label){label=document.createElement('small');label.className='phase2-contract-filename';description.appendChild(label);}
      label.textContent=phase2ContractName(c);
      label.title=phase2ContractName(c);
    }
    const rename=row.querySelector('.phase2-contract-rename');
    if(rename)rename.title='Renomear '+phase2ContractName(c);
  });
}
global.phase2ContractRename=async function(i,button){
  const c=phase2ContractAt(i);
  if(!c?.arquivoBase64){notify('Este contrato não possui anexo.','error');return false;}
  const oldName=phase2ContractName(c);
  const dot=oldName.lastIndexOf('.');
  const base=dot>0?oldName.slice(0,dot):oldName;
  const answer=global.prompt('Novo nome do arquivo:',base);
  if(answer==null)return false;
  const newName=phase2ContractCleanName(answer,oldName);
  if(!newName){notify('Nome inválido. Mantenha a extensão original e não utilize caracteres especiais de caminho.','error');return false;}
  if(newName===c.arquivoNome){return true;}
  if(!c.id&&typeof _syncContratos!=='undefined'&&typeof _syncContratos.paraObjeto==='function')_syncContratos.paraObjeto();
  const id=String(c.id||'');
  if(!id||/[.#$\[\]\/]/.test(id)){
    notify('Contrato sem identificador válido. Atualize a tela e tente novamente.','error');return false;
  }
  const db=global._fbDB;
  if(!db||typeof db.ref!=='function'){
    notify('Sem conexão com o Firebase. Não foi possível renomear o arquivo.','error');return false;
  }
  if(button)button.disabled=true;
  try{
    // Não cria registro incompleto se o contrato já tiver sido removido ou ainda não tiver migrado.
    const exists=await db.ref('erp/contratos/'+id+'/id').once('value');
    if(String(exists.val()||'')!==id)throw new Error('Contrato não encontrado na base remota');
    // O anexo é um data URL salvo no RTDB; alterar apenas o nome não reenvia os bytes.
    await db.ref('erp/contratos/'+id).update({arquivoNome:newName});
    c.arquivoNome=newName;
    try{localStorage.setItem('mm_contratos',JSON.stringify(CONTRATOS_DB));}catch(e){console.warn('Cache local de contratos indisponível, nome salvo no Firebase.',e);}
    try{
      if(typeof renderContratos==='function')renderContratos();
      addContractRenameButtons();
    }catch(e){console.warn('Anexo renomeado, mas a tabela não pôde ser atualizada.',e);}
    notify('Nome do anexo atualizado. Use Baixar para obter o arquivo com o novo nome.','success');
    return true;
  }catch(e){
    console.error('Falha ao renomear anexo do contrato.',e);
    notify('Não foi possível salvar o nome no Firebase. Nenhuma alteração foi aplicada.','error');
    return false;
  }finally{if(button)button.disabled=false;}
};
global.phase2ContractDownload=function(i){
  const c=phase2ContractAt(i);
  if(!c?.arquivoBase64){notify('Arquivo não encontrado.','error');return false;}
  try{
    const data=String(c.arquivoBase64);
    if(!data.startsWith('data:')||!data.includes(','))throw new Error('Formato do anexo inválido');
    const encoded=data.slice(data.indexOf(',')+1);
    const decoded=atob(encoded);
    const bytes=new Uint8Array(decoded.length);
    for(let j=0;j<decoded.length;j++)bytes[j]=decoded.charCodeAt(j);
    const mime=String(c.arquivoMime||data.slice(5,data.indexOf(';'))||'application/octet-stream');
    const url=URL.createObjectURL(new Blob([bytes],{type:mime}));
    const a=document.createElement('a');a.href=url;a.download=phase2ContractName(c);
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    return true;
  }catch(e){console.error('Falha ao baixar anexo do contrato.',e);notify('Não foi possível baixar o arquivo anexado.','error');return false;}
};
function mergeCasaGloria(){
  let changed=false;try{Object.keys(CUSTO_CASA||{}).forEach(m=>{(CUSTO_CASA[m]||[]).forEach(x=>{if(norm(x.area)==='casa gloria'){x.area='Casa';changed=true;}});});if(changed&&typeof saveCustoCasa==='function')saveCustoCasa();}catch(e){}
  $('#cc-aba-Casa Glória')?.remove();$$('[data-cc-area]').forEach(b=>{if(norm(b.getAttribute('data-cc-area'))==='casa gloria')b.remove();});const note=$('#phase1-house-history-note');if(note)note.textContent='Histórico preservado por período. Casa e Casa Glória foram consolidadas em Casa; Sítio e Veículos Pessoais permanecem separados.';
}


const originalCcConfigAreas=global._ccConfigAreas;
if(typeof originalCcConfigAreas==='function')global._ccConfigAreas=function(){return (originalCcConfigAreas.apply(this,arguments)||[]).filter(x=>norm(x?.name||x)!=='casa gloria');};

/* ---------- Coordenação ---------- */
const originalCoordFuncRenderPhase2=global.coordFuncRender;if(typeof originalCoordFuncRenderPhase2==='function')global.coordFuncRender=function(){const r=originalCoordFuncRenderPhase2.apply(this,arguments);setTimeout(filterCoordFunctionCards,0);return r;};
function filterCoordFunctionCards(){let inactive=[];try{inactive=(FUNCIONARIOS||[]).filter(f=>!activeEmployee(f));}catch(e){}const names=inactive.map(f=>norm(f.nome)).filter(Boolean);['#coord-func-grafico','#coord-func-cards'].forEach(sel=>{const root=$(sel);if(!root)return;Array.from(root.children).forEach(el=>{const t=norm(el.textContent);if(names.some(n=>t.includes(n)))el.remove();});});}
function restoreCoordTypes(){const select=$('#reu-tipo');if(select&&select.options.length<4)select.innerHTML='<option value="reuniao">Reunião</option><option value="dds">DDS — Diálogo Diário de Segurança</option><option value="treinamento">Treinamento</option><option value="inspecao">Inspeção / Segurança</option><option value="outro">Outro</option>';if(select&&!$('#phase2-coord-type-help')){const help=document.createElement('small');help.id='phase2-coord-type-help';help.className='phase2-help';help.textContent='Escolha o tipo do registro. Os tipos padrão já estão disponíveis aqui; não é necessário cadastrar em outra tela.';select.insertAdjacentElement('afterend',help);}const bag=$('#bags-mov-tipo');if(bag&&bag.options.length<5)bag.innerHTML='<option value="entrada_novo">Compra / Entrada de bag limpa</option><option value="saida_novo">Saída de bag limpa</option><option value="entrada_usado">Bag recebida com carga de fornecedor</option><option value="saida_usado">Envio de bag suja para lavagem</option><option value="lavagem">Retorno da lavagem (suja → limpa)</option>';}
function filterCoordEmployees(){let inactive=[];try{inactive=(FUNCIONARIOS||[]).filter(f=>!activeEmployee(f));}catch(e){}$$('#reu-partic-list label').forEach(l=>{if(inactive.some(f=>l.textContent.includes(f.nome||'')||l.querySelector('input')?.value===f.mat))l.remove();});['#adv-mat'].forEach(s=>{const el=$(s);if(!el)return;Array.from(el.options).forEach(o=>{if(inactive.some(f=>o.value===f.mat||o.textContent.includes(f.nome||'')))o.remove();});});}
const originalReuRender=global.reuRender;if(typeof originalReuRender==='function')global.reuRender=function(){const r=originalReuRender.apply(this,arguments);setTimeout(()=>{filterCoordEmployees();restoreCoordTypes();},0);return r;};
const originalBagsRender=global.bagsRender;if(typeof originalBagsRender==='function')global.bagsRender=function(){const r=originalBagsRender.apply(this,arguments);setTimeout(redesignBags,0);return r;};
function redesignBags(){const sub=$('#coord-subtab-bags');if(!sub)return;restoreCoordTypes();let intro=$('#phase2-bags-intro');if(!intro){intro=document.createElement('div');intro.id='phase2-bags-intro';intro.className='phase2-bags-intro';intro.innerHTML='<b>Como funciona</b><span><strong>Bag recebida com carga:</strong> vem vinculada ao fornecedor/ticket e aumenta o saldo a devolver.</span><span><strong>Lavagem:</strong> transforma bag suja em limpa.</span><span><strong>Retorno ao fornecedor:</strong> só é usado quando há saldo daquele fornecedor originado de compras.</span>';sub.prepend(intro);}const hist=$('#bags-hist');if(hist){hist.innerHTML=hist.innerHTML.replace(/Bags por fornecedor \(a devolver\)/g,'Bags recebidas de fornecedores — pendentes de retorno').replace(/Devolver pra/g,'Fornecedor de origem').replace(/↩ Devolver/g,'↩ Registrar retorno ao fornecedor');}}

/* ---------- Geral: foco de buscas ---------- */
function keepSearchFocus(input,callback){if(!input||input.dataset.phase2Focus==='1')return;input.dataset.phase2Focus='1';input.removeAttribute('oninput');input.addEventListener('input',function(){const pos=this.selectionStart,val=this.value;callback(val);requestAnimationFrame(()=>{this.focus();try{this.setSelectionRange(pos,pos);}catch(e){}});});}
function fixSearchFocus(){
  const coord=$('#reu-busca');keepSearchFocus(coord,v=>{const q=norm(v);$$('#reu-lista>div').forEach(x=>x.hidden=!!q&&!norm(x.textContent).includes(q));});
  const adv=$('#adv-busca');keepSearchFocus(adv,v=>{const q=norm(v);$$('#adv-lista>div').forEach(x=>x.hidden=!!q&&!norm(x.textContent).includes(q));});
}

/* ---------- Navegação compacta dos módulos operacionais ---------- */
function workspaceCreate(tab, entries, activeKey){
  if(tab.querySelector('.erp-workspace-nav'))return null;
  const nav=document.createElement('nav');
  nav.className='erp-workspace-nav';
  nav.setAttribute('aria-label','Seções do módulo');
  const buttons=document.createElement('div');
  buttons.className='erp-workspace-buttons';
  buttons.setAttribute('role','tablist');
  const panels=document.createElement('div');
  panels.className='erp-workspace-panels';
  const views={};
  entries.forEach(({key,label})=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='erp-workspace-tab';
    button.textContent=label;
    button.id='erp-'+tab.id+'-'+key+'-button';
    button.setAttribute('role','tab');
    button.setAttribute('aria-controls','erp-'+tab.id+'-'+key+'-panel');
    const panel=document.createElement('section');
    panel.className='erp-workspace-panel';
    panel.id='erp-'+tab.id+'-'+key+'-panel';
    panel.setAttribute('role','tabpanel');
    panel.setAttribute('aria-labelledby',button.id);
    views[key]={button,panel};
    buttons.appendChild(button);
    panels.appendChild(panel);
    button.addEventListener('click',()=>select(key));
    button.addEventListener('keydown',ev=>{
      if(ev.key!=='ArrowLeft'&&ev.key!=='ArrowRight'&&ev.key!=='Home'&&ev.key!=='End')return;
      ev.preventDefault();
      const keys=entries.map(item=>item.key);
      const index=keys.indexOf(key);
      const next=ev.key==='Home'?keys[0]:ev.key==='End'?keys[keys.length-1]:keys[(index+keys.length+(ev.key==='ArrowLeft'?-1:1))%keys.length];
      select(next);
      views[next].button.focus();
    });
  });
  function select(key){
    Object.entries(views).forEach(([name,{button,panel}])=>{
      const on=name===key;
      button.classList.toggle('is-active',on);
      button.setAttribute('aria-selected',String(on));
      button.tabIndex=on?0:-1;
      panel.hidden=!on;
    });
    tab.dataset.erpWorkspaceView=key;
  }
  nav.appendChild(buttons);
  tab.querySelector('.sec-title')?.insertAdjacentElement('afterend',nav);
  nav.insertAdjacentElement('afterend',panels);
  select(activeKey);
  return {views,select};
}
function workspaceTripExpenses(){
  const register=document.querySelector('#tab-viagem_motorista .phase2-trip-card');
  const obs=document.getElementById('vg-obs');
  if(!register||!obs||register.querySelector('.erp-trip-expenses'))return;
  const details=document.createElement('details');
  details.className='erp-trip-expenses';
  const summary=document.createElement('summary');
  summary.textContent='Despesas e adiantamento';
  details.appendChild(summary);
  const fields=document.createElement('div');
  fields.className='erp-trip-expenses-fields';
  details.appendChild(fields);
  ['vg-comb','vg-dinheiro-alim'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&el.parentElement)fields.appendChild(el.parentElement);
  });
  const change=document.getElementById('vg-troco-show');
  if(change)fields.appendChild(change);
  const extra=register.querySelector('.phase1-trip-extra');
  if(extra)fields.appendChild(extra);
  const oldMeals=register.querySelector('.phase2-trip-meals');
  if(oldMeals)oldMeals.insertAdjacentElement('afterend',details);
  else obs.closest('.fg')?.insertAdjacentElement('beforebegin',details);
}
function workspaceTrip(){
  const tab=document.getElementById('tab-viagem_motorista');
  if(!tab||tab.querySelector('.erp-workspace-nav')||tab.dataset.phase2!=='1')return;
  const cards=Array.from(tab.children).filter(node=>node.classList?.contains('tcard'));
  const register=cards.find(node=>node.classList.contains('phase2-trip-card'));
  const cost=cards.find(node=>node.classList.contains('phase2-trip-secondary'));
  const history=cards.find(node=>node.classList.contains('phase2-trip-history-card'));
  const kpis=tab.querySelector('#viagem-kpis');
  const limit=document.getElementById('vg-limite-alim')?.parentElement;
  if(!register||!cost||!history||!kpis||!limit)return;
  workspaceTripExpenses();
  phase2TripCompactRates(register);
  const workspace=workspaceCreate(tab,[
    {key:'history',label:'Viagens'},
    {key:'register',label:'Nova viagem'},
    {key:'drivers',label:'Por motorista'},
    {key:'cost',label:'Custos e limites'}
  ],'history');
  if(!workspace)return;
  const {views}=workspace;
  views.history.panel.appendChild(history);
  views.register.panel.appendChild(register);
  const driverReport=document.createElement('section');driverReport.id='phase2-trip-driver-report';
  driverReport.className='phase2-trip-driver-report';views.drivers.panel.appendChild(driverReport);
  views.cost.panel.appendChild(kpis);
  views.cost.panel.appendChild(cost);
  views.cost.panel.appendChild(limit);
  tab.classList.add('erp-workspace-ready');
  renderTripDriverCosts();phase2TripHistoryActions();
}
function workspacePoint(){
  const tab=document.getElementById('tab-ponto');
  if(!tab||tab.querySelector('.erp-workspace-nav'))return;
  const cards=Array.from(tab.children).filter(node=>node.classList?.contains('tcard'));
  const manual=cards.find(node=>node.querySelector('#tb-ponto'));
  const imported=cards.find(node=>node.querySelector('#ponto-rhid-input'));
  if(!manual||!imported)return;
  const manualTable=manual.querySelector('table');
  if(manualTable&&!manualTable.closest('.erp-point-table-scroll')){
    const scroll=document.createElement('div');
    scroll.className='erp-point-table-scroll';
    manualTable.parentElement.insertBefore(scroll,manualTable);
    scroll.appendChild(manualTable);
  }
  const workspace=workspaceCreate(tab,[
    {key:'manual',label:'Lançamentos'},
    {key:'imported',label:'Cartões importados'}
  ],'manual');
  if(!workspace)return;
  const {views}=workspace;
  views.manual.panel.appendChild(manual);
  views.imported.panel.appendChild(imported);
  tab.classList.add('erp-workspace-ready');
}
/* ---------- Aplicação recorrente ---------- */
function apply(){
  removeNumberSpinners();fixPartyBanks();rebuildCalendarTools();priceSearches();cleanChequeControl();simplifyPayables();cleanAdvances();repairDiscreteStocks();ensureUnifiedEpi();redesignTrip();workspaceTrip();workspacePoint();replaceFiscalRegistry();simplifyExpensesGroup();addContractRenameButtons();mergeCasaGloria();restoreCoordTypes();filterCoordEmployees();filterCoordFunctionCards();fixSearchFocus();renderTripHistoryCards();
}
if(global.Phase1Dom)global.Phase1Dom.register(apply);else setInterval(apply,1000);
setTimeout(()=>{apply();ensureOwnerModule();loadFiscalParties();},350);
document.addEventListener('erp:user-started',()=>setTimeout(()=>{apply();ensureOwnerModule();},700));

global.Phase2Feedback=Object.freeze({apply,chequeSequenceByBank,isDiscreteItem,isEpiItem,tripCostParts:phase2TripCostParts,tripMonthlyReport:phase2TripMonthlyReport});
})(window);
