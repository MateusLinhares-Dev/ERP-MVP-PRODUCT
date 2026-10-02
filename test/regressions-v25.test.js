import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(p)=>fs.readFileSync(p,'utf8');
const core=read('public/legacy/app-core.js');
const tpl=read('public/index.template.html');

test('v25 edição de combustível possui modal real no app e IDs exclusivos',()=>{
  assert.match(tpl,/id="modal-edit-comb"/);
  for(const id of ['id','data','caminhao','motorista','posto','km','km-ant','litros','preco','tipo','fonte','obs','resumo']){
    assert.match(tpl,new RegExp(`id="comb-edit-${id}"`));
  }
  assert.match(tpl,/id="comb-edit-caminhao"[^>]*<option|id="comb-edit-caminhao"/);
  assert.match(core,/document\.getElementById\('comb-edit-'\+name\)/);
  assert.doesNotMatch(core,/<!-- MODAL EDITAR COMBUSTIVEL -->/);
});

test('v25 edição de combustível não reutiliza IDs do modal de cheque',()=>{
  const edit=core.match(/function editCombustivel\(id\)\{[\s\S]*?\n      \}/)?.[0]||'';
  assert.match(edit,/comb-edit-/);
  assert.doesNotMatch(edit,/getElementById\('ec-/);
});

test('v25 estoque de bags nunca deriva saldo negativo e ignora dívida histórica inválida',()=>{
  assert.match(core,/function _bagsMovCronologicos\(\)/);
  assert.match(core,/saida_novo'\) novos=Math\.max\(0,novos-qtd\)/);
  assert.match(core,/saida_usado'\) usados=Math\.max\(0,usados-qtd\)/);
  assert.match(core,/const efetiva=Math\.min\(qtd,usados\)/);
});

test('v25 bloqueia saída/lavagem de bags acima do saldo disponível',()=>{
  const save=core.match(/function bagsSalvarMov\(\)\{[\s\S]*?\n\}/)?.[0]||'';
  assert.match(save,/tipo==='saida_novo' && qtd>novos/);
  assert.match(save,/tipo==='saida_usado' && qtd>usados/);
  assert.match(save,/tipo==='lavagem' && qtd>usados/);
  assert.match(save,/Saída bloqueada/);
});

test('v25 devolução de bags ao fornecedor não permite saldo global ou por fornecedor negativo',()=>{
  const fn=core.match(/function bagsDevolverForn\(\)\{[\s\S]*?\n\}/)?.[0]||'';
  assert.match(fn,/if\(qtd>saldo\)/);
  assert.match(fn,/qtd>Number\(BAGS_DB\.novos\|\|0\)/);
  assert.doesNotMatch(fn,/confirm\('A conta de/);
});

test('v25 assinatura de reunião preserva id antes de fechar modal',()=>{
  const fn=core.match(/function coordSigSalvar\(\)\{[\s\S]*?\n\}/)?.[0]||'';
  assert.match(fn,/const reuId=_coordSigReuId/);
  assert.match(fn,/coordSigFechar\(\);\s*reuAssinarModal\(reuId\)/);
  assert.doesNotMatch(fn,/coordSigFechar\(\);\s*reuAssinarModal\(_coordSigReuId\)/);
});
