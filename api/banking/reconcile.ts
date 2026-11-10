import { executeReconciliation } from '../../server/modules/banking/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 32768,
    handle: ({ identity, body }) => executeReconciliation(identity, body as Body),
  },
});
