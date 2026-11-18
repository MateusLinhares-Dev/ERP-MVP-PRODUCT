import { randomUUID } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import { actorKey, type Identity } from '../../../shared/auth/identity.js';
import { toBRDate, toISODate } from '../../../shared/domain/dates.js';
import { fail } from '../../../shared/errors/app-error.js';
import { batchCheques, importLegacyCheques, saveCheque, toggleChequeDiscount } from './cheque-control.js';
import {
  CHEQUES_LOCK,
  LOCK_ROOT,
  actor,
  clean,
  findMovement,
  lock,
  read,
  requireKey,
  rows,
  shortId,
  text,
  type Context,
} from './ledger-support.js';
import {
  MAX_CHEQUES,
  centsOf,
  chequeAutoDebit,
  chequeDescription,
  chequeOpen,
  cleanAccount,
  cleanEntry,
  entrySignature,
  isRow,
  lockedMovement,
  nextBankCode,
  safeKey,
  type MovementLinks,
  type Row,
} from '../domain/bank-ledger-rules.js';

export interface BankLedgerDeps {
  db?: Database;
  now?: () => number;
  uuid?: () => string;
}

interface StoredAccount {
  key: string;
  record: Row;
}

const ACCOUNTS_LOCK = LOCK_ROOT + 'accounts';

async function database(db?: Database): Promise<Database> {
  return db ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
}

function idList(raw: unknown): Set<string> {
  if (Array.isArray(raw)) return new Set(raw.map((item) => String(item ?? '')).filter(Boolean));
  if (isRow(raw))
    return new Set(
      Object.entries(raw)
        .filter(([, value]) => value === true || (isRow(value) && value.deleted !== false))
        .map(([key]) => key),
    );
  return new Set();
}

async function loadAccounts(db: Database): Promise<StoredAccount[]> {
  const [raw, deletedOld, deletedNew] = await Promise.all([
    read(db, 'erp/bancos'),
    read(db, 'erp/bancosDeleted'),
    read(db, 'erp/bancosDeletedV2'),
  ]);
  const deleted = new Set([...idList(deletedOld), ...idList(deletedNew)]);
  return rows(raw)
    .map(([key, record]) => ({ key, record }))
    .filter((account) => !deleted.has(accountId(account)));
}

const accountId = (account: StoredAccount): string => text(account.record.id) || account.key;
const accountCode = (account: StoredAccount): string => text(account.record.cod);
const sameText = (a: unknown, b: unknown): boolean =>
  text(a).toLocaleUpperCase('pt-BR') === text(b).toLocaleUpperCase('pt-BR');

function findAccount(accounts: StoredAccount[], id: string): StoredAccount {
  const found = accounts.find((account) => accountId(account) === id || account.key === id);
  if (!found) fail(404, 'BANK_NOT_FOUND', 'Conta bancária não encontrada. Atualize a tela.');
  return found as StoredAccount;
}

function bankByCode(accounts: StoredAccount[], code: string): StoredAccount | undefined {
  if (!code) return undefined;
  return (
    accounts.find((account) => accountCode(account) === code) ??
    accounts.find((account) => accountId(account) === code)
  );
}

function advanceRecords(raw: unknown): Row[] {
  const lists = Array.isArray(raw) ? raw : isRow(raw) ? Object.values(raw) : [];
  const out: Row[] = [];
  for (const list of lists) {
    const items: unknown[] = Array.isArray(list) ? list : isRow(list) ? Object.values(list) : [];
    for (const item of items) if (isRow(item)) out.push(item);
  }
  return out;
}

async function movementLinks(db: Database): Promise<MovementLinks> {
  const [advances, cheques] = await Promise.all([
    read(db, 'erp/adiantamentos'),
    read(db, 'erp/chequesControle'),
  ]);
  const advanceMovementIds = new Set(
    advanceRecords(advances)
      .map((advance) => text(advance.movBancoId))
      .filter(Boolean),
  );
  const chequeMovementIds = new Set(
    rows(cheques)
      .map(([, cheque]) => text(cheque.movBancoId))
      .filter(Boolean),
  );
  return { advanceMovementIds, chequeMovementIds };
}

function assertUnlocked(row: Row, links: MovementLinks): void {
  const blocked = lockedMovement(row, links);
  if (blocked) fail(422, blocked.code, blocked.message);
}

function assertExpected(row: Row, expected: unknown): void {
  if (!isRow(expected)) return;
  if (entrySignature(row) !== entrySignature(expected))
    fail(
      409,
      'MOVEMENT_CHANGED',
      'Este lançamento foi alterado em outra tela. Feche e abra o extrato de novo.',
    );
}

