import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as chequeReport from '../web/modules/cheque-report/domain/cheque-report.ts';

const report={
  filter:(items,c={})=>chequeReport.filterCheques(items,{customer:c.cliente,company:c.empresa,year:c.year,month:c.month,from:c.from,to:c.to,status:c.status}),
  csv:chequeReport.chequesCsv,summary:chequeReport.chequesSummary,isoDate:chequeReport.isoDate,printHtml:chequeReport.chequesPrintHtml
};
const core=readFileSync(new URL('../public/legacy/app-core.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.template.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/modules/phase1/phase1-usability.css',import.meta.url),'utf8');

const entries=[
  {empresa:'ALUMIL ESQUADRIAS',cliente:'CICLO',numero:'3126',data:'05/11/2026',valor:3000},
  {empresa:'MOACIR MARANGONI',cliente:'CICLO',numero:'850220',data:'06/11/2026',valor:4000.55}
];

test('CSV tem somente seis colunas como a planilha da cliente',()=>{
  const csv=report.csv(entries).replace(/^\uFEFF/,'');
  const lines=csv.split('\r\n');
  assert.equal(lines.length,4);
  assert.equal(lines[0],'"CHEQUE";"EMPRESA";"CLIENTE";"NÚMERO";"DATA";"VALOR"');
  for(const line of lines)assert.equal(line.split(';').length,6);
  assert.match(lines[1],/"R\$ 3\.000,00"$/);
  assert.match(lines[3],/^"TOTAL";"";"";"";"";"R\$ 7\.000,55"$/);
  assert.doesNotMatch(csv,/SITUAÇÃO|ADIANTAMENTO|ORIGEM|VENCIMENTO/);
});

test('impressão usa documento independente e inclui total de todas as linhas',()=>{
  const source=report.printHtml(entries);
  assert.match(source,/<!doctype html>/i);
  assert.match(source,/ALUMIL ESQUADRIAS/);
  assert.match(source,/MOACIR MARANGONI/);
  assert.match(source,/R\$ 7\.000,55/);
  assert.match(source,/window\.print\(\)/);
  assert.equal((source.match(/<th>/g)||[]).length,6);
  assert.equal((source.match(/<tr>/g)||[]).length,4);
  const escaped=report.printHtml([{...entries[0],empresa:'<img src=x onerror=alert(1)>'}]);
  assert.doesNotMatch(escaped,/<img src=x onerror/);
  assert.match(escaped,/&lt;img/);
});

test('ordenar funcionários por nome, status e matrícula sem perder paginação',()=>{
  assert.match(html,/id="func-ordenacao"/);
  assert.match(html,/value="nome:1"/);
  assert.match(html,/value="status:1"/);
  assert.match(core,/function funcSelecionarOrdenacao\(valor\)/);
  assert.match(core,/funcionarios-ativos[^\n]*alwaysShow:true/);
  assert.match(core,/funcionarios-inativos[^\n]*alwaysShow:true/);
});

test('ponto mensal tem filtros espaçados, pesquisa, paginação e totais do mês completo',()=>{
  assert.match(html,/ponto-filter-toolbar/);
  assert.match(core,/const paginaPonto=_erpPaginarDados\('ponto-mensal'/);
  assert.match(core,/tb\.innerHTML=paginaPonto\.map/);
  assert.match(core,/placeholder:'Pesquisar funcionário ou matrícula\.\.\.'/);
  assert.match(css,/ponto-filter-toolbar/);
  assert.match(css,/erp-list-pager-ponto-mensal/);
});

test('ajuda RH iD abre o modal antes de consultar o elemento novo',()=>{
  const start=core.indexOf('function pontoRHiDComoImportar(){');
  const end=core.indexOf('function importarCartaoPontoRHiD(',start);
  const fn=core.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.match(fn,/om\('ponto_rhid_ajuda'\);\s*const body=document\.getElementById\('modal-body'\)/);
  assert.match(fn,/A coluna PREVISTO é opcional/);
});
