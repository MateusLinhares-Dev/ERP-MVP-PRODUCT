import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('vale-transporte e conta fixa criam contas a pagar pelo servidor, não só no navegador', () => {
  const avisos = read('public/legacy/app-avisos.js');
  const finance = read('public/modules/phase1/phase1-finance.js');
  assert.doesNotMatch(avisos, /CONTAS_PAGAR\.push\(/);
  assert.doesNotMatch(finance, /CONTAS_PAGAR\.push\(/);
  assert.match(avisos, /erpPayablesRequest\(\{action:'create',[\s\S]*origem:'vale_transporte'[\s\S]*installments:\{count:meses,day:dia,firstMonth:/);
  assert.match(finance, /erpPayablesRequest\(\{action:'create',payable:\{[^}]*origem:'conta_fixa',fixedId:id,fixedMonth:ym\}\}\)/);
});
