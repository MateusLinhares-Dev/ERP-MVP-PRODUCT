import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getCompanyDirectory,changeCompanyDirectory,companyDirectoryResponse} from '../server/modules/company/domain/company-directory.js';

const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

function fakeDb(initialConfig){
  const state={config:clone(initialConfig),directory:null};
  const db={ref(path){
    const k=path==='erp/config'?'config':path==='erp/companyDirectory'?'directory':null;
    if(!k)throw new Error('Unexpected Firebase path: '+path);
    return {
      async get(){return {val:()=>clone(state[k])};},
      async transaction(update){
        const change=update(clone(state[k]));
        if(change===undefined)return {committed:false,snapshot:{val:()=>clone(state[k])}};
        state[k]=clone(change);
        return {committed:true,snapshot:{val:()=>clone(state[k])}};
      }
    };
  }};
  return {db,state};
}

test('cadastro isolado não é sobrescrito por gravações posteriores de erp/config',async()=>{
  const env=fakeDb({primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais','Elaine','Mabor'],companyDirectoryRevision:2});
  const initial=await getCompanyDirectory(env.db);
  const removed=changeCompanyDirectory(initial,'delete','Elaine',initial.revision);
  assert.ok(removed);
  await env.db.ref('erp/companyDirectory').transaction(()=>removed);
  env.state.config={primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais','Elaine','Mabor'],companyDirectoryRevision:2};
  const afterReload=await getCompanyDirectory(env.db);
  assert.deepEqual(afterReload.companies,['Manuela Metais','Mabor']);
  assert.ok(afterReload.deletedCompanies.includes('Elaine'));
  assert.equal(afterReload.revision,3);
  assert.equal(companyDirectoryResponse(afterReload).apiVersion,3);
});

test('incluir e excluir preserva empresas existentes e rejeita versão concorrente',async()=>{
  const env=fakeDb({primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais','Gratus','Mabor'],companyDirectoryRevision:6});
  let dir=await getCompanyDirectory(env.db);
  const first=changeCompanyDirectory(dir,'create','Rafael',6);
  assert.ok(first);
  assert.equal(changeCompanyDirectory(first,'delete','Rafael',6),undefined);
  await env.db.ref('erp/companyDirectory').transaction(()=>first);
  dir=await getCompanyDirectory(env.db);
  const second=changeCompanyDirectory(dir,'delete','Rafael',7);
  assert.ok(second);
  await env.db.ref('erp/companyDirectory').transaction(()=>second);
  dir=await getCompanyDirectory(env.db);
  assert.deepEqual(dir.companies,['Manuela Metais','Gratus','Mabor']);
  assert.equal(dir.revision,8);
  const recreated=changeCompanyDirectory(dir,'create','RAFAEL',8);
  assert.ok(recreated);
  assert.deepEqual(recreated.companies,['Manuela Metais','Gratus','Mabor','RAFAEL']);
  assert.ok(!recreated.deletedCompanies.some(v=>v.toLowerCase()==='rafael'));
  assert.equal(changeCompanyDirectory(dir,'delete','Manuela Metais',8),undefined);
});

test('o navegador não tem escrita direta no catálogo separado, mas usuários ERP podem observar',()=>{
  const rules=JSON.parse(readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')).rules.erp;
  assert.equal(rules.companyDirectory['.write'],false);
  assert.match(rules.companyDirectory['.read'],/erpAccess/);
  const sync=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');
  const branding=readFileSync(new URL('../server/modules/company/application/get-public-branding.js',import.meta.url),'utf8');
  assert.match(sync,/ref\('erp\/companyDirectory'\)\.on\('value'/);
  assert.match(sync,/const currentDirectory=window\.__ERP_COMPANY_DIRECTORY_STATE__/);
  assert.match(branding,/getCompanyDirectory\(getFirebaseAdmin\(\)\.db\)/);
});

test('catálogo inicial respeita exclusões antigas e preserva outras fontes de empresa',async()=>{
  const env=fakeDb({primaryCompanyKey:'Manuela Metais',employeeCompanies:['Manuela Metais','Mabor','Elaine'],chequeCompanies:['Rafael','Elaine'],deletedCompanies:['Elaine'],companyDirectoryRevision:11});
  const dir=await getCompanyDirectory(env.db);
  assert.equal(dir.revision,11);
  assert.deepEqual(dir.companies,['Manuela Metais','Mabor','Rafael']);
  assert.deepEqual(dir.deletedCompanies,['Elaine']);
});
