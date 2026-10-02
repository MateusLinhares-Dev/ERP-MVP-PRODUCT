import { createHmac } from 'node:crypto';
import { getFirebaseAdmin } from './firebase-admin.js';

const MAX_ATTEMPTS = 5;
const BLOCK_MS = 30 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;

function keyForIp(ip) {
  const secret = process.env.LOGIN_RATE_LIMIT_SECRET;
  if (!secret) throw new Error('LOGIN_RATE_LIMIT_SECRET não configurado.');
  return createHmac('sha256', secret).update(String(ip || 'unknown')).digest('hex');
}

export class LoginRateLimitRepository {
  constructor() { this.db = getFirebaseAdmin().db; }
  ref(ip) { return this.db.ref(`security/loginAttempts/${keyForIp(ip)}`); }

  async assertAllowed(ip) {
    const value = (await this.ref(ip).get()).val() || {};
    const now = Date.now();
    if (value.blockedUntil && value.blockedUntil > now) {
      const error = new Error('Acesso temporariamente bloqueado por excesso de tentativas.');
      error.status = 429; error.code = 'RATE_LIMITED'; error.retryAfterSeconds = Math.ceil((value.blockedUntil - now) / 1000);
      throw error;
    }
  }

  async registerFailure(ip) {
    const now = Date.now();
    await this.ref(ip).transaction((current) => {
      const previous = current || {};
      const expired = !previous.windowStartedAt || now - previous.windowStartedAt > WINDOW_MS;
      const count = expired ? 1 : Number(previous.count || 0) + 1;
      return {
        count,
        windowStartedAt: expired ? now : previous.windowStartedAt,
        lastAttemptAt: now,
        blockedUntil: count >= MAX_ATTEMPTS ? now + BLOCK_MS : null,
      };
    });
  }

  async clear(ip) { await this.ref(ip).remove(); }
}
