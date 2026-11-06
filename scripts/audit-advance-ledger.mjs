#!/usr/bin/env node
// Auditoria SOMENTE LEITURA. Nenhuma operação é enviada ao Firebase.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const records=raw=>Array.isArray(raw)?raw.filter(Boolean):Object.values(raw&&typeof raw==='object'?raw:{}).filter(Boolean);
export function inspectAdvanceLedger(snapshot,advanceCode,{now=Date.now()}={}){
  const db=snapshot?.erp&&typeof snapshot.erp==='object'?snapshot.erp:snapshot;
  const results=[];
  for(const [supplierCode,source] of Object.entries(db?.adiantamentos||{})){
    for(const advance of records(source)){
      if(String(advance?.cod)!==String(advanceCode))continue;
      const movementId=String(advance.movBancoId||'');
      const movement=movementId?(db?.lancBanco||{})[movementId]:null;
      const amountOK=movement!=null&&Number.isFinite(Number(movement.valor))&&Number.isFinite(Number(advance.valor))&&Math.abs(Number(movement.valor)-Number(advance.valor))<=0.009;
      const bankOK=movement!=null&&String(movement.bancoCod??'')===String(advance.bancoCod??'');
      const originOK=movement!=null&&String(movement.descricao||'').startsWith('Adiantamento: ')&&(!movement.advanceCode||String(movement.advanceCode)===String(advance.cod));
      const rawLock=snapshot?.erpFinanceAdvanceLocks?.[supplierCode]||null;
      results.push({
        advanceCode:String(advance.cod),supplierCode,advanceStatus:String(advance.status||''),advanceAmount:Number(advance.valor),
        movementId:movementId||null,movementExists:movement!=null,
        movementAmount:movement!=null?Number(movement.valor):null,
        movementBankCode:movement?.bancoCod??null,advanceBankCode:advance?.bancoCod??null,
        amountMatches:amountOK,bankMatches:bankOK,originMatches:originOK,
        ledgerConsistent:!movementId||(amountOK&&bankOK&&originOK),
        lockActive:Boolean(rawLock&&Number(rawLock.expiresAt)>now),
        lockRemainingSeconds:rawLock?Math.max(0,Math.ceil((Number(rawLock.expiresAt)-now)/1000)):0,
        recommendation:movementId&&!(amountOK&&bankOK&&originOK)
          ?'DIVERGÊNCIA FINANCEIRA: conciliar movimento e adiantamento antes de excluir; não eliminar a trava nem o débito manualmente.'
          :'Nenhuma divergência de vínculo detectada neste snapshot. Confirme se há compensações antes de excluir.'
      });
    }
  }
  return results;
}
function main(){
  const argv=process.argv.slice(2);
  const opts=Object.fromEntries(argv.filter(a=>a.startsWith('--')&&a.includes('=')).map(a=>{const i=a.indexOf('=');return [a.slice(2,i),a.slice(i+1)];}));
  if(!opts.snapshot||!opts.advance){console.error('Uso: node scripts/audit-advance-ledger.mjs --snapshot=./backup.json --advance=ADT...');process.exitCode=2;return;}
  const snapshot=JSON.parse(readFileSync(resolve(opts.snapshot),'utf8'));
  const rows=inspectAdvanceLedger(snapshot,opts.advance);
  if(rows.length!==1){console.error(rows.length?'Mais de um registro com o mesmo código; conciliação manual obrigatória.':'Adiantamento não encontrado no snapshot.');process.exitCode=1;return;}
  console.log(JSON.stringify(rows[0],null,2));
  if(!rows[0].ledgerConsistent)process.exitCode=1;
}
if(process.argv[1]&&/audit-advance-ledger\.mjs$/.test(process.argv[1]))main();
