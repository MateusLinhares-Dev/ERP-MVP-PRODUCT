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

test('lançamentos pequenos alteram saldos mesmo após movimentações gigantes legadas',()=>{
  const huge=Number('12222222222222220000000000000000000000000');
  const input=[
    {id:'legacy',bancoCod:'BC1',data:'2026-10-20',tipo:'Entrada',valor:huge},
    {id:'little-1',bancoCod:'BC1',data:'2026-10-21',tipo:'Entrada',valor:1.11},
    {id:'little-2',bancoCod:'BC1',data:'2026-10-22',tipo:'Entrada',valor:0.01},
    {id:'little-3',bancoCod:'BC1',data:'2026-10-23',tipo:'Saída',valor:0.02},
  ];
  const s=statement({openingBalance:1000,bankCode:'BC1',entries:input});
  const ledger=window.erpBankLedger;
  assert.equal(s.hasUnsafeLegacyValues,true);
  assert.equal(ledger.toCents(s.rows[1].balance)-ledger.toCents(s.rows[0].balance),111n);
  assert.equal(ledger.toCents(s.rows[2].balance)-ledger.toCents(s.rows[1].balance),1n);
  assert.equal(ledger.toCents(s.rows[3].balance)-ledger.toCents(s.rows[2].balance),-2n);
  assert.equal(ledger.toCents(s.closingBalance)-ledger.toCents(s.rows[0].balance),110n);
  assert.equal(ledger.toCents(ledger.addMoney([s.closingBalance,'2.03']))-ledger.toCents(s.closingBalance),203n);
  assert.match(brl(s.closingBalance),/,10$/);
});

test('strings decimais grandes são preservadas sem coerção para Number',()=>{
  const exact='1222222222222222222222222222222222222.91';
  const api=window.erpBankLedger;
  assert.equal(api.toCents(exact),122222222222222222222222222222222222291n);
  assert.equal(api.brl(exact),'1.222.222.222.222.222.222.222.222.222.222.222.222,91');
  const s=statement({openingBalance:exact,bankCode:'A',entries:[
    {bancoCod:'A',tipo:'Entrada',valor:0.09,data:'2026-10-24'}
  ]});
  assert.equal(api.toCents(s.closingBalance)-api.toCents(exact),9n);
});

test('saldo de múltiplas contas usa o mesmo cálculo de centavos do extrato',()=>{
  const api=window.erpBankLedger;
  const statements=[
    statement({openingBalance:10,bankCode:'A',entries:[{bancoCod:'A',tipo:'Entrada',valor:1.01,data:'2026-10-24'}]}),
    statement({openingBalance:2,bankCode:'B',entries:[{bancoCod:'B',tipo:'Saída',valor:0.02,data:'2026-10-24'}]})
  ];
  assert.equal(api.addMoney(statements.map(s=>s.closingBalance)),12.99);
  assert.equal(api.sign(api.addMoney(statements.map(s=>s.closingBalance))),1);
});
