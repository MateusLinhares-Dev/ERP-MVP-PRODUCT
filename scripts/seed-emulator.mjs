import fs from 'node:fs/promises';
import { hashPassword } from '../server/infrastructure/password-hasher.js';

const projectId=process.env.FIREBASE_PROJECT_ID||'demo-manuela-erp';
const host=process.env.FIREBASE_EMULATOR_HOST||'127.0.0.1';
const port=Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT||9000);
let passwordBase=String(process.env.LOCAL_DEV_PASSWORD_BASE||'').trim();
if(!passwordBase){
  const isLocalDemo=String(projectId).startsWith('demo-') && ['127.0.0.1','localhost'].includes(String(host));
  if(!isLocalDemo){
    console.error('LOCAL_DEV_PASSWORD_BASE não configurado em .env.erp.local.');
    process.exit(1);
  }
  passwordBase=`LocalDevOnly_${projectId}`;
  console.warn('[SEED] LOCAL_DEV_PASSWORD_BASE ausente; usando prefixo temporário SOMENTE no Emulator demo.');
}
const users=JSON.parse(await fs.readFile(new URL('./dev-users.json',import.meta.url),'utf8'));
const materials=JSON.parse(await fs.readFile(new URL('./dev-materials.json',import.meta.url),'utf8'));
const business=JSON.parse(await fs.readFile(new URL('./dev-business-data.json',import.meta.url),'utf8'));
const profiles={}; const secure={}; const localCredentials=[];
for(const [login,u] of Object.entries(users)){
  // O ERP legado identifica o usuário pela senha. No emulador cada login precisa de uma senha única.
  const password=`${passwordBase}:${login}`;
  const profile={name:u.name,role:u.role,descricao:u.descricao||'',tabs:u.tabs||[],tabsCustom:false,admin:Boolean(u.admin),...(u.cpApenasFornecedor?{cpApenasFornecedor:true}:{})};
  profiles[login]=profile;
  secure[login]={passwordHash:await hashPassword(password),profile,active:true,admin:Boolean(u.admin),createdAt:Date.now(),updatedAt:Date.now()};
  localCredentials.push({login,password});
}
const base=`http://${host}:${port}`;
async function put(path,value){
  const r=await fetch(`${base}/${path}.json?ns=${encodeURIComponent(projectId)}`,{
    method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(value)
  });
  if(!r.ok)throw new Error(`${path}: ${r.status} ${await r.text()}`);
}
async function get(path){
  const r=await fetch(`${base}/${path}.json?ns=${encodeURIComponent(projectId)}`);
  if(!r.ok)throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function putIfMissing(path,value){
  const current=await get(path);
  if(current!==null && current!==undefined) return false;
  await put(path,value);
  return true;
}
await put('erp/users',profiles);
await put('erp/usersDeleted',[]);
await put('erpAuth/users',secure);

// Catálogo de desenvolvimento: vem de fixture de migração, não do front-end.
// Produção/homologação devem usar o catálogo real existente em erp/metais/erp/estoque.
const estoque=Object.fromEntries(materials.map((mat)=>[mat,{mat,inicial:0,entradas:0,saidas:0,precoVenda:0,obs:''}]));
await putIfMissing('erp/metais',materials);
await putIfMissing('erp/estoque',estoque);

// Dados de desenvolvimento ficam SOMENTE nas fixtures do seed. O bundle público
// nasce vazio e lê os registros do Realtime Database após autenticação.
await putIfMissing('erp/config',{
  primaryCompanyKey:business.primaryCompanyKey||'',
  branding:business.branding||{},
  documentHeaders:business.documentHeaders||{},
  companies:business.companies||{},
  financeCompanies:business.financeCompanies||[],
  employeeCompanies:business.employeeCompanies||[],
  transferCompanies:business.transferCompanies||[],
  chequeCompanies:business.chequeCompanies||[],
  expenseGroupCompanyMap:business.expenseGroupCompanyMap||{},
  fiscalCompanies:business.fiscalCompanies||{},
  bankDisplayTokens:business.bankDisplayTokens||{},
  dashboardModules:business.dashboardModules||{},
  expenseGroups:business.expenseGroups||[],
  expenseGroupColors:business.expenseGroupColors||{},
  chequeBanks:business.chequeBanks||[],
  defaultChequeBank:business.defaultChequeBank||'',
  thirdPartyChequeBank:business.thirdPartyChequeBank||'',
  legacyRepairs:business.legacyRepairs||{},
  chequeTemplateExamples:business.chequeTemplateExamples||[],
  fiscalData:business.fiscalData||{}
});
await putIfMissing('erp/funcEdit',business.employees||[]);
await putIfMissing('erp/fiscalApur',business.fiscalApurSeed||{});
await putIfMissing('erp/bancos',Object.fromEntries((business.legacyBanks||[]).map((b,i)=>[(b.id||b.cod||`DEV-BANK-${i+1}`),b])));
await putIfMissing('erp/tickets',business.tickets||{});
await putIfMissing('erp/frota',Object.fromEntries((business.fleet||[]).map((v,i)=>[(v.id||`DEV-VE-${i+1}`),v])));
await putIfMissing('erp/chequesControle',Object.fromEntries((business.chequeControle||[]).filter(x=>x&&x.id).map(x=>[x.id,x])));


console.log(`Emulador pronto. Fixtures de negócio são criadas somente quando o nó ainda não existe; dados já gravados no RTDB são preservados.`);
console.table(localCredentials);
console.log('Estas credenciais existem somente no Emulator e são recriadas pelo seed.');
