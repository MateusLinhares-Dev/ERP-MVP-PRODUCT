import '../../server/config/load-local-env.js';

import {
  manageUser,
} from '../../server/application/manage-user.js';

import {
  requireIdentity,
} from '../../server/http/auth.js';

import {
  applyApiSecurityHeaders,
  assertJsonBody,
  assertMethod,
  assertSameOrigin,
  clientIp,
  sendError,
} from '../../server/http/http.js';

import {
  AuditRepository,
} from '../../server/infrastructure/audit-repository.js';

import {
  logRequestEvent,
} from '../../server/observability/logger.js';

export default async function handler(req, res) {
  let action = 'unknown';
  let targetLogin = '';

  try {
    applyApiSecurityHeaders(res, req);

    assertMethod(req, 'POST');
    assertSameOrigin(req, {
      required: true,
    });

    assertJsonBody(req, {
      maxBytes: 32768,
    });

    const identity =
      await requireIdentity(req, {
        admin: true,
      });

    const input = req.body || {};

    action = String(
      input.action || 'unknown',
    );

    targetLogin = String(
      input.login || '',
    );

    logRequestEvent(
      req,
      'info',
      'admin.user.change.start',
      {
        action,
        targetLogin,
      },
    );

    const result =
      await manageUser(input);

    logRequestEvent(
      req,
      'info',
      'admin.user.change.success',
      {
        action,
        targetLogin:
          result?.login ||
          targetLogin,
      },
    );

    try {
      await new AuditRepository().record({
        actorUid: identity.uid,
        actorLogin:
          identity.erpUser,
        action:
          'user_' + action,
        module: 'usuarios',
        entityType: 'usuario',
        entityId:
          result?.login ||
          targetLogin,
        ip: clientIp(req),
      });
    } catch (_) {}

    return res
      .status(200)
      .json(result);
  } catch (error) {
    logRequestEvent(
      req,
      Number(error?.status || 500) >= 500
        ? 'error'
        : 'warn',
      'admin.user.change.failed',
      {
        action,
        targetLogin,
        errorCode:
          error?.code ||
          'UNKNOWN_ERROR',
      },
    );

    return sendError(
      res,
      error,
    );
  }
}