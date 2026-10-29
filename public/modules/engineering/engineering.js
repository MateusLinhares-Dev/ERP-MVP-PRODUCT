/* A área de engenharia usa somente APIs autenticadas. Nenhum dado sensível no browser/localStorage. */
(function(global){'use strict';
const $=(selector,root=document)=>root.querySelector(selector);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cats={compras:'Compras e pesagem',comercial:'Clientes e vendas',fiscal:'Fiscal',financeiro:'Financeiro',estoque:'Estoque',pessoas:'Pessoas e capacitações',gestao:'Gestão',seguranca:'Segurança'};
const tabs=['engineering_logs','engineering_help'];
let logs=[],cursor=null,stack=[],filters={},articles=[],selected='',saving=false,engineerSession=false;
const currentUser=()=>global.__fbRaw?.auth?.currentUser;
async function call(url,opts={}){
 const user=currentUser();if(!user)throw Error('Sessão expirada. Entre novamente.');
 const token=await user.getIdToken();
 const res=await fetch(url,{cache:'no-store',credentials:'same-origin',...opts,headers:{Authorization:'Bearer '+token,...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})}});
 const value=await res.json().catch(()=>({}));if(!res.ok)throw Error(value.message||'Erro de comunicação com o servidor.');return value;
}
function show(id){for(const tab of tabs){const el=$('#tab-'+tab);if(el)el.classList.toggle('active',tab===id);}global.switchTab?.(id);if(id==='engineering_logs')loadLogs();else loadArticles();}
function addNav(){
 if(!engineerSession)return;
 const nav=$('#nav-bar');if(!nav||nav.querySelector('[data-tab="engineering_logs"]'))return;
 let group=document.createElement('div');group.className='sb-group open mm-eng-group';
 group.innerHTML='<div class="sb-group-hdr"><span class="sb-gicon">⚙</span><span class="sb-glabel">Engenharia</span><span class="sb-arr">▶</span></div><div class="sb-items"></div>';
 group.querySelector('.sb-group-hdr').onclick=()=>group.classList.toggle('open');
 for(const [id,label,icon] of [['engineering_logs','Auditoria e logs','▤'],['engineering_help','Gestão da Ajuda','✎']]){
   const tab=document.createElement('section');tab.className='tab-panel mm-eng-panel';tab.id='tab-'+id;$('.app-body .content')?.append(tab);
   const a=document.createElement('div');a.className='nav-tab';a.dataset.tab=id;a.innerHTML=`<span class="nt-icon">${icon}</span><span class="nt-label">${label}</span>`;
   a.onclick=()=>show(id);group.querySelector('.sb-items').append(a);
 }
 nav.append(group);drawLogs();drawEditor();
}
async function initialize(){
 try{
  const profile=global.erpIsEngineer?.()===true;
  const token=await currentUser()?.getIdTokenResult();
  engineerSession=profile&&token?.claims?.engineer===true&&token?.claims?.erpUser==='engadministrator';
  if(engineerSession)addNav();
 }catch(_){engineerSession=false;}
}
function drawLogs(){const host=$('#tab-engineering_logs');if(!host)return;
 host.innerHTML=`<header class="mm-eng-hero"><div><small>ENGENHARIA · OBSERVABILIDADE</small><h1>Auditoria e logs</h1><p>Eventos de negócio, autenticação e falhas recebidas pelo ERP. Sem expor tokens, senhas ou conteúdo dos documentos.</p></div><button id="eng-logs-refresh">Atualizar</button></header>
 <section class="mm-eng-card"><form id="eng-filters" class="mm-eng-filters"><label>Módulo<input name="module" placeholder="Ex.: fiscal, contratos"></label><label>Nível<select name="level"><option value="">Todos</option><option>error</option><option>warn</option><option>info</option></select></label><label>Usuário<input name="actor" placeholder="Login"></label><label>Buscar evento<input name="term" placeholder="Ação, código, entidade"></label><label>De<input type="datetime-local" name="from"></label><label>Até<input type="datetime-local" name="to"></label><button class="mm-eng-primary" type="submit">Filtrar</button><button type="button" id="eng-clear">Limpar</button></form></section>
 <section class="mm-eng-card"><div class="mm-eng-row"><div><h2>Histórico de eventos</h2><p id="eng-logs-hint">Carregue para consultar</p></div><button type="button" id="eng-csv">Exportar página (CSV)</button></div><div class="mm-eng-overflow"><table class="mm-eng-table"><thead><tr><th>Data / hora</th><th>Nível</th><th>Módulo</th><th>Evento</th><th>Usuário</th><th>Origem</th><th>Identificação</th></tr></thead><tbody id="eng-logs-body"></tbody></table></div><div id="eng-logs-pager" class="mm-eng-row"></div></section>`;
 $('#eng-logs-refresh',host).onclick=()=>{stack=[];cursor=null;loadLogs();};
 $('#eng-filters',host).onsubmit=e=>{e.preventDefault();filters=Object.fromEntries(new FormData(e.currentTarget).entries());stack=[];cursor=null;loadLogs();};
 $('#eng-clear',host).onclick=()=>{filters={};$('#eng-filters',host).reset();stack=[];cursor=null;loadLogs();};
 $('#eng-csv',host).onclick=downloadCsv;
}
function qs(){const s=new URLSearchParams({limit:'50'});if(cursor)s.set('cursor',cursor);for(const [k,v] of Object.entries(filters)){if(!v)continue;let x=v;if(['from','to'].includes(k))x=String(new Date(v).getTime());s.set(k,x);}return s.toString();}
async function loadLogs(){const body=$('#eng-logs-body'),pager=$('#eng-logs-pager');if(!body)return;body.innerHTML='<tr><td colspan="7">Consultando registros...</td></tr>';
 try{const result=await call('/api/engineering/logs?'+qs());logs=result.events||[];
  body.innerHTML=logs.length?logs.map(e=>`<tr><td>${esc(new Date(e.ts).toLocaleString('pt-BR'))}</td><td><span class="mm-eng-level ${esc(e.level)}">${esc(e.level)}</span></td><td>${esc(e.module)}</td><td>${esc(e.action)}</td><td>${esc(e.actorLogin)}</td><td>${esc(e.source)}</td><td>${esc([e.entityType,e.entityId,e.code].filter(Boolean).join(' / '))}</td></tr>`).join(''):'<tr><td colspan="7">Sem eventos nesta página para os filtros escolhidos.</td></tr>';
  $('#eng-logs-hint').textContent=`${logs.length} evento(s) exibido(s) · consultas limitadas para preservar a performance.`;
  pager.innerHTML=`<span>Histórico paginado · filtros aplicados à janela consultada</span><div><button id="eng-prev" ${!stack.length?'disabled':''}>Anterior</button><button id="eng-next" ${!result.nextCursor?'disabled':''}>Próxima</button></div>`;
  $('#eng-prev').onclick=()=>{cursor=stack.pop()||null;loadLogs();};
  $('#eng-next').onclick=()=>{stack.push(cursor);cursor=result.nextCursor;loadLogs();};
 }catch(e){body.innerHTML='<tr><td colspan="7">'+esc(e.message)+'</td></tr>';}
}
function downloadCsv(){
 const cols=['ts','level','module','action','actorLogin','source','entityType','entityId','code'];
 const quote=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,'\'$&').replace(/"/g,'""')+'"';
 const content='\ufeff'+[cols.join(';'),...logs.map(o=>cols.map(k=>quote(o[k])).join(';'))].join('\r\n');
 const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='auditoria-erp.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function drawEditor(){const host=$('#tab-engineering_help');if(!host)return;
 host.innerHTML=`<header class="mm-eng-hero"><div><small>ENGENHARIA · BASE DE CONHECIMENTO</small><h1>Gestão da Central de Ajuda</h1><p>Crie, revise e publique guias reais do ERP. Rascunhos são privados; apenas artigos publicados aparecem para os funcionários.</p></div><button id="eng-help-refresh">Atualizar</button></header>
 <div class="mm-eng-editor-layout"><section class="mm-eng-card"><div class="mm-eng-row"><h2>Artigos</h2><button class="mm-eng-primary" id="eng-help-new">+ Novo artigo</button></div><input id="eng-help-find" placeholder="Buscar artigo" aria-label="Buscar artigo"><div id="eng-help-list" class="mm-eng-help-list"></div></section>
 <section class="mm-eng-card"><div class="mm-eng-row"><div><h2 id="eng-edit-title">Novo artigo</h2><p>Texto simples: scripts e HTML não são executados.</p></div><span id="eng-edit-status">Rascunho</span></div>
 <form id="eng-help-form"><div class="mm-eng-form-grid"><label>Título<input name="title" maxlength="130" required></label><label>Categoria<select name="category">${Object.entries(cats).map(([id,v])=>`<option value="${esc(id)}">${esc(v)}</option>`).join('')}</select></label></div>
 <label>Resumo<textarea name="summary" rows="2" maxlength="300" required></textarea></label><label>Palavras-chave (opcional)<input name="keywords" maxlength="260"></label><label>Passo a passo (um passo por linha)<textarea name="steps" rows="7" maxlength="10500" placeholder="1º passo...&#10;2º passo..."></textarea></label><label>Cuidados e avisos<textarea name="warning" rows="3" maxlength="500"></textarea></label>
 <div class="mm-eng-form-grid"><label>Módulo correspondente (opcional)<input name="module" maxlength="60" placeholder="Ex.: fiscal"></label><label>Publicação<select name="status"><option value="draft">Rascunho — privado</option><option value="published">Publicado — visível aos usuários</option></select></label></div>
 <div class="mm-eng-row"><span role="status" id="eng-help-message"></span><div><button type="button" class="mm-eng-danger" id="eng-help-delete" hidden>Excluir</button><button type="submit" class="mm-eng-primary" id="eng-help-save">Salvar artigo</button></div></div></form></section></div>`;
 $('#eng-help-refresh').onclick=loadArticles;
 $('#eng-help-new').onclick=()=>selectArticle('');
 $('#eng-help-find').oninput=()=>renderArticleList();
 $('#eng-help-form').onsubmit=saveArticle;
 $('#eng-help-delete').onclick=deleteArticle;
 selectArticle('');
}
async function loadArticles(){const area=$('#eng-help-list');if(!area)return;area.textContent='Carregando artigos...';try{const v=await call('/api/help/articles');articles=v.articles||[];renderArticleList();}catch(e){area.textContent=e.message;}}
function renderArticleList(){const area=$('#eng-help-list');if(!area)return;const q=($('#eng-help-find')?.value||'').toLowerCase();const found=articles.filter(a=>[a.title,a.summary,a.category].join(' ').toLowerCase().includes(q)).slice(0,100);
 area.innerHTML=found.length?found.map(a=>`<button type="button" class="${a.id===selected?'chosen':''}" data-article="${esc(a.id)}"><strong>${esc(a.title)}</strong><small>${esc(cats[a.category])} · ${a.status==='published'?'Publicado':'Rascunho'}</small></button>`).join(''):'<div class="mm-eng-empty">Nenhum artigo cadastrado. Use “Novo artigo”.</div>';
 area.querySelectorAll('[data-article]').forEach(b=>b.onclick=()=>selectArticle(b.dataset.article));
}
function selectArticle(id){selected=id;const a=articles.find(x=>x.id===id)||{};const form=$('#eng-help-form');if(!form)return;form.reset();
 for(const k of ['title','summary','keywords','warning','module','status','category']){if(a[k]!=null)form.elements[k].value=a[k];}
 form.elements.steps.value=(a.steps||[]).join('\n');
 $('#eng-edit-title').textContent=id?'Editar artigo':'Novo artigo';$('#eng-edit-status').textContent=id?(a.status==='published'?'Publicado':'Rascunho'):'Rascunho';$('#eng-help-delete').hidden=!id;$('#eng-help-message').textContent='';renderArticleList();
}
async function saveArticle(event){event.preventDefault();if(saving)return;const form=event.currentTarget;const data=new FormData(form);const payload=Object.fromEntries(data.entries());payload.steps=String(payload.steps||'').split('\n').map(x=>x.trim()).filter(Boolean);const item=articles.find(x=>x.id===selected);
 saving=true;$('#eng-help-save').disabled=true;$('#eng-help-save').textContent='Salvando...';$('#eng-help-message').textContent='Validando e registrando...';
 try{const result=await call('/api/help/articles',{method:'POST',body:JSON.stringify({action:'save',id:selected||undefined,revision:item?.revision||0,article:payload})});selected=result.id;$('#eng-help-message').textContent='Artigo salvo com segurança.';await loadArticles();selectArticle(selected);}
 catch(e){$('#eng-help-message').textContent=e.message;}
 finally{saving=false;$('#eng-help-save').disabled=false;$('#eng-help-save').textContent='Salvar artigo';}
}
async function deleteArticle(){if(saving||!selected)return;const a=articles.find(x=>x.id===selected);if(!a||!confirm('Excluir permanentemente este artigo?'))return;saving=true;$('#eng-help-delete').disabled=true;
 try{await call('/api/help/articles',{method:'POST',body:JSON.stringify({action:'delete',id:selected,revision:a.revision})});selected='';await loadArticles();selectArticle('');}
 catch(e){$('#eng-help-message').textContent=e.message;}finally{saving=false;$('#eng-help-delete').disabled=false;}
}
// Falhas JS e promessas rejeitadas: envio de metadados apenas; sem stack/URL com query/tokens.
let lastTelemetry=0;
function report(kind,code){const now=Date.now();if(now-lastTelemetry<1500||!currentUser())return;lastTelemetry=now;
 const path=location.pathname.slice(0,100);
 Promise.resolve().then(()=>currentUser().getIdToken()).then(token=>fetch('/api/engineering/telemetry',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({kind,code:String(code||'UNKNOWN').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,50),module:($('.tab-panel.active')?.id||'frontend').replace(/^tab-/,'').slice(0,40),path})})).catch(()=>{});
}
global.addEventListener('error',e=>report('js_error',e?.error?.name||'JavaScriptError'));
global.addEventListener('unhandledrejection',()=>report('unhandled_rejection','PromiseRejection'));
document.addEventListener('erp:user-started',()=>{queueMicrotask(initialize);});
global.ERPEngineering={initialize};
})(window);
