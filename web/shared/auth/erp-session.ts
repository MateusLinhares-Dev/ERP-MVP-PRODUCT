import type { SessionUser } from './firebase-session.js';

export function erpSessionUser(): SessionUser | null {
  try {
    return window.firebase?.auth().currentUser ?? null;
  } catch {
    return null;
  }
}
