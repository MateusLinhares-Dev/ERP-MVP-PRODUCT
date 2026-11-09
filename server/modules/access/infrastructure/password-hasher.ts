import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const KEY_LENGTH = 64;
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLEL = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, length: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });
}

export async function hashPassword(password: unknown): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(String(password), salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLEL,
    maxmem: MAX_MEMORY,
  });
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLEL}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: unknown, encoded: unknown): Promise<boolean> {
  try {
    const [algorithm, cost, blockSize, parallel, salt, hash] = String(encoded || '').split('$');
    if (algorithm !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64url');
    const derived = await scrypt(String(password), Buffer.from(salt, 'base64url'), expected.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallel),
      maxmem: MAX_MEMORY,
    });
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}
