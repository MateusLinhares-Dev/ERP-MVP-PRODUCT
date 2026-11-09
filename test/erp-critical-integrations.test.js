import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const agendaSrc = read('public/modules/phase1/phase1-agenda.js');
const supplierSrc = read('public/legacy/supplier-compat.js');
const bankSrc = read('public/modules/phase3/phase3-homologation.js');
const matrixSrc = read('public/modules/final-ops/final-ops.js');
const apiSrc = read('server/modules/training/application/training-matrix.ts');
const endpointSrc = read('api/training/matrix.ts');

function agendaFixture(remote={}) {
  const begin=agendaSrc.indexOf('const agendaRemoteParties=');
  const end=agendaSrc.indexOf('function esc(v)',begin);
  assert.ok(begin>=0&&end>begin,'Agenda utiliza o código de atualização real');
  const refresh=[];
  const select={value:'',options:[],replaceChildren(){this.options=[];},append(item){this.options.push(item);}};
  const type={value:'Cliente'},status={textContent:''};
  const document={getElementById(id){return id==='agd-novo-nome'?select:id==='agd-novo-tipo'?type:id==='phase1-agenda-party-status'?status:null;},createElement(){return {value:'',textContent:''};}};
  const context={document,console,CLIENTES:[{nome:'Cliente cadastrado localmente',status:'Ativo'}],FORNECEDORES:[],
    global:{ERPRefreshSearchableSelect(id){refresh.push(id);},__businessRepository:{async read(k){return remote[k]||{};}}}};
  vm.createContext(context);
  vm.runInContext(agendaSrc.slice(begin,end) + '\nglobal.__testAgenda={refresh:agendaRefreshParties,render:agendaRenderPartyOptions};',context);
  return {select,type,status,refresh,api:context.global.__testAgenda};
}

test('Agenda: mostra clientes recém-salvos no Firebase sem F5 e mantém a seleção',async()=>{
  const fixture=agendaFixture({clientes:{'cli-1':{nome:'DANIELA EXEMPLO',status:'Ativo'},'cli-2':{nome:'DANIELA INATIVA',status:'Inativo'}}});
  await fixture.api.refresh('Cliente');
  assert.ok(fixture.select.options.some(x=>x.value==='DANIELA EXEMPLO'));
  assert.ok(fixture.select.options.some(x=>x.value==='Cliente cadastrado localmente'));
  assert.equal(fixture.select.options.some(x=>x.value==='DANIELA INATIVA'),false);
  fixture.select.value='DANIELA EXEMPLO';
  await fixture.api.refresh('Cliente');
  assert.equal(fixture.select.value,'DANIELA EXEMPLO');
  assert.ok(fixture.refresh.length>0);
});

test('Agenda: busca fornecedores ativos remotamente e não mantém seleção de cliente',async()=>{
  const fixture=agendaFixture({fornecedores:{'f-1':{nome:'FORNECEDOR NOVO',status:'Ativo'}}});
  fixture.type.value='Fornecedor';
  fixture.select.value='Cliente cadastrado localmente';
  await fixture.api.refresh('Fornecedor');
  assert.ok(fixture.select.options.some(x=>x.value==='FORNECEDOR NOVO'));
  assert.equal(fixture.select.value,'');
});

test('PIX: mensagem contém titular específico da conta, país e tipo',()=>{
  assert.match(supplierSrc,/Titular da conta:/);
  assert.match(supplierSrc,/CPF\/CNPJ do titular:/);
  assert.match(supplierSrc,/Tipo de conta:/);
  assert.match(supplierSrc,/WhatsApp/);
  assert.match(supplierSrc,/hasCanonical/);
});

test('Bancos: só confirma o salvamento depois da nuvem e impede contas repetidas',()=>{
  const atSave=bankSrc.indexOf('global.phase3BankSave=async');
  const atConfirm=bankSrc.indexOf("await store.save('partyBanks'",atSave);
  const atCache=bankSrc.indexOf('partyBanks[bankKey(kind,key)]=rows;',atSave);
  assert.ok(atConfirm>atSave&&atCache>atConfirm);
  assert.match(bankSrc,/Informe o nome do titular/);
  assert.match(bankSrc,/Uma conta foi repetida/);
  assert.match(bankSrc,/Nenhuma mudança foi confirmada/);
  assert.match(bankSrc,/hasCanonicalBankList/);
});

test('Matriz: cursos inativos são filtrados, preservados no histórico e podem ser reativados',()=>{
  assert.match(matrixSrc,/trainingCourseFilter='ativos'/);
  assert.match(matrixSrc,/data-course-filter="inativos"/);
  assert.match(matrixSrc,/Inativos \(\$\{inactive.length\}\)/);
  assert.match(matrixSrc,/Reativar/);
  assert.match(apiSrc,/case 'activate':/);
  assert.match(apiSrc,/\['courses\/' \+ key \+ '\/active'\]: true/);
  assert.match(endpointSrc,/POST: \{/);assert.doesNotMatch(endpointSrc,/sameOrigin: 'optional'/);
  assert.match(apiSrc,/if \(!isTrainingManager\(identity\)\) throw err\('Somente Elaine pode alterar a matriz\.', 403\)/);
});

test('Clientes: abertura de contas reutiliza editor multibanco completo',()=>{
 const src=read('public/modules/phase1/phase1-usability.js');
 assert.match(src,/global\.phase3OpenPartyBanks/);
});
