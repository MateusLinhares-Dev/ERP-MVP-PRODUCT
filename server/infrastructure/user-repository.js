import {
  getFirebaseAdmin,
} from './firebase-admin.js';

import {
  sanitizeProfile,
} from '../domain/user.js';

import {
  withSpan,
} from '../observability/tracing.js';

export class FirebaseUserRepository {
  constructor() {
    this.db =
      getFirebaseAdmin().db;
  }

  async listSecureUsers() {
    return withSpan(
      'firebase.rtdb.users.list',
      {
        'db.system':
          'firebase-rtdb',
        'db.operation':
          'get',
        'db.path':
          'erpAuth/users',
      },
      async () => {
        return (
          await this.db
            .ref('erpAuth/users')
            .get()
        ).val() || {};
      },
    );
  }

  async getSecureUser(login) {
    return withSpan(
      'firebase.rtdb.user.secure.get',
      {
        'db.system':
          'firebase-rtdb',
        'db.operation':
          'get',
        'db.path':
          'erpAuth/users/{login}',
      },
      async () => {
        return (
          await this.db
            .ref(
              `erpAuth/users/${login}`,
            )
            .get()
        ).val() || null;
      },
    );
  }

  async getProfile(login) {
    return withSpan(
      'firebase.rtdb.user.profile.get',
      {
        'db.system':
          'firebase-rtdb',
        'db.operation':
          'get',
        'db.path':
          'erp/users/{login}',
      },
      async () => {
        return (
          await this.db
            .ref(
              `erp/users/${login}`,
            )
            .get()
        ).val() || null;
      },
    );
  }

  async exists(login) {
    return withSpan(
      'firebase.rtdb.user.exists',
      {
        'db.system':
          'firebase-rtdb',
        'db.operation':
          'get',
        'db.path':
          'erpAuth/users/{login}',
      },
      async () => {
        return (
          await this.db
            .ref(
              `erpAuth/users/${login}`,
            )
            .get()
        ).exists();
      },
    );
  }

  async upsert(login, record) {
    return withSpan(
      'firebase.rtdb.user.upsert',
      {
        'db.system':
          'firebase-rtdb',
        'db.operation':
          'update',
        'db.path':
          'erp/users',
      },
      async () => {
        const profile =
          sanitizeProfile(
            record.profile,
          );

        const updates = {};

        updates[
          `erpAuth/users/${login}`
        ] = {
          ...record,
          profile,
        };

        updates[
          `erp/users/${login}`
        ] = profile;

        await this.db
          .ref()
          .update(updates);
      },
    );
  }

  async delete(login) {
    return withSpan(
      'firebase.rtdb.user.delete',
      {
        'db.system':
          'firebase-rtdb',
        'db.operation':
          'update',
        'db.path':
          'erp/users',
      },
      async () => {
        const snap =
          await this.db
            .ref(
              'erp/usersDeleted',
            )
            .get();

        const deleted =
          Array.isArray(snap.val())
            ? snap
                .val()
                .filter(Boolean)
            : [];

        if (
          !deleted.includes(login)
        ) {
          deleted.push(login);
        }

        await this.db
          .ref()
          .update({
            [`erpAuth/users/${login}`]:
              null,

            [`erp/users/${login}`]:
              null,

            'erp/usersDeleted':
              deleted,
          });
      },
    );
  }

  async removeTombstone(login) {
    return withSpan(
      'firebase.rtdb.user.tombstone.remove',
      {
        'db.system':
          'firebase-rtdb',
        'db.operation':
          'set',
        'db.path':
          'erp/usersDeleted',
      },
      async () => {
        const snap =
          await this.db
            .ref(
              'erp/usersDeleted',
            )
            .get();

        const deleted =
          Array.isArray(snap.val())
            ? snap
                .val()
                .filter(Boolean)
            : [];

        const next =
          deleted.filter(
            (value) =>
              value !== login,
          );

        await this.db
          .ref(
            'erp/usersDeleted',
          )
          .set(
            next.length
              ? next
              : [],
          );
      },
    );
  }
}