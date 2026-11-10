import { handleBankIntegration } from '../../server/modules/banking/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 8192,
    handle: ({ identity, body }) => handleBankIntegration(identity, body as Body),
  },
});