async function createAccount(context: Context, body: Row) {
  const { fields, problem } = cleanAccount(body.account, true);
  if (problem) fail(422, problem.code, problem.message);
  return lock(context, [ACCOUNTS_LOCK], async () => {
    const accounts = await loadAccounts(context.db);
    if (fields.conta) {
      const twin = accounts.find(
        (account) =>
          sameText(account.record.banco, fields.banco) &&
          sameText(account.record.agencia, fields.agencia) &&
          sameText(account.record.conta, fields.conta) &&
          sameText(account.record.empresa, fields.empresa),
      );
      if (twin)
        fail(409, 'BANK_EXISTS', `Esta conta já está cadastrada (${accountCode(twin) || accountId(twin)}).`);
    }
    const now = context.now();
    const raw = rows(await read(context.db, 'erp/bancos'));
    const cod = nextBankCode(raw.map(([, record]) => text(record.cod)).filter(Boolean));
    const id = 'BC' + now.toString(36) + shortId(context, 6);
    const record: Row = {
      id,
      cod,
      banco: fields.banco,
      tipo: fields.tipo ?? 'Conta Corrente',
      empresa: fields.empresa ?? '',
      titular: fields.titular ?? '',
      cpfcnpj: fields.tipo === 'Conta Terceiro' ? (fields.cpfcnpj ?? '') : '',
      agencia: fields.agencia ?? '',
      conta: fields.conta ?? '',
      pix: fields.pix ?? '',
      endereco: fields.endereco ?? '',
      saldo: fields.saldo ?? 0,
      obs: fields.obs ?? '',
      criadoEm: fields.criadoEm ?? new Date(now).toISOString(),
      criadoPor: actor(context.identity),
      _upd: now,
    };
    await context.db.ref().update({ ['erp/bancos/' + id]: clean(record), 'erp/_ts': now });
    return { action: 'create-account', account: record };
  });
}

async function updateAccount(context: Context, body: Row) {
  const id = requireKey(body.id, 'Conta bancária inválida. Atualize a tela.');
  const { fields, problem } = cleanAccount(body.account, false);
  if (problem) fail(422, problem.code, problem.message);
  return lock(context, [ACCOUNTS_LOCK], async () => {
    const accounts = await loadAccounts(context.db);
    const found = findAccount(accounts, id);
    const record = found.record;
    if (
      body.expectedUpdate != null &&
      record._upd != null &&
      Number(record._upd) !== Number(body.expectedUpdate)
    )
      fail(409, 'BANK_CHANGED', 'Esta conta foi alterada em outra tela. Feche e abra de novo.');
    const now = context.now();
    const { cod: requestedCode, ...rest } = fields;
    const next: Row = {
      ...record,
      ...rest,
      id: text(record.id) || found.key,
      alteradoPor: actor(context.identity),
      _upd: now,
    };
    if ('empresa' in fields) delete next._empresaAuto;
    if (text(next.tipo) !== 'Conta Terceiro') next.cpfcnpj = '';
    const updates: Row = {};
    const oldCode = accountCode(found);
    let movedEntries = 0;
    if (requestedCode && requestedCode !== oldCode) {
      const others = accounts.filter((account) => account !== found);
      if (others.some((account) => accountCode(account) === requestedCode))
        fail(
          409,
          'BANK_CODE_IN_USE',
          `Já existe outra conta com o código "${requestedCode}". Escolha um código diferente.`,
        );
      if (!others.some((account) => accountCode(account) === oldCode))
        fail(
          422,
          'BANK_CODE_LOCKED',
          'O código só pode ser trocado quando está repetido em outra conta. Pagamentos e adiantamentos guardam este código.',
        );
      for (const [path, movement] of rows(await read(context.db, 'erp/lancBanco'))) {
        if (text(movement.bancoCod) !== oldCode) continue;
        updates['erp/lancBanco/' + path + '/bancoCod'] = requestedCode;
        movedEntries++;
      }
      next.cod = requestedCode;
    }
    updates['erp/bancos/' + found.key] = clean(next);
    updates['erp/_ts'] = now;
    await context.db.ref().update(updates);
    return {
      action: 'update-account',
      account: next,
      ...(requestedCode && requestedCode !== oldCode
        ? { codeChange: { from: oldCode, to: requestedCode, movedEntries } }
        : {}),
    };
  });
}

