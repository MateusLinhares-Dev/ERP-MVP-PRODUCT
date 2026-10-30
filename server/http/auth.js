import {
  getFirebaseAdmin,
} from '../infrastructure/firebase-admin.js';

import {
  setRequestActor,
} from '../observability/logger.js';

import {
  withSpan,
} from '../observability/tracing.js';

export async function requireIdentity(
  req,
  {
    admin = false,
    engineer = false,
  } = {},
) {
  const header =
    String(
      req.headers.authorization ||
      '',
    );

  const token =
    header.startsWith('Bearer ')
      ? header.slice(7)
      : '';

  if (!token) {
    const e =
      new Error(
        'Sessão não autenticada.',
      );

    e.status = 401;
    e.code = 'UNAUTHENTICATED';

    throw e;
  }

  const decoded =
    await withSpan(
      'firebase.auth.verify_token',
      {
        'auth.provider':
          'firebase',
      },
      async () =>
        getFirebaseAdmin()
          .auth
          .verifyIdToken(token),
    );

  if (
    !decoded.erpAccess ||
    !decoded.erpUser
  ) {
    const e =
      new Error(
        'Sessão inválida para o ERP.',
      );

    e.status = 403;
    e.code = 'FORBIDDEN';

    throw e;
  }

  setRequestActor(
    req,
    decoded,
  );

  if (
    admin &&
    decoded.admin !== true
  ) {
    const e =
      new Error(
        'Operação restrita à administradora.',
      );

    e.status = 403;
    e.code = 'ADMIN_REQUIRED';

    throw e;
  }

  if (engineer) {
    if (decoded.engineer !== true || decoded.admin !== true || decoded.erpUser !== 'engadministrator' || decoded.uid !== 'erp:engadministrator') {
      const e = new Error('Área restrita ao perfil de engenharia.'); e.status = 403; e.code = 'ENGINEER_REQUIRED'; throw e;
    }
    // Token antigo não deve manter acesso após remoção/desativação do perfil.
    const { FirebaseUserRepository } = await import('../infrastructure/user-repository.js');
    const secure = await new FirebaseUserRepository().getSecureUser('engadministrator');
    if (!secure || secure.active === false || secure.engineer !== true || secure.admin !== true) {
      const e = new Error('Perfil de engenharia inativo.'); e.status = 403; e.code = 'ENGINEER_REVOKED'; throw e;
    }
  }

  return decoded;
}