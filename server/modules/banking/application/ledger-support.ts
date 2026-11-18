import type { Database } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { fail } from '../../../shared/errors/app-error.js';
import { withLocks } from '../../../shared/firebase/locks.js';
import { isRow, safeKey, type Row } from '../domain/bank-ledger-rules.js';

export interface Context {
  db: Database;
  identity: Identity;
  now: () => number;
  uuid: () => string;
}

export const LOCK_ROOT = 'erpBankLedgerLocks/';
export const CHEQUES_LOCK = LOCK_ROOT + 'cheques';

export const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const text = (value: unknown, max = 200): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);

export const actor = (identity: Identity): string => text(identity.erpUser || identity.uid, 80);

export const shortId = (context: Context, size = 8): string =>
  context.uuid().replace(/-/g, '').slice(0, size);

export async function read(db: Database, path: string): Promise<unknown> {
  return (await db.ref(path).get()).val();
}

export function rows(raw: unknown): [string, Row][] {
  if (Array.isArray(raw))
    return raw
      .map((value, index): [string, unknown] => [String(index), value])
      .filter((pair): pair is [string, Row] => isRow(pair[1]));
  if (isRow(raw)) return Object.entries(raw).filter((pair): pair is [string, Row] => isRow(pair[1]));
  return [];
}

export function requireKey(value: unknown, message: string): string {
  const key = safeKey(value);
  if (!key) fail(422, 'INVALID_REFERENCE', message);
  return key;
}

export const lock = <T>(context: Context, paths: string[], work: () => Promise<T>) =>
  withLocks(
    context.db,
    paths,
    {
      now: context.now,
      uuid: context.uuid,
      code: 'BANK_LEDGER_IN_PROGRESS',
      message:
        'Esta conta, lançamento ou cheque está sendo alterado em outra tela. Aguarde alguns segundos e tente de novo.',
    },
    work,
  );

export async function findMovement(db: Database, id: string): Promise<{ path: string; row: Row } | null> {
  const direct = await read(db, 'erp/lancBanco/' + id);
  if (isRow(direct) && (direct.id == null || String(direct.id) === id))
    return { path: id, row: { ...direct, id } };
  const found = rows(await read(db, 'erp/lancBanco')).find(
    ([path, row]) => String(row.id ?? '') === id || path === id,
  );
  return found ? { path: found[0], row: { ...found[1], id } } : null;
}