async function deleteAccount(context: Context, body: Row) {
  const id = requireKey(body.id, 'Conta bancária inválida. Atualize a tela.');
  return lock(context, [ACCOUNTS_LOCK], async () => {
    const accounts = await loadAccounts(context.db);
    const found = findAccount(accounts, id);
    const cod = accountCode(found);
    const [movementsRaw, advancesRaw] = await Promise.all([
      read(context.db, 'erp/lancBanco'),
      read(context.db, 'erp/adiantamentos'),
    ]);
    const movements = cod ? rows(movementsRaw).filter(([, row]) => text(row.bancoCod) === cod).length : 0;
    const advances = cod
      ? advanceRecords(advancesRaw).filter(
          (advance) => text(advance.bancoCod) === cod && text(advance.status || 'Pendente') === 'Pendente',
        ).length
      : 0;
    if (movements || advances)
      fail(
        422,
        'BANK_IN_USE',
        `Esta conta possui ${movements} lançamento(s) no extrato${advances ? ` e ${advances} adiantamento(s) pendente(s)` : ''}. Para preservar saldos e histórico ela não pode ser excluída. Edite a conta ou remova os lançamentos antes.`,
      );
    const now = context.now();
    await context.db.ref().update({
      ['erp/bancos/' + found.key]: null,
      ['erp/bancosDeletedV2/' + accountId(found)]: true,
      'erp/_ts': now,
    });
    return { action: 'delete-account', id: accountId(found), cod };
  });
}

async function addEntry(context: Context, body: Row) {
  const code = requireKey(body.bankCode, 'Conta bancária inválida. Atualize a tela.');
  const { fields, problem } = cleanEntry(body.entry, true);
  if (problem) fail(422, problem.code, problem.message);
  const bank = bankByCode(await loadAccounts(context.db), code);
  if (!bank) fail(404, 'BANK_NOT_FOUND', 'Conta bancária não encontrada. Atualize a tela.');
  const now = context.now();
  const id = 'LB-' + now + '-' + shortId(context);
  const movement: Row = {
    id,
    bancoCod: accountCode(bank as StoredAccount) || code,
    data: fields.data,
    descricao: fields.descricao,
    tipo: fields.tipo,
    valor: fields.valor,
    origem: 'manual',
    criadoPor: actor(context.identity),
    _upd: now,
  };
  await context.db.ref().update({ ['erp/lancBanco/' + id]: clean(movement), 'erp/_ts': now });
  return { action: 'add-entry', movement };
}

async function updateEntry(context: Context, body: Row) {
  const id = requireKey(body.id, 'Lançamento inválido. Atualize a tela.');
  const { fields, problem } = cleanEntry(body.entry, false);
  if (problem) fail(422, problem.code, problem.message);
  return lock(context, [LOCK_ROOT + 'm-' + id], async () => {
    const found = await findMovement(context.db, id);
    if (!found) fail(404, 'MOVEMENT_NOT_FOUND', 'Lançamento não encontrado. Atualize o extrato.');
    const { path, row } = found as { path: string; row: Row };
    assertUnlocked(row, await movementLinks(context.db));
    assertExpected(row, body.expected);
    const now = context.now();
    const next: Row = { ...row, ...fields, alteradoPor: actor(context.identity), _upd: now };
    await context.db.ref().update({ ['erp/lancBanco/' + path]: clean(next), 'erp/_ts': now });
    return { action: 'update-entry', movement: next };
  });
}

async function deleteEntry(context: Context, body: Row) {
  const id = requireKey(body.id, 'Lançamento inválido. Atualize a tela.');
  return lock(context, [LOCK_ROOT + 'm-' + id], async () => {
    const found = await findMovement(context.db, id);
    if (!found) fail(404, 'MOVEMENT_NOT_FOUND', 'Lançamento não encontrado. Atualize o extrato.');
    const { path, row } = found as { path: string; row: Row };
    assertUnlocked(row, await movementLinks(context.db));
    assertExpected(row, body.expected);
    await context.db.ref().update({
      ['erp/lancBanco/' + path]: null,
      ['erp/lancBancoDeletedV2/' + id]: true,
      'erp/_ts': context.now(),
    });
    return { action: 'delete-entry', id, bancoCod: text(row.bancoCod) };
  });
}

const canBank = (identity: Identity): boolean => identity.canBanking === true;

async function loadCheque(db: Database, id: string): Promise<Row> {
  const [cheque, deleted] = await Promise.all([
    read(db, 'erp/chequesControle/' + id),
    read(db, 'erp/chequesControle_del/' + id),
  ]);
  if (!isRow(cheque) || deleted)
    fail(404, 'CHEQUE_NOT_FOUND', 'Cheque não encontrado. Atualize a lista de cheques.');
  return cheque as Row;
}

