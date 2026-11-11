export type ReviewChoice = '' | 'no-transfer' | 'paid' | 'uncertain';

export const REVIEW_CHOICES: readonly { value: ReviewChoice; label: string }[] = [
  { value: '', label: 'Selecione uma situação' },
  { value: 'no-transfer', label: 'O dinheiro NÃO saiu da conta' },
  { value: 'paid', label: 'O dinheiro SAIU da conta' },
  { value: 'uncertain', label: 'Ainda não consegui conferir' },
];

export const MIN_NOTE = 25;
export const MIN_REFERENCE = 6;

export interface OrphanPreview {
  eligible: boolean;
  signature: string;
  amount: number;
  bankName: string;
  date: string;
  supplierName: string;
  canRecordTransfer: boolean;
}

export interface OrphanReply {
  confirmed?: boolean;
  action?: string;
  removedCode?: string;
  entries?: unknown;
}

export interface ReviewForm {
  choice: ReviewChoice;
  confirmed: boolean;
  note: string;
  reference: string;
}

type Row = Record<string, unknown>;

export function orphanPreview(raw: unknown): OrphanPreview {
  const data = raw && typeof raw === 'object' ? (raw as Row) : {};
  return {
    eligible: data.eligible === true,
    signature: String(data.signature ?? ''),
    amount: Number(data.amount) || 0,
    bankName: String(data.bankName ?? ''),
    date: String(data.date ?? ''),
    supplierName: String(data.supplierName ?? ''),
    canRecordTransfer: data.canRecordTransfer === true,
  };
}

export function canSubmit(preview: OrphanPreview, form: ReviewForm, retrying: boolean): boolean {
  if (retrying) return true;
  const { choice } = form;
  if (!preview.eligible || !choice || choice === 'uncertain') return false;
  if (choice === 'paid' && !preview.canRecordTransfer) return false;
  if (!form.confirmed || form.note.trim().length < MIN_NOTE) return false;
  return choice !== 'paid' || form.reference.trim().length >= MIN_REFERENCE;
}

export function guidanceOf(choice: ReviewChoice, preview: OrphanPreview): string {
  if (choice === 'no-transfer')
    return 'Se realmente não houve pagamento, o ERP poderá cancelar esse adiantamento incorreto, mantendo o histórico da conferência.';
  if (choice === 'paid')
    return preview.canRecordTransfer
      ? 'Se houve pagamento, o ERP pode registrar o lançamento ausente usando a mesma conta e o mesmo valor. Isso NÃO faz outro PIX nem cria outro adiantamento.'
      : 'Há outro lançamento possível ou a conta não está disponível. Não é seguro registrar automaticamente. Confira com o financeiro.';
  if (choice === 'uncertain')
    return 'Sem confirmação no extrato real, deixe este adiantamento pendente. Nenhum saldo será alterado.';
  return 'Escolha uma situação após conferir o extrato bancário real.';
}

export function confirmationOf(choice: ReviewChoice): string {
  if (choice === 'no-transfer')
    return 'Conferi o extrato real da conta e confirmo que não houve saída de dinheiro.';
  if (choice === 'paid') return 'Conferi o extrato real: o pagamento ocorreu nesta conta e neste valor.';
  return '';
}

export function submitLabel(choice: ReviewChoice, retrying: boolean): string {
  if (retrying) return 'Verificar novamente';
  if (choice === 'no-transfer') return 'Cancelar adiantamento incorreto';
  if (choice === 'paid') return 'Registrar pagamento já realizado';
  return 'Confirmar conferência';
}

export function reviewPayload(
  form: ReviewForm,
  ids: { supplierCode: string; advanceCode: string; signature: string; operationId: string },
): Record<string, unknown> {
  const base = {
    fornCod: ids.supplierCode,
    adtCod: ids.advanceCode,
    signature: ids.signature,
    operationId: ids.operationId,
    reason: form.note.trim(),
  };
  return form.choice === 'paid'
    ? {
        ...base,
        action: 'record-bank-transfer',
        confirmedRealTransfer: true,
        confirmedBankAmount: true,
        statementReference: form.reference.trim(),
      }
    : { ...base, action: 'confirm', confirmCode: ids.advanceCode, confirmedNoRealTransfer: true };
}

export const restoredMovement = (reply: OrphanReply): boolean =>
  reply.action === 'restore-missing-bank-movement';
