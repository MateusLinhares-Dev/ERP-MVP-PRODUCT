import { payPayable } from '../../server/modules/payables/index.js';
import { defineApi, type Body } from '../../server/shared/http/api-handler.js';

export default defineApi({
  POST: {
    access: 'user',
    maxBodyBytes: 16384,
    handle: ({ identity, body }) => payPayable(identity, body as Body),
  },
});
