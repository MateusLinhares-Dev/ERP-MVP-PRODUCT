import {
  cash,
  clone,
  readRows,
  reject,
  round,
  rowEntries,
  type FinancialReceipt,
  type PurchaseTicket,
  type Row,
} from './purchase-records.js';

export interface AdvanceRefund {
  receipt: FinancialReceipt;
  records: Row | Row[];
  applied: number;
  refunds: { cod: string; valor: number }[];
}

interface LedgerRecord {
  cod?: unknown;
  origem?: unknown;
  status?: unknown;
  valor?: unknown;
  valorOriginal?: unknown;
  valorCompensado?: unknown;
  valorDisponivel?: unknown;
  ticket?: unknown;
  ticketOrigem?: unknown;
  devolucoesCompra?: unknown;
  [field: string]: unknown;
}

function assertRefundable(previous: PurchaseTicket, receipt: FinancialReceipt): number {
  if ((receipt.cheques ?? []).some((row) => cash(Number(row.valorAplicado || 0)) > 0)) {
    reject(
      409,
      'CHEQUE_RECONCILIATION_REQUIRED',
      'Esta compra foi paga com cheque. Para reduzir o valor ou excluir, devolva o cheque pelo financeiro.',
    );
  }
  if (
    (Array.isArray(receipt.creditos) && receipt.creditos.length) ||
    cash(Number(previous.creditoFornecedorAplicado || 0)) > 0
  ) {
    reject(
      409,
      'CREDIT_RECONCILIATION_REQUIRED',
      'Esta compra usou crédito residual do fornecedor. Reduzir ou excluir precisa de conciliação no financeiro.',
    );
  }
  const rows = Array.isArray(receipt.adiantamentos) ? receipt.adiantamentos : [];
  if (Number(receipt.versao) !== 2 || !rows.length) {
    reject(
      409,
      'ADVANCE_RECONCILIATION_REQUIRED',
      'O adiantamento deste pedido antigo não possui vínculo financeiro único. Não foi alterado.',
    );
  }
  const appliedTotal = rows.reduce((sum, row) => sum + cash(Number(row.valorAplicado || 0)), 0);
  if (Math.abs(appliedTotal - cash(Number(previous.adiantamento || 0))) > 1) {
    reject(
      409,
      'ADVANCE_RECEIPT_MISMATCH',
      'O recibo possui abatimentos diferentes do total original. Confira as baixas antes de editar.',
    );
  }
  return appliedTotal;
}

export function refundAdvanceReceipt(
  previous: PurchaseTicket,
  ledgerRaw: unknown,
  excess: number,
  ticketNo: string,
  at: number,
): AdvanceRefund {
  const receipt = clone((previous.reciboFinanceiro ?? {}) as FinancialReceipt);
  const appliedTotal = assertRefundable(previous, receipt);
  const rows = receipt.adiantamentos ?? [];
  if (excess > appliedTotal) {
    reject(
      409,
      'PAID_REFUND_REQUIRED',
      'A redução passa do valor pago com adiantamento (R$ ' +
        round(appliedTotal).toFixed(2).replace('.', ',') +
        '). A diferença foi paga pelo banco: faça o estorno no financeiro.',
    );
  }
  const records = readRows(ledgerRaw);
  const entries = rowEntries<LedgerRecord>(records);
  const refunds: { cod: string; valor: number }[] = [];
  let remaining = excess;
  for (let index = rows.length - 1; index >= 0 && remaining > 0; index--) {
    const row = rows[index];
    if (!row) continue;
    const applied = cash(Number(row.valorAplicado || 0));
    const take = Math.min(applied, remaining);
    if (!take) continue;
    const matches = entries.filter(
      ([, record]) =>
        String(record.cod || '') === String(row.cod || '') && record.origem !== 'compensacao_cp',
    );
    const record = matches.length === 1 ? matches[0]?.[1] : undefined;
    if (!record) {
      reject(
        409,
        'ADVANCE_CHANGED',
        'O adiantamento ' +
          String(row.cod || '') +
          ' não foi encontrado de forma única. Solicite conferência.',
      );
    }
    const original = cash(Number(record.valorOriginal ?? record.valor));
    const consumed = cash(Number(record.valorCompensado || 0));
    const consistent =
      record.status === 'Quitado'
        ? consumed === original
        : record.status === 'Pendente' &&
          cash(Number(record.valorDisponivel ?? record.valor ?? 0)) === original - consumed;
    if (consumed < take || original < consumed || !consistent) {
      reject(
        409,
        'ADVANCE_CHANGED',
        'O saldo do adiantamento ' +
          String(row.cod || '') +
          ' mudou desde a compra. Atualize a tela antes de editar.',
      );
    }
    const usedAfter = consumed - take;
    const available = original - usedAfter;
    record.valorOriginal = round(original);
    record.valorCompensado = round(usedAfter);
    record.valorDisponivel = round(available);
    record.valor = round(available);
    record.status = 'Pendente';
    if (record.ticket) {
      if (!record.ticketOrigem) record.ticketOrigem = String(record.ticket);
      record.ticket = '';
    }
    if (usedAfter === 0 && String(record.ticketOrigem || '') === ticketNo) delete record.ticketOrigem;
    record.devolucoesCompra = [
      ...(Array.isArray(record.devolucoesCompra) ? (record.devolucoesCompra as unknown[]) : []),
      { ticket: ticketNo, valor: round(take), em: at },
    ];
    row.valorAplicado = round(applied - take);
    row.valorPendente = round(cash(Number(row.valorPendente || 0)) + take);
    refunds.push({ cod: String(row.cod), valor: round(take) });
    remaining -= take;
  }
  if (remaining > 0)
    reject(
      409,
      'ADVANCE_RECEIPT_MISMATCH',
      'Não foi possível devolver todo o valor aos adiantamentos. Nada foi alterado.',
    );
  receipt.total = round(appliedTotal - excess);
  receipt.devolucoes = [
    ...(Array.isArray(receipt.devolucoes) ? receipt.devolucoes : []),
    { em: at, valor: round(excess), adiantamentos: refunds },
  ];
  return { receipt, records, applied: appliedTotal - excess, refunds };
}
