import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(import.meta.dirname,'..');
const domainPath=path.join(root,'public/modules/weighing/road-weighing-domain.js');
const flowPath=path.join(root,'public/modules/weighing/road-weighing-flow.js');
const viewPath=path.join(root,'public/modules/weighing/road-weighing-view.js');
const cssPath=path.join(root,'public/modules/weighing/road-weighing-flow.css');
const bootstrapPath=path.join(root,'public/app/bootstrap.js');

function loadDomain(){
  const context={window:{},Date,Math,Map,Set,Object,Array,String,Number,Boolean};
  context.window.window=context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(domainPath,'utf8'),context,{filename:domainPath});
  return context.window.RoadWeighingDomain;
}

test('prioridade 1 possui arquitetura modular e carregamento ordenado',()=>{
  for(const file of [domainPath,flowPath,viewPath,cssPath]) assert.equal(fs.existsSync(file),true,file);
  const bootstrap=fs.readFileSync(bootstrapPath,'utf8');
  const core=bootstrap.indexOf("await loadClassic('/legacy/app-core.js')");
  const domain=bootstrap.indexOf("await loadClassic('/modules/weighing/road-weighing-domain.js')");
  const view=bootstrap.indexOf("await loadClassic('/modules/weighing/road-weighing-view.js')");
  const flow=bootstrap.indexOf("await loadClassic('/modules/weighing/road-weighing-flow.js')");
  assert.ok(core>=0&&domain>core&&view>domain&&flow>view);
  assert.match(bootstrap,/road-weighing-flow\.css/);
});

test('domínio preserva múltiplas pesagens e consolida materiais sem sobrescrever histórico',()=>{
  const domain=loadDomain();
  const ticket={
    itens:[{mat:'COBRE',pesoLiq:10,preco:12}],
    bags:[
      {bagNum:1,mat:'COBRE',br:110,lq:100},
      {bagNum:2,mat:'COBRE',br:60,lq:50},
      {bagNum:3,mat:'ALUMINIO',br:45,lq:40}
    ]
  };
  domain.registerWeight(ticket,'balanceiro_item',{material:'COBRE',pesoLiquido:100},'bag:1');
  domain.registerWeight(ticket,'balanceiro_item',{material:'COBRE',pesoLiquido:50},'bag:2');
  domain.registerWeight(ticket,'balanceiro_item',{material:'ALUMINIO',pesoLiquido:40},'bag:3');
  domain.syncItemsFromBalance(ticket);
  assert.equal(ticket.pesagensOperacionais.length,3);
  assert.equal(ticket.itens.length,2);
  assert.equal(ticket.itens.find(item=>item.mat==='COBRE').pesoLiq,150);
  assert.equal(ticket.itens.find(item=>item.mat==='COBRE').preco,12);
  assert.equal(ticket.itens.find(item=>item.mat==='ALUMINIO').pesoLiq,40);
});

test('domínio modela os estados operacionais exigidos pela prioridade 1',()=>{
  const domain=loadDomain();
  const ticket={_weighingFlowVersion:1,_weighingStage:'aguardando_rota'};
  assert.equal(domain.stageInfo(ticket).label,'Escolher rota');
  ticket._weighingStage='balanceiro';
  assert.equal(domain.stageInfo(ticket).label,'No Balanceiro');
  ticket._weighingStage='balanceiro_concluido';
  assert.equal(domain.stageInfo(ticket).label,'Balanceiro concluído');
  ticket._weighingStage='aguardando_preco';
  assert.equal(domain.stageInfo(ticket).label,'Aguardando preço');
});

test('fluxo oferece as duas rotas explícitas, mantém o mesmo ticket e integra Compra de Sucata',()=>{
  const flow=fs.readFileSync(flowPath,'utf8');
  assert.match(flow,/roadWeighingContinueOnRoad/);
  assert.match(flow,/roadWeighingSendToBalance/);
  assert.match(flow,/_weighingRoute='rodoviaria'/);
  assert.match(flow,/_weighingRoute='balanceiro'/);
  assert.match(flow,/domain\.syncItemsFromBalance/);
  assert.match(flow,/domain\.syncItemsFromRoad/);
  const domain=fs.readFileSync(domainPath,'utf8');
  assert.match(domain,/pesagensOperacionais/);
  assert.match(domain,/historicoFluxoPesagem/);
  assert.match(flow,/renderTickets/);
});

test('fila e balanceiro exibem estado e próxima ação sem remover compatibilidade legada',()=>{
  const flow=fs.readFileSync(flowPath,'utf8');
  const view=fs.readFileSync(viewPath,'utf8');
  assert.match(flow,/legacyAwaitingTickets/);
  assert.match(view,/Próxima ação/);
  assert.match(view,/BALANCEIRO CONCLUÍDO/);
  assert.match(view,/Tickets encaminhados pela Rodoviária/);
  assert.match(view,/Peso atual/);
  assert.match(view,/Entrada/);
  assert.match(view,/Saída/);
  assert.match(view,/Líquido/);
});
