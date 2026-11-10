import { businessTodayISO } from '../../../shared/domain/business-date.js';
import { installmentPayableIds, installmentPayables, type Installment } from './installments.js';
import {
  cash,
  clone,
  readRows,
  reject,
  round,
  rowEntries,
  type AdvanceReceiptRow,
  type FinancialReceipt,
  type PayableRow,
  type PurchaseTicket,
  type Row,
} from './purchase-records.js';

export interface EditInput {
  ticket?: unknown;
  ticketNo?: unknown;
  operationId?: unknown;
  expectedTicket?: unknown;
}

export interface AssembledTicket {
  ticket: PurchaseTicket;
  oldTotal: number;
  total: number;
  balance: number;
  difference: number;
}

export interface AdvanceChange {
  code: string;
  original: number;
  before: number;
  after: number;
}

export interface PayableUpdate {
  path: string;
  updated: PayableRow;
}

interface LedgerRecord {
  cod?: unknown;
  status?: unknown;
  ticket?: unknown;
  valor?: unknown;
  valorOriginal?: unknown;
  valorCompensado?: unknown;
  adiantamentoOrigem?: unknown;
  obs?: unknown;
  forma?: unknown;
  data?: unknown;
  bancoNome?: unknown;
  [field: string]: unknown;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeItems(raw: unknown, original: PurchaseTicket): Row[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200)
    reject(422, 'INVALID_ITEMS', 'Informe de 1 a 200 materiais.');
  const originalItems = Array.isArray(original.itens) ? original.itens : [];
  return raw.map((value: unknown, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      reject(422, 'INVALID_ITEMS', 'Material inválido.');
    const row = value as Row;
    const mat = String(row.mat || '')
      .trim()
      .slice(0, 180);
    if (!mat) reject(422, 'INVALID_ITEMS', 'Informe o material.');
    const quantity = Number(row.pesoLiq ?? row.quantidade);
    const price = Number(row.preco);
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 10000000 ||
      !Number.isFinite(price) ||
      price < 0 ||
      price > 1000000
    ) {
      reject(422, 'INVALID_ITEMS', 'Quantidade ou preço inválido.');
    }
    const description = String(row.descricaoDetalhada || row.obs || '')
      .trim()
      .slice(0, 400);
    const previous = originalItems[index] ?? {};
    const total = round(Math.round(quantity * price * 100));
    return {
      ...previous,
      mat,
      matBase: mat,
      ident: String(row.ident || previous.ident || ''),
      descricaoDetalhada: description,
      obs: description,
      unidade: 'kg',
      quantidade: quantity,
      pesoBruto: Number(row.pesoBruto || quantity),
      pesoLiq: quantity,
      preco: price,
      subtotal: total,
      total,
    };
  });
}

