import { restoreHistory } from '../../server/modules/snapshots/index.js';
import { getFirebaseAdmin } from '../../server/shared/firebase/firebase-admin.js';
import { defineApi } from '../../server/shared/http/api-handler.js';

export default defineApi({
  GET: { access: 'admin', handle: ({ identity }) => restoreHistory(getFirebaseAdmin().db, identity) },
});
