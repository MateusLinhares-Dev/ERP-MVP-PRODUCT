import { authenticateUser } from '../../server/modules/access/index.js';
import { fail } from '../../server/shared/errors/app-error.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';
import { clientIp } from '../../server/shared/http/http.js';
import { setRequestActor } from '../../server/shared/observability/logger.js';

export default defineApi({
  POST: {
    access: 'public',
    maxBodyBytes: 2048,
    handle: async ({ req, body }) => {
      const password = String((body as Body).password || '');
      if (!password || password.length > 128) fail(400, 'INVALID_CREDENTIAL', 'Credencial inválida.');
      const result = await authenticateUser({ password, ip: clientIp(req) });
      setRequestActor(req, result.username);
      return result;
    },
  },
});