export function assemble(original: PurchaseTicket, input: EditInput): AssembledTicket {
  const incoming = input.ticket as PurchaseTicket | null;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming))
    reject(422, 'INVALID_TICKET', 'Pedido inválido.');
  const items = normalizeItems(incoming.itens, original);
  const totalProducts = items.reduce((sum, row) => sum + cash(row.total), 0);
  const discount = cash(Number(incoming.descontoCompra || 0));
  const freight = cash(Number(incoming.freteCompra || 0));
  if (discount < 0 || freight < 0) reject(422, 'INVALID_AMOUNT', 'Desconto ou frete inválido.');
  const previousProducts = (original.itens ?? []).reduce(
    (sum, row) =>
      sum +
      cash(Number(row?.total ?? Number(row?.pesoLiq || row?.quantidade || 0) * Number(row?.preco || 0))),
    0,
  );
  const oldDiscount = cash(Number(original.descontoCompra ?? original.pedidoCompra?.desconto ?? 0));
  const oldFreight = cash(Number(original.freteCompra ?? original.pedidoCompra?.frete ?? 0));
  const legacyExtra = cash(Number(original.totalGeral || 0)) - previousProducts + oldDiscount - oldFreight;
  const total = totalProducts - discount + freight + legacyExtra;
  if (total < 0 || total > 1e11 || Math.abs(total - cash(Number(incoming.totalGeral))) > 1) {
    reject(422, 'TOTAL_MISMATCH', 'Total da compra divergente dos itens.');
  }
  const order = String(incoming.ordemCompra || '')
    .trim()
    .slice(0, 120);
  const date = String(incoming.dataCompra || '').trim();
  const due = String(incoming.vencimentoSaldo || '').trim();
  if (!ISO_DATE.test(date) || !ISO_DATE.test(due)) reject(422, 'INVALID_DATE', 'Data inválida.');
  const notes = String(incoming.observacoesPedido || '')
    .trim()
    .slice(0, 5000);
  const oldTotal = cash(Number(original.totalGeral || 0));
  const oldBalance = cash(Number(original.saldoPagar || 0));
  const balance = oldBalance + total - oldTotal;
  const next: PurchaseTicket = {
    ...clone(original),
    itens: items,
    totalProdutos: round(totalProducts),
    totalGeral: round(total),
    totalKg: items.reduce((sum, row) => sum + Number(row.pesoLiq || 0), 0),
    descontoCompra: round(discount),
    freteCompra: round(freight),
    ordemCompra: order,
    dataCompra: date,
    vencimentoSaldo: due,
    observacoesPedido: notes,
    saldoPagar: round(balance),
    status: balance > 0 ? 'Pendente' : 'Pago',
  };
  next.pedidoCompra = {
    ...(original.pedidoCompra ?? {}),
    numero: original.ticket || '',
    ordemCompra: order,
    dataCompra: date,
    vencimentoSaldo: due,
    observacoes: notes,
    desconto: round(discount),
    frete: round(freight),
    totalProdutos: round(totalProducts),
    totalPedido: round(total),
  };
  return { ticket: next, oldTotal, total, balance, difference: total - oldTotal };
}

function trustedLegacyReceipt(
  original: PurchaseTicket,
  raw: unknown,
  ticketNo: string,
): FinancialReceipt | null {
  const oldTotal = cash(Number(original.totalGeral || 0));
  const originalAdvance = cash(Number(original.adiantamento || 0));
  const originalCredit = -cash(Number(original.saldoPagar || 0));
  if (oldTotal <= 0 || originalCredit <= 0 || originalAdvance !== oldTotal + originalCredit) return null;
  const candidates = rowEntries<LedgerRecord>(readRows(raw)).filter(([, row]) => {
    if (
      !row.cod ||
      row.status !== 'Pendente' ||
      String(row.forma || '')
        .toLowerCase()
        .includes('cheque')
    )
      return false;
    if (row.ticket && String(row.ticket) !== ticketNo) return false;
    const remaining = cash(Number(row.valor || 0));
    const already = cash(Number(row.valorCompensado || 0));
    const originalValue = cash(Number(row.valorOriginal ?? (remaining + already) / 100));
    return remaining === originalCredit && already === oldTotal && originalValue === originalAdvance;
  });
  const source = candidates.length === 1 ? candidates[0]?.[1] : undefined;
  if (!source) return null;
  return {
    versao: 1,
    total: round(originalAdvance),
    adiantamentos: [
      {
        cod: String(source.cod),
        data: String(source.data || ''),
        forma: String(source.forma || ''),
        bancoNome: String(source.bancoNome || ''),
        valorOriginal: round(originalAdvance),
        valorAplicado: round(oldTotal),
        valorPendente: round(originalCredit),
      },
    ],
    cheques: [],
  };
}

