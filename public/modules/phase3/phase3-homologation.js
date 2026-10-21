(function(global){
'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const store=global.Phase1Store;
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const money=v=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const today=()=>new Date().toISOString().slice(0,10);
const toISO=v=>{const s=String(v||'');if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;if(/^\d{2}\/\d{2}\/\d{4}$/.test(s)){const [d,m,y]=s.split('/');return `${y}-${m}-${d}`;}return '';};
const toBR=v=>{const s=toISO(v);return s?s.split('-').reverse().join('/'):String(v||'');};
const parseBR=raw=>{let s=String(raw||'').trim().replace(/[^0-9,.-]/g,'');if(!s)return 0;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');return Number(s)||0;};
function notify(msg,type='info',ms=4500){try{showToast(msg,type,ms);}catch(e){console[type==='error'?'error':'log'](msg);}}
function activeEmployee(f){if(!f)return false;const st=norm(f.status||'ativo');if(['inativo','demitido','desligado','rescindido'].includes(st))return false;if(f.ativo===false)return false;return true;}
function getEmployees(){try{return (FUNCIONARIOS||[]).filter(activeEmployee).slice().sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));}catch(e){return [];}}
function getUsers(){try{return Object.entries(USERS||{}).map(([key,u])=>({key,name:u?.name||key,role:u?.role||''})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));}catch(e){return [];}}
function currentUserKey(){try{return String(cuKey||sessionStorage.getItem('mm_sessao')||'');}catch(e){return '';}}

/* Ticket robusto: chave Firebase, número visível e recuperação da nuvem */
const ticketRefIndex=new Map();
let currentPurchaseTicketKey='';
function ticketDb(){try{return TICKETS_DB||{};}catch(e){return {};}}
function normalizeTicketRef(ref){
  return String(ref||'').trim().replace(/^ticket\s*#?\s*/i,'').trim();
}
function captureTicketMappings(){
  const body=$('#tb-compras');if(!body)return;
  Array.from(body.rows||[]).forEach(row=>{
    const visible=normalizeTicketRef(row.cells?.[0]?.textContent||'');
    const edit=row.querySelector('button[onclick*="csAbrirImpureza"],button[onclick*="abrirDetalheCompra"]');
    const code=String(edit?.getAttribute('onclick')||'');
    const m=code.match(/(?:csAbrirImpureza|abrirDetalheCompra)\(['"]([^'"]+)['"]\)/);
    const key=normalizeTicketRef(m?.[1]||'');
    if(visible&&key){ticketRefIndex.set(visible,key);ticketRefIndex.set(key,visible);}
  });
}
function resolveTicketKey(ref){
  const db=ticketDb(),raw=normalizeTicketRef(ref);
  if(raw&&db[raw])return raw;
  const mapped=ticketRefIndex.get(raw);
  if(mapped&&db[mapped])return mapped;
  const up=raw.toUpperCase();
  const found=Object.entries(db).find(([k,t])=>{
    const values=[k,t?.ticket,t?.id,t?.codigo,t?.numero].map(normalizeTicketRef);
    return values.some(v=>v&&v.toUpperCase()===up);
  });
  if(found)return found[0];
  if(mapped){
    const mup=mapped.toUpperCase();
    const byMapped=Object.entries(db).find(([k,t])=>normalizeTicketRef(t?.ticket).toUpperCase()===mup||normalizeTicketRef(k).toUpperCase()===mup);
    if(byMapped)return byMapped[0];
  }
  return '';
}
async function ensureTicketKey(ref){
  captureTicketMappings();
  let key=resolveTicketKey(ref);
  if(key)return key;
  const raw=normalizeTicketRef(ref),mapped=normalizeTicketRef(ticketRefIndex.get(raw)||'');
  const db=ticketDb(),fb=global._fbDB;
  if(!fb)return '';
  const directCandidates=[raw,mapped].filter(Boolean);
  for(const candidate of directCandidates){
    try{
      const snap=await fb.ref('erp/tickets/'+candidate).once('value');
      const value=snap?.val?.();
      if(value){db[candidate]=value;return candidate;}
    }catch(e){}
  }
  const visible=(mapped&&mapped.toUpperCase().startsWith('T'))?mapped:raw;
  if(visible){
    try{
      const snap=await fb.ref('erp/tickets').orderByChild('ticket').equalTo(visible).limitToFirst(1).once('value');
      const value=snap?.val?.()||{};
      const entry=Object.entries(value)[0];
      if(entry){db[entry[0]]=entry[1];ticketRefIndex.set(visible,entry[0]);ticketRefIndex.set(entry[0],visible);return entry[0];}
    }catch(e){console.warn('[phase3] busca ticket na nuvem',e);}
  }
  return '';
}
function resetPurchaseDetailInputs(){
  ['dc-add-mat','dc-add-br','dc-add-lq','dc-add-pr','dc-add-valor','dc-add-valor-obs'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
  });
}
const legacyDetail=global.abrirDetalheCompra;
if(typeof legacyDetail==='function')global.abrirDetalheCompra=async function(ref){
  resetPurchaseDetailInputs();
  const k=await ensureTicketKey(ref);
  if(!k){notify('Ticket não encontrado. O registro não está mais disponível na base atual.','error');return;}
  currentPurchaseTicketKey=k;
  const result=legacyDetail.call(this,k);
  setTimeout(()=>{resetPurchaseDetailInputs();captureTicketMappings();},0);
  return result;
};
const legacyImp=global.csAbrirImpureza;
if(typeof legacyImp==='function')global.csAbrirImpureza=async function(ref){
  const target=normalizeTicketRef(ref)||currentPurchaseTicketKey;
  const k=await ensureTicketKey(target);
  if(!k){notify('Ticket não encontrado. O registro não está mais disponível na base atual.','error');return;}
  currentPurchaseTicketKey=k;
  return legacyImp.call(this,k);
};
global.phase3ResolveTicketKey=resolveTicketKey;
global.phase3EnsureTicketKey=ensureTicketKey;

/* Bancos múltiplos em cliente e fornecedor + compatibilidade com legado */
let partyBanks={};
async function loadPartyBanks(){if(!store)return;partyBanks=await store.load('partyBanks',{});decoratePartyBanks();}
function partyEntity(kind,key){try{return kind==='fornecedor'?(FORNECEDORES||[]).find(x=>String(x.cod)===String(key)):(CLIENTES||[]).find((x,i)=>String(x.cod||('C'+String(i+1).padStart(3,'0')))===String(key));}catch(e){return null;}}
function bankKey(kind,key){return `${kind}-${key}`;}
function bankList(kind,key){const a=partyBanks[bankKey(kind,key)];return Array.isArray(a)?a:[];}
function decoratePartyBanks(){[['#tb-fornecedores','fornecedor'],['#tb-clientes-list','cliente']].forEach(([sel,kind])=>{const body=$(sel);if(!body)return;Array.from(body.rows||[]).forEach(row=>{if(row.querySelector('.phase1-party-bank-btn')||row.querySelector('.phase3-bank-btn'))return;const key=String(row.cells?.[kind==='fornecedor'?1:0]?.textContent||'').trim();const name=String(row.cells?.[kind==='fornecedor'?2:1]?.textContent||'').trim();const cell=row.cells?.[row.cells.length-1];if(!key||!name||!cell)return;const b=document.createElement('button');b.className='phase3-bank-btn';b.type='button';b.textContent='🏦 Bancos';b.onclick=e=>{e.stopPropagation();phase3OpenPartyBanks(kind,key,name);};cell.prepend(b);});});}
global.phase3OpenPartyBanks=function(kind,key,name){const list=bankList(kind,key);$('#phase3-bank-ov')?.remove();const ov=document.createElement('div');ov.id='phase3-bank-ov';ov.className='phase3-overlay';ov.innerHTML=`<div class="phase3-modal banks"><header><div><h3>🏦 Contas bancárias</h3><small>${esc(name)} · ${kind==='fornecedor'?'Fornecedor':'Cliente'}</small></div><button onclick="document.getElementById('phase3-bank-ov').remove()">✕</button></header><div class="phase3-bank-help">Cadastre quantas contas forem necessárias. A primeira conta é considerada a principal e continua disponível para os módulos antigos.</div><div id="phase3-bank-rows"></div><button class="p3-secondary" onclick="phase3BankAdd()">＋ Adicionar conta</button><footer><button onclick="document.getElementById('phase3-bank-ov').remove()">Cancelar</button><button class="p3-primary" onclick="phase3BankSave('${esc(kind)}','${esc(key)}')">Salvar contas</button></footer></div>`;document.body.appendChild(ov);(list.length?list:[{}]).forEach(x=>phase3BankAdd(x));};
global.phase3BankAdd=function(v={}){const box=$('#phase3-bank-rows');if(!box)return;const row=document.createElement('div');row.className='phase3-bank-row';row.innerHTML=`<input data-f="bank" placeholder="Banco" value="${esc(v.bank||'')}"><input data-f="agency" placeholder="Agência" value="${esc(v.agency||'')}"><input data-f="account" placeholder="Conta" value="${esc(v.account||'')}"><input data-f="pix" placeholder="PIX" value="${esc(v.pix||'')}"><button title="Remover" onclick="this.parentElement.remove()">✕</button>`;box.appendChild(row);};
global.phase3BankSave=async function(kind,key){if(!store)return;const rows=$$('#phase3-bank-rows .phase3-bank-row').map(row=>{const o={};$$('input',row).forEach(i=>o[i.dataset.f]=i.value.trim());return o;}).filter(x=>Object.values(x).some(Boolean));partyBanks[bankKey(kind,key)]=rows;await store.save('partyBanks',bankKey(kind,key),rows);const e=partyEntity(kind,key),p=rows[0]||{};if(e){e.banco=p.bank||'';e.agencia=p.agency||'';e.conta=p.account||'';e.pix=p.pix||'';try{kind==='fornecedor'?saveFornecedores():saveClientes();}catch(_e){}try{fbSalvar();}catch(_e){}}$('#phase3-bank-ov')?.remove();notify('Contas bancárias salvas.','success');};
global.ERPPartyBanks=Object.freeze({list:(kind,key)=>bankList(kind,key).slice(),primary:(kind,key)=>bankList(kind,key)[0]||null});

