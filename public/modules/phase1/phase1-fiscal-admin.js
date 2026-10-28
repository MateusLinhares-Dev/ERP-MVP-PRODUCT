(function(global){
'use strict';
const store=global.Phase1Store;let fiscalParties={},docCategories={};const defaults=['Contrato','NF / Nota Fiscal','Alvará','Certidão','Procuração','Foto','Outros'];defaults.forEach(name=>{const id=name.toUpperCase();docCategories[id]={id,name};});
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function initFiscalParties(){if(!store)return;fiscalParties=await store.load('fiscalParties',{});renderFiscalParties();}
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
    currentArea = ['lancamentos', 'apuracao', 'cadastros'].includes(area) ? area : 'lancamentos';
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
      nav.appendChild(btn);
    });
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