async function removeChequeMovement(context: Context, cheque: Row, updates: Row): Promise<string> {
  const movementId = safeKey(cheque.movBancoId);
  if (!movementId) return '';
  if (!canBank(context.identity))
    fail(
      403,
      'BANKING_REQUIRED',
      'Este cheque já saiu do saldo do banco. Para desfazer é preciso tirar a saída do extrato: peça para quem tem acesso a Bancos.',
    );
  const found = await findMovement(context.db, movementId);
  if (found) {
    updates['erp/lancBanco/' + found.path] = null;
    updates['erp/lancBancoDeletedV2/' + movementId] = true;
  }
  return movementId;
}

async function clearCheques(context: Context, body: Row) {
  const list = Array.isArray(body.cheques) ? body.cheques.filter(isRow) : [];
  if (!list.length) fail(422, 'NO_CHEQUES', 'Selecione ao menos um cheque.');
  if (list.length > MAX_CHEQUES)
    fail(422, 'TOO_MANY_CHEQUES', `Compense no máximo ${MAX_CHEQUES} cheques por vez.`);
  const iso = toISODate(body.date);
  if (!iso) fail(422, 'INVALID_DATE', 'Informe a data em que o cheque caiu no banco.');
  const dateBR = toBRDate(iso);
  const mode = body.mode === 'remessa' ? 'remessa' : 'controle';
  const items = [
    ...new Map(
      list.map((item) => {
        const id = requireKey(item.id, 'Cheque inválido. Atualize a lista.');
        return [id, { id, bankCode: safeKey(item.bankCode, 60), debit: item.debit }] as const;
      }),
    ).values(),
  ];
  return lock(context, [CHEQUES_LOCK], async () => {
    const [control, deleted, accounts] = await Promise.all([
      read(context.db, 'erp/chequesControle'),
      read(context.db, 'erp/chequesControle_del'),
      loadAccounts(context.db),
    ]);
    const controlRows = isRow(control) ? control : {};
    const deletedRows = isRow(deleted) ? deleted : {};
    const advanceCache = new Map<string, unknown>();
    const now = context.now();
    const updates: Row = {};
    const cleared: { id: string; movBancoId: string }[] = [];
    const movements: Row[] = [];
    const skipped: string[] = [];
    const warnings: string[] = [];
    for (const [index, item] of items.entries()) {
      const cheque = controlRows[item.id];
      if (!isRow(cheque) || deletedRows[item.id] || !chequeOpen(cheque)) {
        skipped.push(item.id);
        continue;
      }
      const supplier = safeKey(cheque.fornCod, 120);
      if (cheque.advanceCode && supplier && !advanceCache.has(supplier))
        advanceCache.set(supplier, await read(context.db, 'erp/adiantamentos/' + supplier));
      const auto = chequeAutoDebit(cheque, supplier ? advanceCache.get(supplier) : null);
      const debit = auto ?? (typeof item.debit === 'boolean' ? item.debit : !cheque.dc);
      let movementId = '';
      if (debit && !cheque.movBancoId) {
        const cents = centsOf(Number(cheque.v));
        const bank = bankByCode(accounts, item.bankCode);
        const number = text(cheque.n) || item.id;
        if (!canBank(context.identity))
          warnings.push(
            `Cheque nº ${number}: seu usuário não tem acesso a Bancos, a saída não foi lançada no extrato.`,
          );
        else if (!bank)
          warnings.push(
            `Cheque nº ${number}: o banco do cheque não tem conta bancária ligada, a saída não foi lançada no extrato.`,
          );
        else if (cents === null)
          warnings.push(`Cheque nº ${number}: valor inválido, a saída não foi lançada no extrato.`);
        else {
          movementId = 'LB-CHQ-' + now.toString(36) + index.toString(36) + '-' + shortId(context);
          const movement: Row = {
            id: movementId,
            bancoCod: accountCode(bank) || item.bankCode,
            data: dateBR,
            descricao: chequeDescription(cheque, mode, dateBR),
            tipo: 'Saida',
            valor: cents / 100,
            source: 'cheque',
            chequeId: item.id,
            criadoPor: actor(context.identity),
            _upd: now,
          };
          movements.push(movement);
          updates['erp/lancBanco/' + movementId] = movement;
        }
      }
      updates['erp/chequesControle/' + item.id + '/s'] = 'C';
      updates['erp/chequesControle/' + item.id + '/cd'] = dateBR;
      if (movementId) updates['erp/chequesControle/' + item.id + '/movBancoId'] = movementId;
      cleared.push({ id: item.id, movBancoId: movementId || text(cheque.movBancoId) });
    }
    if (cleared.length) {
      updates['erp/_ts'] = now;
      await context.db.ref().update(clean(updates));
    }
    return { action: 'clear-cheques', date: dateBR, cleared, movements, skipped, warnings };
  });
}