export function adjustReceipt(
  original: PurchaseTicket,
  next: PurchaseTicket,
  total: number,
  ledger: unknown,
  ticketNo: string,
): AdvanceChange[] {
  const existing = clone((original.reciboFinanceiro ?? {}) as FinancialReceipt);
  if ((existing.cheques ?? []).some((row) => cash(Number(row.valorAplicado || 0)) > 0)) {
    reject(
      409,
      'CHEQUE_RECONCILIATION_REQUIRED',
      'Esta compra possui cheques aplicados. A alteração exige conciliação específica.',
    );
  }
  const source =
    Array.isArray(existing.adiantamentos) && existing.adiantamentos.length
      ? existing
      : trustedLegacyReceipt(original, ledger, ticketNo);
  if (!source) {
    reject(
      409,
      'ADVANCE_RECONCILIATION_REQUIRED',
      'O adiantamento deste pedido antigo não possui vínculo financeiro único. Não foi alterado.',
    );
  }
  const advances: AdvanceReceiptRow[] = source.adiantamentos ?? [];
  const oldApplied = advances.reduce((sum, row) => sum + cash(Number(row.valorAplicado || 0)), 0);
  if (Math.abs(oldApplied - cash(Number(original.totalGeral || 0))) > 1) {
    reject(
      409,
      'ADVANCE_RECEIPT_MISMATCH',
      'O recibo possui abatimentos diferentes do total original. Confira as baixas antes de editar.',
    );
  }
  let remaining = total;
  const changes: AdvanceChange[] = [];
  for (const row of advances) {
    const originalCash = cash(Number(row.valorOriginal || 0));
    const appliedBefore = cash(Number(row.valorAplicado || 0));
    if (!row.cod || originalCash < appliedBefore)
      reject(409, 'ADVANCE_RECEIPT_INVALID', 'O recibo de adiantamento está incompleto.');
    const applied = Math.min(originalCash, remaining);
    remaining -= applied;
    row.valorAplicado = round(applied);
    row.valorPendente = round(originalCash - applied);
    changes.push({ code: String(row.cod), original: originalCash, before: appliedBefore, after: applied });
  }
  if (remaining > 0)
    reject(
      409,
      'ADVANCE_INSUFFICIENT',
      'O novo total excede o adiantamento disponível. A conciliação exige uma conta a pagar.',
    );
  source.adiantamentos = advances;
  next.reciboFinanceiro = source;
  return changes;
}

export function adjustLedger(raw: unknown, changes: AdvanceChange[], ticketNo: string): Row | Row[] {
  const records = readRows(raw);
  const entries = rowEntries<LedgerRecord>(records);
  for (const change of changes) {
    if (change.before === change.after) continue;
    const match = entries.find(
      ([, record]) => String(record.cod || '') === change.code && record.status === 'Pendente',
    );
    if (!match)
      reject(
        409,
        'ADVANCE_NOT_PENDING',
        'O adiantamento original não está disponível para conciliar a edição.',
      );
    const record = match[1];
    const original = cash(Number(record.valorOriginal ?? record.valor));
    const consumed = cash(Number(record.valorCompensado || 0));
    const remaining = cash(Number(record.valor || 0));
    if (original !== change.original || consumed !== change.before || original - consumed !== remaining) {
      reject(
        409,
        'ADVANCE_CHANGED',
        'O adiantamento mudou desde a compra. Atualize e concilie antes de editar.',
      );
    }
    record.valorCompensado = round(change.after);
    record.valor = round(original - change.after);
    const partials = entries.filter(
      ([, candidate]) =>
        candidate.status === 'Quitado' &&
        String(candidate.ticket || '') === ticketNo &&
        (String(candidate.adiantamentoOrigem || '') === change.code ||
          String(candidate.obs || '').includes('Quitação parcial de ' + change.code)),
    );
    if (partials.length > 1)
      reject(409, 'ADVANCE_DUPLICATE_PARTIAL', 'Existe mais de uma compensação parcial vinculada.');
    const partial = partials[0];
    if (partial) partial[1].valor = round(change.after);
  }
  return records;
}

