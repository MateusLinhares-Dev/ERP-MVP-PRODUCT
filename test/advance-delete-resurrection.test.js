import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createAdvance,changeAdvance} from '../server/application/finance-advances.js';
import {previewOrphanAdvance} from '../server/application/advance-orphan-recovery.js';

const copy=x=>x===undefined?undefined:structuredClone(x);
function memoryDB(){
 const state={erp:{adiantamentos:{F675:[]},bancos:{b:{cod:'BC-005',banco:'Conta teste'}},fornecedores:{f:{cod:'F675',nome:'TESTE NAO APAGAR'}}}};
 const get=p=>String(p).split('/').filter(Boolean).reduce((o,k)=>o?.[k],state);
 const set=(p,v)=>{const s=String(p).split('/').filter(Boolean),k=s.pop();let o=state;for(const x of s)o=o[x]??={};if(v===null)delete o[k];else o[k]=copy(v);};
 const writes=[];
 return {state,get,writes,ref(path=''){return {
  async get(){return {val:()=>copy(get(path)??null)};},
  async transaction(fn){const prior=copy(get(path)??null),next=fn(prior);if(next===undefined)return {committed:false};set(path,next);return {committed:true};},
  async update(values){writes.push(Object.keys(values));for(const [key,value] of Object.entries(values))set([path,key].filter(Boolean).join('/'),value);}
 };}};
}
const actor={uid:'u1',erpUser:'elaine',erpAccess:true,canAdvances:true};
const op=i=>'cccccccc-'+String(i).padStart(4,'0')+'-4000-8000-'+String(i).padStart(12,'0');
const original={fornCod:'F675',valor:124,data:'2026-11-05',forma:'PIX',bancoCod:'BC-005',empresa:'Empresa de teste',ticket:'',obs:'Teste'};
const create=async db=>createAdvance(actor,{...original,operationId:op(1)},{db,now:()=>100000,uuid:()=> 'aabbccdd-1111-4444-8888-111122223333'});
const remove=async(db,advance,id)=>changeAdvance(actor,{action:'delete',fornCod:'F675',adtCod:advance.cod,expected:advance,operationId:op(id)},{db,now:()=>100000+id*1000,uuid:()=> '11223344-1111-4444-8888-111122223333'});

test('cria, exclui, reintroduz cópia legada e confirma exclusão sem novo débito bancário',async()=>{
 const db=memoryDB(),created=await create(db);
 const advance=created.advance,movement=created.bankMovement;
 const first=await remove(db,advance,2);
 assert.equal(first.action,'delete');
 assert.equal(db.get('erp/lancBanco/'+movement.id),undefined);
 assert.equal(db.get('erp/adiantamentos/F675').length,0);
 assert.equal(db.get('erp/financeAdvanceDeleted/F675/'+advance.cod).movementRemovedId,movement.id);
 // Simulate a previous client overwriting the canonical supplier list.
 db.state.erp.adiantamentos.F675=[copy(advance)];
 const beforeBank=JSON.stringify(db.get('erp/lancBanco'));
 const repaired=await remove(db,advance,3);
 assert.equal(repaired.action,'delete');
 assert.equal(repaired.restoredDeletion,true);
 assert.equal(db.get('erp/adiantamentos/F675').length,0);
 assert.equal(JSON.stringify(db.get('erp/lancBanco')),beforeBank);
 assert.equal(db.get('erpFinanceAdvanceLocks/F675'),undefined);
 assert.equal(db.get('erp/financeAdvanceDeleted/F675/'+advance.cod).reason,'confirmed_delete_receipt_reappeared');
 assert.equal(db.get('erp/financeAdvanceOperations/u1_'+op(3)).result.removedCode,advance.cod);
 const retry=await remove(db,advance,3);
 assert.equal(retry.alreadyCommitted,true);
 assert.equal(db.get('erp/adiantamentos/F675').length,0);
 // Um segundo navegador antigo ainda aberto tenta restaurar o mesmo cadastro.
 db.state.erp.adiantamentos.F675=[copy(advance)];
 const third=await remove(db,advance,5);
 assert.equal(third.restoredDeletion,true);
 assert.equal(db.get('erp/adiantamentos/F675').length,0);
 assert.equal(JSON.stringify(db.get('erp/lancBanco')),beforeBank);
});

test('sem recibo de exclusão confirmado, movimento ausente continua bloqueado',async()=>{
 const db=memoryDB(),created=await create(db);
 delete db.state.erp.lancBanco[created.bankMovement.id];
 await assert.rejects(()=>remove(db,created.advance,4),{code:'BANK_LEDGER_CHANGED'});
 assert.equal(db.get('erp/adiantamentos/F675').length,1);
});

