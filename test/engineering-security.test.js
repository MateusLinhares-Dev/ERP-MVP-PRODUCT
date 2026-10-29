import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSecurityClaims } from '../server/domain/access.js';
import { normalizeLogin, sanitizeProfile } from '../server/domain/user.js';
import { validateArticle, validateArticleId, assertRevision } from '../server/domain/help-article.js';
const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('perfil administrador herda permissões operacionais e matrícula',()=>{
 const claims=buildSecurityClaims({tabs:['senhas','suporte_tecnico','matriz_capacitacao']},{admin:true});
 for(const flag of ['canFiscalRead','canFiscalWrite','canOwnerBills','canHR','canFleet','canInventory','canContracts','canPasswords','canSupport','canPurchasing'])assert.equal(claims[flag],true,flag);
});
test('conta engAdministrator é login reservado, sem escalonamento por form comum',()=>{
 assert.equal(normalizeLogin('engAdministrator'),'engadministrator');
 assert.equal(sanitizeProfile({name:'x',role:'y',admin:true,engineer:true}).engineer,undefined);
 const manage=load('server/application/manage-user.js');
 assert.match(manage,/ENGINEER_RESERVED/);
 assert.match(manage,/normalizeLogin\(input\?\.newLogin\)/);
 const auth=load('server/application/authenticate-user.js');
 assert.match(auth,/selected\.record\.engineer === true/);
 assert.match(auth,/selected\.login === 'engadministrator'/);
 const identity=load('server/http/auth.js');
 assert.match(identity,/ENGINEER_REQUIRED/);
 assert.match(identity,/ENGINEER_REVOKED/);
});
test('artigos possuem validações, bloqueio de XSS na interface e controle de versão',()=>{
 const a=validateArticle({title:'Como conferir a NF-e',summary:'Confira origem e destino antes de registrar.',category:'fiscal',steps:['Verifique o CNPJ','Revise a nota'],status:'published'});
 assert.equal(a.status,'published');
 assert.equal(a.steps.length,2);
 assert.throws(()=>validateArticle({title:'x',summary:'y',category:'fiscal',steps:[],status:'published'}));
 assert.throws(()=>validateArticle({title:'x',summary:'y',category:'outro',steps:['Um']}));
 assert.throws(()=>validateArticle({title:'x',summary:'y',category:'fiscal',steps:['Um'],warning:'\0'}));
 assert.throws(()=>validateArticle({title:'x',summary:'y',category:'fiscal',steps:Array(21).fill('Etapa')}));
 assert.throws(()=>validateArticle({title:'x',summary:'y',category:'fiscal',steps:['Etapa'],status:'published',warning:'a'.repeat(501)}));
 assert.doesNotThrow(()=>validateArticleId('h_'+'a'.repeat(32)));
 assert.throws(()=>validateArticleId('../../../etc'));
 assert.throws(()=>assertRevision({revision:2},1),{code:'REVISION_CONFLICT'});
 assert.match(load('public/modules/help-center/help-center.js'),/const esc=/);
});
test('regras da base de ajuda são server-only e auditoria lê apenas com claim engenharia',()=>{
 const rules=JSON.parse(load('database.rules.json')).rules;
 for(const node of ['erpHelp','erpTelemetryRate']){
  assert.equal(rules[node]['.read'],false);assert.equal(rules[node]['.write'],false);
 }
 assert.match(rules.erpAudit['.read'],/auth.token.engineer == true/);
 assert.match(rules.erpAudit['.read'],/engadministrator/);
 assert.match(load('storage.rules'),/request.auth.token.engineer == true/);
 assert.match(load('api/engineering/logs.js'),/requireIdentity\(req,\{engineer:true\}\)/);
 assert.match(load('api/help/articles.js'),/await requireIdentity\(req,\{engineer:true\}\)/);
});
test('telemetria jamais transmite dados sensíveis brutos e possui limite no servidor',()=>{
 const s=load('api/engineering/telemetry.js');
 assert.match(s,/maxBytes:4096/);
 assert.match(s,/Number\(v.count\)>=12/);
 assert.match(s,/createHash\('sha256'\)/);
 assert.doesNotMatch(s, /input\.stack|input\.message/);
 const front=load('public/modules/engineering/engineering.js');
 assert.match(front,/unhandledrejection/);
 assert.match(front,/js_error/);
 assert.doesNotMatch(front, /stack:/);
});
