import { getFirebaseAdmin } from '../infrastructure/firebase-admin.js';
import { FirebaseUserRepository } from '../infrastructure/user-repository.js';
import { hashPassword, verifyPassword } from '../infrastructure/password-hasher.js';
import { normalizeLogin, sanitizeProfile, assertStrongEnoughPassword } from '../domain/user.js';

async function ensureUniquePassword(repo, password, exceptLogin = '') {
  const all = await repo.listSecureUsers();
  for (const [login, record] of Object.entries(all)) {
    if (login === exceptLogin || !record?.passwordHash) continue;
    if (await verifyPassword(password, record.passwordHash)) {
      const error = new Error('Esta senha já está em uso por outro usuário. Escolha outra.'); error.status=409; error.code='DUPLICATE_PASSWORD'; throw error;
    }
  }
}

export async function manageUser(input) {
  const repo = new FirebaseUserRepository();
  const action = input.action;
  const login = normalizeLogin(input.login);
  if (!login) { const e=new Error('Login obrigatório.');e.status=400;throw e; }

  if (action === 'create') {
    if (await repo.exists(login)) { const e=new Error('Login já existe.');e.status=409;throw e; }
    const password=assertStrongEnoughPassword(input.password);
    await ensureUniquePassword(repo,password);
    const profile=sanitizeProfile(input.profile);
    await repo.upsert(login,{ passwordHash:await hashPassword(password), profile, active:true, admin:false, createdAt:Date.now(), updatedAt:Date.now() });
    await repo.removeTombstone(login);
    return { login, profile };
  }

  const current=await repo.getSecureUser(login);
  if(!current){ const e=new Error('Usuário não encontrado.');e.status=404;throw e; }

  if(action==='resetPassword'){
    const password=assertStrongEnoughPassword(input.password); await ensureUniquePassword(repo,password,login);
    await repo.upsert(login,{...current,passwordHash:await hashPassword(password),updatedAt:Date.now()});
    return {login,profile:current.profile};
  }

  if(action==='update'){
    const newLogin=normalizeLogin(input.newLogin||login);
    if(current.admin===true && newLogin!==login){ const e=new Error('O login da administradora não pode ser alterado.');e.status=400;throw e; }
    if(newLogin!==login && await repo.exists(newLogin)){ const e=new Error('O novo login já existe.');e.status=409;throw e; }
    let passwordHash=current.passwordHash;
    if(input.password){ const password=assertStrongEnoughPassword(input.password); await ensureUniquePassword(repo,password,login); passwordHash=await hashPassword(password); }
    const profile=sanitizeProfile(input.profile||current.profile);
    await repo.upsert(newLogin,{...current,passwordHash,profile,updatedAt:Date.now()});
    await repo.removeTombstone(newLogin);
    if(newLogin!==login){ await repo.delete(login); try{await getFirebaseAdmin().auth.deleteUser(`erp:${login}`);}catch(_){} }
    return {login:newLogin,profile};
  }

  if(action==='delete'){
    if(current.admin===true){ const e=new Error('A administradora principal não pode ser excluída.');e.status=400;throw e; }
    await repo.delete(login); try{await getFirebaseAdmin().auth.deleteUser(`erp:${login}`);}catch(_){}
    return {login,deleted:true};
  }

  const error=new Error('Ação inválida.');error.status=400;throw error;
}