test('recibo confirmado não permite excluir se houve utilização posterior em compra',async()=>{
 const db=memoryDB(),created=await create(db);
 await remove(db,created.advance,2);
 db.state.erp.adiantamentos.F675=[copy(created.advance)];
 db.state.erp.tickets={T999:{refAdvance:created.advance.cod}};
 await assert.rejects(()=>remove(db,created.advance,3),{code:'ADVANCE_USED'});
 assert.equal(db.get('erp/adiantamentos/F675').length,1);
});

test('criação e exclusão normais continuam com marca de exclusão; regra proíbe escrita financeira direta',async()=>{
 const db=memoryDB(),created=await create(db);await remove(db,created.advance,2);
 assert.ok(db.get('erp/financeAdvanceDeleted/F675/'+created.advance.cod));
 const rules=JSON.parse(readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')).rules;
 assert.equal(rules.erp.adiantamentos['.write'],false);
 assert.equal(rules.erp.financeAdvanceDeleted['.write'],false);
 const policy=JSON.parse(readFileSync(new URL('../public/app/rtdb-collection-policy.json',import.meta.url),'utf8'));
 assert.equal(policy.nodes.adiantamentos.write.mode,'none');
 assert.equal(policy.nodes.financeAdvanceDeleted.read.mode,'claims');
});

test('sincronizador não envia adiantamentos locais e aplica marca de exclusão recebida',()=>{
 const sync=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
 assert.doesNotMatch(sync,/dados\['adiantamentos\/['"]?\+fornCod\]/);
 assert.match(sync,/const _adtAlteradosNoLote=\{\};/);
 const start=sync.indexOf('function _filtrarAdiantamentosExcluidos(');
 const end=sync.indexOf('  const _fbAdiantamentosBase=',start);
 assert.ok(start>0&&end>start);
 const ctx={};runInNewContext(sync.slice(start,end)+';this.filter=_filtrarAdiantamentosExcluidos;',ctx);
 const records={F675:[{cod:'A1'},{cod:'A2'}],F900:[{cod:'A3'}]};
 ctx.filter(records,{F675:{A1:{removedCode:'A1',removedAt:1234}}});
 assert.deepEqual(Array.from(records.F675,a=>a.cod),['A2']);
 assert.equal(records.F900[0].cod,'A3');
});

test('o browser não contém escrita direta de adiantamentos nem restauração pelo histórico antigo',()=>{
 const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
 assert.doesNotMatch(core,/\.ref\(['"]erp\/adiantamentos/);
 assert.match(core,/advance\.legacy\.write\.blocked/);
 assert.match(core,/A restauração financeira pelo histórico antigo foi desativada|Não é possível restaurar um adiantamento pelo histórico/);
});


test('recibo antigo de criação sem fornCod: exclusão confirmada remove registro reaparecido',async()=>{
 const db=memoryDB(),created=await create(db);
 // Reproduz o backup real de 05/11: o recibo de criação não trazia
 // fornCod na raiz, mas preservava o avanço e o movimento original.
 const receipt=db.get('erp/financeAdvanceOperations/u1_'+op(1));
 delete receipt.fornCod;
 db.state.erp.financeAdvanceOperations['u1_'+op(1)]=receipt;
 const advance=created.advance,movement=created.bankMovement;
 await remove(db,advance,2);
 db.state.erp.adiantamentos.F675=[copy(advance)];
 const beforeLedger=JSON.stringify(db.get('erp/lancBanco'));
 const reviewed=await previewOrphanAdvance({...actor,canBanking:true},
   {fornCod:'F675',adtCod:advance.cod},{db});
 assert.equal(reviewed.eligible,false);
 assert.ok(reviewed.issues.some(message=>message.includes('já confirmou a exclusão')));
 assert.equal(reviewed.issues.some(message=>message.includes('Outra operação financeira utiliza')),false);
 const repaired=await remove(db,advance,3);
 assert.equal(repaired.restoredDeletion,true);
 assert.equal(db.get('erp/adiantamentos/F675').length,0);
 assert.equal(JSON.stringify(db.get('erp/lancBanco')),beforeLedger);
});

test('recibo antigo com representação bancária divergente não prevalece sobre exclusão já confirmada',async()=>{
 const db=memoryDB(),created=await create(db);
 const receipt=db.get('erp/financeAdvanceOperations/u1_'+op(1));
 delete receipt.fornCod;
 receipt.bankMovement.advanceCode='OUTRO_ADIANTAMENTO';
 db.state.erp.financeAdvanceOperations['u1_'+op(1)]=receipt;
 await remove(db,created.advance,2);
 db.state.erp.adiantamentos.F675=[copy(created.advance)];
 const result=await remove(db,created.advance,3);
 assert.equal(result.restoredDeletion,true);
 assert.equal(db.get('erp/adiantamentos/F675').length,0);
 assert.equal(db.get('erp/lancBanco/'+created.bankMovement.id),undefined);
});

test('recibo antigo com fornecedor divergente não permite recuperação',async()=>{
 const db=memoryDB(),created=await create(db);
 const receipt=db.get('erp/financeAdvanceOperations/u1_'+op(1));
 receipt.fornCod='OUTRO_FORNECEDOR';
 db.state.erp.financeAdvanceOperations['u1_'+op(1)]=receipt;
 await remove(db,created.advance,2);
 db.state.erp.adiantamentos.F675=[copy(created.advance)];
 await assert.rejects(()=>remove(db,created.advance,3),{code:'BANK_LEDGER_CHANGED'});
 assert.equal(db.get('erp/adiantamentos/F675').length,1);
});


test('recibo historico sem bankMovement e sem fornCod ainda permite concluir exclusao previamente confirmada',async()=>{
 const db=memoryDB(),created=await create(db);
 await remove(db,created.advance,2);
 const receipt=db.get('erp/financeAdvanceOperations/u1_'+op(1));
 delete receipt.fornCod;
 delete receipt.bankMovement; // historical receipts may have only the advance snapshot
 db.state.erp.financeAdvanceOperations['u1_'+op(1)]=receipt;
 db.state.erp.adiantamentos.F675=[copy(created.advance)];
 const before=JSON.stringify(db.get('erp/lancBanco'));
 const restored=await remove(db,created.advance,3);
 assert.equal(restored.restoredDeletion,true);
 assert.equal(db.get('erp/adiantamentos/F675').length,0);
 assert.equal(JSON.stringify(db.get('erp/lancBanco')),before);
});

test('campos bancarios opcionais ausentes sao compativeis, campos explicitamente diferentes continuam bloqueados',async()=>{
 const db=memoryDB(),created=await create(db);
 await remove(db,created.advance,2);
 const receipt=db.get('erp/financeAdvanceOperations/u1_'+op(1));
 delete receipt.fornCod;
 receipt.bankMovement={id:created.advance.movBancoId};
 db.state.erp.financeAdvanceOperations['u1_'+op(1)]=receipt;
 db.state.erp.adiantamentos.F675=[copy(created.advance)];
 assert.equal((await remove(db,created.advance,3)).restoredDeletion,true);
 db.state.erp.adiantamentos.F675=[copy(created.advance)];
 receipt.bankMovement={id:created.advance.movBancoId,bancoCod:'BC-OUTRA'};
 db.state.erp.financeAdvanceOperations['u1_'+op(1)]=receipt;
 const restored=await remove(db,created.advance,4);
 assert.equal(restored.restoredDeletion,true);
 assert.equal(db.get('erp/adiantamentos/F675').length,0);
});

test('nem mesmo exclusao confirmada permite re-remover se o registro recebeu uso posterior',async()=>{
 const db=memoryDB(),created=await create(db);
 await remove(db,created.advance,2);
 const receipt=db.get('erp/financeAdvanceOperations/u1_'+op(1));
 delete receipt.fornCod;
 delete receipt.bankMovement;
 db.state.erp.financeAdvanceOperations['u1_'+op(1)]=receipt;
 db.state.erp.adiantamentos.F675=[copy(created.advance)];
 db.state.erp.contasPagar={CP_X:{adiantamentoId:created.advance.cod}};
 await assert.rejects(()=>remove(db,created.advance,3),{code:'ADVANCE_USED'});
 assert.equal(db.get('erp/adiantamentos/F675').length,1);
});


test('recibo de criacao com valor ou banco originais realmente diferentes bloqueia reparo',async()=>{
 const db=memoryDB(),created=await create(db);
 await remove(db,created.advance,2);
 const receipt=db.get('erp/financeAdvanceOperations/u1_'+op(1));
 delete receipt.fornCod;
 receipt.advance.valor=999;
 db.state.erp.financeAdvanceOperations['u1_'+op(1)]=receipt;
 db.state.erp.adiantamentos.F675=[copy(created.advance)];
 await assert.rejects(()=>remove(db,created.advance,3),{code:'BANK_LEDGER_CHANGED'});
 assert.equal(db.get('erp/adiantamentos/F675').length,1);
});

test('recibo de exclusao sozinho sem comprovante de criacao nao remove outro adiantamento',async()=>{
 const db=memoryDB(),created=await create(db);
 await remove(db,created.advance,2);
 delete db.state.erp.financeAdvanceOperations['u1_'+op(1)];
 db.state.erp.adiantamentos.F675=[copy(created.advance)];
 await assert.rejects(()=>remove(db,created.advance,3),{code:'BANK_LEDGER_CHANGED'});
 assert.equal(db.get('erp/adiantamentos/F675').length,1);
});
