import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLastSync, isValidBankCode, usesSandbox } from '../web/modules/bank-integrations/domain/integration.ts';

test('integrações: código do banco validado antes de abrir a janela', () => {
  assert.equal(isValidBankCode('B1'), true);
  assert.equal(isValidBankCode('conta-principal_2'), true);
  assert.equal(isValidBankCode('../erp'), false);
  assert.equal(isValidBankCode(''), false);
  assert.equal(isValidBankCode(42), false);
});

test('integrações: ambiente de testes do Pluggy só em homologação ou máquina local', () => {
  assert.equal(usesSandbox('erp-hml.vercel.app'), true);
  assert.equal(usesSandbox('localhost'), true);
  assert.equal(usesSandbox('erp.manuelametais.com.br'), false);
  assert.equal(formatLastSync(undefined), '—');
});
