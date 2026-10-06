import { DEFAULT_BUSINESS_CONFIG } from '../config/business-config-defaults.js';
import { getFirebaseAdmin } from './firebase-admin.js';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectMissing(defaults, current, prefix, patch) {
  for (const [key, value] of Object.entries(defaults || {})) {
    const path = prefix ? `${prefix}/${key}` : key;
    const exists = current !== null && current !== undefined && Object.prototype.hasOwnProperty.call(current, key);
    if (!exists) {
      patch[path] = value;
      continue;
    }
    if (isObject(value) && isObject(current[key])) collectMissing(value, current[key], path, patch);
  }
}

function mergeMissing(defaults, current) {
  const result = isObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(defaults || {})) {
    if (!Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = value;
      continue;
    }
    if (isObject(value) && isObject(result[key])) result[key] = mergeMissing(value, result[key]);
  }
  return result;
}

export class FirebaseBusinessConfigRepository {
  async getConfig() {
    const { db } = getFirebaseAdmin();
    const snap = await db.ref('erp/config').get();
    const ref = db.ref('erp/config');
    const current = snap.val();
    const normalized = isObject(current) ? current : {};
    const patch = {};
    collectMissing(DEFAULT_BUSINESS_CONFIG, normalized, '', patch);
    if (Object.keys(patch).length) await ref.update(patch);
    return mergeMissing(DEFAULT_BUSINESS_CONFIG, normalized);
  }
}
