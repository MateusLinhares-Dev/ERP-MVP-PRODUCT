import test from 'node:test';
import assert from 'node:assert/strict';
import {changeCompanyDirectory,transactCompanyDirectory} from '../server/modules/company/domain/company-directory.js';

const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const initial=()=>({schemaVersion:3,revision:11,primaryCompanyKey:'Manuela Metais',companies:['Manuela Metais','Mabor','Gratus'],deletedCompanies:[]});

function firebase(initialData,{beforeServerRead,afterServerRead}={}){
  let persisted=clone(initialData);
  let calls=[];
  return {
    get state(){return clone(persisted);},
    get calls(){return calls;},
    db:{ref(path){
      assert.equal(path,'erp/companyDirectory');
      return {
        async get(){
          calls.push('read');
          beforeServerRead?.();
          const result=clone(persisted);
          afterServerRead?.(v=>{persisted=clone(v)});
          return {val:()=>result};
        },
        async transaction(fn){
          calls.push('transaction');
          const first=fn(null);
          if(first===undefined)return {committed:false,snapshot:{val:()=>clone(persisted)}};
          calls.push('cold-null-handled');
          const second=fn(clone(persisted));
          if(second===undefined)return {committed:false,snapshot:{val:()=>clone(persisted)}};
          persisted=clone(second);
          return {committed:true,snapshot:{val:()=>clone(persisted)}};
        }
      };
    }}
  };
}

test('transação no Firebase com cache inicial vazio conclui cadastro existente, sem perder outras empresas',async()=>{
  const env=firebase(initial());
  const saved=await transactCompanyDirectory(env.db,env.db.ref('erp/companyDirectory'),'create','RAFAEL',11);
  assert.equal(saved.committed,true);
  assert.deepEqual(env.state.companies,['Manuela Metais','Mabor','Gratus','RAFAEL']);
  assert.equal(env.state.revision,12);
  assert.deepEqual(env.calls,['read','transaction','cold-null-handled']);
  const deleted=await transactCompanyDirectory(env.db,env.db.ref('erp/companyDirectory'),'delete','RAFAEL',12);
  assert.equal(deleted.committed,true);
  assert.deepEqual(env.state.companies,['Manuela Metais','Mabor','Gratus']);
  assert.deepEqual(env.state.deletedCompanies,['RAFAEL']);
  assert.equal(env.state.revision,13);
});

test('transação retorna conflito verdadeiro se uma outra sessão atualiza a revisão após leitura',async()=>{
  let invoked=false;
  const env=firebase(initial(),{afterServerRead:set=>{
    if(!invoked){invoked=true;set(changeCompanyDirectory(env.state,'create','ELAINE',11));}
  }});
  const result=await transactCompanyDirectory(env.db,env.db.ref('erp/companyDirectory'),'create','RAFAEL',11);
  assert.equal(result.committed,false);
  assert.deepEqual(env.state.companies,['Manuela Metais','Mabor','Gratus','ELAINE']);
  assert.equal(env.state.revision,12);
});

test('cadastro excluído pode ser recriado após transação iniciar com null',async()=>{
  const state=initial();
  state.deletedCompanies=['RAFAEL'];
  const env=firebase(state);
  const result=await transactCompanyDirectory(env.db,env.db.ref('erp/companyDirectory'),'create','RAFAEL',11);
  assert.equal(result.committed,true);
  assert.deepEqual(env.state.deletedCompanies,[]);
  assert.ok(env.state.companies.includes('RAFAEL'));
});
