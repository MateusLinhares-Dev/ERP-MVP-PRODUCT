/* Conciliação bancária: OFX -> registro imutável -> vínculo auditável. Não baixa contas automaticamente. */
(function(root){
'use strict';
const domain=root.erpBankReconciliationDomain;
if(!domain)throw new Error('Domínio de conciliação indisponível');
const ledger=root.erpBankLedger;
let active=null;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateBR=s=>{const d=ledger.isoDate(s);return d?d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4):String(s||'—')};
function moneyCents(value){const abs=BigInt(value)<0n?-BigInt(value):BigInt(value);const s=abs.toString().padStart(3,'0');return 'R$ '+s.slice(0,-2).replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+s.slice(-2)}
function normalizeDate(date){return ledger.isoDate(date)||''}
function getSources(){return typeof root.erpReconciliationSources==='function'?root.erpReconciliationSources():{banks:[],bankEntries:[],payables:[],receivables:[]}}
function getTargets(state){
  const records=getSources(),code=state.code;
  return [
    ...(records.bankEntries||[]).filter(item=>item.bankCode===code).map(item=>({id:item.id,kind:'bankEntry',direction:['Entrada','Crédito'].includes(item.type)?'income':'expense',description:item.description,date:normalizeDate(item.date),amount:item.amount,status:'Lançado'})),
    ...(state.claims.canFinance===true?(records.payables||[]):[]).map(item=>({...item,kind:'payable',date:normalizeDate(item.date)})),
    ...((state.claims.canFinance===true||state.claims.canReceivables===true)?(records.receivables||[]):[]).map(item=>({...item,kind:'receivable',date:normalizeDate(item.date)}))
  ];
}
async function authContext(){
  const user=root.firebase?.auth()?.currentUser;
  if(!user)throw new Error('É necessário entrar novamente no ERP.');
  const result=await user.getIdTokenResult();
  if(result.claims.erpAccess!==true||result.claims.canBanking!==true)throw new Error('Seu perfil não permite conciliação bancária.');
  return {user,claims:result.claims};
}
function database(){const db=root._fbRawDB;if(!db)throw new Error('Firebase não está conectado.');return db;}
function notice(msg,type='info'){
  if(!active)return;
  const el=active.element.querySelector('.erp-reconcile-notice');
  el.textContent=msg;el.dataset.type=type;
}
function currentDecision(item){return active?.decisions.get(item?.id)||null}
function count(){
  const all=Object.values(active.imports);
  const reconciled=all.filter(t=>currentDecision(t)?.status==='reconciled').length;
  const classified=all.filter(t=>currentDecision(t)?.status==='classified').length;
  return {all:all.length,reconciled,classified,pending:all.length-reconciled-classified};
}
function sortedEntries(){
  const filter=active.element.querySelector('[name=filter]').value;
  const query=active.element.querySelector('[name=search]').value.toLocaleLowerCase('pt-BR').trim();
  return Object.values(active.imports).filter(t=>{
    const done=['reconciled','classified'].includes(currentDecision(t)?.status);
    return (filter==='all'||(filter==='pending'?!done:done)) && (!query||String(t.description+' '+t.date+' '+t.fitid).toLocaleLowerCase('pt-BR').includes(query));
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.id).localeCompare(String(b.id)));
}
function getSuggestions(entry){
  const used=new Set();
  active.decisions.forEach((decision,key)=>{
    if(key===entry.id||decision.status!=='reconciled'||!decision.targetId||decision.targetKind==='manual')return;
    used.add(decision.targetKind+':'+decision.targetId);
  });
  return domain.suggestions(entry,getTargets(active),{used});
}
function captureDraft(){
  if(!active)return;
  const box=active.element.querySelector('.erp-reconcile-detail');
  const category=box.querySelector('[name=category]');
  if(!category)return;
  active.draft={category:category.value,costCenter:box.querySelector('[name=costCenter]').value,notes:box.querySelector('[name=notes]').value};
}
function render(){
  if(!active)return;
  const state=active,el=state.element;
  const stats=count();
  el.querySelector('[data-stat=total]').textContent=stats.all;
  el.querySelector('[data-stat=pending]').textContent=stats.pending;
  el.querySelector('[data-stat=done]').textContent=stats.reconciled;
  el.querySelector('[data-stat=classified]').textContent=stats.classified;
  const entries=sortedEntries();
  const left=el.querySelector('.erp-reconcile-list');
  left.innerHTML=entries.map(t=>{
    const status=state.decisions.get(t.id)?.status;
    const done=status==='reconciled'||status==='classified';
    return '<button type="button" class="erp-reconcile-entry '+(state.selected===t.id?'is-active':'')+'" data-entry="'+escape(t.id)+'">'+
      '<span class="erp-reconcile-entry-top"><time>'+escape(dateBR(t.date))+'</time><strong class="'+(BigInt(t.amountCents)<0n?'debit':'credit')+'">'+(BigInt(t.amountCents)<0n?'− ':'+ ')+moneyCents(t.amountCents)+'</strong></span>'+
      '<span class="erp-reconcile-entry-desc">'+escape(t.description)+'</span><span class="erp-reconcile-entry-foot">'+(status==='reconciled'?'Conciliado':status==='classified'?'Classificado':'Pendente')+(t.fitid?' · '+escape(t.fitid):'')+'</span></button>';
  }).join('')||'<p class="erp-reconcile-empty">Nenhuma movimentação para esse filtro.</p>';
  const item=state.imports[state.selected];
  const right=el.querySelector('.erp-reconcile-detail');
  if(!item){right.innerHTML='<div class="erp-reconcile-empty">Selecione um lançamento importado para verificar correspondências.</div>';return;}
  const decision=state.decisions.get(item.id);
  if(decision?.status==='reconciled'||decision?.status==='classified'){
    const kind={bankEntry:'Movimento bancário',payable:'Conta a pagar',receivable:'Conta a receber',manual:'Classificação manual'}[decision.targetKind]||'Registro';
    const history=Object.values(state.events).filter(e=>e.importId===item.id).sort((a,b)=>Number(b.createdAt)-Number(a.createdAt));
    const audit='<details class="erp-reconcile-audit"><summary>Histórico de decisões ('+history.length+')</summary><ol>'+history.map(e=>'<li>'+escape(new Date(Number(e.createdAt)).toLocaleString('pt-BR'))+' · '+escape(e.status==='reconciled'?'Conciliou':e.status==='classified'?'Classificou':'Desfez')+' · '+escape(e.actor||'—')+'</li>').join('')+'</ol></details>';
    right.innerHTML='<div class="erp-reconcile-linked"><span class="erp-reconcile-state">'+(decision.status==='classified'?'Classificado sem vínculo':'Conciliado')+'</span><h3>'+escape(kind)+'</h3><p>'+escape(decision.label||decision.targetId||'Classificado')+'</p><dl><dt>Categoria</dt><dd>'+escape(decision.category||'—')+'</dd><dt>Centro de custo</dt><dd>'+escape(decision.costCenter||'—')+'</dd><dt>Responsável</dt><dd>'+escape(decision.actor||'—')+'</dd></dl><button type="button" class="erp-reconcile-secondary" data-reverse>'+(decision.status==='classified'?'Desfazer classificação':'Desfazer conciliação')+'</button>'+audit+'</div>';
    right.querySelector('[data-reverse]').addEventListener('click',()=>reverse(item));return;
  }
  const suggestions=getSuggestions(item);
  const draft=state.draft||{category:'',costCenter:'',notes:''};
  const target=state.target&&suggestions.find(x=>x.kind+':'+x.id===state.target);
  right.innerHTML='<header class="erp-reconcile-detail-header"><h3>Conferir movimentação</h3><p>'+escape(dateBR(item.date))+' · '+escape(item.description)+'</p><strong>'+moneyCents(item.amountCents)+'</strong></header>'+ 
    '<div class="erp-reconcile-proposals"><h4>Correspondências sugeridas</h4>'+
    (suggestions.map(t=>'<button type="button" class="erp-reconcile-proposal '+(target?.id===t.id&&target?.kind===t.kind?'is-selected':'')+'" data-target="'+escape(t.kind+':'+t.id)+'"><span><strong>'+escape(t.description||t.party||t.id)+'</strong><small>'+escape(({bankEntry:'Extrato ERP',payable:'Conta a pagar',receivable:'Conta a receber'})[t.kind])+' · '+escape(dateBR(t.date))+'</small></span><b>'+moneyCents(ledger.toCents(t.amount)<0n?-ledger.toCents(t.amount):ledger.toCents(t.amount))+'</b></button>').join('')||'<p class="erp-reconcile-empty">Nenhum lançamento com o mesmo valor. Você pode classificar manualmente.</p>')+'</div>'+ 
    '<div class="erp-reconcile-attributes"><label>Categoria<input name="category" maxlength="90" value="'+escape(draft.category)+'" placeholder="Ex.: Fornecedores, Recebimentos"></label><label>Centro de custo<input name="costCenter" maxlength="90" value="'+escape(draft.costCenter)+'" placeholder="Opcional"></label><label class="erp-reconcile-wide">Observações<textarea name="notes" maxlength="500" rows="2" placeholder="Opcional">'+escape(draft.notes)+'</textarea></label></div>'+ 
    '<div class="erp-reconcile-actions"><button type="button" class="erp-reconcile-secondary" data-clear>Sem vínculo</button><button type="button" class="erp-reconcile-primary" data-confirm>'+(target?'Conciliar lançamento':'Classificar movimentação')+'</button></div>';
  right.querySelectorAll('[data-target]').forEach(b=>b.addEventListener('click',()=>{
    captureDraft();state.target=b.dataset.target===state.target?'':b.dataset.target;render();
  }));
  right.querySelector('[data-clear]').addEventListener('click',()=>{captureDraft();state.target='';render();});
  right.querySelector('[data-confirm]').addEventListener('click',()=>confirmMatch(item));
}
async function appendDecision(entry,status,fields={}){
  const state=active;if(!state)throw new Error('Janela encerrada');
  const {claims,user}=await authContext();
  const ref=database().ref('erp/bankReconciliationEvents/'+state.code).push();
  const record={id:ref.key,importId:entry.id,status,targetKind:fields.targetKind||'none',targetId:fields.targetId||'',
    label:String(fields.label||'').slice(0,240),category:String(fields.category||'').slice(0,90),
    costCenter:String(fields.costCenter||'').slice(0,90),notes:String(fields.notes||'').slice(0,500),
    actor:String(claims.erpUser||'').slice(0,120),uid:user.uid,createdAt:Date.now()};
  await ref.set(record);
}
async function confirmMatch(entry){
  const state=active,box=state.element.querySelector('.erp-reconcile-detail');
  const confirm=box.querySelector('[data-confirm]');confirm.disabled=true;
  try{
    const candidates=getSuggestions(entry);
    const selected=candidates.find(x=>x.kind+':'+x.id===state.target);
    const category=box.querySelector('[name=category]').value.trim();
    if(!selected&&!category)throw new Error('Para classificar sem vínculo, informe a categoria.');
    await appendDecision(entry,selected?'reconciled':'classified',{targetKind:selected?.kind||'manual',targetId:selected?.id||'',
      label:selected?.description||selected?.party||'Classificação manual',category,
      costCenter:box.querySelector('[name=costCenter]').value.trim(),notes:box.querySelector('[name=notes]').value.trim()});
    state.target='';state.draft=null;notice(selected?'Movimentação conciliada sem baixas ou novos lançamentos.':'Movimentação classificada, ainda sem vínculo financeiro.','ok');
  }catch(error){notice(error.message||'Não foi possível conciliar.','error');confirm.disabled=false;}
}
async function reverse(entry){
  if(!root.confirm('Desfazer a conciliação? O histórico ficará preservado.'))return;
  try{await appendDecision(entry,'reversed');notice('Conciliação desfeita.','ok');}
  catch(e){notice(e.message,'error');}
}
function decodeOfx(buffer){
  const bytes=new Uint8Array(buffer);
  const head=new TextDecoder('windows-1252').decode(bytes.slice(0,1024));
  const latin=/CHARSET\s*:\s*(1252|8859-1)|ENCODING\s*:\s*USASCII/i.test(head);
  return new TextDecoder(latin?'windows-1252':'utf-8',{fatal:false}).decode(bytes);
}
async function sha256(input){
  const bytes=new TextEncoder().encode(input);
  const result=await root.crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(result)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function importFile(file){
  const state=active;if(!state)return;
  if(file.size>domain.MAX_IMPORT_BYTES)throw new Error('O arquivo OFX deve ter no máximo 1 MB.');
  const source=decodeOfx(await file.arrayBuffer());
  const accountInFile=domain.bankAccountId(source);
  const selectedAccount=getSources().banks.find(b=>b.cod===state.code)?.account||'';
  const digits=s=>String(s||'').replace(/\D/g,'');
  if(accountInFile&&selectedAccount&&digits(accountInFile)&&digits(selectedAccount)&&!digits(accountInFile).endsWith(digits(selectedAccount))&&!digits(selectedAccount).endsWith(digits(accountInFile))){
    if(!root.confirm('A conta indicada no arquivo OFX ('+accountInFile+') não coincide com a conta selecionada ('+selectedAccount+'). Deseja continuar?'))return;
  }
  const entries=domain.parseOfx(source);
  const {claims,user}=await authContext();
  const rootRef=database().ref('erp/bankReconciliationImports/'+state.code);
  let created=0,duplicates=0;
  // Pequenos lotes reduzem tempo de rede sem transformar a importação em sobrescrita em massa.
  for(let offset=0;offset<entries.length;offset+=8){
    const batch=entries.slice(offset,offset+8);
    const results=await Promise.all(batch.map(async entry=>{
      const id='I'+await sha256(state.code+'|'+entry.fingerprint);
      const record={...entry,id,bankCode:state.code,importedBy:String(claims.erpUser||'').slice(0,120),uid:user.uid,importedAt:Date.now()};
      delete record.fingerprint;
      const transaction=await rootRef.child(id).transaction(current=>current===null?record:undefined,undefined,false);
      return Boolean(transaction.committed);
    }));
    created+=results.filter(Boolean).length;
    duplicates+=results.filter(result=>!result).length;
    notice(`Importando ${Math.min(offset+batch.length,entries.length)} de ${entries.length} movimentos...`);
  }
  notice(`${created} lançamento(s) importado(s), ${duplicates} duplicado(s) ignorado(s).`,'ok');
}
function close(){
  if(!active)return;
  const state=active;active=null;
  state.off.forEach(fn=>fn());
  document.removeEventListener('keydown',state.keyHandler);
  state.element.remove();
}
root.erpReconciliationOpen=async function(bankCode){
  try{
    const code=String(bankCode||'');
    if(!/^[A-Za-z0-9_-]{1,40}$/.test(code))throw new Error('Código bancário inválido');
    const session=await authContext();
    const account=getSources().banks.find(b=>b.cod===code);
    if(!account)throw new Error('Conta não encontrada');
    close();
    const host=document.createElement('div');host.className='erp-reconcile-overlay';
    host.innerHTML='<section class="erp-reconcile-dialog" role="dialog" aria-modal="true" aria-label="Conciliação bancária">'+
      '<header class="erp-reconcile-heading"><div><h2>Conciliação bancária</h2><p>'+escape(account.name)+' · '+escape(code)+'</p></div><div class="erp-reconcile-heading-actions"><label class="erp-reconcile-upload">Importar OFX<input type="file" accept=".ofx,.OFX" data-import hidden></label><button type="button" class="erp-reconcile-close" data-close aria-label="Fechar">Fechar</button></div></header>'+ 
      '<div class="erp-reconcile-metrics"><div><small>Movimentações</small><strong data-stat="total">0</strong></div><div><small>Pendentes</small><strong data-stat="pending">0</strong></div><div><small>Conciliadas</small><strong data-stat="done">0</strong></div><div><small>Classificadas</small><strong data-stat="classified">0</strong></div></div>'+ 
      '<p class="erp-reconcile-notice" role="status" aria-live="polite">Importar e conciliar não altera saldos nem realiza baixas financeiras.</p>'+ 
      '<div class="erp-reconcile-columns"><div class="erp-reconcile-left"><div class="erp-reconcile-pane-head"><h3>Extrato do banco</h3><div class="erp-reconcile-filters"><input type="search" name="search" placeholder="Descrição, data ou ID" aria-label="Buscar movimentos"><select name="filter" aria-label="Situação"><option value="all">Todos</option><option value="pending">Pendentes</option><option value="done">Tratados</option></select></div></div><div class="erp-reconcile-list"></div></div>'+ 
      '<div class="erp-reconcile-right"><div class="erp-reconcile-pane-head"><h3>Lançamentos do ERP</h3><p>Selecione uma correspondência ou classifique a movimentação.</p></div><div class="erp-reconcile-detail"></div></div></div></section>';
    document.body.appendChild(host);
    const state={element:host,code,claims:session.claims,imports:{},events:{},decisions:new Map(),selected:'',target:'',draft:null,off:[],keyHandler:e=>{if(e.key==='Escape')close();}};
    active=state;
    document.addEventListener('keydown',state.keyHandler);
    host.querySelector('[data-close]').addEventListener('click',close);
    host.addEventListener('click',e=>{if(e.target===host)close();});
    host.querySelectorAll('[name=search],[name=filter]').forEach(x=>x.addEventListener('input',render));
    host.querySelector('.erp-reconcile-list').addEventListener('click',e=>{
      const btn=e.target.closest('[data-entry]');if(!btn)return;
      state.selected=btn.dataset.entry;state.target='';state.draft=null;render();
    });
    host.querySelector('[data-import]').addEventListener('change',async e=>{
      const file=e.target.files?.[0];if(!file)return;
      e.target.disabled=true;
      try{await importFile(file);}catch(error){notice(error.message||'Importação falhou','error');}
      finally{e.target.disabled=false;e.target.value='';}
    });
    const db=database();
    for(const [key,path] of [['imports','bankReconciliationImports'],['events','bankReconciliationEvents']]){
      const ref=db.ref('erp/'+path+'/'+code);
      const cb=snap=>{
        if(active!==state)return;
        state[key]=snap.val()||{};
        state.decisions=domain.lastDecisions(state.events);
        if(!state.imports[state.selected])state.selected=Object.keys(state.imports)[0]||'';
        render();
      };
      const err=e=>notice('Falha ao consultar dados do Firebase: '+e.message,'error');
      ref.on('value',cb,err);state.off.push(()=>ref.off('value',cb));
    }
    host.querySelector('[name=search]').focus();
  }catch(error){if(typeof root.showToast==='function')root.showToast(error.message,'error');else root.alert(error.message);}
};
})(window);
