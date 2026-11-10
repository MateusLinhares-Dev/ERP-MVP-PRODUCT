import { randomUUID } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { AppError, fail } from '../../../shared/errors/app-error.js';
import { acquireLease, releaseLeases, type LeaseEntry } from '../../../shared/firebase/rtdb-transaction.js';
import { installmentPayableIds, installmentPayables, normalizeInstallments } from '../domain/installments.js';
import type { PurchaseTicket, Row } from '../domain/purchase-records.js';

export interface CreatePurchaseInput {
  ticketNo?: unknown;
  fornecedorCod?: unknown;
  operationId?: unknown;
  ticket?: unknown;
  advanceCodes?: unknown[];
  chequeIds?: unknown[];
  useLegacyCredit?: unknown;
  sourceTicketKeys?: unknown[];
}

export interface PurchaseDeps {
  db?: Database;
  now?: () => number;
  uuid?: () => string;
}

interface LegacyCredit {
  source: string;
  balance: number;
}

function id(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!/^[\w-]{1,80}$/.test(text)) fail(422, 'INVALID_ID', 'Identificador inválido.');
  return text;
}

function cents(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1e9 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-5
  ) {
    fail(422, 'INVALID_AMOUNT', 'Valor financeiro inválido.');
  }
  return Math.round(value * 100);
}

const money = (value: number): number => Math.round(value) / 100;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const rows = (value: unknown): Row | Row[] =>
  Array.isArray(value)
    ? clone(value as Row[])
    : value && typeof value === 'object'
      ? clone(value as Row)
      : [];
const entries = (value: unknown): [string, Row][] =>
  Object.entries(value && typeof value === 'object' ? (value as Row) : {}).filter(
    (entry): entry is [string, Row] =>
      Boolean(entry[1]) && typeof entry[1] === 'object' && !Array.isArray(entry[1]),
  );

function date(value: unknown): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) fail(422, 'INVALID_DATE', 'Data inválida.');
  return String(value);
}

function operationKey(identity: Identity, operationId: string): string {
  return (
    id(String(identity.uid || identity.erpUser || 'operador').replace(/[^\w-]/g, '_')) + '_' + id(operationId)
  );
}

function findAdvance(list: unknown, code: string): Row {
  const matches = entries(list).filter(([, advance]) => String(advance.cod || '') === code);
  const match = matches.length === 1 ? matches[0] : undefined;
  if (!match) fail(409, 'ADVANCE_CHANGED', 'Adiantamento inexistente ou duplicado. Atualize o formulário.');
  return match[1];
}

function verifyLegacyCredit(
  raw: unknown,
  tickets: Record<string, PurchaseTicket>,
  advances: unknown,
  code: string,
): LegacyCredit {
  const credit = raw as { ticket?: unknown; valor?: unknown } | null;
  if (!credit || typeof credit !== 'object' || !credit.ticket) {
    fail(409, 'CREDIT_UNVERIFIED', 'O crédito anterior não tem origem verificável. Solicite conciliação.');
  }
  const origin = id(credit.ticket);
  const source = tickets[origin];
  if (
    !source ||
    String(source.fornecedorCod || source.fornCod || '') !== code ||
    !['Pago', 'Quitado'].includes(String(source.status || ''))
  ) {
    fail(409, 'CREDIT_UNVERIFIED', 'A compra de origem do crédito não está comprovada.');
  }
  const total = cents(Number(source.totalGeral));
  const gross = cents(Number(source.adiantamento));
  if (gross <= total) fail(409, 'CREDIT_UNVERIFIED', 'A compra de origem não comprova o crédito residual.');
  const matching = entries(advances).filter(
    ([, advance]) =>
      advance.status === 'Quitado' &&
      String(advance.ticket || '') === origin &&
      !String(advance.forma || '')
        .toLowerCase()
        .includes('cheque'),
  );
  if (matching.length !== 1 || cents(Number(matching[0]?.[1].valor)) !== gross) {
    fail(409, 'CREDIT_UNVERIFIED', 'O adiantamento de origem não possui vínculo financeiro único.');
  }
  let spent = 0;
  for (const ticket of Object.values(tickets)) {
    if (
      !ticket ||
      typeof ticket !== 'object' ||
      String(ticket.fornecedorCod || ticket.fornCod || '') !== code
    )
      continue;
    if (String(ticket.creditoFornecedorOrigem || '') === origin)
      spent += cents(Number(ticket.creditoFornecedorAplicado || 0));
  }
  const balance = cents(Number(credit.valor));
  if (balance <= 0 || gross - total - spent !== balance) {
    fail(409, 'CREDIT_CHANGED', 'O saldo residual não coincide com as compras e abatimentos confirmados.');
  }
  return { source: origin, balance };
}

