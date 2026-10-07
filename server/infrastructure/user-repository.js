import {
  getFirebaseAdmin,
} from './firebase-admin.js';

import {
  loginFromStorageKey,
  loginStorageKey,
  sanitizeProfile,
} from '../domain/user.js';

import {
  withSpan,
} from '../observability/tracing.js';

function logicalLogin(storageKey, record) {
  return String(
    record?.login ||
    record?.profile?.login ||
    loginFromStorageKey(storageKey) ||
    storageKey ||
    '',
  );
}

export class FirebaseUserRepository {
  constructor() {
    this.db = getFirebaseAdmin().db;
  }

  async listSecureUsers() {
    return withSpan(
      'firebase.rtdb.users.list',
      {
        'db.system': 'firebase-rtdb',
        'db.operation': 'get',
        'db.path': 'erpAuth/users',
      },
      async () => {
        const raw = (
          await this.db
            .ref('erpAuth/users')
            .get()
        ).val() || {};

        const users = {};

        for (const [storageKey, record] of Object.entries(raw)) {
          if (!record || typeof record !== 'object') continue;

          const login = logicalLogin(storageKey, record);
          if (login) users[login] = record;
        }

        return users;
      },
    );
  }

  async getSecureUser(login) {
    const storageKey = loginStorageKey(login);

    return withSpan(
      'firebase.rtdb.user.secure.get',
      {
        'db.system': 'firebase-rtdb',
        'db.operation': 'get',
        'db.path': 'erpAuth/users/{login}',
      },
      async () => (
        await this.db
          .ref(`erpAuth/users/${storageKey}`)
          .get()
      ).val() || null,
    );
  }

  async getProfile(login) {
    const storageKey = loginStorageKey(login);

    return withSpan(
      'firebase.rtdb.user.profile.get',
      {
        'db.system': 'firebase-rtdb',
        'db.operation': 'get',
        'db.path': 'erp/users/{login}',
      },
      async () => (
        await this.db
          .ref(`erp/users/${storageKey}`)
          .get()
      ).val() || null,
    );
  }

  async exists(login) {
    const storageKey = loginStorageKey(login);

    return withSpan(
      'firebase.rtdb.user.exists',
      {
        'db.system': 'firebase-rtdb',
        'db.operation': 'get',
        'db.path': 'erpAuth/users/{login}',
      },
      async () => (
        await this.db
          .ref(`erpAuth/users/${storageKey}`)
          .get()
      ).exists(),
    );
  }

  async upsert(login, record) {
    const storageKey = loginStorageKey(login);

    return withSpan(
      'firebase.rtdb.user.upsert',
      {
        'db.system': 'firebase-rtdb',
        'db.operation': 'update',
        'db.path': 'erp/users',
      },
      async () => {
        const profile = {
          ...sanitizeProfile(record.profile),
          login,
        };

        const updates = {
          [`erpAuth/users/${storageKey}`]: {
            ...record,
            login,
            profile,
          },
          [`erp/users/${storageKey}`]: profile,
        };

        await this.db.ref().update(updates);
      },
    );
  }

  async delete(login) {
    const storageKey = loginStorageKey(login);

    return withSpan(
      'firebase.rtdb.user.delete',
      {
        'db.system': 'firebase-rtdb',
        'db.operation': 'update',
        'db.path': 'erp/users',
      },
      async () => {
        const snap = await this.db.ref('erp/usersDeleted').get();
        const deleted = Array.isArray(snap.val())
          ? snap.val().filter(Boolean)
          : [];

        if (!deleted.includes(login)) deleted.push(login);

        await this.db.ref().update({
          [`erpAuth/users/${storageKey}`]: null,
          [`erp/users/${storageKey}`]: null,
          'erp/usersDeleted': deleted,
        });
      },
    );
  }

  async removeTombstone(login) {
    return withSpan(
      'firebase.rtdb.user.tombstone.remove',
      {
        'db.system': 'firebase-rtdb',
        'db.operation': 'set',
        'db.path': 'erp/usersDeleted',
      },
      async () => {
        const snap = await this.db.ref('erp/usersDeleted').get();
        const deleted = Array.isArray(snap.val())
          ? snap.val().filter(Boolean)
          : [];
        const next = deleted.filter((value) => value !== login);

        await this.db
          .ref('erp/usersDeleted')
          .set(next.length ? next : []);
      },
    );
  }
}