/* Preços: uma única pesquisa integrada à própria lista da entidade */
function priceComboOptions(select,kind){
  const map=new Map();
  const put=(value,label)=>{value=String(value||'').trim();label=String(label||'').trim();if(value&&label&&!map.has(value))map.set(value,{value,label});};
  try{
    if(kind==='fornecedor'){
      const list=typeof getFornAtivos==='function'?getFornAtivos():(FORNECEDORES||[]);
      list.filter(Boolean).forEach(f=>put(f.cod,f.nome||f.cod));
    }else if(kind==='cliente'){
      (CLIENTES||[]).filter(Boolean).forEach(c=>put(c.nome,c.nome));
    }
  }catch(e){}
  Array.from(select?.options||[]).forEach(o=>put(o.value,o.textContent));
  return Array.from(map.values()).sort((a,b)=>a.label.localeCompare(b.label,'pt-BR',{sensitivity:'base'}));
}
function renderPriceComboList(combo,select,query='',kind=''){
  const list=$('.phase3-price-combo-list',combo);if(!list)return;
  const q=norm(query),selected=String(select?.value||''),items=priceComboOptions(select,kind).filter(x=>!q||norm(x.label).includes(q));
  const count=$('.phase3-price-count',combo);if(count)count.textContent=`${items.length} ${kind==='fornecedor'?'fornecedor(es)':'cliente(s)'}`;
  list.innerHTML=items.length
    ?items.slice(0,250).map(x=>`<button type="button" class="${selected===x.value?'selected':''}" data-value="${esc(x.value)}"><span>${esc(x.label)}</span>${selected===x.value?'<b>✓ selecionado</b>':''}</button>`).join('')
    :'<div class="phase3-price-empty">Nenhum cadastro encontrado.</div>';
  $$('button[data-value]',list).forEach(btn=>btn.addEventListener('click',e=>{
    e.preventDefault();
    const value=btn.dataset.value||'';
    if(!Array.from(select.options||[]).some(o=>String(o.value)===value)){
      const item=priceComboOptions(select,kind).find(x=>x.value===value),opt=document.createElement('option');
      opt.value=value;opt.textContent=item?.label||value;select.appendChild(opt);
    }
    select.value=value;
    const input=$('input[type="search"]',combo);if(input)input.value='';
    select.dispatchEvent(new Event('change',{bubbles:true}));
    renderPriceComboList(combo,select,'',kind);
  }));
}
function ensurePriceCombo(tabSel,selectSel,label,kind){
  const tab=$(tabSel),select=$(selectSel);if(!tab||!select)return;
  tab.querySelectorAll('.phase2-price-searches').forEach(x=>x.remove());
  let combo=tab.querySelector(`.phase3-price-combo[data-for="${select.id}"]`);
  if(!combo){
    combo=document.createElement('div');combo.className='phase3-price-combo';combo.dataset.for=select.id;combo.dataset.kind=kind;
    combo.innerHTML=`<div class="phase3-price-search-head"><input type="search" autocomplete="off" placeholder="🔍 Digite para localizar ${label.toLowerCase()}..."><small class="phase3-price-count"></small></div><div class="phase3-price-combo-list"></div>`;
    select.insertAdjacentElement('afterend',combo);
    select.classList.add('phase3-original-select');
    const input=$('input[type="search"]',combo);
    input.addEventListener('input',()=>renderPriceComboList(combo,select,input.value,kind));
    input.addEventListener('keydown',e=>{
      if(e.key==='Escape'){input.value='';renderPriceComboList(combo,select,'',kind);}
      if(e.key==='Enter'){
        const first=combo.querySelector('.phase3-price-combo-list button[data-value]');
        if(first){e.preventDefault();first.click();}
      }
    });
  }
  renderPriceComboList(combo,select,$('input[type="search"]',combo)?.value||'',kind);
}
function fixPriceSearches(){
  ensurePriceCombo('#tab-precos_fornecedores','#pf-forn-sel','Fornecedor','fornecedor');
  ensurePriceCombo('#tab-precos_clientes','#pc-cli-sel','Cliente','cliente');
}

/* Calendário unificado: período por datas/meses, usuário e avisos 5/3/1 */
let calendarEvents={},calendarMonth=today().slice(0,7),calendarSelected=today(),calendarRangeMode='date',
  calendarFrom='',calendarTo='',calendarMonthFrom='',calendarMonthTo='',calendarSearch='',calendarUser='',calendarMigrating=false;
function hideLegacyCalendarUi(){
  const tab=$('#tab-afazeres');if(!tab)return;
  Array.from(tab.children).forEach(ch=>{if(ch.id!=='phase3-calendar')ch.classList.add('phase3-calendar-legacy');});
}
function isAdminUser(){
  try{return cu?.admin===true||/dona|admin/i.test(String(cu?.role||''));}catch(e){return false;}
}
function userName(key){return getUsers().find(x=>x.key===key)?.name||key||'Não atribuído';}
function dateDiff(a,b){const [ay,am,ad]=a.split('-').map(Number),[by,bm,bd]=b.split('-').map(Number);return Math.round((new Date(by,bm-1,bd)-new Date(ay,am-1,ad))/86400000);}
function monthDays(ym){const [y,m]=ym.split('-').map(Number),first=new Date(y,m-1,1).getDay(),last=new Date(y,m,0).getDate();const out=[];for(let i=0;i<first;i++)out.push(null);for(let d=1;d<=last;d++)out.push(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);return out;}
function calendarRangePass(e){
  if(!e?.date)return false;
  if(calendarRangeMode==='month'){
    const ym=e.date.slice(0,7);
    return (!calendarMonthFrom||ym>=calendarMonthFrom)&&(!calendarMonthTo||ym<=calendarMonthTo);
  }
  return (!calendarFrom||e.date>=calendarFrom)&&(!calendarTo||e.date<=calendarTo);
}
function calendarList(){
  const q=norm(calendarSearch),user=calendarUser;
  return Object.values(calendarEvents||{})
    .filter(e=>e&&calendarRangePass(e)&&(!user||e.userKey===user)&&(!q||norm([e.title,e.description,e.category,userName(e.userKey)].join(' ')).includes(q)))
    .sort((a,b)=>String(a.date+' '+(a.time||'')).localeCompare(String(b.date+' '+(b.time||''))));
}
function resolveLegacyUser(author){
  const a=norm(author),users=getUsers();
  return users.find(u=>norm(u.name)===a||norm(u.key)===a)?.key||currentUserKey();
}
async function migrateLegacyAfazeres(){
  if(calendarMigrating||!store||!isAdminUser())return;
  let legacy=[];try{legacy=(AFAZERES_DB||[]).filter(Boolean);}catch(e){}
  if(!legacy.length)return;
  const existingLegacy=new Set(Object.values(calendarEvents||{}).map(e=>String(e?.legacyAfazerId||'')).filter(Boolean));
  const pending=legacy.filter(a=>a?.id&&!existingLegacy.has(String(a.id))&&(a.data||a.criadoEm)&&a.texto);
  if(!pending.length)return;
  calendarMigrating=true;
  try{
    for(const a of pending){
      let date=toISO(a.data||'');
      if(!date){
        const m=String(a.criadoEm||'').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if(m)date=`${m[3]}-${m[2]}-${m[1]}`;
      }
      if(!date)continue;
      const id=`LEGACY-${String(a.id).replace(/[^a-zA-Z0-9_-]/g,'_')}`;
      const userKey=resolveLegacyUser(a.autor);
      const e={id,title:String(a.texto||'').trim(),date,time:'',userKey,category:'Compromisso',description:'',status:a.feito?'Concluído':'Pendente',
        createdBy:currentUserKey(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),legacyAfazerId:String(a.id)};
      if(a.feito&&a.feitoEm)e.completedAt=String(a.feitoEm);
      calendarEvents[id]=e;
      await store.save('calendarEvents',id,e);
    }
  }catch(error){console.warn('[phase3] migração Afazeres → Calendário',error);}
  finally{calendarMigrating=false;}
}
async function loadCalendar(){
  if(!store)return;
  calendarEvents=await store.load('calendarEvents',{});
  await migrateLegacyAfazeres();
  renderCalendar();
  setTimeout(checkCalendarPopups,500);
}
const legacyRenderAfazeresPhase3=global.renderAfazeres;
if(typeof legacyRenderAfazeresPhase3==='function')global.renderAfazeres=function(){
  const r=legacyRenderAfazeresPhase3.apply(this,arguments);
  setTimeout(()=>{hideLegacyCalendarUi();renderCalendar();},0);
  return r;
};