function normalizeTicket(
  input: CreatePurchaseInput,
  ticketNo: string,
  code: string,
): { ticket: PurchaseTicket; total: number } {
  const ticket = input.ticket as PurchaseTicket | null;
  if (
    !ticket ||
    typeof ticket !== 'object' ||
    Array.isArray(ticket) ||
    String(ticket.ticket || '') !== ticketNo ||
    String(ticket.fornecedorCod || '') !== code
  ) {
    fail(422, 'INVALID_TICKET', 'Pedido ou fornecedor divergente.');
  }
  const items = ticket.itens;
  if (!Array.isArray(items) || !items.length || items.length > 200)
    fail(422, 'INVALID_ITEMS', 'Informe materiais válidos.');
  const products = items.reduce((sum: number, item: Row | null) => {
    if (!item || !String(item.mat || '').trim()) fail(422, 'INVALID_ITEMS', 'Material inválido.');
    const quantity = Number(item.pesoLiq ?? item.quantidade);
    const price = Number(item.preco);
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 1e7 ||
      !Number.isFinite(price) ||
      price < 0 ||
      price > 1e7
    ) {
      fail(422, 'INVALID_ITEMS', 'Quantidade ou preço inválidos.');
    }
    return sum + Math.round(quantity * price * 100);
  }, 0);
  const discount = cents(Number(ticket.descontoCompra || 0));
  const freight = cents(Number(ticket.freteCompra || 0));
  const rawExtra = Number(ticket.acrescimo || 0);
  const extra = rawExtra < 0 ? -cents(-rawExtra) : cents(rawExtra);
  const total = products - discount + freight + extra;
  if (total <= 0 || Math.abs(total - cents(Number(ticket.totalGeral))) > 1) {
    fail(422, 'TOTAL_MISMATCH', 'Valor da compra não corresponde aos materiais.');
  }
  const next = clone(ticket);
  next.ticket = ticketNo;
  next.numeroPedido = ticketNo;
  next.fornecedorCod = code;
  next.totalProdutos = money(products);
  next.totalGeral = money(total);
  next.dataCompra = date(next.dataCompra || next.data);
  next.vencimentoSaldo = date(next.vencimentoSaldo || next.dataCompra);
  next._consolidado = true;
  return { ticket: next, total };
}

function idList(value: unknown[] | undefined): string[] {
  return [...(Array.isArray(value) ? value : [])].map(id);
}

