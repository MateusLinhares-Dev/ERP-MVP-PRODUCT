import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=new URL('../public/modules/',import.meta.url);
const fiscal=readFileSync(new URL('phase1/phase1-fiscal-admin.js',base),'utf8');
const training=readFileSync(new URL('final-ops/final-ops.js',base),'utf8');
const contract=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
test('importadores fiscal XML/ZIP e Conta Azul estão no mesmo painel e estoque é botão direto',()=>{
  assert.match(fiscal,/legacyImport\.firstChild/);
  assert.match(fiscal,/host\.appendChild\(legacyImport\.firstChild\)/);
  assert.match(fiscal,/resumo\.insertAdjacentElement\('afterend',estoque\)/);
  assert.match(fiscal,/old\.hidden=true/);
});
test('certificados exibem funcionário e curso em lista acessível em vez de opções nativas cortadas',()=>{
  assert.match(training,/role="radiogroup"/);
  assert.match(training,/ops-training-enroll-item/);
  assert.match(training,/querySelector\('input\[name="enrollmentId"\]:checked'\)/);
});
test('cache local de contratos omite anexos antigos e não bloqueia o salvamento remoto',()=>{
  assert.match(contract,/delete item\.arquivoBase64/);
  assert.match(contract,/await db\.ref\('erp'\)\.update\(patch\)/);
});
