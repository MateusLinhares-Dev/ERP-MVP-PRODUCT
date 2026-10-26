// Domínio monetário compartilhado entre interface e API. Todos os valores são centavos exatos.
export const MAX_BANK_CENTS = 9007199254740991n;
export const ABS = value => { const n=BigInt(value); return n<0n?-n:n; };
export const targetKey = (kind,id) => `${kind}:${id}`;
export function cents(value) {
  if(typeof value==='bigint') return value;
  if(typeof value==='number' && !Number.isSafeInteger(value)) throw new Error('Centavos fora da faixa segura');
  const raw=String(value??'');
  if(!/^-?\d{1,30}$/.test(raw)) throw new Error('Valor em centavos inválido');
  return BigInt(raw);
}
export function decimalCents(value) {
  const raw=String(value??'').trim().replace(/\s|R\$/gi,'');
  const canonical=raw.includes(',') ? raw.replace(/\./g,'').replace(',','.') : raw;
  const m=/^(-?)(\d{1,20})(?:\.(\d{1,2}))?$/.exec(canonical);
  if(!m) throw new Error('Valor monetário inválido');
  const n=BigInt(m[2])*100n+BigInt((m[3]||'').padEnd(2,'0'));
  return m[1]? -n:n;
}
export function signedAmount(raw){ const n=cents(raw);if(n===0n)throw new Error('Movimentação com valor zero');return n; }
export function targetAmount(target) {
  if(target.amountCents!==undefined)return ABS(cents(target.amountCents));
  return ABS(decimalCents(target.amount));
}
export function targetDirection(imported){return signedAmount(imported.amountCents)>0n?'income':'expense';}
export function compatible(imported,target) {
  const direction=targetDirection(imported);
  return target.kind==='bankEntry' ? target.direction===direction :
    direction==='income'?target.kind==='receivable':target.kind==='payable';
}
export function latestDecisions(events){
  const out=new Map();
  for(const event of Object.values(events||{})){
    if(!event||!event.importId)continue;
    const prev=out.get(event.importId);
    if(!prev||Number(event.createdAt)>Number(prev.createdAt)||
       (Number(event.createdAt)===Number(prev.createdAt)&&String(event.id)>String(prev.id)))out.set(event.importId,event);
  }
  return out;
}
export function currentAllocations(decision){
  if(!decision||decision.status==='reversed')return [];
  if(Array.isArray(decision.allocations))return decision.allocations;
  if(decision.status==='reconciled'&&decision.targetId&&decision.targetKind!=='manual'&&decision.targetKind!=='none')
    return [{kind:decision.targetKind,id:decision.targetId,amountCents:decision.amountCents||'0'}];
  return [];
}
export function consumedByTarget(decisions,excludeImportId=''){
  const amounts=new Map();
  const iterable=decisions instanceof Map?decisions.values():Object.values(decisions||{});
  for(const decision of iterable){
    if(!decision||decision.importId===excludeImportId||decision.status==='reversed')continue;
    for(const allocation of currentAllocations(decision)){
      const key=targetKey(allocation.kind,allocation.id);
      amounts.set(key,(amounts.get(key)||0n)+ABS(cents(allocation.amountCents)));
    }
  }
  return amounts;
}
export function remainingForTarget(target,decisions,excludeImport='') {
  const used=consumedByTarget(decisions,excludeImport).get(targetKey(target.kind,target.id))||0n;
  const remaining=targetAmount(target)-used;
  return remaining>0n?remaining:0n;
}
export function validatePlan({imported,allocations=[],adjustmentCents='0',category='',targets=[],decisions=new Map(),status='reconciled'}={}){
  if(!imported?.id)throw new Error('Movimentação bancária não encontrada');
  if(!['reconciled','partial','classified'].includes(status))throw new Error('Situação inválida');
  if(!Array.isArray(allocations)||allocations.length>30)throw new Error('Máximo de 30 títulos por movimentação');
  const known=new Map(targets.map(t=>[targetKey(t.kind,t.id),t]));
  const seen=new Set();let allocated=0n;
  const safe=allocations.map(row=>{
    const kind=String(row.kind),id=String(row.id);
    if(!['bankEntry','payable','receivable'].includes(kind)||!id||id.length>120)throw new Error('Referência financeira inválida');
    const key=targetKey(kind,id),target=known.get(key);
    if(!target||!compatible(imported,target))throw new Error('Título incompatível ou sem permissão: '+key);
    if(seen.has(key))throw new Error('Título duplicado na seleção');seen.add(key);
    const part=cents(row.amountCents);
    if(part<=0n)throw new Error('Valor da parcela precisa ser positivo');
    if(part>remainingForTarget(target,decisions,imported.id))throw new Error('Valor excede o saldo disponível do título '+id);
    if(kind==='bankEntry'&&part!==targetAmount(target))throw new Error('Movimento do ERP exige conciliação integral');
    allocated+=part;
    return {kind,id,amountCents:part.toString()};
  });
  const adjustment=cents(adjustmentCents);
  if(ABS(adjustment)>1000000000n)throw new Error('Ajuste excede o limite permitido');
  if(adjustment!==0n&&!String(category).trim())throw new Error('Informe a categoria do ajuste/tarifa');
  const importedAbs=ABS(signedAmount(imported.amountCents));
  const remainder=importedAbs-allocated-adjustment;
  if(remainder<0n)throw new Error('Valores selecionados superam o extrato');
  if(status==='reconciled'&&(remainder!==0n||!safe.length))throw new Error('Conciliação exige valor conferido e vínculo financeiro');
  if(status==='partial'&&(remainder===0n||!safe.length))throw new Error('Conciliação parcial precisa de vínculo e saldo pendente');
  if(status==='classified'&&(safe.length||!String(category).trim()||adjustment!==0n))throw new Error('Classificação sem vínculo exige categoria');
  return {status,allocations:safe,adjustmentCents:adjustment.toString(),remainderCents:remainder.toString(),allocatedCents:allocated.toString()};
}
export function scoreMatch(entry,target,remaining) {
  if(!compatible(entry,target)||remaining<=0n)return -1000;
  const imported=ABS(cents(entry.amountCents));
  const exact=remaining===imported?80:remaining<imported?45:20;
  const days=Math.min(45,Math.floor(Math.abs(Date.parse(entry.date+'T00:00:00Z')-Date.parse(target.date+'T00:00:00Z'))/86400000)||45);
  const label=(String(entry.description||'')+' '+String(target.description||'')).toLowerCase();
  const overlap=new Set(String(entry.description||'').toLowerCase().split(/\W+/).filter(s=>s.length>3));
  const relevant=String(target.description||'').toLowerCase().split(/\W+/).filter(x=>overlap.has(x));
  return exact-days+Math.min(20,relevant.length*5)+(target.kind==='bankEntry'?25:0);
}
export function suggestions(entry,targets,decisions,{limit=30}={}){
  return targets.map(t=>{const remaining=remainingForTarget(t,decisions,entry.id);return {...t,remainingCents:remaining.toString(),score:scoreMatch(entry,t,remaining)};})
    .filter(t=>t.score>=0).sort((a,b)=>b.score-a.score).slice(0,limit);
}
export function suggestCombinations(entry,targets,decisions,{limit=8,maxItems=4}={}) {
  const required=ABS(cents(entry.amountCents));
  const candidates=suggestions(entry,targets,decisions,{limit:18}).filter(x=>x.kind!=='bankEntry'&&cents(x.remainingCents)<=required);
  const found=[];
  function visit(index,selected,sum){
    if(found.length>=limit)return;
    if(sum===required){found.push(selected.map(x=>({kind:x.kind,id:x.id,amountCents:x.remainingCents})));return;}
    if(selected.length>=maxItems||sum>required)return;
    for(let i=index;i<candidates.length;i++){
      const c=candidates[i],amount=cents(c.remainingCents);
      if(amount>0n&&sum+amount<=required)visit(i+1,[...selected,c],sum+amount);
      if(found.length>=limit)return;
    }
  }
  visit(0,[],0n);return found;
}
export function batchSuggestions(imports,targets,decisions,{limit=30}={}){
  const used=new Set();const planned=[];
  for(const item of imports.slice(0,limit)){
    if(['reconciled','classified'].includes(decisions.get(item.id)?.status))continue;
    const found=suggestions(item,targets,decisions).find(t=>t.score>=75&&t.remainingCents===ABS(cents(item.amountCents)).toString()&&!used.has(targetKey(t.kind,t.id)));
    if(found){used.add(targetKey(found.kind,found.id));planned.push({importId:item.id,allocations:[{kind:found.kind,id:found.id,amountCents:found.remainingCents}]});}
  }
  return planned;
}