export function adjustPayable(
  raw: unknown,
  ticketNo: string,
  oldBalance: number,
  nextBalance: number,
  operationId: string,
  supplierCode: string,
  original: PurchaseTicket,
): PayableUpdate {
  const entriesAll = rowEntries<PayableRow>(raw);
  const active = entriesAll.filter(
    ([, row]) => String(row.ticket || '') === ticketNo && row.status !== 'Pago',
  );
  if (active.length > 1) reject(409, 'PAYABLE_DUPLICATE', 'Há mais de uma conta em aberto para este pedido.');
  const current = active[0];
  if (current) {
    const [path, row] = current;
    if (row.status !== 'Pendente' || cash(Number(row.valor || 0)) !== oldBalance) {
      reject(409, 'PAYABLE_CHANGED', 'O saldo da conta foi alterado. Atualize o pedido antes de editar.');
    }
    if (nextBalance < 0)
      reject(409, 'PAYABLE_RECONCILIATION_REQUIRED', 'A alteração geraria crédito a restituir.');
    const updated: PayableRow = {
      ...row,
      valor: round(nextBalance),
      status: nextBalance === 0 ? 'Pago' : 'Pendente',
    };
    if (nextBalance === 0) {
      const historical = cash(Number(row.valorPago || 0)) + cash(Number(row.adtCompensado || 0));
      updated.valor = round(historical > 0 ? historical : 0);
      updated.dataPgto = String(row.dataPgto || businessTodayISO());
    }
    return { path, updated };
  }
  if (oldBalance !== 0 || nextBalance <= 0) {
    reject(409, 'PAYABLE_CHANGED', 'O saldo do pedido não corresponde às contas financeiras disponíveis.');
  }
  const id = 'CP-AJUSTE-' + ticketNo + '-' + operationId.slice(0, 8);
  if (entriesAll.some(([, row]) => String(row.id || '') === id))
    reject(409, 'PAYABLE_CHANGED', 'Ajuste já registrado. Atualize o histórico.');
  const taken = new Set(entriesAll.map(([path]) => path));
  const path = Array.isArray(raw) ? String(raw.length) : id;
  if (taken.has(path))
    reject(409, 'PAYABLE_CHANGED', 'Não foi possível reservar um registro financeiro único.');
  const date = String(original.dataCompra || original.data || '').replace(
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    '$3-$2-$1',
  );
  const due = String(original.vencimentoSaldo || date);
  return {
    path,
    updated: {
      id,
      ticket: ticketNo,
      fornCod: supplierCode,
      cred: String(original.fornecedor || ''),
      cat: 'Compra de Sucata',
      tipoForn: 'compra',
      desc: 'Diferença após correção do pedido ' + ticketNo,
      lancto: date,
      venc: due,
      valor: round(nextBalance),
      status: 'Pendente',
      dataPgto: '',
      bancoCod: '',
      bancoNome: '',
      pagamentos: [],
      obs: 'Ajuste confirmado após pagamento anterior',
    },
  };
}

export function adjustmentOfCredit(
  raw: unknown,
  before: number,
  after: number,
  ticketNo: string,
): Row | null {
  if (raw == null) return null;
  const record: Row =
    typeof raw === 'object' && !Array.isArray(raw) ? clone(raw as Row) : { valor: Number(raw) };
  if (record.ticket && String(record.ticket) !== ticketNo) {
    reject(409, 'CREDIT_CHANGED', 'O crédito do fornecedor foi utilizado em outra compra.');
  }
  if (Math.abs(cash(Number(record.valor || 0)) - before) > 1)
    reject(409, 'CREDIT_CHANGED', 'O saldo credor já foi alterado.');
  return { ...record, valor: round(after), ticket: ticketNo };
}

export function untouchedPayable(row: PayableRow): boolean {
  if (String(row.status || '') !== 'Pendente') return false;
  if (cash(Number(row.valorPago || 0)) > 0 || cash(Number(row.adtCompensado || 0)) > 0) return false;
  if (Array.isArray(row.pagamentos) && row.pagamentos.length > 0) return false;
  return !row.dataPgto && !row.movBancoIdCP && !row.bancoCod;
}

