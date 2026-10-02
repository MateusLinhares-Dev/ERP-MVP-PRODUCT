import fs from 'node:fs/promises';
import vm from 'node:vm';
import { getFirebaseAdmin } from '../server/infrastructure/firebase-admin.js';
import { hashPassword } from '../server/infrastructure/password-hasher.js';
import { sanitizeProfile } from '../server/domain/user.js';

const legacyPath=process.argv[2];
if(!legacyPath){console.error('Uso: npm run migrate:auth -- /caminho/index-legado.html');process.exit(1);}
const source=await fs.readFile(legacyPath,'utf8');
function extractUsersObject(text){
  const marker='const USERS ='; const start=text.indexOf(marker); if(start<0)throw new Error('const USERS não encontrado');
  const brace=text.indexOf('{',start); let depth=0,quote='',esc=false;
  for(let i=brace;i<text.length;i++){const ch=text[i];if(quote){if(esc)esc=false;else if(ch==='\\')esc=true;else if(ch===quote)quote='';continue;}if(ch==='"'||ch==="'") {quote=ch;continue;}if(ch==='{')depth++;else if(ch==='}'&&--depth===0)return text.slice(brace,i+1);}throw new Error('USERS inválido');
}
const staticUsers=vm.runInNewContext('('+extractUsersObject(source)+')',Object.create(null),{timeout:1000});
const {db}=getFirebaseAdmin();
const live=(await db.ref('erp/users').get()).val()||{};
const deletedRaw=(await db.ref('erp/usersDeleted').get()).val()||[];
const deleted=new Set(Array.isArray(deletedRaw)?deletedRaw.filter(Boolean):[]);
const merged={...staticUsers,...live};
const secure={}; const profiles={}; const plaintextSeen=new Map();
for(const [login,user] of Object.entries(merged)){
  if(deleted.has(login)){ console.log(`Ignorando ${login}: marcado como excluído em erp/usersDeleted.`); continue; }
  const password=String(user.password||staticUsers[login]?.password||'').trim();
  if(!password){console.warn(`Ignorando ${login}: sem senha encontrada.`);continue;}
  if(plaintextSeen.has(password)){
    throw new Error(`Migração interrompida: ${login} e ${plaintextSeen.get(password)} usam a mesma senha. O login legado é por senha; redefina uma delas antes de continuar.`);
  }
  plaintextSeen.set(password,login);
  const profile=sanitizeProfile({...staticUsers[login],...user});
  profiles[login]=profile;
  secure[login]={passwordHash:await hashPassword(password),profile,active:true,admin:login==='elaine',createdAt:Date.now(),updatedAt:Date.now()};
}
await db.ref('erpAuth/users').set(secure);
await db.ref('erp/users').set(profiles);
console.log(`Migração concluída: ${Object.keys(secure).length} credenciais convertidas para scrypt e removidas de erp/users.`);
console.log('IMPORTANTE: como as senhas antigas estavam expostas no HTML, redefina todas depois da migração.');
