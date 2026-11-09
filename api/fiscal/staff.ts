import { listFiscalStaff } from '../../server/modules/fiscal/index.js';
import { getFirebaseAdmin } from '../../server/shared/firebase/firebase-admin.js';
import { defineApi } from '../../server/shared/http/api-handler.js';

export default defineApi({
  GET: { access: 'user', handle: ({ identity }) => listFiscalStaff(getFirebaseAdmin().db, identity) },
});
