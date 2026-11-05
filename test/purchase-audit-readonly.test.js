import test from 'node:test';
import assert from 'node:assert/strict';
import {auditPurchaseTickets} from '../scripts/audit-purchase-sync.mjs';
const ticket=(no,sources)=>({ticket:no,fornecedorCod:'F1',dataCompra:'2026-11-05',
  _consolidado:true,_ticketsOrigemIds:sources,totalGeral:1000,
  itens:[{mat:'COBRE',pesoLiq:10,preco:100}]});
test('identifica origem consolidada no histórico e preserva dados brutos',()=>{
 const original={T001:{ticket:'T001',status:'Consolidado',_consolidadoEm:'T005'},T005:ticket('T005',['T001'])};
 const before=structuredClone(original);
 const result=auditPurchaseTickets(original);
 assert.equal(result.summary.consolidatedSourceRowsHidden,1);
 assert.equal(result.summary.financeRowsAfter,1);
 assert.deepEqual(original,before);
});
test('auditoria detecta mesma origem em dois pedidos sem excluir nenhum',()=>{
 const result=auditPurchaseTickets({T005:ticket('T005',['T001']),T006:ticket('T006',['T001'])});
 assert.deepEqual(result.overlappingSources[0].tickets,['T005','T006']);
 assert.equal(result.possibleDuplicateContent.length,1);
});
test('repetição de valor é apenas suspeita, não implica exclusão',()=>{
 const x=auditPurchaseTickets({T005:ticket('T005',['T001']),T006:ticket('T006',['T002'])});
 assert.equal(x.overlappingSources.length,0);
 assert.equal(x.possibleDuplicateContent.length,1);
});
