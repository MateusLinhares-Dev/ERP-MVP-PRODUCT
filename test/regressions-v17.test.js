import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync('public/legacy/app-core.js','utf8');
const sync=fs.readFileSync('public/legacy/firebase-sync.js','utf8');
const chat=fs.readFileSync('public/legacy/chat-read-sync.js','utf8');
const boot=fs.readFileSync('public/app/bootstrap.js','utf8');
const seed=fs.readFileSync('scripts/seed-emulator.mjs','utf8');
const rules=JSON.parse(fs.readFileSync('database.rules.json','utf8'));

test('v17 chat unread state is persisted per Firebase uid/conversation in RTDB',()=>{
  assert.ok(chat.includes("erp/chatRead/'+uid+'/'+k"));
  assert.match(chat,/function convKey\(conv\)/);
  assert.match(chat,/function unreadCount\(conv\)/);
  assert.match(chat,/badgeHtml\(unreadCount\('geral'\)\)/);
  assert.match(chat,/badgeHtml\(unreadCount\(conv\)\)/);
  assert.doesNotMatch(chat,/localStorage\.setItem\('mm_chat_lido_/);
  assert.doesNotMatch(core,/localStorage\.setItem\('mm_chat_lido_/);
  assert.match(boot,/\/legacy\/chat-read-sync\.js/);
});

test('v17 chatRead write rules are scoped to the authenticated Firebase uid',()=>{
  assert.match(rules.rules.erp.$node['.write'],/\$node != 'chatRead'/);
  assert.match(rules.rules.erp.chatRead.$uid['.write'],/auth\.uid == \$uid/);
});

test('v17 estoque treats RTDB as source of truth and localStorage only as fallback cache',()=>{
  assert.match(sync,/function _estoqueAplicarDaNuvem\(remoto, confiavel, shallowKeys\)/);
  assert.match(sync,/Object\.keys\(ESTOQUE_DB\)\.forEach\(function\(k\)\{ delete ESTOQUE_DB\[k\]; \}\)/);
  assert.match(sync,/_estoqueAplicarDaNuvem\(d\.estoque, _fbConfiavel, d\._shallowKeys\)/);
  assert.match(core,/const cloudJaHidratou = \(typeof _fbDadosCarregados!=='undefined' && _fbDadosCarregados===true\)/);
  assert.match(core,/if\(!cloudJaHidratou\)\{[\s\S]*localStorage\.getItem\('mm_estoque'\)/);
  assert.match(core,/RTDB é a persistência compartilhada/);
});

test('v17 supplier views deduplicate the same business supplier code',()=>{
  const fn=core.slice(core.indexOf('function getFornAtivos()'),core.indexOf('// FORN_DELETED era salvo'));
  assert.match(fn,/const vistos=new Set\(\)/);
  assert.match(fn,/String\(f\.cod\|\|f\.id\|\|''\)/);
  assert.match(fn,/if\(vistos\.has\(chave\)\) return false/);
});

test('v17 classic road tara is persisted immediately in the same ticket',()=>{
  const start=core.indexOf('function rodFinalizarSaidaSelecionada');
  const end=core.indexOf('// 03/08: mesma correção',start);
  const fn=core.slice(start,end);
  assert.match(fn,/t\.pesoTara=tara/);
  assert.match(fn,/_rodPersistirTicketCritico\(tid\)/);
});

test('v17 client/supplier document uploads go through managed empresaDocs path and keep binary out of entity metadata',()=>{
  const start=core.indexOf('function _entidadeDocsModal');
  const end=core.indexOf('function fornDocsModal',start);
  const fn=core.slice(start,end);
  assert.match(fn,/ref\('erp\/empresaDocs\/'\+id\)\.set\(e\.target\.result\)/);
  assert.match(fn,/mimeType:file\.type\|\|'application\/octet-stream', _nuvem:true/);
  assert.doesNotMatch(fn,/entidade\.docs\.push\(\{[\s\S]{0,400}base64:e\.target\.result/);
  assert.match(core,/function _migrarDocsEntidadesParaNuvem\(cb\)/);
});

test('v17 company document list still comes from Firebase-hydrated EMPRESAS_INFO, not hardcoded options',()=>{
  const start=core.indexOf('function deNovoDoc()');
  const end=core.indexOf('function deSalvarDoc()',start);
  const fn=core.slice(start,end);
  assert.match(fn,/Object\.keys\(EMPRESAS_INFO\)/);
  assert.doesNotMatch(fn,/<option[^>]*>\s*(?:Gratus Metais|Mabor|Manuela Metais)\s*<\/option>/i);
});

test('v17 emulator seed only falls back to a password prefix for local demo project',()=>{
  assert.match(seed,/const isLocalDemo=String\(projectId\)\.startsWith\('demo-'\)/);
  assert.match(seed,/LocalDevOnly_\$\{projectId\}/);
  assert.match(seed,/if\(!isLocalDemo\)[\s\S]*process\.exit\(1\)/);
});
