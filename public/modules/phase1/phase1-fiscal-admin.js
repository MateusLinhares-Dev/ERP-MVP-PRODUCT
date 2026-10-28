(function(global){
'use strict';
const store=global.Phase1Store;let fiscalParties={},docCategories={};const defaults=['Contrato','NF / Nota Fiscal','Alvará','Certidão','Procuração','Foto','Outros'];defaults.forEach(name=>{const id=name.toUpperCase();docCategories[id]={id,name};});
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
let fiscalPartyLoadId=0;
async function initFiscalParties(){
  const seq=++fiscalPartyLoadId;
  try{
    // Ao voltar à aba, consultar a fonte atual: Phase1Store mantém cache e a
    // primeira leitura pode ocorrer antes de o Firebase terminar a sincronização.
    const raw=global._fbDB;
    const value=raw ? (await raw.ref('erp/fiscalParties').once('value')).val() : (await store?.load('fiscalParties',{}));
    if(seq!==fiscalPartyLoadId)return;
    fiscalParties=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    renderFiscalParties();
  }catch(error){
    console.warn('[Fiscal] Falha ao atualizar cadastros fiscais:',error);
    const host=document.getElementById('phase1-fiscal-party-list');
    if(host)host.textContent='Não foi possível consultar os cadastros fiscais. Tente novamente.';
  }
}
global.phase1FiscalPartiesReload=initFiscalParties;
function ensureFiscalParties(){const tab=document.getElementById('tab-fiscal');if(!tab||document.getElementById('phase1-fiscal-parties'))return;const title=tab.querySelector('.sec-title');const card=document.createElement('details');card.id='phase1-fiscal-parties';card.className='phase1-admin-card';card.innerHTML=`<summary>🧾 Cadastros Fiscais independentes</summary><div class="phase1-fiscal-form"><select id="phase1-fiscal-party-type"><option>Cliente Fiscal</option><option>Fornecedor Fiscal</option></select><input id="phase1-fiscal-party-name" placeholder="Nome / Razão social"><button onclick="phase1FiscalPartySave()">＋ Cadastrar</button></div><div class="phase1-note">Os campos fiscais adicionais não foram inferidos: permanecem aguardando AD-02.</div><div id="phase1-fiscal-party-list"></div>`;title.insertAdjacentElement('afterend',card);initFiscalParties();}
global.phase1FiscalPartySave=async function(){const type=document.getElementById('phase1-fiscal-party-type')?.value||'Cliente Fiscal',name=String(document.getElementById('phase1-fiscal-party-name')?.value||'').trim();if(!name)return;const id=store.id('FIS');const item={id,type,name,active:true,createdAt:new Date().toISOString()};fiscalParties[id]=item;await store.save('fiscalParties',id,item);document.getElementById('phase1-fiscal-party-name').value='';renderFiscalParties();};
global.phase1FiscalPartyToggle=async function(id){const item=fiscalParties[id];if(!item)return;item.active=!item.active;await store.save('fiscalParties',id,item);renderFiscalParties();};
function renderFiscalParties(){const host=document.getElementById('phase1-fiscal-party-list');if(!host)return;const arr=Object.values(fiscalParties||{}).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));host.innerHTML=arr.length?arr.map(x=>`<div class="phase1-fiscal-party-row ${x.active?'':'inactive'}"><span>${esc(x.type)}</span><b>${esc(x.name)}</b><button onclick="phase1FiscalPartyToggle('${x.id}')">${x.active?'Inativar':'Ativar'}</button></div>`).join(''):'<div class="phase1-empty">Nenhum cadastro fiscal próprio.</div>';}
async function initCategories(){if(!store)return;docCategories=await store.load('documentCategories',{});defaults.forEach(name=>{const id=name.toUpperCase();if(!docCategories[id])docCategories[id]={id,name};});renderDocCategories();}
function categoryNames(){return Object.values(docCategories||{}).map(x=>x.name).filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR'));}
function renderDocCategories(){const select=document.getElementById('de-cat-sel');if(select){const cur=select.value;select.innerHTML=categoryNames().map(x=>`<option>${esc(x)}</option>`).join('');if(cur&&categoryNames().includes(cur))select.value=cur;}const filter=document.getElementById('de-filtro-cat');if(filter){const cur=filter.value;filter.innerHTML='<option value="">Todas as categorias</option>'+categoryNames().map(x=>`<option>${esc(x)}</option>`).join('');if(cur)filter.value=cur;}}
global.phase1DocNewCategory=async function(){const name=String(prompt('Nome da nova categoria de documento:','')||'').trim();if(!name)return;const id=name.toUpperCase().replace(/[^A-Z0-9]+/g,'_');const item={id,name,createdAt:new Date().toISOString()};docCategories[id]=item;if(store)await store.save('documentCategories',id,item);renderDocCategories();const sel=document.getElementById('de-cat-sel');if(sel)sel.value=name;};
function enhanceDocModal(){const select=document.getElementById('de-cat-sel');if(!select)return;renderDocCategories();if(document.getElementById('phase1-doc-cat-add'))return;const button=document.createElement('button');button.id='phase1-doc-cat-add';button.type='button';button.className='phase1-doc-cat-add';button.textContent='＋ Nova categoria';button.onclick=global.phase1DocNewCategory;select.insertAdjacentElement('afterend',button);}
const originalNewDoc=global.deNovoDoc;if(typeof originalNewDoc==='function')global.deNovoDoc=function(){const result=originalNewDoc.apply(this,arguments);setTimeout(enhanceDocModal,0);return result;};
function addSearch(tabId,targetSelector,placeholder){const tab=document.getElementById(tabId);const target=tab?.querySelector(targetSelector);if(!tab||!target||tab.querySelector('.phase1-admin-search'))return;const input=document.createElement('input');input.className='phase1-admin-search';input.placeholder=placeholder;input.oninput=function(){const q=this.value.trim().toLowerCase();target.querySelectorAll('tbody tr').forEach(row=>{row.style.display=!q||String(row.textContent||'').toLowerCase().includes(q)?'':'none';});};target.insertAdjacentElement('beforebegin',input);}
function ensureAdminFilters(){addSearch('tab-contratos','table','🔍 Buscar contrato, fornecedor ou identificação...');addSearch('tab-lista_compras','table','🔍 Buscar no histórico da lista...');addSearch('tab-custo_casa','table','🔍 Buscar despesa...');const tab=document.getElementById('tab-despesas_grupo');if(tab&&!document.getElementById('phase1-desp-search')){const input=document.createElement('input');input.id='phase1-desp-search';input.className='phase1-admin-search';input.placeholder='🔍 Buscar descrição, fornecedor, empresa/grupo...';input.oninput=function(){const q=this.value.toLowerCase();tab.querySelectorAll('tbody tr').forEach(row=>row.style.display=!q||row.textContent.toLowerCase().includes(q)?'':'none');};tab.querySelector('.sec-title')?.insertAdjacentElement('afterend',input);}const coord=document.getElementById('tab-coordenacao');if(coord&&!document.getElementById('phase1-coord-month')){const bar=document.createElement('div');bar.className='phase1-coord-filter';bar.innerHTML='<label>Período <input type="month" id="phase1-coord-month" oninput="phase1CoordFilter()"></label><input id="phase1-coord-search" placeholder="🔍 Buscar em Coordenação..." oninput="phase1CoordFilter()">';coord.querySelector('.sec-title')?.insertAdjacentElement('afterend',bar);}}
global.phase1CoordFilter=function(){const month=document.getElementById('phase1-coord-month')?.value||'',q=String(document.getElementById('phase1-coord-search')?.value||'').toLowerCase();document.querySelectorAll('#reu-lista>div,#adv-lista>div,#bags-hist>div').forEach(card=>{const text=String(card.textContent||'').toLowerCase();let ok=!q||text.includes(q);if(ok&&month){const [y,m]=month.split('-'),pattern=new RegExp(`(?:${m}/${y}|${y}-${m})`);ok=pattern.test(text);}card.style.display=ok?'':'none';});};
function ensureCostHousePeriod(){const table=document.getElementById('tb-custo-casa')?.closest('table');if(!table||document.getElementById('phase1-house-history-note'))return;const note=document.createElement('div');note.id='phase1-house-history-note';note.className='phase1-note';note.textContent='Histórico preservado por área e período. Use o mês de referência acima para consultar Casa, Sítio, Casa Glória e Veículos Pessoais separadamente.';table.insertAdjacentElement('beforebegin',note);}
function ensureListHistoryLabel(){const select=document.getElementById('lc-filtro');if(!select)return;Array.from(select.options).forEach(o=>{if(o.value==='comprado')o.textContent='Histórico / Comprados';});}
function apply(){ensureFiscalParties();renderDocCategories();ensureAdminFilters();ensureCostHousePeriod();ensureListHistoryLabel();}
if(global.Phase1Dom)global.Phase1Dom.register(apply);setTimeout(()=>{initCategories();apply();},250);
})(window);
(function (global) {
  'use strict';
  // Apresentação somente. Os IDs, handlers e formulários fiscais originais são preservados.
  const $ = (selector, root = document) => root.querySelector(selector);
  const PANELS = ['mensal', 'anual', 'impostos', 'apuracao'];
  let currentArea = 'lancamentos';
  let currentReport = 'impostos';
  let relocating = false;

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function callFiscalPanel(name) {
    // Chama a rotina legada, que mantém os cálculos e o carregamento de cada seção.
    if (typeof global.fiscalSubTab === 'function') global.fiscalSubTab(name);
    else PANELS.forEach(p => {
      const el = $('#fiscal-panel-' + p);
      if (el) el.style.display = p === name ? '' : 'none';
    });
  }

  function setArea(area, report) {
    const root = $('#fiscal-workspace');
    if (!root) return;
    currentArea = ['lancamentos', 'apuracao', 'cadastros','xml','estoque-inicial','devolucoes','documentos','custos-rh'].includes(area) ? area : 'lancamentos';
    if (report && ['anual', 'impostos', 'apuracao'].includes(report)) currentReport = report;
    root.querySelectorAll('[data-fiscal-area]').forEach(btn => {
      const active = btn.dataset.fiscalArea === currentArea;
      btn.classList.toggle('is-current', active);
      btn.setAttribute('aria-selected', String(active));
      btn.tabIndex = active ? 0 : -1;
    });
    root.querySelectorAll('[data-fiscal-view]').forEach(panel => {
      const visible = panel.dataset.fiscalView === currentArea;
      panel.hidden = !visible;
      panel.style.display = visible ? '' : 'none';
    });
    const onReports = currentArea === 'apuracao';
    if (onReports) callFiscalPanel(currentReport);
    else if (currentArea === 'lancamentos') callFiscalPanel('mensal');
    root.querySelectorAll('[data-fiscal-report]').forEach(btn => {
      const active = btn.dataset.fiscalReport === currentReport;
      btn.classList.toggle('is-current', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    if(currentArea==='cadastros')global.phase1FiscalPartiesReload?.();
    global.FiscalExtensions?.onAreaChange(currentArea);
    // Não alteramos empresa, competência ou estado das notas ao trocar de área.
  }

  function relocateRegistry() {
    const target = $('#fiscal-workspace-registry');
    const reg = $('#phase1-fiscal-parties');
    if (!target || !reg || reg.parentNode === target || relocating) return;
    relocating = true;
    try {
      target.appendChild(reg);
      reg.open = true;
    } finally { relocating = false; }
  }

  function decorateCompanyButtons() {
    const bar = $('#fiscal-workspace .fis-work-company');
    if (!bar) return;
    const originalLabel = Array.from(bar.children).find(el =>
      el.tagName === 'SPAN' && /^empresa\s*:/i.test(el.textContent || ''));
    if (originalLabel) originalLabel.remove();
    const labels = {manuela:'Manuela Metais', gratus:'Gratus Metais'};
    bar.querySelectorAll('[data-fiscal-company]').forEach(btn => {
      if (!btn.textContent.trim()) btn.textContent = labels[btn.dataset.fiscalCompany] || btn.dataset.fiscalCompany;
      btn.addEventListener('click', () => {
        bar.querySelectorAll('[data-fiscal-company]').forEach(b =>
          b.classList.toggle('is-selected', b === btn));
      });
    });
    const badge = $('#fiscal-emp-badge');
    const selected = /gratus/i.test(badge?.textContent || '') ? 'gratus' : 'manuela';
    bar.querySelectorAll('[data-fiscal-company]').forEach(b =>
      b.classList.toggle('is-selected', b.dataset.fiscalCompany === selected));
  }

  function replaceSubtabs() {
    const origin = $('#fmtab-btn-entradas')?.parentElement;
    if (!origin || origin.classList.contains('fis-work-subtabs')) return;
    origin.classList.add('fis-work-subtabs');
    const btnLabels = {entradas:'Entradas',saidas:'Saídas',despesas:'Despesas',resumo:'Resumo',importar:'Importar',estoque:'Estoque'};
    Object.entries(btnLabels).forEach(([key, label]) => {
      const btn = $('#fmtab-btn-' + key);
      if (btn) btn.textContent = label;
    });
    const heading = node('div', 'fis-work-inline-label', 'Tipo de lançamento');
    origin.prepend(heading);
    const more = node('details', 'fis-work-more');
    const summary = node('summary', '', 'Ferramentas fiscais');
    more.appendChild(summary);
    const content = node('div', 'fis-work-more-items');
    more.appendChild(content);
    ['importar', 'estoque'].forEach(name => {
      const btn = $('#fmtab-btn-' + name);
      if (btn) {
        btn.addEventListener('click', () => {
          more.open = false;
          const indicator = $('#fis-work-current-tool');
          if (indicator) indicator.textContent = name === 'importar' ? 'Importação' : 'Estoque fiscal';
        });
        content.appendChild(btn);
      }
    });
    origin.appendChild(more);
    const indicator = node('span', 'fis-work-tool-indicator');
    indicator.id = 'fis-work-current-tool';
    origin.appendChild(indicator);
    ['entradas', 'saidas', 'despesas', 'resumo'].forEach(name => {
      $('#fmtab-btn-' + name)?.addEventListener('click', () => {
        indicator.textContent = '';
        more.open = false;
      });
    });
  }

  function install() {
    const tab = $('#tab-fiscal');
    if (!tab || $('#fiscal-workspace')) return;
    const monthly = $('#fiscal-panel-mensal');
    const companyButton = $('#fiscal-emp-manuela');
    const originalTabs = $('#fiscal-btn-mensal');
    const periodMonth = $('#fiscal-sel-mes');
    if (!monthly || !companyButton || !originalTabs || !periodMonth) return;

    const title = tab.querySelector(':scope > .sec-title');
    const originalCompanyBar = companyButton.parentElement;
    const originalTabBar = originalTabs.parentElement;
    const originalPeriodBar = periodMonth.parentElement;

    const shell = node('section', 'fis-workspace');
    shell.id = 'fiscal-workspace';
    const header = node('header', 'fis-work-header');
    const heading = node('div');
    heading.append(node('h2', '', 'Gestão fiscal'), node('p', '', 'Notas, conferência e fechamento por empresa e competência.'));
    header.appendChild(heading);
    shell.appendChild(header);

    const context = node('div', 'fis-work-context');
    originalCompanyBar.classList.add('fis-work-company');
    originalCompanyBar.removeAttribute('style');
    const companyLabel = node('div', 'fis-work-inline-label', 'Empresa');
    context.append(companyLabel, originalCompanyBar);

    originalPeriodBar.classList.add('fis-work-period');
    originalPeriodBar.removeAttribute('style');
    // Controles de fechamento e exportação têm sua própria área, não ficam entre os filtros.
    const closingButtons = ['fiscal-btn-fechar', 'fiscal-btn-reabrir']
      .map(id => $('#' + id)).filter(Boolean);
    const exportButtons = Array.from(originalPeriodBar.querySelectorAll('button'))
      .filter(btn => /fiscalExportarPDF|fiscalExportarXML/.test(btn.getAttribute('onclick') || ''));
    const filler = originalPeriodBar.querySelector('div[style*="flex:1"]');
    if (filler) filler.remove();
    context.append(node('div', 'fis-work-inline-label', 'Competência'), originalPeriodBar);
    shell.appendChild(context);

    const nav = node('div', 'fis-work-mainnav');
    nav.setAttribute('role', 'tablist');
    const primaryNav = node('div','fis-work-navrow');
    primaryNav.append(node('span','fis-work-navlabel','Principal'));
    nav.append(primaryNav);
    const sections = [
      ['lancamentos', 'Lançamentos'],
      ['apuracao', 'Apuração e fechamento'],
      ['cadastros', 'Cadastros fiscais']
    ];
    sections.forEach(([area, label]) => {
      const btn = node('button', 'fis-work-mainbutton', label);
      btn.type = 'button';
      btn.dataset.fiscalArea = area;
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => setArea(area));
      primaryNav.appendChild(btn);
    });
    const extraNav=node('div','fis-work-navrow fis-work-nav-extra');
    extraNav.append(node('span','fis-work-navlabel','Ferramentas')) ;
    nav.append(extraNav);
    shell.appendChild(nav);

    // Mantém os botões legados no DOM (usados por funções antigas), mas evita navegação duplicada.
    originalTabBar.classList.add('fis-work-original-tabs');
    originalTabBar.hidden = true;
    originalTabBar.setAttribute('aria-hidden', 'true');
    shell.appendChild(originalTabBar);

    const launch = node('section', 'fis-work-view');
    launch.dataset.fiscalView = 'lancamentos';
    const description = node('div', 'fis-work-view-title');
    description.append(node('h3', '', 'Movimentações do mês'), node('p', '', 'Consulte e registre notas de entrada, saída e despesas.'));
    launch.append(description, monthly);
    const exports = node('details', 'fis-work-exports');
    exports.appendChild(node('summary', '', 'Exportar documentos do mês'));
    const exportActions = node('div', 'fis-work-exports-actions');
    exportButtons.forEach(btn => exportActions.appendChild(btn));
    exports.appendChild(exportActions);
    launch.appendChild(exports);
    shell.appendChild(launch);

    const closing = node('section', 'fis-work-view');
    closing.dataset.fiscalView = 'apuracao';
    const cHeader = node('div', 'fis-work-view-title');
    cHeader.append(node('h3', '', 'Apuração e fechamento'), node('p', '', 'Confira o período, os impostos e os demonstrativos antes de encerrar a competência.'));
    closing.appendChild(cHeader);
    const closeBox = node('div', 'fis-work-close-box');
    closeBox.append(node('div', 'fis-work-close-info', 'Fechamento da competência selecionada'));
    const closeBtns = node('div', 'fis-work-close-actions');
    closingButtons.forEach(btn => closeBtns.appendChild(btn));
    closeBox.appendChild(closeBtns);
    closing.appendChild(closeBox);
    const reportNav = node('div', 'fis-work-reportnav');
    [['impostos', 'Impostos'], ['apuracao', 'Apuração / Lucro'], ['anual', 'Resumo anual']].forEach(([report, label]) => {
      const btn = node('button', '', label);
      btn.type = 'button';
      btn.dataset.fiscalReport = report;
      btn.addEventListener('click', () => setArea('apuracao', report));
      reportNav.appendChild(btn);
    });
    closing.appendChild(reportNav);
    ['impostos', 'apuracao', 'anual'].forEach(name => {
      const p = $('#fiscal-panel-' + name);
      if (p) closing.appendChild(p);
    });
    shell.appendChild(closing);

    const directory = node('section', 'fis-work-view');
    directory.dataset.fiscalView = 'cadastros';
    const dHeader = node('div', 'fis-work-view-title');
    dHeader.append(node('h3', '', 'Cadastros fiscais'), node('p', '', 'Clientes e fornecedores usados nos documentos fiscais.'));
    directory.appendChild(dHeader);
    const directoryHost = node('div', 'fis-work-registry');
    directoryHost.id = 'fiscal-workspace-registry';
    directory.appendChild(directoryHost);
    const userAction = Array.from(monthly.querySelectorAll('button')).find(b => /fiscalAdicionarUsuario\(\)/.test(b.getAttribute('onclick') || ''));
    if (userAction) {
      const footer = node('div', 'fis-work-admin-actions');
      userAction.textContent = 'Usuários fiscais';
      footer.appendChild(userAction);
      directory.appendChild(footer);
    }
    shell.appendChild(directory);
    if (title) {
      title.classList.add('fis-work-legacy-title');
      title.insertAdjacentElement('afterend', shell);
    } else tab.prepend(shell);

    replaceSubtabs();
    decorateCompanyButtons();
    relocateRegistry();
    // Os controles da extensão precisam estar montados no document antes dos querySelector.
    // Caso contrário, o init interrompe e todas as áreas ficam abertas.
    try { global.FiscalExtensions?.install(shell); } catch (error) { console.error('[Fiscal] montagem das áreas adicionais',error); }
    setArea('lancamentos');
    const observer = new MutationObserver(() => relocateRegistry());
    observer.observe(tab, {childList: true, subtree: true});
  }

  // O cabeçalho da impressão não pode assumir a empresa principal nem depender de
  // um botão que o legado recria ao alternar Manuela/Gratus.
  const legacyFiscalCompanySetter = global.fiscalSetEmpresa;
  if (typeof legacyFiscalCompanySetter === 'function') {
    global.fiscalSetEmpresa = function(company) {
      const result = legacyFiscalCompanySetter.apply(this, arguments);
      if (company === 'manuela' || company === 'gratus') global.FiscalWorkspaceSelectedCompany = company;
      return result;
    };
  }
  function selectedFiscalCompany() {
    if (['manuela','gratus'].includes(global.FiscalWorkspaceSelectedCompany))
      return global.FiscalWorkspaceSelectedCompany;
    const badge = $('#fiscal-emp-badge')?.textContent || '';
    if (/gratus/i.test(badge)) return 'gratus';
    if (/manuela/i.test(badge)) return 'manuela';
    const current = typeof global._fiscalEnsureEmpresa === 'function' ? global._fiscalEnsureEmpresa() : '';
    return ['manuela','gratus'].includes(current) ? current : 'manuela';
  }
  function printEscape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g,
      c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function fiscalReportMarkup(info, data, company) {
    const money = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    const sum = n => Number(n.valorTotal || 0) || (n.itens || []).reduce((t,i)=>t+Number(i.valor || 0),0);
    const table = (title, rows, person, heading) => {
      if (!rows.length) return '';
      const total = rows.reduce((t,n)=>t+sum(n),0);
      return `<h2>${printEscape(title)}</h2><table><thead><tr><th>Data</th><th>Nº NF</th><th>${heading}</th><th>Material</th><th class="numeric">Kg</th><th class="numeric">Valor</th></tr></thead><tbody>` +
        rows.map(n=>`<tr><td>${printEscape(n.data)}</td><td>${printEscape(n.num)}</td><td>${printEscape(n[person])}</td><td>${printEscape((n.itens||[]).map(i=>i.produto||'').join(', '))}</td><td class="numeric">${(n.itens||[]).reduce((a,i)=>a+Number(i.kg||0),0).toLocaleString('pt-BR',{maximumFractionDigits:3})}</td><td class="numeric">${money(sum(n))}</td></tr>`).join('')+
        `</tbody><tfoot><tr><td colspan="5" class="numeric">Total</td><td class="numeric">${money(total)}</td></tr></tfoot></table>`;
    };
    const label = company === 'gratus' ? 'Gratus Metais' : 'Manuela Metais';
    const logo = company === 'manuela'
      ? '<img src="/assets/branding/manuela-metais-logo.webp" alt="Manuela Metais" class="company-logo">' : '';
    const totalEntradas = data.ent.reduce((t,n)=>t+sum(n),0);
    const totalSaidas = data.sai.reduce((t,n)=>t+sum(n),0);
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Fiscal — ${printEscape(label)} — ${printEscape(info.label)}</title>
<style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:20px;color:#1e2923;font-size:11px;}
header{display:flex;gap:20px;align-items:center;justify-content:space-between;border-bottom:2px solid #174b32;padding:0 0 16px;margin-bottom:22px;min-height:77px}
.company-logo{width:90px;max-height:75px;object-fit:contain}.company-name{font-size:21px;font-weight:700;color:#174b32}.period{font-size:13px;color:#56685a;margin-top:6px}
h2{font-size:14px;color:#174b32;margin:23px 0 9px;}table{border-collapse:collapse;width:100%;table-layout:fixed;margin-bottom:15px;}th,td{border:1px solid #d4ded8;padding:7px 8px;text-align:left;vertical-align:top;word-break:break-word;}th{background:#eef4ef}td.numeric,th.numeric{text-align:right;white-space:nowrap;}tfoot{font-weight:700;background:#f6faf6;}footer{border-top:1px solid #d7e3da;padding-top:12px;margin-top:22px;}@media print{body{padding:0}tr{break-inside:avoid}}
</style></head><body><header>${logo}<div><div class="company-name">${printEscape(label)}</div><div class="period">Relatório Fiscal — ${printEscape(info.label)}</div></div></header>`+
      table('Entradas — Notas de compra',data.ent,'fornecedor','Fornecedor')+
      table('Saídas — Notas de venda / despesa',data.sai,'cliente','Cliente')+
      `<footer><strong>Resultado do mês:</strong> Entradas ${money(totalEntradas)} · Saídas ${money(totalSaidas)}</footer>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},180)})<\/script></body></html>`;
  }
  const legacyFiscalPdf = global.fiscalExportarPDF;
  if (typeof legacyFiscalPdf === 'function') {
    global.fiscalExportarPDF = function() {
      if (typeof global._fiscalPeriodoInfo !== 'function' || typeof global._fiscalNotasDoMes !== 'function')
        return legacyFiscalPdf.apply(this,arguments);
      const company = selectedFiscalCompany();
      // Mantém a chave financeira do relatório alinhada à empresa selecionada.
      if (typeof global.fiscalSetEmpresa === 'function' && typeof global._fiscalEnsureEmpresa === 'function'
          && global._fiscalEnsureEmpresa() !== company) global.fiscalSetEmpresa(company);
      const info = global._fiscalPeriodoInfo(), data = global._fiscalNotasDoMes();
      if (!data.ent.length && !data.sai.length) {
        if (typeof global.showToast === 'function') global.showToast('Nenhuma nota neste mês para exportar.','info');
        return;
      }
      const popup = global.open('','_blank','width=1000,height=740');
      if (!popup) {
        if (typeof global.showToast === 'function') global.showToast('Permita a abertura de pop-ups para imprimir o relatório.','error');
        return;
      }
      popup.document.open();popup.document.write(fiscalReportMarkup(info,data,company));popup.document.close();
    };
  }
  global.FiscalWorkspacePrint = { fiscalReportMarkup, selectedFiscalCompany };

  global.FiscalWorkspace = { install, setArea };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
  document.addEventListener('erp:ready', install);
})(window);

(function(global){
'use strict';
// Extensões do Fiscal. Preservam os formulários, cálculos e persistência legados.
const $=(s,r=document)=>r.querySelector(s);
const money=n=>'R$ '+(Number(n)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const company=()=>global.FiscalWorkspacePrint?.selectedFiscalCompany?.()||'manuela';
const year=()=>Number($('#fiscal-sel-ano')?.value)||new Date().getFullYear();
const month=()=>String($('#fiscal-sel-mes')?.value||new Date().getMonth()+1).padStart(2,'0');
const fiscalPrefix=()=>typeof _fPfx==='function'?_fPfx():(company()==='gratus'?'gratus_':'');
const fiscalKey=()=>fiscalPrefix()+year()+'-'+month();
const apurKey=(y=year())=>fiscalPrefix()+y;
const db=()=>global._fbDB;
const storage=()=>global.__fbRaw?.storage;
function message(host,text,bad=false){const e=$(host);if(e){e.textContent=text;e.classList.toggle('fis-v3-error',bad);}}
function requireOnline(){if(!db())throw Error('Sem conexão autenticada ao Firebase. Não foi realizada nenhuma gravação.');}
async function claims(){const auth=global.__fbRaw?.auth;if(!auth?.currentUser)throw Error('Sessão expirada. Entre novamente.');return (await auth.currentUser.getIdTokenResult()).claims||{};}
async function allowWrite(){const c=await claims();if(c.erpAccess!==true||c.canFiscalWrite!==true)throw Error('Seu perfil não permite alterar dados fiscais.');}
function readonly(v){return document.createTextNode(v==null?'':String(v));}
function section(title,desc,html){const e=node('section','fis-v3-panel');e.hidden=true;e.style.display='none';e.innerHTML='<h3>'+esc(title)+'</h3><p>'+esc(desc)+'</p>'+html;return e;}
function datePt(s){if(!s)return '';return /^\d{4}-\d{2}-\d{2}$/.test(s)?s.slice(8)+'/'+s.slice(5,7)+'/'+s.slice(0,4):s;}
function numeric(s){const n=Number(String(s||'0').replace(',','.'));return Number.isFinite(n)?n:NaN;}
function amt(s){const n=numeric(s);if(!Number.isFinite(n)||n<0||n>1e12)throw Error('Informe um valor monetário válido.');return Math.round(n*100)/100;}
function moneyInput(raw){const s=String(raw||'').trim().replace(/\s|R\$/g,'');return s.includes(',')?s.replace(/\./g,'').replace(',','.'):s;}
const uuid=()=>global.crypto?.randomUUID?.()||('id'+Date.now()+'_'+Math.random().toString(36).slice(2));
function init(shell){
  const areas=[
    ['xml','Importar XML'],['estoque-inicial','Estoque inicial'],
    ['devolucoes','NF de devolução'],['documentos','Documentos fiscais'],['custos-rh','Consulta de custos']
  ];
  const nav=$('.fis-work-nav-extra',shell)||$('.fis-work-mainnav',shell);if(!nav||$('#fis-v3-xml'))return;
  areas.forEach(([id,title])=>{
    const button=node('button','fis-work-mainbutton',title);button.type='button';button.setAttribute('role','tab');button.dataset.fiscalArea=id;
    button.addEventListener('click',()=>global.FiscalWorkspace?.setArea(id));nav.appendChild(button);
  });
  const xml=section('Importação de nota fiscal eletrônica','Importe NF-e modelo 55. Revise os dados antes de registrar: o arquivo não gera lançamento ou estoque automaticamente.',
    `<div class="fis-v3-fields"><label>Arquivo XML da NF-e<input id="fis-v3-xml-file" type="file" accept=".xml,text/xml,application/xml"></label><label>Destino<select id="fis-v3-xml-dest"><option value="entrada">Entrada</option><option value="saida">Saída</option></select></label><button id="fis-v3-xml-read" type="button">Ler XML</button></div><div id="fis-v3-xml-info" role="status"></div><div id="fis-v3-xml-preview"></div>`);
  xml.id='fis-v3-xml';xml.dataset.fiscalView='xml';shell.append(xml);
  $('#fis-v3-xml-read').onclick=readXML;
  const estoque=section('Estoque inicial da apuração','Defina o estoque inicial em R$ para janeiro do ano selecionado. Os meses seguintes são calculados a partir do estoque final anterior.',
    `<div class="fis-v3-fields"><label>Ano da apuração<input id="fis-v3-stock-year" type="number" min="2020" max="2100"></label><label>Estoque inicial de janeiro (R$)<input id="fis-v3-stock-value" inputmode="decimal" placeholder="0,00"></label><button id="fis-v3-stock-save" type="button">Salvar estoque inicial</button></div><div id="fis-v3-stock-info" role="status"></div>`);
  estoque.id='fis-v3-estoque-inicial';estoque.dataset.fiscalView='estoque-inicial';shell.append(estoque);
  $('#fis-v3-stock-save').onclick=saveOpeningStock;
  const ret=section('Notas fiscais de devolução','Controle documental das devoluções por competência. O registro não emite uma NF-e na SEFAZ nem altera estoque ou contas automaticamente.',
    `<div class="fis-v3-fields"><label>Data<input type="date" id="fis-v3-ret-date"></label><label>Número da NF<input id="fis-v3-ret-num" maxlength="40"></label><label>Tipo<select id="fis-v3-ret-kind"><option value="venda">Devolução de venda</option><option value="compra">Devolução de compra</option></select></label><label id="fis-v3-ret-party-label">Cliente fiscal<select id="fis-v3-ret-party" required><option value="">Selecione um cliente fiscal</option></select></label><label>NF original<input id="fis-v3-ret-origin" maxlength="40"></label><label>Valor (R$)<input id="fis-v3-ret-value" inputmode="decimal" placeholder="0,00"></label><label class="fis-v3-wide">Observação<input id="fis-v3-ret-note" maxlength="300"></label><button id="fis-v3-ret-save" type="button">Registrar devolução</button></div><div id="fis-v3-ret-info" role="status"></div><div id="fis-v3-ret-list"></div><button id="fis-v3-ret-apur" type="button" class="fis-v3-subtle">Atualizar devoluções da apuração (vendas)</button>`);
  ret.id='fis-v3-devolucoes';ret.dataset.fiscalView='devolucoes';shell.append(ret);
  $('#fis-v3-ret-date').value=new Date().toISOString().slice(0,10);
  $('#fis-v3-ret-save').onclick=saveReturn;
  $('#fis-v3-ret-kind').addEventListener('change',()=>populateReturnParties());
  $('#fis-v3-ret-apur').onclick=applyReturns;
  const docs=section('Documentos fiscais','Anexe documentos da empresa ou de um cadastro fiscal. Arquivos no Storage com acesso restrito por perfil fiscal.',
    `<div class="fis-v3-fields"><label>Vincular a<select id="fis-v3-doc-owner"></select></label><label>Documento<input type="file" id="fis-v3-doc-file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp"></label><button id="fis-v3-doc-send" type="button">Anexar documento</button></div><div id="fis-v3-doc-info" role="status"></div><div id="fis-v3-doc-list"></div>`);
  docs.id='fis-v3-documentos';docs.dataset.fiscalView='documentos';shell.append(docs);
  $('#fis-v3-doc-send').onclick=uploadFiscalDocument;
  const costs=section('Consulta de custos','Consulte folha estimada por funcionário ou lançamentos fiscais de clientes e fornecedores, por mês ou ano. A folha exige permissão específica.',
    `<div class="fis-v3-fields"><label>Consultar<select id="fis-v3-cost-kind"><option value="funcionario">Funcionário (folha)</option><option value="fornecedor">Fornecedor fiscal (compras)</option><option value="cliente">Cliente fiscal (vendas)</option></select></label><label>Cadastro<select id="fis-v3-cost-employee"></select></label><label>Ano<select id="fis-v3-cost-year">${Array.from({length:new Date().getFullYear()-2019+2},(_,i)=>2020+i).reverse().map(y=>`<option value="${y}">${y}</option>`).join('')}</select></label><label>Período<select id="fis-v3-cost-month"><option value="">Ano inteiro</option>${Array.from({length:12},(_,i)=>`<option value="${String(i+1).padStart(2,'0')}">${new Date(2020,i,1).toLocaleDateString('pt-BR',{month:'long'})}</option>`).join('')}</select></label><button id="fis-v3-cost-view" type="button">Consultar custos</button></div><div id="fis-v3-cost-info" role="status"></div><div id="fis-v3-cost-result"></div>`);
  costs.id='fis-v3-custos-rh';costs.dataset.fiscalView='custos-rh';shell.append(costs);
  $('#fis-v3-cost-year').value=year();$('#fis-v3-stock-year').value=year();
  $('#fis-v3-cost-view').onclick=renderCosts;
  $('#fis-v3-cost-kind').addEventListener('change',renderCosts);
  $('#fis-v3-doc-owner').addEventListener('change',renderDocuments);
  // A sincronização remota pode completar depois da primeira abertura.
  document.addEventListener('erp:alert-source-changed',(event)=>{
    if(event.detail?.source==='funcionarios' && document.querySelector('[data-fiscal-area="custos-rh"].is-current'))renderCosts();
  });
  const refresh=()=>{const active=$('[data-fiscal-area].is-current',shell)?.dataset.fiscalArea;if(areas.some(([id])=>id===active))setTimeout(()=>onAreaChange(active),0);};
  ['fiscal-sel-mes','fiscal-sel-ano'].forEach(id=>$('#'+id)?.addEventListener('change',refresh));
  shell.querySelectorAll('[data-fiscal-company]').forEach(b=>b.addEventListener('click',refresh));
}
async function onAreaChange(area){
  try{
    if(area==='estoque-inicial')renderStock();
    if(area==='devolucoes'){await populateReturnParties();await renderReturns();}
    if(area==='documentos')await renderDocuments();
    if(area==='custos-rh')await renderCosts();
  }catch(e){message('#fis-v3-'+area+'-info',e.message,true);}
}
// Parser limitado a NF-e modelo 55, sem DTD, com consulta explícita de campos.
function parseNFeXML(xml){
  if(!xml||xml.length>2500000||/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))throw Error('XML inválido ou muito grande (máximo 2,5 MB).');
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror'))throw Error('XML malformado.');
  const local=(parent,name)=>parent&&Array.from(parent.children||[]).find(el=>el.localName===name);
  const value=(parent,name)=>local(parent,name)?.textContent?.trim()||'';
  const root=doc.documentElement;const nfe=root?.localName==='NFe'?root:local(root,'NFe');
  const inf=local(nfe,'infNFe');if(!inf)throw Error('Arquivo não é uma NF-e válida.');
  const ide=local(inf,'ide');if(value(ide,'mod')!=='55')throw Error('Somente NF-e modelo 55 é suportada.');
  const emit=local(inf,'emit');const dest=local(inf,'dest');const det=Array.from(inf.children).filter(x=>x.localName==='det');
  const total=local(local(inf,'total'),'ICMSTot');
  const items=det.map(row=>{const p=local(row,'prod');return{description:value(p,'xProd').slice(0,140),quantity:numeric(value(p,'qCom')),unit:value(p,'uCom'),value:numeric(value(p,'vProd'))};});
  const date=value(ide,'dhEmi')||value(ide,'dEmi');
  if(!/^\d{4}-\d{2}-\d{2}/.test(date)||!items.length||items.length>150||items.some(i=>!i.description||i.value<0||!Number.isFinite(i.value)||!Number.isFinite(i.quantity)))throw Error('Data ou itens da NF-e inválidos.');
  const n=value(ide,'nNF');if(!n)throw Error('Número da NF-e ausente.');
  return {number:n,date:date.slice(0,10),issuer:value(emit,'xNome'),recipient:value(dest,'xNome'),key:String(inf.getAttribute('Id')||'').replace(/^NFe/,''),items,amount:numeric(value(total,'vNF'))};
}
let imported=null;
async function readXML(){
  try{
    const f=$('#fis-v3-xml-file')?.files?.[0];if(!f)throw Error('Selecione um XML.');
    if(f.size>2500000)throw Error('Arquivo maior que 2,5 MB.');
    const info=parseNFeXML(await f.text());
    const k=fiscalKey();const list=Object.values((typeof FISCAL_DB!=='undefined'?FISCAL_DB[k]:{})||{});
    const existing=list.flatMap(x=>Array.isArray(x)?x:[]).some(x=>String(x.num||'')===info.number&&String(x.fornecedor||x.cliente||'').toLowerCase()===info.issuer.toLowerCase());
    imported=existing?null:info;
    const msg=existing?'Possível nota já cadastrada: confira o histórico antes de importar.':'Dados lidos. Confira antes de abrir o formulário.';
    message('#fis-v3-xml-info',msg,existing);
    const holder=$('#fis-v3-xml-preview');holder.replaceChildren();
    const table=node('div','fis-v3-import-summary');table.innerHTML=`<strong>NF ${esc(info.number)}</strong> · ${esc(datePt(info.date))} · ${esc(info.issuer)} · ${info.items.length} item(ns) · ${money(info.amount)}`;
    holder.append(table);
    const action=node('button','', 'Revisar no formulário de lançamento');action.disabled=existing;
    action.addEventListener('click',()=>openImportedDraft());holder.append(action);
  }catch(e){imported=null;$('#fis-v3-xml-preview')?.replaceChildren();message('#fis-v3-xml-info',e.message,true);}
}
function openImportedDraft(){
  if(!imported)return;
  const isEntry=$('#fis-v3-xml-dest').value==='entrada';const prefix=isEntry?'ne':'ns';
  const opener=isEntry?global.fiscalNovaEntrada:global.fiscalNovaSaida;
  if(typeof opener!=='function'){message('#fis-v3-xml-info','Formulário fiscal indisponível.');return;}
  opener();
  const date=$('#'+prefix+'-data');if(!date)return;
  date.value=imported.date;
  $('#'+prefix+'-num').value=imported.number;
  $('#'+prefix+(isEntry?'-forn':'-cli')).value=isEntry?imported.issuer:imported.recipient;
  const tbody=$('#'+prefix+'-itens-body');if(!tbody)return;
  for(let i=1;i<imported.items.length;i++)global.fiscalAddItemModal?.(prefix);
  const rows=Array.from(tbody.querySelectorAll('tr'));
  imported.items.forEach((v,i)=>{
    const row=rows[i];if(!row)return;
    row.querySelector('.'+prefix+'-prod').value=v.description+(v.unit&&v.unit.toUpperCase()!=='KG'?' ('+v.unit+')':'');
    row.querySelector('.'+prefix+'-kg').value=v.unit.toUpperCase()==='KG'?v.quantity:0;
    row.querySelector('.'+prefix+'-val').value=v.value.toFixed(2);
  });
  global.fiscalCalcTotal?.(prefix);
  message('#fis-v3-xml-info','Rascunho preenchido. Verifique os itens, unidades e o destinatário e clique em Salvar no formulário.');
}
function renderStock(){
  const y=year();$('#fis-v3-stock-year').value=y;
  const obj=typeof FISCAL_APUR!=='undefined'?FISCAL_APUR[apurKey(y)]:null;
  $('#fis-v3-stock-value').value=(Number(obj?.estIni0)||0).toFixed(2).replace('.',',');
  message('#fis-v3-stock-info','Empresa selecionada: '+company()+' · Ano: '+y+'. Estoque inicial é um valor financeiro (R$), não peso (kg).');
}
async function saveOpeningStock(){
  try{
    requireOnline();await allowWrite();
    const y=Number($('#fis-v3-stock-year').value);if(!Number.isInteger(y)||y<2020||y>2100)throw Error('Ano inválido.');
    const n=amt(moneyInput($('#fis-v3-stock-value').value));
    const k=apurKey(y);const old=typeof FISCAL_APUR!=='undefined'?Number(FISCAL_APUR[k]?.estIni0)||0:0;
    if(!confirm('Alterar o estoque inicial de '+company()+'/'+y+' de '+money(old)+' para '+money(n)+'? Isso recalcula o CMV da apuração.'))return;
    await db().ref('erp/fiscalApur/'+k+'/estIni0').set(n);
    if(!FISCAL_APUR[k])FISCAL_APUR[k]={estIni0:0,m:{}};FISCAL_APUR[k].estIni0=n;
    if($('#apur-ano'))$('#apur-ano').value=String(y);
    global.fiscalRenderApuracao?.();
    message('#fis-v3-stock-info','Estoque inicial salvo no Firebase: '+money(n));
  }catch(e){message('#fis-v3-stock-info',e.message,true);}
}
async function saveReturn(){
  try{
    requireOnline();await allowWrite();
    const data=$('#fis-v3-ret-date').value,number=$('#fis-v3-ret-num').value.trim(),partyId=$('#fis-v3-ret-party').value,origin=$('#fis-v3-ret-origin').value.trim();
    const party=returnPartyOptions.find(x=>x.id===partyId);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(data)||!number||!party)throw Error('Preencha data, número e selecione um cadastro fiscal válido.');
    if(!(await fiscalPartiesLive()).some(p=>p.id===partyId&&fiscalPartyKind(p.type)===(($('#fis-v3-ret-kind').value==='compra')?'fornecedor':'cliente')))throw Error('O cadastro fiscal selecionado não está mais ativo ou mudou de tipo.');
    if(!data.startsWith(year()+'-'+month()))throw Error('A devolução deve pertencer à competência selecionada.');
    const record={id:uuid().replace(/[^a-zA-Z0-9_-]/g,''),date:data,number,party:party.name,partyId:party.id,partyType:party.type,origin,kind:$('#fis-v3-ret-kind').value,value:amt(moneyInput($('#fis-v3-ret-value').value)),notes:$('#fis-v3-ret-note').value.trim(),createdAt:new Date().toISOString()};
    if(record.value<=0)throw Error('Informe um valor maior que zero.');
    const key=fiscalKey(),ref=db().ref('erp/fiscal/'+key+'/devolucoes');
    const snap=await ref.once('value');if(Object.values(snap.val()||{}).some(x=>x.number===number&&x.kind===record.kind))throw Error('Já existe uma devolução com este número e tipo nessa competência.');
    await ref.child(record.id).set(record);
    if(!FISCAL_DB[key])FISCAL_DB[key]={entradas:[],saidas:[],impostos:{}};
    if(!FISCAL_DB[key].devolucoes)FISCAL_DB[key].devolucoes={};FISCAL_DB[key].devolucoes[record.id]=record;
    message('#fis-v3-ret-info','Devolução registrada. Não houve baixa de estoque ou emissão de nota.');
    await renderReturns();
  }catch(e){message('#fis-v3-ret-info',e.message,true);}
}
// Usa a origem fiscal remota, e não o cache de inicialização do Phase1Store.
async function fiscalPartiesLive(){
  requireOnline();
  const snap=await db().ref('erp/fiscalParties').once('value');
  const list=snap.val()||{};
  return Object.entries(list).filter(([,p])=>p && p.active!==false && (p.name||p.legalName))
    .map(([id,p])=>({id:String(p.id||id),name:String(p.name||p.legalName),type:String(p.type||p.kind||'')}))
    .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
}
const fiscalPartyKind=(value)=>/forneced/i.test(String(value||''))?'fornecedor':/cliente/i.test(String(value||''))?'cliente':'';
let returnPartyOptions=[];
async function populateReturnParties(){
  const sel=$('#fis-v3-ret-party'),kind=$('#fis-v3-ret-kind')?.value||'venda';
  if(!sel)return;
  const previous=sel.value;
  const desired=kind==='compra'?'fornecedor':'cliente';
  const info=$('#fis-v3-ret-info');
  sel.replaceChildren(new Option(desired==='cliente'?'Selecione um cliente fiscal':'Selecione um fornecedor fiscal',''));
  try{
    const all=await fiscalPartiesLive();
    returnPartyOptions=all.filter(p=>fiscalPartyKind(p.type)===desired);
    returnPartyOptions.forEach(p=>sel.add(new Option(p.name+' · '+p.id,p.id)));
    if(returnPartyOptions.some(p=>p.id===previous))sel.value=previous;
    if(!returnPartyOptions.length)message('#fis-v3-ret-info','Nenhum '+(desired==='cliente'?'cliente':'fornecedor')+' fiscal ativo. Cadastre em Cadastros fiscais antes de registrar a devolução.',true);
    else if(info?.classList.contains('fis-v3-error'))message('#fis-v3-ret-info','');
    const label=$('#fis-v3-ret-party-label');if(label)label.firstChild.textContent=desired==='cliente'?'Cliente fiscal':'Fornecedor fiscal';
  }catch(error){returnPartyOptions=[];message('#fis-v3-ret-info','Não foi possível consultar os cadastros fiscais: '+error.message,true);}
}
let returnsCache=[];
async function renderReturns(){
  requireOnline();
  const snap=await db().ref('erp/fiscal/'+fiscalKey()+'/devolucoes').once('value');
  returnsCache=Object.values(snap.val()||{});
  const host=$('#fis-v3-ret-list');host.replaceChildren();
  const tbl=node('div','fis-v3-table-wrap');tbl.innerHTML='<table><thead><tr><th>Data</th><th>NF</th><th>Tipo</th><th>Cliente/Fornecedor</th><th>NF original</th><th>Valor</th></tr></thead><tbody></tbody></table>';
  const tbody=$('tbody',tbl);
  returnsCache.sort((a,b)=>a.date.localeCompare(b.date)).forEach(x=>{const row=node('tr');[datePt(x.date),x.number,x.kind==='venda'?'Venda':'Compra',x.party,x.origin||'—',money(x.value)].forEach(v=>{const td=node('td');td.append(readonly(v));row.append(td);});tbody.append(row);});
  if(!returnsCache.length)host.append(node('p','fis-v3-empty','Nenhuma devolução nesta competência.'));
  else host.append(tbl);
}
async function applyReturns(){
  try{
    requireOnline();await allowWrite();await renderReturns();
    const total=returnsCache.filter(x=>x.kind==='venda').reduce((s,x)=>s+Number(x.value||0),0);
    const k=apurKey(),mm=month();const old=Number(typeof FISCAL_APUR!=='undefined'?FISCAL_APUR[k]?.m?.[mm]?.devol:0)||0;
    if(!confirm('Substituir o campo Devoluções da apuração ('+money(old)+') pelo total de devoluções de venda registradas ('+money(total)+')? Confira com o contador antes de confirmar.'))return;
    await db().ref('erp/fiscalApur/'+k+'/m/'+mm+'/devol').set(total);
    if(!FISCAL_APUR[k])FISCAL_APUR[k]={estIni0:0,m:{}};if(!FISCAL_APUR[k].m)FISCAL_APUR[k].m={};if(!FISCAL_APUR[k].m[mm])FISCAL_APUR[k].m[mm]={};FISCAL_APUR[k].m[mm].devol=total;
    global.fiscalRenderApuracao?.();
    message('#fis-v3-ret-info','Valor da apuração atualizado para '+money(total)+'.');
  }catch(e){message('#fis-v3-ret-info',e.message,true);}
}
async function renderDocuments(){
  requireOnline();await claims();
  const owner=$('#fis-v3-doc-owner'),old=owner.value;
  owner.replaceChildren();
  owner.add(new Option('Empresa — '+(company()==='gratus'?'Gratus Metais':'Manuela Metais'),'empresa'));
  const parties=await fiscalPartiesLive();
  parties.forEach(p=>owner.add(new Option((p.type||'Cadastro')+' — '+p.name,'cad_'+p.id.replace(/[^a-zA-Z0-9_-]/g,''))));
  if([...owner.options].some(o=>o.value===old))owner.value=old;
  const snap=await db().ref('erp/fiscal/__documentsV3/'+company()).once('value');
  if(typeof FISCAL_DB!=='undefined'){if(!FISCAL_DB.__documentsV3)FISCAL_DB.__documentsV3={};FISCAL_DB.__documentsV3[company()]=snap.val()||{};}
  const arr=Object.values(snap.val()||{}).filter(x=>x.owner===owner.value).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const host=$('#fis-v3-doc-list');host.replaceChildren();
  if(!arr.length){host.append(node('p','fis-v3-empty','Nenhum documento para este cadastro ou empresa.'));return;}
  const grid=node('div','fis-v3-doc-list');
  arr.forEach(f=>{
    const row=node('div','fis-v3-doc-row');row.append(node('span','',f.name+' · '+f.owner+' · '+datePt((f.createdAt||'').slice(0,10))));
    const open=node('button','','Abrir');open.type='button';open.onclick=()=>openDocument(f);row.append(open);
    const del=node('button','fis-v3-subtle','Excluir');del.type='button';del.onclick=()=>deleteDocument(f);row.append(del);
    grid.append(row);
  });host.append(grid);
}
async function uploadFiscalDocument(){
  try{
    requireOnline();await allowWrite();if(!storage())throw Error('Firebase Storage indisponível.');
    const f=$('#fis-v3-doc-file')?.files?.[0];if(!f)throw Error('Selecione um arquivo.');
    const types=['application/pdf','image/jpeg','image/png','image/webp'];
    if(!types.includes(f.type)||f.size>10*1024*1024||!f.size)throw Error('Aceitos PDF, JPG, PNG ou WebP de até 10 MB.');
    const owner=$('#fis-v3-doc-owner').value;if(!/^(empresa|cad_[a-zA-Z0-9_-]+)$/.test(owner))throw Error('Cadastro fiscal inválido.');
    if(owner!=='empresa'&&!(await fiscalPartiesLive()).some(p=>'cad_'+p.id.replace(/[^a-zA-Z0-9_-]/g,'')===owner))throw Error('O cadastro vinculado não está mais ativo.');
    const id=uuid().replace(/[^a-zA-Z0-9_-]/g,''),ext={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[f.type];
    const path='erp-files/fiscalDocs/'+company()+'/'+owner+'/'+id+'.'+ext;
    const ref=storage().ref(path);await ref.put(f,{contentType:f.type});
    const meta={id,name:f.name.slice(0,180),owner,company:company(),path,type:f.type,size:f.size,createdAt:new Date().toISOString()};
    try{await db().ref('erp/fiscal/__documentsV3/'+company()+'/'+id).set(meta);}catch(e){try{await ref.delete();}catch(_){}throw e;}
    if(typeof FISCAL_DB!=='undefined'){if(!FISCAL_DB.__documentsV3)FISCAL_DB.__documentsV3={};if(!FISCAL_DB.__documentsV3[company()])FISCAL_DB.__documentsV3[company()]={};FISCAL_DB.__documentsV3[company()][id]=meta;}
    message('#fis-v3-doc-info','Documento anexado e cadastrado.');$('#fis-v3-doc-file').value='';await renderDocuments();
  }catch(e){message('#fis-v3-doc-info',e.message,true);}
}
async function openDocument(f){
  try{if(!storage()||!String(f.path||'').startsWith('erp-files/fiscalDocs/'+company()+'/'))throw Error('Caminho de documento inválido.');
    const url=await storage().ref(f.path).getDownloadURL();global.open(url,'_blank','noopener,noreferrer');
  }catch(e){message('#fis-v3-doc-info',e.message,true);}
}
async function deleteDocument(f){
  try{requireOnline();await allowWrite();if(!confirm('Excluir permanentemente o anexo '+f.name+'?'))return;
    if(!String(f.path||'').startsWith('erp-files/fiscalDocs/'+company()+'/'))throw Error('Caminho inválido.');
    await storage().ref(f.path).delete();await db().ref('erp/fiscal/__documentsV3/'+company()+'/'+f.id).remove();
    if(typeof FISCAL_DB!=='undefined'&&FISCAL_DB.__documentsV3?.[company()])delete FISCAL_DB.__documentsV3[company()][f.id];
    message('#fis-v3-doc-info','Documento excluído.');await renderDocuments();
  }catch(e){message('#fis-v3-doc-info',e.message,true);}
}
async function renderCosts(){
  try{
    const c=await claims(),kind=$('#fis-v3-cost-kind')?.value||'funcionario';
    if(c.erpAccess!==true){$('#fis-v3-cost-result').replaceChildren();throw Error('Sessão inválida.');}
    if(kind!=='funcionario'){
      if(!c.canFiscalRead)throw Error('Consulta restrita a usuários com acesso ao Fiscal.');
      return await renderFiscalPartyCosts(kind);
    }
    if(!c.canPayroll){$('#fis-v3-cost-result').replaceChildren();throw Error('Consulta de funcionários exige acesso à Folha de Pagamento.');}
    let staff=typeof FUNCIONARIOS!=='undefined'&&Array.isArray(FUNCIONARIOS)?FUNCIONARIOS.filter(f=>f&&f.mat):[];
    // O sincronizador restringe funcEdit a canHR. Uma pessoa com apenas canPayroll
    // recebe os campos mínimos do cadastro pela API, que valida o token no servidor.
    if(!staff.length){
      const auth=global.__fbRaw?.auth;
      const jwt=await auth?.currentUser?.getIdToken?.();
      if(!jwt)throw Error('Sessão expirada. Entre novamente.');
      const response=await global.fetch('/api/fiscal/staff',{headers:{Authorization:'Bearer '+jwt},cache:'no-store'});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(response.status===403?'Seu perfil não está autorizado a consultar os funcionários.':(result.message||'Não foi possível consultar os funcionários no servidor.'));
      staff=Array.isArray(result.staff)?result.staff.filter(f=>f&&f.mat):[];
    }
    const sel=$('#fis-v3-cost-employee'),old=sel.value;
    sel.replaceChildren(new Option('Selecione um funcionário',''));
    staff.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'))
      .forEach(f=>sel.add(new Option((f.nome||f.mat)+' ('+f.mat+')',f.mat)));
    if(staff.some(f=>String(f.mat)===old))sel.value=old;
    else if(staff.length)sel.value=String(staff[0].mat);
    const f=staff.find(x=>x.mat===sel.value),y=Number($('#fis-v3-cost-year').value)||year(),m=$('#fis-v3-cost-month').value;
    const host=$('#fis-v3-cost-result');host.replaceChildren();if(!f){host.append(node('p','fis-v3-empty','Nenhum funcionário cadastrado.'));return;}
    const meses=m?[m]:Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'));
    const r=meses.map(mm=>calcPayrollMonth(f,y,mm));
    const total=r.reduce((s,x)=>s+x.cost,0);
    const kpi=node('div','fis-v3-cost-kpi');kpi.innerHTML='<span>Custo estimado para '+esc(f.nome)+'</span><strong>'+money(total)+'</strong>';
    host.append(kpi);
    const box=node('div','fis-v3-table-wrap');box.innerHTML='<table><thead><tr><th>Mês</th><th>Bruto estimado</th><th>Diárias</th><th>Encargos estimados</th><th>Total estimado</th></tr></thead><tbody></tbody></table>';
    r.forEach(x=>{const row=node('tr');[x.period,money(x.bruto),money(x.diarias),money(x.encargos),money(x.cost)].forEach(v=>row.append(node('td','',v)));$('tbody',box).append(row);});host.append(box);
    message('#fis-v3-cost-info','Estimativa baseada nos dados de folha e viagens; não equivale a pagamento confirmado ou guia de encargos.');
  }catch(e){message('#fis-v3-cost-info',e.message,true);}
}
async function renderFiscalPartyCosts(kind){
  const select=$('#fis-v3-cost-employee'),current=select.value;
  const parties=(await fiscalPartiesLive()).filter(x=>fiscalPartyKind(x.type)===kind);
  select.replaceChildren(new Option(kind==='cliente'?'Selecione um cliente fiscal':'Selecione um fornecedor fiscal',''));
  parties.forEach(p=>select.add(new Option(p.name+' · '+p.id,p.id)));
  if(parties.some(p=>p.id===current))select.value=current;
  else if(parties.length)select.value=parties[0].id;
  const party=parties.find(p=>p.id===select.value),host=$('#fis-v3-cost-result');host.replaceChildren();
  if(!party){host.append(node('p','fis-v3-empty','Nenhum cadastro fiscal ativo deste tipo.'));return;}
  const y=Number($('#fis-v3-cost-year').value)||year(),requested=$('#fis-v3-cost-month').value;
  const months=requested?[requested]:Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'));
  const entries=months.map(mm=>{
    const key=(typeof _fPfx==='function'?_fPfx():'')+y+'-'+mm;
    const source=FISCAL_DB?.[key]?.[kind==='fornecedor'?'entradas':'saidas']||[];
    const names=String(party.name).trim().toLocaleLowerCase('pt-BR');
    const list=source.filter(x=>String(kind==='fornecedor'?x.fornecedor:x.cliente||'').trim().toLocaleLowerCase('pt-BR')===names);
    const amount=list.reduce((sum,x)=>sum+Number(x.valorTotal ?? x.valor ?? (x.itens||[]).reduce((n,i)=>n+Number(i.valor||0),0) ?? 0),0);
    return {month:mm+'/'+y,count:list.length,total:Math.round(amount*100)/100};
  });
  const total=entries.reduce((a,x)=>a+x.total,0);
  host.append(node('div','fis-v3-cost-kpi',`${kind==='fornecedor'?'Compras fiscais de':'Vendas fiscais para'} ${party.name}: R$ ${money(total)}`));
  const box=node('div','fis-v3-table-wrap');const table=document.createElement('table');
  table.innerHTML='<thead><tr><th>Mês</th><th>Notas</th><th>Valor dos lançamentos</th></tr></thead><tbody></tbody>';
  entries.forEach(x=>{const row=node('tr');[x.month,x.count,'R$ '+money(x.total)].forEach(v=>row.append(node('td','',v)));table.tBodies[0].append(row);});box.append(table);host.append(box);
  message('#fis-v3-cost-info','Total dos lançamentos fiscais por competência; não representa custo líquido, lucro ou pagamento confirmado.');
}
function calcPayrollMonth(f,y,mm){
  const mes=y+'-'+mm;
  const fd=(typeof FOLHA_DB!=='undefined'?FOLHA_DB[mes+'-'+f.mat]:null)||{};
  const p=typeof PONTO_DB!=='undefined'?PONTO_DB:[],t=typeof VIAGEM_DB!=='undefined'?VIAGEM_DB:[];
  const normal=d=>String(d||'').includes('/')?String(d).split('/').reverse().join('-'):String(d||'');
  const at=p.filter(x=>x.mat===f.mat&&normal(x.data).startsWith(mes));
  const faltas=at.filter(x=>x.tipo==='Falta').length;
  const horas=at.filter(x=>x.tipo==='HE').reduce((s,x)=>s+Number(x.horas||0),0);
  const viagens=t.filter(x=>x.motorista===f.nome&&normal(x.data).startsWith(mes));
  const diarias=viagens.reduce((s,x)=>s+Number(x.totalDiarias!==undefined?x.totalDiarias:(x.diaria||0)*(x.numDiarias||1)),0);
  const base=Number(f.sal||0);
  const bruto=Math.max(0,base-(faltas*8)*(base/220)+horas*(base/220)+Number(fd.adicional||0)+(faltas?0:Number(fd.abono||0))+diarias);
  const rate=Math.max(0,Number(global.ERP_BUSINESS_CONFIG?.payrollDefaults?.employerCostRate||0.28));
  const encargos=Math.round(bruto*rate*100)/100;
  return {period:mm+'/'+y,bruto,diarias,encargos,cost:Math.round((bruto+encargos)*100)/100};
}
global.FiscalExtensions={install:init,onAreaChange,parseNFeXML,calcPayrollMonth};
// O script é carregado dinamicamente: o DOM pode já estar pronto.
// Nesse caso o workspace antigo instalou antes da definição das extensões.
const mounted=document.getElementById('fiscal-workspace');
if(mounted){init(mounted);global.FiscalWorkspace?.setArea(document.querySelector('[data-fiscal-area].is-current')?.dataset.fiscalArea||'lancamentos');}
})(window);
