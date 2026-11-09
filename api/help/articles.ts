import {
  changeHelpArticle,
  defaultArticleTransport,
  listHelpArticles,
} from '../../server/modules/help/index.js';
import { getFirebaseAdmin } from '../../server/shared/firebase/firebase-admin.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';
import { requireIdentity } from '../../server/shared/http/auth.js';

const deps = () => {
  const { app, db } = getFirebaseAdmin();
  return { db, transport: defaultArticleTransport(app) };
};

export default defineApi({
  GET: {
    access: 'user',
    handle: async ({ req, identity }) => {
      if (identity.engineer === true) await requireIdentity(req, { engineer: true });
      return listHelpArticles(deps(), identity);
    },
  },
  POST: {
    access: 'engineer',
    maxBodyBytes: 24000,
    handle: ({ identity, body }) => changeHelpArticle(deps(), identity, body as Body),
  },
});
