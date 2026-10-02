import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(p,'utf8');
const core=read('public/legacy/app-core.js');
const bootstrap=read('public/app/bootstrap.js');
const adapter=read('public/app/legacy-db-adapter.js');
const auditClient=read('public/legacy/audit-trail.js');
const auditServer=read('server/infrastructure/audit-repository.js');
const auth=read('server/application/authenticate-user.js');
const adminUsers=read('api/admin/users.js');
const rules=JSON.parse(read('database.rules.json'));
const vercel=JSON.parse(read('vercel.json'));

function headers(){ return Object.fromEntries(vercel.headers[0].headers.map((h)=>[h.key,h.value])); }

test('v23 Frota: botão Manutenção abre a ficha e ancora o histórico visível',()=>{
  assert.match(core,/onclick="frotaAbrirManutencoes\(&#39;'/);
  assert.match(core,/function frotaAbrirManutencoes\(veiId\)/);
  assert.match(core,/frotaFicha\(veiId\)/);
  assert.match(core,/id="ff-manutencoes"/);
  assert.match(core,/scrollIntoView\(\{behavior:'smooth',block:'start'\}\)/);
});

test('v23 Frota: modal de nova/edição de manutenção fica acima da ficha fullscreen',()=>{
  assert.match(core,/function _frotaModalCompartilhado\(\)/);
  assert.match(core,/ov\.style\.zIndex=document\.getElementById\('ff-ov'\)\?'10020':''/);
  assert.match(core,/const _modalManut=_frotaModalCompartilhado\(\)/);
  assert.match(core,/const _modalEditManut=_frotaModalCompartilhado\(\)/);
  assert.match(core,/if\(_retornarFicha\) setTimeout\(\(\)=>\{ try\{ frotaFicha\(veiId\)/);
  assert.match(core,/if\(_retornarFicha\) setTimeout\(\(\)=>\{ try\{ frotaFicha\(m\.veiId\)/);
});

test('v23 auditoria técnica é carregada antes do legado e não grava payload de negócio',()=>{
  assert.ok(bootstrap.indexOf("/legacy/audit-trail.js") < bootstrap.indexOf("/legacy/firebase-sync.js"));
  assert.match(auditClient,/actorUid/);
  assert.match(auditClient,/actorLogin/);
  assert.match(auditClient,/entityType/);
  assert.match(auditClient,/entityId/);
  const eventBlock=auditClient.match(/var event=\{([\s\S]*?)\n      \};/)?.[1]||'';
  assert.doesNotMatch(eventBlock,/cpf|cnpj|telefone|password|senha|valor|payload/i);
});

test('v23 trilha de auditoria RTDB é append-only por identidade; leitura só admin',()=>{
  const audit=rules.rules.erpAudit;
  assert.match(audit['.read'],/admin == true/);
  assert.match(audit.$eventId['.write'],/!data\.exists\(\)/);
  assert.match(audit.$eventId['.write'],/actorUid/);
  assert.match(audit.$eventId['.write'],/auth\.uid/);
  assert.match(audit.$eventId['.write'],/actorLogin/);
  assert.match(audit.$eventId['.write'],/auth\.token\.erpUser/);
  assert.match(audit.$eventId['.write'],/source.*browser/);
});

test('v23 autenticação e gestão de usuários registram auditoria server-side sem IP bruto',()=>{
  assert.match(auth,/AuditRepository/);
  assert.match(auth,/action: 'login'/);
  assert.match(adminUsers,/AuditRepository/);
  assert.match(adminUsers,/action:'user_'/);
  assert.match(adminUsers,/ip:clientIp\(req\)/);
  assert.match(auditServer,/createHmac/);
  assert.match(auditServer,/ipHash/);
  assert.doesNotMatch(auditServer,/payload\.ip\s*=/);
});

test('v23 documentos gerenciados registram upload/delete e manutenção registra CRUD',()=>{
  assert.match(adapter,/auditManagedFile\('file_upload'/);
  assert.match(adapter,/auditManagedFile\('file_delete'/);
  assert.match(core,/erpAudit\('create','frota'/);
  assert.match(core,/erpAudit\('update','frota'/);
  assert.match(core,/erpAudit\('delete','frota'/);
});

test('v23 headers reduzem vazamento de navegação sem quebrar câmera/serial locais',()=>{
  const h=headers();
  assert.equal(h['Referrer-Policy'],'no-referrer');
  assert.equal(h['X-DNS-Prefetch-Control'],'off');
  assert.match(h['Permissions-Policy'],/camera=\(self\)/);
  assert.match(h['Permissions-Policy'],/usb=\(self\)/);
  assert.match(h['Permissions-Policy'],/serial=\(self\)/);
  assert.match(h['Content-Security-Policy'],/form-action 'self'/);
});
