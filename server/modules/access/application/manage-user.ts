import { fail } from '../../../shared/errors/app-error.js';
import { getFirebaseAdmin } from '../../../shared/firebase/firebase-admin.js';
import {
  assertStrongEnoughPassword,
  normalizeLogin,
  sanitizeProfile,
  type RawProfile,
  type UserProfile,
} from '../domain/user.js';
import { hashPassword, verifyPassword } from '../infrastructure/password-hasher.js';
import { FirebaseUserRepository } from '../infrastructure/user-repository.js';

export interface ManageUserInput {
  action?: unknown;
  login?: unknown;
  newLogin?: unknown;
  password?: unknown;
  profile?: RawProfile;
}

export type ManageUserResult =
  | { login: string; profile: UserProfile | RawProfile | undefined }
  | { login: string; deleted: true };

const PASSWORD_VERIFY_CONCURRENCY = 4;
const ENGINEER_LOGIN = 'engadministrator';

async function ensureUniquePassword(
  repo: FirebaseUserRepository,
  password: string,
  exceptLogin = '',
): Promise<void> {
  const candidates = Object.entries(await repo.listSecureUsers()).filter(
    ([login, record]) => login !== exceptLogin && Boolean(record.passwordHash),
  );
  for (let index = 0; index < candidates.length; index += PASSWORD_VERIFY_CONCURRENCY) {
    const batch = candidates.slice(index, index + PASSWORD_VERIFY_CONCURRENCY);
    const matches = await Promise.all(
      batch.map(([, record]) => verifyPassword(password, record.passwordHash)),
    );
    if (matches.some(Boolean)) {
      fail(409, 'DUPLICATE_PASSWORD', 'Esta senha já está em uso por outro usuário. Escolha outra.');
    }
  }
}

async function revokeSession(login: string): Promise<void> {
  try {
    await getFirebaseAdmin().auth.deleteUser(`erp:${login}`);
  } catch {
    return;
  }
}

export async function manageUser(input: ManageUserInput): Promise<ManageUserResult> {
  const repo = new FirebaseUserRepository();
  const action = String(input.action || '');
  const login = normalizeLogin(input.login);

  if (!login) fail(400, 'LOGIN_REQUIRED', 'Login obrigatório.');
  if (login.length > 120) fail(400, 'LOGIN_TOO_LONG', 'Login longo demais.');
  if (login === ENGINEER_LOGIN || normalizeLogin(input.newLogin) === ENGINEER_LOGIN) {
    fail(
      403,
      'ENGINEER_RESERVED',
      'O perfil de engenharia é reservado e só pode ser gerenciado por provisionamento seguro.',
    );
  }

  if (action === 'create') {
    if (await repo.exists(login)) fail(409, 'LOGIN_EXISTS', 'Login já existe.');
    const password = assertStrongEnoughPassword(input.password);
    await ensureUniquePassword(repo, password);
    const profile = sanitizeProfile(input.profile);
    const now = Date.now();
    await repo.upsert(login, {
      passwordHash: await hashPassword(password),
      profile,
      active: true,
      admin: false,
      createdAt: now,
      updatedAt: now,
    });
    await repo.removeTombstone(login);
    return { login, profile };
  }

  const current = await repo.getSecureUser(login);
  if (!current) fail(404, 'USER_NOT_FOUND', 'Usuário não encontrado.');

  if (action === 'resetPassword') {
    const password = assertStrongEnoughPassword(input.password);
    await ensureUniquePassword(repo, password, login);
    await repo.upsert(login, {
      ...current,
      passwordHash: await hashPassword(password),
      updatedAt: Date.now(),
    });
    return { login, profile: current.profile };
  }

  if (action === 'update') {
    const newLogin = normalizeLogin(input.newLogin || login);
    if (!newLogin) fail(400, 'INVALID_LOGIN', 'Novo login inválido.');
    if (current.admin === true && newLogin !== login) {
      fail(400, 'ADMIN_LOGIN_IMMUTABLE', 'O login da administradora não pode ser alterado.');
    }
    if (newLogin !== login && (await repo.exists(newLogin)))
      fail(409, 'LOGIN_EXISTS', 'O novo login já existe.');
    let passwordHash = current.passwordHash;
    if (input.password) {
      const password = assertStrongEnoughPassword(input.password);
      await ensureUniquePassword(repo, password, login);
      passwordHash = await hashPassword(password);
    }
    const profile = sanitizeProfile(input.profile || current.profile);
    await repo.upsert(newLogin, { ...current, passwordHash, profile, updatedAt: Date.now() });
    await repo.removeTombstone(newLogin);
    if (newLogin !== login) {
      await repo.delete(login);
      await revokeSession(login);
    }
    return { login: newLogin, profile };
  }

  if (action === 'delete') {
    if (current.admin === true)
      fail(400, 'ADMIN_DELETE_FORBIDDEN', 'A administradora principal não pode ser excluída.');
    await repo.delete(login);
    await revokeSession(login);
    return { login, deleted: true };
  }

  return fail(400, 'INVALID_ACTION', 'Ação inválida.');
}
