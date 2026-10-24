/* Extrato bancário: datas e valores monetários sem perda nas somas. Não modifica o Firebase. */
(function (root) {
  'use strict';
  const MAX_SAFE_CENTS=BigInt(Number.MAX_SAFE_INTEGER);
  function isoDate(value) {
    const text=String(value || '').trim();
    let match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if(match) return dateParts(+match[1],+match[2],+match[3]);
    match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if(match) return dateParts(+match[3],+match[2],+match[1]);
    return '';
  }
  function dateParts(year,month,day) {
    const date=new Date(Date.UTC(year,month-1,day));
    if(date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day) return '';
    return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  function toCents(value) {
    if(value===null||value===undefined||value==='') return 0n;
    if(typeof value==='number'&&!Number.isFinite(value)) throw new RangeError('Valor monetário não finito');
    let raw=String(value).trim().replace(/\s|R\$/gi,'');
    if(raw.includes(',')) raw=raw.replace(/\./g,'').replace(',', '.');
    const match=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
    if(!match) throw new TypeError('Valor monetário inválido');
    const exp=Number(match[4]||0);
    // Limita apenas escala patológica, sem arredondar movimentações válidas.
    if(!Number.isSafeInteger(exp)||Math.abs(exp)>400) throw new RangeError('Expoente monetário não suportado');
    const digits=BigInt(match[2]+(match[3]||''));
    const offset=exp-(match[3]||'').length+2;
    const n=offset>=0?digits*(10n**BigInt(offset)):(digits+5n*10n**BigInt(-offset-1))/(10n**BigInt(-offset));
    return match[1]==='-'?-n:n;
  }
  function toDecimal(cents) {
    const neg=cents<0n;
    const abs=(neg?-cents:cents).toString().padStart(3,'0');
    return (neg?'-':'')+abs.slice(0,-2)+'.'+abs.slice(-2);
  }
  function valueFromCents(cents) {
    return cents<=MAX_SAFE_CENTS&&cents>=-MAX_SAFE_CENTS?Number(cents)/100:toDecimal(cents);
  }
  function brl(value) {
    const c=toCents(value),negative=c<0n;
    const digits=(negative?-c:c).toString().padStart(3,'0');
    const whole=digits.slice(0,-2).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
    return (negative?'-':'')+whole+','+digits.slice(-2);
  }
  function addMoney(values) {
    return valueFromCents(values.reduce((sum,value)=>sum+toCents(value),0n));
  }
  function sign(value) {
    const cents=toCents(value);
    return cents>0n?1:cents<0n?-1:0;
  }
  function statement({openingBalance=0,bankCode,entries=[]}={}) {
    const bank=String(bankCode ?? '');
    const matches=entries.map((entry,index)=>({entry,index})).filter(({entry})=>String(entry?.bancoCod ?? '')===bank);
    matches.sort((a,b)=>{
      const left=isoDate(a.entry?.data),right=isoDate(b.entry?.data);
      if(left!==right) return (!left?1:!right?-1:left.localeCompare(right));
      return a.index-b.index;
    });
    let balance=0n,credit=0n,debit=0n,invalidValues=0;
    try{balance=toCents(openingBalance);}catch(error){invalidValues++;}
    // Valores legados que já foram gravados como Number podem ter perdido dígitos ANTES deste cálculo.
    let hasUnsafeLegacyValues=typeof openingBalance==='number'&&Math.abs(openingBalance)*100>Number.MAX_SAFE_INTEGER;
    const rows=matches.map(({entry,index})=>{
      let amount=0n;
      try{amount=toCents(entry.valor);}catch(error){invalidValues++;}
      const magnitude=amount<0n?-amount:amount;
      const incoming=entry.tipo==='Entrada'||entry.tipo==='Crédito';
      const delta=incoming?magnitude:-magnitude;
      balance+=delta;
      if(incoming)credit+=magnitude;else debit+=magnitude;
      if(typeof entry.valor==='number'&&Math.abs(entry.valor)*100>Number.MAX_SAFE_INTEGER) hasUnsafeLegacyValues=true;
      return {entry,index,date:isoDate(entry.data),incoming,amount:valueFromCents(magnitude),balance:valueFromCents(balance)};
    });
    return {
      openingBalance:valueFromCents((()=>{try{return toCents(openingBalance);}catch(error){return 0n;}})()),
      closingBalance:valueFromCents(balance),credits:valueFromCents(credit),debits:valueFromCents(debit),
      hasUnsafeLegacyValues,invalidValues,rows
    };
  }
  const api=Object.freeze({isoDate,toCents,brl,addMoney,sign,statement});
  root.erpBankLedger=api;
})(typeof window === 'undefined' ? globalThis : window);
