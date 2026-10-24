/* Extrato bancário: normalização e ordenação determinísticas, sem efeitos de persistência. */
(function (root) {
  'use strict';
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
  function cents(value) {
    const number=Number(value);
    return Number.isFinite(number)?Math.round((number+Number.EPSILON)*100):0;
  }
  function brl(value) {
    return (cents(value)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  }
  function statement({openingBalance=0,bankCode,entries=[]}={}) {
    const bank=String(bankCode ?? '');
    const matches=entries.map((entry,index)=>({entry,index})).filter(({entry})=>String(entry?.bancoCod ?? '')===bank);
    matches.sort((a,b)=>{
      const left=isoDate(a.entry?.data),right=isoDate(b.entry?.data);
      if(left!==right) return (!left?1:!right?-1:left.localeCompare(right));
      return a.index-b.index;
    });
    let balance=cents(openingBalance),credit=0,debit=0;
    const rows=matches.map(({entry,index})=>{
      const amount=Math.abs(cents(entry.valor));
      const incoming=entry.tipo==='Entrada';
      const delta=incoming?amount:-amount;
      balance+=delta;
      if(incoming) credit+=amount;else debit+=amount;
      return {entry,index,date:isoDate(entry.data),incoming,amount:amount/100,balance:balance/100};
    });
    return {openingBalance:cents(openingBalance)/100,closingBalance:balance/100,credits:credit/100,debits:debit/100,rows};
  }
  const api=Object.freeze({isoDate,brl,statement});
  root.erpBankLedger=api;
})(typeof window === 'undefined' ? globalThis : window);
