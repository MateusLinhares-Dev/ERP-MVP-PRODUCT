import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createLegacyDatabaseAdapter} from '../public/app/legacy-db-adapter.js';

const read = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
const sync=read('public/legacy/firebase-sync.js');
const loader=read('public/app/firebase-loader.js');

function fakeDocuments({metadata,failRemove=false,failSet=false,commitDespiteError=false,failRead=false,failStorageDelete=false}={}){
  const operations=[];
  let record=metadata;
  const files=new Map(metadata?.path ? [[metadata.path,'existing']] : []);
  const storage={ref(path){return {
    async put(blob){operations.push(['put',path]);files.set(path,blob);},
    async delete(){operations.push(['storage.delete',path]);if(failStorageDelete)throw Error('Storage denied');files.delete(path);},
    async getDownloadURL(){return 'https://example.invalid/document';}
  };}};
  const target={
    async once(){operations.push(['read']);if(failRead)throw Error('read denied');return {val:()=>record};},
    async set(value){operations.push(['db.set',value]);if(!failSet||commitDespiteError)record=value;if(failSet)throw Error('set denied');},
    async remove(){operations.push(['db.remove']);if(failRemove)throw Error('permission_denied');record=null;}
  };
  const db={ref(){return target;}};
  const adapter=createLegacyDatabaseAdapter(db,storage);
  return {ref:adapter.ref('erp/funcDocs/123/document'),operations,files,getRecord:()=>record};
}

test('exclusão negada pelo Database mantém arquivo no Storage',async()=>{
  const old={__storageV:1,path:'erp-files/funcDocs/123/document'};
  const ctx=fakeDocuments({metadata:old,failRemove:true});
  await assert.rejects(ctx.ref.remove(),/permission_denied/);
  assert.deepEqual(ctx.operations.map(x=>x[0]),['read','db.remove']);
  assert.deepEqual(ctx.getRecord(),old);
  assert.ok(ctx.files.has(old.path));
});

test('exclusão confirmada remove metadado antes do objeto físico',async()=>{
  const old={__storageV:1,path:'erp-files/funcDocs/123/document'};
  const ctx=fakeDocuments({metadata:old});
  await ctx.ref.remove();
  assert.deepEqual(ctx.operations.map(x=>x[0]),['read','db.remove','storage.delete']);
  assert.equal(ctx.getRecord(),null);
  assert.equal(ctx.files.size,0);
});

test('se Storage recusar limpeza após commit, metadado não é ressuscitado',async()=>{
  const ctx=fakeDocuments({metadata:{__storageV:1,path:'erp-files/funcDocs/123/document'},failStorageDelete:true});
  const oldWarn=console.warn;console.warn=()=>{};
  try{await ctx.ref.remove();}finally{console.warn=oldWarn;}
  assert.equal(ctx.getRecord(),null);
  assert.equal(ctx.files.size,1);
});

test('upload não sobrescreve versão anterior e respeita profundidade das regras Storage',async()=>{
  const old={__storageV:1,path:'erp-files/funcDocs/123/document'};
  const ctx=fakeDocuments({metadata:old});
  await ctx.ref.set('data:application/pdf;base64,SGVsbG8=');
  const newPath=ctx.getRecord().path;
  assert.match(newPath,/^erp-files\/funcDocs\/123\/document--v-[a-z0-9-]+$/);
  assert.ok(ctx.files.has(newPath));
  assert.ok(ctx.files.has(old.path));
});

test('upload negado pelo Database remove somente a versão recém-enviada',async()=>{
  const old={__storageV:1,path:'erp-files/funcDocs/123/document'};
  const ctx=fakeDocuments({metadata:old,failSet:true});
  await assert.rejects(ctx.ref.set('data:application/pdf;base64,SGVsbG8='),/set denied/);
  assert.deepEqual(ctx.getRecord(),old);
  assert.deepEqual([...ctx.files.keys()],[old.path]);
  assert.ok(ctx.operations.find(x=>x[0]==='storage.delete'));
});