function preserveCalendarFocus(){
  const a=document.activeElement;
  if(!a||!a.id||!a.closest('#phase3-calendar'))return null;
  return {id:a.id,start:a.selectionStart,end:a.selectionEnd};
}
function restoreCalendarFocus(state){
  if(!state)return;
  const el=document.getElementById(state.id);if(!el)return;
  el.focus();
  try{if(typeof state.start==='number')el.setSelectionRange(state.start,state.end);}catch(e){}
}
function eventCard(e){
  return `<article class="p3-event ${e.status==='Concluído'?'done':''}" data-date="${esc(e.date)}">
    <div class="date"><b>${toBR(e.date)}</b><small>${esc(e.time||'Sem horário')}</small></div>
    <div class="body"><b>${esc(e.title)}</b><small>${esc(e.category||'Compromisso')} · 👤 ${esc(userName(e.userKey))}</small>${e.description?`<p>${esc(e.description)}</p>`:''}</div>
    <span class="status">${esc(e.status||'Pendente')}</span>
    <div class="actions"><button title="${e.status==='Concluído'?'Reabrir':'Concluir'}" onclick="phase3CalendarToggle('${e.id}')">${e.status==='Concluído'?'↩':'✓'}</button><button title="Editar" onclick="phase3CalendarOpen('${e.id}')">✏️</button><button title="Excluir" onclick="phase3CalendarDelete('${e.id}')">🗑</button></div>
  </article>`;
}
function renderCalendar(){
  const tab=$('#tab-afazeres');if(!tab)return;
  const focus=preserveCalendarFocus();
  hideLegacyCalendarUi();
  let root=$('#phase3-calendar');
  if(!root){root=document.createElement('div');root.id='phase3-calendar';tab.prepend(root);}
  const users=getUsers(),list=calendarList(),byDay={};
  Object.values(calendarEvents||{}).filter(e=>e&&String(e.date||'').slice(0,7)===calendarMonth).forEach(e=>(byDay[e.date]||(byDay[e.date]=[])).push(e));
  const [y,m]=calendarMonth.split('-');
  const monthTitle=new Date(Number(y),Number(m)-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  const rangeLabel=calendarRangeMode==='month'
    ?`${calendarMonthFrom||'início'} → ${calendarMonthTo||'fim'}`
    :`${calendarFrom?toBR(calendarFrom):'início'} → ${calendarTo?toBR(calendarTo):'fim'}`;
  root.innerHTML=`<div class="p3-cal-head">
    <div><h2>📅 Agenda e compromissos</h2><p>Uma agenda única. Filtre por período e responsável; o usuário recebe aviso automático 5, 3 e 1 dia antes.</p></div>
    <button class="p3-primary" onclick="phase3CalendarOpen()">＋ Novo compromisso</button>
  </div>
  <div class="p3-cal-filter-card">
    <div class="p3-range-switch">
      <button class="${calendarRangeMode==='date'?'active':''}" onclick="phase3CalendarRangeMode('date')">Por datas</button>
      <button class="${calendarRangeMode==='month'?'active':''}" onclick="phase3CalendarRangeMode('month')">Por meses</button>
    </div>
    <div class="p3-cal-range-fields">
      ${calendarRangeMode==='date'
        ?`<label>De<input id="p3cal-from" type="date" value="${calendarFrom}" onchange="phase3CalendarFilter('from',this.value)"></label><label>Até<input id="p3cal-to" type="date" value="${calendarTo}" onchange="phase3CalendarFilter('to',this.value)"></label>`
        :`<label>Mês inicial<input id="p3cal-month-from" type="month" value="${calendarMonthFrom}" onchange="phase3CalendarFilter('monthFrom',this.value)"></label><label>Mês final<input id="p3cal-month-to" type="month" value="${calendarMonthTo}" onchange="phase3CalendarFilter('monthTo',this.value)"></label>`}
      <label>Responsável<select id="p3cal-user-filter" onchange="phase3CalendarFilter('user',this.value)"><option value="">Todos</option>${users.map(u=>`<option value="${esc(u.key)}" ${calendarUser===u.key?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label>
      <label class="search">Buscar<input id="p3cal-search" type="search" placeholder="Título, descrição, categoria..." value="${esc(calendarSearch)}" oninput="phase3CalendarSearch(this.value)"></label>
      <button class="clear" onclick="phase3CalendarClearFilters()">Limpar filtros</button>
    </div>
    <div class="p3-cal-filter-summary"><b>${list.length}</b> compromisso(s) · período ${esc(rangeLabel)}</div>
  </div>
  <div class="p3-cal-layout">
    <section class="p3-month">
      <div class="p3-month-nav"><button onclick="phase3CalendarMove(-1)">‹</button><b>${esc(monthTitle)}</b><button onclick="phase3CalendarMove(1)">›</button></div>
      <div class="p3-week">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(x=>`<span>${x}</span>`).join('')}</div>
      <div class="p3-days">${monthDays(calendarMonth).map(d=>d?`<button class="${d===calendarSelected?'selected':''} ${d===today()?'today':''}" onclick="phase3CalendarSelect('${d}')"><b>${Number(d.slice(-2))}</b>${byDay[d]?.length?`<span>${byDay[d].length}</span>`:''}</button>`:'<i></i>').join('')}</div>
      <div class="p3-cal-day-actions"><span>Dia selecionado: <b>${toBR(calendarSelected)}</b></span><button onclick="phase3CalendarOpen('', '${calendarSelected}')">＋ Adicionar neste dia</button></div>
    </section>
    <section class="p3-period-results">
      <header><div><h3>Agendas encontradas</h3><small>Todos os compromissos que correspondem aos filtros.</small></div></header>
      <div class="p3-period-scroll">${list.length?list.map(eventCard).join(''):'<div class="p3-empty">Nenhum compromisso nesse período/filtro.</div>'}</div>
    </section>
  </div>`;
  restoreCalendarFocus(focus);
}
global.phase3CalendarToday=()=>{calendarMonth=today().slice(0,7);calendarSelected=today();renderCalendar();};
global.phase3CalendarSetMonth=v=>{calendarMonth=v||calendarMonth;calendarSelected=`${calendarMonth}-01`;renderCalendar();};
global.phase3CalendarMove=d=>{const [y,m]=calendarMonth.split('-').map(Number),dt=new Date(y,m-1+d,1);calendarMonth=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;calendarSelected=`${calendarMonth}-01`;renderCalendar();};
global.phase3CalendarSelect=d=>{calendarSelected=d;calendarRangeMode='date';calendarFrom=d;calendarTo=d;calendarMonthFrom='';calendarMonthTo='';renderCalendar();};
global.phase3CalendarRangeMode=mode=>{calendarRangeMode=mode==='month'?'month':'date';renderCalendar();};
global.phase3CalendarClearFilters=()=>{calendarFrom='';calendarTo='';calendarMonthFrom='';calendarMonthTo='';calendarSearch='';calendarUser='';renderCalendar();};
global.phase3CalendarFilter=(k,v)=>{
  if(k==='from')calendarFrom=v;if(k==='to')calendarTo=v;
  if(k==='monthFrom')calendarMonthFrom=v;if(k==='monthTo')calendarMonthTo=v;
  if(k==='user')calendarUser=v;renderCalendar();
};
let calendarSearchTimer=null;
global.phase3CalendarSearch=value=>{
  calendarSearch=value||'';
  clearTimeout(calendarSearchTimer);
  calendarSearchTimer=setTimeout(renderCalendar,120);
};
global.phase3CalendarOpen=function(id='',date=''){
  const e=id?calendarEvents[id]:null,users=getUsers(),body=$('#modal-body');if(!body)return;
  body.className='modal';
  body.innerHTML=`<h3>${e?'✏️ Editar':'＋ Novo'} compromisso</h3><input type="hidden" id="p3cal-id" value="${esc(id)}">
    <div class="fg"><label>Título *</label><input id="p3cal-title" value="${esc(e?.title||'')}" placeholder="Ex.: Renovar certificado, reunião, visita..."></div>
    <div class="phase3-grid2"><div class="fg"><label>Data *</label><input id="p3cal-date" type="date" value="${esc(e?.date||date||calendarSelected||today())}"></div><div class="fg"><label>Horário</label><input id="p3cal-time" type="time" value="${esc(e?.time||'')}"></div></div>
    <div class="fg"><label>Responsável *</label><select id="p3cal-user"><option value="">— Selecione —</option>${users.map(u=>`<option value="${esc(u.key)}" ${(e?.userKey||currentUserKey())===u.key?'selected':''}>${esc(u.name)} · ${esc(u.role)}</option>`).join('')}</select><small class="p3-help">O popup e o aviso são exibidos para o responsável selecionado.</small></div>
    <div class="fg"><label>Categoria</label><select id="p3cal-cat">${['Compromisso','Financeiro','Fiscal','Cliente','Fornecedor','RH','Frota','Outro'].map(x=>`<option ${e?.category===x?'selected':''}>${x}</option>`).join('')}</select></div>
    <div class="fg"><label>Descrição</label><textarea id="p3cal-desc" rows="3">${esc(e?.description||'')}</textarea></div>
    <div class="p3-reminder-info">🔔 Avisos fixos para o responsável: <b>5 dias</b>, <b>3 dias</b> e <b>1 dia</b> antes.</div>
    <div class="modal-ft"><button class="btn-cancel" onclick="cm()">Cancelar</button><button class="btn-save" onclick="phase3CalendarSave()">Salvar</button></div>`;
  $('#modal-ov')?.classList.add('open');
};
global.phase3CalendarSave=async function(){
  if(!store)return;
  const id=$('#p3cal-id')?.value||store.id('CAL'),title=$('#p3cal-title')?.value.trim(),date=$('#p3cal-date')?.value,userKey=$('#p3cal-user')?.value;
  if(!title||!date||!userKey){notify('Informe título, data e responsável.','error');return;}
  const prev=calendarEvents[id]||{};
  const e={...prev,id,title,date,time:$('#p3cal-time')?.value||'',userKey,category:$('#p3cal-cat')?.value||'Compromisso',description:$('#p3cal-desc')?.value.trim()||'',
    status:prev.status||'Pendente',createdBy:prev.createdBy||currentUserKey(),createdAt:prev.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
  calendarEvents[id]=e;await store.save('calendarEvents',id,e);cm();calendarMonth=date.slice(0,7);calendarSelected=date;renderCalendar();refreshAvisos();notify('Compromisso salvo.','success');
};
global.phase3CalendarToggle=async id=>{const e=calendarEvents[id];if(!e||!store)return;e.status=e.status==='Concluído'?'Pendente':'Concluído';e.completedAt=e.status==='Concluído'?new Date().toISOString():'';e.updatedAt=new Date().toISOString();await store.save('calendarEvents',id,e);renderCalendar();refreshAvisos();};
global.phase3CalendarDelete=async id=>{if(!calendarEvents[id]||!store||!confirm('Excluir este compromisso?'))return;delete calendarEvents[id];await store.remove('calendarEvents',id);renderCalendar();refreshAvisos();};
function myUpcoming(){const me=currentUserKey(),now=today();return Object.values(calendarEvents||{}).filter(e=>e&&e.userKey===me&&e.status!=='Concluído'&&e.date>=now&&dateDiff(now,e.date)<=5).sort((a,b)=>a.date.localeCompare(b.date));}
function checkCalendarPopups(){
  const me=currentUserKey();if(!me)return;
  const now=today(),due=Object.values(calendarEvents||{}).filter(e=>e&&e.userKey===me&&e.status!=='Concluído'&&[5,3,1].includes(dateDiff(now,e.date)));
  if(!due.length)return;
  const key=`mm_cal_seen_${me}`,seen=JSON.parse(localStorage.getItem(key)||'{}'),fresh=due.filter(e=>!seen[`${e.id}|${now}`]);
  if(!fresh.length)return;
  fresh.forEach(e=>seen[`${e.id}|${now}`]=1);localStorage.setItem(key,JSON.stringify(seen));
  const msg=fresh.map(e=>`• ${e.title} — ${toBR(e.date)} (${dateDiff(now,e.date)} dia(s))`).join('\n');
  setTimeout(()=>alert(`🔔 Compromissos próximos\n\n${msg}`),350);
}
const legacyAvisos=global.renderAvisos,legacyBadge=global.avisosAtualizarBadge;
function injectCalendarAvisos(){
  const box=$('#tab-avisos');if(!box)return;
  $('#phase3-calendar-alerts')?.remove();
  const list=myUpcoming(),card=document.createElement('div');card.id='phase3-calendar-alerts';card.className='p3-alert-card';
  card.innerHTML=`<h3>📅 Meus compromissos</h3>${list.length?list.map(e=>`<div><b>${esc(e.title)}</b><span>${toBR(e.date)} · ${dateDiff(today(),e.date)} dia(s)</span></div>`).join(''):'<p>Nenhum compromisso seu nos próximos 5 dias.</p>'}`;
  (box.querySelector('div')||box).prepend(card);
}
function refreshAvisos(){try{global.avisosAtualizarBadge?.();if($('#tab-avisos')?.classList.contains('active'))global.renderAvisos?.();}catch(e){}}
if(typeof legacyAvisos==='function')global.renderAvisos=function(){const r=legacyAvisos.apply(this,arguments);setTimeout(injectCalendarAvisos,0);return r;};
if(typeof legacyBadge==='function')global.avisosAtualizarBadge=function(){const r=legacyBadge.apply(this,arguments);setTimeout(()=>{const el=$('.nav-tab[data-tab="avisos"] .nt-label');if(!el)return;const old=el.querySelector('.p3-aviso-count');if(old)old.remove();const extra=myUpcoming().length;if(extra){const s=document.createElement('span');s.className='p3-aviso-count';s.textContent=String(extra);el.appendChild(document.createTextNode(' '));el.appendChild(s);}},0);return r;};

/* Cheques: explicação, contagem consistente e limpeza do controle */
function chequeSequence(){let list=[];try{list=Object.values(CHQ_CTRL||{}).filter(Boolean);}catch(e){}const groups={};list.forEach(c=>{const b=String(c.b||'Sem banco'),n=parseInt(String(c.n||'').replace(/\D/g,''),10);if(Number.isFinite(n))(groups[b]||(groups[b]=[])).push(n);});return Object.entries(groups).map(([b,nums])=>{nums=[...new Set(nums)].sort((a,b)=>a-b);const miss=[];for(let n=nums[0];nums.length&&n<nums[nums.length-1];n++)if(!nums.includes(n))miss.push(n);return {bank:b,missing:miss};});}
function decorateCheque(){const root=$('#chq-ctrl-root');if(!root)return;try{const live=Object.entries(CHQ_CTRL||{}).filter(([id,c])=>c&&!(global._chqDel||{})[id]).map(([,c])=>c),tot={A:{q:0,v:0},C:{q:0,v:0},X:{q:0,v:0}};live.forEach(c=>{const st=c.s||'A';if(!tot[st])tot[st]={q:0,v:0};tot[st].q++;tot[st].v+=Number(c.v||0);});$$('.kpi',root).forEach(k=>{const lbl=norm($('.kpi-lbl',k)?.textContent||''),val=$('.kpi-val',k),sub=$('.kpi-sub',k);if(lbl==='a compensar'){if(val)val.textContent='R$ '+money(tot.A.v);if(sub)sub.textContent=tot.A.q+' cheque(s) pendente(s)';}else if(lbl==='compensados'){if(val)val.textContent=String(tot.C.q);if(sub)sub.textContent='R$ '+money(tot.C.v)+' já caíram';}else if(lbl==='cancelados'){if(val)val.textContent=String(tot.X.q);}else if(lbl==='total no controle'){if(val)val.textContent=String(live.length);}});}catch(e){}$$('th',root).forEach(th=>{if(/Desc\. Compra\?/i.test(th.textContent||'')){th.textContent='Abate compra?';th.title='Sim = este cheque representa um adiantamento e deve ser abatido do valor da compra. Não significa apenas que o cheque foi compensado.';}});$$('button',root).forEach(b=>{if((b.textContent||'').includes('🛒 Sim')){b.textContent='✓ Sim · adiantamento';b.title='Este cheque será considerado adiantamento e poderá abater o valor da compra. A compensação bancária é tratada separadamente.';}});let info=$('#phase3-cheque-help');if(!info){info=document.createElement('div');info.id='phase3-cheque-help';info.className='p3-cheque-help';info.innerHTML='<b>“Abate compra?”</b> Use <strong>Sim</strong> somente quando o cheque for um <strong>adiantamento ao fornecedor</strong>. Assim ele pode reduzir o saldo da compra. Compensar o cheque no banco é outra operação.';root.prepend(info);}const gaps=chequeSequence().filter(x=>x.missing.length);let gap=$('#phase3-cheque-gaps');if(!gap){gap=document.createElement('div');gap.id='phase3-cheque-gaps';root.insertBefore(gap,info.nextSibling);}const gapHtml=gaps.length?gaps.map(x=>`<div>⚠️ <b>${esc(x.bank)}</b>: faltando ${esc(x.missing.slice(0,25).join(', '))}</div>`).join(''):'<div class="ok">✓ Sequências cadastradas sem lacunas internas.</div>';if(gap.innerHTML!==gapHtml)gap.innerHTML=gapHtml;}
const legacyChequeRender=global.renderChequesCompensar;if(typeof legacyChequeRender==='function')global.renderChequesCompensar=function(){const r=legacyChequeRender.apply(this,arguments);setTimeout(decorateCheque,0);return r;};
const legacyChequeDelete=global.chqExcluir;if(typeof legacyChequeDelete==='function')global.chqExcluir=function(id){const r=legacyChequeDelete.apply(this,arguments);setTimeout(()=>{try{renderChequesCompensar();}catch(e){}},350);return r;};

/* Contas pessoais da dona */
let ownerBills={};let ownerMonth=today().slice(0,7),ownerFilter='todos';
async function loadOwnerBills(){if(!store)return;ownerBills=await store.load('ownerBills',{});Object.values(ownerBills).forEach(x=>{if(x&&x.dueDay==null)x.dueDay=Number(x.day||1);if(x&&!x.payments)x.payments={};});renderOwnerBillsV3();}
function ownerDueDate(b,month){const [y,m]=month.split('-').map(Number),last=new Date(y,m,0).getDate();return `${month}-${String(Math.min(last,Math.max(1,Number(b.dueDay||1)))).padStart(2,'0')}`;}
function ownerStatus(b,month){const p=b.payments?.[month];if(p?.paid)return 'pago';const due=ownerDueDate(b,month),now=today();return due<now?'atrasado':due===now?'hoje':'pendente';}
function renderOwnerBillsV3(){const host=$('#phase2-owner-bills');if(!host)return;host.dataset.p3owner='1';const items=Object.values(ownerBills||{}).filter(x=>x&&x.active!==false).filter(x=>ownerFilter==='todos'||ownerStatus(x,ownerMonth)===ownerFilter);const total=items.reduce((s,x)=>s+Number(x.value||0),0),paid=items.filter(x=>ownerStatus(x,ownerMonth)==='pago').reduce((s,x)=>s+Number(x.value||0),0),over=items.filter(x=>ownerStatus(x,ownerMonth)==='atrasado').length,todayCount=items.filter(x=>ownerStatus(x,ownerMonth)==='hoje').length;host.innerHTML=`<div class="p3-owner-head"><div><h2>🏠 Contas pessoais da Dona</h2><p>Controle mensal de despesas pessoais recorrentes, vencimentos e pagamentos.</p></div><button class="p3-primary" onclick="phase3OwnerOpen()">＋ Nova conta</button></div><div class="p3-owner-toolbar"><input type="month" value="${ownerMonth}" onchange="phase3OwnerMonth(this.value)"><select onchange="phase3OwnerFilter(this.value)"><option value="todos">Todos</option><option value="pendente" ${ownerFilter==='pendente'?'selected':''}>Pendentes</option><option value="hoje" ${ownerFilter==='hoje'?'selected':''}>Vence hoje</option><option value="atrasado" ${ownerFilter==='atrasado'?'selected':''}>Atrasadas</option><option value="pago" ${ownerFilter==='pago'?'selected':''}>Pagas</option></select></div><div class="p3-owner-kpis"><div><small>Previsto</small><b>R$ ${money(total)}</b></div><div><small>Pago</small><b>R$ ${money(paid)}</b></div><div class="warn"><small>Atrasadas</small><b>${over}</b></div><div class="today"><small>Vence hoje</small><b>${todayCount}</b></div></div><div class="p3-owner-calendar">${items.length?items.sort((a,b)=>Number(a.dueDay)-Number(b.dueDay)).map(b=>{const st=ownerStatus(b,ownerMonth),due=ownerDueDate(b,ownerMonth);return `<article class="${st}"><div class="day"><small>Vence</small><b>${due.slice(-2)}</b></div><div class="main"><b>${esc(b.desc)}</b><small>${esc(b.category||'Sem categoria')} · ${toBR(due)}</small>${b.obs?`<p>${esc(b.obs)}</p>`:''}</div><strong>R$ ${money(b.value)}</strong><span class="badge">${st==='pago'?'Pago':st==='atrasado'?'Atrasada':st==='hoje'?'Vence hoje':'Pendente'}</span><div class="actions">${st==='pago'?`<button onclick="phase3OwnerReopen('${b.id}')">↩ Reabrir</button>`:`<button class="pay" onclick="phase3OwnerPay('${b.id}')">✓ Pagar</button>`}<button onclick="phase3OwnerOpen('${b.id}')">✏️</button><button onclick="phase3OwnerToggle('${b.id}')">Pausar</button></div></article>`;}).join(''):'<div class="p3-empty">Nenhuma conta neste filtro.</div>'}</div>`;}
global.phase2OpenOwnerBills=function(){
  try{
    $$('.nav-tab').forEach(x=>x.classList.remove('active'));
    $$('.tab-panel').forEach(x=>x.classList.remove('active'));
    $('.nav-tab[data-tab="contas_dona"]')?.classList.add('active');
    $('#tab-contas_dona')?.classList.add('active');
  }catch(e){}
  loadOwnerBills();
};
global.phase3OwnerMonth=v=>{ownerMonth=v||ownerMonth;renderOwnerBillsV3();};global.phase3OwnerFilter=v=>{ownerFilter=v;renderOwnerBillsV3();};
global.phase3OwnerOpen=function(id=''){const b=id?ownerBills[id]:null,body=$('#modal-body');if(!body)return;body.className='modal';body.innerHTML=`<h3>${b?'✏️ Editar':'＋ Nova'} conta pessoal</h3><input type="hidden" id="p3ob-id" value="${esc(id)}"><div class="fg"><label>Descrição</label><input id="p3ob-desc" value="${esc(b?.desc||'')}"></div><div class="phase3-grid2"><div class="fg"><label>Categoria</label><input id="p3ob-cat" value="${esc(b?.category||'')}"></div><div class="fg"><label>Valor R$</label><input id="p3ob-value" inputmode="decimal" value="${b?money(b.value):''}"></div></div><div class="fg"><label>Vencimento mensal</label><input id="p3ob-due" type="date" value="${ownerDueDate(b||{dueDay:10},ownerMonth)}"><small class="p3-help">Será usada a mesma data/dia nos próximos meses.</small></div><div class="fg"><label>Observação</label><input id="p3ob-obs" value="${esc(b?.obs||'')}"></div><div class="modal-ft"><button onclick="cm()">Cancelar</button><button class="btn-save" onclick="phase3OwnerSave()">Salvar</button></div>`;$('#modal-ov')?.classList.add('open');};
global.phase3OwnerSave=async function(){if(!store)return;const id=$('#p3ob-id')?.value||store.id('PESS'),desc=$('#p3ob-desc')?.value.trim(),value=parseBR($('#p3ob-value')?.value),due=$('#p3ob-due')?.value;if(!desc||!(value>0)||!due){notify('Informe descrição, valor e vencimento.','error');return;}const old=ownerBills[id]||{};const b={...old,id,desc,category:$('#p3ob-cat')?.value.trim()||'',value,dueDay:Number(due.slice(-2)),obs:$('#p3ob-obs')?.value.trim()||'',active:old.active!==false,payments:old.payments||{}};ownerBills[id]=b;await store.save('ownerBills',id,b);cm();renderOwnerBillsV3();};
global.phase3OwnerPay=async id=>{const b=ownerBills[id];if(!b||!store)return;b.payments=b.payments||{};b.payments[ownerMonth]={paid:true,paidAt:today(),value:Number(b.value||0)};await store.save('ownerBills',id,b);renderOwnerBillsV3();};global.phase3OwnerReopen=async id=>{const b=ownerBills[id];if(!b||!store)return;b.payments=b.payments||{};delete b.payments[ownerMonth];await store.save('ownerBills',id,b);renderOwnerBillsV3();};global.phase3OwnerToggle=async id=>{const b=ownerBills[id];if(!b||!store)return;b.active=false;await store.save('ownerBills',id,b);renderOwnerBillsV3();};

/* Adiantamentos: ticket selecionável + recalcular compra */
function supplierTicketOptions(fornCod,current=''){let arr=[];try{arr=Object.entries(TICKETS_DB||{}).filter(([k,t])=>!fornCod||t?.fornecedorCod===fornCod||(FORNECEDORES||[]).find(f=>f.cod===fornCod)?.nome===t?.fornecedor).map(([k,t])=>({key:k,ticket:t.ticket||k,total:t.totalGeral||0}));}catch(e){}const seen=new Set();return arr.filter(x=>!seen.has(x.ticket)&&seen.add(x.ticket)).sort((a,b)=>String(b.ticket).localeCompare(String(a.ticket))).map(x=>`<option value="${esc(x.ticket)}" ${String(current)===String(x.ticket)?'selected':''}>${esc(x.ticket)} · R$ ${money(x.total)}</option>`).join('');}
function replaceTicketInput(id,fornCod,current){const old=$(id);if(!old||old.tagName==='SELECT')return;const sel=document.createElement('select');sel.id=old.id;sel.innerHTML=`<option value="">— Crédito geral, sem compra específica —</option>${supplierTicketOptions(fornCod,current||old.value)}`;old.replaceWith(sel);const label=sel.closest('.fg')?.querySelector('label');if(label)label.textContent='Compra relacionada (opcional)';}
function enhanceAdvanceTickets(){[['#adt-ticket','#adt-forn'],['#ea-ticket','#ea-forn']].forEach(([tid,fid])=>{const el=$(tid),forn=$(fid)?.value||'',cur=el?.value||'';if(!el)return;if(el.tagName!=='SELECT'){replaceTicketInput(tid,forn,cur);return;}const html=`<option value="">— Crédito geral, sem compra específica —</option>${supplierTicketOptions(forn,cur)}`;if(el.dataset.p3forn!==forn){el.innerHTML=html;el.dataset.p3forn=forn;if(cur&&Array.from(el.options).some(o=>o.value===cur))el.value=cur;}});[['#adt-forn-busca'],['#ea-forn-busca']].forEach(([s])=>{const x=$(s);if(x&&!x.dataset.p3ticket){x.dataset.p3ticket='1';x.addEventListener('change',()=>setTimeout(enhanceAdvanceTickets,30));x.addEventListener('input',()=>setTimeout(enhanceAdvanceTickets,80));}});}
function linkedAdvanceRecords(ticket){
  const out=[];try{Object.values(ADT_POR_FORN||{}).forEach(list=>(list||[]).forEach(a=>{if(a&&String(a.ticket||'').trim()===String(ticket||'').trim())out.push(a);}));}catch(e){}
  return out;
}
function ticketSnapshotAdvanceCodes(t){
  const list=Array.isArray(t?.reciboFinanceiro?.adiantamentos)?t.reciboFinanceiro.adiantamentos:[];
  return new Set(list.map(x=>String(x?.cod||'').trim()).filter(Boolean));
}
function purchaseAdvanceOverride(t){
  const raw=t?._phase3AdvanceOverride;
  if(!raw||!Number.isFinite(Number(raw.total)))return null;
  return {total:Math.max(0,Math.round(Number(raw.total)*100)/100),ignoredCodes:new Set(Array.isArray(raw.ignoredCodes)?raw.ignoredCodes.map(x=>String(x||'').trim()).filter(Boolean):[])};
}
function externalAdvanceSum(ticket,ticketObj){
  const key=resolveTicketKey(ticket),t=ticketObj||(key?ticketDb()[key]:null),snapshotCodes=ticketSnapshotAdvanceCodes(t),override=purchaseAdvanceOverride(t),ignored=override?.ignoredCodes||new Set();
  const sum=linkedAdvanceRecords(ticket).reduce((total,a)=>{
    const cod=String(a?.cod||'').trim();
    if(a?.origem==='compra_inline'||(cod&&snapshotCodes.has(cod))||(cod&&ignored.has(cod)))return total;
    return total+Number(a?.valor||0);
  },0);
  return Math.round(sum*100)/100;
}
function ticketAdvanceBase(t){
  const override=purchaseAdvanceOverride(t);
  if(override)return override.total;
  const explicit=Number(t?._phase3AdvanceBase);
  if(Number.isFinite(explicit))return Math.max(0,Math.round(explicit*100)/100);
  const snapshot=Number(t?.reciboFinanceiro?.total);
  if(Number.isFinite(snapshot))return Math.max(0,Math.round(snapshot*100)/100);
  return null;
}
function advanceSumForTicket(ticket){
  const key=resolveTicketKey(ticket),t=key?ticketDb()[key]:null;
  if(!t)return 0;
  const base=ticketAdvanceBase(t);
  return Math.round(((base==null?Number(t.adiantamento||0):base)+externalAdvanceSum(ticket,t))*100)/100;
}
function updateTicketAdvance(ticket,totalAdvance){
  if(!ticket)return false;
  const key=resolveTicketKey(ticket);if(!key)return false;
  let t;try{t=TICKETS_DB[key];}catch(e){}if(!t)return false;
  const total=Number(t.totalGeral||0),saldoAnterior=Number(t.saldoAnterior||0),adt=Math.max(0,Math.round(Number(totalAdvance||0)*100)/100),saldo=Math.round((total-adt+saldoAnterior)*100)/100;
  const changed=Math.abs(Number(t.adiantamento||0)-adt)>0.005||Math.abs(Number(t.saldoPagar||0)-saldo)>0.005;
  t.adiantamento=adt;t.saldoPagar=saldo;
  if(total>0)t.status=saldo<=0.009?'Pago':'Pendente';
  try{
    const cp=(CONTAS_PAGAR||[]).find(x=>String(x.ticket||'')===String(t.ticket||ticket));
    if(cp){cp.valor=Math.max(0,saldo);cp.status=saldo<=0.009?'Pago':'Pendente';if(saldo>0)cp.dataPgto='';}
    if(changed){saveContasPagar?.();saveDB?.();fbSalvarImediato?.();renderTickets?.();renderContasPagar?.();}
  }catch(e){console.warn('[phase3] atualizar adiantamento ticket',e);}
  return changed;
}
function reconcileAdvanceTicket(ticket,fallbackBase=null){
  if(!ticket)return false;
  const key=resolveTicketKey(ticket),t=key?ticketDb()[key]:null;if(!t)return false;
  let base=ticketAdvanceBase(t);
  if(base==null&&fallbackBase!=null&&Number.isFinite(Number(fallbackBase))){base=Math.max(0,Number(fallbackBase));t._phase3AdvanceBase=Math.round(base*100)/100;}
  if(base==null)return false;
  return updateTicketAdvance(ticket,base+externalAdvanceSum(ticket,t));
}
function reconcileKnownLinkedAdvances(){
  let changed=false;
  Object.values(ticketDb()).forEach(t=>{
    const ticket=String(t?.ticket||'').trim();
    if(!ticket||ticketAdvanceBase(t)==null)return;
    if(reconcileAdvanceTicket(ticket))changed=true;
  });
  return changed;
}
function scheduleAdvanceReconcile(ticket,fallbackBase=null){
  if(!ticket)return;
  [0,120,420].forEach(delay=>setTimeout(()=>reconcileAdvanceTicket(ticket,fallbackBase),delay));
}
const legacySaveAdvance=global.salvarAdiantamento;
if(typeof legacySaveAdvance==='function')global.salvarAdiantamento=function(){
  const ticket=$('#adt-ticket')?.value||'',key=resolveTicketKey(ticket),t=key?ticketDb()[key]:null,
    fallbackBase=t&&ticketAdvanceBase(t)==null?Number(t.adiantamento||0):null;
  const r=legacySaveAdvance.apply(this,arguments);
  scheduleAdvanceReconcile(ticket,fallbackBase);
  return r;
};
const legacyEditAdvance=global.editAdiantamento;
if(typeof legacyEditAdvance==='function')global.editAdiantamento=function(f,c){
  const r=legacyEditAdvance.apply(this,arguments);setTimeout(()=>enhanceAdvanceTickets(),0);return r;
};
const legacySaveEditAdvance=global.salvarEditAdiantamento;
if(typeof legacySaveEditAdvance==='function')global.salvarEditAdiantamento=function(f,c){
  let old={};try{old={...(ADT_POR_FORN[f]||[]).find(x=>x.cod===c)};}catch(e){}
  const oldTicket=old.ticket||'',newTicket=$('#ea-ticket')?.value||'',
    oldKey=resolveTicketKey(oldTicket),newKey=resolveTicketKey(newTicket),
    oldObj=oldKey?ticketDb()[oldKey]:null,newObj=newKey?ticketDb()[newKey]:null,
    oldBase=oldObj&&ticketAdvanceBase(oldObj)==null?Math.max(0,Number(oldObj.adiantamento||0)-Number(old.valor||0)):null,
    newBase=newObj&&ticketAdvanceBase(newObj)==null?Number(newObj.adiantamento||0):null;
  const r=legacySaveEditAdvance.apply(this,arguments);
  scheduleAdvanceReconcile(oldTicket,oldBase);
  if(newTicket)scheduleAdvanceReconcile(newTicket,newBase);
  return r;
};
const legacyCorrectPurchaseAdvance=global.salvarAdiantamentoCompra;
if(typeof legacyCorrectPurchaseAdvance==='function')global.salvarAdiantamentoCompra=function(){
  const raw=String($('#dc-adt-novo')?.value||'').trim(),novo=Math.max(0,Math.round(parseBR(raw)*100)/100);
  let key=resolveTicketKey(currentPurchaseTicketKey)||resolveTicketKey(String($('#dc-titulo')?.textContent||'').match(/T\d+/i)?.[0]||'');
  const t=key?ticketDb()[key]:null;
  if(!t){notify('Ticket não encontrado para corrigir o adiantamento.','error');return;}
  const ticket=String(t.ticket||key),antigo=Number(t.adiantamento||0);
  if(Math.abs(novo-antigo)<0.005){$('#dc-adt-editor')?.replaceChildren();return;}
  if(!confirm(`Trocar o adiantamento desta compra de R$ ${money(antigo)} para R$ ${money(novo)}?\n\nIsso recalcula o Saldo a Pagar e a Conta a Pagar desta compra.`))return;
  const ignoredCodes=linkedAdvanceRecords(ticket).map(a=>String(a?.cod||'').trim()).filter(Boolean);
  t._phase3AdvanceOverride={total:novo,ignoredCodes,updatedAt:new Date().toISOString()};
  t._phase3AdvanceBase=novo;
  const total=Number(t.totalGeral||0),saldoAnterior=Number(t.saldoAnterior||0);
  let cp=null;try{cp=(CONTAS_PAGAR||[]).find(x=>String(x.ticket||'')===ticket&&x.status!=='Pago')||(CONTAS_PAGAR||[]).find(x=>String(x.ticket||'')===ticket)||null;}catch(e){}
  const pago=Number(cp?.valorPago||0),saldo=Math.max(0,Math.round((total-novo+saldoAnterior-pago)*100)/100);
  t.adiantamento=novo;t.saldoPagar=saldo;if(total>0)t.status=saldo<=0.009?'Pago':'Pendente';
  if(t.reciboFinanceiro&&typeof t.reciboFinanceiro==='object')t.reciboFinanceiro.correcaoAdiantamento={de:antigo,para:novo,em:new Date().toISOString()};
  try{
    if(cp){cp.valor=saldo;cp.status=saldo<=0.009?'Pago':'Pendente';if(saldo>0)cp.dataPgto='';else if(!cp.dataPgto)cp.dataPgto=t.data||toBR(today());cp._upd=Date.now();saveContasPagar?.();}
    saveDB?.();fbSalvarImediato?.();
    registrarHistorico?.('Compra','Adiantamento corrigido',`${t.fornecedor||''} — Ticket ${ticket} — adiant. de R$ ${money(antigo)} → R$ ${money(novo)}`,null,{ticket});
    renderTickets?.();renderContasPagar?.();renderFluxo?.();renderDashboard?.();
  }catch(e){console.warn('[phase3] salvar correção de adiantamento',e);}
  notify('Adiantamento da compra corrigido e salvo.','success');
  setTimeout(()=>global.abrirDetalheCompra?.(key),40);
};

/* Contas a Pagar: calendário e vencimentos coerentes com a lista */
function payableISO(v){return toISO(v);}
function resetPayableCalendarFilters(iso){
  try{_cpFiltroTipo='todos';_cpMesFiltro='';_cpFiltroEmpresa='';_cpFiltroDia=iso||'';}catch(e){}
  ['cp-filtro-cat','cp-filtro-banco','cp-filtro-valor-min','cp-filtro-valor-max','cp-busca','cp-filtro-de','cp-filtro-ate'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const op=$('#cp-filtro-opcao');if(op)op.value='todas';
  [['cp-tipo-todos',true],['cp-tipo-compra',false],['cp-tipo-despesa',false]].forEach(([id,on])=>{const b=$('#'+id);if(!b)return;b.style.background=on?'#1a3a2a':'#fff';b.style.color=on?'#fff':'#1a3a2a';});
}
const legacyCpCalFiltrarDia=global.cpCalFiltrarDia;
if(typeof legacyCpCalFiltrarDia==='function')global.cpCalFiltrarDia=function(iso){
  resetPayableCalendarFilters(iso);
  try{renderContasPagar?.();}catch(e){}
  notify('Filtrado pelo calendário: '+toBR(iso),'info',2500);
};
function bindPayableRange(){
  ['#cp-filtro-de','#cp-filtro-ate'].forEach(sel=>{const el=$(sel);if(!el||el.dataset.p3range==='1')return;el.dataset.p3range='1';el.addEventListener('change',()=>{try{_cpMesFiltro='';_cpFiltroDia='';}catch(e){}setTimeout(()=>renderContasPagar?.(),0);});});
}
function fixPayableToday(){
  const details=$('details.phase2-cp-today'),panel=$('#cp-hoje-panel'),list=$('#cp-hoje-lista');if(!details||!panel||!list)return;
  let source=[];try{source=typeof _cpVisiveis==='function'?_cpVisiveis():(CONTAS_PAGAR||[]);}catch(e){try{source=CONTAS_PAGAR||[];}catch(_e){source=[];}}
  const now=today(),due=source.filter(c=>c&&c.status!=='Pago'&&payableISO(c.venc)===now);
  panel.style.display='block';
  if(!due.length)list.innerHTML='<div class="p3-payable-today-empty">Nenhuma conta vencendo hoje.</div>';
  const summary=details.querySelector('summary'),hint=summary?.querySelector('span');if(hint)hint.textContent=due.length?`${due.length} conta(s) · clique para ver`:'nenhuma hoje · clique para ver';
  if(summary&&summary.dataset.p3today!=='1'){
    summary.dataset.p3today='1';summary.addEventListener('click',()=>setTimeout(()=>{
      if(!details.open)return;
      let current=[];
      try{const src=typeof _cpVisiveis==='function'?_cpVisiveis():(CONTAS_PAGAR||[]);current=src.filter(c=>c&&c.status!=='Pago'&&payableISO(c.venc)===today());}catch(e){}
      if(current.length){resetPayableCalendarFilters(today());try{renderContasPagar?.();}catch(e){}details.open=true;}
      else{panel.style.display='block';list.innerHTML='<div class="p3-payable-today-empty">Nenhuma conta vencendo hoje.</div>';}
    },0));
  }
}
const legacyRenderPayables=global.renderContasPagar;
if(typeof legacyRenderPayables==='function')global.renderContasPagar=function(){
  const r=legacyRenderPayables.apply(this,arguments);setTimeout(()=>{bindPayableRange();fixPayableToday();},0);return r;
};
/* Funcionários ativos consistentes em EPI/Almox/Viagem/Coordenação */
function rebuildSelect(sel,allLabel=false,valueMode='mat'){if(!sel)return;const cur=sel.value,items=getEmployees(),sig=items.map(f=>`${f.mat}|${f.nome}|${f.status}`).join('~')+'|'+allLabel+'|'+valueMode;const actual=Array.from(sel.options).slice(allLabel||sel.options[0]?.value===''?1:0).map(o=>o.value).join('~'),expected=items.map(f=>valueMode==='nome'?(f.nome||f.mat):(f.mat||f.nome)).join('~');if(sel.dataset.p3sig===sig&&actual===expected)return;sel.innerHTML=(allLabel?'<option value="">— Todos —</option>':'<option value="">— Selecione —</option>')+items.map(f=>{const val=valueMode==='nome'?(f.nome||f.mat):(f.mat||f.nome);return `<option value="${esc(val||'')}">${esc(f.nome||'')} ${f.mat?'('+esc(f.mat)+')':''}</option>`;}).join('');sel.dataset.p3sig=sig;if(cur&&Array.from(sel.options).some(o=>o.value===cur))sel.value=cur;}
function fixOperationalEmployees(){rebuildSelect($('#p2epi-func'));rebuildSelect($('#alx-func-sel'),true);rebuildSelect($('#vg-motorista'),false,'nome');rebuildSelect($('#vg-fil-mot'),true,'nome');rebuildSelect($('#adv-mat'));const part=$('#reu-partic-list');if(part){const checked=new Set($$('input:checked',part).map(x=>x.value));part.innerHTML=getEmployees().map(f=>`<label><input type="checkbox" value="${esc(f.mat)}" ${checked.has(f.mat)?'checked':''}> ${esc(f.nome)}${f.cargo?` — <small>${esc(f.cargo)}</small>`:''}</label>`).join('');}}
/* Corrige ReferenceError data */
global.phase2EpiDeliver=function(){const mat=$('#p2epi-func')?.value||'',idx=Number($('#p2epi-item')?.value),qty=Number($('#p2epi-qtd')?.value)||0,deliveryDate=$('#p2epi-date')?.value||today(),ca=String($('#p2epi-ca')?.value||'').trim(),reason=$('#p2epi-reason')?.value||'Primeira entrega',obs=String($('#p2epi-obs')?.value||'').trim();let item=null,emp=null;try{item=ALX_ITENS?.[idx];emp=(FUNCIONARIOS||[]).find(f=>f.mat===mat);}catch(e){}if(!mat||!item){notify('Selecione funcionário e EPI.','error');return;}if(!(qty>0)||!Number.isInteger(qty)){notify('A quantidade deve ser inteira.','error');return;}const before=Number(item.qtd||0);if(qty>before){notify(`Estoque insuficiente. Disponível: ${before} ${item.un||'un'}.`,'error');return;}const movId='EPI-MOV-'+Date.now(),epiId='epi_'+Date.now();item.qtd=before-qty;try{ALX_MOV.unshift({id:movId,item:item.nome,itemId:item.id||'',tipo:'saida',qtd:qty,data:deliveryDate,mat:mat,resp:emp?.nome||mat,obs:'Entrega de EPI'+(obs?' — '+obs:''),origem:'EPI',epiId:epiId,before:before,after:item.qtd,ts:new Date().toISOString()});EPI_DB.push({id:epiId,mat:mat,data:toBR(deliveryDate),epi:item.nome,qtd:qty,atividade:'',risco:'',ca:ca,motivo:reason+(obs?' — '+obs:''),_almoxMovId:movId});saveAlmoxa?.();saveEpi?.();alxRenderItens?.();renderEpi?.();notify('Entrega registrada. O estoque foi baixado uma única vez.','success');phase2AlxEpiOpen?.(mat);}catch(e){console.error(e);notify('Não foi possível registrar a entrega: '+e.message,'error',7000);}};

/* Frota: revisão como data e filtro confiável */
function dateValue(v){const s=toISO(v);return s||'';}
function patchMaintenanceModal(){[['#nm-rev','#nm-status'],['#em-rev','#em-status']].forEach(([rev])=>{const el=$(rev);if(el&&el.type!=='date'){const val=dateValue(el.value);el.type='date';el.placeholder='';if(val)el.value=val;const label=el.closest('.fg')?.querySelector('label');if(label)label.textContent='Próxima revisão (data)';}});}
const legacyNewMaint=global.abrirNovaManutencao;if(typeof legacyNewMaint==='function')global.abrirNovaManutencao=function(){const r=legacyNewMaint.apply(this,arguments);setTimeout(patchMaintenanceModal,0);return r;};
const legacyEditMaint=global.editManutencao;if(typeof legacyEditMaint==='function')global.editManutencao=function(){const r=legacyEditMaint.apply(this,arguments);setTimeout(patchMaintenanceModal,0);return r;};
global.phase2FrotaFilter=function(){const q=norm($('#p2-frota-search')?.value||''),st=norm($('#p2-frota-status')?.value||'');$$('.phase2-maint-card').forEach(c=>{const text=norm(c.dataset.search||c.textContent),cs=norm(c.dataset.status||'');c.style.display=((q&&!text.includes(q))||(st&&cs!==st))?'none':'';});};
function bindMaintFilter(){const q=$('#p2-frota-search'),s=$('#p2-frota-status');[q,s].forEach(el=>{if(el&&!el.dataset.p3){el.dataset.p3='1';el.addEventListener(el===q?'input':'change',()=>global.phase2FrotaFilter());}});}

/* Viagem: só ativos + gastos extras realmente editáveis */
function patchTripEdit(){
  const modal=$('#modal-edit-viagem');if(!modal||!$('#vg-edit-motorista'))return;
  rebuildSelect($('#vg-edit-motorista'),false,'nome');
  let row=$('#p3-vg-edit-extra-row');
  if(!row){
    const obs=$('#vg-edit-obs'),grid=obs?.parentElement?.parentElement;
    row=document.createElement('div');row.id='p3-vg-edit-extra-row';row.className='p3-trip-edit-extra';
    row.innerHTML='<label>Gastos extras / supérfluos aprovados R$</label><input id="p3-vg-edit-extra" inputmode="decimal" placeholder="0,00">';
    if(grid)grid.insertAdjacentElement('afterend',row);
    else modal.querySelector('#vg-edit-dias-wrap')?.insertAdjacentElement('beforebegin',row);
  }
  try{
    const id=$('#vg-edit-id')?.value,v=(VIAGEM_DB||[]).find(x=>String(x.id)===String(id));
    if(v&&$('#p3-vg-edit-extra'))$('#p3-vg-edit-extra').value=money(v.gastosExtras||0);
  }catch(e){}
}
const legacyEditTrip=global.editViagem;
if(typeof legacyEditTrip==='function')global.editViagem=function(){
  const r=legacyEditTrip.apply(this,arguments);setTimeout(patchTripEdit,0);return r;
};
const legacySaveEditTrip=global.salvarEditViagem;
if(typeof legacySaveEditTrip==='function')global.salvarEditViagem=function(){
  const id=$('#vg-edit-id')?.value,extraEl=$('#p3-vg-edit-extra'),extra=extraEl?parseBR(extraEl.value):null;
  const r=legacySaveEditTrip.apply(this,arguments);
  if(extra!==null)setTimeout(()=>{
    try{
      const v=(VIAGEM_DB||[]).find(x=>String(x.id)===String(id));
      if(v){v.gastosExtras=extra;saveDB?.();renderViagens?.();}
    }catch(e){}
  },80);
  return r;
};

/* Fiscal + Vendas + Contas a Receber: vínculo explícito */
let fiscalLinks={};async function loadFiscalLinks(){if(!store)return;fiscalLinks=await store.load('fiscalLinks',{});decorateReceivables();}
function parseCurrencyText(v){return parseBR(String(v||'').replace('R$',''));}
function findReceivableForRow(row){const cells=row.cells;if(!cells||cells.length<10)return null;const date=String(cells[0]?.textContent||'').trim(),nf=String(cells[1]?.textContent||'').trim(),cli=String(cells[2]?.textContent||'').trim(),val=parseCurrencyText(cells[3]?.textContent),venc=String(cells[6]?.textContent||'').trim();try{return (CONTAS_RECEBER||[]).find(c=>String(fmtDate?fmtDate(c.data):toBR(c.data)).trim()===date&&String(c.cli||'').trim()===cli&&Math.abs(Number(c.valor||0)-val)<0.01&&String(fmtDate?fmtDate(c.venc):toBR(c.venc)).trim()===venc&&(nf==='—'||String(c.nf||'—').trim()===nf));}catch(e){return null;}}
function decorateReceivables(){const tab=$('#tab-contas_receber');if(!tab)return;let note=$('#p3-cr-fiscal-note');if(!note){note=document.createElement('div');note.id='p3-cr-fiscal-note';note.className='p3-cr-fiscal-note';note.innerHTML='<b>Fluxo consolidado</b><span><strong>Venda</strong> gera Conta a Receber. A Conta a Receber pode ser ligada ao <strong>Cliente Fiscal</strong> para emissão/controle fiscal, mantendo os cadastros Comercial e Fiscal separados.</span>';tab.querySelector('.kpi-grid')?.insertAdjacentElement('afterend',note);}const body=$('#tb-contas-receber');if(!body)return;Array.from(body.rows).forEach(row=>{if(row.querySelector('.p3-fiscal-link-btn'))return;const cr=findReceivableForRow(row);if(!cr)return;const cell=row.cells[row.cells.length-1],id=String(cr.id||CONTAS_RECEBER.indexOf(cr));const b=document.createElement('button');b.className='p3-fiscal-link-btn';b.textContent=cr.fiscalPartyId?'🧾 Fiscal ✓':'🧾 Fiscal';b.title='Vincular este recebimento ao Cliente Fiscal';b.onclick=()=>phase3ReceivableFiscal(id);cell.prepend(b);});}
global.phase3ReceivableFiscal=async function(id){let cr;try{cr=(CONTAS_RECEBER||[]).find((x,i)=>String(x.id||i)===String(id));}catch(e){}if(!cr||!store)return;const raw=await store.load('fiscalParties',{}),parties=Object.values(raw||{});const current=fiscalLinks[String(id)]||{};const body=$('#modal-body');if(!body)return;body.className='modal';body.innerHTML=`<h3>🧾 Vínculo fiscal da Conta a Receber</h3><p class="p3-help">Comercial e Fiscal continuam independentes. Aqui você relaciona este lançamento ao cadastro fiscal correto.</p><div class="fg"><label>Cliente comercial</label><input disabled value="${esc(cr.cli||cr.cliente||'')}"></div><div class="fg"><label>Cliente Fiscal</label><select id="p3-cr-fiscal-party"><option value="">— Selecione —</option>${parties.filter(x=>norm(x.kind||x.type||'').includes('cliente')).map(x=>`<option value="${esc(x.id)}" ${current.fiscalPartyId===x.id?'selected':''}>${esc(x.legalName||x.name)} · ${esc(x.cnpj||x.cpf||'')}</option>`).join('')}</select></div><div class="fg"><label>Nº NF / Pedido</label><input id="p3-cr-fiscal-nf" value="${esc(current.nf||cr.nf||'')}"></div><div class="modal-ft"><button onclick="cm()">Cancelar</button><button class="btn-save" onclick="phase3ReceivableFiscalSave('${esc(cr.id||id)}')">Salvar vínculo</button></div>`;$('#modal-ov')?.classList.add('open');};
global.phase3ReceivableFiscalSave=async function(id){if(!store)return;const partyId=$('#p3-cr-fiscal-party')?.value;if(!partyId){notify('Selecione o Cliente Fiscal.','error');return;}const link={id:String(id),fiscalPartyId:partyId,nf:$('#p3-cr-fiscal-nf')?.value.trim()||'',updatedAt:new Date().toISOString()};fiscalLinks[String(id)]=link;await store.save('fiscalLinks',String(id),link);try{const cr=(CONTAS_RECEBER||[]).find((x,i)=>String(x.id||i)===String(id));if(cr){cr.fiscalPartyId=partyId;if(link.nf)cr.nf=link.nf;saveContasReceber?.();}}catch(e){}cm();decorateReceivables();notify('Vínculo fiscal salvo.','success');};

/* Casa Glória: remover de verdade */
function removeCasaGloria(){let changed=false;try{Object.keys(CUSTO_CASA||{}).forEach(m=>(CUSTO_CASA[m]||[]).forEach(x=>{if(norm(x.area)==='casa gloria'){x.area='Casa';changed=true;}}));}catch(e){}const tab=$('#tab-custo_casa');if(tab){$$('button,[role="tab"],.cc-area-tab',tab).forEach(el=>{const txt=norm(el.textContent),id=norm(el.id),data=norm(el.dataset?.ccArea||'');if(txt==='casa gloria'||id.includes('casa gloria')||data==='casa gloria')el.remove();});}if(changed){try{saveCustoCasa?.();}catch(e){}}const note=$('#phase1-house-history-note');if(note&&note.textContent!=='Histórico preservado por período. Casa, Sítio e Veículos Pessoais permanecem separados.')note.textContent='Histórico preservado por período. Casa, Sítio e Veículos Pessoais permanecem separados.';}

/* Coordenação: reconstruir participantes/advertência com todos ativos */
function fixCoordination(){
  const employees=getEmployees(),desired=employees.map(f=>String(f.mat)).join('|');
  const part=$('#reu-partic-list');
  if(part){
    part.classList.add('p3-coord-participants');
    const actual=$$('input[type=checkbox]',part).map(x=>x.value).join('|');
    if(actual!==desired){
      const selected=new Set($$('input:checked',part).map(x=>x.value));
      part.innerHTML=employees.map(f=>`<label class="p3-coord-person"><input type="checkbox" value="${esc(f.mat)}" ${selected.has(f.mat)?'checked':''}><span><b>${esc(f.nome)}</b>${f.mat?`<small>${esc(f.mat)}</small>`:''}${f.cargo?`<em>${esc(f.cargo)}</em>`:''}</span></label>`).join('');
    }else{
      $$('label',part).forEach(x=>x.classList.add('p3-coord-person'));
    }
  }
  const adv=$('#adv-mat');
  if(adv){
    const actual=Array.from(adv.options).slice(1).map(o=>o.value).join('|');
    if(actual!==desired){
      const cur=adv.value;
      adv.innerHTML='<option value="">— Selecione —</option>'+employees.map(f=>`<option value="${esc(f.mat)}">${esc(f.nome)} (${esc(f.mat)})</option>`).join('');
      if(cur&&Array.from(adv.options).some(o=>o.value===cur))adv.value=cur;
    }
  }
  const type=$('#reu-tipo');
  if(type&&type.options.length<5)type.innerHTML='<option value="reuniao">Reunião</option><option value="dds">DDS — Diálogo Diário de Segurança</option><option value="treinamento">Treinamento</option><option value="inspecao">Inspeção / Segurança</option><option value="outro">Outro</option>';
}

/* Aplicação recorrente */
function apply(){captureTicketMappings();decoratePartyBanks();fixPriceSearches();decorateCheque();enhanceAdvanceTickets();reconcileKnownLinkedAdvances();bindPayableRange();fixPayableToday();fixOperationalEmployees();patchMaintenanceModal();bindMaintFilter();removeCasaGloria();fixCoordination();decorateReceivables();hideLegacyCalendarUi();const owner=$('#phase2-owner-bills');if(owner&&owner.offsetParent!==null&&owner.dataset.p3owner!=='1')renderOwnerBillsV3();if($('#tab-afazeres')&&!$('#phase3-calendar'))renderCalendar();}
if(global.Phase1Dom)global.Phase1Dom.register(apply);else setInterval(apply,1200);
setTimeout(()=>{loadPartyBanks();loadCalendar();loadOwnerBills();loadFiscalLinks();apply();},650);
document.addEventListener('erp:user-started',()=>setTimeout(()=>{apply();checkCalendarPopups();refreshAvisos();},900));

global.Phase3Homologation=Object.freeze({resolveTicketKey,activeEmployee,advanceSumForTicket,chequeSequence,apply});
})(window);
