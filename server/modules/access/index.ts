export { authenticateUser, type LoginInput, type LoginResult } from './application/authenticate-user.js';
export { manageUser, type ManageUserInput, type ManageUserResult } from './application/manage-user.js';
export { buildSecurityClaims, canAccessProfileTab } from './domain/access-claims.js';
export {
  assertStrongEnoughPassword,
  loginFromStorageKey,
  loginStorageKey,
  normalizeLogin,
  sanitizeProfile,
  type UserProfile,
} from './domain/user.js';
export { hashPassword, verifyPassword } from './infrastructure/password-hasher.js';
export { FirebaseUserRepository, type SecureUserRecord } from './infrastructure/user-repository.js';
