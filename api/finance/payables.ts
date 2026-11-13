import { changePayable } from '../../server/modules/payables/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 65536,
    handle: ({ identity, body }) => changePayable(identity, body as Body),
  },
});
