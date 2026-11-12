import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const start = core.indexOf('function renderContasReceber(){');
const render = core.slice(start, core.indexOf('\nfunction ', start + 10));

test('Contas a Receber ordena e marca atraso pela data (dd/mm/aaaa vira aaaa-mm-dd), sem quebrar sem vencimento', () => {
  assert.match(render, /sort\(\(a,b\)=>_toISOcr\(a\.venc\)\.localeCompare\(_toISOcr\(b\.venc\)\)\)/);
  assert.match(render, /const atrasado=c\.status==='Pendente'&&Boolean\(_vencISO\)&&_vencISO<hoje;/);
  assert.doesNotMatch(render, /a\.venc\.localeCompare|c\.venc<hoje/);
});

test('recebimento com banco guarda o lançamento do banco; excluir ou reabrir venda desfaz esse lançamento', () => {
  assert.match(core, /const mov=registrarMovBanco\(banco, data, 'Recebto: '[\s\S]{0,140}c\.movBancoId=mov\.id/);
  const reopen = core.slice(core.indexOf('function reabrirVenda(idx){'), core.indexOf("window['reabrirVenda']=reabrirVenda;"));
  assert.match(reopen, /_vendaDesfazerMovBanco\(cr\)/);
  const remove = core.slice(core.indexOf('function excluirVenda(btnOrIdx){'), core.indexOf("window['excluirVenda']=excluirVenda;"));
  assert.match(remove, /if\(_vendaDesfazerMovBanco\(cr\)\) desfeitosBanco\+\+;/);
});
