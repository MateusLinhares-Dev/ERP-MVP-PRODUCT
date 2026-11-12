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

test('cliente e fornecedor preservam IDs legados e ganham organização cadastral completa',()=>{
  has('Dados cadastrais','Contato','Endereço','Dados bancários / PIX','Financeiro');
  assert.ok(js.includes('ec-idx'),'ID legado ausente: ec-idx');
  has("const prefix=editing?'ec':'nc'","prefix+'-nome'","prefix+'-cpf'","prefix+'-cnpj'","prefix+'-cidade'");
  assert.doesNotMatch(js,/function supplierForm|salvarNovoFornecedor/);
  has('phase3OpenPartyBanks','Gerenciar contas bancárias');
});

test('funcionário mantém contratos legados usados por RH e integrações',()=>{
  assert.ok(js.includes('efn-idx'));
  has("const prefix=editing?'efn':'nfu'","prefix+'-nome'","prefix+'-emp","prefix+'-cargo'","prefix+'-sal'","prefix+'-banco'","prefix+'-status'","prefix+'-adm'","prefix+'-fimexp'");
  has('Remuneração e pagamento','Contrato e alertas','salvarNovoFuncionario','salvarEditFuncionario');
});

test('campos complementares são adicionados no mesmo objeto e persistidos',()=>{
  has('partyExtras','clientExtras','employeeExtras','Object.assign(entity,extras)','persistEmployees');
});

test('visual segue identidade clara do ERP com formulário amplo e responsivo',()=>{
  assert.match(css,/width:min\(1480px,96vw\)/);
  assert.match(css,/background:#f5f8f6/);
  assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:650px\)/);
});

test('clientes e fornecedores compartilham navegação de histórico e cadastro inline',()=>{
  has('Clientes e fornecedores','Histórico / Cadastros','Novo cadastro');
  has('phase4-master-inline-editor','phase4MasterCreate','phase4MasterShowList','inlinePartyForm');
  assert.match(js,/while\(panel\.firstChild\)listing\.appendChild/);
  assert.match(css,/\.phase4-master-inline-editor/);
});

test('acesso aos cadastros passa pelo guard existente e persiste via salvamento legado',()=>{
  assert.match(js,/global\.erpCanAccessTab\(tab\)/);
  assert.match(js,/global\.switchTab\(tab\)===false/);
  assert.match(js,/legacy\.saveNewClient\.apply/);
  assert.match(fs.readFileSync(new URL('../web/erp/suppliers.tsx',import.meta.url),'utf8'),/erpSupplierRequest/);
  assert.match(js,/global\.phase4MasterShowList\('cliente'\)/);
  assert.match(fs.readFileSync(new URL('../web/erp/suppliers.tsx',import.meta.url),'utf8'),/phase4MasterShowList/);
});

function mountPartyFormTest(fields={}){
  const elements={};
  const saved=[];
  const requests=[];
  const notifications=[];
  let approved=false;
  for(const [id,value] of Object.entries(fields)){
    elements[id]={
      value,
      disabled:false,
      attrs:{},
      setAttribute(key,val){this.attrs[key]=val;},
      closest(){return {classList:{toggle(){}}};},
      focus(){this.focused=true;}
    };
  }
  const ctx={
    console,
    document:{addEventListener(){},getElementById(id){return elements[id]||null;}},
    alert(message){notifications.push(message);},
    confirm(){return approved;},
    CLIENTES:[],FORNECEDORES:[],FUNCIONARIOS:[],
    salvarNovoCliente(){saved.push('cliente');return 'saved';},
    salvarEditCliente(){saved.push('cliente-edit');return 'saved';},
    localStorage:{setItem(){}},
  };
  ctx.window=ctx;
  vm.runInNewContext(js,ctx,{filename:'master-data-forms.js'});
  return {ctx,elements,saved,requests,notifications,approve:()=>{approved=true;}};
}

test('Pessoa Física realmente desabilita CNPJ (e vice-versa), sem apagar dados ao alternar',()=>{
  const {ctx,elements}=mountPartyFormTest({'nc-pessoa':'PF','nc-cpf':'','nc-cnpj':'11.222.333/0001-81'});
  ctx.phase4MasterTogglePerson('nc');
  assert.equal(elements['nc-cpf'].disabled,false);
  assert.equal(elements['nc-cnpj'].disabled,true);
  assert.equal(elements['nc-cnpj'].value,'11.222.333/0001-81');
  assert.equal(elements['nc-cnpj'].attrs['aria-disabled'],'true');
  elements['nc-pessoa'].value='PJ';
  ctx.phase4MasterTogglePerson('nc');
  assert.equal(elements['nc-cpf'].disabled,true);
  assert.equal(elements['nc-cnpj'].disabled,false);
});

test('documento inválido bloqueia salvar; documento opcional e válido mantém o legado',()=>{
  const {ctx,elements,saved,notifications}=mountPartyFormTest({'nc-pessoa':'PF','nc-cpf':'111.111.111-11','nc-cnpj':''});
  assert.equal(ctx.salvarNovoCliente(),false);
  assert.deepEqual(saved,[]);
  assert.match(notifications[0],/CPF inválido/);
  assert.equal(elements['nc-cpf'].focused,true);
  elements['nc-cpf'].value='529.982.247-25';
  assert.equal(ctx.salvarNovoCliente(),'saved');
  assert.deepEqual(saved,['cliente']);
  elements['nc-cpf'].value='';
  assert.equal(ctx.salvarNovoCliente(),'saved');
  assert.deepEqual(saved,['cliente','cliente']);
});

test('documento do tipo anterior exige confirmação para ser apagado e evita persistência indevida',()=>{
  const {ctx,elements,saved,approve}=mountPartyFormTest({'nc-pessoa':'PF','nc-cpf':'529.982.247-25','nc-cnpj':'11.222.333/0001-81'});
  assert.equal(ctx.salvarNovoCliente(),false);
  assert.equal(elements['nc-cnpj'].value,'11.222.333/0001-81');
  assert.deepEqual(saved,[]);
  approve();
  assert.equal(ctx.salvarNovoCliente(),'saved');
  assert.equal(elements['nc-cnpj'].value,'');
  assert.deepEqual(saved,['cliente']);
});
