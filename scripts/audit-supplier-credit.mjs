#!/usr/bin/env node
// Auditoria SOMENTE LEITURA de um credito legado de compra. Nunca grava no Firebase.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
function arg(name){return process.argv.find(x=>x.startsWith('--'+name+'='))?.split('=').slice(1).join('')||'';}
const file=arg('snapshot'),ticketNo=arg('ticket')||'T284';
if(!file||!/^[A-Za-z0-9_-]{1,80}$/.test(ticketNo)){
  console.error('Uso: node scripts/audit-supplier-credit.mjs --snapshot=./backup.json --ticket=T284');
  process.exitCode=2;
}else{
  try{
    const raw=JSON.parse(readFileSync(resolve(file),'utf8'));
    const erp=raw.erp||raw;
    const source=erp.tickets?.[ticketNo];
    if(!source)throw Error('Pedido de origem não encontrado no backup: '+ticketNo);
    const code=String(source.fornecedorCod||source.fornCod||'');
    const advanceRows=Object.values(erp.adiantamentos?.[code]||{}).filter(Boolean);
    const related=advanceRows.filter(row=>String(row.ticket||'')===ticketNo);
    const credits=related.filter(a=>a.status==='Quitado'&&!String(a.forma||'').toLowerCase().includes('cheque'));
    const paid=Math.round(Number(source.adiantamento||0)*100);
    const price=Math.round(Number(source.totalGeral||0)*100);
    const excess=paid-price;
    const applied=Object.values(erp.tickets||{}).filter(t=>t&&String(t.fornecedorCod||t.fornCod||'')===code&&String(t.creditoFornecedorOrigem||'')===ticketNo).map(t=>({ticket:t.ticket,valor:Number(t.creditoFornecedorAplicado||0)}));
    const used=applied.reduce((sum,t)=>sum+Math.round(t.valor*100),0);
    const saldoRaw=erp.saldoDevedor?.[code];
    const saldo=Math.round(Number(typeof saldoRaw==='object'?saldoRaw?.valor:saldoRaw||0)*100);
    const valid=credits.length===1&&Math.round(Number(credits[0].valor||0)*100)===paid&&excess>=0&&saldo===excess-used&&
      (!saldoRaw?.ticket||String(saldoRaw.ticket)===ticketNo);
    const result={ticketOrigem:ticketNo,fornecedorCodigo:code,totalCompra:Number(source.totalGeral||0),adiantamentoRegistrado:Number(source.adiantamento||0),
      abatimentoMaximoNaCompra:Math.min(Number(source.totalGeral||0),Number(source.adiantamento||0)),
      creditoOriginal:excess/100,consumosPosteriores:applied,creditoJaConsumido:used/100,creditoPersistido:saldo/100,
      adiantamentosVinculados:related.map(a=>({codigo:a.cod,valor:a.valor,status:a.status})),
      conciliacaoComprovavel:valid,
      aviso:valid?'Os valores são compatíveis; confirme no Firebase antes de realizar novas compras.':'Inconsistência ou origem ambígua; nenhuma compensação automática deve ser realizada.'};
    console.log(JSON.stringify(result,null,2));
    if(!valid)process.exitCode=1;
  }catch(error){console.error('[AUDITORIA] '+error.message);process.exitCode=1;}
}
