(function(global){
  'use strict';
  let rows=[];
  let loading=false;
  let currentUid='';
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
    const lines=[['CHEQUE','EMPRESA','CLIENTE','NÚMERO','DATA','VENCIMENTO','VALOR','SITUAÇÃO','ADIANTAMENTO','ORIGEM']];
    for(const item of items)lines.push(['CHEQUE',item.empresa,item.cliente,item.numero,item.data,item.vencimento,money(item.valor),item.situacao,item.adiantamento,item.origem]);
    lines.push(['TOTAL','','','','','',money(summary(items).total),items.length+' cheque(s)','','']);
    return '\uFEFF'+lines.map(cells=>cells.map(escapeCell).join(';')).join('\r\n');
  }
  function summary(items){return {count:items.length,total:items.reduce((sum,item)=>sum+cents(item.valor),0)/100};}
  global.AdvanceChequeReport={filter,csv,summary,isoDate};
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
    if(count)count.textContent=String(visible.length);
    if(total)total.textContent='R$ '+money(summary(visible).total);
    if(body)body.innerHTML=visible.length?visible.map(c=>'<tr><td>CHEQUE</td><td>'+esc(c.empresa||'—')+'</td><td>'+esc(c.cliente)+'</td><td>'+esc(c.numero)+'</td><td>'+esc(c.data)+'</td><td>'+esc(c.vencimento||'—')+'</td><td class="adt-report-amount">R$ '+money(c.valor)+'</td><td>'+esc(c.situacao)+'</td><td>'+esc(c.origem||'—')+'</td></tr>').join(''):'<tr><td colspan="9" class="adt-report-empty">Nenhum cheque de adiantamento corresponde aos filtros.</td></tr>';
  }
  function layout(){
    const root=panel();if(!root)return;
    root.innerHTML='<div class="adt-report-header"><div><h3>Relatório de cheques lançados</h3><p>Cheques registrados em Adiantamentos. Somente cheques de adiantamentos; os filtros não alteram lançamentos.</p></div><div class="adt-report-actions"><button type="button" onclick="atualizarRelatorioChequesAdiantamentos()">Atualizar</button><button type="button" onclick="exportarRelatorioChequesAdiantamentos()">Exportar CSV</button><button type="button" onclick="imprimirRelatorioChequesAdiantamentos()">Imprimir tabela</button><button type="button" onclick="fecharRelatorioChequesAdiantamentos()">Fechar</button></div></div>'+
      '<div class="adt-report-filters"><label>Cliente / destinatário<input id="adt-report-cliente" type="search" placeholder="Ex.: CICLO" oninput="filtrarRelatorioChequesAdiantamentos()"></label><label>Empresa / emitente<input id="adt-report-empresa" type="search" placeholder="Pesquisar empresa" oninput="filtrarRelatorioChequesAdiantamentos()"></label><label>Ano<select id="adt-report-year" onchange="filtrarRelatorioChequesAdiantamentos()"><option value="">Todos</option></select></label><label>Mês<select id="adt-report-month" onchange="filtrarRelatorioChequesAdiantamentos()"><option value="">Todos</option>'+Array.from({length:12},(_,i)=>'<option value="'+String(i+1).padStart(2,'0')+'">'+String(i+1).padStart(2,'0')+'</option>').join('')+'</select></label><label>De<input type="date" id="adt-report-from" onchange="filtrarRelatorioChequesAdiantamentos()"></label><label>Até<input type="date" id="adt-report-to" onchange="filtrarRelatorioChequesAdiantamentos()"></label><label>Situação<select id="adt-report-status" onchange="filtrarRelatorioChequesAdiantamentos()"><option value="">Todas</option><option>A compensar</option><option>Compensado</option><option>Cancelado</option><option>Devolvido</option></select></label></div>'+
      '<div id="adt-report-message" role="status" aria-live="polite"></div><div class="adt-report-summary"><strong><span id="adt-report-count">0</span> cheque(s)</strong><strong>Total: <span id="adt-report-total">R$ 0,00</span></strong></div><div class="adt-report-table-wrap"><table class="adt-report-table"><thead><tr><th>Tipo</th><th>Empresa / emitente</th><th>Cliente / destinatário</th><th>Número</th><th>Data</th><th>Bom para</th><th>Valor</th><th>Situação</th><th>Origem</th></tr></thead><tbody id="adt-report-body"></tbody></table></div>';
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
      if(user()?.uid!==identity.uid)return;
      rows=Array.isArray(data.cheques)?data.cheques.filter(c=>c&&typeof c==='object'&&c.numero&&c.cliente&&Number.isFinite(c.valor)&&c.valor>0):[];
      currentUid=identity.uid;
      years();render();
      root.querySelector('#adt-report-message').textContent=rows.length+' cheque(s) de adiantamentos carregado(s).';
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
  global.filtrarRelatorioChequesAdiantamentos=render;
  global.exportarRelatorioChequesAdiantamentos=function(){
    const visible=filtered();if(!visible.length)return;
    const blob=new Blob([csv(visible)],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='cheques-adiantamentos.csv';document.body.appendChild(link);link.click();link.remove();
    URL.revokeObjectURL(url);
  };
  global.imprimirRelatorioChequesAdiantamentos=function(){if(filtered().length)global.print();};
})(typeof globalThis!=='undefined'?globalThis:this);
