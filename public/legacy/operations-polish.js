/* Organização de tabelas e extratos sem modificar os registros de negócio. */
(function () {
  'use strict';
  const $=(sel,root=document)=>root.querySelector(sel);
  const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function tableSearch({tabId,tbodyId,label}){
    const tab=document.getElementById(tabId);
    const tbody=document.getElementById(tbodyId);
    if(!tab||!tbody||document.getElementById(`erp-search-${tbodyId}`))return;
    const table=tbody.closest('table');
    if(!table)return;
    const wrapper=table.closest('.tcard')||table.parentElement;
    const bar=document.createElement('div');bar.className='erp-data-toolbar';
    const input=document.createElement('input');input.type='search';input.id=`erp-search-${tbodyId}`;
    input.className='erp-data-search';input.placeholder=label;
    input.setAttribute('aria-label',label);
    const count=document.createElement('span');count.className='erp-data-count';count.setAttribute('aria-live','polite');
    bar.append(input,count);
    const title=wrapper.querySelector('.tcard-hdr');
    if(title)title.insertAdjacentElement('afterend',bar);
    else table.parentElement.insertBefore(bar,table);
    const update=()=>{
      const query=norm(input.value);let total=0,visible=0;
      for(const row of tbody.rows){
        if(!row.cells.length || row.cells.length===1 && row.cells[0].colSpan>1)continue;
        total++;
        const match=!query||norm(row.textContent).includes(query);
        row.hidden=!match;if(match)visible++;
      }
      count.textContent=total?`${visible} de ${total} registros`:'';
    };
    input.addEventListener('input',update);
    new MutationObserver(update).observe(tbody,{childList:true});
    update();
  }

  function ledgerFilter({rootId,tbodyId,options}){
    const root=document.getElementById(rootId),tbody=document.getElementById(tbodyId);
    if(!root||!tbody||document.getElementById(`erp-ledger-filter-${tbodyId}`))return;
    const table=tbody.closest('table');if(!table)return;
    const scroller=table.parentElement;
    const bar=document.createElement('div');bar.className='erp-ledger-toolbar';bar.id=`erp-ledger-filter-${tbodyId}`;
    const search=document.createElement('input');search.type='search';search.placeholder='Buscar movimentação';search.setAttribute('aria-label','Buscar movimentação');
    const select=document.createElement('select');select.setAttribute('aria-label','Filtrar tipo de movimentação');
    options.forEach(([value,name])=>{
      const option=document.createElement('option');option.value=value;option.textContent=name;select.append(option);
    });
    const result=document.createElement('span');result.className='erp-data-count';result.setAttribute('aria-live','polite');
    bar.append(search,select,result);
    scroller.insertAdjacentElement('beforebegin',bar);
    const update=()=>{
      const searchKey=norm(search.value),type=norm(select.value);
      let total=0,shown=0;
      for(const tr of tbody.rows){
        if(tr.cells.length<=1)continue;
        total++;
        const text=norm(tr.textContent);
        const status=norm(tr.cells[1]?.textContent||'');
        const ok=(!searchKey||text.includes(searchKey))&&(!type||status.includes(type));
        tr.hidden=!ok;if(ok)shown++;
      }
      result.textContent=total?`${shown} de ${total} lançamentos`:'';
    };
    search.addEventListener('input',update);select.addEventListener('change',update);
    new MutationObserver(update).observe(tbody,{childList:true});
    update();
  }

  function userSearch(){
    const grid=document.getElementById('users-grid');if(!grid||document.getElementById('erp-user-filter'))return;
    const bar=document.createElement('div');bar.className='erp-data-toolbar erp-users-toolbar';
    const input=document.createElement('input');input.id='erp-user-filter';input.type='search';input.className='erp-data-search';
    input.placeholder='Buscar usuário ou função';input.setAttribute('aria-label','Buscar usuário ou função');
    const count=document.createElement('span');count.className='erp-data-count';bar.append(input,count);
    grid.parentElement.insertBefore(bar,grid);
    const update=()=>{
      let total=0,shown=0;const q=norm(input.value);
      grid.querySelectorAll('.ucard').forEach(card=>{
        total++;
        const main=card.querySelector('.ucard-hdr')?.textContent||'';
        const ok=!q||norm(main+' '+(card.querySelector('.ucard-desc')?.textContent||'')).includes(q);
        card.hidden=!ok;if(ok)shown++;
      });
      count.textContent=`${shown} de ${total} usuários`;
    };
    input.addEventListener('input',update);
    new MutationObserver(update).observe(grid,{childList:true});
    update();
  }

  function init(){
    tableSearch({tabId:'tab-vendas',tbodyId:'tb-vendas-list',label:'Buscar venda, cliente ou material'});
    tableSearch({tabId:'tab-estoque',tbodyId:'tb-estoque',label:'Buscar material ou situação'});
    ledgerFilter({rootId:'tab-fin_clientes',tbodyId:'fc-extrato',options:[['','Todas as movimentações'],['venda','Vendas'],['adiantamento','Adiantamentos'],['cheque','Cheques'],['pagamento','Pagamentos']]});
    ledgerFilter({rootId:'modal-ficha-cli',tbodyId:'fc-tbody',options:[['','Todos os status'],['depósito','Depósitos'],['pago','Pagos'],['pendente','Pendentes']]});
    ledgerFilter({rootId:'modal-ficha-forn',tbodyId:'ff-tbody',options:[['','Todos os status'],['pago','Pagos'],['pendente','Pendentes']]});
    userSearch();
  }
  document.addEventListener('erp:ready',init);
  document.addEventListener('erp:user-started',()=>setTimeout(init,0));
  if(document.readyState==='complete')init();
})();
