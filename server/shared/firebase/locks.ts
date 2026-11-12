import type { Database } from 'firebase-admin/database';
import { nameKey } from '../domain/person.js';
import { fail } from '../errors/app-error.js';
import { acquireLease, releaseLeases, type LeaseEntry } from './rtdb-transaction.js';

export interface LockOptions {
  now: () => number;
  uuid: () => string;
  ttlMs?: number;
  code: string;
  message: string;
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (const char of value) {
    result ^= char.codePointAt(0) ?? 0;
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(36);
}

export const customerLockPath = (client: unknown): string => 'erpSalesLocks/c-' + hash(nameKey(client));

export async function withLocks<T>(
  db: Database,
  paths: readonly string[],
  options: LockOptions,
  work: () => Promise<T>,
): Promise<T> {
  const owner = options.uuid();
  const held: (LeaseEntry & { path: string })[] = [];
  try {
    for (const path of [...new Set(paths)]) {
      const ref = db.ref(path);
      const acquired = await acquireLease(ref, owner, {
        now: options.now,
        ttlMs: options.ttlMs ?? 120000,
        meta: { kind: options.code },
      });
      if (!acquired) fail(409, options.code, options.message);
      held.push({ ref, path });
    }
    return await work();
  } finally {
    await releaseLeases(held, owner, { label: 'lock.release' });
  }
}
