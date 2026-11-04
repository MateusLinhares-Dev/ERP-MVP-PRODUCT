import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {listAdvanceCheques} from '../server/application/finance-advances.js';
import '../public/modules/phase1/rhid-card-reader.js';
import '../public/modules/finance/advance-cheque-report.js';

const report=globalThis.AdvanceChequeReport;
const reader=globalThis.RHiDCardReader;
function row(...pairs){return {itens:pairs.map(([x,str])=>({x,str}))};}
const october=[
  row([600,'DE'],[620,'01/10/2026'],[700,'ATÉ'],[735,'31/10/2026']),
  row([37,'NOME DO FUNCIONÁRIO:'],[145,'FUNCIONÁRIO EXEMPLO'],[375,'CPF DO FUNCIONÁRIO:'],[475,'00000000000']),
  row([696,'TOTAL'],[775,'EXTRAS']),
  row([37,'DIA'],[242,'ENT.'],[262,'1'],[354,'SAÍ.'],[372,'1'],[465,'ENT.'],[485,'2'],[577,'SAÍ.'],[595,'2'],[696,'TRABALHADO'],[775,'TOTAL']),
  row([37,'01/10/2026'],[79,'-'],[84,'QUI'],[242,'07:48'],[264,'(I)'],[354,'12:00'],[375,'(I)'],[465,'13:00'],[487,'(I)'],[577,'17:48'],[598,'(I)'],[696,'09:00'],[775,'00:12']),
  row([37,'02/10/2026'],[79,'-'],[84,'SEX'],[242,'Viagem'],[577,'Viagem']),
  row([37,'03/10/2026'],[79,'-'],[84,'SAB'],[242,'Folga']),
  row([37,'TOTAIS'],[696,'09:00'],[775,'00:12'])
];

test('RH iD outubro aceita formato real sem PREVISTO e cabeçalho separado',()=>{
  const card=reader.parsePage(october,october.map(l=>l.itens.map(i=>i.str).join(' ')).join('\n'));
  assert.equal(card.nome,'FUNCIONÁRIO EXEMPLO');
  assert.equal(card.cpf,'00000000000');
  assert.equal(card.periodoInicio,'01/10/2026');
  assert.equal(card.periodoFim,'31/10/2026');
  assert.equal(card.dias.length,3);
  assert.equal(card.dias[0].ent1,'07:48 (I)');
  assert.equal(card.dias[0].total,'09:00');
  assert.equal(card.dias[0].extrasTotal,'00:12');
  assert.match(card.dias[1].observacao,/Viagem/);
  assert.match(card.dias[2].observacao,/Folga/);
});

test('RH iD mantém o contrato de gravação confirmada para múltiplos cartões',()=>{
  const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
  assert.match(core,/await window\._fbDB\.ref\('erp\/pontoBatidas'\)\.update\(updates\)/);
  assert.match(core,/A coluna PREVISTO é opcional/);
});

function fakeDb(raw){return {ref(path){return {async get(){return {val:()=>raw[path]||null};}};}};}
const allowed={erpAccess:true,canAdvances:true,uid:'teste',erpUser:'perfil_financeiro'};
const cheques={
  'CC1':{id:'CC1',advanceCode:'ADT001',fornCod:'F001',emitente:'ALUMIL ESQUADRIAS',dest:'CICLO',n:'3126',d:'05/11/2026',v:3000,venc:'15/11/2026',s:'A'},
  'CC2':{id:'CC2',advanceCode:'ADT002',fornCod:'F001',emitente:'MOACIR MARANGONI',dest:'CICLO',n:'850220',d:'05/11/2026',v:4000,s:'C'},
  'CC3':{id:'CC3',advanceCode:'ADT003',fornCod:'F002',emitente:'OUTRO',dest:'OUTRO CLIENTE',n:'3',d:'04/11/2026',v:500,s:'A'},
  'OTHER':{id:'OTHER',dest:'CICLO',n:'999',d:'05/11/2026',v:9000}
};

