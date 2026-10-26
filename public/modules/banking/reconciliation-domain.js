/* Domínio puro da conciliação: nenhuma operação financeira ou Firebase aqui. */
(function (root) {
  'use strict';
  const ledger=root.erpBankLedger;
  if(!ledger)throw new Error('Motor monetário do extrato não inicializado');
  const MAX_IMPORT_BYTES=1024*1024;
  const MAX_IMPORT_ITEMS=2000;
  function unescapeOfx(s){
    return String(s||'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(whole,entity)=>{
      const names={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
      if(names[entity.toLowerCase()])return names[entity.toLowerCase()];
      if(entity[0]==='#'){
        const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
        return Number.isInteger(n)&&n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):whole;
      }
      return whole;
    }).trim();
  }
  function field(block,name){
    const match=new RegExp('<'+name+'(?:\\s[^>]*)?>([^<\\r\\n]*)','i').exec(block);
    return match?unescapeOfx(match[1]):'';
  }
  function cents(raw){
    // Valores de OFX são decimais; não aceitar notação exponencial na importação.
    const value=String(raw||'').trim();
    if(!/^[+-]?\d+(?:[.,]\d{1,2})?$/.test(value))throw new Error('Valor OFX inválido: '+value);
    const result=ledger.toCents(value.replace(',','.'));
    if(result===0n||result>999999999999999n||result< -999999999999999n)throw new Error('Valor OFX fora do limite');
    return result;
  }
  function date(raw){
    const match=/^(\d{4})(\d{2})(\d{2})/.exec(String(raw||''));
    const value=match?`${match[1]}-${match[2]}-${match[3]}`:'';
    if(!ledger.isoDate(value))throw new Error('Data OFX inválida');
    return value;
  }
  function bankAccountId(text){return field(String(text||''),'ACCTID').slice(0,80);}
  function parseOfx(text){
    if(typeof text!=='string'||text.length>MAX_IMPORT_BYTES*2)throw new Error('Arquivo OFX excede o limite de 1 MB');
    if(!/<OFX[\s>]/i.test(text)||!/<BANKTRANLIST\b/i.test(text))throw new Error('Arquivo OFX sem lista de movimentações');
    const entries=[];
    const blocks=[...text.matchAll(/<STMTTRN(?:\s[^>]*)?>([\s\S]*?)(?=<\/STMTTRN\s*>|<STMTTRN\b|<\/BANKTRANLIST\s*>|$)/gi)];
    if(blocks.length>MAX_IMPORT_ITEMS)throw new Error('Máximo de 2.000 lançamentos por importação');
    const repeats=new Map();
    for(const match of blocks){
      const block=match[1];
      const amount=cents(field(block,'TRNAMT'));
      const posted=date(field(block,'DTPOSTED'));
      const description=(field(block,'MEMO')||field(block,'NAME')||'Movimentação bancária').slice(0,240);
      const fitid=field(block,'FITID').slice(0,128);
      const rawKey=fitid?'FITID:'+fitid:`SEMID:${posted}|${amount}|${description}`;
      const occurrence=repeats.get(rawKey)||0;
      repeats.set(rawKey,occurrence+1);
      entries.push({date:posted,amountCents:amount.toString(),description,fitid,
        fingerprint:fitid?rawKey:rawKey+'|'+occurrence});
    }
    if(!entries.length)throw new Error('Nenhuma movimentação OFX identificada');
    return entries;
  }
  function compareDate(a,b){
    const left=Date.parse(a+'T00:00:00Z'),right=Date.parse(b+'T00:00:00Z');
    return Number.isFinite(left)&&Number.isFinite(right)?Math.abs(left-right)/86400000:999;
  }
  function suggestions(imported,targets,{used=new Set()}={}){
    const amount=BigInt(imported.amountCents);
    const want=amount>0n?'receivable':'payable';
    return targets.filter(t=>t&&t.id&&!used.has(t.kind+':'+t.id))
      .filter(t=>t.kind==='bankEntry'||t.kind===want)
      .map(t=>{
        let value;
        try{value=ledger.toCents(t.amount);}catch(e){return null;}
        const magnitude=value<0n?-value:value;
        const relevant=amount<0n?-amount:amount;
        if(t.kind==='bankEntry'&&t.direction!==(amount>0n?'income':'expense'))return null;
        const delta=magnitude>relevant?magnitude-relevant:relevant-magnitude;
        if(delta!==0n)return null;
        const days=compareDate(imported.date,t.date);
        const score=(t.kind==='bankEntry'?110:75)-Math.min(days,60)*2 +
          (t.status==='Pago'||t.status==='Recebido'?3:0);
        return {...t,score,days};
      }).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,15);
  }
  function lastDecisions(events){
    const result=new Map();
    Object.values(events||{}).forEach(e=>{
      if(!e||!e.importId)return;
      const prior=result.get(e.importId);
      if(!prior||Number(e.createdAt)>Number(prior.createdAt)||
        (Number(e.createdAt)===Number(prior.createdAt)&&String(e.id)>String(prior.id)))result.set(e.importId,e);
    });
    return result;
  }
  root.erpBankReconciliationDomain=Object.freeze({parseOfx,bankAccountId,suggestions,lastDecisions,MAX_IMPORT_BYTES,MAX_IMPORT_ITEMS});
})(typeof window==='undefined'?globalThis:window);
