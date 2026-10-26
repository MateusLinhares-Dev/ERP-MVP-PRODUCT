import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {buildSecurityClaims} from '../server/domain/access.js';

const load=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function domain(){
  const global={};global.window=global;
  runInNewContext(load('public/modules/banking/bank-ledger.js'),global);
  runInNewContext(load('public/modules/banking/reconciliation-domain.js'),global);
  return global.erpBankReconciliationDomain;
}
const fixture=`OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261024000000[-3:BRT]
<TRNAMT>-1500.40
<FITID>TRANSF0001
<NAME>PIX EMPRESA A
<MEMO>Fornecedor ABC &amp; Companhia
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261025153000
<TRNAMT>99.01
<FITID>TRANSF0002
<MEMO>Recebimento de cliente
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test('OFX SGML identifica datas, valores em centavos e entidades sem arredondar',()=>{
  const rows=domain().parseOfx(fixture);
  assert.equal(rows.length,2);
  assert.equal(rows[0].date,'2026-10-24');
  assert.equal(rows[0].amountCents,'-150040');
  assert.equal(rows[0].description,'Fornecedor ABC & Companhia');
  assert.equal(rows[0].fingerprint,'FITID:TRANSF0001');
  assert.equal(rows[1].amountCents,'9901');
});

test('OFX sem FITID usa ocorrência na impressão digital para não perder itens iguais',()=>{
  const text='<OFX><BANKTRANLIST>'+Array(2).fill('<STMTTRN><DTPOSTED>20261024<TRNAMT>1.23<MEMO>Compra</STMTTRN>').join('')+'</BANKTRANLIST>';
  const [a,b]=domain().parseOfx(text);
  assert.notEqual(a.fingerprint,b.fingerprint);
});

test('OFX inválido, zero e números exponenciais não são importados',()=>{
  const d=domain();
  assert.throws(()=>d.parseOfx('<html></html>'));
  assert.throws(()=>d.parseOfx(fixture.replace('-1500.40','0.00')));
  assert.throws(()=>d.parseOfx(fixture.replace('-1500.40','1e999')));
  assert.throws(()=>d.parseOfx(fixture.replace('20261024','20261340')));
});

test('Correspondências exigem direção e valor exato, não sugerem outro total',()=>{
  const rows=domain().parseOfx(fixture);
  const targets=[
    {kind:'payable',id:'CP1',date:'2026-10-24',description:'Fornecedor ABC',amount:1500.4,status:'Pendente'},
    {kind:'receivable',id:'CR2',date:'2026-10-24',description:'Cliente',amount:1500.4},
    {kind:'bankEntry',id:'LB3',direction:'expense',date:'2026-10-24',amount:1500.4},
    {kind:'payable',id:'CP4',date:'2026-10-24',description:'Outro',amount:1500.41}
  ];
  assert.deepEqual(domain().suggestions(rows[0],targets).map(x=>x.id),['LB3','CP1']);
  assert.deepEqual(domain().suggestions(rows[0],targets,{used:new Set(['bankEntry:LB3'])}).map(x=>x.id),['CP1']);
});

test('Eventos imutáveis definem o último estado sem descartar o histórico',()=>{
  const events={a:{id:'a',importId:'I01',status:'reconciled',createdAt:3},b:{id:'b',importId:'I01',status:'reversed',createdAt:4}};
  assert.equal(domain().lastDecisions(events).get('I01').status,'reversed');
  assert.equal(Object.keys(events).length,2);
});

test('Regras RTDB restringem conciliação a canBanking e não permitem regravar itens',()=>{
  const rules=JSON.parse(load('database.rules.json')).rules.erp;
  const imports=rules.bankReconciliationImports;
  const events=rules.bankReconciliationEvents;
  for(const rule of [imports,events]){
    assert.match(rule['.read'],/canBanking == true/);
    assert.equal(rule['.write'],undefined);
    assert.equal(rule.$bankCode['.write'],undefined);
    assert.match(Object.values(rule.$bankCode)[0]['.write'],/!data.exists\(\)/);
  }
  assert.match(imports.$bankCode.$entryId['.validate'],/importedBy.*auth\.token\.erpUser/);
  assert.match(events.$bankCode.$eventId['.validate'],/actor.*auth\.token\.erpUser/);
  const bank=buildSecurityClaims({tabs:['contas_banco']});
  const unauthorised=buildSecurityClaims({tabs:['vendas']});
  const expr=imports['.read'];
  assert.equal(Boolean(runInNewContext(expr,{auth:{token:{erpAccess:true,...bank}}})),true);
  assert.equal(Boolean(runInNewContext(expr,{auth:{token:{erpAccess:true,...unauthorised}}})),false);
});

test('A interface integra com Bancos e não cria lançamentos bancários adicionais',()=>{
  const code=load('public/modules/banking/reconciliation-ui.js');
  const core=load('public/legacy/app-core.js');
  const boot=load('public/app/bootstrap.js');
  assert.match(core,/erpReconciliationOpen/);
  assert.match(core,/erpReconciliationSources/);
  assert.match(boot,/reconciliation-domain\.js/);
  assert.match(boot,/reconciliation-ui\.js/);
  assert.doesNotMatch(code,/saveContasPagar\s*\(|saveContasReceber\s*\(|saveBancos\s*\(|LANC_BANCO_DB\.push/);
  assert.match(code,/bankReconciliationImports/);
  assert.match(code,/bankReconciliationEvents/);
});
