import { randomUUID } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import { actorKey, type Identity } from '../../../shared/auth/identity.js';
import { businessTodayISO } from '../../../shared/domain/business-date.js';
import { toBRDate } from '../../../shared/domain/dates.js';
import { fail } from '../../../shared/errors/app-error.js';
import { withLocks } from '../../../shared/firebase/locks.js';
import { supplierNamed } from '../../advances/domain/advance-rules.js';
import {
  isPurchaseCredit,
  readBalance,
  sameBalance,
  text,
  type Row,
  type SupplierBalance,
} from '../domain/supplier-balance.js';

export interface SupplierBalanceDeps {
  db?: Database;
  now?: () => number;
  uuid?: () => string;
}

interface Context {
  db: Database;
  identity: Identity;
  now: () => number;
  uuid: () => string;
}

const KEY_CHARS = /[.#$/[\]]/;
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const actor = (identity: Identity): string => text(identity.erpUser || identity.uid, 80);

function supplierCode(value: unknown): string {
  const code = text(value, 60);
  if (!code || KEY_CHARS.test(code)) fail(422, 'INVALID_SUPPLIER', 'Selecione um fornecedor válido.');
  return code;
}

const lock = <T>(context: Context, code: string, work: () => Promise<T>) =>
  withLocks(
    context.db,
    ['erpFinanceAdvanceLocks/' + code],
    {
      now: context.now,
      uuid: context.uuid,
      code: 'SUPPLIER_BALANCE_IN_PROGRESS',
      message:
        'Outra operação de compra ou adiantamento deste fornecedor está em andamento. Aguarde alguns segundos e tente de novo.',
    },
    work,
  );

async function current(context: Context, code: string, expected: unknown): Promise<SupplierBalance> {
  const [legacy, mirror] = await Promise.all([
    context.db.ref('erp/saldoDevedor/' + code).get(),
    context.db.ref('erp/saldos/' + code).get(),
  ]);
  const balance = readBalance(legacy.val(), mirror.val());
  if (!balance) fail(404, 'BALANCE_NOT_FOUND', 'Este fornecedor não tem saldo registrado. Atualize a tela.');
  const found = balance as SupplierBalance;
  if (!sameBalance(found, expected))
    fail(
      409,
      'BALANCE_CHANGED',
      'O saldo deste fornecedor mudou em outra tela. Atualize a Ficha e tente de novo.',
    );
  return found;
}

const removal = (context: Context, code: string): Row => ({
  ['erp/saldoDevedor/' + code]: null,
  ['erp/saldos/' + code]: null,
  'erp/_ts': context.now(),
});

async function clearBalance(context: Context, body: Row) {
  const code = supplierCode(body.fornCod);
  return lock(context, code, async () => {
    const balance = await current(context, code, body.expected);
    await context.db.ref().update(removal(context, code));
    return {
      action: 'clear',
      fornCod: code,
      saldo: null,
      removed: { valor: balance.valor, ticket: balance.ticket, data: balance.data },
      kind: isPurchaseCredit(balance) ? 'credit' : 'debt',
    };
  });
}

async function moveToPayable(context: Context, body: Row) {
  const code = supplierCode(body.fornCod);
  const due = text(body.venc, 10);
  const venc = due ? toBRDate(due) : toBRDate(businessTodayISO(context.now()));
  if (!venc) fail(422, 'INVALID_DATE', 'Informe um vencimento válido.');
  const suppliers: unknown = (await context.db.ref('erp/fornecedores').get()).val();
  const supplier = supplierNamed(suppliers, code);
  if (!supplier) fail(422, 'SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado. Atualize a tela.');
  const name = text(supplier?.nome, 160) || code;
  return lock(context, code, async () => {
    const balance = await current(context, code, body.expected);
    if (isPurchaseCredit(balance))
      fail(
        409,
        'BALANCE_IS_CREDIT',
        `Este saldo é crédito do fornecedor (sobra de adiantamento da compra ${balance.ticket}), não uma dívida. ` +
          'Ele é oferecido na próxima compra.',
      );
    const now = context.now();
    const payable: Row = {
      id: 'CP' + now.toString(36) + context.uuid().replace(/-/g, '').slice(0, 10),
      lancto: toBRDate(businessTodayISO(now)),
      desc: 'Saldo devedor registrado — ' + name,
      cred: name,
      cat: 'Compra de Sucata',
      tipoForn: 'compra',
      empresa: '',
      bancoCod: '',
      bancoNome: '',
      valor: balance.valor,
      venc,
      status: 'Pendente',
      dataPgto: '',
      obs: (
        'Saldo devedor registrado na Ficha do fornecedor' + (balance.data ? ' em ' + balance.data : '')
      ).slice(0, 500),
      origem: 'compra_antiga',
      fornCod: code,
      criadoPor: actor(context.identity),
      _upd: now,
    };
    await context.db
      .ref()
      .update({ ...removal(context, code), ['erp/contasPagar/' + String(payable.id)]: payable });
    return {
      action: 'to-payable',
      fornCod: code,
      saldo: null,
      removed: { valor: balance.valor, ticket: '', data: balance.data },
      payable,
    };
  });
}

const ACTIONS: Record<string, (context: Context, body: Row) => Promise<Row>> = {
  clear: clearBalance,
  'to-payable': moveToPayable,
};

export async function changeSupplierBalance(
  identity: Identity,
  input: unknown,
  deps: SupplierBalanceDeps = {},
) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? (input as Row) : null;
  if (!body) return fail(400, 'INVALID_INPUT', 'Solicitação inválida.');
  if (identity.erpAccess !== true || identity.canFinance !== true)
    fail(403, 'FINANCE_REQUIRED', 'Seu perfil não pode alterar saldos de fornecedores.');
  const action = ACTIONS[text(body.action, 30)];
  if (!action) return fail(422, 'INVALID_ACTION', 'Ação desconhecida.');
  const db = deps.db ?? (await import('../../../shared/firebase/firebase-admin.js')).getFirebaseAdmin().db;
  const context: Context = {
    db,
    identity,
    now: deps.now ?? (() => Date.now()),
    uuid: deps.uuid ?? randomUUID,
  };
  const operationId = text(body.operationId, 40);
  const opRef = /^[a-f0-9-]{36}$/i.test(operationId)
    ? db.ref('erp/supplierBalanceOperations/' + actorKey(identity) + '_' + operationId)
    : null;
  if (opRef) {
    const stored = (await opRef.get()).val() as { result?: Row } | null;
    if (stored?.result) return { ...stored.result, alreadyCommitted: true };
  }
  const result = clean(await action(context, body));
  if (opRef) await opRef.set({ result, createdAt: context.now() });
  return result;
}