async function reopenCheque(context: Context, body: Row) {
  const id = requireKey(body.id, 'Cheque inválido. Atualize a lista.');
  return lock(context, [CHEQUES_LOCK], async () => {
    const cheque = await loadCheque(context.db, id);
    if (chequeOpen(cheque)) return { action: 'reopen-cheque', id, removedMovementId: '' };
    const updates: Row = {};
    const removedMovementId = await removeChequeMovement(context, cheque, updates);
    updates['erp/chequesControle/' + id + '/s'] = 'A';
    updates['erp/chequesControle/' + id + '/cd'] = '';
    updates['erp/chequesControle/' + id + '/movBancoId'] = null;
    updates['erp/_ts'] = context.now();
    await context.db.ref().update(updates);
    return { action: 'reopen-cheque', id, removedMovementId };
  });
}

async function deleteCheque(context: Context, body: Row) {
  const id = requireKey(body.id, 'Cheque inválido. Atualize a lista.');
  return lock(context, [CHEQUES_LOCK], async () => {
    const cheque = await loadCheque(context.db, id);
    if (cheque.advanceCode)
      fail(
        422,
        'CHEQUE_FROM_ADVANCE',
        `Este cheque pertence ao adiantamento ${text(cheque.advanceCode)}. Para removê-lo, exclua o adiantamento no módulo Adiantamentos: os cheques dele saem junto.`,
      );
    const updates: Row = {};
    const removedMovementId = await removeChequeMovement(context, cheque, updates);
    updates['erp/chequesControle_del/' + id] = true;
    updates['erp/chequesControle/' + id] = null;
    updates['erp/_ts'] = context.now();
    await context.db.ref().update(updates);
    return { action: 'delete-cheque', id, removedMovementId };
  });
}

const ACTIONS: Record<
  string,
  { claim: 'canBanking' | 'canFinance'; run: (context: Context, body: Row) => Promise<Row> }
> = {
  'create-account': { claim: 'canBanking', run: createAccount },
  'update-account': { claim: 'canBanking', run: updateAccount },
  'delete-account': { claim: 'canBanking', run: deleteAccount },
  'add-entry': { claim: 'canBanking', run: addEntry },
  'update-entry': { claim: 'canBanking', run: updateEntry },
  'delete-entry': { claim: 'canBanking', run: deleteEntry },
  'clear-cheques': { claim: 'canFinance', run: clearCheques },
  'reopen-cheque': { claim: 'canFinance', run: reopenCheque },
  'delete-cheque': { claim: 'canFinance', run: deleteCheque },
  'save-cheque': { claim: 'canFinance', run: saveCheque },
  'batch-cheques': { claim: 'canFinance', run: batchCheques },
  'toggle-cheque-discount': { claim: 'canFinance', run: toggleChequeDiscount },
  'import-legacy-cheques': { claim: 'canFinance', run: importLegacyCheques },
};

export async function changeBankLedger(identity: Identity, input: unknown, deps: BankLedgerDeps = {}) {
  const body = isRow(input) ? input : null;
  if (!body) return fail(400, 'INVALID_INPUT', 'Solicitação inválida.');
  const action = ACTIONS[text(body.action, 30)];
  if (!action) return fail(422, 'INVALID_ACTION', 'Ação desconhecida.');
  if (identity.erpAccess !== true || identity[action.claim] !== true)
    fail(
      403,
      action.claim === 'canBanking' ? 'BANKING_REQUIRED' : 'FINANCE_REQUIRED',
      action.claim === 'canBanking'
        ? 'Seu perfil não pode alterar contas bancárias nem o extrato.'
        : 'Seu perfil não pode alterar cheques.',
    );
  const context: Context = {
    db: await database(deps.db),
    identity,
    now: deps.now ?? (() => Date.now()),
    uuid: deps.uuid ?? randomUUID,
  };
  const operationId = text(body.operationId, 40);
  const opRef = /^[a-f0-9-]{36}$/i.test(operationId)
    ? context.db.ref('erp/bankLedgerOperations/' + actorKey(identity) + '_' + operationId)
    : null;
  if (opRef) {
    const stored = (await opRef.get()).val() as { result?: Row } | null;
    if (stored?.result) return { ...stored.result, alreadyCommitted: true };
  }
  const result = clean(await action.run(context, body));
  if (opRef) await opRef.set({ result, createdAt: context.now() });
  return result;
}
