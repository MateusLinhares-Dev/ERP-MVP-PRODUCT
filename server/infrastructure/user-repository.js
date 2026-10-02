import { getFirebaseAdmin } from './firebase-admin.js';
import { sanitizeProfile } from '../domain/user.js';

export class FirebaseUserRepository {
  constructor() { this.db = getFirebaseAdmin().db; }
  async listSecureUsers() { return (await this.db.ref('erpAuth/users').get()).val() || {}; }
  async getSecureUser(login) { return (await this.db.ref(`erpAuth/users/${login}`).get()).val() || null; }
  async getProfile(login) { return (await this.db.ref(`erp/users/${login}`).get()).val() || null; }
  async exists(login) { return (await this.db.ref(`erpAuth/users/${login}`).get()).exists(); }

  async upsert(login, record) {
    const profile = sanitizeProfile(record.profile);
    const updates = {};
    updates[`erpAuth/users/${login}`] = { ...record, profile };
    updates[`erp/users/${login}`] = profile;
    await this.db.ref().update(updates);
  }

  async delete(login) {
    const snap = await this.db.ref('erp/usersDeleted').get();
    const deleted = Array.isArray(snap.val()) ? snap.val().filter(Boolean) : [];
    if (!deleted.includes(login)) deleted.push(login);
    await this.db.ref().update({
      [`erpAuth/users/${login}`]: null,
      [`erp/users/${login}`]: null,
      'erp/usersDeleted': deleted,
    });
  }

  async removeTombstone(login) {
    const snap = await this.db.ref('erp/usersDeleted').get();
    const deleted = Array.isArray(snap.val()) ? snap.val().filter(Boolean) : [];
    const next = deleted.filter((value) => value !== login);
    await this.db.ref('erp/usersDeleted').set(next.length ? next : []);
  }
}
