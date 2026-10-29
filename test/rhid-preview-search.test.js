import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
const start = source.indexOf('let _rhidPaginasPendentes = [];');
const end = source.indexOf('function importarCartaoPontoRHiD(input){', start);
const code = source.slice(start, end);

test('prévia RH iD pesquisa nomes do PDF e preserva matrículas escolhidas', () => {
  const context = {
    document: { getElementById: () => null },
    window: {},
    FUNCIONARIOS: Array.from({ length: 240 }, (_, i) => ({ mat: `F${String(i + 1).padStart(3, '0')}`, nome: `Funcionario ${i+1}` })),
    _cpfSoDigitos: value => String(value || '').replace(/\D/g, ''),
    _erpFuncionarioAtivo: () => true,
    esc: value => String(value),
  };
  const api = vm.runInNewContext(code + `\n({
    setup(cards) { _rhidPaginasPendentes = cards; _rhidVinculosPendentes = new Map(); },
    filter(query) { _rhidFiltroPrevia = query; return _rhidIndicesFiltrados(); },
    choose(index, mat) { atualizarVinculoCartaoPontoRHiD(index, mat); },
    link(index) { return _rhidVinculosPendentes.get(index); }
  })`, context);
  api.setup(Array.from({ length: 28 }, (_, i) => ({ nome: `PESSOA ${i + 1}`, cpf: '', dias: [1] })));
  api.choose(19, 'F200');
  assert.equal(api.link(19), 'F200');
  assert.equal(api.filter('pessoa 20').join(','), '19');
  assert.equal(api.filter('PESSOA 1').length, 11);
  assert.equal(api.filter('').length, 28);
  assert.equal(api.link(19), 'F200', 'trocar o filtro não remove vínculos de outras páginas');
});

test('prévia RH iD usa seletor pesquisável, pagina os cartões e confirma vínculos fora da página', () => {
  const css = readFileSync(new URL('../public/modules/phase1/rhid-preview.css', import.meta.url), 'utf8');
  const boot = readFileSync(new URL('../public/app/bootstrap.js', import.meta.url), 'utf8');
  assert.match(code, /_RHID_PREVIA_POR_PAGINA = 6/);
  assert.match(code, /window\.ERPEnhanceSearchableSelect\(select/);
  assert.match(code, /placeholder:'Pesquisar nome ou matrícula/);
  assert.match(code, /_rhidVinculosPendentes\.get\(i\)/);
  assert.match(code, /if\(mats\.has\(mat\)\)/, 'duplicidade de matrícula continua bloqueada');
  assert.match(css, /\.rhid-preview-table/);
  assert.ok(boot.includes("loadStyle('/modules/phase1/rhid-preview.css')"));
});
