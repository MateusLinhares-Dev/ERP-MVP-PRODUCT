import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');
test('Agenda admite tanto cliente quanto fornecedor e consulta nomes atuais na abertura',()=>{
  const agenda=read('modules/phase1/phase1-agenda.js');
  assert.match(agenda,/ERPEnhanceSearchableSelect/);
  assert.match(agenda,/TIPO DE CADASTRO/);
  assert.doesNotMatch(agenda,/wrap\.style\.display='none'/);
  assert.match(agenda,/erp:catalog-updated/);
  assert.match(agenda,/ENTREGA DE MATERIAL/);
  assert.match(agenda,/<select id="agd-novo-servico">/);
});
test('Fornecedores publicam atualizações entre módulos e sobrevivem a cache local cheio',()=>{
  const app=read('legacy/app-core.js');
  const purchase=read('modules/purchase-order/purchase-order.js');
  assert.match(app,/erp:catalog-updated/);
  assert.match(app,/Cache local cheio; salvamento no Firebase continuará/);
  assert.match(app,/__businessRepository\.upsert\('fornecedores'/);
  assert.match(purchase,/phase4PurchaseRefreshSuppliers/);
});
test('Compra de sucata indica duplicados por nome normalizado, sem alterar itens',()=>{
  const src=read('modules/purchase-order/purchase-order.js');
  assert.match(src,/normalize\('NFD'\)/);
  assert.match(src,/function duplicateMaterials\(items\)/);
  assert.match(src,/updateDuplicateWarnings\(state\)/);
  assert.match(src,/Confira se a repetição é intencional/);
});
test('Artigo de ajuda tem publicação explícita e feedback distinto do rascunho',()=>{
  const src=read('modules/engineering/engineering.js');
  assert.match(src,/eng-help-publish/);
  assert.match(src,/form\.requestSubmit\(\)/);
  assert.match(src,/Artigo publicado!/);
  assert.match(src,/Rascunho salvo/);
});