test('resposta perdida após commit preserva o arquivo que já está no RTDB',async()=>{
  const ctx=fakeDocuments({failSet:true,commitDespiteError:true});
  await ctx.ref.set('data:application/pdf;base64,SGVsbG8=');
  assert.equal(ctx.files.size,1);
  assert.ok(ctx.files.has(ctx.getRecord().path));
  assert.equal(ctx.operations.filter(x=>x[0]==='storage.delete').length,0);
});

test('fallback de transporte do SDK permanece habilitado',()=>{
  assert.doesNotMatch(loader,/INTERNAL\.forceWebSockets\s*\(/);
});

test('reiniciar _ts não reinstala listeners de compras e fiscal',()=>{
  assert.match(sync,/const _fbTsRef=window\._fbDB\.ref\('erp\/_ts'\)/);
  const restart=sync.slice(sync.indexOf('function _fbTsOnCancel('),sync.indexOf('let _ticketsListenerAtivo',sync.indexOf('function _fbTsOnCancel(')));
  assert.doesNotMatch(restart,/_fbRestaurarAuthEExecutar\(fbIniciarListener/);
  assert.match(restart,/_fbTsRef\.off\('value',_fbTsOnValue\)/);
});

test('writer genérico confirma caminhos de coleções diferentes com um único update',async()=>{
  const a=sync.indexOf('async function _enviarMapaErp(dados){');
  const b=sync.indexOf('\n  async function _enviarDadosEmLotes(',a);
  const updates=[];
  const groups={
    clientes:{temValor:false,patch:{a:{nome:'A'}}},
    fornecedores:{temValor:false,patch:{b:{nome:'B'}}}
  };
  const scope={
    _agruparAtualizacoesErp:()=>groups,
    _comTimeoutFirebase:p=>p,
    window:{_fbDB:{ref:path=>({update:async data=>{updates.push({path,data});}})}}
  };
  runInNewContext(sync.slice(a,b)+';this.fn=_enviarMapaErp;',scope);
  await scope.fn({});
  assert.equal(updates.length,1);
  assert.equal(updates[0].path,'erp');
  assert.deepEqual(Object.keys(updates[0].data).sort(),['clientes/a','fornecedores/b']);
});

test('migração de contas a pagar usa transação no snapshot atual, sem set cego da coleção',async()=>{
  const core=read('public/legacy/app-core.js');
  const a=core.indexOf('let _cpMigracaoEmAndamento=false;');
  const b=core.indexOf('function _cpCarregarDeRemoto(',a);
  assert.ok(a>=0&&b>a);
  let current=[{id:'CP-1',valor:100},{id:'CP-2',valor:200}];
  let called=0;
  const scope={
    window:{_fbDB:{ref:path=>({
      transaction:async transform=>{called++;assert.equal(path,'erp/contasPagar');const next=transform(current);if(next===undefined)return {committed:false};current=next;return {committed:true};}
    })}},
    _cpIdDeterministico:()=> 'unused',console:{info(){},warn(){}}
  };
  runInNewContext(core.slice(a,b)+';this.run=_cpMigrarParaFormatoPorChave;',scope);
  await scope.run();
  assert.equal(called,1);
  assert.deepEqual(Object.keys(current),['CP-1','CP-2']);
  assert.equal(current['CP-2'].valor,200);
  await scope.run();
  assert.equal(called,2);
  assert.deepEqual(Object.keys(current),['CP-1','CP-2']);
});

test('migração recusa identificadores duplicados em vez de apagar uma conta',async()=>{
  const core=read('public/legacy/app-core.js');
  const a=core.indexOf('let _cpMigracaoEmAndamento=false;');
  const b=core.indexOf('function _cpCarregarDeRemoto(',a);
  const original=[{id:'CP-1',valor:100},{id:'CP-1',valor:200}];
  let committed=false;
  const scope={window:{_fbDB:{ref:()=>({transaction:async update=>{committed=update(original)!==undefined;return {committed};}})}},
    _cpIdDeterministico:()=> 'unused', console:{info(){},warn(){}}};
  runInNewContext(core.slice(a,b)+';this.run=_cpMigrarParaFormatoPorChave;',scope);
  await scope.run();
  assert.equal(committed,false);
  assert.equal(original.length,2);
});
