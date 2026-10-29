import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../public/modules/phase1/rhid-card-reader.js';

const reader = globalThis.RHiDCardReader;
function row(...pairs) { return { itens: pairs.map(([x, str]) => ({x, str})) }; }
function report({ rate = '75%D', combined = true } = {}) {
  const lines = [
    row([450, 'DE 01/09/2026 ATÉ 30/09/2026']),
    combined
      ? row([33, 'NOME DO FUNCIONÁRIO: FUNCIONARIO EXEMPLO'], [282, 'CPF DO FUNCIONÁRIO: 12345678901'])
      : row([33, 'NOME DO FUNCIONÁRIO:'], [130, 'FUNCIONARIO EXEMPLO'], [282, 'CPF DO FUNCIONÁRIO:'], [380, '12345678901']),
    row([33, 'PIS DO FUNCIONÁRIO: 12345678901'], [282, 'DATA DE ADMISSÃO DO FUNCIONÁRIO: 01/01/2025']),
    row([33, 'NOME DO CARGO: AUXILIAR']),
    row([273, 'TOTAL'], [360, 'FALTA E'], [412, 'EXTRA'], [459, 'EXTRA']),
    row([33, 'DIA'], [87, 'PREVISTO'], [153, 'ENT. 1'], [183, 'SAÍ. 1'], [212, 'ENT. 2'], [242, 'SAÍ. 2'],
      [273, 'NORMAIS'], [360, 'ATRASO'], [412, rate], [459, 'DIURNA']),
    row([33, '01/09/2026 - TER'], [87, '08:00-12:00 13:00-17:48'], [153, '07:54 (C)'], [183, '12:01 (C)'],
      [212, '13:00 (C)'], [242, '17:59 (C)'], [273, '08:48'], [412, '00:12'], [459, '00:12']),
    row([33, '02/09/2026 - QUA'], [87, '08:00-12:00 13:00-17:48'], [153, 'Falta']),
    row([33, 'TOTAIS'], [273, '08:48']),
  ];
  return { lines, text: lines.map(l => l.itens.map(i => i.str).join(' ')).join('\n') };
}

test('RH iD reconhece formato de colunas TOTAL/NORMAIS, FALTA E/ATRASO do PDF', () => {
  const { lines, text } = report();
  const card = reader.parsePage(lines, text);
  assert.equal(card.nome, 'FUNCIONARIO EXEMPLO');
  assert.equal(card.cpf, '12345678901');
  assert.equal(card.periodoInicio, '01/09/2026');
  assert.equal(card.periodoFim, '30/09/2026');
  assert.equal(card.dias.length, 2);
  assert.equal(card.dias[0].ent1, '07:54 (C)');
  assert.equal(card.dias[0].total, '08:48');
  assert.equal(card.dias[0].extras.extra_75_D.valor, '00:12');
  assert.ok(!card.dias[0].extras.extra_75_N);
  assert.equal(card.dias[1].ent1, 'Falta');
});

test('RH iD lê nome e CPF quando valor e rótulo estão separados', () => {
  const { lines, text } = report({ combined: false, rate: '0%D' });
  const card = reader.parsePage(lines, text);
  assert.equal(card.nome, 'FUNCIONARIO EXEMPLO');
  assert.equal(card.cpf, '12345678901');
  assert.equal(card.dias[0].extras.extra_0_D.valor, '00:12');
});

test('RH iD rejeita documento sem cabeçalho sem gerar batidas', () => {
  const card = reader.parsePage([row([33, 'NOME DO FUNCIONÁRIO: TESTE'])], 'TESTE');
  assert.equal(card.erro, 'cabecalho_nao_encontrado');
  assert.equal(card.dias.length, 0);
});

test('importação confirma escrita antes de alterar registros e preserva lançamentos manuais', () => {
  const js = readFileSync(new URL('../public/legacy/app-core.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/index.template.html', import.meta.url), 'utf8');
  const boot = readFileSync(new URL('../public/app/bootstrap.js', import.meta.url), 'utf8');
  assert.match(js, /await window\._fbDB\.ref\('erp\/pontoBatidas'\)\.update\(updates\)/);
  assert.match(js, /old\.origem==='rhid'/);
  assert.match(js, /_rhidExibirPrevia\(pages\)/);
  assert.match(js, /function _popularSelectPontoFuncionarios\(\)/);
  assert.ok(!js.slice(js.indexOf('function _popularSelectPontoFuncionarios(){'), js.indexOf('function renderCartaoPontoImportado(){')).includes('matsComDados.has'));
  assert.match(html, /id="ponto-rhid-preview"/);
  assert.ok(boot.indexOf("'/modules/phase1/rhid-card-reader.js'") < boot.indexOf("'/legacy/app-core.js'"));
});
