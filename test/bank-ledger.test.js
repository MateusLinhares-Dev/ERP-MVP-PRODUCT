import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync(new URL('../public/modules/banking/bank-ledger.js',import.meta.url),'utf8');
const window={};runInNewContext(code,{window,Date,Number,String,Math,Object});
const {isoDate,statement,brl}=window.erpBankLedger;

test('datas BR e ISO são normalizadas, datas inválidas não passam',()=>{
  assert.equal(isoDate('20/10/2026'),'2026-10-20');
  assert.equal(isoDate('2026-10-02'),'2026-10-02');
  assert.equal(isoDate('31/02/2026'),'');
  assert.equal(isoDate('00/10/2026'),'');
});

test('extrato usa ordem cronológica real e calcula saldo acumulado em centavos',()=>{
  const entries=[
    {id:'1',bancoCod:'BC1',data:'20/10/2026',tipo:'Saída',valor:30.10},
    {id:'2',bancoCod:'BC1',data:'05/11/2025',tipo:'Entrada',valor:50.05},
    {id:'3',bancoCod:'BC1',data:'02/10/2026',tipo:'Saída',valor:10.01},
    {id:'4',bancoCod:'OTHER',data:'01/10/2026',tipo:'Entrada',valor:500}
  ];
  const copy=structuredClone(entries);
  const s=statement({openingBalance:100,bankCode:'BC1',entries});
  assert.equal(s.rows.map(row=>row.entry.id).join(','),'2,3,1');
  assert.deepEqual(s.rows.map(row=>row.balance),[150.05,140.04,109.94]);
  assert.equal(s.closingBalance,109.94);
  assert.equal(s.credits,50.05);
  assert.equal(s.debits,40.11);
  assert.deepEqual(entries,copy,'não mutar dados no banco');
  assert.equal(brl(1234.5),'1.234,50');
});

test('lançamentos do mesmo dia mantêm ordem de cadastro',()=>{
  const s=statement({bankCode:'B',entries:[
    {id:'a',bancoCod:'B',data:'03/02/2026',tipo:'Entrada',valor:1},
    {id:'b',bancoCod:'B',data:'2026-02-03',tipo:'Saída',valor:2}
  ]});
  assert.equal(s.rows.map(row=>row.entry.id).join(','),'a,b');
});
