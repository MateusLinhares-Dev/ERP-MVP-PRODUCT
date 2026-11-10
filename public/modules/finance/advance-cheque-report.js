(function(global){
  'use strict';
  let rows=[];
  let loading=false;
  let currentUid='';
  let page=1;
  const pageSize=25;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const isoDate=value=>{
    const text=String(value||'').trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
    if(/^\d{2}\/\d{2}\/\d{4}$/.test(text))return text.split('/').reverse().join('-');
    return '';
  };
  const cents=value=>Math.round(Number(value||0)*100);
  const money=value=>Number(value||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const chequeNumber=item=>String(item?.numero||'').trim()||'não informado';
  function filter(items,criteria={}){
    const cliente=normalize(criteria.cliente),empresa=normalize(criteria.empresa);
    const year=String(criteria.year||''),month=String(criteria.month||'');
    const from=String(criteria.from||''),to=String(criteria.to||''),status=String(criteria.status||'');
    return items.filter(item=>{
      const date=isoDate(item.data);
      return (!cliente||normalize(item.cliente).includes(cliente)) &&
        (!empresa||normalize(item.empresa).includes(empresa)) &&
        (!year||date.slice(0,4)===year) &&
        (!month||date.slice(5,7)===month) &&
        (!from||date>=from) && (!to||date<=to) &&
        (!status||item.situacao===status);
    }).sort((a,b)=>isoDate(b.data).localeCompare(isoDate(a.data))||
      String(b.numero).localeCompare(String(a.numero),'pt-BR',{numeric:true}));
  }
  function csv(items){
    const escapeCell=value=>{
      let valueText=String(value??'').replace(/[\r\n]+/g,' ').trim();
      if(/^[=+@\-\t]/.test(valueText))valueText="'"+valueText;
      return '"'+valueText.replace(/"/g,'""')+'"';
    };
    const lines=[['CHEQUE','EMPRESA','CLIENTE','NÚMERO','DATA','VALOR']];
    for(const item of items)lines.push(['CHEQUE',item.empresa,item.cliente,chequeNumber(item),item.data,'R$ '+money(item.valor)]);
    lines.push(['TOTAL','','','','','R$ '+money(summary(items).total)]);
    return '\uFEFF'+lines.map(cells=>cells.map(escapeCell).join(';')).join('\r\n');
  }
  function tableRows(items){
    return items.map(c=>'<tr><td>CHEQUE</td><td>'+esc(c.empresa||'—')+'</td><td>'+esc(c.cliente)+'</td><td>'+esc(chequeNumber(c))+'</td><td>'+esc(c.data)+'</td><td class="adt-report-amount">R$ '+money(c.valor)+'</td></tr>').join('');
  }
  function printHtml(items){
    const table='<table><thead><tr><th>CHEQUE</th><th>EMPRESA</th><th>CLIENTE</th><th>NÚMERO</th><th>DATA</th><th>VALOR</th></tr></thead><tbody>'+tableRows(items)+'</tbody><tfoot><tr><td><b>TOTAL</b></td><td></td><td></td><td></td><td></td><td><b>R$ '+money(summary(items).total)+'</b></td></tr></tfoot></table>';
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relação de cheques</title><style>@page{size:A4 landscape;margin:12mm}body{font:12px Arial,sans-serif;margin:20px;color:#222}h1{font-size:17px;margin:0 0 14px}table{border-collapse:collapse;width:100%;table-layout:auto}th,td{border:1px solid #555;padding:5px 7px;text-align:left;overflow-wrap:anywhere}th,tfoot td{background:#fff35b;font-weight:700}td:last-child,th:last-child{text-align:right;white-space:nowrap}tr{break-inside:avoid}button{margin-bottom:14px;background:#245b41;color:white;border:0;border-radius:5px;padding:9px 14px;cursor:pointer}@media print{button{display:none}body{margin:0}thead{display:table-header-group}tfoot{display:table-footer-group}}</style></head><body><button type="button" onclick="window.print()">Imprimir</button><h1>Relação de cheques</h1>'+table+'<script>window.addEventListener("load",function(){window.focus();window.print()})<\/script></body></html>';
  }
  function summary(items){return {count:items.length,total:items.reduce((sum,item)=>sum+cents(item.valor),0)/100};}
  const usable=items=>Array.isArray(items)?items.filter(c=>c&&typeof c==='object'&&String(c.cliente||'').trim()&&Number.isFinite(c.valor)&&c.valor>0):[];
  global.AdvanceChequeReport={filter,csv,summary,isoDate,printHtml,tableRows,usable};
  if(typeof document==='undefined')return;
  const panel=()=>document.getElementById('adt-cheques-report');
  const user=()=>{try{return global.firebase?.auth?.().currentUser||null;}catch(e){return null;}};
  function criteria(){
    const root=panel();
    return {
      cliente:root?.querySelector('#adt-report-cliente')?.value||'',
      empresa:root?.querySelector('#adt-report-empresa')?.value||'',
      year:root?.querySelector('#adt-report-year')?.value||'',
      month:root?.querySelector('#adt-report-month')?.value||'',
      from:root?.querySelector('#adt-report-from')?.value||'',
      to:root?.querySelector('#adt-report-to')?.value||'',
      status:root?.querySelector('#adt-report-status')?.value||''
    };
  }
  function filtered(){return filter(rows,criteria());}
  function render(){
    const root=panel();if(!root)return;
    const visible=filtered();
    const body=root.querySelector('#adt-report-body');
    const total=root.querySelector('#adt-report-total');
    const count=root.querySelector('#adt-report-count');
    const pages=Math.max(1,Math.ceil(visible.length/pageSize));
    page=Math.min(Math.max(1,page),pages);
    const pageRows=visible.slice((page-1)*pageSize,page*pageSize);
    if(count)count.textContent=String(visible.length);
    if(total)total.textContent='R$ '+money(summary(visible).total);
    if(body)body.innerHTML=pageRows.length?tableRows(pageRows):'<tr><td colspan="6" class="adt-report-empty">Nenhum cheque corresponde aos filtros.</td></tr>';
    const nav=root.querySelector('#adt-report-pagination');
    if(nav){
      nav.hidden=visible.length===0;
      const position=nav.querySelector('#adt-report-page-text');
      if(position)position.textContent='Página '+page+' de '+pages+' · '+visible.length+' cheques';
      const prev=nav.querySelector('#adt-report-prev'),next=nav.querySelector('#adt-report-next');
      if(prev)prev.disabled=page<=1;
      if(next)next.disabled=page>=pages;
    }
  }
  function layout(){
    const root=panel();if(!root)return;
    root.innerHTML='<div class="adt-report-header"><div><h3>Relatório de cheques lançados</h3><p>Cheques registrados em Adiantamentos. Somente cheques de adiantamentos; os filtros não alteram lançamentos.</p></div><div class="adt-report-actions"><button type="button" onclick="atualizarRelatorioChequesAdiantamentos()">Atualizar</button><button type="button" onclick="exportarRelatorioChequesAdiantamentos()">Exportar CSV</button><button type="button" onclick="imprimirRelatorioChequesAdiantamentos()">Imprimir tabela</button><button type="button" onclick="fecharRelatorioChequesAdiantamentos()">Fechar</button></div></div>'+
      '<div class="adt-report-filters"><label>Cliente / destinatário<input id="adt-report-cliente" type="search" placeholder="Ex.: CICLO" oninput="filtrarRelatorioChequesAdiantamentos()"></label><label>Empresa / emitente<input id="adt-report-empresa" type="search" placeholder="Pesquisar empresa" oninput="filtrarRelatorioChequesAdiantamentos()"></label><label>Ano<select id="adt-report-year" onchange="filtrarRelatorioChequesAdiantamentos()"><option value="">Todos</option></select></label><label>Mês<select id="adt-report-month" onchange="filtrarRelatorioChequesAdiantamentos()"><option value="">Todos</option>'+Array.from({length:12},(_,i)=>'<option value="'+String(i+1).padStart(2,'0')+'">'+String(i+1).padStart(2,'0')+'</option>').join('')+'</select></label><label>De<input type="date" id="adt-report-from" onchange="filtrarRelatorioChequesAdiantamentos()"></label><label>Até<input type="date" id="adt-report-to" onchange="filtrarRelatorioChequesAdiantamentos()"></label><label>Situação<select id="adt-report-status" onchange="filtrarRelatorioChequesAdiantamentos()"><option value="">Todas</option><option>A compensar</option><option>Compensado</option><option>Cancelado</option><option>Devolvido</option></select></label></div>'+
      '<div id="adt-report-message" role="status" aria-live="polite"></div><div class="adt-report-summary"><strong><span id="adt-report-count">0</span> cheque(s)</strong><strong>Total: <span id="adt-report-total">R$ 0,00</span></strong></div><div class="adt-report-table-wrap"><table class="adt-report-table"><thead><tr><th>CHEQUE</th><th>EMPRESA</th><th>CLIENTE</th><th>NÚMERO</th><th>DATA</th><th>VALOR</th></tr></thead><tbody id="adt-report-body"></tbody></table></div><div class="adt-report-pagination" id="adt-report-pagination" hidden><button id="adt-report-prev" type="button" onclick="paginaRelatorioChequesAdiantamentos(-1)">Anterior</button><span id="adt-report-page-text"></span><button id="adt-report-next" type="button" onclick="paginaRelatorioChequesAdiantamentos(1)">Próxima</button></div>';
  }
  function years(){
    const select=panel()?.querySelector('#adt-report-year');if(!select)return;
    const selected=select.value;
    const values=[...new Set(rows.map(row=>isoDate(row.data).slice(0,4)).filter(Boolean))].sort().reverse();
    select.innerHTML='<option value="">Todos</option>'+values.map(y=>'<option value="'+esc(y)+'">'+esc(y)+'</option>').join('');
    if(values.includes(selected))select.value=selected;
  }
  async function refresh(){
    if(loading)return;
    const identity=user(),root=panel();if(!root)return;
    if(!identity){root.querySelector('#adt-report-message').textContent='É necessário entrar no ERP para consultar os cheques.';return;}
    loading=true;
    root.querySelector('#adt-report-message').textContent='Consultando cheques lançados no servidor…';
    try{
      const token=await identity.getIdToken();
      const response=await fetch('/api/finance/advance-cheques',{headers:{Authorization:'Bearer '+token,Accept:'application/json'},credentials:'same-origin',cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.message||('Erro na consulta ('+response.status+').'));
      if(user()?.uid!==identity.uid){root.querySelector('#adt-report-message').textContent='O usuário mudou durante a consulta. Toque em Atualizar.';return;}
      rows=usable(data.cheques);
      currentUid=identity.uid;
      years();render();
      const missing=rows.filter(row=>!String(row.numero||'').trim()).length;
      root.querySelector('#adt-report-message').textContent=rows.length+' cheque(s) de adiantamentos carregado(s).'+(missing?' '+missing+' sem número de cheque cadastrado (aparecem como "não informado").':'');
    }catch(e){
      rows=[];render();
      root.querySelector('#adt-report-message').textContent='Falha ao consultar o relatório: '+String(e.message||e);
    }finally{loading=false;}
  }
  global.abrirRelatorioChequesAdiantamentos=function(){
    const root=panel();if(!root)return;
    if(typeof global.adtSubTab==='function')global.adtSubTab('controle');
    if(!root.innerHTML)layout();
    root.hidden=false;
    const uid=user()?.uid||'';
    if(uid!==currentUid){rows=[];currentUid=uid;render();}
    root.scrollIntoView({block:'nearest',behavior:'smooth'});
    void refresh();
  };
  global.fecharRelatorioChequesAdiantamentos=function(){const root=panel();if(root)root.hidden=true;};
  global.atualizarRelatorioChequesAdiantamentos=function(){void refresh();};
  global.filtrarRelatorioChequesAdiantamentos=function(){page=1;render();};
  global.paginaRelatorioChequesAdiantamentos=function(step){page+=step;render();};
  global.exportarRelatorioChequesAdiantamentos=function(){
    const visible=filtered();if(!visible.length)return;
    const blob=new Blob([csv(visible)],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='cheques-adiantamentos.csv';document.body.appendChild(link);link.click();link.remove();
    URL.revokeObjectURL(url);
  };
  global.imprimirRelatorioChequesAdiantamentos=function(){
    const visible=filtered();if(!visible.length)return;
    const popup=global.open('','_blank','width=1100,height=780');
    if(!popup){const message=panel()?.querySelector('#adt-report-message');if(message)message.textContent='O navegador bloqueou a impressão. Permita janelas para este site e tente novamente.';return;}
    popup.document.open();
    popup.document.write(printHtml(visible));
    popup.document.close();
  };
})(typeof globalThis!=='undefined'?globalThis:this);