export async function createPurchaseOrder(
  identity: Identity,
  input: CreatePurchaseInput,
  { db: injected, now = () => Date.now(), uuid = randomUUID }: PurchaseDeps = {},
) {
  if (identity.erpAccess !== true || identity.canPurchasing !== true)
    fail(403, 'PURCHASE_FORBIDDEN', 'Sem permissão de Compras.');
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(400, 'INVALID_INPUT', 'Requisição inválida.');
  const ticketNo = id(input.ticketNo);
  const code = id(input.fornecedorCod);
  const operationId = id(input.operationId);
  if (!/^[a-f\d-]{36}$/i.test(operationId))
    fail(422, 'INVALID_OPERATION', 'Identificador da operação inválido.');
  const selected = idList(input.advanceCodes);
  const selectedCheques = idList(input.chequeIds);
  if (
    selected.length > 100 ||
    selectedCheques.length > 100 ||
    new Set(selected).size !== selected.length ||
    new Set(selectedCheques).size !== selectedCheques.length
  ) {
    fail(422, 'INVALID_SELECTION', 'Seleção financeira inválida.');
  }
  const credit = Boolean(input.useLegacyCredit);
  if (credit && (selected.length || selectedCheques.length)) {
    fail(
      422,
      'MIXED_CREDITS',
      'Para consumir o saldo residual, não selecione outros adiantamentos ou cheques na mesma compra.',
    );
  }
  const sources = idList(input.sourceTicketKeys);
  if (sources.length > 50 || new Set(sources).size !== sources.length || sources.includes(ticketNo)) {
    fail(422, 'INVALID_SOURCE', 'Pesagem inválida.');
  }
  const { ticket: incoming, total } = normalizeTicket(input, ticketNo, code);
  const db = injected ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
  const opKey = operationKey(identity, operationId);
  const opRef = db.ref('erp/purchaseCreateOperations/' + opKey);
  const sameOperation = (value: unknown): Row | null => {
    const record = value as { ticket?: PurchaseTicket } | null;
    if (!record?.ticket) return null;
    if (
      record.ticket.ticket !== ticketNo ||
      Math.abs(Number(record.ticket.totalGeral || 0) - Number(incoming.totalGeral || 0)) > 0.01
    ) {
      fail(409, 'OPERATION_REUSED', 'Operação já utilizada com outro conteúdo.');
    }
    return { ...record, alreadyCommitted: true };
  };
  const previous = sameOperation((await opRef.get()).val());
  if (previous) return previous;
  const owner = uuid();
  const held: (LeaseEntry & { path: string })[] = [];
  const lockKeys = ['erpFinancePayableTicketLocks/' + ticketNo];
  if (selected.length || selectedCheques.length || credit) lockKeys.push('erpFinanceAdvanceLocks/' + code);
  let committed = false;
  try {
    for (const lockPath of lockKeys) {
      const ref = db.ref(lockPath);
      const acquired = await acquireLease(ref, owner, {
        now,
        ttlMs: 120000,
        meta: { kind: 'purchase-create', operationKey: opKey },
      });
      if (!acquired) {
        const live = (await ref.get()).val() as { expiresAt?: unknown } | null;
        const seconds = Math.ceil((Number(live?.expiresAt) - now()) / 1000);
        throw new AppError(
          409,
          'PURCHASE_IN_PROGRESS',
          'Outra operação desta compra ou deste fornecedor está em andamento. Aguarde alguns segundos e tente novamente.',
          Number.isFinite(seconds) && seconds > 0 ? { retryAfterSeconds: Math.min(seconds, 120) } : {},
        );
      }
      held.push({ ref, path: lockPath });
    }

    const repeated = sameOperation((await opRef.get()).val());
    if (repeated) return repeated;
    const [existingSnap, deletedSnap, advancesSnap, creditSnap, mirrorSnap, chequesSnap, ...sourceSnaps] =
      await Promise.all([
        db.ref('erp/tickets/' + ticketNo).get(),
        db.ref('erp/ticketsDeletedV2/' + ticketNo).get(),
        db.ref('erp/adiantamentos/' + code).get(),
        db.ref('erp/saldoDevedor/' + code).get(),
        credit ? db.ref('erp/saldos/' + code).get() : Promise.resolve(null),
        db.ref('erp/cheques/' + code).get(),
        ...sources.map((sourceId) => db.ref('erp/tickets/' + sourceId).get()),
      ]);
    if (existingSnap.val() || deletedSnap.val())
      fail(409, 'TICKET_EXISTS', 'Número da compra já utilizado. Atualize o histórico.');
    const sourceTickets: Record<string, PurchaseTicket> = {};
    sources.forEach((sourceId, index) => {
      const row = sourceSnaps[index]?.val() as PurchaseTicket | null;
      if (
        !row ||
        String(row.fornecedorCod || row.fornCod || '') !== code ||
        row._consolidadoEm ||
        row._balFinalizado !== true ||
        String(row.status || '') !== 'Aguard. Preço'
      ) {
        fail(409, 'SOURCE_CHANGED', 'Pesagem já finalizada ou alterada por outro usuário.');
      }
      sourceTickets[sourceId] = row;
    });
    const advanceRows = rows(advancesSnap.val());
    const chequeRows = rows(chequesSnap.val());
    const updates: Row = {};
    const receipts: Row[] = [];
    const chequeReceipts: Row[] = [];
    let remaining = total;
    let legacy: LegacyCredit | null = null;
    let usedCredit = 0;
    if (credit) {
      const allTickets = ((await db.ref('erp/tickets').get()).val() ?? {}) as Record<string, PurchaseTicket>;
      legacy = verifyLegacyCredit(creditSnap.val(), allTickets, advanceRows, code);
      usedCredit = Math.min(legacy.balance, remaining);
      remaining -= usedCredit;
      const rest = legacy.balance - usedCredit;
      updates['erp/saldoDevedor/' + code] =
        rest > 0 ? { ...(clone(creditSnap.val()) as Row), valor: money(rest) } : null;
      const mirror: unknown = mirrorSnap?.val();
      if (mirror != null) {
        updates['erp/saldos/' + code] =
          rest > 0
            ? {
                ...(typeof mirror === 'object' ? (clone(mirror) as Row) : {}),
                valor: money(rest),
                ticket: legacy.source,
              }
            : null;
      }
    }
    const linkedPurchases = new Map<string, PurchaseTicket | null>();
    for (const advanceCode of selected) {
      const advance = findAdvance(advanceRows, advanceCode);
      if (String(advance.status || '') !== 'Pendente') {
        fail(
          409,
          'ADVANCE_CHANGED',
          'Este adiantamento já foi utilizado ou alterado. Atualize a tela de compra.',
        );
      }
      const linked = String(advance.ticketOrigem || advance.ticket || '');
      if (linked && linked !== ticketNo && !sources.includes(linked)) {
        if (!linkedPurchases.has(linked)) {
          const purchase = /^[\w-]{1,80}$/.test(linked)
            ? ((await db.ref('erp/tickets/' + linked).get()).val() as PurchaseTicket | null)
            : null;
          linkedPurchases.set(linked, purchase);
        }
        const originalPurchase = linkedPurchases.get(linked);
        const alreadyPartiallyUsed =
          cents(Number(advance.valorCompensado || 0)) > 0 &&
          Boolean(originalPurchase) &&
          ['Pago', 'Quitado'].includes(String(originalPurchase?.status || ''));
        if (!alreadyPartiallyUsed) {
          fail(
            409,
            'ADVANCE_LINKED',
            'O adiantamento ' + advanceCode + ' está reservado a outra compra (' + linked + ').',
          );
        }
      }
      const available = cents(Number(advance.valor));
      const prior = cents(Number(advance.valorCompensado || 0));
      const original = cents(Number(advance.valorOriginal ?? money(available + prior)));
      if (available <= 0 || original !== available + prior) {
        fail(
          409,
          'ADVANCE_CHANGED',
          'Saldo do adiantamento ' + advanceCode + ' inconsistente. Solicite conferência financeira.',
        );
      }
      const applied = Math.min(available, remaining);
      if (applied === 0) continue;
      remaining -= applied;
      advance.valorOriginal = money(original);
      advance.valorCompensado = money(prior + applied);
      const balance = original - prior - applied;
      advance.valor = money(balance > 0 ? balance : original);
      advance.valorDisponivel = money(balance);
      advance.status = balance === 0 ? 'Quitado' : 'Pendente';
      if (advance.status === 'Quitado') advance.ticket = ticketNo;
      receipts.push({
        cod: advanceCode,
        valorOriginal: money(original),
        valorAplicado: money(applied),
        valorPendente: money(original - prior - applied),
        data: advance.data || '',
        forma: advance.forma || '',
        bancoNome: advance.bancoNome || '',
      });
    }
    for (const chequeId of selectedCheques) {
      const matches = entries(chequeRows).filter(
        ([, cheque]) => String(cheque.id || cheque.num || cheque.numero || '') === chequeId,
      );
      const cheque = matches.length === 1 ? matches[0]?.[1] : undefined;
      if (!cheque || cheque.status !== 'Pendente' || cheque._aplicadoTicket)
        fail(409, 'CHEQUE_CHANGED', 'Cheque não está mais disponível.');
      const value = cents(Number(cheque.valor));
      if (value > remaining)
        fail(
          409,
          'CHEQUE_PARTIAL_UNSUPPORTED',
          'Cheque não pode ser parcialmente aplicado; ajuste a seleção.',
        );
      remaining -= value;
      cheque.status = 'Quitado';
      cheque._aplicadoTicket = ticketNo;
      cheque.vinculo = cheque.vinculo || ticketNo;
      chequeReceipts.push({
        id: cheque.id || '',
        num: cheque.num || cheque.numero || '',
        valorOriginal: money(value),
        valorAplicado: money(value),
        valorPendente: 0,
      });
    }
    const applied = total - remaining;
    incoming.adiantamento = money(applied);
    incoming.saldoAnterior = 0;
    incoming.saldoPagar = money(remaining);
    incoming.status = remaining === 0 ? 'Pago' : 'Pendente';
    const installments = normalizeInstallments((input.ticket as PurchaseTicket).parcelas, {
      balanceCents: remaining,
      purchaseDate: String(incoming.dataCompra),
      defaultDueDate: String(incoming.vencimentoSaldo),
    });
    if (installments[0]) {
      incoming.parcelas = installments;
      incoming.vencimentoSaldo = installments[0].vencimento;
    } else {
      delete incoming.parcelas;
    }
    incoming.reciboFinanceiro = {
      versao: 2,
      total: money(applied),
      adiantamentos: receipts,
      cheques: chequeReceipts,
      ...(credit && legacy
        ? { creditos: [{ ticketOrigem: legacy.source, valorAplicado: money(usedCredit) }] }
        : {}),
    };
    if (credit && legacy) {
      incoming.creditoFornecedorOrigem = legacy.source;
      incoming.creditoFornecedorAplicado = money(usedCredit);
    } else {
      delete incoming.creditoFornecedorOrigem;
      delete incoming.creditoFornecedorAplicado;
    }
    updates['erp/tickets/' + ticketNo] = incoming;
    if (receipts.length) updates['erp/adiantamentos/' + code] = advanceRows;
    if (chequeReceipts.length) updates['erp/cheques/' + code] = chequeRows;
    for (const sourceId of sources) {
      updates['erp/tickets/' + sourceId] = {
        ...sourceTickets[sourceId],
        _balFinalizado: false,
        status: 'Consolidado',
        _consolidadoEm: ticketNo,
      };
    }
    const payableIds = installmentPayableIds(ticketNo, installments.length);
    const existingPayables = installments.length
      ? await Promise.all(payableIds.map((payableId) => db.ref('erp/contasPagar/' + payableId).get()))
      : [];
    if (existingPayables.some((snap) => snap.val()))
      fail(409, 'PAYABLE_EXISTS', 'Conta a pagar já existe para este ticket.');
    const payables = installmentPayables({
      ticketNo,
      supplierCode: code,
      supplierName: String(incoming.fornecedor || incoming.fornecedorNome || ''),
      descriptionName: String(incoming.fornecedor || ''),
      purchaseDate: String(incoming.dataCompra),
      installments,
    });
    for (const row of payables) updates['erp/contasPagar/' + row.id] = row;
    const receipt = {
      ticket: incoming,
      advances: advanceRows,
      cheques: chequeRows,
      saldo: credit ? updates['erp/saldoDevedor/' + code] : creditSnap.val(),
      payable: payables[0] ?? null,
      payables,
      fornCod: code,
      at: now(),
      actor: String(identity.erpUser || identity.uid || ''),
    };
    updates['erp/purchaseCreateOperations/' + opKey] = receipt;
    updates['erp/_ts'] = now();
    for (const lock of held) {
      const live = (await lock.ref.get()).val() as { owner?: string } | null;
      if (live?.owner !== owner)
        fail(409, 'PURCHASE_CHANGED', 'A compra mudou durante a gravação. Consulte o Histórico.');
      updates[lock.path] = null;
    }
    try {
      await db.ref().update(updates);
      committed = true;
    } catch (error) {
      const recovered = (await opRef.get().catch(() => null))?.val() as
        | { ticket?: PurchaseTicket }
        | null
        | undefined;
      if (recovered?.ticket && recovered.ticket.ticket === ticketNo) {
        committed = true;
        return { ...recovered, alreadyCommitted: true };
      }
      throw error;
    }
    return { ...receipt, alreadyCommitted: false };
  } finally {
    if (!committed) await releaseLeases(held, owner, { label: 'purchase.create.lock.release' });
  }
}
