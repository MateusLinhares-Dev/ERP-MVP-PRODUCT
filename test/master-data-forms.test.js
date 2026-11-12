import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

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

test('clientes e fornecedores saíram da casca antiga: formulário e lista são React',()=>{
  assert.doesNotMatch(js,/function clientForm|function supplierForm|salvarNovoCliente|salvarNovoFornecedor|preparePersonDocument|inlinePartyForm/);
  const customers=fs.readFileSync(new URL('../web/erp/customers.tsx',import.meta.url),'utf8');
  assert.match(customers,/renderClientes: renderList/);
  assert.match(customers,/type === 'cliente' \? openForm\(''\)/);
  assert.match(customers,/phase4-master-editor-/);
});

test('funcionário mantém contratos legados usados por RH e integrações',()=>{
  assert.ok(js.includes('efn-idx'));
  has("const prefix=editing?'efn':'nfu'","prefix+'-nome'","prefix+'-emp","prefix+'-cargo'","prefix+'-sal'","prefix+'-status'","prefix+'-adm'","prefix+'-fimexp'");
  has('Remuneração e pagamento','Contrato e alertas','salvarNovoFuncionario','salvarEditFuncionario');
});

test('campos complementares do funcionário são adicionados no mesmo objeto e persistidos',()=>{
  has('employeeExtras','Object.assign(entity,extras)','persistEmployees');
});

test('visual segue identidade clara do ERP com formulário amplo e responsivo',()=>{
  assert.match(css,/width:min\(1480px,96vw\)/);
  assert.match(css,/background:#f5f8f6/);
  assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:650px\)/);
});

test('clientes e fornecedores compartilham navegação de histórico e cadastro inline',()=>{
  has('Clientes e fornecedores','Histórico / Cadastros','Novo cadastro');
  has('phase4-master-inline-editor','phase4MasterCreate','phase4MasterShowList');
  assert.match(js,/while\(panel\.firstChild\)listing\.appendChild/);
  assert.match(css,/\.phase4-master-inline-editor/);
});
