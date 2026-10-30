import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const sync=readFileSync(new URL('../public/legacy/firebase-sync.js',import.meta.url),'utf8');

test('inicialização de funcionários usa o mesmo filtro de ativos e inativos das abas',()=>{
  const initial=core.slice(core.indexOf('function populateAll(){'),core.indexOf('function ',core.indexOf('function populateAll(){')+10));
  assert.match(initial,/renderTbFuncionarios\(\)/);
  assert.doesNotMatch(initial,/tbF\.innerHTML=FUNCIONARIOS\.map/);
  assert.match(core,/const ativos\s*= FUNCIONARIOS\.filter\(x=>x\.status!==\x27Inativo\x27\)/);
  assert.match(core,/const inativos = FUNCIONARIOS\.filter\(x=>x\.status===\x27Inativo\x27\)/);
});

test('sincronização de RH atualiza tabelas após receber alterações da nuvem',()=>{
  assert.equal((sync.match(/renderTbFuncionarios\(\)/g)||[]).length,2);
});
