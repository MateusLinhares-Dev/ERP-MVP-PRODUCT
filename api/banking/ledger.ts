import { changeBankLedger } from '../../server/modules/banking/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 65536,
    handle: ({ identity, body }) => changeBankLedger(identity, body as Body),
  },
});
