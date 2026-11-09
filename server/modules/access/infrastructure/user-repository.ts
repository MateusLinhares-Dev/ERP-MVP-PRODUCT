import type { Database } from 'firebase-admin/database';
import { getFirebaseAdmin } from '../../../shared/firebase/firebase-admin.js';
import { withSpan } from '../../../shared/observability/tracing.js';
import { loginFromStorageKey, loginStorageKey, sanitizeProfile, type RawProfile } from '../domain/user.js';

export interface SecureUserRecord {
  login?: string;
  passwordHash?: string;
  active?: boolean;
  admin?: boolean;
  engineer?: boolean;
  profile?: RawProfile;
  createdAt?: number;
  updatedAt?: number;
  [field: string]: unknown;
}

const isRecord = (value: unknown): value is SecureUserRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function logicalLogin(storageKey: string, record: SecureUserRecord): string {
  return String(record.login || record.profile?.login || loginFromStorageKey(storageKey) || storageKey || '');
}

function deletedLogins(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter(Boolean).map(String) : [];
}

const span = (name: string, operation: string, path: string) =>
  [name, { 'db.system': 'firebase-rtdb', 'db.operation': operation, 'db.path': path }] as const;

export class FirebaseUserRepository {
  private readonly db: Database;

  constructor(db: Database = getFirebaseAdmin().db) {
    this.db = db;
  }

  async listSecureUsers(): Promise<Record<string, SecureUserRecord>> {
    return withSpan(...span('firebase.rtdb.users.list', 'get', 'erpAuth/users'), async () => {
      const raw: unknown = (await this.db.ref('erpAuth/users').get()).val() ?? {};
      const users: Record<string, SecureUserRecord> = {};
      for (const [storageKey, record] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
        if (!isRecord(record)) continue;
        const login = logicalLogin(storageKey, record);
        if (login) users[login] = record;
      }
      return users;
    });
  }

  async getSecureUser(login: string): Promise<SecureUserRecord | null> {
    const storageKey = loginStorageKey(login);
    return withSpan(...span('firebase.rtdb.user.secure.get', 'get', 'erpAuth/users/{login}'), async () => {
      const value: unknown = (await this.db.ref(`erpAuth/users/${storageKey}`).get()).val();
      return isRecord(value) ? value : null;
    });
  }

  async getProfile(login: unknown): Promise<Record<string, unknown> | null> {
    const storageKey = loginStorageKey(login);
    return withSpan(...span('firebase.rtdb.user.profile.get', 'get', 'erp/users/{login}'), async () => {
      const value: unknown = (await this.db.ref(`erp/users/${storageKey}`).get()).val();
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    });
  }

  async exists(login: string): Promise<boolean> {
    const storageKey = loginStorageKey(login);
    return withSpan(...span('firebase.rtdb.user.exists', 'get', 'erpAuth/users/{login}'), async () =>
      (await this.db.ref(`erpAuth/users/${storageKey}`).get()).exists(),
    );
  }

  async upsert(login: string, record: SecureUserRecord): Promise<void> {
    const storageKey = loginStorageKey(login);
    await withSpan(...span('firebase.rtdb.user.upsert', 'update', 'erp/users'), async () => {
      const profile = {
        ...sanitizeProfile(record.profile),
        login,
        ...(login === 'engadministrator' && record.engineer === true ? { engineer: true } : {}),
      };
      await this.db.ref().update({
        [`erpAuth/users/${storageKey}`]: { ...record, login, profile },
        [`erp/users/${storageKey}`]: profile,
      });
    });
  }

  async delete(login: string): Promise<void> {
    const storageKey = loginStorageKey(login);
    await withSpan(...span('firebase.rtdb.user.delete', 'update', 'erp/users'), async () => {
      const deleted = deletedLogins((await this.db.ref('erp/usersDeleted').get()).val());
      if (!deleted.includes(login)) deleted.push(login);
      await this.db.ref().update({
        [`erpAuth/users/${storageKey}`]: null,
        [`erp/users/${storageKey}`]: null,
        'erp/usersDeleted': deleted,
      });
    });
  }

  async removeTombstone(login: string): Promise<void> {
    await withSpan(...span('firebase.rtdb.user.tombstone.remove', 'set', 'erp/usersDeleted'), async () => {
      const deleted = deletedLogins((await this.db.ref('erp/usersDeleted').get()).val());
      await this.db.ref('erp/usersDeleted').set(deleted.filter((value) => value !== login));
    });
  }
}
