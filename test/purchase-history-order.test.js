import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const begin=core.indexOf('function compararTicketsHistorico(a,b){');
const end=core.indexOf('function renderTickets(){',begin);
assert.ok(begin>=0&&end>begin);
const comparar=runInNewContext(`${core.slice(begin,end)}\ncompararTicketsHistorico`);

test('histórico mostra por último lançamento do dia primeiro, sem mudar o conteúdo',()=>{
  const registros=[
    {ticket:'T076',data:'2026-11-04',fornecedor:'A'},
    {ticket:'T080',data:'2026-11-04',fornecedor:'B'},
    {ticket:'T085',data:'2026-11-04',fornecedor:'C'},
    {ticket:'T089',data:'2026-11-04',fornecedor:'D'},
    {ticket:'T094',data:'2026-11-04',fornecedor:'JAKSON'},
    {ticket:'T066',data:'2026-11-03',fornecedor:'E'}
  ];
  const original=registros.map(r=>JSON.stringify(r));
  const ordenados=registros.slice().sort(comparar);
  assert.deepEqual(ordenados.map(r=>r.ticket),['T094','T089','T085','T080','T076','T066']);
  assert.deepEqual(registros.map(r=>JSON.stringify(r)),original);
});

test('comparação usa número natural do ticket e suporta datas ISO e brasileiras',()=>{
  const registros=[
    {ticket:'T9',data:'04/11/2026'},
    {ticket:'T10',data:'2026-11-04'},
    {ticket:'T200',data:'2026-11-03'},
    {ticket:'T11',data:'05/11/2026'}
  ];
  assert.deepEqual(registros.sort(comparar).map(r=>r.ticket),['T11','T10','T9','T200']);
});

test('o renderizador do histórico utiliza o comparador de datas e tickets',()=>{
  const render=core.slice(core.indexOf('function renderTickets(){'),core.indexOf('function excluirEntradaCompra('));
  assert.match(render,/all\.sort\(compararTicketsHistorico\)/);
});
