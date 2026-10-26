import {createHash,randomUUID} from 'node:crypto';
import {ABS, cents, decimalCents, validatePlan, latestDecisions, currentAllocations, batchSuggestions} from '../../public/modules/banking/reconciliation-engine.mjs';

const forbidden=(message,status=400)=>Object.assign(new Error(message),{status});
const validCode=v=>/^[A-Za-z0-9_-]{1,40}$/.test(String(v||''));
const safeText=(v,max)=>String(v||'').trim().slice(0,max);
const allowedKinds=new Set(['bankEntry','payable','receivable']);
const rows=value=>Object.entries(value||{}).filter(([,row])=>row&&typeof row==='object');
const valueDate=v=>{const s=String(v||'');return /^\d{2}\/\d{2}\/\d{4}$/.test(s)?s.slice(6)+'-'+s.slice(3,5)+'-'+s.slice(0,2):s.slice(0,10)};
function profileTargets(data,code,identity){
  const entries=rows(data.lancBanco).filter(([,row])=>String(row.bancoCod||'')===code).map(([key,row])=>({id:String(row.id||key),kind:'bankEntry',bankCode:code,
    date:valueDate(row.data),description:String(row.descricao||''),amount:row.valor,direction:['Entrada','Crédito'].includes(row.tipo)?'income':'expense'}));
  const payables=identity.canFinance===true?rows(data.contasPagar).map(([key,row])=>({id:String(row.id||key),kind:'payable',date:valueDate(row.venc||row.lancto),description:String(row.desc||row.cred||''),amount:row.valor,status:row.status})):[];
  const receivables=(identity.canFinance===true||identity.canReceivables===true)?rows(data.contasReceber).map(([key,row])=>({id:String(row.id||key),kind:'receivable',date:valueDate(row.venc||row.data),description:String(row.desc||row.cli||''),amount:row.valor,status:row.status})):[];
  return [...entries,...payables,...receivables].filter(t=>t.id&&t.amount!==undefined&&t.amount!==null);
}
function latestLegacy(events,imports){
  const map=latestDecisions(events);
  const decisions={};
  map.forEach((e,id)=>{
    if(!imports[id])return;
    const allocations=e.status==='reconciled'&&e.targetId&&allowedKinds.has(e.targetKind)?
      [{kind:e.targetKind,id:e.targetId,amountCents:ABS(cents(imports[id].amountCents)).toString()}]:[];
    decisions[id]={...e,importId:id,allocations};
  });
  return decisions;
}
function mergeDecisions(current,legacy){return new Map([...Object.entries(legacy),...Object.entries(current||{})]);}
function activeTaken(decisions,excludeId=''){
  return new Map([...decisions].filter(([id])=>id!==excludeId).flatMap(([,d])=>d?.status==='reversed'?[]:currentAllocations(d).map(a=>[a.kind+':'+a.id,a])));
}
export function validateReconciliationAction({input,imports,targets,current={},legacy={},identity}){
  const action=String(input.action||'');
  const merged=mergeDecisions(current,legacy);
  const importId=safeText(input.importId,100),imported=imports[importId];
  if(!imported||String(imported.id)!==importId)throw forbidden('Movimentação OFX não encontrada');
  if(action==='undo'||action==='archive')return {status:action==='undo'?'reversed':'archived',allocations:[],adjustmentCents:'0',remainderCents:ABS(cents(imported.amountCents)).toString()};
  if(['reconcile','classify'].includes(action)){
    const status=action==='classify'?'classified':safeText(input.status,20)||'reconciled';
    if(!['reconciled','partial','classified'].includes(status))throw forbidden('Situação inválida');
    const allocations=Array.isArray(input.allocations)?input.allocations:[];
    if(allocations.some(a=>a.kind==='payable'&&identity.canFinance!==true||a.kind==='receivable'&&identity.canFinance!==true&&identity.canReceivables!==true))throw forbidden('Sem permissão para o título selecionado',403);
    try {
      return validatePlan({imported,allocations,adjustmentCents:input.adjustmentCents||'0',category:input.category||'',targets,decisions:merged,status});
    } catch (error) {
      // A seleção e os valores vêm da interface. Validação rejeitada não é erro 500.
      // O cliente recebe uma mensagem acionável, enquanto falhas de infraestrutura
      // continuam sendo reportadas como erros internos reais.
      const conflict=/saldo disponível|já conciliad|movimentaç[aã]o alterada|em uso/i.test(String(error?.message||''));
      const invalid=forbidden(error?.message||'Dados de conciliação inválidos',conflict?409:400);
      invalid.code=conflict?'RECONCILIATION_CONFLICT':'INVALID_RECONCILIATION';
      throw invalid;
    }
  }
  throw forbidden('Ação de conciliação não reconhecida');
}
function recordDecision({input,plan,importId,identity}){
  return {
    id: 'R'+cryptoId(),importId,status:plan.status,allocations:plan.allocations,
    adjustmentCents:plan.adjustmentCents,remainderCents:plan.remainderCents,
    category:safeText(input.category,90),costCenter:safeText(input.costCenter,90),notes:safeText(input.notes,500),
    actor:identity.erpUser,uid:identity.uid,createdAt:Date.now(),
    source:input.action==='undo'?'manual-reversal':'manual-reconciliation'
  };
}
function cryptoId(){return randomUUID().replace(/-/g,'');}
async function fetchAccount(db,code){
  const snap=await db.ref('erp/bancos').get();
  return rows(snap.val()).map(([,bank])=>bank).find(bank=>String(bank.cod)===code);
}
export async function executeReconciliation(identity,input,{db:injectedDatabase}={}){
  if(!identity?.erpAccess||!identity?.canBanking)throw forbidden('Acesso bancário não autorizado',403);
  const code=String(input.bankCode||'');if(!validCode(code))throw forbidden('Conta bancária inválida');
  const db=injectedDatabase||(await import('../infrastructure/firebase-admin.js')).getFirebaseAdmin().db;
  const account=await fetchAccount(db,code);
  if(!account)throw forbidden('Conta bancária inexistente',404);
  const [importSnap,legacySnap,bankSnap,payableSnap,receivableSnap]=await Promise.all([
    db.ref('erp/bankReconciliationImports/'+code).get(),db.ref('erp/bankReconciliationEvents/'+code).get(),
    db.ref('erp/lancBanco').get(),identity.canFinance?db.ref('erp/contasPagar').get():Promise.resolve(null),
    (identity.canFinance||identity.canReceivables)?db.ref('erp/contasReceber').get():Promise.resolve(null)
  ]);
  const imports=importSnap.val()||{},legacy=latestLegacy(legacySnap.val()||{},imports);
  const targets=profileTargets({lancBanco:bankSnap.val(),contasPagar:payableSnap?.val(),contasReceber:receivableSnap?.val()},code,identity);
  const stateRef=db.ref('erp/bankReconciliationState/'+code);
  const globalStateRef=db.ref('erp/bankReconciliationState');
  const action=String(input.action||'');
  if(action==='snapshot'){
    const snap=await stateRef.get();
    const state=snap.val()||{decisions:{},audit:{}};
    // A mesma precedência é usada aqui e nas transações: o estado confirmado
    // pela API prevalece sobre eventos legados. Assim o navegador não oferece
    // uma operação que o servidor ainda considera bloqueada.
    // A interface usa exatamente a mesma precedência da transação: uma decisão
    // transacional (inclusive 'reversed') substitui o evento legado.
    const effectiveDecisions=Object.fromEntries(mergeDecisions(state.decisions||{},legacy));
    return {state,legacyDecisions:legacy,effectiveDecisions,targets};
  }
  if(action==='create-title'){
    const incoming=String(input.importId||''),imported=imports[incoming];
    if(!imported)throw forbidden('Movimentação importada não encontrada',404);
    const kind=cents(imported.amountCents)>0n?'receivable':'payable';
    if(kind==='payable'&&identity.canFinance!==true||kind==='receivable'&&identity.canFinance!==true&&identity.canReceivables!==true)
      throw forbidden('Sem permissão para cadastrar títulos financeiros',403);
    if(input.confirm!==true)throw forbidden('Confirme a criação do título financeiro');
    let amount;
    try { amount=cents(input.amountCents||ABS(cents(imported.amountCents)).toString()); }
    catch { throw forbidden('Valor do título inválido'); }
    if(amount<=0n||amount>1000000000000n||amount>ABS(cents(imported.amountCents)))throw forbidden('Valor do título fora dos limites');
    const party=safeText(input.party,120),category=safeText(input.category,90),description=safeText(input.description||imported.description,240);
    const company=safeText(account.empresa||input.company,120);
    if(!party||!category||!description)throw forbidden('Informe nome, categoria e descrição para cadastrar o título');
    if(kind==='payable'&&!company)throw forbidden('Informe a empresa responsável pela conta a pagar');
    const digest=createHash('sha256').update(code+'|'+incoming+'|title').digest('hex').slice(0,26);
    const id=(kind==='payable'?'CPR-':'CRR-')+digest;
    const br=String(imported.date).slice(8,10)+'/'+String(imported.date).slice(5,7)+'/'+String(imported.date).slice(0,4);
    const value=Number(amount)/100;
    const meta={id,valor:value,venc:br,status:'Pendente',reconciliationImportId:incoming,reconciliationBankCode:code,
      reconciliationBy:identity.erpUser,reconciliationAt:new Date().toISOString()};
    const record=kind==='payable'?{...meta,lancto:br,desc:description,cred:party,cat:category,
      bancoCod:code,bancoNome:String(account.banco||''),tipoForn:'despesa',empresa:company,obs:'Criado via conciliação. Baixa financeira pendente.'}:
      {...meta,data:br,cli:party,nf:'',desc:description,cat:category,dataReceb:'',obs:'Criado via conciliação. Recebimento pendente.'};
    const ref=db.ref('erp/'+(kind==='payable'?'contasPagar':'contasReceber')+'/'+id);
    const result=await ref.transaction(previous=>previous===null?record:undefined,undefined,false);
    if(!result.committed){const existing=(await ref.get()).val();if(existing?.reconciliationImportId!==incoming)
      throw forbidden('Identificador financeiro em uso',409);}
    return {created:result.committed,id,kind,record:result.committed?record:(await ref.get()).val()};
  }
  if(action==='create-bank-entry'){
    const importId=safeText(input.importId,100),imported=imports[importId];
    if(!imported)throw forbidden('Movimentação importada não encontrada');
    let raw;
    try { raw=cents(imported.amountCents); }
    catch { throw forbidden('Valor da movimentação bancária inválido'); }
    if(ABS(raw)>1000000000000n)throw forbidden('Valor incompatível com módulo bancário legado');
    if(input.confirm!==true)throw forbidden('Confirme a criação da movimentação bancária');
    const id='LBR-'+createHash('sha256').update(code+'|'+importId).digest('hex').slice(0,26);
    const entry={id,bancoCod:code,data:imported.date,descricao:safeText(input.description||imported.description,240),
      tipo:raw>0n?'Entrada':'Saída',valor:Number(ABS(raw))/100,reconciliationImportId:importId,
      reconciliationBy:identity.erpUser,reconciliationAt:new Date().toISOString()};
    const ref=db.ref('erp/lancBanco/'+id);
    const result=await ref.transaction(previous=>previous===null?entry:undefined,undefined,false);
    if(!result.committed){
      const existing=(await ref.get()).val();
      if(existing?.reconciliationImportId!==importId)throw forbidden('Identificador de movimentação já utilizado',409);
    }
    return {created:result.committed,id,record:entry};
  }
  if(!['reconcile','classify','archive','undo','batch'].includes(action))throw forbidden('Ação não suportada');
  if(action==='batch'&&(!Array.isArray(input.items)||!input.items.length||input.items.length>30))throw forbidden('Lote deve conter entre 1 e 30 movimentações');
  let failure,records=[];
  // Serialização GLOBAL entre contas: o mesmo título não pode ser consumido por dois bancos.
  // O nó da conta continua disponível por listener para a interface, sem acesso de escrita do browser.
  const result=await globalStateRef.transaction(previous=>{
    failure=null;
    const global=previous&&typeof previous==='object'?structuredClone(previous):{};
    const state=global[code]&&typeof global[code]==='object'?global[code]:{decisions:{},audit:{},revision:0};
    state.decisions||={};state.audit||={};
    const allDecisions={};
    for(const bank of Object.values(global)){
      if(!bank||!bank.decisions)continue;
      Object.assign(allDecisions,bank.decisions);
    }
    const inputs=action==='batch'?input.items.map(item=>({...item,bankCode:code,action:'reconcile'})):[input];
    const next=[];
    try{
      if(Object.keys(state.audit).length+inputs.length>10000)throw forbidden('Limite de auditoria da conta atingido; arquive mediante procedimento administrativo');
      for(const item of inputs){
        if(!item||typeof item!=='object'||Array.isArray(item))throw forbidden('Item de conciliação inválido');
        const importId=safeText(item.importId,100);
        const plan=validateReconciliationAction({input:item,imports,targets,current:allDecisions,legacy,identity});
        const existing=state.decisions[importId]||legacy[importId];
        if(item.action!=='undo'&&existing&&['reconciled','classified','archived'].includes(existing.status))throw forbidden('Movimentação já conciliada; desfaça antes de substituir',409);
        if(item.action==='undo'&&(!existing||existing.status==='reversed'))throw forbidden('Não há conciliação para desfazer',409);
        const record=recordDecision({input:item,plan,importId,identity});
        state.decisions[importId]=record;state.audit[record.id]=record;
        allDecisions[importId]=record;
        next.push(record);
      }
      state.revision=(state.revision||0)+1;
      global[code]=state;
      records=next;
      return global;
    }catch(err){failure=err;return undefined;}
  },undefined,false);
  if(!result.committed)throw failure||forbidden('Conciliação alterada por outro usuário. Atualize a tela e tente novamente.',409);
  return {revision:result.snapshot.val()?.[code]?.revision||0,records};
}
