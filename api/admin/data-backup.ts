import { exchangeBackup } from '../../server/modules/snapshots/index.js';
import { getFirebaseAdmin } from '../../server/shared/firebase/firebase-admin.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'admin',
    maxBodyBytes: 2_500_000,
    handle: ({ identity, body }) => exchangeBackup(getFirebaseAdmin().db, identity, body as Body),
  },
});
