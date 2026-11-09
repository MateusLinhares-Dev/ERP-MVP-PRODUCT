import { recordClientTelemetry } from '../../server/modules/audit/index.js';
import { getFirebaseAdmin } from '../../server/shared/firebase/firebase-admin.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 4096,
    handle: ({ identity, body }) => recordClientTelemetry(getFirebaseAdmin().db, identity, body as Body),
  },
});
