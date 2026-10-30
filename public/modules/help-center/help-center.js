/* Manuela Metais — artigos publicados, fornecidos pela API; base inicia vazia. */
(function(global){
'use strict';
const categories=[
 {id:'compras',label:'Compras e pesagem',description:'Recebimento e canhotos'},
 {id:'comercial',label:'Clientes e vendas',description:'Pedidos e faturamento'},
 {id:'fiscal',label:'Fiscal',description:'Notas e apuração'},
 {id:'financeiro',label:'Financeiro',description:'Pagamentos e recebimentos'},
 {id:'estoque',label:'Estoque e almoxarifado',description:'Materiais e movimentações'},
 {id:'pessoas',label:'Equipe e capacitações',description:'RH e certificados'},
 {id:'gestao',label:'Gestão e contratos',description:'Contratos e vencimentos'},
 {id:'seguranca',label:'Acesso e segurança',description:'Usuários e problemas'}
];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
let articles=[];let selected='';let query='';let category='todos';let page=1;let requestNo=0;
const PAGE=8;
function search(text='',cat='todos'){
 const words=norm(text).split(/\s+/).filter(Boolean);
 return articles.filter(a=>(cat==='todos'||a.category===cat) && words.every(word=>norm([a.title,a.summary,a.keywords,...(a.steps||[])].join(' ')).includes(word)));
}
function shell(host){
 host.classList.add('mm-help-root');
 host.innerHTML=`<div class="mm-help-hero"><div class="mm-help-hero-copy"><span class="mm-help-eyebrow">CENTRAL DE CONHECIMENTO · MANUELA METAIS</span><h1>Como podemos ajudar?</h1><p>Pesquise instruções e procedimentos publicados pela equipe responsável pelo ERP.</p><label class="mm-help-searchbox"><span aria-hidden="true">⌕</span><input id="mm-help-search" type="search" placeholder="Pesquisar dúvida, módulo ou procedimento" autocomplete="off"></label></div><div class="mm-help-hero-illustration"><span class="mm-help-hero-circle" aria-hidden="true">?</span></div></div>
 <div class="mm-help-home-content"><div class="mm-help-section-heading"><div><span class="mm-help-kicker">BIBLIOTECA INTERNA</span><h2>Explore por assunto</h2><p>Os conteúdos aparecerão à medida que forem publicados pela engenharia.</p></div><span id="mm-help-total" class="mm-help-count">0 artigos publicados</span></div>
 <div class="mm-help-category-grid">${categories.map(c=>`<button class="mm-help-category" type="button" data-category="${esc(c.id)}"><span class="mm-help-category-icon">▤</span><span><strong>${esc(c.label)}</strong><small>${esc(c.description)}</small></span></button>`).join('')}</div>
 <div class="mm-help-section-heading"><div><span class="mm-help-kicker">ARTIGOS PUBLICADOS</span><h2>Guias e orientações</h2></div></div>
 <div class="mm-help-filter-row"><label>Categoria <select id="mm-help-category"><option value="todos">Todas as categorias</option>${categories.map(c=>`<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select></label></div>
 <div id="mm-help-list" class="mm-help-recommend-grid" aria-live="polite"></div><div id="mm-help-pagination" class="mm-help-pager"></div><div id="mm-help-article-detail" class="mm-help-detail" hidden></div></div>`;
 host.querySelector('#mm-help-search').value=query;
 host.querySelector('#mm-help-search').oninput=e=>{query=e.target.value;page=1;selected='';update(host);};
 host.querySelector('#mm-help-category').value=category;
 host.querySelector('#mm-help-category').onchange=e=>{category=e.target.value;page=1;selected='';update(host);};
 host.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{category=b.dataset.category;page=1;selected='';host.querySelector('#mm-help-category').value=category;update(host);host.querySelector('#mm-help-list').scrollIntoView({block:'start',behavior:'smooth'});});
 update(host);
}
function update(host){
 const total=host.querySelector('#mm-help-total');if(total)total.textContent=articles.length+' artigo(s) publicado(s)';
 const found=search(query,category),pages=Math.max(1,Math.ceil(found.length/PAGE));page=Math.min(pages,page);
 const list=host.querySelector('#mm-help-list'),pager=host.querySelector('#mm-help-pagination'),detail=host.querySelector('#mm-help-article-detail');if(!list)return;
 const visible=found.slice((page-1)*PAGE,page*PAGE);
 list.innerHTML=visible.length?visible.map(a=>`<button type="button" class="mm-help-article" data-article="${esc(a.id)}"><span class="mm-help-article-icon">?</span><span class="mm-help-article-text"><span class="mm-help-article-type">${esc(categories.find(c=>c.id===a.category)?.label||'Guia')}</span><strong>${esc(a.title)}</strong><small>${esc(a.summary)}</small></span></button>`).join(''):`<div class="mm-help-empty"><h3>${articles.length?'Nenhum artigo corresponde à pesquisa.':'A Central de Ajuda está sendo preparada'}</h3><p>${articles.length?'Tente outros termos ou escolha outra categoria.':'Os guias serão disponibilizados aqui após a publicação pela equipe de engenharia.'}</p></div>`;
 pager.innerHTML=found.length>PAGE?`<span>${found.length} resultados · página ${page} de ${pages}</span><div><button data-page="prev" ${page===1?'disabled':''}>Anterior</button><button data-page="next" ${page===pages?'disabled':''}>Próxima</button></div>`:'';
 list.querySelectorAll('[data-article]').forEach(b=>b.onclick=()=>{selected=b.dataset.article;updateDetail(host);});
 pager.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{page+=b.dataset.page==='next'?1:-1;update(host);});
 if(!selected||!found.some(a=>a.id===selected))detail.hidden=true;else updateDetail(host);
}
function updateDetail(host){
 const a=articles.find(x=>x.id===selected),detail=host.querySelector('#mm-help-article-detail');if(!a||!detail)return;
 detail.hidden=false;
 const moduleAllowed=a.module && global.erpCanAccessTab?.(a.module) && document.getElementById('tab-'+a.module);
 detail.innerHTML=`<div class="mm-help-detail-head"><span class="mm-help-article-type">${esc(categories.find(c=>c.id===a.category)?.label||'Artigo')}</span><h2>${esc(a.title)}</h2><p>${esc(a.summary)}</p></div><div class="mm-help-guide"><h3>Passo a passo</h3><ol>${(a.steps||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ol>${a.warning?`<div class="mm-help-warning"><strong>Atenção</strong><p>${esc(a.warning)}</p></div>`:''}</div>${moduleAllowed?`<button type="button" class="mm-help-open-module">Abrir módulo</button>`:''}<button type="button" class="mm-help-copy">Copiar orientação</button>`;
 detail.querySelector('.mm-help-open-module')?.addEventListener('click',()=>{if(global.erpCanAccessTab?.(a.module))global.switchTab?.(a.module);});
 detail.querySelector('.mm-help-copy')?.addEventListener('click',()=>{global.navigator?.clipboard?.writeText([a.title,a.summary,...(a.steps||[])].join('\n')).catch(()=>{});});
 detail.scrollIntoView({block:'nearest',behavior:'smooth'});
}
async function render(host){
 if(!host)return;
 const current=++requestNo;
 shell(host);
 const place=host.querySelector('#mm-help-list');place.innerHTML='<p class="mm-help-empty">Carregando artigos publicados...</p>';
 try{
   const user=global.__fbRaw?.auth?.currentUser;
   if(!user)throw Error('Acesse o ERP para consultar a Central de Ajuda.');
   const token=await user.getIdToken();
   const response=await fetch('/api/help/articles',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
   if(!response.ok)throw Error('Não foi possível carregar os artigos.');
   const result=await response.json();
   if(current!==requestNo)return;
   articles=Array.isArray(result.articles)?result.articles.filter(a=>a.status==='published'):[];
   update(host);
 }catch(error){if(current===requestNo)place.innerHTML=`<div class="mm-help-empty"><h3>Ajuda indisponível</h3><p>${esc(error.message)}</p></div>`;}
}
global.ERPHelpCenter=Object.freeze({render,search,categories,articles:()=>articles});
})(window);
