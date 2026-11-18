import { changeClientCredit } from '../../server/modules/receivables/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 65536,
    handle: ({ identity, body }) => changeClientCredit(identity, body as Body),
  },
});
