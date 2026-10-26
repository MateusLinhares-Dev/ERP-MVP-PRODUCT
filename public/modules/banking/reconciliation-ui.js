/* Workspace de conciliação: seleção N:N, diferenças, criação idempotente e confirmação no servidor. */
(function(root){
'use strict';
const ofx=root.erpBankReconciliationDomain;
const money=root.erpBankLedger;
let workspace=null;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cents=value=>BigInt(value||'0');
const abs=value=>{const n=cents(value);return n<0n?-n:n;};
const fmt=value=>{const n=abs(value).toString().padStart(3,'0');return 'R$ '+n.slice(0,-2).replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+n.slice(-2);};
const dateBR=s=>{const iso=money.isoDate(s);return iso?iso.slice(8)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4):s||'—';};
function notify(msg,type='info'){
  if(!workspace)return;
  const el=workspace.el.querySelector('[data-notice]');
  if(!el)return;
  el.textContent=msg;
  el.dataset.type=msg?type:'info';
}
function origin(){const sources=typeof root.erpReconciliationSources==='function'?root.erpReconciliationSources():{banks:[]};return sources;}
async function identity(){
  const user=root.firebase?.auth()?.currentUser;if(!user)throw new Error('Sessão encerrada. Entre novamente no ERP.');
  const token=await user.getIdTokenResult();
  if(token.claims.erpAccess!==true||token.claims.canBanking!==true)throw new Error('Acesso bancário não autorizado.');
  return {user,claims:token.claims};
}
async function api(body){
  const {user}=await identity();
  const response=await fetch('/api/banking/reconcile',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await user.getIdToken()},body:JSON.stringify({...body,bankCode:workspace.code})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){
    const requestId=response.headers?.get('X-Request-Id')||'';
    const text=payload.error||payload.message||`Falha no servidor (${response.status})`;
    const suffix=response.status>=500&&requestId?` · Referência: ${requestId}`:'';
    const error=new Error(text+suffix);
    error.status=response.status;
    error.code=payload.code||'';
    error.requestId=requestId;
    throw error;
  }
  return payload;
}
function imported(){return Object.values(workspace.imports||{}).filter(r=>r&&r.id);}
function decisions(){
  // Nunca misturar listener/cache local com autorização transacional. O estado
  // exibido vem exclusivamente do snapshot calculado pela mesma API que grava.
  return new Map(Object.entries(workspace?.effectiveDecisions||{}));
}
function isDone(d){return ['reconciled','classified','archived'].includes(d?.status);}
function canUndo(d){return ['reconciled','classified','archived','partial'].includes(d?.status);}
function targetKey(t){return t.kind+':'+t.id;}
function consumed(exceptId){
  const amounts=new Map();
  decisions().forEach((d,importId)=>{
    if(importId===exceptId||d.status==='reversed')return;
    const allocations=Array.isArray(d.allocations)?d.allocations:(d.status==='reconciled'&&d.targetId?[{kind:d.targetKind,id:d.targetId,amountCents:workspace.imports[importId]?abs(workspace.imports[importId].amountCents).toString():'0'}]:[]);
    allocations.forEach(a=>{const key=targetKey(a);amounts.set(key,(amounts.get(key)||0n)+abs(a.amountCents));});
  });return amounts;
}
function available(t){
  const used=consumed(workspace.selected).get(targetKey(t))||0n;
  const value=abs(money.toCents(t.amount));return value>used?value-used:0n;
}
function canPair(movement,target){
  const sign=cents(movement.amountCents)>0n;
  return target.kind==='bankEntry' ? target.direction===(sign?'income':'expense'):
    sign?target.kind==='receivable':target.kind==='payable';
}
function suggestions(movement){
  return (workspace.targets||[]).filter(t=>t?.id&&canPair(movement,t)&&available(t)>0n)
    .map(t=>{
      const remaining=available(t),amount=abs(movement.amountCents);
      const days=Math.min(60,Math.floor(Math.abs(Date.parse(movement.date)-Date.parse(t.date))/86400000)||45);
      const words=new Set(String(movement.description||'').toLowerCase().split(/\W+/).filter(w=>w.length>3));
      const overlap=String(t.description||'').toLowerCase().split(/\W+/).filter(w=>words.has(w)).length;
      const score=(remaining===amount?85:remaining<amount?50:28)-days+overlap*6+(t.kind==='bankEntry'?22:0);
      return {...t,score,remainingCents:remaining.toString()};
    }).sort((a,b)=>b.score-a.score);
}
function proposalCombos(movement){
  const target=abs(movement.amountCents),candidates=suggestions(movement).filter(t=>t.kind!=='bankEntry'&&cents(t.remainingCents)<=target).slice(0,14);
  const matches=[];
  function dfs(index,items,sum){
    if(matches.length>=4)return;
    if(sum===target){if(items.length>1)matches.push(items);return;}
    if(items.length>=4)return;
    for(let i=index;i<candidates.length;i++){
      const value=cents(candidates[i].remainingCents);
      if(value>0n&&sum+value<=target)dfs(i+1,[...items,candidates[i]],sum+value);
      if(matches.length>=4)return;
    }
  }
  dfs(0,[],0n);return matches;
}
function due(){
  const selection=workspace.allocation;
  return Object.values(selection).reduce((sum,part)=>sum+cents(part.amountCents),0n);
}
function draft(){
  const pane=workspace?.el.querySelector('[data-detail]');
  const field=name=>pane?.querySelector(`[name="${name}"]`)?.value||'';
  workspace.meta={category:field('category'),costCenter:field('costCenter'),notes:field('notes'),adjustment:field('adjustment')};
}
function adjustCents(){return money.toCents(workspace.meta?.adjustment||'0');}
function setAllocation(target,amount){
  const id=targetKey(target);
  if(!amount||cents(amount)<=0n)delete workspace.allocation[id];
  else workspace.allocation[id]={kind:target.kind,id:target.id,amountCents:String(amount)};
}
function itemStatus(entry){const d=decisions().get(entry.id);return d?.status||'pending';}
function statusLabel(value){return ({reconciled:'Conciliado',classified:'Classificado',archived:'Arquivado',partial:'Parcial',reversed:'Reaberto',pending:'Pendente'})[value]||'Pendente';}
function totals(){
  const entries=imported(),stats={total:entries.length,pending:0,partial:0,reconciled:0,classified:0,archived:0};
  entries.forEach(e=>{
    const st=itemStatus(e);
    if(['reconciled','classified','partial','archived'].includes(st))stats[st]++;
    else stats.pending++;
  });
  return stats;
}
function renderList(){
  if(!workspace)return;
  const state=workspace,el=state.el,query=el.querySelector('[name=search]').value.toLowerCase().trim(),filter=el.querySelector('[name=filter]').value;
  const totalsNow=totals();for(const [key,value] of Object.entries(totalsNow)){const e=el.querySelector(`[data-stat="${key}"]`);if(e)e.textContent=value;}
  const direction=el.querySelector('[name=direction]').value;
  const entries=imported().filter(e=>{
    const st=itemStatus(e),include=filter==='all'||st===filter||(filter==='pending'&&st==='reversed');
    return include&&(!direction||(direction==='income' ? cents(e.amountCents)>0n : cents(e.amountCents)<0n))&&(!query||(e.description+' '+e.date+' '+e.fitid).toLowerCase().includes(query));
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.id).localeCompare(String(b.id)));
  el.querySelector('[data-list]').innerHTML=entries.map(e=>{
    const st=itemStatus(e),val=cents(e.amountCents),checked=state.bulk.has(e.id)?'checked':'';
    const hasLink=canUndo(decisions().get(e.id));
    return '<div class="erp-rec-line '+(state.selected===e.id?'active':'')+'"><label class="erp-rec-bulk"><input type="checkbox" data-bulk="'+esc(e.id)+'" '+checked+' aria-label="Selecionar movimento"></label>'+ 
      '<button type="button" class="erp-rec-entry" data-open="'+esc(e.id)+'"><span><time>'+esc(dateBR(e.date))+'</time><em class="erp-rec-status '+esc(st)+'">'+statusLabel(st)+'</em></span><strong class="'+(val<0n?'expense':'income')+'">'+(val<0n?'− ': '+ ')+fmt(val)+'</strong><small>'+esc(e.description)+'</small></button>'+ 
      (hasLink?'<button type="button" class="erp-rec-quick-undo" data-quick-undo="'+esc(e.id)+'" title="Desfazer o estado atual preservando o histórico">'+(st==='archived'?'Reabrir':'Desfazer')+'</button>':'')+'</div>';
  }).join('')||'<div class="erp-rec-empty">Nenhum movimento encontrado.</div>';
  el.querySelector('[data-bulk-count]').textContent=state.bulk.size+' selecionado(s)';
  el.querySelector('[data-batch]').disabled=!state.bulk.size||state.busy;
  renderDetail();
}
function sumFields(){
  const movement=workspace.imports[workspace.selected];if(!movement)return '';
  let adjust=0n;try{adjust=adjustCents();}catch(e){}
  const rem=abs(movement.amountCents)-due()-adjust;
  return '<div class="erp-rec-balance"><span>Selecionado <b>'+fmt(due())+'</b></span><span>Ajuste <b>'+fmt(adjust)+'</b></span><span class="'+(rem!==0n?'attention':'')+'">Diferença <b>'+ (rem<0n?'− ':'')+fmt(rem)+'</b></span></div>';
}
function renderDetail(){
  const state=workspace,el=state.el,pane=el.querySelector('[data-detail]'),entry=state.imports[state.selected];
  if(!entry){pane.innerHTML='<p class="erp-rec-empty">Selecione uma movimentação bancária.</p>';return;}
  const d=decisions().get(entry.id),done=isDone(d),partial=d?.status==='partial';
  const history=[...Object.values(state.events||{}),...Object.values(state.state?.audit||{})].filter(e=>e.importId===entry.id).sort((a,b)=>Number(b.createdAt)-Number(a.createdAt));
  const audit='<details class="erp-rec-audit"><summary>Histórico ('+history.length+')</summary><ol>'+history.map(h=>'<li>'+esc(new Date(h.createdAt).toLocaleString('pt-BR'))+' · '+esc(statusLabel(h.status))+' · '+esc(h.actor||'—')+'</li>').join('')+'</ol></details>';
  const head='<div class="erp-rec-selected"><div><h3>'+esc(entry.description)+'</h3><small>'+esc(dateBR(entry.date))+' · '+esc(entry.fitid||entry.id)+'</small></div><strong>'+fmt(entry.amountCents)+'</strong></div>';
  if(done){
    const allocs=Array.isArray(d.allocations)?d.allocations:(d.targetId?[{kind:d.targetKind,id:d.targetId,amountCents:abs(entry.amountCents).toString()}]:[]);
    pane.innerHTML=head+'<div class="erp-rec-complete"><h4>'+statusLabel(d.status)+'</h4>'+allocs.map(a=>'<p>'+esc(a.kind)+' · '+esc(a.id)+' — '+fmt(a.amountCents)+'</p>').join('')+
      '<p>Categoria: '+esc(d.category||'—')+'</p><p>Centro de custo: '+esc(d.costCenter||'—')+'</p><p>Responsável: '+esc(d.actor||'—')+'</p></div>'+audit+
      '<div class="erp-rec-actions"><button type="button" data-undo class="erp-reconcile-secondary">'+(d.status==='archived'?'Reabrir movimentação':d.status==='classified'?'Desfazer classificação':'Desfazer conciliação')+'</button></div>';
    pane.querySelector('[data-undo]').addEventListener('click',()=>runAction({action:'undo',importId:entry.id},true));return;
  }
  if(partial&&!state.initializedDraft){
    state.allocation=Object.fromEntries((d.allocations||[]).map(a=>[targetKey(a),a]));
    state.meta={category:d.category||'',costCenter:d.costCenter||'',notes:d.notes||'',adjustment:money.brl(Number(d.adjustmentCents||0)/100)};
    state.initializedDraft=true;
  }
  const suggestionsAll=suggestions(entry),q=state.targetQuery.toLowerCase().trim();
  const candidates=suggestionsAll.filter(t=>!q||(t.description+' '+t.id+' '+t.kind).toLowerCase().includes(q));
  const groupOptions=proposalCombos(entry);
  const typeLabel={bankEntry:'Movimento no ERP',payable:'Conta a pagar',receivable:'Conta a receber'};
  pane.innerHTML=head+
    (d?.status==='reversed'?'<p class="erp-rec-reopened">Conciliação anterior já desfeita. Selecione um ou mais lançamentos abaixo e confirme a nova conciliação.</p>':'')+
    '<div class="erp-rec-form-header"><h4>Relacionar lançamentos</h4><span>'+candidates.length+' opções disponíveis</span></div>'+ 
    '<label class="erp-rec-search-label">Pesquisar títulos<input type="search" data-target-search placeholder="Fornecedor, cliente, documento ou ID" value="'+esc(state.targetQuery)+'"></label>'+ 
    (groupOptions.length?'<div class="erp-rec-group-row"><span>Combinações encontradas</span>'+groupOptions.map((group,i)=>'<button type="button" data-group="'+i+'">'+group.length+' lançamentos · '+fmt(entry.amountCents)+'</button>').join('')+'</div>':'')+
    '<div class="erp-rec-targets">'+candidates.slice(0,60).map(t=>{
      const key=targetKey(t),selected=state.allocation[key],value=selected?selected.amountCents:'0';
      const amountShown=selected?fmt(value):fmt(t.remainingCents);
      return '<div class="erp-rec-target '+(selected?'selected':'')+'"><label><input type="checkbox" data-target="'+esc(key)+'" '+(selected?'checked':'')+'><span><strong>'+esc(t.description||t.id)+'</strong><small>'+esc(typeLabel[t.kind])+' · '+esc(dateBR(t.date))+' · Disponível '+fmt(t.remainingCents)+'</small></span></label>'+ 
        '<input type="text" data-amount="'+esc(key)+'" inputmode="decimal" aria-label="Valor a conciliar" value="'+esc(amountShown)+'" '+(!selected?'disabled':'')+'></div>';
    }).join('')+'</div>'+ 
    '<div class="erp-rec-fields"><label>Ajuste (+ tarifa / − desconto)<input name="adjustment" inputmode="decimal" placeholder="0,00" value="'+esc(state.meta.adjustment||'0')+'"></label>'+ 
    '<label>Categoria<input name="category" maxlength="90" placeholder="Categoria" value="'+esc(state.meta.category||'')+'"></label>'+ 
    '<label>Centro de custo<input name="costCenter" maxlength="90" placeholder="Centro de custo" value="'+esc(state.meta.costCenter||'')+'"></label>'+ 
    '<label class="wide">Observações<textarea name="notes" maxlength="500" rows="2">'+esc(state.meta.notes||'')+'</textarea></label></div>'+ 
    '<div data-balance>'+sumFields()+'</div>'+ 
    '<div class="erp-rec-title-form" data-title-form hidden></div>'+
    '<div class="erp-rec-actions"><button type="button" class="erp-reconcile-secondary" data-create>Registrar movimento no ERP</button><button type="button" class="erp-reconcile-secondary" data-title>Criar título financeiro</button><button type="button" class="erp-reconcile-secondary" data-archive>Arquivar</button><button type="button" class="erp-reconcile-secondary" data-classify>Classificar</button>'+ 
    (partial?'<button type="button" class="erp-reconcile-secondary" data-undo-partial>Desfazer parcial</button>':'')+
    '<button type="button" class="erp-reconcile-primary" data-confirm>Conciliar seleção</button></div>'+audit;
  pane.querySelector('[data-undo-partial]')?.addEventListener('click',()=>runAction({action:'undo',importId:entry.id},true));
  pane.querySelector('[data-target-search]').addEventListener('input',e=>{draft();state.targetQuery=e.target.value;const start=e.target.selectionStart;renderDetail();const field=pane.querySelector('[data-target-search]');field.focus();field.setSelectionRange(start,start);});
  pane.querySelectorAll('[data-target]').forEach(input=>input.addEventListener('change',()=>{
    draft();const t=candidates.find(t=>targetKey(t)===input.dataset.target);if(!t)return;
    if(input.checked){const remaining=abs(entry.amountCents)-due();const allowed=remaining>0n?remaining:abs(entry.amountCents);const a=cents(t.remainingCents)<allowed?cents(t.remainingCents):allowed;setAllocation(t,a.toString());}
    else setAllocation(t,null);renderDetail();
  }));
  pane.querySelectorAll('[data-amount]').forEach(input=>input.addEventListener('change',()=>{
    draft();const t=candidates.find(t=>targetKey(t)===input.dataset.amount);if(!t)return;
    try{const amount=money.toCents(input.value);if(amount<=0n||amount>cents(t.remainingCents))throw Error('Valor acima do disponível');setAllocation(t,amount.toString());renderDetail();}
    catch(e){notify(e.message,'error');renderDetail();}
  }));
  pane.querySelectorAll('[data-group]').forEach(b=>b.addEventListener('click',()=>{
    draft();state.allocation={};groupOptions[Number(b.dataset.group)].forEach(t=>setAllocation(t,t.remainingCents));renderDetail();
  }));
  pane.querySelectorAll('[name=adjustment]').forEach(field=>field.addEventListener('input',()=>{
    state.meta.adjustment=field.value;pane.querySelector('[data-balance]').innerHTML=sumFields();
  }));
  pane.querySelector('[data-archive]').addEventListener('click',()=>runAction({action:'archive',importId:entry.id},true));
  pane.querySelector('[data-classify]').addEventListener('click',()=>{draft();runAction({action:'classify',importId:entry.id,category:state.meta.category,costCenter:state.meta.costCenter,notes:state.meta.notes,allocations:[]});});
  pane.querySelector('[data-confirm]').addEventListener('click',()=>{
    draft();try{
      const remaining=abs(entry.amountCents)-due()-adjustCents();
      if(remaining<0n)throw Error('Valor selecionado supera a movimentação bancária');
      if(!Object.keys(state.allocation).length)throw Error('Selecione pelo menos um título');
      runAction({action:'reconcile',importId:entry.id,status:remaining===0n?'reconciled':'partial',allocations:Object.values(state.allocation),adjustmentCents:adjustCents().toString(),category:state.meta.category,costCenter:state.meta.costCenter,notes:state.meta.notes});
    }catch(e){notify(e.message,'error');}
  });
  pane.querySelector('[data-create]').addEventListener('click',()=>createBankEntry(entry));
  pane.querySelector('[data-title]').addEventListener('click',()=>titleForm(entry));
}
async function refreshTargets(){
  const state=workspace;
  if(!state)return;
  const request=++state.snapshotSequence;
  const result=await api({action:'snapshot'});
  if(workspace===state&&request===state.snapshotSequence){
    state.targets=result.targets||[];
    state.state=result.state||{decisions:{},audit:{}};
    state.legacyDecisions=result.legacyDecisions||{};
    // Fonte única de verdade: o mesmo mapa efetivo verificado na transação.
    state.effectiveDecisions=result.effectiveDecisions||Object.assign({},state.legacyDecisions,state.state.decisions||{});
    state.snapshotLoaded=true;
    return true;
  }
  return false;
}
async function runAction(body,confirm=false){
  if(!workspace||workspace.busy)return;
  if(confirm&&!root.confirm(body.action==='archive'?'Arquivar a movimentação sem conciliá-la? O registro ficará no histórico.':'Desfazer o vínculo? O histórico ficará preservado.'))return;
  const state=workspace;state.busy=true;try{
    // Confere a decisão transacional mais recente antes de enviar a alteração.
    // Impede que uma interface desatualizada tente substituir um vínculo ativo.
    // Não autoriza a ação com snapshot descartado por uma leitura mais recente.
    // Em caso de listener concorrente, repete a consulta ao servidor.
    let fresh=false;
    for(let attempt=0;attempt<3&&!fresh;attempt++)fresh=await refreshTargets();
    if(workspace!==state)return;
    if(!fresh)throw new Error('O estado da movimentação mudou. Atualize antes de confirmar.');
    if(body.importId){
      const status=decisions().get(body.importId)?.status;
      if(body.action!=='undo'&&['reconciled','classified','archived'].includes(status)){
        throw Object.assign(new Error('Esta movimentação está '+statusLabel(status).toLowerCase()+'. Use Desfazer/Reabrir para alterar.'),{status:409});
      }
      if(body.action==='undo'&&(!status||status==='reversed'||status==='pending')){
        throw Object.assign(new Error('Esta movimentação já está reaberta e pode ser conciliada novamente.'),{status:409});
      }
    }
    await api(body);if(workspace!==state)return;
    await refreshTargets();if(workspace!==state)return;
    state.allocation={};state.meta={category:'',costCenter:'',notes:'',adjustment:'0'};state.initializedDraft=false;
    notify(body.action==='undo'?'Conciliação reaberta.':body.action==='classify'?'Movimento classificado.':body.action==='archive'?'Movimentação arquivada.':'Conciliação gravada no servidor.','ok');
  }catch(e){
    if(e.status===409&&workspace===state){
      // Reconsulta a API (inclusive o fallback legado) em vez de aceitar
      // um listener ainda atrasado como fonte final da decisão financeira.
      try {
        await refreshTargets();
        if(workspace===state){state.allocation={};state.initializedDraft=false;}
      } catch(_) { /* O listener mantém a atualização usual da tela. */ }
    }
    const warning=e.status>=500?' Confira o histórico antes de tentar novamente.':'';
    const current=body.importId?decisions().get(body.importId)?.status:'';
    const informative=e.status===409&&current==='reversed';
    notify(informative?'Esta movimentação já foi reaberta. Selecione um título e confirme a nova conciliação.':e.message+warning,informative?'info':'error');
  }finally{state.busy=false;if(workspace===state)renderList();}
}
function titleForm(entry){
  const wrap=workspace.el.querySelector('[data-title-form]');
  if(!wrap)return;
  wrap.hidden=!wrap.hidden;
  if(wrap.hidden)return;
  const incoming=cents(entry.amountCents)>0n;
  wrap.innerHTML='<h4>'+(incoming?'Novo título a receber':'Nova conta a pagar')+'</h4>'+ 
    '<div class="erp-rec-fields"><label>Cliente / Fornecedor<input name="newParty" maxlength="120" placeholder="Nome ou razão social"></label>'+ 
    '<label>Categoria<input name="newCategory" maxlength="90" placeholder="Categoria financeira"></label>'+ 
    '<label class="wide">Descrição<input name="newDescription" maxlength="240" value="'+esc(entry.description)+'"></label>'+ 
    '<label>Valor do título<input name="newAmount" inputmode="decimal" value="'+fmt(entry.amountCents)+'"></label>'+ 
    (!incoming?'<label>Empresa responsável<input name="newCompany" maxlength="120" value="'+esc(root.__PUBLIC_BUSINESS_CONFIG__?.company?.nome||'')+'"></label>':'')+'</div>'+ 
    '<div class="erp-rec-actions"><button type="button" class="erp-reconcile-primary" data-create-title>Salvar título pendente</button></div>';
  wrap.querySelector('[data-create-title]').addEventListener('click',async()=>{
    const field=name=>wrap.querySelector(`[name="${name}"]`)?.value.trim()||'';
    try{
      const result=await api({action:'create-title',importId:entry.id,party:field('newParty'),category:field('newCategory'),
        description:field('newDescription'),company:field('newCompany'),amountCents:money.toCents(field('newAmount')).toString(),confirm:true});
      await refreshTargets();
      const target=workspace.targets.find(t=>t.id===result.id&&t.kind===result.kind);
      if(target){setAllocation(target,abs(money.toCents(target.amount)).toString());}
      notify(result.created?'Título pendente cadastrado. Revise a seleção para conciliar.':'Título já cadastrado; não foi duplicado.','ok');
      renderDetail();
    }catch(e){notify(e.message,'error');}
  });
}
async function createBankEntry(entry){
  if(!root.confirm('Registrar esta movimentação no extrato do ERP? Isso afetará o saldo bancário. Não use se ela já estiver registrada.'))return;
  try{
    const res=await api({action:'create-bank-entry',importId:entry.id,confirm:true});await refreshTargets();
    notify(res.created?'Movimentação registrada no ERP. Agora vincule o lançamento.':'Esta movimentação já havia sido criada.','ok');renderList();
  }catch(error){notify(error.message,'error');}
}
async function runBatch(){
  if(!workspace||workspace.busy)return;
  const state=workspace;
  const reserved=new Set(),items=[];
  for(const entry of imported().filter(x=>state.bulk.has(x.id)&&!isDone(decisions().get(x.id)))){
    const target=suggestions(entry).find(t=>t.score>=80&&abs(entry.amountCents)===cents(t.remainingCents)&&!reserved.has(targetKey(t)));
    if(!target)continue;reserved.add(targetKey(target));
    items.push({importId:entry.id,status:'reconciled',allocations:[{kind:target.kind,id:target.id,amountCents:target.remainingCents}],adjustmentCents:'0'});
  }
  if(!items.length){notify('Nenhuma correspondência exata disponível para o lote.','error');return;}
  if(!root.confirm(`Conciliar ${items.length} movimentos com correspondência exata? Revise valores e datas antes de confirmar.`))return;
  await runAction({action:'batch',items});state.bulk.clear();renderList();
}
async function sha256(input){const bytes=new TextEncoder().encode(input);const result=await root.crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(result)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function decode(buffer){const bytes=new Uint8Array(buffer),head=new TextDecoder('windows-1252').decode(bytes.slice(0,1024));const latin=/CHARSET\s*:\s*(1252|8859-1)|ENCODING\s*:\s*USASCII/i.test(head);return new TextDecoder(latin?'windows-1252':'utf-8').decode(bytes);}
async function importOfx(file){
  const state=workspace;if(file.size>ofx.MAX_IMPORT_BYTES)throw Error('Arquivo OFX excede 1 MB');
  const source=decode(await file.arrayBuffer());const idInFile=ofx.bankAccountId(source),account=origin().banks.find(b=>b.cod===state.code)?.account||'';
  const digits=s=>String(s||'').replace(/\D/g,'');
  if(idInFile&&account&&digits(idInFile)&&digits(account)&&!digits(idInFile).endsWith(digits(account))&&!digits(account).endsWith(digits(idInFile))){
    if(!root.confirm('Conta do OFX difere da selecionada. Importar mesmo assim?'))return;
  }
  const entries=ofx.parseOfx(source),{user,claims}=await identity();
  let created=0,duplicate=0;
  for(let i=0;i<entries.length;i+=8){
    const results=await Promise.all(entries.slice(i,i+8).map(async entry=>{
      const id='I'+await sha256(state.code+'|'+entry.fingerprint);
      const record={...entry,id,bankCode:state.code,importedBy:String(claims.erpUser||'').slice(0,120),uid:user.uid,importedAt:Date.now()};
      delete record.fingerprint;
      const ref=root._fbRawDB.ref('erp/bankReconciliationImports/'+state.code+'/'+id);
      return (await ref.transaction(prev=>prev===null?record:undefined,undefined,false)).committed;
    }));created+=results.filter(Boolean).length;duplicate+=results.filter(r=>!r).length;
  }
  notify(`${created} importado(s); ${duplicate} duplicado(s) ignorado(s).`,'ok');
}
function close(){if(!workspace)return;const s=workspace;workspace=null;s.snapshotSequence++;if(s.snapshotTimer)clearTimeout(s.snapshotTimer);s.unsubscribe.forEach(fn=>fn());document.removeEventListener('keydown',s.escape);s.el.remove();}
root.erpReconciliationOpen=async function(bankCode){
  try{
    const code=String(bankCode||'');if(!/^[A-Za-z0-9_-]{1,40}$/.test(code))throw Error('Código de banco inválido');
    const session=await identity(),account=origin().banks.find(b=>String(b.cod)===code);
    if(!account)throw Error('Conta bancária não encontrada');
    close();const el=document.createElement('div');el.className='erp-reconcile-overlay';
    el.innerHTML='<section class="erp-reconcile-dialog" role="dialog" aria-modal="true" aria-label="Conciliação bancária">'+
      '<header class="erp-reconcile-heading"><div><h2>Conciliação bancária</h2><p>'+esc(account.name)+' · '+esc(code)+'</p></div><div class="erp-reconcile-heading-actions"><button type="button" class="erp-reconcile-secondary" data-refresh>Atualizar</button><label class="erp-reconcile-upload">Importar OFX<input type="file" accept=".ofx,.OFX" hidden data-import></label><button type="button" class="erp-reconcile-close" data-close>Fechar</button></div></header>'+ 
      '<div class="erp-reconcile-metrics"><div><small>Movimentações</small><strong data-stat="total">0</strong></div><div><small>Pendentes</small><strong data-stat="pending">0</strong></div><div><small>Parciais</small><strong data-stat="partial">0</strong></div><div><small>Conciliadas</small><strong data-stat="reconciled">0</strong></div><div><small>Classificadas</small><strong data-stat="classified">0</strong></div><div><small>Arquivadas</small><strong data-stat="archived">0</strong></div></div>'+ 
      '<p class="erp-reconcile-notice" data-notice role="status" aria-live="polite">Selecione movimentos e confira os lançamentos financeiros.</p>'+ 
      '<div class="erp-rec-toolbar"><span data-bulk-count>0 selecionado(s)</span><button data-batch type="button" class="erp-reconcile-secondary" disabled>Conciliar correspondências exatas em lote</button></div>'+ 
      '<div class="erp-reconcile-columns"><div class="erp-reconcile-left"><div class="erp-reconcile-pane-head"><h3>Extrato bancário</h3><div class="erp-reconcile-filters"><input name="search" type="search" placeholder="Descrição, data ou ID" aria-label="Buscar movimentos"><select name="direction" aria-label="Movimentação"><option value="">Entradas e saídas</option><option value="income">Recebimentos</option><option value="expense">Pagamentos</option></select><select name="filter" aria-label="Situação"><option value="all">Todos</option><option value="pending">Pendentes</option><option value="partial">Parciais</option><option value="reconciled">Conciliados</option><option value="classified">Classificados</option><option value="archived">Arquivados</option></select></div></div><div class="erp-reconcile-list" data-list></div></div>'+ 
      '<div class="erp-reconcile-right"><div class="erp-reconcile-pane-head"><h3>Lançamentos do ERP</h3><p>Selecione os títulos, ajuste valores e confirme.</p></div><div class="erp-reconcile-detail" data-detail></div></div></div></section>';
    document.body.appendChild(el);
    const state={el,code,claims:session.claims,imports:{},events:{},state:{decisions:{},audit:{}},legacyDecisions:null,effectiveDecisions:{},snapshotLoaded:false,snapshotSequence:0,snapshotTimer:null,targets:[],selected:'',allocation:{},bulk:new Set(),meta:{category:'',costCenter:'',notes:'',adjustment:'0'},targetQuery:'',initializedDraft:false,unsubscribe:[],busy:false,escape:e=>{if(e.key==='Escape')close();}};
    workspace=state;document.addEventListener('keydown',state.escape);
    el.querySelector('[data-close]').addEventListener('click',close);
    el.addEventListener('click',e=>{if(e.target===el)close();});
    el.querySelectorAll('[name=search],[name=filter],[name=direction]').forEach(field=>field.addEventListener('input',renderList));
    el.querySelector('[data-batch]').addEventListener('click',runBatch);
    el.querySelector('[data-refresh]').addEventListener('click',async()=>{try{await refreshTargets();renderList();notify('Títulos atualizados.','ok');}catch(e){notify(e.message,'error');}});
    el.querySelector('[data-list]').addEventListener('click',event=>{
      const undo=event.target.closest('[data-quick-undo]');
      if(undo){
        notify('');
        state.selected=undo.dataset.quickUndo;
        state.allocation={};state.initializedDraft=false;
        renderList();
        runAction({action:'undo',importId:state.selected},true);
        return;
      }
      const check=event.target.closest('[data-bulk]');
      if(check){if(check.checked)state.bulk.add(check.dataset.bulk);else state.bulk.delete(check.dataset.bulk);renderList();return;}
      const open=event.target.closest('[data-open]');if(open){notify('');state.selected=open.dataset.open;state.allocation={};state.targetQuery='';state.initializedDraft=false;state.meta={category:'',costCenter:'',notes:'',adjustment:'0'};renderList();}
    });
    el.querySelector('[data-import]').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;e.target.disabled=true;try{await importOfx(file);}catch(error){notify(error.message,'error');}finally{e.target.disabled=false;e.target.value='';}});
    const scheduleSnapshotRefresh=()=>{
      if(workspace!==state||state.snapshotTimer)return;
      state.snapshotTimer=setTimeout(async()=>{
        state.snapshotTimer=null;
        if(workspace!==state)return;
        try{
          const before=JSON.stringify(state.effectiveDecisions);
          if(await refreshTargets()&&workspace===state){
            if(before!==JSON.stringify(state.effectiveDecisions))notify('');
            renderList();
          }
        }catch(error){if(workspace===state)notify('Não foi possível atualizar o estado da conciliação: '+error.message,'error');}
      },120);
    };
    for(const [key,path] of [['imports','bankReconciliationImports'],['events','bankReconciliationEvents'],['state','bankReconciliationState']]){
      const ref=root._fbRawDB.ref('erp/'+path+'/'+code);
      const callback=snap=>{
        if(workspace!==state)return;
        if(key!=='state'){
          state[key]=snap.val()||{};
          if(!state.imports[state.selected])state.selected=Object.keys(state.imports)[0]||'';
        }
        // O listener serve somente para detectar mudanças. Somente a API
        // pode definir o status, evitando exibir 'Reaberto' com vínculo ativo.
        scheduleSnapshotRefresh();
        renderList();
      };
      ref.on('value',callback,e=>notify('Erro de leitura Firebase: '+e.message,'error'));
      state.unsubscribe.push(()=>ref.off('value',callback));
    }
    await refreshTargets();renderList();el.querySelector('[name=search]').focus();
  }catch(error){if(typeof root.showToast==='function')root.showToast(error.message,'error');else root.alert(error.message);}
};
})(window);
