import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const js=fs.readFileSync(new URL('../public/modules/master-data/master-data-forms.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/modules/master-data/master-data-forms.css',import.meta.url),'utf8');
const bootstrap=fs.readFileSync(new URL('../public/app/bootstrap.js',import.meta.url),'utf8');

const has=(...parts)=>parts.forEach(part=>assert.ok(js.includes(part),`Faltou no master-data: ${part}`));

test('bootstrap carrega cadastro mestre depois da homologação e antes de pedido de compra',()=>{
  assert.match(bootstrap,/master-data\/master-data-forms\.css/);
  assert.match(bootstrap,/master-data\/master-data-forms\.js/);
  assert.ok(bootstrap.indexOf('phase3-homologation.js')<bootstrap.indexOf('master-data-forms.js'));
  assert.ok(bootstrap.indexOf('master-data-forms.js')<bootstrap.indexOf('purchase-order.js'));
});

test('cliente e fornecedor preservam IDs legados e ganham organização cadastral completa',()=>{
  has('Dados cadastrais','Contato','Endereço','Dados bancários / PIX','Financeiro');
  for(const id of ['ef-cod','ec-idx'])assert.ok(js.includes(id),`ID legado ausente: ${id}`);
  has("const prefix=editing?'ef':'nf'","const prefix=editing?'ec':'nc'","prefix+'-nome'","prefix+'-cpf'","prefix+'-cnpj'","prefix+'-cidade'");
  has('phase3OpenPartyBanks','Gerenciar contas bancárias');
});

test('funcionário mantém contratos legados usados por RH e integrações',()=>{
  assert.ok(js.includes('efn-idx'));
  has("const prefix=editing?'efn':'nfu'","prefix+'-nome'","prefix+'-emp","prefix+'-cargo'","prefix+'-sal'","prefix+'-banco'","prefix+'-status'","prefix+'-adm'","prefix+'-fimexp'");
  has('Remuneração e pagamento','Contrato e alertas','salvarNovoFuncionario','salvarEditFuncionario');
});

test('campos complementares são adicionados no mesmo objeto e persistidos',()=>{
  has('supplierExtras','clientExtras','employeeExtras','Object.assign(entity,extras)','persistSuppliers','persistEmployees');
});

test('visual segue identidade clara do ERP com formulário amplo e responsivo',()=>{
  assert.match(css,/width:min\(1480px,96vw\)/);
  assert.match(css,/background:#f5f8f6/);
  assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:650px\)/);
});
