import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const code=fs.readFileSync(new URL('../public/modules/phase2/phase2-feedback.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/modules/phase2/phase2-feedback.css',import.meta.url),'utf8');
const extract=(a,b)=>{const fragment=code.split(a)[1]?.split(b)[0];assert.ok(fragment,`Trecho ausente: ${a}`);return fragment;};
const context=vm.createContext({});
const functions=extract('/* ---------- Viagens: acesso ao registro e análise mensal por motorista ---------- */','function phase2TripData()');
vm.runInContext(functions+ '\nthis.helpers={parts:phase2TripCostParts,monthly:phase2TripMonthlyReport};',context);
const {parts,monthly}=context.helpers;

test('aba Por motorista e abertura de detalhe estão conectadas à área de viagens',()=>{
 const workspace=extract('function workspaceTrip(){','function workspacePoint(){');
 assert.match(workspace,/key:'drivers',label:'Por motorista'/);
 assert.match(workspace,/views\.drivers\.panel\.appendChild\(driverReport\)/);
 assert.match(workspace,/phase2TripCompactRates\(register\)/);
 const history=extract('function renderTripHistoryCards(){','\/\* ---------- Viagens: acesso');
 assert.match(history,/data-trip-open/);
 assert.match(history,/Abrir detalhes/);
 assert.match(code,/phase2TripOpenDetails\(button\.dataset\.tripOpen\)/);
 assert.match(code,/global\.editViagem\(v\.id\)/);
});

test('custo mensal por motorista não duplica adiantamento e separa despesas',()=>{
 const trips=[
  {motorista:'TESTE 3',data:'2026-10-21',totalDiarias:240,totalRefeicoes:90,combustivel:25,gastosExtras:15,dinheiroAlim:1000},
  {motorista:'TESTE 3',data:'2026-10-23',totalDiarias:0,refeicoesPorDia:[],cafeManha:10,almoco:20,combustivel:100,gastosExtras:50},
  {motorista:'TESTE 2',data:'2026-10-23',totalDiarias:999,totalRefeicoes:900},
  {motorista:'TESTE 3',data:'2026-09-11',totalDiarias:15}
 ];
 const out=monthly(trips,'TESTE 3','2026');
 assert.equal(out[9].quantidade,2);
 assert.equal(out[9].diarias,240);
 assert.equal(out[9].alimentacao,120);
 assert.equal(out[9].combustivel,125);
 assert.equal(out[9].extras,65);
 assert.equal(out[9].total,550);
 assert.equal(out[8].total,15);
 assert.equal(out[9].total+out[8].total,565);
 assert.equal(parts(trips[0]).total,370);
});

test('totais históricos ignoram valores inválidos e preservam diária total sem multiplicar novamente',()=>{
 assert.equal(parts({total:240,diaria:80,pernoite:40,numDiarias:2,combustivel:20}).total,260);
 assert.equal(parts({diaria:80,pernoite:40,numDiarias:2,combustivel:20}).total,260);
 assert.equal(parts({totalDiarias:0,totalRefeicoes:0,gastosExtras:NaN,combustivel:-1}).total,0);
 assert.equal(monthly([{data:'2026-13-04',motorista:'A',totalDiarias:5}], 'A','2026').reduce((s,r)=>s+r.total,0),0);
});

test('campos de diária continuam existentes, apenas recolhidos em opções adicionais',()=>{
 const snippet=extract('function phase2TripCompactRates(register){','function phase2TripHistoryActions(){');
 assert.match(snippet,/phase2-trip-rates/);
 assert.match(snippet,/details\.appendChild\(rateRow\)/);
 assert.match(snippet,/dailyTitle\.remove\(\)/);
 assert.match(css,/\.phase2-trip-rates/);
 assert.match(css,/\.phase2-trip-driver-tabs/);
});

test('após uma viagem salva com sucesso, a interface volta ao histórico',()=>{
 const snippet=extract('const originalSaveTripPhase2=global.salvarViagem;','/* ---------- Fiscal independente completo ---------- */');
 assert.match(snippet,/previous=new Set/);
 assert.match(snippet,/!previous\.has\(String\(v\.id\)\)/);
 assert.match(snippet,/history\?\.click\(\)/);
 assert.match(snippet,/renderTripHistoryCards\(\)/);
});
