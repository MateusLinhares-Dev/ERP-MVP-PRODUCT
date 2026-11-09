import { createHmac } from 'node:crypto';
import type { Database, Reference } from 'firebase-admin/database';
import { fail } from '../../../shared/errors/app-error.js';
import { getFirebaseAdmin } from '../../../shared/firebase/firebase-admin.js';
import { runTransaction } from '../../../shared/firebase/rtdb-transaction.js';
import { withSpan } from '../../../shared/observability/tracing.js';

const MAX_ATTEMPTS = 5;
const BLOCK_MS = 30 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;

interface AttemptRecord {
  count?: number;
  windowStartedAt?: number;
  lastAttemptAt?: number;
  blockedUntil?: number | null;
}

function keyForIp(ip: string): string {
  const secret = process.env.LOGIN_RATE_LIMIT_SECRET;
  if (!secret) throw new Error('LOGIN_RATE_LIMIT_SECRET não configurado.');
  return createHmac('sha256', secret)
    .update(String(ip || 'unknown'))
    .digest('hex');
}

export class LoginRateLimitRepository {
  private readonly db: Database;

  constructor(db: Database = getFirebaseAdmin().db) {
    this.db = db;
  }

  ref(ip: string): Reference {
    return this.db.ref(`security/loginAttempts/${keyForIp(ip)}`);
  }

  async assertAllowed(ip: string): Promise<void> {
    await withSpan(
      'security.login_rate_limit.check',
      { 'security.operation': 'login-rate-limit' },
      async () => {
        const value = ((await this.ref(ip).get()).val() ?? {}) as AttemptRecord;
        const now = Date.now();
        if (value.blockedUntil && value.blockedUntil > now) {
          fail(429, 'RATE_LIMITED', 'Acesso temporariamente bloqueado por excesso de tentativas.', {
            retryAfterSeconds: Math.ceil((value.blockedUntil - now) / 1000),
          });
        }
      },
    );
  }

  async registerFailure(ip: string): Promise<void> {
    const now = Date.now();
    await runTransaction(this.ref(ip), (current) => {
      const previous = (current ?? {}) as AttemptRecord;
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

  async clear(ip: string): Promise<void> {
    await this.ref(ip).remove();
  }
}
