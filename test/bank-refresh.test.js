import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const code=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const extract=(a,b)=>{
  const start=code.indexOf(a),end=code.indexOf(b,start+a.length);
  assert.ok(start>=0 && end>start,`não encontrei ${a} -> ${b}`);
  return code.slice(start,end);
};
const json=value=>JSON.parse(JSON.stringify(value));
const apply=extract('function _bancoTirarLocal(id){','function rebuildBancosDropdowns(){');

test('resultado do servidor atualiza contas, extrato e cheques na tela sem F5',()=>{
  const banks=[{id:'BC1',cod:'BC-001',banco:'Sicredi'},{id:'BC2',cod:'BC-002',banco:'Itaú'}];
  const entries=[{id:'LB-1',bancoCod:'BC-002'},{id:'LB-2',bancoCod:'BC-001'}];
  const removed={banks:[],entries:[]};let renders=0,chequeRenders=0;
  const ctx={BANCOS_DB:banks,LANC_BANCO_DB:entries,CHQ_CTRL:{C1:{s:'A'},C2:{s:'C',movBancoId:'LB-2'}},_chqDel:{},
    _syncLancBanco:{remover(i){removed.entries.push(entries[i].id);entries.splice(i,1);}},
    _syncBancos:{remover(i){removed.banks.push(banks[i].id);banks.splice(i,1);}},
    window:{erpBankMovementAdded(m){const i=entries.findIndex(l=>l.id===m.id);if(i>=0)entries[i]=m;else entries.push(m);}},
    localStorage:{setItem(){}},renderBancos(){renders++;},rebuildBancosDropdowns(){},renderChequesCompensar(){chequeRenders++;}};
  runInNewContext(apply+';this.apply=_bancoAplicarResultado;',ctx);
  ctx.apply({action:'create-account',account:{id:'BC3',cod:'BC-003',banco:'Bradesco'}});
  ctx.apply({action:'update-account',account:{id:'BC2',cod:'BC-009',banco:'Itaú'},codeChange:{from:'BC-002',to:'BC-009',movedEntries:1}});
  assert.equal(JSON.stringify(banks.map(b=>b.cod)),JSON.stringify(['BC-001','BC-009','BC-003']));
  assert.equal(entries[0].bancoCod,'BC-009');
  ctx.apply({action:'add-entry',movement:{id:'LB-3',bancoCod:'BC-001'}});
  ctx.apply({action:'delete-entry',id:'LB-1'});
  ctx.apply({action:'clear-cheques',date:'17/11/2026',cleared:[{id:'C1',movBancoId:'LB-4'}],movements:[{id:'LB-4',bancoCod:'BC-001'}]});
  assert.equal(JSON.stringify(ctx.CHQ_CTRL.C1),JSON.stringify({s:'C',cd:'17/11/2026',movBancoId:'LB-4'}));
  ctx.apply({action:'reopen-cheque',id:'C2',removedMovementId:'LB-2'});
  assert.equal(JSON.stringify(ctx.CHQ_CTRL.C2),JSON.stringify({s:'A',cd:''}));
  ctx.apply({action:'delete-cheque',id:'C1',removedMovementId:'LB-4'});
  assert.equal(ctx.CHQ_CTRL.C1,undefined);assert.equal(ctx._chqDel.C1,true);
  ctx.apply({action:'delete-account',id:'BC3'});
  assert.equal(JSON.stringify(entries.map(l=>l.id)),JSON.stringify(['LB-3']));
  assert.equal(JSON.stringify(removed),JSON.stringify({banks:['BC3'],entries:['LB-1','LB-2','LB-4']}));
  assert.equal(renders,8);assert.equal(chequeRenders,3);
});
