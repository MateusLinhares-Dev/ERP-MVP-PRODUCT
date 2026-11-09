import { manageUser, type ManageUserInput } from '../../server/modules/access/index.js';
import { recordAuditSafely } from '../../server/modules/audit/index.js';
import { asErrorLike } from '../../server/shared/errors/app-error.js';
import { defineApi } from '../../server/shared/http/api-handler.js';
import { clientIp } from '../../server/shared/http/http.js';
import { logRequestEvent } from '../../server/shared/observability/logger.js';

export default defineApi({
  POST: {
    access: 'admin',
    maxBodyBytes: 32768,
    handle: async ({ req, identity, body }) => {
      const input = body as ManageUserInput;
      const action = String(input.action || 'unknown');
      const targetLogin = String(input.login || '');
      logRequestEvent(req, 'info', 'admin.user.change.start', { action, targetLogin });
      try {
        const result = await manageUser(input);
        logRequestEvent(req, 'info', 'admin.user.change.success', {
          action,
          targetLogin: result.login || targetLogin,
        });
        await recordAuditSafely({
          actorUid: identity.uid,
          actorLogin: identity.erpUser,
          action: 'user_' + action,
          module: 'usuarios',
          entityType: 'usuario',
          entityId: result.login || targetLogin,
          ip: clientIp(req),
        });
        return result;
      } catch (error) {
        const details = asErrorLike(error);
        logRequestEvent(
          req,
          Number(details.status || 500) >= 500 ? 'error' : 'warn',
          'admin.user.change.failed',
          {
            action,
            targetLogin,
            errorCode: details.code || 'UNKNOWN_ERROR',
          },
        );
        throw error;
      }
    },
  },
});