export function currentPlan(ticket: PurchaseTicket): unknown[] {
  if (Array.isArray(ticket.parcelas) && ticket.parcelas.length) return ticket.parcelas;
  const balance = cash(Number(ticket.saldoPagar || 0));
  return balance > 0
    ? [{ vencimento: String(ticket.vencimentoSaldo || ''), valor: round(balance), forma: '', obs: '' }]
    : [];
}

export function purchasePayables(
  raw: unknown,
  ticketNo: string,
  previous: PurchaseTicket,
): { expected: Set<string>; rows: [string, PayableRow][] } {
  const count =
    Array.isArray(previous.parcelas) && previous.parcelas.length > 1 ? previous.parcelas.length : 1;
  const expected = new Set(installmentPayableIds(ticketNo, count));
  const rows = rowEntries<PayableRow>(raw).filter(
    ([path, row]) =>
      String(row.ticket || '') === ticketNo || expected.has(path) || expected.has(String(row.id || '')),
  );
  return { expected, rows };
}

export interface Replan {
  updates: Row;
  payables: Row[];
  removed: string[];
}

export function replanPayables(input: {
  raw: unknown;
  ticketNo: string;
  previous: PurchaseTicket;
  next: PurchaseTicket;
  installments: Installment[];
  supplierCode: string;
  oldBalance: number;
  at: number;
}): Replan {
  const { expected, rows } = purchasePayables(input.raw, input.ticketNo, input.previous);
  if (rows.some(([path, row]) => !expected.has(path) || String(row.id || '') !== path)) {
    reject(
      409,
      'LEGACY_PAYABLE_REVIEW',
      'As contas a pagar deste pedido precisam de revisão no financeiro antes de mudar as parcelas.',
    );
  }
  if (rows.some(([, row]) => !untouchedPayable(row))) {
    reject(
      409,
      'INSTALLMENTS_HAVE_PAYMENTS',
      'Já existe parcela paga desta compra. Para mudar valores ou parcelas, estorne o pagamento em Contas a Pagar.',
    );
  }
  if (
    rows.length !== expected.size ||
    rows.reduce((sum, [, row]) => sum + cash(Number(row.valor || 0)), 0) !== input.oldBalance
  ) {
    reject(
      409,
      'PAYABLE_CHANGED',
      'As parcelas em Contas a Pagar não conferem com o saldo do pedido. Atualize a tela.',
    );
  }
  const payables = input.installments.length
    ? installmentPayables({
        ticketNo: input.ticketNo,
        supplierCode: input.supplierCode,
        supplierName: String(input.next.fornecedor || input.next.fornecedorNome || ''),
        descriptionName: String(input.next.fornecedor || ''),
        purchaseDate: String(input.next.dataCompra || ''),
        installments: input.installments,
      })
    : [];
  const kept = new Set(payables.map((row) => row.id));
  const removed = rows.map(([path]) => path).filter((path) => !kept.has(path));
  const updates: Row = {};
  for (const path of removed) updates['contasPagar/' + path] = null;
  const created = payables.map((row) => ({ ...row, _upd: input.at }));
  for (const row of created) updates['contasPagar/' + row.id] = row;
  return { updates, payables: created, removed };
}

export interface OpenInstallmentShift {
  updates: Row;
  plan: unknown[];
  path: string;
}

