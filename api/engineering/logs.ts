import { queryAuditLog } from '../../server/modules/audit/index.js';
import { getFirebaseAdmin } from '../../server/shared/firebase/firebase-admin.js';
import { defineApi, queryParam } from '../../server/shared/http/api-handler.js';

const FILTERS = ['limit', 'cursor', 'module', 'level', 'actor', 'term', 'from', 'to'] as const;

export default defineApi({
  GET: {
    access: 'engineer',
    handle: ({ req }) =>
      queryAuditLog(
        getFirebaseAdmin().db,
        Object.fromEntries(FILTERS.map((name) => [name, queryParam(req, name)])),
      ),
  },
});
