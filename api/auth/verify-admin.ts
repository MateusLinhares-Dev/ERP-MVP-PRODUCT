import { FirebaseUserRepository, verifyPassword } from '../../server/modules/access/index.js';
import { fail } from '../../server/shared/errors/app-error.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 2048,
    handle: async ({ identity, body }) => {
      const adminLogin = identity.engineer === true ? 'engadministrator' : 'elaine';
      const admin = (await new FirebaseUserRepository().listSecureUsers())[adminLogin];
      const valid =
        admin?.admin === true &&
        admin.active !== false &&
        (adminLogin !== 'engadministrator' || admin.engineer === true) &&
        (await verifyPassword(String((body as Body).password || ''), admin.passwordHash));
      if (!valid) fail(401, 'INVALID_CREDENTIALS', 'Senha incorreta.');
      return { ok: true };
    },
  },
});
