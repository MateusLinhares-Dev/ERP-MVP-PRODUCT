import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
function read(p){return fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');}
const core=read('public/legacy/app-core.js');
const html=read('public/index.template.html');
const rules=JSON.parse(read('database.rules.json'));

test('v27 Ficha distinguishes historical orphans and preserves ledger without silently reassigning cheques',()=>{
  assert.match(core,/function _fcClientesAtivos/);
  assert.match(core,/function _fcClientesHistoricosSemCadastro/);
  assert.match(core,/⚠️ Histórico: /);
  assert.match(core,/Object\.values\(CHQ_CTRL\|\|\{\}\)/);
});
test('v27 bank create requires confirmed Firebase upsert and avoids immediate stale re-read',()=>{
  const start=core.indexOf('async function salvarBanco(){');
  const end=core.indexOf('function editBanco(',start);
  const save=core.slice(start,end);
  assert.match(save,/await window\.__businessRepository\.upsert\('bancos',novo\.id,novo\)/);
  assert.doesNotMatch(save,/setTimeout\(recarregarBancosDoBanco/);
});
test('v27 fiscal lists depend on supplier/customer master, not issuer/group companies',()=>{
  const src=core.slice(core.indexOf('function _nomesFiscais(tipo){'),core.indexOf('function _garantirDatalist',core.indexOf('function _nomesFiscais(tipo){')));
  assert.match(src,/FORNECEDORES_DESPESA/);
  assert.match(src,/CLIENTES/);
  assert.doesNotMatch(src,/EMPRESAS_INFO|\bEMPRESAS\b/);
  assert.match(core,/pessoaTipo:document\.getElementById\('fe-pessoa-tipo'\)/);
});
test('v27 only Elaine may change primary company via admin endpoint',()=>{
  const b=read('api/admin/branding.js');
  assert.match(b,/requireIdentity\(req,\{admin:true\}\)/);
  assert.match(b,/session\.erpUser!=='elaine'/);
  assert.match(b,/db\.ref\('erp\/config'\)\.update/);
  assert.match(core,/async function salvarEdicaoDadosEmpresa/);
  assert.match(html,/Editar dados/);
});
test('v27 restored snapshots originate from RTDB server and generate durable out-of-tree audit',()=>{
  const svc=read('server/application/snapshot-service.js');
  const api=read('api/admin/snapshots.js');
  const hist=read('api/admin/restore-history.js');
  assert.match(svc,/db\.ref\('erp'\)\.get\(\)/);
  assert.match(svc,/await db\.ref\(\)\.update\(patch\)/);
  assert.match(svc,/db\.ref\('erpAudit'\)\.push/);
  assert.match(api,/session\.erpUser!=='elaine'/);
  assert.match(hist,/manual-database-backup-imported/);
  assert.match(core,/_carregarHistoricoRestauracoes\('hist-backups-audit'\)/);
  assert.match(core,/_carregarHistoricoRestauracoes\('snapshots-backups-audit'\)/);
});
test('v27 snapshot mutation rule is restricted to Elaine admin',()=>{
  const policy=rules.rules.erp_snapshots['.write'];
  assert.match(policy,/admin == true/);
  assert.match(policy,/erpUser == 'elaine'/);
});
test('v27 manual export/import explicitly RTDB-only, owner-only, backed up BEFORE destructive import',()=>{
  const api=read('api/admin/data-backup.js');
  assert.match(api,/requireIdentity\(req,\{admin:true\}\)/);
  assert.match(api,/identity\.erpUser!=='elaine'/);
  assert.match(api,/Firebase Storage nem credenciais/);
  assert.match(api,/db\.ref\('erpManualBackups\/+'\+emergency\)\.set/);
  assert.match(api,/await db\.ref\('erp'\)\.set\(restored\)/);
  assert.match(core,/NÃO inclui arquivos Storage nem autenticação/);
  assert.match(html,/Exportar dados RTDB/);
  assert.match(html,/Importar dados RTDB/);
});
test('v27 destructive support tools are disabled (not merely hidden), and old remote JS patch remains inactive',()=>{
  assert.match(html,/Ferramentas de Reparo — desativadas por segurança/);
  for(const name of ['supRecarregarTudo','supReconstruirEstoque','supCorrigirStatusTickets','supLimparOrfaos','supForcarSalvarTudo','supRenderizarModulos','recuperarRHparaNuvem','reconstruirRHdaNuvem']){
    const idx=core.indexOf('function '+name+'(){');
    assert.ok(idx>=0,`missing ${name}`);
    assert.match(core.slice(idx,idx+290),/desativada por segurança/);
  }
  assert.doesNotMatch(core,/new Function\(/);
});
