import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditTestSupplierBackup} from '../scripts/audit-test-supplier-cleanup.mjs';
test('identifica adiantamento quitado com vínculo em título, movimento e recibos; não permite apagar',()=>{
  const db={erp:{adiantamentos:{F675:[{cod:'ADT1',valor:35,status:'Quitado',movBancoId:'LB1',ticket:'T303'}]},
    lancBanco:{LB1:{id:'LB1',valor:35,advanceCode:'ADT1',bancoCod:'BC-005'}},
    contasPagar:{CPPO_T303:{id:'CPPO_T303',fornCod:'F675',ticket:'T303',valor:50,valorPago:50,pagamentos:[{valor:0,adt:50}]}},
    financeAdvanceOperations:{a:{advance:{cod:'ADT1'}}}}};
  const r=auditTestSupplierBackup(db);
  assert.equal(r.advances.length,1);
  assert.equal(r.payables.length,1);
  assert.equal(r.bankMovements.length,1);
  assert.ok(r.relatedReceiptKeys.financeAdvanceOperations.includes('a'));
  assert.equal(r.automaticDeletionAllowed,false);
  assert.ok(r.blockers.some(s=>s.includes('utilizados')));
});
test('relatório funciona com estrutura vazia sem alterar fonte',()=>{
  const original={erp:{adiantamentos:{F675:[{cod:'ADT1',status:'Pendente',valor:1}]}}};
  const copy=JSON.stringify(original);
  const r=auditTestSupplierBackup(original);
  assert.equal(r.advances[0].code,'ADT1');
  assert.equal(JSON.stringify(original),copy);
  assert.equal(r.mode,'SOMENTE_LEITURA');
});