test('relatório só lista cheques vinculados a adiantamentos, sem sigilo bancário',async()=>{
  const {cheques:result}=await listAdvanceCheques(allowed,{db:fakeDb({'erp/chequesControle':cheques,'erp/chequesControle_del':{'CC3':true}})});
  assert.equal(result.length,2);
  assert.equal(result[0].empresa,'ALUMIL ESQUADRIAS');
  assert.equal(result[0].cliente,'CICLO');
  assert.equal(result[1].situacao,'Compensado');
  assert.ok(!Object.hasOwn(result[0],'banco'));
  assert.ok(!Object.hasOwn(result[0],'fornCod'));
});

test('perfil sem Adiantamentos não recebe relatório',async()=>{
  await assert.rejects(listAdvanceCheques({...allowed,canAdvances:false},{db:fakeDb({})}),error=>error.status===403);
});


test('cheques de cliente marcados como adiantamento entram na tabela só com canFinance',async()=>{
  const db=fakeDb({'erp/chequesControle':cheques,'erp/chequesCli':{
    CICLO:[{num:'3132',valor:4990,emitente:'GN ALUMINIOS',tipo:'Adiantamento',bomPara:'08/11/2026',status:'Pendente'},
      {num:'999',valor:100,tipo:'Pagamento',bomPara:'08/11/2026'}]
  }});
  const restricted=await listAdvanceCheques(allowed,{db});
  assert.equal(restricted.cheques.length,3);
  const full=await listAdvanceCheques({...allowed,canFinance:true},{db});
  assert.equal(full.cheques.length,4);
  const row=full.cheques.find(item=>item.numero==='3132');
  assert.equal(row.cliente,'CICLO');
  assert.equal(row.empresa,'GN ALUMINIOS');
  assert.equal(row.origem,'Cheque de cliente');
});

test('filtros cliente, emissor, mês, ano, período e total mantêm centavos',async()=>{
  const {cheques:items}=await listAdvanceCheques(allowed,{db:fakeDb({'erp/chequesControle':cheques})});
  const match=report.filter(items,{cliente:'cícLo',empresa:'moacir',year:'2026',month:'11',from:'2026-11-01',to:'2026-11-30'});
  assert.equal(match.length,1);
  assert.equal(match[0].numero,'850220');
  assert.deepEqual(report.summary(report.filter(items,{cliente:'CICLO'})),{count:2,total:7000});
  assert.equal(report.filter(items,{year:'2025'}).length,0);
  assert.equal(report.isoDate('05/11/2026'),'2026-11-05');
});

test('CSV inclui linhas e total no formato brasileiro e bloqueia fórmulas',()=>{
  const output=report.csv([{empresa:'=1+1',cliente:'CICLO',numero:'001',data:'05/11/2026',vencimento:'',valor:3000.5,situacao:'A compensar',adiantamento:'ADT001'}]);
  assert.match(output,/"EMPRESA";"CLIENTE"/);
  assert.match(output,/"'=1\+1"/);
  assert.match(output,/"3\.000,50"/);
  assert.match(output,/"TOTAL"/);
});

test('UI vincula relatório ao controle e carrega API protegida sem consultar bancos',()=>{
  const html=readFileSync(new URL('../public/index.template.html',import.meta.url),'utf8');
  const bootstrap=readFileSync(new URL('../public/app/bootstrap.js',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/modules/finance/advance-cheque-report.js',import.meta.url),'utf8');
  assert.match(html,/id="adt-cheques-report"/);
  assert.match(html,/abrirRelatorioChequesAdiantamentos\(\)/);
  assert.match(bootstrap,/\/modules\/finance\/advance-cheque-report\.js/);
  assert.match(js,/\/api\/finance\/advance-cheques/);
  assert.doesNotMatch(js,/erp\/bancos|erp\/lancBanco/);
});
