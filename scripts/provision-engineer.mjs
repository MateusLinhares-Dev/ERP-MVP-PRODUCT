/** Provisionamento restrito: execute localmente com FIREBASE_* e ENGINEER_BOOTSTRAP_PASSWORD. Nunca inclua senha em código/CLI. */
// Não carregue .env.erp.local: poderia sobrescrever o projeto HML explicitamente selecionado.
import { getFirebaseAdmin } from '../server/infrastructure/firebase-admin.js';
import { FirebaseUserRepository } from '../server/infrastructure/user-repository.js';
import { hashPassword,verifyPassword } from '../server/infrastructure/password-hasher.js';
import { sanitizeProfile } from '../server/domain/user.js';
import { AuditRepository } from '../server/infrastructure/audit-repository.js';
import { runtimeEnvironment } from '../server/config/runtime-security.js';

const password = String(process.env.ENGINEER_BOOTSTRAP_PASSWORD || '');
const project = String(process.env.FIREBASE_PROJECT_ID || '');
const approval = String(process.env.CONFIRM_ENGINEER_PROJECT || '');
if (approval !== project || !project || password.length < 16 || password.length > 128) {
  throw new Error('Configure CONFIRM_ENGINEER_PROJECT igual ao FIREBASE_PROJECT_ID e ENGINEER_BOOTSTRAP_PASSWORD com 16 a 128 caracteres.');
}
if (/^(password|123456|admin|teste|engineer)/i.test(password)) throw new Error('Senha previsível: escolha outra credencial.');
if (runtimeEnvironment() !== 'local' && !process.env.FIREBASE_SERVICE_ACCOUNT_B64) throw new Error('Credenciais de serviço não disponíveis.');
const tabs = [
  'dashboard','avisos','agenda_entregas','rod_balanca','balanceiro','compra_sucata','canhoto_compra','estoque','fornecedores','precos_fornecedores',
  'vendas','clientes','precos_clientes','contas_pagar','contas_receber','adiantamentos','cheques','cheques_compensar','fin_clientes','contas_banco','fluxo_caixa',
  'funcionarios','ponto','folha_pagamento','vales','epi','caminhoes','frota','combustivel_rudnick','viagem_motorista','fiscal','despesas_grupo','contratos',
  'custo_casa','lista_compras','documentos_empresas','usuarios','config','senhas','almoxarifado','coordenacao','chat','afazeres','help_center','matriz_capacitacao',
  'engineering_logs','engineering_help','suporte_tecnico'
];
const repo = new FirebaseUserRepository();
const login = 'engadministrator';
const now=Date.now();
const old = await repo.getSecureUser(login);
for(const [otherLogin,record] of Object.entries(await repo.listSecureUsers())){
  if(otherLogin!==login && record?.passwordHash && await verifyPassword(password,record.passwordHash))throw new Error('Senha já utilizada por outro usuário.');
}
const profile={...sanitizeProfile({name:'Engenharia de Software',role:'Engenheiro / Administrador técnico',descricao:'Administração técnica, auditoria e documentação',tabs,tabsCustom:true,admin:true}),engineer:true};
await repo.upsert(login,{passwordHash:await hashPassword(password),profile,active:true,admin:true,engineer:true,createdAt:old?.createdAt||now,updatedAt:now});
await repo.removeTombstone(login);
if(old){try{await getFirebaseAdmin().auth.revokeRefreshTokens('erp:'+login);}catch(e){console.warn('Não foi possível revogar sessões antigas:',e.message);}}
await new AuditRepository().record({actorUid:'system:provision',actorLogin:'provision-engineer',action:old?'engineer_rotated':'engineer_created',module:'security',entityType:'account',entityId:login});
console.log('Perfil reservado engAdministrator provisionado com sucesso no projeto '+project+'. Senha não exibida.');
