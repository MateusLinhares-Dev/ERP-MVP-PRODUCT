import { asErrorLike, errorMessage } from '../errors/app-error.js';

const TRANSIENT_TRANSACTION_ERRORS = new Set(['disconnect', 'set', 'maxretry']);

export interface SnapshotLike {
  val(): unknown;
}

export interface TransactionOutcome {
  committed: boolean;
  snapshot?: SnapshotLike | null;
}

export type TransactionUpdate = (current: unknown) => unknown;

export interface TransactionalRef {
  transaction(
    update: TransactionUpdate,
    onComplete?: undefined,
    applyLocally?: boolean,
  ): Promise<TransactionOutcome>;
  get(): Promise<SnapshotLike>;
  on?(event: 'value', callback: () => void, cancel?: (error: Error) => void): unknown;
  off?(event: 'value', callback?: () => void): void;
}

export interface LeaseEntry {
  ref: TransactionalRef;
  path?: string;
}

export interface TransactionOptions {
  attempts?: number;
  primeTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LeaseOptions {
  now?: () => number;
  ttlMs?: number;
  meta?: Record<string, unknown>;
  attempts?: number;
}

export interface ReleaseOptions {
  logger?: { error?(label: string, details: unknown): void };
  label?: string;
}

interface LeaseRecord {
  owner?: unknown;
  expiresAt?: unknown;
}

export function isTransientFirebaseError(error: unknown): boolean {
  const message = errorMessage(error).trim().toLowerCase();
  if (TRANSIENT_TRANSACTION_ERRORS.has(message)) return true;
  const code = String(asErrorLike(error).code ?? '').toLowerCase();
  return (
    code === 'unavailable' ||
    code === 'network-error' ||
    code === 'app/network-error' ||
    /client is offline|network error|socket hang up|econnreset|etimedout/.test(message)
  );
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function primeCache(ref: TransactionalRef, timeoutMs: number): Promise<() => void> {
  const { on, off } = ref;
  if (typeof on !== 'function' || typeof off !== 'function') return Promise.resolve(() => undefined);
  return new Promise((resolve, reject) => {
    let settled = false;
    const detach = (): void => {
      try {
        off.call(ref, 'value', onValue);
      } catch {
        return;
      }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      detach();
      reject(Object.assign(new Error('Tempo esgotado ao consultar o Firebase.'), { code: 'unavailable' }));
    }, timeoutMs);
    timer.unref?.();
    function onValue(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(detach);
    }
    function onCancel(error: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      detach();
      reject(error ?? new Error('Leitura cancelada pelo Firebase.'));
    }
    on.call(ref, 'value', onValue, onCancel);
  });
}

export async function runTransaction(
  ref: TransactionalRef,
  update: TransactionUpdate,
  { attempts = 4, primeTimeoutMs = 15000, sleep = wait }: TransactionOptions = {},
): Promise<TransactionOutcome> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let detach: (() => void) | null = null;
    try {
      detach = await primeCache(ref, primeTimeoutMs);
      return await ref.transaction(update, undefined, false);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientFirebaseError(error)) throw error;
      await sleep(Math.min(1500, 120 * attempt * attempt));
    } finally {
      detach?.();
    }
  }
  throw lastError;
}

export async function acquireLease(
  ref: TransactionalRef,
  owner: string,
  { now = () => Date.now(), ttlMs = 120000, meta = {}, attempts }: LeaseOptions = {},
): Promise<boolean> {
  if (!owner) throw new Error('Dono da trava ausente.');
  const result = await runTransaction(
    ref,
    (current) => {
      const lease = current as LeaseRecord | null;
      if (lease && typeof lease === 'object' && lease.owner !== owner && Number(lease.expiresAt) > now()) {
        return undefined;
      }
      return { ...meta, owner, expiresAt: now() + ttlMs };
    },
    attempts ? { attempts } : undefined,
  );
  return result.committed === true;
}

export async function releaseLease(
  ref: TransactionalRef | null | undefined,
  owner: string,
  { logger = console, label = 'rtdb.lease.release' }: ReleaseOptions = {},
): Promise<boolean> {
  if (!ref || !owner) return true;
  try {
    const result = await runTransaction(ref, (current) => {
      if (current == null) return null;
      if ((current as LeaseRecord).owner === owner) return null;
      return undefined;
    });
    if (result.committed) return true;
    const live = result.snapshot?.val() as LeaseRecord | null | undefined;
    return !live || live.owner !== owner;
  } catch (error) {
    try {
      logger.error?.(label, { message: errorMessage(error) });
    } catch {
      return false;
    }
    return false;
  }
}

export async function releaseLeases(
  entries: ReadonlyArray<LeaseEntry | TransactionalRef>,
  owner: string,
  options?: ReleaseOptions,
): Promise<void> {
  for (const entry of [...entries].reverse()) {
    const ref = 'ref' in entry ? entry.ref : entry;
    await releaseLease(ref, owner, options);
  }
}
