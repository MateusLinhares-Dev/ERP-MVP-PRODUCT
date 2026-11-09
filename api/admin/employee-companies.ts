import { changeCompanyDirectoryEntry, readCompanyDirectory } from '../../server/modules/company/index.js';
import { getFirebaseAdmin } from '../../server/shared/firebase/firebase-admin.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  GET: { access: 'admin', handle: () => readCompanyDirectory(getFirebaseAdmin().db) },
  POST: {
    access: 'admin',
    maxBodyBytes: 512,
    handle: ({ identity, body }) =>
      changeCompanyDirectoryEntry(getFirebaseAdmin().db, identity, body as Body),
  },
});
