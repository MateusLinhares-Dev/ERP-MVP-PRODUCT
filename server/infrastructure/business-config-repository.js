import { getFirebaseAdmin } from './firebase-admin.js';

export class FirebaseBusinessConfigRepository {
  async getConfig() {
    const { db } = getFirebaseAdmin();
    const snap = await db.ref('erp/config').get();
    const value = snap.val();
    return value && typeof value === 'object' ? value : {};
  }
}
