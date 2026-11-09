import { FirebaseUserRepository } from '../../server/modules/access/index.js';
import { fail } from '../../server/shared/errors/app-error.js';
import { defineApi } from '../../server/shared/http/api-handler.js';
import { requireIdentity } from '../../server/shared/http/auth.js';

export default defineApi({
  GET: {
    access: 'user',
    handle: async ({ req, identity }) => {
      if (identity.engineer === true) await requireIdentity(req, { engineer: true });
      const profile = await new FirebaseUserRepository().getProfile(identity.erpUser);
      if (!profile) fail(404, 'USER_NOT_FOUND', 'Usuário não encontrado.');
      return {
        username: identity.erpUser,
        profile: {
          ...profile,
          admin: identity.admin === true,
          engineer: identity.engineer === true && identity.erpUser === 'engadministrator',
        },
      };
    },
  },
});
