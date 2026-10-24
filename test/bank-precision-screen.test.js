import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const load=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const appCore=load('public/legacy/app-core.js');
const start=appCore.indexOf('function renderBancos(){');
const end=appCore.indexOf('function _proximoCodBanco(){',start);
assert.ok(start>=0&&end>start);
const renderSource=appCore.slice(start,end);
const ledgerWindow={};
runInNewContext(load('public/modules/banking/bank-ledger.js'),{window:ledgerWindow,BigInt,Date,Number,Math});

function runBankView(entries){
  const bank={cod:'BC-001',banco:'Teste',tipo:'Conta Corrente',saldo:1000,titular:'Teste'};
  const totals=[{textContent:''},{textContent:''}];
  const subtitle={textContent:''},tbody={innerHTML:''};
  const doc={
    getElementById(id){return id==='tb-bancos'?tbody:null;},
    querySelector(selector){
      if(selector==='#tab-contas_banco .kpi-val') return totals[0];
      if(selector==='#tab-contas_banco .kpi-sub') return subtitle;
      return null;
    },
    querySelectorAll(selector){return selector==='#tab-contas_banco .kpi-val'?totals:[];}
  };
  const window={erpBankLedger:ledgerWindow.erpBankLedger,__ERP_BANKS_CLOUD_READY__:true};
  const context={
    window,document:doc,BANCOS_DB:[bank],LANC_BANCO_DB:entries,
    _cfgFinanceCompanies(){return [];},_cfgFinanceCompanyColor(){return '';},
    _empresaPorTexto(){return '';},_empresaPrincipalChave(){return 'TESTE';},
    _empresaPrincipalRazao(){return 'Teste';},_bancoDataCriacao(){return '';},
    esc(value){return String(value??'');},Number,Map,String,Math
  };
  runInNewContext(renderSource,context);
  context.renderBancos();
  return {ledger:window.erpBankLedger,kpi:totals[1].textContent,html:tbody.innerHTML,subtitle:subtitle.textContent};
}

test('KPI bancário e linha da conta incluem centavos lançados sobre valor legado gigantesco',()=>{
  const huge=Number('12222222222222220000000000000000000000000');
  const initial=runBankView([{bancoCod:'BC-001',tipo:'Entrada',valor:huge,data:'2026-10-20'}]);
  const updated=runBankView([
    {bancoCod:'BC-001',tipo:'Entrada',valor:huge,data:'2026-10-20'},
    {bancoCod:'BC-001',tipo:'Entrada',valor:1.11,data:'2026-10-24'}
  ]);
  assert.equal(updated.ledger.toCents(updated.kpi.slice(3))-updated.ledger.toCents(initial.kpi.slice(3)),111n);
  assert.match(updated.html,/1,11/);
  assert.match(updated.subtitle,/Revise lançamentos antigos/);
});

test('valores inválidos legados não derrubam todo o módulo bancário',()=>{
  const screen=runBankView([{bancoCod:'BC-001',tipo:'Entrada',valor:'valor inválido',data:'2026-10-20'}]);
  assert.equal(screen.kpi,'R$ 1.000,00');
  assert.match(screen.subtitle,/inválidos/);
});
