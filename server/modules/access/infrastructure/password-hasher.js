import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLEL = 1;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(String(password), salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLEL, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLEL}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [alg, n, r, p, saltB64, hashB64] = String(encoded || '').split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64url');
    const derived = Buffer.from(await scrypt(String(password), Buffer.from(saltB64, 'base64url'), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    }));
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch (_) { return false; }
}
