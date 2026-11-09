import { updateBranding } from '../../server/modules/company/index.js';
import { getFirebaseAdmin } from '../../server/shared/firebase/firebase-admin.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'admin',
    maxBodyBytes: 4608,
    handle: ({ identity, body }) => updateBranding(getFirebaseAdmin().db, identity, body as Body),
  },
});
