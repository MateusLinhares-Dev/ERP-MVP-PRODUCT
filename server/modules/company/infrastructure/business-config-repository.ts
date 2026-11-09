import { getFirebaseAdmin } from '../../../shared/firebase/firebase-admin.js';
import { DEFAULT_BUSINESS_CONFIG } from '../domain/business-config-defaults.js';

export type BusinessConfig = Record<string, unknown>;

export interface BusinessConfigRepository {
  getConfig(): Promise<BusinessConfig>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectMissing(
  defaults: Record<string, unknown>,
  current: Record<string, unknown>,
  prefix: string,
  patch: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(defaults)) {
    const path = prefix ? `${prefix}/${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      patch[path] = value;
      continue;
    }
    const existing = current[key];
    if (isObject(value) && isObject(existing)) collectMissing(value, existing, path, patch);
  }
}

function mergeMissing(defaults: Record<string, unknown>, current: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = isObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = value;
      continue;
    }
    const existing = result[key];
    if (isObject(value) && isObject(existing)) result[key] = mergeMissing(value, existing);
  }
  return result;
}

export class FirebaseBusinessConfigRepository implements BusinessConfigRepository {
  async getConfig(): Promise<BusinessConfig> {
    const { db } = getFirebaseAdmin();
    const ref = db.ref('erp/config');
    const current: unknown = (await ref.get()).val();
    const normalized = isObject(current) ? current : {};
    const patch: Record<string, unknown> = {};
    collectMissing(DEFAULT_BUSINESS_CONFIG, normalized, '', patch);
    if (Object.keys(patch).length) await ref.update(patch);
    return mergeMissing(DEFAULT_BUSINESS_CONFIG, normalized);
  }
}
