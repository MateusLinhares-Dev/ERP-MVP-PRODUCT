import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeBusinessSnapshot,buildExactRestorePatch,createSnapshot,restoreSnapshot,isValidSnapshotKey} from '../server/application/snapshot-service.js';
function fakeDb(initial){
 const data=structuredClone(initial); const ops=[];
 const ref=path=>({
   async get(){const value=path?path.split('/').reduce((v,k)=>v?.[k],data):data;return {val:()=>value,exists:()=>value!==undefined&&value!==null};},
   async set(value){let root=data;const bits=path.split('/');for(const b of bits.slice(0,-1))root=root[b]??={};root[bits.at(-1)]=structuredClone(value);ops.push(['set',path]);},
   async update(patch){for(const [path,val] of Object.entries(patch)){let root=data;const bits=path.split('/');for(const b of bits.slice(0,-1))root=root[b]??={};if(val===null)delete root[bits.at(-1)];else root[bits.at(-1)]=structuredClone(val);}ops.push(['update',Object.keys(patch)]);},
   async push(value){(data.erpAudit??={})['new-'+ops.length]=value;ops.push(['push',path]);}
 });return {ref,ops,data};
}
test('v27 snapshot reads bank source from RTDB, not stale browser memory',async()=>{
 const db=fakeDb({erp:{bancos:{BC01:{banco:'A'},BC02:{banco:'B'}},clientes:{c:{nome:'X'}}},erp_snapshots:{}});
 await createSnapshot(db,{key:'2026-09-30',operator:'elaine'});
 assert.equal(Object.keys(db.data.erp_snapshots['2026-09-30'].bancos).length,2);
});
test('v27 restore creates emergency snapshot and exactly replaces absent/new banks atomically',async()=>{
 const db=fakeDb({erp:{bancos:{new:{banco:'new'}},clientes:{c:{nome:'X'}}},erp_snapshots:{'2026-09-29':normalizeBusinessSnapshot({bancos:{old:{banco:'old'}},clientes:{c:{nome:'X'}}},'elaine')}});
 const result=await restoreSnapshot(db,{key:'2026-09-29',operator:'elaine'});
 assert.deepEqual(Object.keys(db.data.erp.bancos),['old']);
 assert.equal(db.data.erp_snapshots[result.emergency].bancos.new.banco,'new');
 assert.equal(db.ops.filter(o=>o[0]==='update').length,1);
 assert.equal(Object.values(db.data.erpAudit)[0].action,'snapshot-restored');
});
test('v27 restoring an old partial snapshot preserves uncaptured newer nodes',()=>{
 const p=buildExactRestorePatch({bancos:[{banco:'B'}]});
 assert.equal(p['erp/bancos'].length,1);assert.equal(Object.hasOwn(p,'erp/estoque'),false);
});
test('v27 older partial snapshots do not reset tombstones of untouched unrelated datasets',()=>{
 const patch=buildExactRestorePatch({bancos:{BC01:{banco:'A'}}});
 assert.equal(patch['erp/bancosDeleted'],null);
 assert.equal(patch['erp/bancosDeletedV2'],null);
 assert.equal(Object.hasOwn(patch,'erp/clientesDeleted'),false);
 assert.equal(Object.hasOwn(patch,'erp/ticketsDeleted'),false);
});

test('v27 owner can use a unique manual key without replacing todays automatic snapshot',()=>{
 assert.equal(isValidSnapshotKey('manual-1790784000000'),true);
 assert.equal(isValidSnapshotKey('manual-unsafe'),false);
});