const installmentNumber = (path: string): number => Number(/-(\d{1,2})$/.exec(path)?.[1] ?? 0);
const brl = (cents: number): string =>
  'R$ ' + (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function shiftOpenInstallment(input: {
  raw: unknown;
  ticketNo: string;
  previous: PurchaseTicket;
  oldBalance: number;
  nextBalance: number;
  at: number;
}): OpenInstallmentShift {
  const { expected, rows } = purchasePayables(input.raw, input.ticketNo, input.previous);
  if (rows.some(([path, row]) => !expected.has(path) || String(row.id || '') !== path)) {
    reject(
      409,
      'LEGACY_PAYABLE_REVIEW',
      'As contas a pagar deste pedido precisam de revisão no financeiro antes de mudar o valor.',
    );
  }
  const open = rows
    .filter(([, row]) => String(row.status || '') === 'Pendente' && cash(Number(row.valor || 0)) > 0)
    .sort(([a], [b]) => installmentNumber(a) - installmentNumber(b));
  const openTotal = open.reduce((sum, [, row]) => sum + cash(Number(row.valor || 0)), 0);
  const target = open.at(-1);
  if (!target || openTotal !== input.oldBalance) {
    reject(
      409,
      'PAYABLE_CHANGED',
      'As parcelas em Contas a Pagar não conferem com o saldo do pedido. Atualize a tela.',
    );
  }
  const [path, row] = target;
  const delta = input.nextBalance - input.oldBalance;
  const current = cash(Number(row.valor || 0));
  const nextValue = current + delta;
  if (nextValue <= 0) {
    reject(
      409,
      'INSTALLMENT_ADJUST_EXCEEDS_OPEN',
      `A redução de ${brl(-delta)} é maior que a última parcela em aberto (${brl(current)}). ` +
        'Ajuste em Contas a Pagar ou estorne um pagamento antes de editar.',
    );
  }
  const plan = Array.isArray(input.previous.parcelas) ? clone(input.previous.parcelas as unknown[]) : [];
  const entry = plan[installmentNumber(path) - 1];
  if (entry && typeof entry === 'object') {
    const planned = entry as Row;
    planned.valor = round(cash(Number(planned.valor || 0)) + delta);
  }
  return {
    updates: { ['contasPagar/' + path]: { ...row, valor: round(nextValue), _upd: input.at } },
    plan,
    path,
  };
}

export function applyPlan(ticket: PurchaseTicket, installments: Installment[]): void {
  const first = installments[0];
  if (first) {
    ticket.parcelas = installments;
    ticket.vencimentoSaldo = first.vencimento;
    if (ticket.pedidoCompra) ticket.pedidoCompra.vencimentoSaldo = first.vencimento;
  } else {
    delete ticket.parcelas;
  }
}

export function assertSupplierChangeAllowed(
  previous: PurchaseTicket,
  payablesRaw: unknown,
  ticketNo: string,
): void {
  const receipt = (previous.reciboFinanceiro ?? {}) as FinancialReceipt;
  const linked =
    cash(Number(previous.adiantamento || 0)) > 0 ||
    cash(Number(receipt.total || 0)) > 0 ||
    Boolean(receipt.adiantamentos?.length) ||
    Boolean(receipt.cheques?.length) ||
    Boolean(receipt.creditos?.length) ||
    cash(Number(previous.creditoFornecedorAplicado || 0)) > 0 ||
    previous._pagoUndo != null;
  if (linked) {
    reject(
      409,
      'SUPPLIER_CHANGE_BLOCKED',
      'Esta compra usou adiantamento, cheque ou crédito do fornecedor atual, então o fornecedor não pode ser trocado na edição. Exclua o pedido (o valor volta para o adiantamento) e lance de novo no fornecedor certo.',
    );
  }
  if (purchasePayables(payablesRaw, ticketNo, previous).rows.some(([, row]) => !untouchedPayable(row))) {
    reject(
      409,
      'SUPPLIER_CHANGE_BLOCKED',
      'Esta compra já tem pagamento registrado em Contas a Pagar. Para trocar o fornecedor, estorne o pagamento antes.',
    );
  }
}

export function applySupplier(ticket: PurchaseTicket, code: string, name: string): void {
  ticket.fornecedorCod = code;
  ticket.fornecedor = name;
  ticket.fornecedorNome = name;
  if (ticket.fornCod != null) ticket.fornCod = code;
  if (ticket.forn != null) ticket.forn = name;
  if (ticket.pedidoCompra) {
    ticket.pedidoCompra.fornecedor = name;
    ticket.pedidoCompra.fornecedorCod = code;
  }
}
