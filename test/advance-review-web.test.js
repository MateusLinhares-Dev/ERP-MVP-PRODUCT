import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  REVIEW_CHOICES,
  canSubmit,
  confirmationOf,
  guidanceOf,
  orphanPreview,
  restoredMovement,
  reviewPayload,
  submitLabel,
} from '../web/modules/advance-review/domain/orphan-review.ts';

const preview = orphanPreview({ eligible: true, signature: 'x'.repeat(64), amount: 124, bankName: 'acred gratus', date: '05/11/2026', supplierName: 'Teste', canRecordTransfer: true });
const note = 'Conferi o extrato da conta bancária e não ocorreu saída de dinheiro.';
const ids = { supplierCode: 'F1', advanceCode: 'ADT_124', signature: preview.signature, operationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };

test('conferência: três decisões de negócio e orientação para o extrato real', () => {
  assert.deepEqual(REVIEW_CHOICES.map((c) => c.value), ['', 'no-transfer', 'paid', 'uncertain']);
  assert.match(guidanceOf('', preview), /extrato bancário real/);
  assert.match(guidanceOf('uncertain', preview), /Nenhum saldo será alterado/);
  assert.match(confirmationOf('no-transfer'), /não houve saída/);
  assert.equal(submitLabel('no-transfer', false), 'Cancelar adiantamento incorreto');
  assert.equal(submitLabel('paid', true), 'Verificar novamente');
});

test('conferência: sem confirmação e justificativa de 25 caracteres não envia cancelamento', () => {
  assert.equal(canSubmit(preview, { choice: 'no-transfer', confirmed: false, note, reference: '' }, false), false);
  assert.equal(canSubmit(preview, { choice: 'no-transfer', confirmed: true, note: 'curta', reference: '' }, false), false);
  assert.equal(canSubmit(preview, { choice: 'no-transfer', confirmed: true, note, reference: '' }, false), true);
  assert.equal(canSubmit(preview, { choice: 'uncertain', confirmed: true, note, reference: '' }, false), false);
  assert.equal(canSubmit({ ...preview, eligible: false }, { choice: 'no-transfer', confirmed: true, note, reference: '' }, false), false);
  const payload = reviewPayload({ choice: 'no-transfer', confirmed: true, note: '  ' + note + ' ', reference: '' }, ids);
  assert.equal(payload.action, 'confirm');
  assert.equal(payload.confirmCode, 'ADT_124');
  assert.equal(payload.confirmedNoRealTransfer, true);
  assert.equal(payload.reason, note);
});

test('conferência: pagamento confirmado exige comprovante e só quando o servidor permite registrar', () => {
  const form = { choice: 'paid', confirmed: true, note, reference: 'PIX1' };
  assert.equal(canSubmit(preview, form, false), false);
  assert.equal(canSubmit(preview, { ...form, reference: 'PIX-TESTE-AB123' }, false), true);
  assert.equal(canSubmit({ ...preview, canRecordTransfer: false }, { ...form, reference: 'PIX-TESTE-AB123' }, false), false);
  assert.match(guidanceOf('paid', { ...preview, canRecordTransfer: false }), /Não é seguro/);
  const payload = reviewPayload({ ...form, reference: ' PIX-TESTE-AB123 ' }, ids);
  assert.equal(payload.action, 'record-bank-transfer');
  assert.equal(payload.confirmedRealTransfer, true);
  assert.equal(payload.statementReference, 'PIX-TESTE-AB123');
  assert.equal(restoredMovement({ action: 'restore-missing-bank-movement' }), true);
});

test('conferência: depois de resposta perdida, "Verificar novamente" fica liberado e a tela reaproveita a mesma operação', () => {
  assert.equal(canSubmit(preview, { choice: '', confirmed: false, note: '', reference: '' }, true), true);
  const dialog = readFileSync(new URL('../web/modules/advance-review/ui/OrphanReviewDialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /pending \?\?/);
  assert.match(dialog, /setPending\(payload\)/);
});

test('conferência: ação antiga delega para a tela nova e aplica o resultado nos adiantamentos', async () => {
  const code = readFileSync(new URL('../public/modules/finance/advance-actions.js', import.meta.url), 'utf8');
  const calls = [];
  const ctx = { ADT_POR_FORN: { F1: [{ cod: 'ADT_124' }] }, localStorage: { setItem() {} }, console, renderAdiantamentos() { calls.push('render'); } };
  ctx.window = ctx;
  runInNewContext(code, ctx);
  await assert.rejects(ctx.ERPAdvanceActions.reviewOrphanAdvance('F1', 'ADT_124'), /Conferência indisponível/);
  ctx.ERPAdvanceReview = { review: async (s, a) => s + '/' + a };
  assert.equal(await ctx.ERPAdvanceActions.reviewOrphanAdvance('F1', 'ADT_124'), 'F1/ADT_124');
  ctx.ERPAdvanceActions.applyOrphanResult('F1', 'ADT_124', { action: 'restore-missing-bank-movement' });
  assert.equal(ctx.ADT_POR_FORN.F1.length, 1);
  ctx.ERPAdvanceActions.applyOrphanResult('F1', 'ADT_124', { removedCode: 'ADT_124', entries: [] });
  assert.equal(ctx.ADT_POR_FORN.F1.length, 0);
  assert.deepEqual(calls, ['render', 'render']);
});
