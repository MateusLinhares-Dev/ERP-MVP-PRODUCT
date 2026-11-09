import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getCompanyDirectory,changeCompanyDirectory,companyDirectoryResponse,isValidCompanyDirectory} from '../server/modules/company/domain/company-directory.js';

const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));

function firebaseShape(value){
  if(Array.isArray(value))return value.length?value.map(firebaseShape):undefined;
  if(value&&typeof value==='object'){
    const result=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,firebaseShape(item)]).filter(([,item])=>item!==undefined));
    return Object.keys(result).length?result:undefined;
  }
  return value;
}

function dbWithSerialization(config,directory){
  const data={config:copy(config),directory:firebaseShape(directory)};
  const keyFor=path=>{
    if(path==='erp/companyDirectory')return 'directory';
    if(path==='erp/config')return 'config';
    throw new Error('Unknown path '+path);
  };
  return {data,db:{ref(path){
    const key=keyFor(path);
    return {
      get:async()=>({val:()=>copy(data[key])??null}),
      transaction:async callback=>{
        const updated=callback(copy(data[key])??null);
        if(updated===undefined)return {committed:false,snapshot:{val:()=>copy(data[key])??null}};
        data[key]=firebaseShape(updated);
        return {committed:true,snapshot:{val:()=>copy(data[key])??null}};
      }
    };
  }}};
}

test('cadastro recém-migrado aceita coleções vazias omitidas pelo RTDB',async()=>{
  const {db,data}=dbWithSerialization({primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais','Mabor']},null);
  const state=await getCompanyDirectory(db);
  assert.equal(state.schemaVersion,3);
  assert.deepEqual(state.inactiveCompanies,[]);
  assert.deepEqual(state.deletedCompanies,[]);
  assert.equal(data.directory.deletedCompanies,undefined);
  assert.equal(data.directory.inactiveCompanies,undefined);
  assert.equal(companyDirectoryResponse(state).apiVersion,3);
  const reload=await getCompanyDirectory(db);
  assert.deepEqual(reload.companies,['Manuela Metais','Mabor']);
});

test('cadastro existente sem listas vazias ainda permite inclusão e exclusão com confirmação',async()=>{
  const seed={schemaVersion:3,revision:4,primaryCompanyKey:'Manuela Metais',companies:['Manuela Metais','Mabor']};
  const {db,data}=dbWithSerialization({},seed);
  const before=await getCompanyDirectory(db);
  assert.ok(isValidCompanyDirectory(data.directory));
  const inserted=changeCompanyDirectory(data.directory,'create','RAFAEL',before.revision);
  assert.ok(inserted);
  await db.ref('erp/companyDirectory').transaction(()=>inserted);
  const updated=await getCompanyDirectory(db);
  assert.deepEqual(updated.companies,['Manuela Metais','Mabor','RAFAEL']);
  const removed=changeCompanyDirectory(data.directory,'delete','RAFAEL',updated.revision);
  assert.ok(removed);
  await db.ref('erp/companyDirectory').transaction(()=>removed);
  const after=await getCompanyDirectory(db);
  assert.deepEqual(after.companies,['Manuela Metais','Mabor']);
  assert.deepEqual(after.deletedCompanies,['RAFAEL']);
});

test('endpoint de configuração visual não depende de sucesso do cadastro de empresas',()=>{
  const source=readFileSync(new URL('../server/modules/company/application/get-public-branding.ts',import.meta.url),'utf8');
  assert.match(source,/try\s*\{\s*return await getCompanyDirectory/);
  assert.match(source,/catch\s*\(error\)\s*\{/);
  assert.match(source,/return \{ revision: 0, companies: \[\], inactiveCompanies: \[\], deletedCompanies: \[\] \}/);
});
