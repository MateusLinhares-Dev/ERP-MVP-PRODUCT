import {
  releaseLease,
  runTransaction,
  type TransactionalRef,
} from '../../../shared/firebase/rtdb-transaction.js';
import { failure, type Row } from '../domain/advance-rules.js';

export interface AdvanceLockOptions {
  db?: { ref(path: string): TransactionalRef } | null;
  operationKey?: string;
  fornCod?: string;
  kind?: string;
  requestFingerprint?: string;
  sleep?: (ms: number) => Promise<void>;
}

interface AdvanceLock {
  owner?: string;
  operationKey?: string;
  fornCod?: string;
  kind?: string;
  requestFingerprint?: string;
  expiresAt?: number;
}

interface OperationReceipt {
  advance?: unknown;
  fornCod?: string;
  requestFingerprint?: string;
  action?: string;
  result?: { fornCod?: string; newFornCod?: string };
}

export interface LockStore {
  ref(path: string): {
    get(): Promise<{ val(): unknown }>;
  };
}

export interface CommitStore extends LockStore {
  ref(path: string): {
    get(): Promise<{ val(): unknown }>;
    update(values: Row): Promise<void>;
  };
}

const DELAYS = [0, 160, 280, 420, 640, 900, 1200, 1600];
const GLOBAL_CHEQUES = '__global_cheques__';

function confirmedReceipt(lock: AdvanceLock, receipt: OperationReceipt | null): boolean {
  if (lock.kind === 'create') {
    return Boolean(
      receipt?.advance &&
        receipt.fornCod === lock.fornCod &&
        receipt.requestFingerprint &&
        receipt.requestFingerprint === lock.requestFingerprint,
    );
  }
  return (
    lock.kind === 'change' &&
    Boolean(
      receipt?.result &&
        ['edit', 'delete'].includes(String(receipt.action)) &&
        (lock.fornCod === GLOBAL_CHEQUES ||
          receipt.result.fornCod === lock.fornCod ||
          receipt.result.newFornCod === lock.fornCod),
    )
  );
}

export async function acquireAdvanceLock(
  ref: TransactionalRef,
  owner: string,
  now: () => number,
  { db, operationKey = '', fornCod = '', kind = '', requestFingerprint = '', sleep }: AdvanceLockOptions = {},
): Promise<boolean> {
  const pause = sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const nextLock = () => ({
    owner,
    operationKey,
    fornCod,
    kind,
    requestFingerprint,
    startedAt: now(),
    expiresAt: now() + 120000,
  });
  for (const delay of DELAYS) {
    if (delay) await pause(delay);
    const acquired = await runTransaction(ref, (current) => {
      const lock = current as AdvanceLock | null;
      if (lock && lock.owner !== owner && Number(lock.expiresAt) > now()) return undefined;
      return nextLock();
    });
    if (acquired.committed) return true;
    if (!db) continue;
    const lock = (await ref.get()).val() as AdvanceLock | null;
    if (!lock?.owner || !lock.operationKey || !lock.kind || !lock.fornCod) continue;
    if (!/^[\w-]{1,120}$/.test(String(lock.operationKey))) continue;
    const receipt = (
      await db.ref('erp/financeAdvanceOperations/' + lock.operationKey).get()
    ).val() as OperationReceipt | null;
    if (!confirmedReceipt(lock, receipt)) continue;
    const recovered = await runTransaction(ref, (current) => {
      const live = current as AdvanceLock | null;
      if (
        live?.owner !== lock.owner ||
        live?.operationKey !== lock.operationKey ||
        live?.kind !== lock.kind ||
        live?.fornCod !== lock.fornCod
      ) {
        return undefined;
      }
      return nextLock();
    });
    if (recovered.committed) return true;
  }
  return false;
}

export async function commitAdvanceAndRelease(
  db: CommitStore,
  updates: Row,
  keys: string[],
  owner: string,
  now: () => number,
): Promise<void> {
  for (const key of keys) {
    const current = (await db.ref('erpFinanceAdvanceLocks/' + key).get()).val() as AdvanceLock | null;
    if (current?.owner !== owner || Number(current.expiresAt) <= now()) {
      failure(
        409,
        'ADVANCE_LOCK_LOST',
        'A confirmação financeira perdeu a reserva. Confira o resultado antes de tentar novamente.',
      );
    }
  }
  const batch: Row = Object.fromEntries(
    Object.entries(updates).map(([path, value]) => ['erp/' + path, value]),
  );
  for (const key of keys) batch['erpFinanceAdvanceLocks/' + key] = null;
  await db.ref('/').update(batch);
}

export async function releaseAdvanceLocks(locks: TransactionalRef[], owner: string): Promise<void> {
  for (const ref of [...locks].reverse()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await releaseLease(ref, owner, { label: 'finance.advance.lock.release' })) break;
      if (attempt === 2) {
        console.error(
          'finance.advance.lock.release',
          new Error('Trava própria permaneceu ativa após três tentativas de liberação.'),
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
      }
    }
  }
}
